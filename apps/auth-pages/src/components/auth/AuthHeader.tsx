'use client';

import React, { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

interface AuthHeaderProps {
	/** 页面标题 */
	title: string;
	/** 副标题（可选） */
	subtitle?: string;
	/** Logo 图片 URL（可选） */
	logoUrl?: string;
}

/**
 * 认证页面头部组件
 * 展示 Logo + 标题 + 副标题，用于登录/注册等认证流程页
 */
export function AuthHeader({ title, subtitle, logoUrl }: AuthHeaderProps) {
	const { t } = useI18n();
	// U447：Logo 是横版字标，保持原比例；加载失败时整块隐藏，不留碎图占位。
	const [logoBroken, setLogoBroken] = useState(false);
	useEffect(() => setLogoBroken(false), [logoUrl]);
	return (
		<div className="text-center">
			{logoUrl && !logoBroken && (
				<div className="mb-4 flex justify-center">
					<img
						src={logoUrl}
						alt={t('login.logoAlt')}
						className="h-12 w-auto object-contain"
						onError={() => setLogoBroken(true)}
					/>
				</div>
			)}
			<h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
				{title}
			</h1>
			{subtitle && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{subtitle}</p>}
		</div>
	);
}
