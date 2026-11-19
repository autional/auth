'use client';

import { Clock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { TOTP_PERIOD_SECONDS, totpAnnouncement } from '@/lib/totp-countdown';
import { useTotpCountdown } from '@/hooks/use-totp-countdown';

export interface TotpCountdownProps {
	/** TOTP 周期（秒），默认 30（与库默认值同源） */
	period?: number;
}

/**
 * TOTP 周期倒计时提示（贴在验证码输入框下方）。
 *
 * 无障碍口径（为什么这样写 DOM）：
 * - 容器带 `aria-live="polite"`：满足「倒计时区域是播报区域」；
 * - 每秒变化的可见数字在 `aria-hidden="true"` 子树里：读屏**不会**每秒被打断；
 * - 真正进 live region 的只有 `sr-only` 里的里程碑文本（刷新瞬间 / 最后 5 秒的 5、1 秒两点），
 *   由 `totpAnnouncement()` 决定，见 @/lib/totp-countdown。
 */
export function TotpCountdown({ period = TOTP_PERIOD_SECONDS }: TotpCountdownProps) {
	const { t } = useI18n();
	const { secondsRemaining, isRefreshed } = useTotpCountdown({ period });

	const announcement = totpAnnouncement(secondsRemaining, period);
	const liveText =
		announcement === 'refreshed'
			? t('mfa.challenge.totpCountdownLive')
			: announcement === 'expiring'
				? t('mfa.challenge.totpExpiringLive', { seconds: secondsRemaining })
				: '';

	const tone = isRefreshed
		? 'text-success-text'
		: secondsRemaining <= 5
			? 'text-warning-text'
			: 'text-[var(--color-text-secondary)]';

	return (
		<div
			className={`flex items-center gap-1.5 text-xs ${tone}`}
			data-testid="totp-countdown"
			data-totp-seconds={secondsRemaining}
			data-totp-refreshed={isRefreshed ? 'true' : 'false'}
			aria-live="polite"
		>
			<Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
			<span aria-hidden="true">
				{isRefreshed
					? t('mfa.challenge.totpRefreshed')
					: t('mfa.challenge.totpCountdown', { seconds: secondsRemaining })}
			</span>
			<span className="sr-only">{liveText}</span>
		</div>
	);
}
