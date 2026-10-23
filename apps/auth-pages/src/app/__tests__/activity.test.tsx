import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ActivityPage from '../activity/page';

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
		useNavigate: () => vi.fn(),
		Link: ({ to, children, ...rest }: any) => (
			<a href={to} {...rest}>
				{children}
			</a>
		),
	};
});

const mocks = vi.hoisted(() => ({
	getMe: vi.fn(),
	sessions: vi.fn(),
	audit: vi.fn(),
	notifications: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ getMe: mocks.getMe }));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	useAuth: () => ({ user: { id: 'u1', username: 'demo', email: 'demo@example.com' } }),
	getAccessToken: () => 'token',
	extractList: (res: any) => res?.items ?? [],
	useAuthStore: Object.assign(() => ({ currentTenantId: 'tenant-1' }), {
		getState: () => ({ currentTenantId: 'tenant-1' }),
	}),
	usePublicTenantSlugs: () => ({ data: [], isSuccess: true }),
	END_USER_PORTAL_URL: () => 'http://user.example.com',
	crossAppUrl: (base: string, path?: string) => base + (path || ''),
	apiClient: { get: vi.fn() },
}));

vi.mock('@autional/shared/generated/api', () => ({
	authMeSessions: mocks.sessions,
	authMeAuditLogs: mocks.audit,
	notifications: mocks.notifications,
}));

vi.mock('@/hooks/use-tenant-slug', () => ({
	useEffectiveTenantSlug: () => 'demo',
	useResolvedTenantSlug: () => 'demo',
}));

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: any) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
		lang: 'zh-CN',
		setLang: vi.fn(),
	}),
	I18nProvider: ({ children }: any) => children,
	defaultLang: 'zh-CN',
}));

vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: vi.fn() }));

const renderPage = () =>
	render(
		<MemoryRouter initialEntries={['/activity']}>
			<ActivityPage />
		</MemoryRouter>,
	);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getMe.mockResolvedValue({
		id: 'u1',
		username: 'demo',
		email: 'demo@example.com',
		status: 'active',
		mfaEnabled: true,
		lastLoginAt: '2026-06-09T08:00:00Z',
	});
	mocks.sessions.mockResolvedValue({ items: [{}, {}, {}] });
	mocks.audit.mockResolvedValue({
		items: [
			{ id: 'a1', action: 'login', status: 'success', ip: '10.0.0.1', createdAt: '2026-10-23T01:00:00Z' },
			{ id: 'a2', action: 'password_change', status: 'success', createdAt: '2026-10-22T01:00:00Z' },
		],
		total: 2,
	});
	mocks.notifications.mockResolvedValue({
		items: [{ id: 'n1', title: 'Maintenance' }],
		total: 2,
	});
});

describe('ActivityPage', () => {
	it('渲染状态摘要（状态 / MFA / 最后登录）', async () => {
		renderPage();

		await waitFor(() => {
			expect(screen.getByText('activity.title')).toBeInTheDocument();
		});

		expect(screen.getByText(/dashboard\.status: active/)).toBeInTheDocument();
		expect(screen.getByText(/MFA: dashboard\.mfaEnabled/)).toBeInTheDocument();
		expect(screen.getByText(/dashboard\.lastLogin:/)).toBeInTheDocument();
	});

	it('顶层导航三项，当前分区是活动', async () => {
		renderPage();

		const nav = await screen.findByRole('navigation', { name: 'dashboard.tabs.label' });
		const links = nav.querySelectorAll('a');
		expect(links).toHaveLength(3);
		expect(links[0]).toHaveAttribute('href', '/demo/dashboard');
		expect(links[1]).toHaveAttribute('href', '/demo/activity');
		expect(links[1]).toHaveAttribute('aria-current', 'page');
		expect(links[2]).toHaveAttribute('href', '/demo/account');
	});

	it('最近活动按 action 映射为可读文案，外链带租户 slug', async () => {
		renderPage();

		await waitFor(() => {
			expect(screen.getByText('activity.action.login')).toBeInTheDocument();
		});

		expect(screen.getByText('activity.action.passwordChange')).toBeInTheDocument();
		expect(screen.getByText(/activity\.viewAll/).closest('a')).toHaveAttribute(
			'href',
			'http://user.example.com/demo/activity',
		);
		expect(screen.getByText(/activity\.manageSessions/).closest('a')).toHaveAttribute(
			'href',
			'http://user.example.com/demo/sessions',
		);
	});

	it('消息显示未读数与最新标题', async () => {
		renderPage();

		await waitFor(() => {
			expect(screen.getByText('Maintenance')).toBeInTheDocument();
		});

		expect(screen.getByText(/activity\.unreadCount/)).toBeInTheDocument();
		expect(screen.getByText(/activity\.viewMessages/).closest('a')).toHaveAttribute(
			'href',
			'http://user.example.com/demo/notifications',
		);
	});
});
