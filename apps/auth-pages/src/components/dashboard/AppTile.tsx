'use client';

import type React from 'react';
import { useI18n } from '@/lib/i18n';
import { safeExternalUrl } from '@/lib/safe-url';

/**
 * 「我的应用」磁贴（平台门户与已授权应用共用）。
 *
 * 三条约束来自实施规范：
 * 1. 固定高度（`min-h-[104px]`）—— 图标/名称晚到时不改变网格高度（CLS）。
 * 2. 不做 hover-only 操作 —— 手机没有 hover，「管理」入口统一放分组标题右侧。
 * 3. `website` / `logoUrl` 只接受**绝对** http/https（见 `lib/safe-url.ts`）：
 *    相对路径与协议相对地址（`//evil.com`）一律不渲染。
 */
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
	const safeHref = safeExternalUrl(href);
	const safeLogo = safeExternalUrl(logoUrl);

	const body = (
		<>
			<span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-[var(--color-bg-surface)] text-[var(--color-brand)]">
				{safeLogo ? (
					<img
						src={safeLogo}
						alt=""
						aria-hidden="true"
						width={44}
						height={44}
						loading="lazy"
						referrerPolicy="no-referrer"
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
		</>
	);

	const baseClass =
		'group flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3 text-center transition-colors duration-150';

	// 没有可用入口：整卡不可点，且不渲染「未配置入口」文字。
	// 每张卡都挂一行灰字只会制造噪音（portal 客户端本就无 website）；
	// 可访问性上由 aria-disabled + title 说明，视觉上保持干净。
	if (!safeHref) {
		return (
			<div
				className={`${baseClass} opacity-70`}
				data-disabled="true"
				aria-disabled="true"
				title={t('dashboard.appNoLink')}
			>
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
