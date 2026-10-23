'use client';

import type React from 'react';
import { useI18n } from '@/lib/i18n';

/**
 * 「我的应用」磁贴（平台门户与已授权应用共用）。
 *
 * 三条约束来自实施规范：
 * 1. 固定高度（`min-h-[104px]`）—— 图标/名称晚到时不改变网格高度（CLS）。
 * 2. 不做 hover-only 操作 —— 手机没有 hover，「管理」入口统一放分组标题右侧。
 * 3. `website` 只接受 http/https —— 授权数据里的 URL 属外部输入，
 *    `javascript:` / `data:` 一律不渲染成链接（防伪协议注入）。
 */
export function isSafeHttpUrl(value?: string): boolean {
	if (!value) return false;
	try {
		const url = new URL(value, window.location.origin);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

export interface AppTileProps {
	/** 展示名（已 i18n 或来自客户端名称） */
	name: string;
	/** 点击目标；非 http/https 或缺失时磁贴降级为不可点击 */
	href?: string;
	/** 图标节点（平台门户用 lucide 图标） */
	icon?: React.ReactNode;
	/** Logo 图片（已授权应用）；加载失败/缺失时回落首字母 */
	logoUrl?: string;
}

export function AppTile({ name, href, icon, logoUrl }: AppTileProps) {
	const { t } = useI18n();
	const safeHref = isSafeHttpUrl(href) ? href : undefined;

	const body = (
		<>
			<span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-[var(--color-bg-surface)] text-[var(--color-brand)]">
				{logoUrl ? (
					<img
						src={logoUrl}
						alt=""
						aria-hidden="true"
						width={44}
						height={44}
						loading="lazy"
						className="h-11 w-11 object-cover"
					/>
				) : icon ? (
					icon
				) : (
					<span className="text-base font-semibold" aria-hidden="true">
						{name.trim().charAt(0).toUpperCase() || '?'}
					</span>
				)}
			</span>
			<span className="line-clamp-2 text-sm font-medium leading-tight text-[var(--color-text-primary)]">
				{name}
			</span>
			{!safeHref && (
				<span className="text-[11px] text-[var(--color-text-muted)]">
					{t('dashboard.appNoLink')}
				</span>
			)}
		</>
	);

	const baseClass =
		'group flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3 text-center transition-colors duration-150';

	if (!safeHref) {
		return (
			<div className={`${baseClass} opacity-70`} data-disabled="true">
				{body}
			</div>
		);
	}

	return (
		<a
			href={safeHref}
			rel="noopener noreferrer"
			className={`${baseClass} hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-surface)]`}
		>
			{body}
		</a>
	);
}

export default AppTile;
