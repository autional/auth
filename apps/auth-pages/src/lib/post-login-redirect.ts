import {
	getCurrentRole,
	isValidRedirect,
	crossAppUrl,
	ADMIN_CONSOLE_URL,
	SECURITY_DASHBOARD_URL,
	getPortalUrl,
	getRootDomain,
} from '@autional/shared';

export function getPostLoginTarget(opts: {
	tenantSlug?: string | null;
	redirect?: string | null;
	// 响应经 shared 拦截器 camel 化：metadata.portal_preferences → portalPreferences
	user?: { metadata?: { portalPreferences?: { default?: string } } } | null;
}): string {
	if (opts.redirect && isValidRedirect(opts.redirect)) {
		return opts.redirect;
	}

	// 1. 用户偏好的默认 Portal
	const prefs = opts.user?.metadata?.portalPreferences;
	if (prefs?.default) {
		const portalUrl = getPortalUrl(prefs.default, opts.tenantSlug || undefined);
		if (portalUrl) return portalUrl;
	}

	// 2. 角色路由（现有逻辑）
	const role = getCurrentRole();
	if (role === 'super_admin' || role === 'admin') {
		return crossAppUrl(ADMIN_CONSOLE_URL());
	}
	if (role === 'security_admin') {
		return crossAppUrl(SECURITY_DASHBOARD_URL());
	}
	return `/${opts.tenantSlug || ''}/dashboard`.replace('//', '/');
}

/**
 * 回程目标解析（密码登录与 MFA 挑战页共用）。
 *
 * - 只放行 `isValidRedirect` 通过的值（站内相对路径或白名单 origin）；
 * - `app.<根域>` 的管理门户路径缺租户 slug 时补上（`/platform/...` → `/<slug>/platform/...`）。
 *
 * 返回 null 表示无回程目标，调用方走默认落地（dashboard）。
 */
export function resolvePostLoginRedirect(
	redirect: string | null | undefined,
	tenantSlug: string | null,
): string | null {
	if (!redirect || !isValidRedirect(redirect)) return null;
	let finalRedirect = redirect;
	try {
		const url = new URL(redirect);
		// slug 注入目标域名：从当前域名剥离已知 portal 前缀得到根
		const hostParts = window.location.hostname.split('.');
		const knownPrefixes = [
			'auth',
			'admin',
			'security',
			'user',
			'status',
			'trust',
			'platform',
			'authenticator',
		];
		const slugRoot =
			hostParts.length >= 3 && knownPrefixes.includes(hostParts[0])
				? hostParts.slice(1).join('.')
				: getRootDomain(window.location.hostname);
		const slugDomains = ['app.' + slugRoot];
		const slugPaths = [
			'/admin/',
			'/developer/',
			'/security/',
			'/status/',
			'/trust/',
			'/platform/',
		];
		if (
			slugDomains.includes(url.hostname) &&
			tenantSlug &&
			!url.pathname.includes(`/${tenantSlug}/`)
		) {
			const needsSlug = slugPaths.some((p) => url.pathname === p || url.pathname.startsWith(p));
			if (needsSlug) {
				url.pathname = `/${tenantSlug}${url.pathname}`;
				finalRedirect = url.toString();
			}
		}
	} catch {
		/* 相对路径：new URL 抛错属预期，原样返回 */
	}
	return finalRedirect;
}

/**
 * MFA 挑战页 URL：把登录页收到的回程目标随查询串透传（仅透传合法值）。
 */
export function buildMfaChallengeUrl(tenantSlug: string | null, redirect: string | null): string {
	// 无租户 slug（根登录页 /login）走非租户路由；否则会拼出 /null/mfa-challenge
	const base = tenantSlug ? `/${tenantSlug}/mfa-challenge` : '/mfa-challenge';
	return redirect && isValidRedirect(redirect)
		? `${base}?redirect=${encodeURIComponent(redirect)}`
		: base;
}
