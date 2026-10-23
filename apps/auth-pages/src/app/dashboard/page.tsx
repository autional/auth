'use client';

import type { ComponentType } from 'react';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
	useAuth,
	extractList,
	apiClient,
	getAccessToken,
	useLogout,
	usePortalCatalog,
	getCurrentTenantId,
	usePublicTenantSlugs,
} from '@autional/shared';
import { authMeMemberships, authMePut } from '@autional/shared/generated/api';
import { getMe } from '@/lib/api';
import { AuthCard } from '@/components/auth/AuthCard';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { AppTile } from '@/components/dashboard/AppTile';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import {
	Shield,
	LogIn,
	ShieldAlert,
	User,
	KeyRound,
	Activity,
	ShieldCheck,
	Settings,
	Code2,
	Globe,
} from 'lucide-react';
import { PendingApprovalBanner } from '@/components/auth/PendingApprovalBanner';
import { MembershipStatusCard, type MembershipInfo } from '@/components/auth/MembershipStatusCard';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';
import { userPortalUrl } from '@/lib/portal-links';
import { useEffectiveTenantSlug } from '@/hooks/use-tenant-slug';

const PORTAL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
	admin: Shield,
	auth: LogIn,
	security: ShieldAlert,
	user: User,
	authenticator: KeyRound,
	status: Activity,
	trust: ShieldCheck,
	platform: Settings,
	developer: Code2,
	landing: Globe,
};

const PORTAL_LABELS: Record<string, string> = {
	admin: 'dashboard.adminConsole',
	security: 'dashboard.securityDashboard',
	user: 'dashboard.userPortal',
	authenticator: 'dashboard.authenticatorApp',
	status: 'dashboard.statusPage',
	trust: 'dashboard.trustCenter',
	platform: 'dashboard.platformConsole',
	developer: 'dashboard.developerPortal',
};

/** GET /oauth/consents 的载荷行（oauth-service 已在 2026-10-23 补充客户端展示元信息） */
interface AuthorizedApp {
	id: string;
	clientId: string;
	clientName?: string;
	/** 显示简称（metadata.alias）：优先于 clientName */
	alias?: string;
	logoUri?: string;
	website?: string;
	scopes?: string;
	grantedAt?: string;
}

/**
 * 展示名优先级：别名 → 去掉门户前缀的名称 → 原名称。
 * "Default Client for demo" 这类前缀对用户没有信息量，兜底时剥掉。
 */
function displayAppName(app: AuthorizedApp): string {
	if (app.alias) return app.alias;
	const name = app.clientName || '';
	return name.replace(/^Default Client for\s+/i, '') || name;
}

interface PortalPrefs {
	show_all: boolean;
	visible: string[];
	default: string;
}

/**
 * 登录后概览页（默认分区）。
 *
 * 信息架构（2026-10-23 重排，实施依据见会话结论）：
 *   1. 我的应用 —— 平台门户 + 已授权应用（默认分区的主内容，首屏可见）
 *   2. 账户与安全 —— 一行摘要（状态 / MFA / 最后登录 / 在线设备）+ 外链
 *   3. 我的组织 —— 成员状态（有数据才渲染）
 *
 * 布局与稳定性约束：
 *   - 容器 `max-w-2xl`（设计系统 PageContainer 的 `full` 档）＋ `align=start`：
 *     分标签切换时内容高度变化不会推动标签条（登录页仍保持垂直居中）。
 *   - 单断点（640）：只改内边距与列数，宽度不再分档。
 *   - 数据全部 settle 后才离开骨架屏：避免「先空白、后插入」造成的位移。
 */
export default function DashboardPage() {
	const navigate = useNavigate();
	const { tenantSlug } = useParams<{ tenantSlug?: string }>();
	// AUTH-41：跨门户深链（账户中心 /security、/sessions）必须带生效租户 slug
	const slug = useEffectiveTenantSlug();
	const { user } = useAuth();
	const accessToken = getAccessToken();
	const { t } = useI18n();
	usePageTitle('dashboard.title');

	// 门户显示名按 code 走 i18n（中文界面本地化）；未收录的 code 回落 API 原名
	const portalLabel = (code: string, fallback: string) => {
		const key = PORTAL_LABELS[code];
		return key ? t(key) : fallback;
	};

	const [loading, setLoading] = useState(true);
	const [meError, setMeError] = useState(false);
	const [meData, setMeData] = useState<any>(null);
	const [memberships, setMemberships] = useState<MembershipInfo[]>([]);
	const [pendingMembers, setPendingMembers] = useState<MembershipInfo[]>([]);
	const [authorizedApps, setAuthorizedApps] = useState<AuthorizedApp[]>([]);
	const [showPrefs, setShowPrefs] = useState(false);
	const [prefs, setPrefs] = useState<PortalPrefs>({
		show_all: true,
		visible: [],
		default: '',
	});

	// 根据租户类型返回默认 Portal 可见性模板
	const getDefaultPrefsByTenantType = (tenantType?: string): PortalPrefs => {
		switch (tenantType) {
			case 'enterprise':
			case 'platform':
				return { show_all: true, visible: [], default: 'admin' };
			case 'consumer':
				return { show_all: false, visible: ['user', 'authenticator'], default: 'user' };
			case 'compliance':
				return { show_all: true, visible: ['admin', 'security', 'user'], default: 'security' };
			default:
				return { show_all: true, visible: [], default: '' };
		}
	};

	// 从 meData/user metadata 加载 Portal 偏好（portal_preferences → portalPreferences，值为 JSON 串）
	useEffect(() => {
		const remote = meData?.metadata?.portalPreferences ?? user?.metadata?.portalPreferences;
		if (remote) {
			try {
				const parsed = typeof remote === 'string' ? JSON.parse(remote) : remote;
				setPrefs({ show_all: true, visible: [], default: '', ...parsed });
			} catch {
				/* ignore */
			}
		} else if (meData?.tenantType || user?.tenant_type) {
			setPrefs(getDefaultPrefsByTenantType(meData?.tenantType || user?.tenant_type));
		}
	}, [meData, user]);

	// 保存 Portal 偏好到远程（经 shared 客户端：拦截器注入鉴权/租户头并把书面 camel 键
	// 转 snake 落库——存储键 portal_preferences；读取侧经拦截器还原为 portalPreferences）
	const savePrefs = useCallback(async (newPrefs: PortalPrefs) => {
		setPrefs(newPrefs);
		setShowPrefs(false);
		try {
			await authMePut({ metadata: { portalPreferences: JSON.stringify(newPrefs) } });
		} catch {
			/* background save */
		}
	}, []);

	// 系统 Portal 列表（shared usePortalCatalog：self 端点 + 容错口径内置）
	const sessionTenantId = user?.tenant_id || getCurrentTenantId();
	const {
		portals: catalogPortals,
		allPortals: catalogAllPortals,
		isLoading: portalsLoading,
	} = usePortalCatalog({
		tenantId: sessionTenantId,
		slug: tenantSlug,
	});

	// 概览数据装载：三路并行 + allSettled，全部落定后才关闭骨架屏（避免分块插入的位移）。
	// /auth/me 失败 → 非阻塞错误态 + 重试；其余两路失败仅隐藏对应块（AUTH-43/44）。
	// 会话/在线设备属于「安全」分区，不在概览装载（见 app/security/page.tsx）。
	const loadAccountData = useCallback(async () => {
		setLoading(true);
		const [meRes, memRes, consentsRes] = await Promise.allSettled([
			getMe(),
			// /auth/me/memberships：payload 为数组（NewDataResponse）
			authMeMemberships(),
			apiClient.get('/oauth/api/v1/oauth/consents'),
		]);

		if (meRes.status === 'fulfilled') {
			setMeData(meRes.value);
			setMeError(false);
		} else {
			setMeError(true);
		}

		if (memRes.status === 'fulfilled') {
			const items = extractList<MembershipInfo>(memRes.value);
			setMemberships(items);
			setPendingMembers(items.filter((m) => m.status === 'pending'));
		}

		if (consentsRes.status === 'fulfilled') {
			const body: unknown = (consentsRes.value as { data?: unknown })?.data;
			setAuthorizedApps(Array.isArray(body) ? (body as AuthorizedApp[]) : []);
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

		loadAccountData();
	}, [accessToken, navigate, loadAccountData]);

	const handleLogout = useLogout();

	// Hook 顺序保持一致：以下计算都在早返回之前完成
	const displayUser = meData || user;

	// 无名称的应用不渲染（后端富化失败/客户端已删时只剩 client_id，显示裸 ID 是噪音）
	const authorizedAppsVisible = useMemo(
		() => authorizedApps.filter((a) => !!displayAppName(a)),
		[authorizedApps],
	);

	// 动态 Portal 列表（usePortalCatalog 已内置排除 auth/landing、order 排序与 URL 拼装）
	const visiblePortals = useMemo(() => {
		if (prefs.show_all || !prefs.visible?.length) return catalogPortals;
		return catalogPortals.filter((p) => prefs.visible.includes(p.code));
	}, [catalogPortals, prefs]);

	// U93：URL 段 slug 必须与会话租户一致 —— 多标签/残留会话下 URL 可能指向另一租户，
	// 本页磁贴按 URL slug 拼链、数据却按会话租户取，混用会导出错租户的入口。
	// 会话租户 → slug 唯一权威 = 公开租户名单 id→name（name 即 slug）。
	const { data: knownTenants } = usePublicTenantSlugs();
	const sessionSlug = useMemo(() => {
		const match = (knownTenants ?? []).find((t) => !!t.id && t.id === sessionTenantId);
		return match?.name || match?.slug || undefined;
	}, [knownTenants, sessionTenantId]);
	const slugMismatch = !!tenantSlug && !!sessionSlug && tenantSlug !== sessionSlug;

	useEffect(() => {
		if (!slugMismatch || !sessionSlug) return;
		// 非登录意图场景：不清会话（区别于登录页「切换品牌」语义），改落会话租户自己的仪表盘
		navigate(`/${sessionSlug}/dashboard`, { replace: true });
	}, [slugMismatch, sessionSlug, navigate]);

	// 不一致期间同样停在骨架态，避免按错 slug 拼出的磁贴闪一帧；
	// portalsLoading 一并纳入：门户目录晚到会让「暂无门户」先渲染再被替换（位移）。
	if (loading || portalsLoading || slugMismatch) {
		return <DashboardSkeleton current="overview" message={t('dashboard.loading')} />;
	}

	const authorizedCount = authorizedAppsVisible.length;

	return (
		<AuthCard maxWidth="2xl" align="start">
			<DashboardNav current="overview" />

			{pendingMembers.length > 0 && (
				<div className="space-y-3">
					{pendingMembers.map((m) => (
						<PendingApprovalBanner key={m.tenantId} tenantName={m.tenantName} status={m.status} />
					))}
				</div>
			)}

			{/* 问候（账号身份 + 状态），信息密度最高的一条 */}
			<div>
				<h1 className="text-xl font-bold text-brand-text sm:text-2xl">
					{t('dashboard.greeting', { name: displayUser?.username || displayUser?.email || '-' })}
				</h1>
				<p className="mt-1 text-sm text-[var(--color-text-secondary)]">
					{displayUser?.email || '-'}
				</p>
			</div>

			{meError && (
				<div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-4 py-3">
					<span className="text-sm text-[var(--color-text-secondary)]">
						{t('dashboard.accountLoadFailed')}
					</span>
					<button
						onClick={loadAccountData}
						className="shrink-0 text-sm font-medium text-brand-text transition-all duration-200 hover:underline decoration-2 underline-offset-4"
					>
						{t('dashboard.retry')}
					</button>
				</div>
			)}

			{/* 我的应用：平台门户 + 已授权应用（同页两组，不拆标签） */}
			<section aria-labelledby="my-apps-heading" className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<h2
						id="my-apps-heading"
						className="text-sm font-semibold text-[var(--color-text-primary)]"
					>
						{t('dashboard.myApps')}
					</h2>
					<div className="flex items-center gap-3">
						<a
							href={userPortalUrl(slug, '/security/authorized-apps')}
							className="text-xs font-medium text-brand-text hover:underline decoration-2 underline-offset-4"
						>
							{t('dashboard.manageAuthorized')}
						</a>
						<button
							onClick={() => setShowPrefs(!showPrefs)}
							className="text-xs text-[var(--color-text-secondary)] hover:underline decoration-2 underline-offset-4"
						>
							{showPrefs ? t('dashboard.hidePrefs') : t('dashboard.showPrefs')}
						</button>
					</div>
				</div>

				{visiblePortals.length > 0 ? (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{visiblePortals.map((p) => {
							const PortalIcon = PORTAL_ICONS[p.code] ?? Globe;
							return (
								<AppTile
									key={`portal-${p.code}`}
									name={portalLabel(p.code, p.name)}
									href={p.url}
									icon={<PortalIcon className="h-6 w-6" aria-hidden="true" />}
								/>
							);
						})}
					</div>
				) : (
					<p className="text-sm text-[var(--color-text-muted)]">
						{t('dashboard.noPortals')}
					</p>
				)}

				{authorizedCount > 0 && (
					<div className="space-y-2 pt-1">
						<h3 className="text-xs font-medium text-[var(--color-text-secondary)]">
							{t('dashboard.groupAuthorized')}
						</h3>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							{authorizedAppsVisible.map((app) => (
								<AppTile
									key={`app-${app.id}`}
									name={displayAppName(app)}
									href={app.website}
									logoUrl={app.logoUri}
								/>
							))}
						</div>
					</div>
				)}

				{authorizedCount === 0 && (
					<p className="text-xs text-[var(--color-text-muted)]">
						{t('dashboard.noAuthorizedApps')}
					</p>
				)}

				{/* Portal 显示偏好：就地编辑，不占独立卡片 */}
				{showPrefs && (
					<div className="space-y-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
						<label className="flex items-center justify-between text-sm">
							<span>{t('dashboard.showAllPortals')}</span>
							<input
								type="checkbox"
								checked={prefs.show_all}
								onChange={(e) => setPrefs({ ...prefs, show_all: e.target.checked })}
								className="h-4 w-4"
							/>
						</label>

						{!prefs.show_all && (
							<div className="grid grid-cols-2 gap-2 pl-1">
								{catalogAllPortals.map((app) => (
									<label key={app.code} className="flex items-center justify-between gap-2 text-sm">
										<span className="truncate">{portalLabel(app.code, app.name)}</span>
										<input
											type="checkbox"
											checked={prefs.visible.includes(app.code)}
											onChange={(e) => {
												const next = e.target.checked
													? [...prefs.visible, app.code]
													: prefs.visible.filter((c: string) => c !== app.code);
												setPrefs({ ...prefs, visible: next });
											}}
											className="h-4 w-4"
										/>
									</label>
								))}
							</div>
						)}

						<div className="flex items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-3 text-sm">
							<span>{t('dashboard.defaultPortal')}</span>
							<select
								value={prefs.default}
								onChange={(e) => setPrefs({ ...prefs, default: e.target.value })}
								className="text-xs border border-[var(--color-border-strong)] rounded-xs px-2 py-1"
							>
								<option value="">{t('dashboard.roleDefault')}</option>
								{catalogAllPortals.map((app) => (
									<option key={app.code} value={app.code}>
										{portalLabel(app.code, app.name)}
									</option>
								))}
							</select>
						</div>

						<button
							onClick={() => savePrefs(prefs)}
							className="w-full rounded-md bg-[var(--color-brand)] px-4 py-2 text-xs text-[var(--color-on-brand)] hover:opacity-90 transition-opacity"
						>
							{t('dashboard.savePrefs')}
						</button>
					</div>
				)}
			</section>

			{/* 我的组织：成员状态（有数据才渲染；待审批已在页首横幅覆盖） */}
			{memberships.length > 0 && <MembershipStatusCard memberships={memberships} />}

			<button
				onClick={handleLogout}
				className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] transition-colors"
			>
				{t('dashboard.logout')}
			</button>
		</AuthCard>
	);
}
