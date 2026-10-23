'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, extractList, getAccessToken, apiClient } from '@autional/shared';
import { authMeSessions, authMeAuditLogs, notifications } from '@autional/shared/generated/api';
import { getMe } from '@/lib/api';
import { AuthCard } from '@/components/auth/AuthCard';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';
import { userPortalUrl } from '@/lib/portal-links';
import { useEffectiveTenantSlug } from '@/hooks/use-tenant-slug';

interface SessionInfo {
	deviceType?: string;
	userAgent?: string;
	isCurrentSession?: boolean;
	lastActiveAt?: string;
}

interface AuditItem {
	id?: string;
	action?: string;
	ip?: string;
	status?: string;
	createdAt?: string;
	timestamp?: string;
}

interface NotificationItem {
	id: string;
	title?: string;
	createdAt?: string;
}

/**
 * 活动分区（第二分区）：**只读**——账号状态、最近活动、在线设备、消息。
 *
 * 与「设置」的边界：本页只回答「发生了什么」，不改任何东西。
 * 写操作（改密/Passkey/MFA/资料/隐私）全部在设置分区；
 * 明细列表（全部活动/会话/消息）一跳进入用户门户。
 */
export default function ActivityPage() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const slug = useEffectiveTenantSlug();
	const { user } = useAuth();
	const accessToken = getAccessToken();
	usePageTitle('activity.title');

	const [loading, setLoading] = useState(true);
	const [meData, setMeData] = useState<any>(null);
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [audit, setAudit] = useState<AuditItem[]>([]);
	const [unread, setUnread] = useState(0);
	const [latestMessage, setLatestMessage] = useState<NotificationItem | null>(null);

	// 四路并行 + allSettled，全部落定才关闭骨架（避免分块插入的位移）。
	const load = useCallback(async () => {
		setLoading(true);
		const [meRes, sessRes, auditRes, notifRes] = await Promise.allSettled([
			getMe(),
			authMeSessions(),
			authMeAuditLogs({ page: 1, page_size: 5 }),
			notifications({ unread_only: true, page: 1, page_size: 1 }),
		]);
		if (meRes.status === 'fulfilled') setMeData(meRes.value);
		if (sessRes.status === 'fulfilled') setSessions(extractList<SessionInfo>(sessRes.value));
		if (auditRes.status === 'fulfilled') setAudit(extractList<AuditItem>(auditRes.value));
		if (notifRes.status === 'fulfilled') {
			const payload = notifRes.value as any;
			setUnread(Number(payload?.total ?? 0));
			const first = extractList<NotificationItem>(payload)[0] ?? null;
			setLatestMessage(first);
		}
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

	if (loading) {
		return <DashboardSkeleton current="activity" message={t('dashboard.loading')} />;
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

	const actionLabel = (action?: string) => {
		const key = ACTION_LABEL_KEYS[action || ''] ?? 'activity.action.other';
		return t(key);
	};

	const isFailure = (status?: string) => /fail|error|deny|reject/i.test(status || '');

	return (
		<AuthCard maxWidth="2xl" align="start">
			<DashboardNav current="activity" />

			<div>
				<h1 className="text-xl font-bold text-brand-text sm:text-2xl">{t('activity.title')}</h1>
				<p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('activity.subtitle')}</p>
			</div>

			{/* 状态摘要：账号状态 / MFA / 最后登录 */}
			<section
				aria-labelledby="activity-status-heading"
				className="space-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4"
			>
				<h2 id="activity-status-heading" className="sr-only">
					{t('activity.statusHeading')}
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
				</div>
			</section>

			{/* 最近活动（审计流前 5 条） */}
			<section aria-labelledby="activity-recent-heading" className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<h2
						id="activity-recent-heading"
						className="text-sm font-semibold text-[var(--color-text-primary)]"
					>
						{t('activity.recent')}
					</h2>
					<a
						href={userPortalUrl(slug, '/activity')}
						className="text-xs font-medium text-brand-text hover:underline decoration-2 underline-offset-4"
					>
						{t('activity.viewAll')} →
					</a>
				</div>

				{audit.length === 0 ? (
					<p className="text-sm text-[var(--color-text-muted)]">{t('activity.noActivity')}</p>
				) : (
					<ul className="divide-y divide-[var(--color-border-subtle)] rounded-md border border-[var(--color-border-subtle)]">
						{audit.map((item, i) => (
							<li
								key={item.id || `${item.action}-${i}`}
								className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
							>
								<span className="flex min-w-0 items-center gap-2">
									<span
										aria-hidden="true"
										className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
											isFailure(item.status) ? 'bg-danger' : 'bg-success'
										}`}
									/>
									<span className="truncate text-[var(--color-text-primary)]">
										{actionLabel(item.action)}
									</span>
									{item.ip && (
										<span className="hidden shrink-0 text-xs text-[var(--color-text-muted)] sm:inline">
											{item.ip}
										</span>
									)}
								</span>
								<span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
									{item.createdAt || item.timestamp
										? new Date((item.createdAt || item.timestamp) as string).toLocaleString()
										: '-'}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* 在线设备 */}
			<section aria-labelledby="activity-sessions-heading" className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<h2
						id="activity-sessions-heading"
						className="text-sm font-semibold text-[var(--color-text-primary)]"
					>
						{t('activity.sessions')}
					</h2>
					<a
						href={userPortalUrl(slug, '/sessions')}
						className="text-xs font-medium text-brand-text hover:underline decoration-2 underline-offset-4"
					>
						{t('activity.manageSessions')} →
					</a>
				</div>

				<p className="text-sm text-[var(--color-text-secondary)]">
					{t('dashboard.sessionsOnline', { count: sessions.length })}
				</p>
				{sessions.length > 0 && (
					<ul className="space-y-1.5">
						{sessions.slice(0, 3).map((s, i) => (
							<li key={i} className="flex items-center justify-between text-xs">
								<span className="truncate text-[var(--color-text-secondary)]">
									{s.deviceType || s.userAgent?.substring(0, 40) || t('dashboard.unknownDevice')}
								</span>
								<span
									className={
										s.isCurrentSession ? 'font-medium text-success-text' : 'text-[var(--color-text-muted)]'
									}
								>
									{s.isCurrentSession ? t('dashboard.currentSession') : s.lastActiveAt || ''}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* 消息（未读优先） */}
			<section aria-labelledby="activity-messages-heading" className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<h2
						id="activity-messages-heading"
						className="text-sm font-semibold text-[var(--color-text-primary)]"
					>
						{t('activity.messages')}
					</h2>
					<a
						href={userPortalUrl(slug, '/notifications')}
						className="text-xs font-medium text-brand-text hover:underline decoration-2 underline-offset-4"
					>
						{t('activity.viewMessages')} →
					</a>
				</div>

				{unread === 0 ? (
					<p className="text-sm text-[var(--color-text-muted)]">{t('activity.noUnread')}</p>
				) : (
					<div className="rounded-md border border-[var(--color-border-subtle)] px-4 py-2.5 text-sm">
						<div className="flex items-center justify-between gap-3">
							<span className="truncate text-[var(--color-text-primary)]">
								{latestMessage?.title || t('activity.newMessage')}
							</span>
							<span className="shrink-0 text-xs font-medium text-brand-text">
								{t('activity.unreadCount', { count: unread })}
							</span>
						</div>
					</div>
				)}
			</section>
		</AuthCard>
	);
}

/** 审计流 action → i18n 键（未收录归「其他操作」，不裸出内部标识） */
const ACTION_LABEL_KEYS: Record<string, string> = {
	login: 'activity.action.login',
	LOGIN: 'activity.action.login',
	login_success_record: 'activity.action.login',
	'auth.login_success': 'activity.action.login',
	'auth.login_failed': 'activity.action.login',
	FAILED_LOGIN: 'activity.action.login',
	logout: 'activity.action.logout',
	LOGOUT: 'activity.action.logout',
	password_change: 'activity.action.passwordChange',
	mfa_enable: 'activity.action.mfa',
	mfa_disable: 'activity.action.mfa',
	profile_update: 'activity.action.profileUpdate',
};
