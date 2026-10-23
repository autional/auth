'use client';

import React from 'react';
import { AuthHeader } from './AuthHeader';
import { Link } from 'react-router';
import { useI18n } from '@/lib/i18n';
import { useResolvedTenantSlug } from '@/hooks/use-tenant-slug';

interface AuthCardProps {
	/** 卡片内容 */
	children: React.ReactNode;
	/** 页面标题（可选，传入则自动渲染 AuthHeader） */
	title?: string;
	/** 副标题（可选） */
	subtitle?: string;
	/** Logo 图片 URL（可选） */
	logoUrl?: string;
	/** 隐藏底部法律链接（注册页等已有 checkbox 的页面） */
	hideFooter?: boolean;
	/** 最大宽度（默认 sm=24rem；dashboard/account 用 2xl=42rem，即设计系统最宽档） */
	maxWidth?: 'sm' | 'md' | 'lg' | '2xl';
	/**
	 * 垂直对齐（默认 center）。单任务页（登录/注册/MFA）用 center；
	 * 登录后的多内容页（dashboard/account）必须用 start —— 居中会让内容高度变化时
	 * 整块上下移动（分标签后表现为标签条跳动），且手机上首屏内容被推到中部。
	 */
	align?: 'center' | 'start';
}

const MAX_WIDTH_CLASSES: Record<string, string> = {
	sm: 'max-w-sm',
	md: 'max-w-md',
	lg: 'max-w-lg',
	'2xl': 'max-w-2xl',
};

/**
 * 统一认证卡片容器
 * 居中布局、统一阴影/圆角/宽度、顶部可选 Logo
 * 底部自动渲染租户品牌隐私政策/服务条款链接
 */
export function AuthCard({
	children,
	title,
	subtitle,
	logoUrl,
	hideFooter,
	maxWidth = 'sm',
	align = 'center',
}: AuthCardProps) {
	const { t } = useI18n();
	// AUTH-48/49：页脚法律链按「已解析租户」拼链 —— 脏 slug（名单外）解析为
	// undefined → 回落绝对链，不再把未知 slug 递归带进法律页
	const tenantSlug = useResolvedTenantSlug();
	const showFooter = !hideFooter;

	// 登录后页（align=start）顶部对齐：pt-16 给右上角固定浮层（组织切换/主题/语言）
	// 留位，手机上不压住卡片；登录页（默认 center）保持垂直居中。
	const shellClass =
		align === 'start'
			? 'items-start pt-16 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:pt-8 sm:pb-8'
			: 'items-center py-8';

	return (
		<div className={`flex min-h-screen justify-center px-4 ${shellClass}`}>
			<div
				className={`w-full ${MAX_WIDTH_CLASSES[maxWidth]} space-y-6 rounded-md bg-[var(--color-bg-surface)] p-5 shadow-card sm:p-8`}
			>
				{(title || logoUrl) && (
					<AuthHeader title={title || ''} subtitle={subtitle} logoUrl={logoUrl} />
				)}
				{children}
				{showFooter && (
					<div className="flex justify-center gap-4 pt-4 text-xs text-[var(--color-text-muted)]">
						<Link to={tenantSlug ? `/${tenantSlug}/privacy` : '/privacy'} className="hover:underline">
							{t('auth.privacyPolicy')}
						</Link>
						<Link to={tenantSlug ? `/${tenantSlug}/terms` : '/terms'} className="hover:underline">
							{t('auth.termsOfService')}
						</Link>
					</div>
				)}
			</div>
		</div>
	);
}
