import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from '../page';

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
		Link: ({ to, children }: any) => <a href={to}>{children}</a>,
	};
});

const mockLoginWithTokens = vi.fn();
const mockGetAccessToken = vi.fn(() => null);

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	loginWithTokens: (...args: any[]) => mockLoginWithTokens(...args),
	getAccessToken: () => mockGetAccessToken(),
	bffLogin: vi.fn(() => Promise.resolve({ code: 1, message: 'BFF unavailable' })),
	isBFFAvailable: () => false,
	useAuthStore: {
		getState: () => ({
			setAuth: vi.fn(),
			setCurrentTenant: vi.fn(),
			setPermissions: vi.fn(),
			setTenants: vi.fn(),
		}),
	},
	apiClient: { get: vi.fn(() => Promise.resolve({ data: { items: [] } })) },
	isValidRedirect: () => false,
	processPasswordForTransmission: async (password: string, mode?: string) => ({
		password,
		passwordTransmission: mode || 'plain',
	}),
	// AUTH-09 登录页页脚合规链：crossAppUrl ∘ TRUST_CENTER_URL 在渲染期被访问
	crossAppUrl: (base: string, path?: string) => base + (path || ''),
	TRUST_CENTER_URL: () => 'https://trust.autional.cn',
}));

const mockAuthLoginPost = vi.fn();
const mockAuthOauthProviders = vi.fn((_opts?: any) => Promise.resolve({ providers: [] }));
const mockWebauthnBegin = vi.fn();
const mockWebauthnComplete = vi.fn();

vi.mock('@autional/shared/generated/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared/generated/api')>();
	return {
		...actual,
		authLoginPost: (...args: any[]) => mockAuthLoginPost(...args),
		authOauthProviders: (...args: any[]) => mockAuthOauthProviders(...args),
		authWebauthnAuthenticateBeginPost: (...args: any[]) => mockWebauthnBegin(...args),
		authWebauthnAuthenticateCompletePost: (...args: any[]) => mockWebauthnComplete(...args),
	};
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderLogin() {
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={['/acme-corp/login']}>
				<LoginPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

vi.mock('@/lib/api', () => ({
	loadAuthExtras: vi.fn(() => Promise.resolve()),
}));

let mockLoginMethods: string[] | undefined;

vi.mock('@/hooks/use-auth-page-init', () => ({
	useAuthPageInit: () => ({
		authConfig: {
			data: { tenantId: 't-test', loginMethods: mockLoginMethods },
			isLoading: false,
			isError: false,
		},
		publicTenants: { data: [], isLoading: false, isError: false },
		oauthProviders: { data: [], isLoading: false, isError: false },
		branding: { data: null, isLoading: false, isError: false },
		isLoading: false,
		isError: false,
	}),
}));

vi.mock('@/hooks/use-tenant-auth-config', () => ({
	useTenantAuthConfig: () => ({ data: { tenantId: 't-test' }, isLoading: false }),
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockGetAccessToken.mockReturnValue(null);
	mockLoginMethods = undefined;
});

afterEach(() => {
	delete (window as any).PublicKeyCredential;
	delete (navigator as any).credentials;
});

describe('LoginPage', () => {
	it('renders identity input, password input, and login button', () => {
		renderLogin();
		expect(screen.getByPlaceholderText('auth.login.identityPlaceholder')).toBeInTheDocument();
		expect(screen.getByPlaceholderText('auth.login.passwordPlaceholder')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'login.submit' })).toBeInTheDocument();
	});

	it('shows validation error when submitting empty form', async () => {
		renderLogin();
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'login.submit' }));
		});
		expect(screen.getByText('validation.identityRequired')).toBeInTheDocument();
	});

	it('shows error message on API failure', async () => {
		mockAuthLoginPost.mockRejectedValue({
			response: { data: { code: '40000001', message: '用户名或密码错误' } },
		});
		const user = userEvent.setup();
		renderLogin();
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'testuser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'wrongpass');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		await waitFor(() => {
			expect(screen.getByText('login.error.credentials')).toBeInTheDocument();
		});
	});

	it('navigates on successful login', async () => {
		mockAuthLoginPost.mockResolvedValue({
			accessToken: 'token-abc',
			refreshToken: 'refresh-abc',
			user: { id: '1', username: 'test', email: 'test@example.com' },
			riskAssessment: {},
		});
		const user = userEvent.setup();
		renderLogin();
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'testuser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'pass123');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		await waitFor(() => {
			expect(mockLoginWithTokens).toHaveBeenCalled();
		});
		expect(screen.queryByText('login.error.credentials')).toBeNull();
	});
});

describe('LoginPage - passkey 入口', () => {
	function enablePasskeySupport(conditional: boolean) {
		Object.defineProperty(window, 'PublicKeyCredential', {
			value: Object.assign(function () {}, {
				isConditionalMediationAvailable: vi.fn(async () => conditional),
			}),
			configurable: true,
		});
		Object.defineProperty(navigator, 'credentials', {
			value: { get: vi.fn(async () => null) },
			configurable: true,
		});
	}

	it('密码页不渲染可见 passkey 按钮；切到 passkey 标签后仅一个', async () => {
		mockLoginMethods = ['password', 'passkey'];
		enablePasskeySupport(false);
		mockWebauthnBegin.mockResolvedValue({
			publicKey: { challenge: 'Y2hhbGxlbmdl', allowCredentials: [] },
		});

		renderLogin();

		expect(screen.queryByTestId('passkey-submit-button')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'passkey.submitLogin' }));

		await waitFor(() => {
			expect(screen.getAllByTestId('passkey-submit-button')).toHaveLength(1);
		});
	});

	it('切到 passkey 标签时 abort 密码页的条件式请求', async () => {
		mockLoginMethods = ['password', 'passkey'];
		enablePasskeySupport(true);
		mockWebauthnBegin.mockResolvedValue({
			publicKey: { challenge: 'Y2hhbGxlbmdl', allowCredentials: [] },
		});

		let conditionalOpts: any;
		(navigator.credentials.get as any).mockImplementation((opts: any) => {
			if (opts.mediation === 'conditional') {
				conditionalOpts = opts;
				return new Promise((_resolve, reject) => {
					opts.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError')),
					);
				});
			}
			return Promise.resolve(null);
		});

		renderLogin();
		await waitFor(() => expect(conditionalOpts).toBeTruthy());

		fireEvent.click(screen.getByRole('button', { name: 'passkey.submitLogin' }));

		await waitFor(() => expect(conditionalOpts.signal.aborted).toBe(true));
	});
});
