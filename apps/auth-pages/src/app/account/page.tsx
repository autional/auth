import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';
import { useEffectiveTenantSlug } from '@/hooks/use-tenant-slug';
import { userPortalUrl } from '@/lib/portal-links';
import { AuthCard } from '@/components/auth/AuthCard';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import {
	UserCircle,
	ShieldCheck,
	Bell,
	KeyRound,
	ShieldAlert,
	Link2,
	Phone,
	Lock,
	UserX,
	Blocks,
	Fingerprint,
	type LucideIcon,
} from 'lucide-react';

type AccountLink = {
	path: string;
	labelKey: string;
	descKey: string;
	icon: LucideIcon;
	/** true = 本仓页面（auth-pages 路由）；未设 = 用户门户深链（AUTH-45①） */
	local?: boolean;
};

type Group = { titleKey: string; links: AccountLink[] };

/**
 * 设置分区（第三分区）：**只放"能改的东西"**。
 *
 * 与「活动」的边界：会话 / 登录历史 / 消息属于活动（只读），这里不再重复；
 * 顶层的「安全设置」卡也删除——它指向的用户门户 /security 与本页同级内容重复，
 * 改为页尾一条「管理安全设置 →」。
 *
 * AUTH-41：用户门户深链必须带租户 slug（裸链 404），path 为门户内路径。
 */
const GROUPS: Group[] = [
	{
		titleKey: 'settings.groupSignIn',
		links: [
			{
				// AUTH-45①：改密表单在本仓（user 门户 /security 单页无法深链定位到改密）
				path: '/change-password',
				labelKey: 'account.changePassword',
				descKey: 'account.changePasswordDesc',
				icon: KeyRound,
				local: true,
			},
			{
				path: '/passkey',
				labelKey: 'security.passkey',
				descKey: 'security.passkeyDesc',
				icon: Fingerprint,
				local: true,
			},
			{
				path: '/mfa-setup',
				labelKey: 'security.mfa',
				descKey: 'security.mfaDesc',
				icon: ShieldCheck,
				local: true,
			},
			{
				path: '/security/linked-accounts',
				labelKey: 'account.linkedAccounts',
				descKey: 'account.linkedAccountsDesc',
				icon: Link2,
			},
			{
				path: '/security/recovery-contacts',
				labelKey: 'account.recoveryContacts',
				descKey: 'account.recoveryContactsDesc',
				icon: Phone,
			},
		],
	},
	{
		titleKey: 'settings.groupProfile',
		links: [
			{
				path: '/profile',
				labelKey: 'account.profile',
				descKey: 'account.profileDesc',
				icon: UserCircle,
			},
			{
				path: '/notifications/preferences',
				labelKey: 'account.notifPrefs',
				descKey: 'account.notifPrefsDesc',
				icon: Bell,
			},
		],
	},
	{
		titleKey: 'settings.groupData',
		links: [
			{
				// 已授权应用：auth 站只做入口，管理与撤销在用户门户
				path: '/security/authorized-apps',
				labelKey: 'account.authorizedApps',
				descKey: 'account.authorizedAppsDesc',
				icon: Blocks,
			},
			{
				path: '/security/role-activations',
				labelKey: 'account.roleActivations',
				descKey: 'account.roleActivationsDesc',
				icon: ShieldAlert,
			},
			{
				path: '/privacy',
				labelKey: 'account.privacyCenter',
				descKey: 'account.privacyCenterDesc',
				icon: Lock,
				local: true,
			},
			{
				path: '/account-deletion',
				labelKey: 'account.deleteAccount',
				descKey: 'account.deleteAccountDesc',
				icon: UserX,
				local: true,
			},
		],
	},
];

export default function AccountPage() {
	const { t } = useI18n();
	const slug = useEffectiveTenantSlug();

	usePageTitle('settings.title');

	return (
		<AuthCard maxWidth="2xl" align="start" title={t('settings.title')} subtitle={t('settings.subtitle')}>
			{/* 与概览/活动同一条顶层导航；三个分区宽度一致，切换时不产生横向/纵向跳动 */}
			<DashboardNav current="settings" />

			{GROUPS.map((group) => (
				<section key={group.titleKey} className="space-y-2">
					<h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
						{t(group.titleKey)}
					</h2>
					<div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] divide-y divide-[var(--color-border-subtle)]">
						{group.links.map((link) => (
							<a
								key={link.path}
								href={link.local ? (slug ? `/${slug}${link.path}` : link.path) : userPortalUrl(slug, link.path)}
								className="flex items-start gap-4 p-4 hover:bg-[var(--color-bg-muted)] transition-colors group"
							>
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-muted)] group-hover:bg-brand-soft/20 transition-colors">
									<link.icon
										size={20}
										className="text-[var(--color-text-muted)] group-hover:text-[var(--color-brand)] transition-colors"
									/>
								</div>
								<div>
									<p className="text-sm font-medium text-[var(--color-text-primary)]">
										{t(link.labelKey)}
									</p>
									<p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
										{t(link.descKey)}
									</p>
								</div>
							</a>
						))}
					</div>
				</section>
			))}

			<a
				href={userPortalUrl(slug, '/security')}
				className="text-sm font-medium text-brand-text transition-all duration-200 hover:underline decoration-2 underline-offset-4"
			>
				{t('dashboard.manageSecurity')} →
			</a>
		</AuthCard>
	);
}
