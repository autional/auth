/**
 * 错误语义消费层（页面唯一入口）。
 *
 * ⚠️ 临时桥（带移除触发条件，非隐性债）：
 *   本文件的「码 → 语义」目录与判定应当**居住在 `@autional/shared`**（该包的
 *   `utils/query-state.ts` 已是状态单一真源，同族目录放一起才是单一出处）。
 *   现状：`@autional/shared` 为**已发布 npm 包**，加导出需发版 + 各站升版，
 *   故先在站内落地以保证修复不被发布节奏阻塞。
 *   移除触发条件：`@autional/shared` 发布含 `error-semantics`（目录 + shouldRetry +
 *   isUnprovisionedError）的版本后，本文件**删除**，各站点改为从包导入；
 *   生成器 `scripts/gen-error-semantics.mjs` 与 `contracts/` 随之下沉到 ui 仓。
 *   到期检查：升级 `@autional/shared` 时若发现包内已有该导出 → 立即执行移除。
 *
 * 两个真源，各司其职、**不重复**：
 *  1) `@autional/shared/utils/query-state`（RC-B4-01 / ADR-B4-01）= **状态**单一真源：
 *     error / 空 / 无权 / 可重试（按 HTTP 状态判定）。
 *  2) `./generated/error-semantics`（由 service-core 契约生成）= **业务码语义**单一真源：
 *     码 → 是否「未开通」/ 期望的 UI 观察。
 *
 * 本文件把二者组合成页面可直接消费的判定。**页面不得再手写错误码字面量**
 * （手抄 = 漂移，正是 2026-10-14 novel-demo「未开通被渲染成加载失败」的根因）。
 */
import {
	classifyQueryState,
	getHttpStatus,
	isForbiddenError,
	isRetryableError,
} from '@autional/shared';

import {
	EMPTY_STATE_CODES,
	ERROR_SEMANTICS,
	ERROR_SEMANTICS_META,
	UNPROVISIONED_CODES,
} from './generated/error-semantics';
import type { ErrorSemantics } from './generated/error-semantics';

// 状态单一真源：原样再导出，消费方只 import 本文件即可（少一个 import 面 = 少一处漂移）。
export { classifyQueryState, getHttpStatus, isForbiddenError, isRetryableError };
export { EMPTY_STATE_CODES, ERROR_SEMANTICS, ERROR_SEMANTICS_META, UNPROVISIONED_CODES };
export type { ErrorSemantics };
export type { QueryState } from '@autional/shared';

/** 从错误对象里取后端 Problem 契约的业务码。兼容形状与 `getHttpStatus` 对齐：
 *  `err.response.data.code`（主形状）、`err.data.code`、`err.code`（fetch/自造错误）。取不到 → undefined。 */
export function errorCodeOf(error: unknown): number | undefined {
	if (error === null || error === undefined || typeof error !== 'object') return undefined;
	const e = error as {
		code?: unknown;
		data?: { code?: unknown };
		response?: { data?: { code?: unknown } };
	};
	const candidates = [e.response?.data?.code, e.data?.code, e.code];
	for (const code of candidates) {
		// 与后端契约一致：错误码为正整数（semantics.go 对 code <= 0 视为非法，DocsPath=about:blank）。
		if (typeof code === 'number' && Number.isInteger(code) && code > 0) return code;
		if (typeof code === 'string' && /^\d+$/.test(code) && Number(code) > 0) return Number(code);
	}
	return undefined;
}

/** 码 → 语义。未收录的码返回 undefined（调用方须显式兜底，禁止猜测）。 */
export function semanticsOfCode(code: number | undefined): ErrorSemantics | undefined {
	return code === undefined ? undefined : ERROR_SEMANTICS[code];
}

/** 错误对象 → 语义。 */
export function semanticsOfError(error: unknown): ErrorSemantics | undefined {
	return semanticsOfCode(errorCodeOf(error));
}

/**
 * 「未开通」判定：HTTP 404 且业务码被契约标记为 `unprovisioned`。
 *
 * 只认契约来源：非 404、或未收录的码一律 false（维持原错误态，不误吞真错误）。
 * 命中即表示「不是失败，是尚未初始化」→ 页面渲染空态（可带开通 CTA）。
 */
export function isUnprovisionedError(error: unknown): boolean {
	if (getHttpStatus(error) !== 404) return false;
	const code = errorCodeOf(error);
	return code !== undefined && UNPROVISIONED_CODES.has(code);
}

/** 该错误是否应按空态渲染（当前 = 未开通集合）。 */
export function isEmptyStateError(error: unknown): boolean {
	if (getHttpStatus(error) !== 404) return false;
	const code = errorCodeOf(error);
	return code !== undefined && EMPTY_STATE_CODES.has(code);
}

/** HTTP 404：按标识寻址的资源不存在（absence=entity）。注：`isUnprovisionedError` 现**无生产调用者**
 *  （台账清空 ⇒ UNPROVISIONED_CODES 为空集）；保留为契约派生的安全网 + 回归锁，不再有任何页面分支依赖它。 */
export function isNotFoundError(err: unknown): boolean {
	return getHttpStatus(err) === 404;
}

/** HTTP 401：登录态失效。 */
export function isUnauthorizedError(err: unknown): boolean {
	return getHttpStatus(err) === 401;
}

/** 单次查询最多重试次数（策略参数，唯一出处）。 */
export const MAX_RETRIES = 1;

/**
 * 重试策略（唯一实现）——`QueryClient` 默认与所有调用方都必须走这里。
 *
 * 只重试「重试可能改变结果」的错误（`isRetryableError`：无状态码 / 5xx / 408 / 429）；
 * 4xx（含 404）一律不重试。**禁止**在 hook / 页面里写 `retry: 1` 或自定义 retry —— 那会盖过
 * 全局默认，使本策略失效（本次改动已因此踩过一次）。
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
	return isRetryableError(error) && failureCount < MAX_RETRIES;
}
