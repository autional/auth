import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TotpCountdown } from '../TotpCountdown';

// 与页面同款 i18n mock：t() 直接回显 key（+ 插值 JSON），便于断言「用了哪个键」
vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key} ${JSON.stringify(opts)}` : key,
		lang: 'zh-CN',
	}),
}));

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

function countdown() {
	return screen.getByTestId('totp-countdown');
}

describe('TotpCountdown', () => {
	it('渲染周期剩余秒数（边界 → 30，随后每秒递减）', () => {
		render(<TotpCountdown />);

		expect(countdown()).toHaveAttribute('data-totp-seconds', '30');
		expect(countdown()).toHaveAttribute('data-totp-refreshed', 'true');

		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(countdown()).toHaveAttribute('data-totp-seconds', '29');
		expect(countdown()).toHaveAttribute('data-totp-refreshed', 'false');
		expect(countdown().textContent).toContain('mfa.challenge.totpCountdown');
		expect(countdown().textContent).toContain('"seconds":29');
	});

	it('刷新瞬间切到「已刷新」文案与成功样式', () => {
		vi.setSystemTime(PERIOD_START + 500); // 边界后 0.5s，仍在刷新那一秒
		render(<TotpCountdown />);

		expect(countdown().textContent).toContain('mfa.challenge.totpRefreshed');
		expect(countdown().className).toContain('text-success-text');
	});

	it('最后 5 秒转警示样式', () => {
		vi.setSystemTime(PERIOD_START + 25_000); // 剩余 5
		render(<TotpCountdown />);

		expect(countdown()).toHaveAttribute('data-totp-seconds', '5');
		expect(countdown().className).toContain('text-warning-text');
	});

	it('倒计时区域是 aria-live=polite；可见数字对读屏隐藏（不每秒打断）', () => {
		render(<TotpCountdown />);

		expect(countdown()).toHaveAttribute('aria-live', 'polite');
		const visible = countdown().querySelector('span[aria-hidden="true"]');
		expect(visible).not.toBeNull();
	});

	it('只有里程碑进入 live region：刷新瞬间播报，普通秒数静默', () => {
		render(<TotpCountdown />);

		const liveRegionText = () =>
			countdown().querySelector('span.sr-only')?.textContent ?? '';

		// 30（刚刷新）→ 刷新播报
		expect(liveRegionText()).toBe('mfa.challenge.totpCountdownLive');

		act(() => {
			vi.advanceTimersByTime(1000);
		});
		// 29 → 静默（否则每秒都会念一遍）
		expect(liveRegionText()).toBe('');

		// 走到剩余 5 → 播报即将刷新
		act(() => {
			vi.advanceTimersByTime(24_000);
		});
		expect(countdown()).toHaveAttribute('data-totp-seconds', '5');
		expect(liveRegionText()).toBe('mfa.challenge.totpExpiringLive {"seconds":5}');

		// 剩余 4 → 又回到静默
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(liveRegionText()).toBe('');
	});

	it('卸载后清 timer：不再更新 DOM（无泄漏）', () => {
		const clearSpy = vi.spyOn(globalThis, 'clearInterval');
		const { unmount } = render(<TotpCountdown />);

		unmount();
		expect(clearSpy).toHaveBeenCalled();
		expect(screen.queryByTestId('totp-countdown')).toBeNull();

		// 卸载后继续推进时间：不应抛错、也不应重建节点
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(screen.queryByTestId('totp-countdown')).toBeNull();
	});
});
