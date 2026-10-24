import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import ForgotPasswordPage from '../forgot-password/page';

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, opts?: any) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
		i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: any) => children,
}));

vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		Link: ({ to, children }: any) => <a href={to}>{children}</a>,
	};
});

const mockAuthForgotPasswordPost = vi.fn();

vi.mock('@autional/shared/generated/api', () => ({
	authForgotPasswordPost: (...args: any[]) => mockAuthForgotPasswordPost(...args),
}));

const mockUseTenantAuthConfigBySlug = vi.fn();
vi.mock('@/hooks/use-tenant-auth-config', () => ({
	useTenantAuthConfigBySlug: (...args: any[]) => mockUseTenantAuthConfigBySlug(...args),
}));

function renderForgotPassword() {
	return render(
		<MemoryRouter initialEntries={['/forgot-password']}>
			<ForgotPasswordPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	mockUseTenantAuthConfigBySlug.mockReturnValue({ data: null, isLoading: false });
});

describe('ForgotPasswordPage', () => {
	it('renders forgot password form with email input', () => {
		renderForgotPassword();
		expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'forgot.submit' })).toBeInTheDocument();
	});

	it('shows success message on submit', async () => {
		mockAuthForgotPasswordPost.mockResolvedValue({});
		renderForgotPassword();
		fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
			target: { value: 'test@example.com' },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'forgot.submit' }));
		});
		expect(await screen.findByText('forgot.sentHintEmail')).toBeInTheDocument();
	});

	it('shows success even when server responds with error (anti-enumeration)', async () => {
		mockAuthForgotPasswordPost.mockRejectedValue({
			isAxiosError: true,
			response: { data: { message: 'User not found' } },
		});
		renderForgotPassword();
		fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
			target: { value: 'unknown@example.com' },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'forgot.submit' }));
		});
		expect(await screen.findByText('forgot.sentHintEmail')).toBeInTheDocument();
	});

	it('shows countdown resend button after success', async () => {
		mockAuthForgotPasswordPost.mockResolvedValue({});
		renderForgotPassword();
		fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
			target: { value: 'test@example.com' },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'forgot.submit' }));
		});
		expect(await screen.findByText(/flat\.common\.resendCountdown/)).toBeInTheDocument();
	});

	it('resend after countdown re-sends with retained identity (AUTH-52 ④)', async () => {
		vi.useFakeTimers();
		try {
			mockAuthForgotPasswordPost.mockResolvedValue({});
			renderForgotPassword();
			fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
				target: { value: 'test@example.com' },
			});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'forgot.submit' }));
			});
			expect(mockAuthForgotPasswordPost).toHaveBeenCalledTimes(1);

			// 推进冷却至归零，「重新发送」恢复可用
			await act(async () => {
				vi.advanceTimersByTime(60000);
			});
			const resendBtn = screen.getByRole('button', { name: 'forgot.resend' });

			// 修复点：点击必须再次发起真实请求（此前仅表单复位、零网络请求）
			await act(async () => {
				fireEvent.click(resendBtn);
			});
			expect(mockAuthForgotPasswordPost).toHaveBeenCalledTimes(2);
			expect(mockAuthForgotPasswordPost).toHaveBeenLastCalledWith({ identity: 'test@example.com' });
			// 重发成功 → 冷却重启
			expect(screen.getByText(/flat\.common\.resendCountdown/)).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows validation error for empty email', async () => {
		renderForgotPassword();
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'forgot.submit' }));
		});
		expect(screen.getByText('validation.identityRequired')).toBeInTheDocument();
	});

	// WS-G AC-G4（AUTH-01）：slug 页面的找回请求带租户，并留存 reset_password_tenant_id
	// 供根路由 /reset-password 使用（R3 m-10）。
	it('AC-G4: slug 页面提交携带租户并留存租户键', async () => {
		mockAuthForgotPasswordPost.mockResolvedValue({});
		mockUseTenantAuthConfigBySlug.mockReturnValue({
			data: { tenantId: 't-acme' },
			isLoading: false,
		});
		render(
			<MemoryRouter initialEntries={['/acme/forgot-password']}>
				<Routes>
					<Route path="/:tenantSlug/forgot-password" element={<ForgotPasswordPage />} />
				</Routes>
			</MemoryRouter>,
		);
		fireEvent.change(screen.getByPlaceholderText('email@example.com'), {
			target: { value: 'test@example.com' },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'forgot.submit' }));
		});

		expect(mockAuthForgotPasswordPost).toHaveBeenCalledWith({
			identity: 'test@example.com',
			tenantId: 't-acme',
		});
		expect(sessionStorage.getItem('reset_password_identity')).toBe('test@example.com');
		expect(sessionStorage.getItem('reset_password_tenant_id')).toBe('t-acme');
	});
});
