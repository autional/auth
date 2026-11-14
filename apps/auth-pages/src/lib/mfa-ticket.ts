/**
 * MFA 票据（URL fragment 交付）。
 *
 * 交付形如 `#mfa_ticket=<opaque>&identity=<email>`：票据放 fragment 而非查询串，
 * 因此不进服务端访问日志 / Referer / 前端上报（与 magic-link 凭据同口径）。
 *
 * 消费纪律（硬约束）：
 * - 只在内存里留一份，随后**立即**从地址栏剥离 fragment（历史/截图/书签不再携带票据）；
 * - 不写 sessionStorage / localStorage，不打日志，不放进任何会被上报的地方；
 * - 票据无效/过期/账号不匹配由后端返回 `requires_mfa` 表达，本页不判错，
 *   走既有的挑战页回落（见 page.tsx 的 requiresMfa 分支）。
 */

export interface MfaTicketFragment {
	/** 一次性 MFA 票据（opaque，前端不做格式校验）；缺省为空串 */
	ticket: string;
	/** 可选的登录标识（email），仅用于预填，不得覆盖用户已输入值 */
	identity: string;
}

const EMPTY: MfaTicketFragment = { ticket: '', identity: '' };

/**
 * 纯解析：从 `#a=1&b=2` 形式的 fragment 串取值。
 * 容忍带/不带前导 `#`，缺省参数返回空串，不抛异常。
 */
export function parseMfaTicketFragment(hash: string): MfaTicketFragment {
	if (!hash) return { ...EMPTY };
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	if (!raw) return { ...EMPTY };
	// URLSearchParams 自行处理百分号编码（identity 可能是 email）
	const params = new URLSearchParams(raw);
	const ticket = (params.get('mfa_ticket') || '').trim();
	const identity = (params.get('identity') || '').trim();
	if (!ticket && !identity) return { ...EMPTY };
	return { ticket, identity };
}

/**
 * 读取并剥离：从当前地址栏 fragment 取票据，随后以 `history.replaceState`
 * 抹掉 fragment（保留 path + search）。
 *
 * 无 fragment 时不触碰地址栏 —— 保证「没有票据时行为与旧版完全一致」。
 */
export function consumeMfaTicketFragment(): MfaTicketFragment {
	if (typeof window === 'undefined') return { ...EMPTY };
	const hash = window.location.hash;
	if (!hash || hash === '#') return { ...EMPTY };

	const fragment = parseMfaTicketFragment(hash);
	// 不论是否解析出票据，只要 fragment 非空就剥离：不留半截凭据在地址栏里
	window.history.replaceState(null, '', window.location.pathname + window.location.search);
	return fragment;
}
