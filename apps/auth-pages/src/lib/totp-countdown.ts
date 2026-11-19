/**
 * TOTP 周期倒计时（纯函数，零 IO、不读时钟以外的东西）。
 *
 * 前提事实：TOTP 库默认 **30s 周期 / ±1 窗口 / SHA1 / 6 位**，服务端不可配。
 * 因此「同一串码在周期边界前后失效」是本页唯一能给用户自主解释的失败原因；
 * 倒计时必须与库周期同源（同一个 30s 栅格），否则提示会与真实失效时刻错位。
 *
 * 纪律：本文件只做时间 → 数字/里程碑的换算，不碰 React、不碰 i18n、不读 DOM。
 */

/** TOTP 周期（秒）。与库默认值同源；如服务端未来可配，改这里一处。 */
export const TOTP_PERIOD_SECONDS = 30;

/** 当前时间所属的 TOTP 周期序号（自 epoch 起第几个 period 窗口）。 */
export function totpPeriodIndex(
	nowMs: number = Date.now(),
	period: number = TOTP_PERIOD_SECONDS,
): number {
	return Math.floor(nowMs / 1000 / period);
}

/** 当前周期内已过的整秒，取值 0..period-1（周期边界上为 0）。 */
export function totpElapsedSeconds(
	nowMs: number = Date.now(),
	period: number = TOTP_PERIOD_SECONDS,
): number {
	return Math.floor(nowMs / 1000) % period;
}

/**
 * 距下一次刷新的剩余整秒，取值 1..period。
 *
 * 取值上界含义：周期边界那一刻按「刚刷新、整窗可用」记为 period（30），
 * 刻意不产出 0 —— 0 与「刚刷新」是同一瞬间，显示 0 只会有一闪而过的假倒计时。
 * 故本函数与产品口径 `period - (floor(now/1000) % period)` 完全一致。
 */
export function totpSecondsRemaining(
	nowMs: number = Date.now(),
	period: number = TOTP_PERIOD_SECONDS,
): number {
	const elapsed = totpElapsedSeconds(nowMs, period);
	return elapsed === 0 ? period : period - elapsed;
}

export type TotpAnnouncement = 'refreshed' | 'expiring' | null;

/**
 * 读屏播报里程碑的剩余秒数点。
 *
 * 为什么不是「最后 5 秒每秒都播」：polite live region 是排队播报，1..5 秒连播 5 条
 * 会积压到刷新之后才念完，反而更吵。取 5 / 1 两点即可让用户知道「快刷新了」。
 */
export const TOTP_ANNOUNCE_SECONDS = [5, 1] as const;

/**
 * 给定剩余秒数应播报什么：刷新瞬间（refreshed）/ 里程碑（expiring）/ 不播报（null）。
 * 其余秒数一律静默 —— 可见数字仍在每秒变化，但它在 aria-hidden 子树里，不触发播报。
 */
export function totpAnnouncement(
	secondsRemaining: number,
	period: number = TOTP_PERIOD_SECONDS,
): TotpAnnouncement {
	if (secondsRemaining === period) return 'refreshed';
	if ((TOTP_ANNOUNCE_SECONDS as readonly number[]).includes(secondsRemaining)) return 'expiring';
	return null;
}

/**
 * 该不该把失败文案换成「验证码可能已过期」。
 *
 * 只对 **TOTP**（周期码）成立：sms/email 码不是周期码，61000402 仍是普通失败，
 * 不能把「过期」解释塞给它们（会误导用户干等倒计时）。
 * 注意：本函数只决定**文案**，调用方不得据此跳过 setError（失败语义必须保留）。
 */
export function shouldShowTotpExpiryHint(
	method: string,
	code: number | null | undefined,
	invalidCode: number,
): boolean {
	return method === 'totp' && code === invalidCode;
}
