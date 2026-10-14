'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { AuthService, extractItem, getAccessToken, traceEvent, traceRedirect } from '@autional/shared';
import { Button } from '@autional/ui';
import { useI18n } from '@/lib/i18n';
import { fetchTenantSlugByClientId } from '@/lib/oauth-cold-start';
import { AuthCard } from '@/components/auth/AuthCard';

/**
 * 登出确认页（TASK-LS-06 / ITEM-06；OIDC RP-Initiated Logout 1.0 无 hint 浏览器支的承接面）。
 *
 * 到达方式：门户整页导航到 oauth `/api/v1/oauth/logout`（无 hint、无已认证会话、Accept
 * 含 text/html）→ 服务端 302 本页（LogoutConfirmURL 单源派生，client_id /
 * post_logout_redirect_uri / state 原样透传）。
 *
 * 硬约束（AC-LS-019）：
 * - 零副作用：渲染阶段只读展示参数，不发起任何 XHR、不清除本地会话（防探测/防误触发）。
 * - 开放重定向闭合：页面唯一的出站导航目标是**服务端响应里的 location**（仅命中客户端
 *   注册白名单才出）；URL 上的 post_logout_redirect_uri 参数只做展示，绝不直接导航。
 *   服务端无 location（401 / 200 无 location / 网络失败）→ 兜底不出站：能由 client_id
 *   反查出租户 slug 时落同源 `/<slug>/login`（保租户上下文，镜像 TASK-07 冷启动短路），
 *   反查失败才落 auth 域根（EntryRouter 登出闸门 → 品牌裸根）。
 *
 * 登出时序（US-1/US-3）：确认 → 同源 XHR（支 2：无 hint + 已认证会话 → 200
 * {logged_out, location?}；Accept: application/json 防落 302 确认页支）→ 本地会话终结
 * （AuthService.logout，唯一实现）→ 完成态 → 导航。
 */
type Phase = 'idle' | 'submitting' | 'done';

/** 服务端无回跳时的兜底落点：auth 域根（EntryRouter 登出闸门 → 品牌裸根）。 */
const FALLBACK_LANDING = '/';

/**
 * 服务端无 location 时的保租户兜底：client_id → 租户 slug → `/<slug>/login`。
 * 反查失败返回 null，调用方回落 FALLBACK_LANDING。落点为同源相对路径，
 * 不采用 URL 上的 post_logout_redirect_uri（未受信参数），开放重定向闭合不变。
 */
async function resolveTenantLoginFallback(clientId: string): Promise<string | null> {
	if (!clientId) return null;
	const slug = await fetchTenantSlugByClientId(clientId);
	return slug ? `/${slug}/login` : null;
}

/** 服务端 location 可导航性判定（http/https 才整页跳转；非法目标落兜底，防卡死完成态）。 */
function isNavigableUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

export default function LogoutConfirmPage() {
	const { t } = useI18n();
	const location = useLocation();
	const searchParams = new URLSearchParams(location.search);

	const clientId = searchParams.get('client_id') ?? '';
	const postLogoutRedirectUri = searchParams.get('post_logout_redirect_uri') ?? '';
	const state = searchParams.get('state') ?? '';

	const [phase, setPhase] = useState<Phase>('idle');
	const [completion, setCompletion] = useState<{ next: string; fromServer: boolean } | null>(null);
	const navigatedRef = useRef(false);

	const handleConfirm = useCallback(async () => {
		if (phase !== 'idle') return;
		setPhase('submitting');
		traceEvent('logout-confirm-submit');

		// 服务端登出（支 2 契约，LS-05）：携本页 query 原样转发 + Accept: application/json
		// （缺省的 */* 不含 text/html 也走机器流，但显式声明防中间层改写）；有本地令牌时
		// 补 Bearer，与同意页同口径（BFF cookie 与 Bearer 双通道，谁在谁生效）。
		let next = FALLBACK_LANDING;
		let fromServer = false;
		try {
			const headers: Record<string, string> = { Accept: 'application/json' };
			const token = getAccessToken();
			if (token && token !== 'undefined' && token !== 'null') {
				headers.Authorization = `Bearer ${token}`;
			}
			const res = await fetch(`/bff/oauth/api/v1/oauth/logout${location.search}`, {
				method: 'POST',
				headers,
			});
			if (res.ok) {
				const payload: unknown = await res.json().catch(() => null);
				const data = extractItem<{ location?: unknown }>(payload);
				const serverLocation = typeof data?.location === 'string' ? data.location : '';
				if (serverLocation && isNavigableUrl(serverLocation)) {
					next = serverLocation;
					fromServer = true;
				}
			}
		} catch {
			/* 网络失败/非 JSON 响应：落兜底（仍完成本地会话终结） */
		}
		if (!fromServer) {
			// 服务端未给回跳（401 / 200 无 location / 网络失败）：保租户兜底 →
			// client_id 反查 slug 落 /<slug>/login；反查失败保持 auth 域根。
			const slugLanding = await resolveTenantLoginFallback(clientId);
			if (slugLanding) next = slugLanding;
		}

		// 本地会话终结（唯一实现；best-effort 吊销 + 清 localStorage/BFF cookie）。
		try {
			await AuthService.logout();
		} catch {
			/* 设计上不抛；防御性兜底，不阻断完成态 */
		}

		setCompletion({ next, fromServer });
		setPhase('done');
	}, [phase, location.search]);

	// 完成态渲染后执行唯一导航出口（完成态可见一帧再整页跳转；StrictMode 双调用由 ref 去重）。
	useEffect(() => {
		if (phase !== 'done' || !completion || navigatedRef.current) return;
		navigatedRef.current = true;
		traceRedirect(completion.next, {
			reason: completion.fromServer ? 'logout-confirm' : 'logout-confirm-fallback',
			assign: true,
		});
	}, [phase, completion]);

	if (phase === 'done') {
		return (
			<AuthCard title={t('logoutConfirm.doneTitle')} subtitle={t('logoutConfirm.doneDesc')}>
				<div role="status" aria-live="polite" className="flex items-center justify-center py-2">
					<span
						aria-hidden="true"
						className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent"
					/>
				</div>
			</AuthCard>
		);
	}

	return (
		<AuthCard title={t('logoutConfirm.title')} subtitle={t('logoutConfirm.subtitle')}>
			<div className="space-y-5">
				<dl className="space-y-3 text-sm">
					{clientId && (
						<div>
							<dt className="text-[var(--color-text-muted)]">{t('logoutConfirm.clientId')}</dt>
							<dd className="break-all text-[var(--color-text-primary)]">{clientId}</dd>
						</div>
					)}
					{postLogoutRedirectUri && (
						<div>
							<dt className="text-[var(--color-text-muted)]">{t('logoutConfirm.redirectUri')}</dt>
							<dd className="break-all text-[var(--color-text-primary)]">{postLogoutRedirectUri}</dd>
						</div>
					)}
					{state && (
						<div>
							<dt className="text-[var(--color-text-muted)]">{t('logoutConfirm.state')}</dt>
							<dd className="break-all text-[var(--color-text-primary)]">{state}</dd>
						</div>
					)}
				</dl>
				<Button
					type="button"
					fullWidth
					isLoading={phase === 'submitting'}
					aria-busy={phase === 'submitting'}
					onClick={() => {
						void handleConfirm();
					}}
				>
					{phase === 'submitting' ? t('logoutConfirm.confirming') : t('logoutConfirm.confirm')}
				</Button>
			</div>
		</AuthCard>
	);
}
