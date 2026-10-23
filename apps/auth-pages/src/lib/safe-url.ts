/**
 * 外链白名单（服务端元数据里 URL 的统一过闸点）。
 *
 * `website` / `logo_uri` 来自 OAuth 客户端元数据（应用方填写），属**半可信**输入：
 * 渲染成 `<a href>` / `<img src>` 前必须过这一层，否则 `javascript:` / `data:` 会成为
 * XSS / 钓鱼入口；协议相对地址（`//evil.com`）也会把用户带到站外。
 *
 * 规则（与 user 门户 `lib/safe-url.ts` 保持同一语义）：
 * - 只放行 `http:` / `https:`；
 * - 必须是绝对 URL 且带主机名（相对路径 / 协议相对一律拒绝）；
 * - 解析失败 → `undefined`，调用方不渲染链接/图片。
 *
 * ⚠️ 该实现目前在 auth / user 两站各有一份（跨仓提取到 `@autional/shared` 需发版，
 * 见 `lite/auth-authorized-apps-20261023/report.md` 未决）；两份的用例集必须一致。
 */
export function safeExternalUrl(raw?: string | null): string | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	if (!trimmed) return undefined;

	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
		if (!parsed.hostname) return undefined;
		return parsed.toString();
	} catch {
		return undefined;
	}
}
