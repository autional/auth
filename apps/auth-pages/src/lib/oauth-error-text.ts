/**
 * OAuth 错误用户化（AUTH-46/47）：服务端错误码/描述 → 本地化文案。
 *
 * 此前服务端英文裸句（"State mismatch — possible CSRF attack"、Gin binding 原文、
 * "PKCE code_challenge is required..."）经 pickErrorText 归一化后仍原样落屏。
 * 本模块是授权链（authorize / callback）错误码 → i18n 键的唯一映射点：
 * - 已知错误码 → 本地化文案（描述级细分子型优先于码级）；
 * - 完全未知的错误码 → 回落描述原文（AUTH-47：未知形态不得吞掉真实原因）；
 * - 一切路径均不直出服务端框架文本（Gin binding 原文经码级映射被吸收）。
 */

type Translate = (key: string, options?: Record<string, unknown> | string) => string;

const CODE_KEYS: Record<string, string> = {
	invalid_request: 'oauth.error.invalidRequest',
	invalid_client: 'oauth.error.invalidClient',
	unauthorized_client: 'oauth.error.unauthorizedClient',
	access_denied: 'oauth.error.accessDenied',
	unsupported_response_type: 'oauth.error.unsupportedResponseType',
	invalid_grant: 'oauth.error.invalidGrant',
	login_required: 'oauth.error.loginRequired',
	invalid_request_uri: 'oauth.error.invalidRequestUri',
	server_error: 'oauth.error.serverError',
	temporarily_unavailable: 'oauth.error.temporarilyUnavailable',
	// shared OAuthCallbackError / 回调页本地 code
	state_mismatch: 'oauth.error.stateMismatch',
	missing_code: 'oauth.error.missingCode',
	pkce_cleared: 'oauth.error.pkceCleared',
	provider_error: 'oauth.error.providerError',
};

// 服务端自由文本 description 的细粒度映射（自有 oauth 服务的固定几型；
// 命中优先于码级——码级 invalid_request 泛化会丢掉 PKCE/redirect_uri 具体原因）
const DESC_PATTERNS: Array<[RegExp, string]> = [
	[/PKCE code_challenge is required/i, 'oauth.error.pkceRequired'],
	[/unsupported code_challenge_method/i, 'oauth.error.pkceMethod'],
	[/redirect_uri not registered/i, 'oauth.error.redirectNotRegistered'],
];

// U555：`redirect_uri not registered` 有两个成因，用户可采取的动作不同——
// ① 应用回调没登记（找应用方补登记）；② 应用把「租户门户客户端」当成了自己的 appId
// （找应用方新建独立应用客户端）。后端自 ddc7f2f 起会按 `kind=portal` 在描述里追加提示，
// 但本模块命中正则后会丢弃原文；因此这里用同意页已取到的 client `kind` 分流子型。
const PORTAL_REDIRECT_KEY = 'oauth.error.redirectNotRegisteredPortal';

export function oauthErrorText(
	t: Translate,
	opts: { code?: string | null; description?: string | null; fallback: string; clientKind?: string | null },
): string {
	const code = (opts.code || '').trim();
	const description = (opts.description || '').trim();
	const isPortal = (opts.clientKind || '').trim().toLowerCase() === 'portal';
	if (description) {
		for (const [pattern, key] of DESC_PATTERNS) {
			if (!pattern.test(description)) continue;
			if (key === 'oauth.error.redirectNotRegistered' && isPortal) return t(PORTAL_REDIRECT_KEY);
			return t(key);
		}
	}
	const key = CODE_KEYS[code];
	if (key) return t(key);
	// 未知错误码：真实描述优先于误导性兜底（AUTH-47）
	if (description) return description;
	return opts.fallback;
}
