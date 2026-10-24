import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import VerifyEmailPage from '../verify-email/page';

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, opts?: any) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
		i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: any) => children,
}));

const mockNavigate = vi.fn();
// AUTH-23: 邮件链接形状 = ?email=...&code=...（旧测试按 token 参数编码了错误契约）
let mockParams: Record<string, string> = {};

vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
		useSearchParams: () => [{ get: (k: string) => mockParams[k] ?? null }, vi.fn()],
		Link: ({ to, children }: any) => <a href={to}>{children}</a>,
	};
});

const mockAuthVerifyEmailPost = vi.fn();
const mockAuthResendVerificationEmailPost = vi.fn();

vi.mock('@autional/shared/generated/api', () => ({
	authVerifyEmailPost: (...args: any[]) => mockAuthVerifyEmailPost(...args),
	authResendVerificationEmailPost: (...args: any[]) => mockAuthResendVerificationEmailPost(...args),
}));

const mockUseTenantAuthConfigBySlug = vi.fn();
vi.mock('@/hooks/use-tenant-auth-config', () => ({
	useTenantAuthConfigBySlug: (...args: any[]) => mockUseTenantAuthConfigBySlug(...args),
}));

function renderVerifyEmail() {
	return render(
		<MemoryRouter initialEntries={['/verify-email']}>
			<VerifyEmailPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockParams = {};
	mockUseTenantAuthConfigBySlug.mockReturnValue({ data: null, isLoading: false });
	mockAuthVerifyEmailPost.mockReset();
	mockAuthResendVerificationEmailPost.mockReset();
});

describe('VerifyEmailPage', () => {
	it('shows error and resend form when email/code params are missing', () => {
		renderVerifyEmail();

		expect(screen.getByText('auth.verifyEmail.invalidToken')).toBeInTheDocument();
		expect(screen.getByPlaceholderText('auth.verifyEmail.emailPlaceholder')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'auth.verifyEmail.resend' })).toBeInTheDocument();
	});

	it('auto-verifies with email+code from the link and shows verifying state', async () => {
		let resolveVerify: (value: unknown) => void;
		mockAuthVerifyEmailPost.mockReturnValue(
			new Promise((resolve) => {
				resolveVerify = resolve;
			}),
		);
		mockParams = { email: 'user@example.com', code: '123456', tenant_id: 't-acme' };
		renderVerifyEmail();

		expect(screen.getByText('auth.verifyEmail.verifying')).toBeInTheDocument();
		expect(mockAuthVerifyEmailPost).toHaveBeenCalledWith({
			email: 'user@example.com',
			code: '123456',
			tenantId: 't-acme',
		});

		await act(async () => {
			resolveVerify({});
		});
	});

	it('shows success state when verification succeeds', async () => {
		mockAuthVerifyEmailPost.mockResolvedValue({});
		mockParams = { email: 'user@example.com', code: '123456', tenant_id: 't-acme' };
		renderVerifyEmail();

		await waitFor(() => {
			expect(screen.getByText('auth.verifyEmail.successMessage')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: 'auth.common.goToLogin' })).toBeInTheDocument();
	});

	it('shows error and resend form when code is invalid (not already-verified)', async () => {
		mockAuthVerifyEmailPost.mockRejectedValue({
			response: { data: { message: 'expired token' } },
		});
		mockParams = { email: 'user@example.com', code: 'bad-code', tenant_id: 't-acme' };
		renderVerifyEmail();

		await waitFor(() => {
			expect(screen.getByPlaceholderText('auth.verifyEmail.emailPlaceholder')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: 'auth.verifyEmail.resend' })).toBeInTheDocument();
	});

	it('submits resend form and triggers API call', async () => {
		mockAuthResendVerificationEmailPost.mockResolvedValue({});
		const user = userEvent.setup();
		renderVerifyEmail();

		await user.type(
			screen.getByPlaceholderText('auth.verifyEmail.emailPlaceholder'),
			'test@example.com',
		);
		await user.click(screen.getByRole('button', { name: 'auth.verifyEmail.resend' }));

		await waitFor(() => {
			expect(mockAuthResendVerificationEmailPost).toHaveBeenCalledWith({
				email: 'test@example.com',
			});
		});
		expect(screen.getByText('auth.verifyEmail.resendSuccess')).toBeInTheDocument();
	});

	// AUTH-24 回归锁：验证码一次性消费，效果重跑（依赖不稳定/StrictMode 双调用）
	// 不得产生第二个 POST —— 否则后续 400 会给已成功的验证覆盖出「失败」界面。
	it('AUTH-24: 成功路径只发一次 verify POST（状态更新重渲染不重发）', async () => {
		mockAuthVerifyEmailPost.mockResolvedValue({});
		mockParams = { email: 'user@example.com', code: 'once-ok', tenant_id: 't-acme' };
		renderVerifyEmail();

		await waitFor(() => {
			expect(screen.getByText('auth.verifyEmail.successMessage')).toBeInTheDocument();
		});
		expect(mockAuthVerifyEmailPost).toHaveBeenCalledTimes(1);
	});

	it('AUTH-24: 失败路径也只发一次 verify POST（重跑不得覆盖结果）', async () => {
		mockAuthVerifyEmailPost.mockRejectedValue({
			response: { data: { message: 'verification code not found' } },
		});
		mockParams = { email: 'user@example.com', code: 'once-bad', tenant_id: 't-acme' };
		renderVerifyEmail();

		await waitFor(() => {
			expect(screen.getByPlaceholderText('auth.verifyEmail.emailPlaceholder')).toBeInTheDocument();
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(mockAuthVerifyEmailPost).toHaveBeenCalledTimes(1);
	});

	// WS-G（AUTH-04）：链接缺租户且 slug 配置无值 → 无效链接，不发无租户请求。
	it('AC-G4: 缺租户时不发验证请求并提示链接无效', async () => {
		mockParams = { email: 'user@example.com', code: '123456' };
		renderVerifyEmail();

		expect(await screen.findByText('error.tenant_required')).toBeInTheDocument();
		expect(mockAuthVerifyEmailPost).not.toHaveBeenCalled();
	});

	it('AUTH-24: 重发 429 显示限流专属文案（不再落通用「发送失败」）', async () => {
		mockAuthResendVerificationEmailPost.mockRejectedValue({
			response: { status: 429, data: {} },
		});
		const user = userEvent.setup();
		renderVerifyEmail();

		await user.type(
			screen.getByPlaceholderText('auth.verifyEmail.emailPlaceholder'),
			'test@example.com',
		);
		await user.click(screen.getByRole('button', { name: 'auth.verifyEmail.resend' }));

		await waitFor(() => {
			expect(screen.getByText('auth.verifyEmail.resendTooFrequent')).toBeInTheDocument();
		});
	});
});
