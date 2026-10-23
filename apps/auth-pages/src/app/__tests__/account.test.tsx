import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import AccountPage from '../account/page';

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

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	END_USER_PORTAL_URL: () => 'http://user.example.com',
	crossAppUrl: (base: string, path?: string) => base + (path || ''),
}));

vi.mock('@/hooks/use-tenant-slug', () => ({
	useEffectiveTenantSlug: () => 'demo',
	// AUTH-48/49：AuthCard 页脚法律链消费已解析 slug
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

vi.mock('@/hooks/use-page-title', () => ({
	usePageTitle: vi.fn(),
}));

vi.mock('lucide-react', () => ({
	UserCircle: () => null,
	ShieldCheck: () => null,
	Monitor: () => null,
	Bell: () => null,
	KeyRound: () => null,
	Settings: () => null,
	ShieldAlert: () => null,
	History: () => null,
	Link2: () => null,
	Phone: () => null,
	Lock: () => null,
	// AUTH-45②：注销账户卡图标
	UserX: () => null,
	// 2026-10-23：已授权应用卡图标
	Blocks: () => null,
}));

const renderPage = () =>
	render(
		<MemoryRouter initialEntries={['/account']}>
			<AccountPage />
		</MemoryRouter>,
	);

describe('AccountPage', () => {
	it('renders title and subtitle', () => {
		renderPage();

		expect(screen.getByText('account.title')).toBeInTheDocument();
		expect(screen.getByText('account.subtitle')).toBeInTheDocument();
	});

	it('renders all 12 link labels', () => {
		renderPage();

		const linkLabels = [
			'account.profile',
			'account.security',
			'account.sessions',
			'account.notifPrefs',
			'account.changePassword',
			'account.loginHistory',
			'account.roleActivations',
			'account.linkedAccounts',
			'account.authorizedApps',
			'account.recoveryContacts',
			'account.privacyCenter',
			'account.deleteAccount',
		];

		for (const label of linkLabels) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
	});

	it('links point to correct URLs', () => {
		renderPage();

		// 只数「账户卡片」内的链接（10）：全页计数会把 AuthCard 的顶层导航与页脚内链、
		// 以及另一容器里的隐私/删除账号卡算进来，而它们由其他批次演进
		// （2026-10-23 实测：并发 DashboardNav 让全页计数 13→16 → 任何一批单独回退都会假红）。
		// 卡片容器 = 第一个账户链接的父元素；隐私/删除账号卡在下方的独立区块。
		const card = screen.getByText('account.profile').closest('a')!.parentElement!;
		expect(within(card).getAllByRole('link')).toHaveLength(10);

		// 文本锚定而非下标：AUTH-45 卡片增删不再脆断断言
		const profileLink = screen.getByText('account.profile').closest('a');
		expect(profileLink).toHaveAttribute('href', expect.stringContaining('/profile'));

		// AUTH-45②：注销账户卡落本仓 account-deletion（测试路由无租户段 → 裸链）
		const deleteLink = screen.getByText('account.deleteAccount').closest('a');
		expect(deleteLink).toHaveAttribute('href', '/account-deletion');

		const privacyLink = screen.getByText('account.privacyCenter').closest('a');
		expect(privacyLink).toHaveAttribute('href', '/privacy');

		// 2026-10-23 补写：已授权应用卡是跨门户深链，必须带租户 slug（AUTH-45①：
		// 裸链 user.<域名>/security/... 无租户上下文 → 用户门户 404）。
		const authorizedAppsLink = screen.getByText('account.authorizedApps').closest('a');
		expect(authorizedAppsLink).toHaveAttribute(
			'href',
			'http://user.example.com/demo/security/authorized-apps',
		);
	});
});
