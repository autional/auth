import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTotpCountdown } from '../use-totp-countdown';

// 精确的周期边界（该秒数 %30 === 0）
const PERIOD_START = 1_699_999_980_000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(PERIOD_START);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('useTotpCountdown', () => {
	it('挂载即对齐周期（边界 → 30），每秒递减，跨边界回到 30', () => {
		const { result } = renderHook(() => useTotpCountdown());

		expect(result.current.secondsRemaining).toBe(30);
		expect(result.current.isRefreshed).toBe(true);

		const startPeriod = result.current.periodIndex;

		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(result.current.secondsRemaining).toBe(29);
		expect(result.current.isRefreshed).toBe(false);

		act(() => {
			vi.advanceTimersByTime(28_000);
		});
		expect(result.current.secondsRemaining).toBe(1);

		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(result.current.secondsRemaining).toBe(30);
		expect(result.current.isRefreshed).toBe(true);
		expect(result.current.periodIndex).toBe(startPeriod + 1);
	});

	it('用真实时钟重算，不累计误差（休眠回来后一次 tick 直接对齐）', () => {
		const { result } = renderHook(() => useTotpCountdown());
		expect(result.current.secondsRemaining).toBe(30);

		// 模拟休眠 12s（期间 timer 一次都没触发），回来只补一次 tick：
		// 时钟跳到 +12s，advance 再推进 1s（tick 自身）→ 已过 13s → 剩余 17。
		// 若按「每次 tick 减 1」实现在这里是 29（累计误差），故该断言可区分两种实现。
		act(() => {
			vi.setSystemTime(PERIOD_START + 12_000);
			vi.advanceTimersByTime(1000);
		});
		expect(result.current.secondsRemaining).toBe(17);
	});

	it('卸载后清 timer，不再产生状态更新（无 timer 泄漏）', () => {
		const clearSpy = vi.spyOn(globalThis, 'clearInterval');
		let renders = 0;

		const { unmount } = renderHook(() => {
			renders += 1;
			return useTotpCountdown();
		});

		unmount();
		expect(clearSpy).toHaveBeenCalled();

		const rendersAfterUnmount = renders;
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(renders).toBe(rendersAfterUnmount);
	});

	it('enabled=false 时不启动 timer', () => {
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
		let renders = 0;

		const { result } = renderHook(() => {
			renders += 1;
			return useTotpCountdown({ enabled: false });
		});

		expect(setIntervalSpy).not.toHaveBeenCalled();
		expect(result.current.secondsRemaining).toBe(30);

		const rendersBefore = renders;
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		expect(renders).toBe(rendersBefore);
		expect(result.current.secondsRemaining).toBe(30);
	});
});
