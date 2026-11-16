import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { snakeCaseKeys } from '@autional/shared';
import LoginPage from '../page';

// 模拟真实 i18next（keySeparator=false）：已登记键命中返回键名；带 defaultValue 且未命中
// 返回默认值（useI18n 的 flat./无前缀两级回落依赖此语义）；其余沿用旧口径。
vi.mock('react-i18next', () => {
	const knownKeys = new Set(['error.membership_pending']);
	return {
		useTranslation: () => ({
			t: (key: string, opts?: any) => {
				const rawKey = key.startsWith('flat.') ? key.slice(5) : key;
				if (knownKeys.has(rawKey)) return rawKey;
				if (typeof opts === 'string') return opts;
				if (opts && typeof opts === 'object' && 'defaultValue' in opts) return opts.defaultValue;
				return opts ? `${key} ${JSON.stringify(opts)}` : key;
			},
			i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
		}),
		I18nextProvider: ({ children }: any) => children,
	};
});

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
const mockIsValidRedirect = vi.fn((_url: string) => false);

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
	isValidRedirect: (url: string) => mockIsValidRedirect(url),
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

// 带 slug 路由的渲染（useParams 生效）；用于验证 slug 解析失败时的页面形态。
function renderLoginWithSlug() {
	return renderLoginWithSlugAt('/acme-corp/login');
}

// 指定初始路由（含 query）的 slug 渲染：登录页 redirect 查询参数由 MemoryRouter 提供，
// 而 fragment（票据）来自真实 window.location，两者互不干扰。
function renderLoginWithSlugAt(path: string) {
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path=":tenantSlug/login" element={<LoginPage />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

vi.mock('@/lib/api', () => ({
	loadAuthExtras: vi.fn(() => Promise.resolve()),
}));

let mockLoginMethods: string[] | undefined;
let mockOAuthProviders: any[] = [];
let mockConfigTenantId: string | undefined = 't-test';
let mockDeviceFingerprintEnabled = false;
let mockPasskeyEnabled: boolean | undefined;

// 设备指纹模块：默认关闭（与租户策略默认 false 一致）；用例可开门控并断言登录体。
const mockComputeDeviceFingerprint = vi.fn(async () => 'dfp_0123456789abcdef');
vi.mock('@/lib/device-fingerprint', () => ({
	isDeviceFingerprintEnabled: (cfg?: { deviceFingerprintEnabled?: boolean }) =>
		cfg?.deviceFingerprintEnabled ?? false,
	computeDeviceFingerprint: () => mockComputeDeviceFingerprint(),
}));

vi.mock('@/hooks/use-auth-page-init', () => ({
	useAuthPageInit: () => ({
		authConfig: {
			data: {
				tenantId: mockConfigTenantId,
				loginMethods: mockLoginMethods,
				deviceFingerprintEnabled: mockDeviceFingerprintEnabled,
				passkeyEnabled: mockPasskeyEnabled,
			},
			isLoading: false,
			isError: false,
		},
		publicTenants: { data: [], isLoading: false, isError: false },
		oauthProviders: { data: mockOAuthProviders, isLoading: false, isError: false },
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
	mockIsValidRedirect.mockReturnValue(false);
	mockLoginMethods = undefined;
	mockOAuthProviders = [];
	mockConfigTenantId = 't-test';
	mockDeviceFingerprintEnabled = false;
	mockPasskeyEnabled = undefined;
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

	// 多域回调：发起页 Origin 必须随跳转携带，后端据此选择同站已登记回调（RFC 9700 §4.1.3）。
	it('starts OAuth with callback_origin of the current site', async () => {
		mockOAuthProviders = [{ id: 'prov-github', type: 'github', name: 'GitHub' }];
		const assignMock = vi.fn();
		const originalLocation = window.location;
		delete (window as any).location;
		(window as any).location = Object.defineProperties(
			{},
			{
				...Object.getOwnPropertyDescriptors(originalLocation),
				origin: { get: () => 'https://auth.autional.com', configurable: true },
				assign: { value: assignMock, configurable: true },
			},
		);
		try {
			const user = userEvent.setup();
			renderLogin();
			await user.click(await screen.findByRole('button', { name: 'GitHub' }));

			expect(assignMock).toHaveBeenCalledWith(
				expect.stringContaining('callback_origin=https%3A%2F%2Fauth.autional.com'),
			);
			// 地址栏（slug 配置）租户必须随发起 URL 显式携带，回跳页不再依赖残留 header。
			expect(assignMock).toHaveBeenCalledWith(
				expect.stringContaining('tenant_id=t-test'),
			);
		} finally {
			Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
		}
	});

	// slug 页配置未解析出 tenantId → fail-closed：页面只渲染租户选择，不暴露 OAuth 入口，
	// 也就不会用 localStorage 残留租户发起登录。
	it('slug 租户未解析时不暴露 OAuth 入口', async () => {
		mockConfigTenantId = undefined;
		mockOAuthProviders = [{ id: 'prov-github', type: 'github', name: 'GitHub' }];
		renderLoginWithSlug();

		await waitFor(() => {
			expect(screen.getByText('login.tenantNotFound')).toBeInTheDocument();
		});
		expect(screen.queryByRole('button', { name: 'GitHub' })).not.toBeInTheDocument();
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

	// WS-G G4（AUTH-02）：待审批用户密码登录 → 403 i18n_key → 本地化提示，不建会话。
	it('AC-G2: pending membership login shows the pending hint and creates no session', async () => {
		mockAuthLoginPost.mockRejectedValue({
			response: {
				status: 403,
				data: {
					code: 61000003,
					title: 'membership pending approval',
					i18n_key: 'error.membership_pending',
				},
			},
		});
		const user = userEvent.setup();
		renderLogin();
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'pendinguser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'pass123');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		await waitFor(() => {
			expect(screen.getByText('error.membership_pending')).toBeInTheDocument();
		});
		expect(mockLoginWithTokens).not.toHaveBeenCalled();
		expect(screen.queryByText('login.error.credentials')).toBeNull();
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

	// P1：device_fingerprint_enabled 打开时，登录体必须带 dfp_ 指纹（identity 用它
	// 做「可信设备」匹配；axios 拦截器统一 camel→snake）。
	it('设备指纹开启时登录体携带 deviceFingerprint', async () => {
		mockDeviceFingerprintEnabled = true;
		mockAuthLoginPost.mockResolvedValue({
			accessToken: 'token-abc',
			refreshToken: 'refresh-abc',
			user: { id: '1' },
		});
		const user = userEvent.setup();
		renderLogin();
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'testuser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'pass123');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		await waitFor(() => {
			expect(mockAuthLoginPost).toHaveBeenCalled();
		});
		expect(mockAuthLoginPost.mock.calls[0][0]).toMatchObject({
			deviceFingerprint: 'dfp_0123456789abcdef',
		});
	});

	// 门控默认关闭：不上报指纹（与租户策略默认 false 一致，避免新增采集面）。
	it('设备指纹关闭时登录体不带 deviceFingerprint', async () => {
		mockDeviceFingerprintEnabled = false;
		mockAuthLoginPost.mockResolvedValue({
			accessToken: 'token-abc',
			refreshToken: 'refresh-abc',
			user: { id: '1' },
		});
		const user = userEvent.setup();
		renderLogin();
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'testuser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'pass123');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		await waitFor(() => {
			expect(mockAuthLoginPost).toHaveBeenCalled();
		});
		expect(mockAuthLoginPost.mock.calls[0][0]).not.toHaveProperty('deviceFingerprint');
		expect(mockComputeDeviceFingerprint).not.toHaveBeenCalled();
	});

	// 4247b59 的 enrolled 过滤只在挑战页消费；登录页不转发则派生永远走 required 回落，
	// 用户会看到未开通的方法。本用例锁 login → mfa_pre_auth 的 wiring。
	it('MFA 登录把 enrolled_mfa_methods 写进挑战会话', async () => {
		mockAuthLoginPost.mockResolvedValue({
			requiresMfa: true,
			challengeToken: 'ct-abc',
			requiredMfaMethods: ['totp', 'sms', 'email'],
			enrolledMfaMethods: ['email'],
			user: { email: 'u***@example.com' },
		});
		const user = userEvent.setup();
		renderLogin();
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'testuser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'pass123');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		// 用例在 Route 外直挂组件，useParams 无 slug（渲染为 /null/…），此处只锁落点
		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/mfa-challenge'));
		});
		const preAuth = JSON.parse(sessionStorage.getItem('mfa_pre_auth') || '{}');
		expect(preAuth.challengeToken).toBe('ct-abc');
		expect(preAuth.enrolledMfaMethods).toEqual(['email']);
		expect(preAuth.requiredMfaMethods).toEqual(['totp', 'sms', 'email']);
		sessionStorage.removeItem('mfa_pre_auth');
	});

	// U88 同口径：MFA 挑战页必须拿到回程目标，认证完成后才能续回 OAuth 发起方
	it('forwards the redirect target to the MFA challenge URL', async () => {
		mockIsValidRedirect.mockReturnValue(true);
		mockAuthLoginPost.mockResolvedValue({
			requiresMfa: true,
			challengeToken: 'header.payload.sig',
		});
		const user = userEvent.setup();
		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter initialEntries={['/acme-corp/login?redirect=%2Fplatform%2Fdashboard']}>
					<Routes>
						<Route path=":tenantSlug/login" element={<LoginPage />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'testuser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'pass123');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				'/acme-corp/mfa-challenge?redirect=%2Fplatform%2Fdashboard',
			);
		});
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

		fireEvent.click(screen.getByRole('button', { name: 'auth.login.passkeyTab' }));

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

		// 条件式 begin 必须携带 slug（地址栏）租户，而非 localStorage 残留租户
		expect(mockWebauthnBegin).toHaveBeenCalledWith(
			expect.objectContaining({ tenantId: 't-test', mediation: 'conditional' }),
		);

		fireEvent.click(screen.getByRole('button', { name: 'auth.login.passkeyTab' }));

		await waitFor(() => expect(conditionalOpts.signal.aborted).toBe(true));
	});

	// ============================================================
	// B3：passkey 已是第一步认证
	//   · 首选：passkey 入口排在密码 / 验证码之前（标签与首推按钮都置顶）
	//   · 条件式：后台静默尝试，不打断用户输入，密码提交照常
	//   · 域约束：`.com` 注册域不渲染入口、不发起条件式请求
	// ============================================================
	function stubHostname(hostname: string) {
		const original = window.location;
		delete (window as any).location;
		(window as any).location = Object.defineProperties(
			{},
			{
				...Object.getOwnPropertyDescriptors(original),
				hostname: { get: () => hostname, configurable: true },
			},
		);
		return () => Object.defineProperty(window, 'location', { value: original, writable: true });
	}

	const follows = (a: HTMLElement, b: HTMLElement) =>
		Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

	it('passkey 置首选：首推入口与标签都排在密码 / 验证码之前', async () => {
		mockLoginMethods = ['password', 'passkey', 'email_code'];
		enablePasskeySupport(false);

		renderLogin();

		const cta = await screen.findByTestId('passkey-primary-cta');
		const identity = screen.getByPlaceholderText('auth.login.identityPlaceholder');
		const submit = screen.getByRole('button', { name: 'login.submit' });
		// 首推入口在密码表单（identity / 提交按钮）之前
		expect(follows(cta, identity)).toBe(true);
		expect(follows(cta, submit)).toBe(true);

		// 标签顺序：passkey → password → email_code
		const passkeyTab = screen.getByRole('button', { name: 'auth.login.passkeyTab' });
		const passwordTab = screen.getByRole('button', { name: 'auth.login.passwordTab' });
		const emailTab = screen.getByRole('button', { name: 'auth.login.emailCodeTab' });
		expect(follows(passkeyTab, passwordTab)).toBe(true);
		expect(follows(passwordTab, emailTab)).toBe(true);
	});

	it('租户关闭 passkey（passkeyEnabled === false）时不渲染首推入口与标签', async () => {
		mockLoginMethods = ['password', 'passkey'];
		mockPasskeyEnabled = false;
		enablePasskeySupport(true);

		renderLogin();

		await waitFor(() =>
			expect(screen.getByPlaceholderText('auth.login.identityPlaceholder')).toBeInTheDocument(),
		);
		expect(screen.queryByTestId('passkey-primary-cta')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'auth.login.passkeyTab' }),
		).not.toBeInTheDocument();
	});

	it('`.com` 注册域不渲染 passkey 入口，也不发起条件式请求', async () => {
		mockLoginMethods = ['password', 'passkey'];
		enablePasskeySupport(true);
		const restore = stubHostname('auth.autional.com');
		try {
			renderLogin();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(screen.queryByTestId('passkey-primary-cta')).not.toBeInTheDocument();
			expect(
				screen.queryByRole('button', { name: 'auth.login.passkeyTab' }),
			).not.toBeInTheDocument();
			expect(mockWebauthnBegin).not.toHaveBeenCalled();
			expect(navigator.credentials.get).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});

	// 死路防护：租户只开 passkey，而当前域不提供 passkey → 不能整页无登录入口
	it('`.com` 域 + 租户仅开 passkey → 保留密码表单，不留死路', async () => {
		mockLoginMethods = ['passkey'];
		enablePasskeySupport(false);
		const restore = stubHostname('auth.autional.com');
		try {
			renderLogin();
			expect(
				await screen.findByPlaceholderText('auth.login.identityPlaceholder'),
			).toBeInTheDocument();
			expect(screen.queryByTestId('passkey-primary-cta')).not.toBeInTheDocument();
		} finally {
			restore();
		}
	});

	it('条件式在后台静默尝试，不打断输入、不阻塞密码提交', async () => {
		mockLoginMethods = ['passkey', 'password'];
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
		mockAuthLoginPost.mockResolvedValue({
			accessToken: 'token-abc',
			refreshToken: 'refresh-abc',
			user: { id: '1' },
		});

		const user = userEvent.setup();
		renderLogin();
		await waitFor(() => expect(conditionalOpts).toBeTruthy());

		// 条件式请求挂起中：输入与提交照常（不弹窗、不报错、不抢占）
		await user.type(screen.getByPlaceholderText('auth.login.identityPlaceholder'), 'testuser');
		await user.type(screen.getByPlaceholderText('auth.login.passwordPlaceholder'), 'pass123');
		await user.click(screen.getByRole('button', { name: 'login.submit' }));

		await waitFor(() => expect(mockLoginWithTokens).toHaveBeenCalled());
		expect(screen.queryByTestId('passkey-error')).not.toBeInTheDocument();
	});
});

// ============================================================
// MFA 票据（URL fragment 交付）：`#mfa_ticket=<opaque>&identity=<email>`
//   · 挂载即读入内存并剥离 fragment（不落 storage、不打日志、不上报）
//   · 登录体带票据（拦截器 camel→snake，线上键名 mfa_ticket）
//   · 票据失效（后端仍 requires_mfa）→ 走既有挑战页回落，不额外报错
//   · identity 只做预填，不覆盖用户已输入值
//   · 无 fragment 时行为与旧版完全一致
// ============================================================
describe('LoginPage - MFA 票据（fragment）', () => {
	const identityField = () => screen.getByPlaceholderText('auth.login.identityPlaceholder');
	const passwordField = () => screen.getByPlaceholderText('auth.login.passwordPlaceholder');
	const submitButton = () => screen.getByRole('button', { name: 'login.submit' });

	beforeEach(() => {
		window.history.replaceState(null, '', '/acme-corp/login');
	});

	afterEach(() => {
		window.history.replaceState(null, '', '/acme-corp/login');
		sessionStorage.removeItem('mfa_pre_auth');
	});

	it('有 #mfa_ticket 时随密码提交，且挂载即清除 fragment', async () => {
		window.history.replaceState(
			null,
			'',
			'/acme-corp/login#mfa_ticket=mt_opaque_abc&identity=alice%40example.com',
		);
		mockAuthLoginPost.mockResolvedValue({
			accessToken: 'token-abc',
			refreshToken: 'refresh-abc',
			user: { id: '1' },
		});
		const user = userEvent.setup();
		renderLoginWithSlug();

		// 挂载即剥离：hash 清空，path/search 保留（历史/截图不再带票据）
		await waitFor(() => expect(window.location.hash).toBe(''));
		expect(window.location.pathname).toBe('/acme-corp/login');

		// identity 由 fragment 预填，用户只补密码
		expect(identityField()).toHaveValue('alice@example.com');

		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		const body = mockAuthLoginPost.mock.calls[0][0];
		expect(body).toMatchObject({ identity: 'alice@example.com', mfaTicket: 'mt_opaque_abc' });
		// 线上键名由 shared 拦截器统一 camel→snake 落定
		expect(snakeCaseKeys(body)).toMatchObject({ mfa_ticket: 'mt_opaque_abc' });

		// 票据不落任何持久层
		expect(sessionStorage.getItem('mfa_ticket')).toBeNull();
		expect(localStorage.getItem('mfa_ticket')).toBeNull();
	});

	it('无 fragment 时请求体不含 mfa_ticket，且地址栏不被触碰', async () => {
		mockAuthLoginPost.mockResolvedValue({
			accessToken: 'token-abc',
			refreshToken: 'refresh-abc',
			user: { id: '1' },
		});
		const user = userEvent.setup();
		renderLoginWithSlug();

		await user.type(identityField(), 'testuser');
		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		const body = mockAuthLoginPost.mock.calls[0][0];
		expect(body).not.toHaveProperty('mfaTicket');
		expect(snakeCaseKeys(body)).not.toHaveProperty('mfa_ticket');
		expect(window.location.hash).toBe('');
	});

	it('票据失效（后端仍返回 requiresMfa）→ 回落既有 MFA 挑战页，不额外报错', async () => {
		window.history.replaceState(null, '', '/acme-corp/login#mfa_ticket=mt_expired');
		mockAuthLoginPost.mockResolvedValue({
			requiresMfa: true,
			challengeToken: 'ct-invalid',
		});
		const user = userEvent.setup();
		renderLoginWithSlug();

		await waitFor(() => expect(window.location.hash).toBe(''));

		await user.type(identityField(), 'alice');
		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		// 票据虽已失效仍照常提交（由后端判定），随后走既有回落
		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		expect(mockAuthLoginPost.mock.calls[0][0]).toMatchObject({ mfaTicket: 'mt_expired' });

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				expect.stringContaining('/acme-corp/mfa-challenge'),
			);
		});
		// 不额外报错、不建会话（行为与无票据时完全一致）
		expect(screen.queryByText('login.error.credentials')).toBeNull();
		expect(mockLoginWithTokens).not.toHaveBeenCalled();
	});

	it('identity 预填不覆盖用户已输入值', async () => {
		window.history.replaceState(
			null,
			'',
			'/acme-corp/login#mfa_ticket=mt_abc&identity=alice%40example.com',
		);
		mockAuthLoginPost.mockResolvedValue({
			accessToken: 'token-abc',
			refreshToken: 'refresh-abc',
			user: { id: '1' },
		});
		const user = userEvent.setup();
		renderLoginWithSlug();

		await waitFor(() => expect(window.location.hash).toBe(''));

		const input = identityField();
		await user.clear(input);
		await user.type(input, 'bob@example.com');
		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		expect(mockAuthLoginPost.mock.calls[0][0]).toMatchObject({
			identity: 'bob@example.com',
			mfaTicket: 'mt_abc',
		});
	});
});

// ============================================================
// MFA 票据桥（Phase 1，docs/MFA-BRIDGE-BOUNDARY-PHASE1 §5.8）
//   · fragment 增 `client_id`（公开标识，与票据同一条投递路径，读后一并剥离）
//   · 有票：登录体补 clientId（拦截器统一 camel→snake 落 client_id）+ mfaRedirect（redirect 原值）
//   · 无票：请求体键全集与改造前逐 key 相同 —— 边界字段不得泄漏到普通登录
// ============================================================
describe('LoginPage - MFA 票据桥（Phase 1）', () => {
	const identityField = () => screen.getByPlaceholderText('auth.login.identityPlaceholder');
	const passwordField = () => screen.getByPlaceholderText('auth.login.passwordPlaceholder');
	const submitButton = () => screen.getByRole('button', { name: 'login.submit' });

	// 非真实 ULID：避免与「前端源码 client_id 字面量 = 0」守卫冲突，本页也不校验票据/受众格式
	const CLIENT_ID = 'client_test_bridge01';
	const SUCCESS = { accessToken: 'token-abc', refreshToken: 'refresh-abc', user: { id: '1' } };

	beforeEach(() => {
		window.history.replaceState(null, '', '/acme-corp/login');
	});

	afterEach(() => {
		window.history.replaceState(null, '', '/acme-corp/login');
		sessionStorage.removeItem('mfa_pre_auth');
	});

	it('有票：随密码提交 clientId 与 mfaRedirect（落 client_id / mfa_redirect）', async () => {
		window.history.replaceState(
			null,
			'',
			`/acme-corp/login#mfa_ticket=mt_abc&identity=alice%40example.com&client_id=${CLIENT_ID}`,
		);
		mockAuthLoginPost.mockResolvedValue(SUCCESS);
		const user = userEvent.setup();
		renderLoginWithSlugAt('/acme-corp/login?redirect=%2Fdashboard%3Fmfa_sso%3D1');

		// client_id 与票据同路径：随 fragment 一并剥离，不残留地址栏
		await waitFor(() => expect(window.location.hash).toBe(''));
		expect(window.location.pathname + window.location.search).toBe('/acme-corp/login');

		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		const body = mockAuthLoginPost.mock.calls[0][0];
		expect(body).toMatchObject({
			identity: 'alice@example.com',
			mfaTicket: 'mt_abc',
			clientId: CLIENT_ID,
			mfaRedirect: '/dashboard?mfa_sso=1',
		});
		// 线上键名由 shared 拦截器统一 camel→snake 落定
		expect(snakeCaseKeys(body)).toMatchObject({
			mfa_ticket: 'mt_abc',
			client_id: CLIENT_ID,
			mfa_redirect: '/dashboard?mfa_sso=1',
		});
		// 票据与受众同样不落任何持久层
		expect(sessionStorage.getItem('client_id')).toBeNull();
		expect(localStorage.getItem('client_id')).toBeNull();
	});

	it('有票但 fragment 无 client_id（旧版 App）→ 不发 clientId，不被凭空补值', async () => {
		window.history.replaceState(null, '', '/acme-corp/login#mfa_ticket=mt_abc');
		mockAuthLoginPost.mockResolvedValue(SUCCESS);
		const user = userEvent.setup();
		renderLoginWithSlugAt('/acme-corp/login?redirect=%2Fdashboard');

		await waitFor(() => expect(window.location.hash).toBe(''));

		await user.type(identityField(), 'alice');
		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		const body = mockAuthLoginPost.mock.calls[0][0];
		expect(body).not.toHaveProperty('clientId');
		expect(snakeCaseKeys(body)).not.toHaveProperty('client_id');
		// mfa_redirect 与 client_id 相互独立：仍按 redirect 原值提交
		expect(body).toMatchObject({ mfaTicket: 'mt_abc', mfaRedirect: '/dashboard' });
	});

	it('有票但登录页无 redirect 查询参数 → 不发 mfaRedirect', async () => {
		window.history.replaceState(null, '', `/acme-corp/login#mfa_ticket=mt_abc&client_id=${CLIENT_ID}`);
		mockAuthLoginPost.mockResolvedValue(SUCCESS);
		const user = userEvent.setup();
		renderLoginWithSlugAt('/acme-corp/login');

		await waitFor(() => expect(window.location.hash).toBe(''));

		await user.type(identityField(), 'alice');
		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		const body = mockAuthLoginPost.mock.calls[0][0];
		expect(body).not.toHaveProperty('mfaRedirect');
		expect(snakeCaseKeys(body)).not.toHaveProperty('mfa_redirect');
		expect(body).toMatchObject({ mfaTicket: 'mt_abc', clientId: CLIENT_ID });
	});

	it('无票：请求体键全集与改造前完全一致（边界字段零泄漏）', async () => {
		mockAuthLoginPost.mockResolvedValue(SUCCESS);
		const user = userEvent.setup();
		// 同样的 redirect 查询存在也不得触发 mfa_redirect：字段只在有票时才会出现
		renderLoginWithSlugAt('/acme-corp/login?redirect=%2Fdashboard');

		await user.type(identityField(), 'testuser');
		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		const body = mockAuthLoginPost.mock.calls[0][0];
		// 基线（改造前实测，见 git 历史同样用例）：无票请求体的键全集必须逐 key 相同。
		// 任何一个新键出现在这里都说明「边界字段泄漏到普通登录」——直接失败。
		expect(Object.keys(body).sort()).toEqual([
			'identity',
			'password',
			'passwordTransmission',
			'tenantId',
		]);
		expect(body).not.toHaveProperty('clientId');
		expect(body).not.toHaveProperty('mfaRedirect');
		expect(body).not.toHaveProperty('mfaTicket');
	});

	it('有票（含 client_id）但票据失效 → 仍回落既有 MFA 挑战页，不额外报错', async () => {
		window.history.replaceState(
			null,
			'',
			`/acme-corp/login#mfa_ticket=mt_expired&client_id=${CLIENT_ID}`,
		);
		mockAuthLoginPost.mockResolvedValue({ requiresMfa: true, challengeToken: 'ct-invalid' });
		const user = userEvent.setup();
		renderLoginWithSlugAt('/acme-corp/login');

		await waitFor(() => expect(window.location.hash).toBe(''));

		await user.type(identityField(), 'alice');
		await user.type(passwordField(), 'pass123');
		await user.click(submitButton());

		await waitFor(() => expect(mockAuthLoginPost).toHaveBeenCalled());
		expect(mockAuthLoginPost.mock.calls[0][0]).toMatchObject({
			mfaTicket: 'mt_expired',
			clientId: CLIENT_ID,
		});
		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				expect.stringContaining('/acme-corp/mfa-challenge'),
			);
		});
		expect(mockLoginWithTokens).not.toHaveBeenCalled();
	});
});
