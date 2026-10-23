import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SecurityPage from '../security/page';

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
}));

vi.mock('@autional/shared/generated/api', () => ({
	authMeSessions: mocks.sessions,
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

vi.mock('lucide-react', () => ({
	KeyRound: () => null,
	Fingerprint: () => null,
	ShieldCheck: () => null,
	Monitor: () => null,
	History: () => null,
	UserX: () => null,
}));

const renderPage = () =>
	render(
		<MemoryRouter initialEntries={['/security']}>
			<SecurityPage />
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
	mocks.sessions.mockResolvedValue({ items: [{}, {}] });
});

describe('SecurityPage', () => {
	it('渲染标题与状态摘要（状态 / MFA / 最后登录 / 在线设备）', async () => {
		renderPage();

		await waitFor(() => {
			expect(screen.getByText('security.title')).toBeInTheDocument();
		});

		expect(screen.getByText(/dashboard\.status: active/)).toBeInTheDocument();
		expect(screen.getByText(/MFA: dashboard\.mfaEnabled/)).toBeInTheDocument();
		expect(screen.getByText(/dashboard\.lastLogin:/)).toBeInTheDocument();
		expect(screen.getByText(/dashboard\.sessionsOnline/)).toBeInTheDocument();
	});

	it('顶层导航三项，当前分区是安全', async () => {
		renderPage();

		const nav = await screen.findByRole('navigation', { name: 'dashboard.tabs.label' });
		const links = nav.querySelectorAll('a');
		expect(links).toHaveLength(3);
		expect(links[1]).toHaveAttribute('href', '/demo/security');
		expect(links[1]).toHaveAttribute('aria-current', 'page');
	});

	it('快捷操作：本仓页带租户 slug，跨门户页走用户门户', async () => {
		renderPage();

		await waitFor(() => {
			expect(screen.getByText('security.quickActions')).toBeInTheDocument();
		});

		expect(screen.getByText('account.changePassword').closest('a')).toHaveAttribute(
			'href',
			'/demo/change-password',
		);
		expect(screen.getByText('security.passkey').closest('a')).toHaveAttribute(
			'href',
			'/demo/passkey',
		);
		expect(screen.getByText('account.sessions').closest('a')).toHaveAttribute(
			'href',
			'http://user.example.com/demo/sessions',
		);
		expect(screen.getByText('account.loginHistory').closest('a')).toHaveAttribute(
			'href',
			'http://user.example.com/demo/security/login-history',
		);
	});
});
