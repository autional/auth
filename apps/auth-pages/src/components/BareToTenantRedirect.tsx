import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useEffectiveTenantSlug } from '@/hooks/use-tenant-slug';

/**
 * 裸路由 → 租户段规范化（BareActivityRedirect 的泛化版）。
 * 已登录且能从会话解析出租户时跳 /<slug><to|当前路径>；解析不到保持原行为
 * （由子节点的 RequireAuth 走 brand 漏斗）。
 */
export function BareToTenantRedirect({ children, to }: { children: ReactNode; to?: string }) {
	const slug = useEffectiveTenantSlug();
	const { pathname, search } = useLocation();
	if (slug) return <Navigate to={`/${slug}${to ?? pathname}${search}`} replace />;
	return <>{children}</>;
}
export default BareToTenantRedirect;
