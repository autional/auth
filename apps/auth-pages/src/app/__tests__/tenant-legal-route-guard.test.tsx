import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';

// ============================================================
// AUTH-48/49 × 守卫修复：/:tenantSlug/terms|privacy 子路由接线回归锁
//
// 背景：这两条路由包了 TenantIndexGuard（脏 slug 不得把法律页租户化 → 404 兜底）。
// 但 shared 守卫内曾有「URL 段数 > 1 → notFound」检查（为已废弃的动态 basename
// 设计而写），使**任何** /<slug>/terms 抢先命中断言恒 404 —— 2026-10-05 回归，
// 2026-10-09 修复于 @autional/shared rc.34（移除该检查，只留 slug 白名单校验）。
// 页面级单测直接渲染页面组件、绕过 App 路由表与守卫，故全程未拦；本文件补路由级接线。
//
// mock 面与 tenant-index-guard.test.tsx 同构：守卫走真实实现（含 fetch 响应契约
// 解析 —— 被测物本体），法律页替为落点探针，其余重型/网络件桩掉。
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

// I18nProvider 直连 react-i18next 实例（setup.ts 只桩了 @/i18n/config，无实例时其
// effect 会 `i18n.on` 崩）；本测试与文案无关，桩掉即可
vi.mock('@/lib/i18n', () => ({
	I18nProvider: ({ children }: any) => children,
	useI18n: () => ({ lang: 'zh-CN', t: (key: string) => key, setLang: vi.fn() }),
	defaultLang: 'zh-CN',
}));

// 法律页（App 内 React.lazy）→ 落点探针：只证明「守卫放行后到达该页面路由」
vi.mock('@/app/terms/page', () => ({
	default: () => <div data-testid="terms-page" />,
}));
vi.mock('@/app/privacy/page', () => ({
	default: () => <div data-testid="privacy-page" />,
}));

/** 名单响应打桩（真实 hook 的解析顺序：items → data → 原始对象） */
function stubTenants(payload: unknown, ok = true) {
	mockFetch.mockResolvedValue({
		ok,
		json: async () => payload,
	} as any);
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const originalWindowLocation = window.location;

/** TenantIndexGuard 的 slug 取自 window.location.pathname（非路由参数），须与 MemoryRouter 同步驱动 */
function setWindowPath(pathname: string) {
	delete (window as any).location;
	(window as any).location = Object.defineProperties(
		{},
		{
			...Object.getOwnPropertyDescriptors(originalWindowLocation),
			pathname: { get: () => pathname },
		},
	);
}

function renderApp(pathname: string) {
	setWindowPath(pathname);
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
	// queryClient 是模块级单例，['public-tenants'] 缓存会跨用例泄漏
	queryClient.clear();
	vi.stubGlobal('fetch', mockFetch);
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
	stubTenants({
		code: 0,
		items: [
			{ id: 't1', name: 'demo' },
			{ id: 't2', name: 'acme' },
		],
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	if (window.location !== originalWindowLocation) {
		Object.defineProperty(window, 'location', { value: originalWindowLocation, writable: true });
	}
});

describe('App /:tenantSlug/terms|privacy 子路由守卫接线（回归锁）', () => {
	it('L1 名单内 slug + /demo/terms → 守卫放行，渲染条款页（修复前此处恒 404）', async () => {
		renderApp('/demo/terms');
		expect(await screen.findByTestId('terms-page')).toBeInTheDocument();
		expect(screen.queryByText('404')).not.toBeInTheDocument();
	});

	it('L2 名单内 slug + /demo/privacy → 守卫放行，渲染隐私页（修复前此处恒 404）', async () => {
		renderApp('/demo/privacy');
		expect(await screen.findByTestId('privacy-page')).toBeInTheDocument();
		expect(screen.queryByText('404')).not.toBeInTheDocument();
	});

	it('L3 脏 slug + /nosuchtenant/terms → 404 兜底，条款页零渲染（AUTH-48/49 语义）', async () => {
		renderApp('/nosuchtenant/terms');
		expect(await screen.findByText('404')).toBeInTheDocument();
		expect(screen.queryByTestId('terms-page')).not.toBeInTheDocument();
	});

	it('L4 脏 slug + /nosuchtenant/privacy → 404 兜底，隐私页零渲染（AUTH-48/49 语义）', async () => {
		renderApp('/nosuchtenant/privacy');
		expect(await screen.findByText('404')).toBeInTheDocument();
		expect(screen.queryByTestId('privacy-page')).not.toBeInTheDocument();
	});
});
