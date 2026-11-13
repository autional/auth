'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Button } from '@autional/ui';
import { apiClient, loginWithTokens, getPortalUrl } from '@autional/shared';
import { loadAuthExtras } from '@/lib/api';
import { anchorSessionFromToken } from '@/lib/anchor-session';
import { authQrLoginInitiatePost, authQrLoginStatus } from '@autional/shared/generated/api';
import { getPostLoginTarget } from '@/lib/post-login-redirect';
import { userFromAccessToken } from '@/lib/session-user';
import { useI18n } from '@/lib/i18n';
import { useCountdown } from '@/hooks/use-countdown';
import QRCode from 'qrcode';

interface QRLoginPanelProps {
	/** 地址栏/slug 解析出的租户；作为发起会话的权威租户（空则回落服务端 header/默认）。 */
	tenantId?: string;
}

/** 数字匹配卡片（pending / scanned 两个状态共用）。 */
function MatchNumberCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-brand/30 bg-brand/10 p-3">
			<p className="text-xs text-[var(--color-text-secondary)] mb-1">{label}</p>
			<span className="text-2xl font-bold tracking-widest text-brand-text">{value}</span>
		</div>
	);
}

export default function QRLoginPanel({ tenantId }: QRLoginPanelProps) {
	const { t } = useI18n();
	const { tenantSlug } = useParams();
	const [searchParams] = useSearchParams();
	const redirect = searchParams.get('redirect');
	const [loading, setLoading] = useState(false);
	const [qrCode, setQrCode] = useState('');
	const [sessionToken, setSessionToken] = useState('');
	const [numberMatching, setNumberMatching] = useState('');
	const [status, setStatus] = useState<'init' | 'pending' | 'scanned' | 'success' | 'error'>('init');
	const [error, setError] = useState('');
	/** 轮询连续失败（网络抖动）→ 给可见提示，而不是静默等到过期。 */
	const [pollError, setPollError] = useState(false);
	const {
		seconds,
		start: startCountdown,
		reset: resetCountdown,
	} = useCountdown({ duration: 300 });
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	/** 取消 = 本地复位 + 通知服务端撤销（公开接口，token 即能力；失败静默兼容旧后端）。 */
	const cancelSession = () => {
		if (sessionToken) {
			void apiClient
				.post('/identity/api/v1/auth/qr-login/revoke', { token: sessionToken })
				.catch(() => {
					/* 撤销失败不阻断本地取消：会话仍受 5 分钟 TTL 约束 */
				});
		}
		setStatus('init');
		setPollError(false);
		if (pollRef.current) clearInterval(pollRef.current);
		resetCountdown();
	};

	const initiateQR = async () => {
		setLoading(true);
		setError('');
		setPollError(false);
		try {
			const data = await authQrLoginInitiatePost(tenantId ? { tenantId } : undefined);
			// 拦截器已解包信封并转 camelCase（AUTH-17 同族）
			const token = data?.sessionToken || '';
			const nm = data?.numberMatching || '';

			setSessionToken(token);
			setNumberMatching(nm);
			// 深链用 https（登录门户的 authenticator 门户地址）：PWA 无法注册自定义 scheme
			// （autional:// 由系统相机/二维码扫描器打不开），https 才能被浏览器正常承接。
			// login-approve 属 authenticator 的 non-tenant 段 ⇒ 不拼租户 slug。
			const url = `${getPortalUrl('authenticator')}/login-approve?token=${encodeURIComponent(token)}&nm=${encodeURIComponent(nm)}`;
			setQrCode(await QRCode.toDataURL(url, { width: 200, margin: 1 }));
			setStatus('pending');
			startCountdown(); // 300s QR code validity
			startPolling(token);
		} catch (err: any) {
			setError(err.message || t('qrLogin.initError'));
		} finally {
			setLoading(false);
		}
	};

	const startPolling = (token: string) => {
		if (pollRef.current) clearInterval(pollRef.current);
		let failures = 0;
		pollRef.current = setInterval(async () => {
			try {
				const data = await authQrLoginStatus({ token });
				const st = data?.status || '';
				failures = 0;
				setPollError(false);

				if (st === 'confirmed' && data?.accessToken) {
					loginWithTokens(
						data.accessToken,
						data.refreshToken || '',
						userFromAccessToken(data.accessToken),
					);
					// AUTH-53⑤：会话建立即锚定（QR 扫码登录；优先地址栏租户，JWT claim 兜底）
					anchorSessionFromToken(data.accessToken || '', {
						slug: tenantSlug || null,
						tenantId: tenantId || null,
					});
					await loadAuthExtras().catch(() => {});
					setStatus('success');
					if (pollRef.current) clearInterval(pollRef.current);
					setTimeout(() => {
						window.location.href = getPostLoginTarget({ tenantSlug, redirect });
					}, 500);
				} else if (st === 'scanned') {
					// 手机已扫码待确认（认证器进入审批页即标记）：给桌面端明确反馈
					setStatus('scanned');
				} else if (st === 'cancelled') {
					setStatus('error');
					setError(t('qrLogin.cancelled'));
					if (pollRef.current) clearInterval(pollRef.current);
				} else if (st === 'expired') {
					setStatus('error');
					setError(t('qrLogin.expired'));
					if (pollRef.current) clearInterval(pollRef.current);
				}
			} catch {
				// 连续失败（≥3 次 ≈ 6s）才提示，避免瞬时抖动闪烁
				failures += 1;
				if (failures >= 3) setPollError(true);
			}
		}, 2000);
	};

	useEffect(() => {
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, []);

	// QR code expired: countdown reached 0
	useEffect(() => {
		if (seconds <= 0 && (status === 'pending' || status === 'scanned')) {
			setStatus('error');
			setError(t('qrLogin.expired'));
			if (pollRef.current) clearInterval(pollRef.current);
		}
	}, [seconds, status, t]);

	return (
		<div className="space-y-4">
			{status !== 'success' && (
				<div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning-text sm:hidden">
					{t('qrLogin.mobileHint')}
				</div>
			)}

			{status === 'init' && (
				<div className="text-center space-y-4">
					<p className="text-sm text-[var(--color-text-secondary)]">{t('qrLogin.instruction')}</p>
					<Button fullWidth onClick={initiateQR} isLoading={loading}>
						{t('qrLogin.getCode')}
					</Button>
				</div>
			)}

			{status === 'pending' && (
				<div className="text-center space-y-4">
					<div className="rounded-lg border border-brand/30 bg-[var(--color-bg-surface)] p-4">
						<img src={qrCode} alt={t('qrLogin.qrCodeAlt')} className="mx-auto h-48 w-48" />
						<p className="mt-2 text-xs text-[var(--color-text-muted)]">
							{t('qrLogin.countdown', { countdown: seconds })}
						</p>
					</div>
					{numberMatching && (
						<MatchNumberCard label={t('qrLogin.matchNumber')} value={numberMatching} />
					)}
					<p className="text-sm text-[var(--color-text-secondary)]">{t('qrLogin.steps')}</p>
					<Button variant="outline" fullWidth onClick={cancelSession}>
						{t('qrLogin.cancel')}
					</Button>
				</div>
			)}

			{status === 'scanned' && (
				<div className="text-center space-y-4">
					<div className="rounded-lg border border-success/30 bg-success/10 p-4">
						<p className="text-sm font-medium text-success-text">{t('qrLogin.scanned')}</p>
						<p className="mt-1 text-xs text-[var(--color-text-secondary)]">
							{t('qrLogin.scannedHint')}
						</p>
					</div>
					{numberMatching && (
						<MatchNumberCard label={t('qrLogin.matchNumber')} value={numberMatching} />
					)}
					<p className="text-xs text-[var(--color-text-muted)]">
						{t('qrLogin.countdown', { countdown: seconds })}
					</p>
					<Button variant="outline" fullWidth onClick={cancelSession}>
						{t('qrLogin.cancel')}
					</Button>
				</div>
			)}

			{(status === 'pending' || status === 'scanned') && pollError && (
				<p className="text-center text-xs text-danger-text">{t('qrLogin.networkRetry')}</p>
			)}

			{status === 'success' && (
				<div className="rounded-lg border border-success/30 bg-success/10 p-6 text-center">
					<p className="text-success-text font-medium">{t('qrLogin.success')}</p>
				</div>
			)}

			{error && (
				<div className="rounded-md bg-danger/10 p-3 text-sm text-danger-text text-center">
					{error}
					{status === 'error' && (
						<Button
							fullWidth
							className="mt-2"
							onClick={() => {
								setStatus('init');
								setError('');
							}}
						>
							{t('qrLogin.retry')}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
