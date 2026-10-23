'use client';

import { Link } from 'react-router';
import { useI18n } from '@/lib/i18n';
import { useEffectiveTenantSlug } from '@/hooks/use-tenant-slug';

/**
 * 登录后页（dashboard / account）的顶层分区导航。
 *
 * 语义取舍：这是**导航**，不是 Tabs 控件。W3C APG 的 tabs 模式（role=tab/tabpanel +
 * 方向键 + roving tabindex）只适用于「同一页面内切换内容面板」；跨路由切换必须用
 * 链接 + `aria-current="page"`，否则读屏会报「页签数 2、面板缺失」。
 *
 * 稳定性取舍（Apple HIG：不要按条件隐藏分区）：
 * 分区集合固定 2 项，不随角色/数据变化；高 44px（触控最小目标）；手机与桌面同形，
 * 只靠容器宽度收窄，避免断点切换时导航形态跳变。
 */

const SECTIONS = [
	{ key: 'overview', path: '/dashboard', labelKey: 'dashboard.tabs.overview' },
	{ key: 'account', path: '/account', labelKey: 'dashboard.tabs.account' },
] as const;

export function DashboardNav({ current }: { current: 'overview' | 'account' }) {
	const { t } = useI18n();
	const slug = useEffectiveTenantSlug();

	// 当前分区由页面显式声明（不靠 pathname 猜）：裸 /dashboard 与 /<slug>/dashboard
	// 都要落 overview，/account 同理。
	const active = current;

	return (
		<nav
			aria-label={t('dashboard.tabs.label')}
			className="grid grid-cols-2 gap-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-1"
		>
			{SECTIONS.map((section) => {
				const isActive = section.key === active;
				return (
					<Link
						key={section.key}
						to={slug ? `/${slug}${section.path}` : section.path}
						aria-current={isActive ? 'page' : undefined}
						className={`flex min-h-[44px] items-center justify-center rounded-sm px-3 text-sm font-medium transition-colors ${
							isActive
								? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-card'
								: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
						}`}
					>
						{t(section.labelKey)}
					</Link>
				);
			})}
		</nav>
	);
}

export default DashboardNav;
