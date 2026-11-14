import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, opts?: any) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
		i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: any) => children,
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
		useParams: () => ({}),
		Link: ({ to, children }: any) => <a href={to}>{children}</a>,
	};
});

const mockLoginWithTokens = vi.fn();
vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	loginWithTokens: (...args: any[]) => mockLoginWithTokens(...args),
	decodeJwtPayload: (token: string) => {
		try {
			const part = token.split('.')[1];
			if (!part) return null;
			const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
			return JSON.parse(atob(b64));
		} catch {
			return null;
		}
	},
	extractApiError: (err: any, fallback: string) => ({
		code: err?.response?.data?.code ?? 'UNKNOWN',
		message: err?.response?.data?.message ?? err?.message ?? fallback,
	}),
	usePublicTenantSlugs: () => ({ data: [{ name: 'demo' }] }),
	useAuthStore: {
		getState: () => ({
			setCurrentTenant: vi.fn(),
			setAuth: vi.fn(),
			setUser: vi.fn(),
		}),
	},
}));

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key} ${JSON.stringify(opts)}` : key,
		lang: 'zh-CN',
	}),
}));

const mockVerifyMFAChallenge = vi.fn();
const mockSendMFAChallengeCode = vi.fn();
vi.mock('@/lib/api.generated', () => ({
	verifyMFAChallenge: (...args: any[]) => mockVerifyMFAChallenge(...args),
	sendMFAChallengeCode: (...args: any[]) => mockSendMFAChallengeCode(...args),
}));

import MFAChallengePage from '../mfa-challenge/page';

function b64url(obj: unknown): string {
	return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(expSeconds: number): string {
	return `header.${b64url({ exp: expSeconds, sub: 'test-user-id' })}.sig`;
}

function seedPreAuth(overrides: Record<string, unknown> = {}) {
	sessionStorage.setItem(
		'mfa_pre_auth',
		JSON.stringify({
			challengeToken: makeToken(Math.floor(Date.now() / 1000) + 300),
			tenantId: '',
			riskLevel: '',
			requiredMfaMethods: ['totp', 'sms'],
			phone: '13800138000',
			email: 'user@example.com',
			...overrides,
		}),
	);
}

function renderMFAChallenge() {
	return render(
		<MemoryRouter initialEntries={['/mfa-challenge']}>
			<MFAChallengePage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
});

describe('MFAChallengePage', () => {
	it('redirects to login when no pre-auth session exists', async () => {
		renderMFAChallenge();

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
		});
		expect(screen.getByText('common.loading')).toBeInTheDocument();
	});

	it('shows expired screen for a stale challenge token and clears the session', async () => {
		seedPreAuth({ challengeToken: makeToken(Math.floor(Date.now() / 1000) - 10) });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.sessionExpiredTitle')).toBeInTheDocument();
		});
		expect(sessionStorage.getItem('mfa_pre_auth')).toBeNull();

		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.sessionExpiredAction' }));
		expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
	});

	it('shows expired screen for a malformed challenge token', async () => {
		seedPreAuth({ challengeToken: 'not-a-jwt' });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.sessionExpiredTitle')).toBeInTheDocument();
		});
	});

	it('renders 「App 确认」as the first tab, then the code methods from requiredMfaMethods', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabApp' })).toBeInTheDocument();
		});
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabTOTP' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'mfa.challenge.tabEmail' })).not.toBeInTheDocument();
		// App 确认 + 两个码方法；备用恢复码是 TOTP 的子操作，不占页签
		expect(screen.getAllByRole('tab')).toHaveLength(3);
		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
			'mfa.challenge.tabApp',
			'mfa.challenge.tabTOTP',
			'mfa.challenge.tabSMS',
		]);

		// AUTH2-01：标签条具备完整 tab 语义，当前面板与选中标签关联
		expect(
			screen.getByRole('tablist', { name: 'mfa.challenge.methodLabel' }),
		).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabApp' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'mfa-tab-app');
	});

	it('selects 「App 确认」by default and shows the approval panel (no code form)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'auth.appApproval.start' })).toBeInTheDocument();
		});
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabApp' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		// 码面只在自己的页签里
		expect(document.getElementById('totp-code')).toBeNull();
		expect(screen.queryByPlaceholderText('mfa.challenge.codePlaceholder')).toBeNull();
	});

	it('orders tabs App → authenticator → email when enrolled=[totp,email]', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['totp', 'email'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabApp' })).toBeInTheDocument();
		});
		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
			'mfa.challenge.tabApp',
			'mfa.challenge.tabTOTP',
			'mfa.challenge.tabEmail',
		]);
	});

	it('switches between the approval panel and the authenticator form', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'], enrolledMfaMethods: ['totp', 'sms'] });

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'auth.appApproval.start' })).toBeInTheDocument();
		});

		// 切到「验证器验证码」：码面出现、App 面板消失
		await user.click(screen.getByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		expect(await screen.findByText('mfa.challenge.totpLabel')).toBeInTheDocument();
		expect(document.getElementById('totp-code')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'auth.appApproval.start' })).toBeNull();
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabTOTP' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'mfa-tab-totp');
		// 没点过发起，也不该有审批会话在跑
		expect(screen.queryByTestId('app-approval-code')).toBeNull();

		// 点回「App 确认」：面板重新出现、码面消失
		await user.click(screen.getByRole('tab', { name: 'mfa.challenge.tabApp' }));
		expect(
			await screen.findByRole('button', { name: 'auth.appApproval.start' }),
		).toBeInTheDocument();
		expect(document.getElementById('totp-code')).toBeNull();
	});

	it('falls back to the first code method from the approval panel', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['totp', 'email'] });

		const user = userEvent.setup();
		renderMFAChallenge();

		// 页签式宿主传了 onFallback：面板里有「改用验证码」出口
		await user.click(await screen.findByRole('button', { name: 'auth.appApproval.useCode' }));

		expect(await screen.findByText('mfa.challenge.totpLabel')).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabTOTP' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		expect(screen.queryByRole('button', { name: 'auth.appApproval.start' })).toBeNull();
	});

	it('falls back to all code methods when requiredMfaMethods has no code method', async () => {
		seedPreAuth({ requiredMfaMethods: ['password'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabEmail' })).toBeInTheDocument();
		});
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabTOTP' })).toBeInTheDocument();
		// 三种码方法 + 首位「App 确认」
		expect(screen.getAllByRole('tab')).toHaveLength(4);
	});

	it('uses enrolledMfaMethods over requiredMfaMethods (only enrolled methods shown)', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['totp', 'email'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabTOTP' })).toBeInTheDocument();
		});
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabEmail' })).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'mfa.challenge.tabSMS' })).not.toBeInTheDocument();
		// App 确认 + enrolled 的两个码方法
		expect(screen.getAllByRole('tab')).toHaveLength(3);
	});

	it('keeps 「App 确认」available when only one code method is enrolled', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['email'] });

		renderMFAChallenge();

		// 挑战令牌在场 → 首位仍是「App 确认」；单码方法时标签栏只有 App + 该方法
		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabApp' })).toBeInTheDocument();
		});
		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
			'mfa.challenge.tabApp',
			'mfa.challenge.tabEmail',
		]);
		expect(screen.queryByRole('tab', { name: 'mfa.challenge.tabTOTP' })).not.toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'mfa.challenge.tabSMS' })).not.toBeInTheDocument();
	});

	it('shows risk banner when riskLevel is present', async () => {
		seedPreAuth({ riskLevel: 'medium' });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByTestId('mfa-risk-level-banner')).toBeInTheDocument();
		});
		expect(screen.getByText('mfa.riskLevel.medium')).toBeInTheDocument();
	});

	it('submits TOTP code via verifyMFAChallenge and logs in (AUTH-38)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockResolvedValue({
			accessToken: 'AT',
			refreshToken: 'RT',
			user: { id: 'u1' },
		});

		const user = userEvent.setup();
		renderMFAChallenge();

		// 默认页签是「App 确认」：码面用例先切到验证器页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});

		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '123456');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			const call = mockVerifyMFAChallenge.mock.calls[0][0];
			expect(call.code).toBe('123456');
			expect(call.mfaMethod).toBe('totp');
			expect(typeof call.challengeToken).toBe('string');
			expect(call.challengeToken.split('.')).toHaveLength(3);
		});

		await waitFor(() => {
			expect(mockLoginWithTokens).toHaveBeenCalledWith('AT', 'RT', { id: 'u1' });
			expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
		});
		expect(sessionStorage.getItem('mfa_pre_auth')).toBeNull();
	});

	// U88 同口径：MFA 通过后继续回程（OAuth 授权链不中断）
	it('continues to the post-login redirect target after successful MFA', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockResolvedValue({
			accessToken: 'AT',
			refreshToken: 'RT',
			user: { id: 'u1' },
		});

		const originalLocation = window.location;
		delete (window as any).location;
		(window as any).location = Object.defineProperties(
			{},
			{
				...Object.getOwnPropertyDescriptors(originalLocation),
				origin: { get: () => 'https://auth.autional.cn', configurable: true },
				hostname: { get: () => 'auth.autional.cn', configurable: true },
				href: { value: '', writable: true, configurable: true },
			},
		);
		try {
			const user = userEvent.setup();
			render(
				<MemoryRouter
					initialEntries={['/mfa-challenge?redirect=%2Fplatform%2Fdashboard%3Ftab%3Dsecurity']}
				>
					<MFAChallengePage />
				</MemoryRouter>,
			);

			await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
			await waitFor(() => {
				expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
			});
			await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '123456');
			await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

			await waitFor(() => {
				expect((window as any).location.href).toBe('/platform/dashboard?tab=security');
			});
			expect(mockNavigate).not.toHaveBeenCalledWith('/dashboard');
			expect(sessionStorage.getItem('mfa_pre_auth')).toBeNull();
		} finally {
			Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
		}
	});

	it('ignores an invalid redirect and falls back to dashboard', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockResolvedValue({
			accessToken: 'AT',
			refreshToken: 'RT',
			user: { id: 'u1' },
		});

		const user = userEvent.setup();
		render(
			<MemoryRouter initialEntries={['/mfa-challenge?redirect=%2F%2Fevil.example']}>
				<MFAChallengePage />
			</MemoryRouter>,
		);

		// 默认页签是「App 确认」：码面用例先切到验证器页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});
		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '123456');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
		});
	});

	it('submits backup code with explicit backup method from the authenticator panel (AUTH-38)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1' } });

		const user = userEvent.setup();
		renderMFAChallenge();

		// 备用恢复码是验证器页签内的次级操作：先切到该页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'mfa.challenge.useBackup' })).toBeInTheDocument();
		});

		await user.click(screen.getByRole('button', { name: 'mfa.challenge.useBackup' }));
		await user.type(screen.getByPlaceholderText('mfa.challenge.backupPlaceholder'), 'ABCDEFGH');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(mockVerifyMFAChallenge).toHaveBeenCalledWith(
				expect.objectContaining({ code: 'ABCDEFGH', mfaMethod: 'backup' }),
			);
		});
	});

	it('does not offer backup codes when TOTP is not enrolled', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['email'] });

		const user = userEvent.setup();
		renderMFAChallenge();

		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabEmail' }));
		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.emailLabel')).toBeInTheDocument();
		});
		expect(screen.queryByRole('button', { name: 'mfa.challenge.useBackup' })).not.toBeInTheDocument();
	});

	it('shows a manual-send hint on the SMS tab until the code is sent', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'], phone: '13800138000' });
		mockSendMFAChallengeCode.mockResolvedValue({ sent: true });

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		});

		await user.click(screen.getByRole('tab', { name: 'mfa.challenge.tabSMS' }));

		const before = await screen.findByText((content) =>
			content.startsWith('mfa.challenge.smsWillSend'),
		);
		expect(before.textContent).toContain('138****8000');
		expect(
			screen.queryByText((content) => content.startsWith('mfa.challenge.smsDelivered')),
		).toBeNull();

		await user.click(screen.getByRole('button', { name: 'mfa.challenge.sendCode' }));

		const after = await screen.findByText((content) =>
			content.startsWith('mfa.challenge.smsDelivered'),
		);
		expect(after.textContent).toContain('138****8000');
	});

	it('switches to expired screen on 403 challenge-required (server revalidation)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockRejectedValue({
			response: { status: 403, data: { code: 61000403, message: 'MFA challenge required' } },
		});

		const user = userEvent.setup();
		renderMFAChallenge();

		// 默认页签是「App 确认」：码面用例先切到验证器页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});

		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '123456');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.sessionExpiredTitle')).toBeInTheDocument();
		});
		expect(sessionStorage.getItem('mfa_pre_auth')).toBeNull();
	});

	it('shows already-completed screen on 61000404 (challenge used)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockRejectedValue({
			response: {
				status: 403,
				data: { code: 61000404, message: 'challenge token already used' },
			},
		});

		const user = userEvent.setup();
		renderMFAChallenge();

		// 默认页签是「App 确认」：码面用例先切到验证器页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});

		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '123456');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.sessionUsedTitle')).toBeInTheDocument();
		});
		expect(screen.queryByText('mfa.challenge.sessionExpiredTitle')).toBeNull();
	});

	it('shows inline invalid-code error on 61000402 and stays on the form', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockRejectedValue({
			response: { status: 400, data: { code: 61000402, message: 'invalid MFA code' } },
		});

		const user = userEvent.setup();
		renderMFAChallenge();

		// 默认页签是「App 确认」：码面用例先切到验证器页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});

		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '000000');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.verifyFailed')).toBeInTheDocument();
		});
		// AUTH2-02：错误条是 live region（读屏可播报）
		expect(screen.getByRole('alert')).toHaveTextContent('mfa.challenge.verifyFailed');
		expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
	});

	it('sends an SMS code from the challenge page and starts the resend cooldown', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'] });
		mockSendMFAChallengeCode.mockResolvedValue({ sent: true });

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		});
		await user.click(screen.getByRole('tab', { name: 'mfa.challenge.tabSMS' }));
		await user.click(await screen.findByRole('button', { name: 'mfa.challenge.sendCode' }));

		await waitFor(() => {
			expect(mockSendMFAChallengeCode).toHaveBeenCalledWith(
				expect.objectContaining({ mfaMethod: 'sms' }),
			);
		});
		const call = mockSendMFAChallengeCode.mock.calls[0][0];
		expect(call.challengeToken.split('.')).toHaveLength(3);

		// 发送成功后按钮切换为倒计时并禁用（与后端 60s 窗口一致）
		await waitFor(() => {
			const cooldown = screen.getByRole('button', { name: /common\.resendCountdown/ });
			expect(cooldown).toBeDisabled();
		});
		// AUTH2-02：发送结果经 polite live region 播报
		expect(screen.getByRole('status')).toHaveTextContent('mfa.challenge.codeSentLive');
	});

	it('sends an email code from the challenge page', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['email'] });
		mockSendMFAChallengeCode.mockResolvedValue({ sent: true });

		const user = userEvent.setup();
		renderMFAChallenge();

		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabEmail' }));
		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.emailLabel')).toBeInTheDocument();
		});
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.sendCode' }));

		await waitFor(() => {
			expect(mockSendMFAChallengeCode).toHaveBeenCalledWith(
				expect.objectContaining({ mfaMethod: 'email' }),
			);
		});
	});

	it('does not render a send button for TOTP-only challenges', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });

		const user = userEvent.setup();
		renderMFAChallenge();

		// 默认页签是「App 确认」：码面用例先切到验证器页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});
		expect(screen.queryByRole('button', { name: 'mfa.challenge.sendCode' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'mfa.challenge.resend' })).not.toBeInTheDocument();
	});

	it('shows send failure error when the code delivery request fails', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'] });
		mockSendMFAChallengeCode.mockRejectedValue({
			response: { status: 500, data: { code: 500, message: 'boom' } },
		});

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('tab', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		});
		await user.click(screen.getByRole('tab', { name: 'mfa.challenge.tabSMS' }));
		await user.click(await screen.findByRole('button', { name: 'mfa.challenge.sendCode' }));

		await waitFor(() => {
			expect(screen.getByText('boom')).toBeInTheDocument();
		});
	});

	it('shows rate-limited error on 429', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockRejectedValue({
			response: { status: 429, data: { code: 429, message: 'too many requests' } },
		});

		const user = userEvent.setup();
		renderMFAChallenge();

		// 默认页签是「App 确认」：码面用例先切到验证器页签
		await user.click(await screen.findByRole('tab', { name: 'mfa.challenge.tabTOTP' }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});

		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '123456');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.throttled')).toBeInTheDocument();
		});
	});
});
