'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, extractList, getAccessToken } from '@autional/shared';
import { authMeSessions } from '@autional/shared/generated/api';
import { getMe } from '@/lib/api';
import { AuthCard } from '@/components/auth/AuthCard';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';
import { userPortalUrl } from '@/lib/portal-links';
import { useEffectiveTenantSlug } from '@/hooks/use-tenant-slug';
import {
	KeyRound,
	Fingerprint,
	ShieldCheck,
	Monitor,
	History,
	UserX,
	type LucideIcon,
} from 'lucide-react';

interface SessionInfo {
	deviceType?: string;
	userAgent?: string;
	isCurrentSession?: boolean;
	lastActiveAt?: string;
}

interface QuickAction {
	path: string;
	labelKey: string;
	descKey: string;
	icon: LucideIcon;
	/** true = 本仓页面；未设 = 用户门户深链（必须带 slug，AUTH-45①） */
	local?: boolean;
}

/**
 * 安全分区（第三分区）。
 *
 * 定位：登录后的「一眼看清 + 一跳可达」页，不复制用户门户的安全页。
 * 数据只读（状态 / MFA / 最后登录 / 在线设备数），写操作全部外链到既有页面：
 * 改密 / Passkey / 两步验证 / 注销在本仓，会话与登录历史在用户门户。
 */
export default function SecurityPage() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const slug = useEffectiveTenantSlug();
	const { user } = useAuth();
	const accessToken = getAccessToken();
	usePageTitle('security.title');

	const [loading, setLoading] = useState(true);
	const [meData, setMeData] = useState<any>(null);
	const [sessions, setSessions] = useState<SessionInfo[]>([]);

	// 两路并行 + allSettled，全部落定才关闭骨架（与概览同口径，避免分块插入的位移）
	const load = useCallback(async () => {
		setLoading(true);
		const [meRes, sessRes] = await Promise.allSettled([getMe(), authMeSessions()]);
		if (meRes.status === 'fulfilled') setMeData(meRes.value);
		if (sessRes.status === 'fulfilled') setSessions(extractList<SessionInfo>(sessRes.value));
		setLoading(false);
	}, []);

	useEffect(() => {
		const token = accessToken || getAccessToken();
		if (!token || token === 'undefined' || token === 'null') {
			if (!user) {
				navigate('/');
				return;
			}
		}
		load();
	}, [accessToken, navigate, load, user]);

	const displayUser = meData || user;

	const localHref = (path: string) => (slug ? `/${slug}${path}` : path);

	const actions: QuickAction[] = [
		{
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
			path: '/sessions',
			labelKey: 'account.sessions',
			descKey: 'account.sessionsDesc',
			icon: Monitor,
		},
		{
			path: '/security/login-history',
			labelKey: 'account.loginHistory',
			descKey: 'account.loginHistoryDesc',
			icon: History,
		},
		{
			path: '/account-deletion',
			labelKey: 'account.deleteAccount',
			descKey: 'account.deleteAccountDesc',
			icon: UserX,
			local: true,
		},
	];

	if (loading) {
		return <DashboardSkeleton current="security" message={t('dashboard.loading')} />;
	}

	const lastLoginText = displayUser?.lastLoginAt
		? new Date(displayUser.lastLoginAt).toLocaleString()
		: t('dashboard.lastLoginUnknown');
	const mfaText =
		displayUser?.mfaEnabled === undefined
			? '-'
			: displayUser.mfaEnabled
				? t('dashboard.mfaEnabled')
				: t('dashboard.mfaDisabled');

	return (
		<AuthCard maxWidth="2xl" align="start">
			<DashboardNav current="security" />

			<div>
				<h1 className="text-xl font-bold text-brand-text sm:text-2xl">{t('security.title')}</h1>
				<p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('security.subtitle')}</p>
			</div>

			{/* 状态摘要：状态 / MFA / 最后登录 / 在线设备 */}
			<section
				aria-labelledby="security-status-heading"
				className="space-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4"
			>
				<h2 id="security-status-heading" className="sr-only">
					{t('security.statusHeading')}
				</h2>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-text-secondary)]">
					<span className="inline-flex items-center gap-1.5">
						<span
							aria-hidden="true"
							className="inline-block h-1.5 w-1.5 rounded-full bg-success"
						/>
						{t('dashboard.status')}: {displayUser?.status || '-'}
					</span>
					<span>MFA: {mfaText}</span>
					<span>
						{t('dashboard.lastLogin')}: {lastLoginText}
					</span>
					<a
						href={userPortalUrl(slug, '/sessions')}
						className="text-brand-text hover:underline decoration-2 underline-offset-4"
					>
						{t('dashboard.sessionsOnline', { count: sessions.length })}
					</a>
				</div>
			</section>

			{/* 快捷操作：写操作全部落在既有页面，本页不自造第二套 */}
			<section aria-labelledby="security-actions-heading" className="space-y-3">
				<h2
					id="security-actions-heading"
					className="text-sm font-semibold text-[var(--color-text-primary)]"
				>
					{t('security.quickActions')}
				</h2>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{actions.map((action) => {
						const href = action.local ? localHref(action.path) : userPortalUrl(slug, action.path);
						return (
							<a
								key={action.path}
								href={href}
								className="flex min-h-[64px] items-start gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-surface)]"
							>
								<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-surface)] text-[var(--color-brand)]">
									<action.icon size={18} aria-hidden="true" />
								</span>
								<span className="min-w-0">
									<span className="block text-sm font-medium text-[var(--color-text-primary)]">
										{t(action.labelKey)}
									</span>
									<span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
										{t(action.descKey)}
									</span>
								</span>
							</a>
						);
					})}
				</div>
			</section>

			<a
				href={userPortalUrl(slug, '/security')}
				className="text-sm font-medium text-brand-text transition-all duration-200 hover:underline decoration-2 underline-offset-4"
			>
				{t('dashboard.manageSecurity')} →
			</a>
		</AuthCard>
	);
}
