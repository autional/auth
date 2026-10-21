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

	it('renders tabs derived from requiredMfaMethods (backup alongside totp, no email)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'mfa.challenge.tabTOTP' })).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'mfa.challenge.tabBackup' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'mfa.challenge.tabEmail' })).not.toBeInTheDocument();
	});

	it('falls back to all code methods when requiredMfaMethods has no code method', async () => {
		seedPreAuth({ requiredMfaMethods: ['password'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'mfa.challenge.tabEmail' })).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: 'mfa.challenge.tabTOTP' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'mfa.challenge.tabBackup' })).toBeInTheDocument();
	});

	it('uses enrolledMfaMethods over requiredMfaMethods (only enrolled methods shown)', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['totp', 'email'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'mfa.challenge.tabTOTP' })).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: 'mfa.challenge.tabEmail' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'mfa.challenge.tabBackup' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'mfa.challenge.tabSMS' })).not.toBeInTheDocument();
	});

	it('shows a single enrolled method without a tab strip', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['email'] });

		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.emailLabel')).toBeInTheDocument();
		});
		expect(screen.queryByRole('button', { name: 'mfa.challenge.tabTOTP' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'mfa.challenge.tabSMS' })).not.toBeInTheDocument();
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

	it('submits backup code with explicit backup method (no totp collapse, AUTH-38)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1' } });

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'mfa.challenge.tabBackup' })).toBeInTheDocument();
		});

		await user.click(screen.getByRole('button', { name: 'mfa.challenge.tabBackup' }));
		await user.type(screen.getByPlaceholderText('mfa.challenge.backupPlaceholder'), 'ABCDEFGH');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(mockVerifyMFAChallenge).toHaveBeenCalledWith(
				expect.objectContaining({ code: 'ABCDEFGH', mfaMethod: 'backup' }),
			);
		});
	});

	it('shows masked sms delivery hint on the SMS tab', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'], phone: '13800138000' });

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		});

		await user.click(screen.getByRole('button', { name: 'mfa.challenge.tabSMS' }));

		const hint = await screen.findByText((content) =>
			content.startsWith('mfa.challenge.smsDelivered'),
		);
		expect(hint.textContent).toContain('138****8000');
	});

	it('switches to expired screen on 403 challenge-required (server revalidation)', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockRejectedValue({
			response: { status: 403, data: { code: 61000403, message: 'MFA challenge required' } },
		});

		const user = userEvent.setup();
		renderMFAChallenge();

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

	it('shows inline invalid-code error on 61000402 and stays on the form', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp'] });
		mockVerifyMFAChallenge.mockRejectedValue({
			response: { status: 400, data: { code: 61000402, message: 'invalid MFA code' } },
		});

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});

		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '000000');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.verifyFailed')).toBeInTheDocument();
		});
		expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
	});

	it('sends an SMS code from the challenge page and starts the resend cooldown', async () => {
		seedPreAuth({ requiredMfaMethods: ['totp', 'sms'] });
		mockSendMFAChallengeCode.mockResolvedValue({ sent: true });

		const user = userEvent.setup();
		renderMFAChallenge();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		});
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.tabSMS' }));
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
	});

	it('sends an email code from the challenge page', async () => {
		seedPreAuth({ requiredMfaMethods: [], enrolledMfaMethods: ['email'] });
		mockSendMFAChallengeCode.mockResolvedValue({ sent: true });

		const user = userEvent.setup();
		renderMFAChallenge();

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

		renderMFAChallenge();

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
			expect(screen.getByRole('button', { name: 'mfa.challenge.tabSMS' })).toBeInTheDocument();
		});
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.tabSMS' }));
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

		await waitFor(() => {
			expect(screen.getByPlaceholderText('mfa.challenge.codePlaceholder')).toBeInTheDocument();
		});

		await user.type(screen.getByPlaceholderText('mfa.challenge.codePlaceholder'), '123456');
		await user.click(screen.getByRole('button', { name: 'mfa.challenge.verify' }));

		await waitFor(() => {
			expect(screen.getByText('mfa.challenge.rateLimited')).toBeInTheDocument();
		});
	});
});
