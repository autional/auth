/**
 * Passkey 可用性与降级判定（登录页单点）
 *
 * 三条业务事实（B3，2026-11）：
 *  ① passkey 已是**第一步认证**：登录页在租户未关闭时优先展示，并作为条件式 UI 的默认尝试；
 *  ② RP ID 绑定注册域 —— 登录站只在自己的注册域内提供 passkey，跨注册域（`.com`）发起
 *     必然 origin/RP 校验失败，因此该域一律不渲染入口、不发起条件式请求；
 *  ③ 设备不支持 / 用户取消 / 超时 都是「正常可预期」的结果，必须给可操作的降级出路，
 *     而不是 console.error 或红色报错。
 *
 * 判定逻辑集中在此，组件只负责呈现：单测覆盖本模块即可锁定行为。
 */
import { REGION } from '@/lib/site-env';

/**
 * 不提供 passkey 的注册域后缀（RP ID 不可跨注册域）。
 * 区域值本身走 site-env（region-guard：源码禁写区域域名字面量）。
 */
const NON_PASSKEY_HOST_SUFFIXES = ['.com'] as const;

/** 降级原因：决定展示哪条人话文案与是否是「非错误」提示（tone）。 */
export type PasskeyFailureKind =
	/** 用户取消 / 本机无可发现凭据（NotAllowedError 二者同码） */
	| 'cancelled'
	/** 验证超时 */
	| 'timeout'
	/** origin/RP 校验失败（域名与凭据注册域不一致） */
	| 'security'
	/** 设备/浏览器不具备 WebAuthn 能力 */
	| 'unsupported'
	/** 租户策略关闭（后端 403 passkey disabled by tenant policy） */
	| 'tenant_disabled'
	/** 其它真实错误（服务端问题、无凭据记录等） */
	| 'error';

/** 浏览器 static 侧能力（isConditionalMediationAvailable 为可选实现）。 */
interface PublicKeyCredentialStatics {
	isConditionalMediationAvailable?: () => Promise<boolean>;
}

function credentialStatics(): PublicKeyCredentialStatics | undefined {
	if (typeof window === 'undefined') return undefined;
	// 缺 PublicKeyCredential = 设备/浏览器不具备 WebAuthn
	return (window as unknown as { PublicKeyCredential?: PublicKeyCredentialStatics })
		.PublicKeyCredential;
}

function errorName(err: unknown): string | undefined {
	if (!err || typeof err !== 'object') return undefined;
	const direct = (err as { name?: unknown }).name;
	if (typeof direct === 'string') return direct;
	const nested = (err as { error?: { name?: unknown } }).error;
	if (nested && typeof nested.name === 'string') return nested.name;
	return undefined;
}

/** 当前域是否允许提供 passkey（`.com` 注册域 / com 区域一律不允许）。 */
export function isPasskeyHostAllowed(hostname?: string): boolean {
	if (REGION === 'com') return false;
	const host = (
		hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')
	).toLowerCase();
	// 无 host（SSR / 测试夹具）不拦截：由调用方的能力判定兜底
	if (!host) return true;
	return !NON_PASSKEY_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** 设备/浏览器是否具备 WebAuthn（有 PublicKeyCredential 才谈得上 passkey）。 */
export function isPasskeySupported(): boolean {
	return credentialStatics() !== undefined;
}

/** 是否支持条件式 UI（浏览器自动填充里的 passkey 建议）。不支持 = 只能走按钮。 */
export async function isConditionalMediationSupported(): Promise<boolean> {
	const statics = credentialStatics();
	const probe = statics?.isConditionalMediationAvailable;
	if (typeof probe !== 'function') return false;
	try {
		return !!(await probe());
	} catch {
		return false;
	}
}

/** 当前页面是否应展示/发起 passkey（域 + 设备双条件）。 */
export function isPasskeyAvailable(hostname?: string): boolean {
	return isPasskeyHostAllowed(hostname) && isPasskeySupported();
}

/** 租户策略关闭：后端 403 + `passkey disabled by tenant policy`（Problem 契约，文案在 title）。 */
function isTenantPolicyDisabled(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const response = (err as { response?: { status?: unknown; data?: unknown } }).response;
	if (!response || response.status !== 403) return false;
	const data = response.data;
	if (!data || typeof data !== 'object') return false;
	const { title, detail, message } = data as {
		title?: unknown;
		detail?: unknown;
		message?: unknown;
	};
	const text = String(title ?? detail ?? message ?? '');
	return /passkey/i.test(text) && /(disabled|policy)/i.test(text);
}

/**
 * 把 WebAuthn / API 异常归到降级原因。
 * 注意：AbortError（主动 abort 抢占）不在此列 —— 它是内部控制流，调用方应先短路。
 */
export function classifyPasskeyFailure(err: unknown): PasskeyFailureKind {
	if (isTenantPolicyDisabled(err)) return 'tenant_disabled';
	const name = errorName(err);
	if (name === 'NotAllowedError') return 'cancelled';
	if (name === 'TimeoutError') return 'timeout';
	if (name === 'SecurityError') return 'security';
	if (name === 'NotSupportedError' || name === 'NotSupported') return 'unsupported';
	return 'error';
}
