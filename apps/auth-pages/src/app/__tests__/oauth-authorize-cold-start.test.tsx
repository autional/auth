import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Suspense } from 'react';

// ============================================================
// L7 + TASK-15 前端半：同意页冷启动与会话化提交
//  - 无会话 → 直达 <slug>/login?redirect=<本页>（不奔 brand）
//  - slug 解析失败 → 回退旧交棒链（/?redirect=…），不白屏
//  - 有会话 → 同意提交带 Bearer + Accept: application/json，按 redirect_to 整页跳转
// ============================================================

const { mockState, mockFetch, mockReplace, mockGetOAuthClient, mockApiGet, mockAuthMe, mockClearAuth } =
	vi.hoisted(() => ({
		mockState: { token: null as string | null },
		mockFetch: vi.fn(),
		mockReplace: vi.fn(),
		mockGetOAuthClient: vi.fn(),
		mockApiGet: vi.fn(),
		mockAuthMe: vi.fn(),
		mockClearAuth: vi.fn(),
	}));

vi.mock('@autional/shared', async () => {
	// decodeJwtPayload 取真实现（授权页据它解析 claim）：白名单 mock 其余键保持隔离
	const actual = await vi.importActual<typeof import('@autional/shared')>('@autional/shared');
	return {
		decodeJwtPayload: actual.decodeJwtPayload,
		getAccessToken: () => mockState.token,
		apiClient: { get: (...args: any[]) => mockApiGet(...args), post: vi.fn() },
		extractItem: (payload: any) => payload?.data ?? payload,
		useAuthStore: { getState: () => ({ clearAuth: mockClearAuth }) },
	};
});

vi.mock('@autional/shared/generated/api', () => ({
	PublicAuthConfigByAuthConfig: vi.fn(() => Promise.resolve({ data: {} })),
	authMe: (...args: any[]) => mockAuthMe(...args),
}));

vi.mock('@/lib/api.generated', () => ({
	getOAuthClient: (...args: any[]) => mockGetOAuthClient(...args),
}));

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key} ${JSON.stringify(opts)}` : key,
		lang: 'zh-CN',
	}),
}));

import OAuthAuthorizePage from '../oauth/authorize/page';

const AUTHORIZE_PATH = '/oauth/api/v1/oauth/authorize';
const AUTHORIZE_QUERY =
	'?client_id=client-1&redirect_uri=https%3A%2F%2Fuser.autional.cn%2Fdemo%2F&scope=openid&state=st-1&nonce=n-1';
const AUTHORIZE_URL = AUTHORIZE_PATH + AUTHORIZE_QUERY;

/** 三段式 JWT（仅需可被 atob 解析出 payload，不校验签名） */
const SESSION_TOKEN = `h.${btoa(JSON.stringify({ sub: 'u1', tenant_id: 't1' }))}.s`;

let locationMock: Record<string, any>;

function renderPage() {
	return render(
		<MemoryRouter initialEntries={[`/oauth/authorize${AUTHORIZE_QUERY}`]}>
			<Suspense fallback={<div>Loading</div>}>
				<OAuthAuthorizePage />
			</Suspense>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockState.token = null;
	mockGetOAuthClient.mockResolvedValue({ data: { clientName: 'Test App', logoUri: '' } });
	mockApiGet.mockResolvedValue({ data: { hasConsent: false } });
	// E9：挂载时会话校验默认成功（无效会话另有专项用例）
	mockAuthMe.mockResolvedValue({});

	vi.stubGlobal('fetch', mockFetch);
	mockFetch.mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('/oauth/client/')) {
			return Promise.resolve({ ok: true, json: async () => ({ data: { tenantId: 't1' } }) });
		}
		if (u.includes('/tenant/public/tenants')) {
			return Promise.resolve({ ok: true, json: async () => ({ items: [{ id: 't1', name: 'demo' }] }) });
		}
		return Promise.resolve({ ok: false, json: async () => ({}) });
	});

	// jsdom location 不可直接赋值：先 delete 再重建（同 entry-router.test.tsx）
	delete (window as any).location;
	locationMock = {
		origin: 'https://auth.autional.cn',
		pathname: AUTHORIZE_PATH,
		search: AUTHORIZE_QUERY,
		href: '',
		replace: mockReplace,
	};
	(window as any).location = locationMock;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('同意页冷启动（无会话）', () => {
	it('解析出租户 slug → 直达 <slug>/login?redirect=<本页>，不经过 brand', async () => {
		renderPage();

		await waitFor(() => {
			expect(mockReplace).toHaveBeenCalledWith(
				'/demo/login?redirect=' + encodeURIComponent(AUTHORIZE_URL),
			);
		});
		const targets = mockReplace.mock.calls.map((c) => String(c[0]));
		expect(targets.some((t) => t.includes('brand'))).toBe(false);
	});

	it('slug 解析失败 → 回退旧交棒链（/?redirect=…），不白屏', async () => {
		mockFetch.mockRejectedValue(new Error('network down'));
		renderPage();

		await waitFor(() => {
			expect(mockReplace).toHaveBeenCalledWith(
				'/?redirect=' + encodeURIComponent(AUTHORIZE_URL),
			);
		});
	});

	it('AUTH-03：无会话时同意表单不渲染——跳转在途仅加载卡片（无 0.5s 表单闪烁）', async () => {
		renderPage();

		// 首帧即断言：修复前完整同意表单（approve/deny + 权限清单）先渲染、后跳走
		expect(screen.queryByRole('button', { name: 'auth.oauth.approve' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'auth.oauth.deny' })).toBeNull();
		expect(screen.queryByText('auth.oauth.requestedPermissions')).toBeNull();
		expect(screen.getByText('common.loading')).toBeInTheDocument();

		await waitFor(() => {
			expect(mockReplace).toHaveBeenCalled();
		});
		// 跳转在途仍不渲染表单
		expect(screen.queryByRole('button', { name: 'auth.oauth.approve' })).toBeNull();
		expect(screen.getByText('common.loading')).toBeInTheDocument();
	});
});

describe('同意提交（有会话）', () => {
	beforeEach(() => {
		mockState.token = SESSION_TOKEN;
	});

	it('提交带 Bearer + Accept: application/json，按 redirect_to 整页跳转', async () => {
		const user = userEvent.setup();
		const landing = 'https://user.autional.cn/demo/?code=abc&state=st-1';
		mockFetch.mockImplementation((url: string, init?: any) => {
			if (String(url).includes('/bff/oauth/api/v1/oauth/authorize')) {
				return Promise.resolve({ ok: true, json: async () => ({ redirect_to: landing }) });
			}
			return Promise.resolve({ ok: false, json: async () => ({}) });
		});

		renderPage();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'auth.oauth.approve' })).toBeInTheDocument();
		});

		await user.click(screen.getByRole('button', { name: 'auth.oauth.approve' }));

		await waitFor(() => {
			expect(locationMock.href).toBe(landing);
		});

		const postCall = mockFetch.mock.calls.find(
			(c) => String(c[0]).includes('/bff/oauth/api/v1/oauth/authorize') && c[1]?.method === 'POST',
		);
		expect(postCall).toBeTruthy();
		expect((postCall![1] as any).headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
		expect((postCall![1] as any).headers.Accept).toBe('application/json');
		expect(String((postCall![1] as any).body)).toContain('approved=true');
		// OIDC nonce 必须从授权 URL 透传到同意提交（否则授权码丢失 nonce → id_token 不回显 → RP 校验失败）
		expect(String((postCall![1] as any).body)).toContain('nonce=n-1');
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it('服务端拒绝 login_required → 清本地会话 + 回登录页（E9：不再死胡同报错）', async () => {
		const user = userEvent.setup();
		mockFetch.mockImplementation((url: string, init?: any) => {
			const u = String(url);
			if (u.includes('/oauth/client/')) {
				return Promise.resolve({ ok: true, json: async () => ({ data: { tenantId: 't1' } }) });
			}
			if (u.includes('/tenant/public/tenants')) {
				return Promise.resolve({ ok: true, json: async () => ({ items: [{ id: 't1', name: 'demo' }] }) });
			}
			if (u.includes('/bff/oauth/api/v1/oauth/authorize')) {
				return Promise.resolve({
					ok: false,
					status: 401,
					json: async () => ({ error: 'login_required', error_description: '会话已失效' }),
				});
			}
			return Promise.resolve({ ok: false, json: async () => ({}) });
		});

		renderPage();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'auth.oauth.approve' })).toBeInTheDocument();
		});

		await user.click(screen.getByRole('button', { name: 'auth.oauth.approve' }));

		// E9：login_required = 会话已失效 → 清残留本地会话并回登录页（redirect 指回本页），
		// 登录表单重现；不再把错误落在死胡同（反复点「授权」只会反复失败）。
		await waitFor(() => {
			expect(mockReplace).toHaveBeenCalledWith(
				'/demo/login?redirect=' + encodeURIComponent(AUTHORIZE_URL),
			);
		});
		expect(mockClearAuth).toHaveBeenCalled();
		expect(screen.queryByText('oauth.error.loginRequired')).toBeNull();
	});

	it('E9：挂载时会话已被撤销（authMe 401）→ clearAuth + 回登录页，同意表单不渲染', async () => {
		// 僵尸会话场景：本地 token 残留但服务端已撤销（登出/换号）——不得静默自动同意。
		mockAuthMe.mockRejectedValue({ response: { status: 401 } });

		renderPage();

		await waitFor(() => {
			expect(mockReplace).toHaveBeenCalledWith(
				'/demo/login?redirect=' + encodeURIComponent(AUTHORIZE_URL),
			);
		});
		expect(mockClearAuth).toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: 'auth.oauth.approve' })).toBeNull();
		expect(screen.getByText('common.loading')).toBeInTheDocument();
	});
});
