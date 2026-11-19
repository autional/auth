import { describe, it, expect } from 'vitest';
import {
	TOTP_ANNOUNCE_SECONDS,
	TOTP_PERIOD_SECONDS,
	shouldShowTotpExpiryHint,
	totpAnnouncement,
	totpElapsedSeconds,
	totpPeriodIndex,
	totpSecondsRemaining,
} from '../totp-countdown';

// 精确的周期边界：epoch 之后第 56,666,666 个 30s 窗口的起点（该秒数 %30 === 0）。
const PERIOD_START = 1_699_999_980_000;
const SECOND = 1000;

describe('totp-countdown 纯函数', () => {
	it('常量与库默认值同源（30s 周期）', () => {
		expect(TOTP_PERIOD_SECONDS).toBe(30);
	});

	describe('周期剩余秒数（边界 0 / 29 / 30）', () => {
		it('周期起点（已过 0s）→ 剩余 30：把 0 表述成「刚刷新、整窗可用」', () => {
			expect(totpElapsedSeconds(PERIOD_START)).toBe(0);
			expect(totpSecondsRemaining(PERIOD_START)).toBe(30);
		});

		it('已过 1s → 剩余 29', () => {
			expect(totpSecondsRemaining(PERIOD_START + 1 * SECOND)).toBe(29);
		});

		it('周期最后一秒（已过 29s）→ 剩余 1', () => {
			expect(totpElapsedSeconds(PERIOD_START + 29 * SECOND)).toBe(29);
			expect(totpSecondsRemaining(PERIOD_START + 29 * SECOND)).toBe(1);
		});

		it('跨过周期边界（已过 30s）→ 回到 30，周期序号 +1', () => {
			expect(totpSecondsRemaining(PERIOD_START + 30 * SECOND)).toBe(30);
			expect(totpPeriodIndex(PERIOD_START + 30 * SECOND)).toBe(
				totpPeriodIndex(PERIOD_START) + 1,
			);
		});

		it('亚秒截断：+29.999s 仍按已过 29s 计（剩余 1）', () => {
			expect(totpSecondsRemaining(PERIOD_START + 29 * SECOND + 999)).toBe(1);
			// 越过边界后的亚秒：+31.999s 已过 31s → 落入下一周期的第 1 秒
			expect(totpSecondsRemaining(PERIOD_START + 31 * SECOND + 999)).toBe(29);
		});

		it('取值恒在 1..period（永不返回 0）', () => {
			for (let offset = 0; offset < 60 * SECOND; offset += 250) {
				const remaining = totpSecondsRemaining(PERIOD_START + offset);
				expect(remaining).toBeGreaterThanOrEqual(1);
				expect(remaining).toBeLessThanOrEqual(TOTP_PERIOD_SECONDS);
			}
		});

		it('period 可注入（便于服务端将来可配）', () => {
			expect(totpSecondsRemaining(PERIOD_START, 60)).toBe(60);
			expect(totpSecondsRemaining(PERIOD_START + 15 * SECOND, 60)).toBe(45);
			expect(totpPeriodIndex(PERIOD_START, 60)).toBe(1_699_999_980 / 60);
		});

		it('缺省入参走当前时钟', () => {
			const remaining = totpSecondsRemaining();
			expect(remaining).toBeGreaterThanOrEqual(1);
			expect(remaining).toBeLessThanOrEqual(TOTP_PERIOD_SECONDS);
		});
	});

	describe('读屏播报里程碑', () => {
		it('里程碑只落在刷新瞬间与最后 5 秒的两个点', () => {
			expect([...TOTP_ANNOUNCE_SECONDS]).toEqual([5, 1]);
		});

		it('剩余 30（刚刷新）→ refreshed', () => {
			expect(totpAnnouncement(30)).toBe('refreshed');
		});

		it('剩余 5 / 1 → expiring；其余秒数静默', () => {
			expect(totpAnnouncement(5)).toBe('expiring');
			expect(totpAnnouncement(1)).toBe('expiring');
			expect(totpAnnouncement(29)).toBeNull();
			expect(totpAnnouncement(4)).toBeNull();
			expect(totpAnnouncement(2)).toBeNull();
			expect(totpAnnouncement(0)).toBeNull();
		});
	});

	describe('过期提示的适用面', () => {
		const INVALID = 61000402;

		it('TOTP + 61000402 → 用「可能已过期」提示', () => {
			expect(shouldShowTotpExpiryHint('totp', INVALID, INVALID)).toBe(true);
		});

		it('sms / email / backup 的 61000402 不动（不是周期码，塞「过期」会误导）', () => {
			expect(shouldShowTotpExpiryHint('sms', INVALID, INVALID)).toBe(false);
			expect(shouldShowTotpExpiryHint('email', INVALID, INVALID)).toBe(false);
			expect(shouldShowTotpExpiryHint('backup', INVALID, INVALID)).toBe(false);
		});

		it('其它错误码或缺失码不触发', () => {
			expect(shouldShowTotpExpiryHint('totp', 61000409, INVALID)).toBe(false);
			expect(shouldShowTotpExpiryHint('totp', null, INVALID)).toBe(false);
			expect(shouldShowTotpExpiryHint('totp', undefined, INVALID)).toBe(false);
		});
	});
});
