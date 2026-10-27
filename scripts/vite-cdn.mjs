/**
 * CDN 连接预热注入（各站逐字同源，与 env.mjs / region-copy.mjs 同一分发方式）。
 *
 * 为什么要有它：`tokens.css` 是首屏唯一的跨域阻塞资源，而 CDN 证书与本站不共用
 * （无法连接复用），所以每次冷访都要多付 DNS+TCP+TLS。此前 14 个站各手写一遍
 * `<link rel="preconnect">`，漏写/写错一条都无声失败——这里收敛成一处。
 *
 * 用法（vite.config.ts）：
 *   cdnHeadPlugin({ cdnHost: buildEnv.cdnHost, extraOrigins: [`https://auth.${buildEnv.rootDomain}`] })
 * index.html 里放一行占位：`<!-- preconnect:cdn -->`（缺占位即抛错，不静默）。
 *
 * 为什么两条：`<link rel=stylesheet>`（no-cors）与 `@font-face`（CORS）在 Chrome 走
 * 不同连接池，只写一条另一条仍要重新握手。
 */

const MARKER = '<!-- preconnect:cdn -->';

function trimOrigin(value) {
	return String(value || '').replace(/\/+$/, '');
}

/** 生成本站需要预热的 origin 列表（去重、保持顺序）。 */
export function preconnectOrigins({ cdnHost, extraOrigins = [] }) {
	const all = [trimOrigin(cdnHost), ...extraOrigins.map(trimOrigin)].filter(Boolean);
	return Array.from(new Set(all));
}

export function cdnHeadPlugin({ cdnHost, extraOrigins = [] } = {}) {
	const cdn = trimOrigin(cdnHost);
	const extras = preconnectOrigins({ cdnHost, extraOrigins }).filter((origin) => origin !== cdn);
	if (!cdn) {
		throw new Error('[cdn-head] 缺少 cdnHost，无法注入 preconnect');
	}
	return {
		name: 'cdn-head',
		enforce: 'pre',
		transformIndexHtml(html) {
			if (!html.includes(MARKER)) {
				throw new Error(`[cdn-head] index.html 缺少占位 ${MARKER}`);
			}
			// CDN 两条（stylesheet 的 no-cors + 字体的 CORS）；其它 origin 只需导航用的那条。
			const lines = [
				`<link rel="preconnect" href="${cdn}" />`,
				`<link rel="preconnect" href="${cdn}" crossorigin />`,
				...extras.map((origin) => `<link rel="preconnect" href="${origin}" />`),
			];
			return html.replace(MARKER, lines.join('\n    '));
		},
	};
}

export const PRECONNECT_MARKER = MARKER;
