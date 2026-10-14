/**
 * 错误语义的**转发层**（实现已下沉到 @autional/shared）。
 *
 * 为什么保留这个文件：站点内历史代码与测试都按 `@/lib/error-semantics` 引用（其中有 `vi.mock` 该路径的用例），
 * 保留转发可避免无意义的大改；而**语义实现 / 契约镜像 / 生成表 / 生成器 / 漂移门禁都已迁到 @autional/shared**
 * （单一真源一处实现），本文件不再包含任何实现与数据。
 *
 * 纪律不变：页面**不得**手写错误码字面量；码 → 行为一律经本转发层（即包内契约）。
 */
export {
	EMPTY_STATE_CODES,
	ERROR_SEMANTICS,
	ERROR_SEMANTICS_META,
	MAX_RETRIES,
	UNPROVISIONED_CODES,
	errorCodeOf,
	isEmptyStateError,
	isForbiddenError,
	isNotFoundError,
	isRetryableError,
	isRetryableErrorContractFirst,
	isUnauthorizedError,
	isUnprovisionedError,
	semanticsOfCode,
	semanticsOfError,
	shouldRetry,
} from '@autional/shared';
export type { Absence, ErrorClass, ErrorSemantics, UIObservation } from '@autional/shared';
