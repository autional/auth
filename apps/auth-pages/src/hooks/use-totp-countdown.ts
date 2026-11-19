'use client';

import { useEffect, useState } from 'react';
import {
	TOTP_PERIOD_SECONDS,
	totpPeriodIndex,
	totpSecondsRemaining,
} from '@/lib/totp-countdown';

export interface UseTotpCountdownOptions {
	/** TOTP 周期（秒），默认 30（与库默认值同源） */
	period?: number;
	/** false 时不启动 timer（如码面未挂载），仍返回当前瞬间的快照 */
	enabled?: boolean;
}

export interface UseTotpCountdownResult {
	/** 距下一次刷新的剩余秒数，1..period */
	secondsRemaining: number;
	/** 当前周期序号（同一序号内的码属于同一窗口） */
	periodIndex: number;
	/** 是否刚刷新（剩余 = period，即周期边界那一秒） */
	isRefreshed: boolean;
}

/**
 * TOTP 周期倒计时 Hook。
 *
 * 实现要点：
 * 1. **只存时间戳，不存「剩余秒数」** —— 每秒 tick 用 Date.now() 重算，浏览器节流/休眠
 *    回来时自动对齐到真实栅格，不会因为累计误差与真实失效时刻脱节。
 * 2. **卸载即清 timer**：interval id 在 effect cleanup 里 clearInterval；组件卸载后不再
 *    setNowMs，避免「卸载后 setState」与后台空转。
 */
export function useTotpCountdown(options: UseTotpCountdownOptions = {}): UseTotpCountdownResult {
	const { period = TOTP_PERIOD_SECONDS, enabled = true } = options;
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		if (!enabled) return;
		const tick = () => setNowMs(Date.now());
		// 挂载/重新启用时立刻对齐一次（同值 setState 会被 React 跳过，不产生额外渲染）
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [enabled, period]);

	const secondsRemaining = totpSecondsRemaining(nowMs, period);

	return {
		secondsRemaining,
		periodIndex: totpPeriodIndex(nowMs, period),
		isRefreshed: secondsRemaining === period,
	};
}
