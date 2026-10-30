import { decodeJwtPayload } from '@autional/shared';

/**
 * 由 access_token 还原最小可用 user。
 * 扫码/令牌-only 登录没有 user 响应体，而 store.setAuth 在 user 为空时直接 return
 * （导致令牌不落库、后续请求 401）——统一用它补 user。
 */
export function userFromAccessToken(accessToken: string): any {
	const payload = (decodeJwtPayload(accessToken) || {}) as Record<string, any>;
	const custom = (payload.custom || {}) as Record<string, any>;
	return {
		id: String(payload.sub || payload.user_id || ''),
		username: String(custom.username || payload.username || ''),
		email: String(payload.email || ''),
	};
}
