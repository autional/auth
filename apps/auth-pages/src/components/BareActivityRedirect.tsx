import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useEffectiveTenantSlug } from '@/hooks/use-tenant-slug';

/**
 * 裸 /activity、/security 的租户规范化（2026-11-08）。
 *
 * 背景：裸路由可渲染，但 URL 无 slug → 租户品牌/CSS/条款链落默认值，
 * 与 /<slug>/activity 不一致。已登录且能从会话解析出租户时，跳到
 * /<slug>/activity；解析不到（匿名/名单不可用）保持原行为，由子节点
 * 的 RequireAuth 走 brand 漏斗。
 */
export function BareActivityRedirect({ children }: { children: ReactNode }) {
	const slug = useEffectiveTenantSlug();
	if (slug) return <Navigate to={`/${slug}/activity`} replace />;
	return <>{children}</>;
}

export default BareActivityRedirect;
