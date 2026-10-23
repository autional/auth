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
	// 2026-10-23：通行密钥卡图标
	Fingerprint: () => null,
}));

const renderPage = () =>
	render(
		<MemoryRouter initialEntries={['/account']}>
			<AccountPage />
		</MemoryRouter>,
	);

describe('AccountPage（设置分区）', () => {
	it('renders title and subtitle', () => {
		renderPage();

		expect(screen.getByText('settings.title')).toBeInTheDocument();
		expect(screen.getByText('settings.subtitle')).toBeInTheDocument();
	});

	it('renders all 11 setting labels', () => {
		renderPage();

		const linkLabels = [
			// 登录方式
			'account.changePassword',
			'security.passkey',
			'security.mfa',
			'account.linkedAccounts',
			'account.recoveryContacts',
			// 个人资料与偏好
			'account.profile',
			'account.notifPrefs',
			// 授权与数据
			'account.authorizedApps',
			'account.roleActivations',
			'account.privacyCenter',
			'account.deleteAccount',
		];

		for (const label of linkLabels) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}

		// 活动类条目已迁到「活动」分区，设置页不再重复
		expect(screen.queryByText('account.sessions')).not.toBeInTheDocument();
		expect(screen.queryByText('account.loginHistory')).not.toBeInTheDocument();
		expect(screen.queryByText('account.security')).not.toBeInTheDocument();
	});

	it('links point to correct URLs', () => {
		renderPage();

		// 只数第一组「登录方式」卡内的链接（5）：全页计数会把顶层导航、页脚内链与其他分组算进来。
		const card = screen.getByText('account.changePassword').closest('a')!.parentElement!;
		expect(within(card).getAllByRole('link')).toHaveLength(5);

		// 本仓页面：带租户 slug（AUTH-45①）
		expect(screen.getByText('account.changePassword').closest('a')).toHaveAttribute(
			'href',
			'/demo/change-password',
		);
		expect(screen.getByText('account.deleteAccount').closest('a')).toHaveAttribute(
			'href',
			'/demo/account-deletion',
		);
		expect(screen.getByText('account.privacyCenter').closest('a')).toHaveAttribute(
			'href',
			'/demo/privacy',
		);

		// 跨门户深链：必须带租户 slug（裸链 → 用户门户 404）
		expect(screen.getByText('account.profile').closest('a')).toHaveAttribute(
			'href',
			'http://user.example.com/demo/profile',
		);
		expect(screen.getByText('account.authorizedApps').closest('a')).toHaveAttribute(
			'href',
			'http://user.example.com/demo/security/authorized-apps',
		);
	});
});
