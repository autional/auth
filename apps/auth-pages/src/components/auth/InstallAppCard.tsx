'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, X } from 'lucide-react';
import { getPortalUrl } from '@autional/shared';
import { useI18n } from '@/lib/i18n';

/** 关闭态存储键（v1 —— 升级文案/行为时可换键，自然回访一次）。 */
const DISMISS_KEY = 'auth.install.dismissed.v1';

type Platform = 'ios' | 'android' | 'desktop';

/**
 * 平台探测：只决定「怎么安装」的提示文案，不做能力判定。
 * iPadOS 13+ 默认上报桌面 UA（Macintosh），用触摸点数旁证。
 */
function detectPlatform(): Platform {
	if (typeof navigator === 'undefined') return 'desktop';
	const ua = navigator.userAgent;
	if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
	if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return 'ios';
	if (/Android/i.test(ua)) return 'android';
	return 'desktop';
}

/** 隐私模式/禁用 Cookie 时 sessionStorage 会抛异常：静默降级为「未关闭」。 */
function readDismissed(): boolean {
	try {
		return window.sessionStorage.getItem(DISMISS_KEY) === '1';
	} catch {
		return false;
	}
}

function writeDismissed(): void {
	try {
		window.sessionStorage.setItem(DISMISS_KEY, '1');
	} catch {
		/* 存储不可用（隐私模式/配额）→ 仅本次会话内关闭，不影响登录 */
	}
}

interface InstallAppCardProps {
	/** 关闭回调（可选）：外部需要感知「用户已关闭」时使用。 */
	onDismiss?: () => void;
}

/**
 * 安装引导卡片
 *
 * 出现在「扫码登录」面板上方，推荐安装/打开 Autional 身份验证器，
 * 给没有安装 App 的用户一条出路（否则扫码登录对他们等于死路）。
 *
 * - 平台自适应：iOS（分享 → 添加到主屏幕）/ Android（菜单 → 安装应用）/ 桌面（地址栏安装图标）。
 * - 二维码指向身份验证器门户（https），手机上可直接打开安装。
 * - 关闭状态存 sessionStorage：本次会话内不再打扰，下次访问重新提示。
 */
export default function InstallAppCard({ onDismiss }: InstallAppCardProps) {
	const { t } = useI18n();
	const [dismissed, setDismissed] = useState(false);
	const [qrCode, setQrCode] = useState('');
	const platform = useMemo<Platform>(() => detectPlatform(), []);
	// 门户地址在渲染期解析（getPortalUrl 依赖 window.location，服务端渲染时为空串）
	const installUrl = useMemo(() => `${getPortalUrl('authenticator')}?from=login`, []);

	// 关闭态在挂载后读取（避免 SSR/首帧不一致）
	useEffect(() => {
		setDismissed(readDismissed());
	}, []);

	// 二维码生成：卸载后不再 setState（effect 内忽略迟到结果）
	useEffect(() => {
		let alive = true;
		QRCode.toDataURL(installUrl, { width: 120, margin: 1 })
			.then((dataUrl) => {
				if (alive) setQrCode(dataUrl);
			})
			.catch(() => {
				/* 生成失败：卡片仍给出直链按钮，不阻断登录 */
			});
		return () => {
			alive = false;
		};
	}, [installUrl]);

	const hint =
		platform === 'ios'
			? t('auth.install.hintIos')
			: platform === 'android'
				? t('auth.install.hintAndroid')
				: t('auth.install.hintDesktop');

	const handleDismiss = () => {
		writeDismissed();
		setDismissed(true);
		onDismiss?.();
	};

	if (dismissed) return null;

	return (
		<div className="relative rounded-md border border-brand/30 bg-brand/10 p-4">
			<button
				type="button"
				onClick={handleDismiss}
				aria-label={t('auth.install.dismiss')}
				className="absolute right-2 top-2 rounded p-1 text-[var(--color-text-muted)] transition hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
			>
				<X className="h-4 w-4" aria-hidden="true" />
			</button>

			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1 pr-4">
					<p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
						<Smartphone className="h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" />
						{t('auth.install.title')}
					</p>
					<p className="mt-1 text-xs text-[var(--color-text-secondary)]">
						{t('auth.install.description')}
					</p>
					<p className="mt-2 text-xs text-[var(--color-text-muted)]">{hint}</p>
					<a
						href={installUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="mt-3 inline-flex items-center justify-center rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
					>
						{t('auth.install.open')}
					</a>
					<p className="mt-2 text-xs text-[var(--color-text-muted)]">
						{t('auth.install.haveApp')}
					</p>
				</div>
				{qrCode && (
					<img
						src={qrCode}
						alt={t('auth.install.qrAlt')}
						width={96}
						height={96}
						className="h-24 w-24 shrink-0 rounded bg-white p-1"
					/>
				)}
			</div>
		</div>
	);
}
