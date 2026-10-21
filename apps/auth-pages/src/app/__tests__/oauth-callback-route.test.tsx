import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';

// ============================================================
// provider 登录回调路由接线回归锁（2026-10-21）
//
// 背景：oauth-service 下发给 provider 的 redirect_url 是
// https://auth.autional.cn/oauth/callback/<provider>（configs/service/oauth-service.yaml）。
// 但 App 路由表只注册了 /oauth/api/v1/oauth/callback/:provider，页面级单测自己挂
// /oauth/callback/:provider 绕过了 App 路由表 ⇒ 真实回调在网关侧 404
// （gateway "route not found"），页面级测试全绿。本文件补路由级接线断言。
// ============================================================

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared')>();
	return {
		...actual,
		RequireAuth: () => <div data-testid="auth-gate" />,
		useLogout: () => vi.fn(),
		OAuthCallbackPage: () => null,
	};
});

vi.mock('@autional/shared/generated/api', () => ({
	tenantPublicTenantsByTenants: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/hooks/use-tenant-auth-config', () => ({
	useTenantAuthConfigBySlug: () => ({ data: null }),
}));

vi.mock('@/lib/i18n', () => ({
	I18nProvider: ({ children }: any) => children,
	useI18n: () => ({ lang: 'zh-CN', t: (key: string) => key, setLang: vi.fn() }),
	defaultLang: 'zh-CN',
}));

// provider 回调页（App 内 React.lazy）→ 落点探针：只证明路由命中
vi.mock('@/app/oauth/callback/page', () => ({
	default: () => <div data-testid="oauth-callback-page" />,
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderApp(pathname: string) {
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[pathname]}>
				<App />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	queryClient.clear();
	vi.stubGlobal('fetch', mockFetch);
	mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0, items: [] }) } as any);
	vi.stubGlobal(
		'matchMedia',
		vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('App /oauth/callback/:provider 路由接线（回归锁）', () => {
	it('L1 /oauth/callback/github → 渲染 provider 回调页（修复前落 404）', async () => {
		renderApp('/oauth/callback/github?code=c1&state=s1');
		expect(await screen.findByTestId('oauth-callback-page')).toBeInTheDocument();
	});

	it('L2 旧 API 形态 /oauth/api/v1/oauth/callback/github 仍可达', async () => {
		renderApp('/oauth/api/v1/oauth/callback/github?code=c1&state=s1');
		expect(await screen.findByTestId('oauth-callback-page')).toBeInTheDocument();
	});
});
