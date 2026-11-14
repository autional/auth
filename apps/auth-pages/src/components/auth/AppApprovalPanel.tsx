'use client';

/**
 * 「用 App 确认」面板（MFA 挑战页的免输入验证码路径）。
 *
 * 与桌面二维码登录同构：发起一次审批会话 → 展示 6 位审批码 → 轮询会话状态 →
 * 手机端（身份验证器 PWA）点『是我』后，桌面用服务端签发的 token 走**同一条**登录落地。
 * 差别只有一处：手机不再扫码，而是在待审批列表里按码核对。
 *
 * 契约未进 `@autional/shared` 生成包，故沿用仓内既有裸调用方式（同 QRLoginPanel 的
 * `apiClient.post('/identity/api/v1/auth/qr-login/revoke', …)`）：走同一 axios 实例，
 * 因此同样享受响应信封解包与 camelCase 归一。
 *
 * 生命周期约束：
 * - 只有用户点一次「在 App 中确认」才发起（不自动建会话，避免堆积无谓的待审批项）；
 * - 卸载 / 切走标签页 = 停止轮询 + best-effort 撤销（撤销失败静默，会话仍受服务端 TTL 约束）；
 * - 已走到终态（确认 / 拒绝 / 过期）的会话不再撤销：token 已被服务端消费。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@autional/ui';
import { apiClient, extractApiError } from '@autional/shared';
import { computeDeviceFingerprint } from '@/lib/device-fingerprint';
import { useI18n } from '@/lib/i18n';

const INITIATE_PATH = '/identity/api/v1/auth/login-approval/initiate';
const STATUS_PATH = '/identity/api/v1/auth/qr-login/status';
const REVOKE_PATH = '/identity/api/v1/auth/qr-login/revoke';

/** 与桌面二维码轮询同频（2s）：同一服务端会话状态机，不给后端另加压力。 */
const POLL_INTERVAL_MS = 2000;
/** 连续失败 ≥3 次（≈6s）才给可见提示，避免瞬时抖动闪烁。 */
const POLL_FAILURE_LIMIT = 3;
/** 服务端未回 expires_in 时的兜底有效期（identity 审批会话 TTL 300s）。 */
const DEFAULT_TTL_SECONDS = 300;

interface InitiateResponse {
	requestId?: string;
	sessionToken?: string;
	code?: string;
	expiresIn?: number;
}

interface StatusResponse {
	status?: string;
	accessToken?: string;
	refreshToken?: string;
	/**
	 * 服务端附加语义（additive，旧后端不下发）：
	 * `status === 'cancelled'` 且 `superseded === true` = 被「同主体更高优先级的更新请求」替代
	 * （用户自己在别处重新发起了登录），**不是**被人拒绝。
	 * 缺失/false 时一律按原来的 cancelled（被拒绝）处理，行为零变化。
	 */
	superseded?: boolean;
}

interface AppApprovalPanelProps {
	/** 登录页面持有的 MFA 挑战令牌（审批会话的授权依据）。 */
	challengeToken: string;
	/**
	 * 放弃 App 审批，回落到验证码方式（可选）。
	 * 宿主把码面与面板同屏常驻时**不传**：不存在回落动作，也就不渲染回落按钮。
	 */
	onFallback?: () => void;
	/**
	 * 审批通过：把服务端签发的会话交回页面，由页面执行与码方法**完全相同**的登录落地
	 * （loginWithTokens + anchorSessionFromToken + 回程跳转）。
	 */
	onConfirmed: (accessToken: string, refreshToken: string) => void;
}

type Phase =
	| 'init'
	| 'waiting'
	| 'confirmed'
	| 'confirmedNoToken'
	| 'cancelled'
	| 'superseded'
	| 'expired';

export default function AppApprovalPanel({
	challengeToken,
	onFallback,
	onConfirmed,
}: AppApprovalPanelProps) {
	const { t } = useI18n();

	const [phase, setPhase] = useState<Phase>('init');
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState('');
	const [code, setCode] = useState('');
	/** 会话到期时刻（ms）。用绝对时刻而非递减计数做真源，浏览器节流后仍然准。 */
	const [deadline, setDeadline] = useState(0);
	const [secondsLeft, setSecondsLeft] = useState(0);
	const [pollFailed, setPollFailed] = useState(false);

	/** 当前审批会话令牌（撤销用）；置空即表示不再需要撤销。 */
	const sessionRef = useRef('');
	/** 会话是否已由服务端收敛到终态——终态不再撤销。 */
	const settledRef = useRef(false);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	/** 回调走 ref：父组件每次渲染都会重建 finishLogin，直接进依赖数组会反复重启轮询。 */
	const onConfirmedRef = useRef(onConfirmed);

	useEffect(() => {
		onConfirmedRef.current = onConfirmed;
	}, [onConfirmed]);

	const stopPolling = useCallback(() => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
	}, []);

	const revokeCurrent = useCallback(() => {
		const token = sessionRef.current;
		sessionRef.current = '';
		if (!token) return;
		void apiClient.post(REVOKE_PATH, { token }).catch(() => {
			/* 撤销失败不阻断本地收尾：会话仍受服务端 TTL 约束 */
		});
	}, []);

	const start = useCallback(async () => {
		setStarting(true);
		setStartError('');
		setPollFailed(false);
		settledRef.current = false;
		try {
			// 设备键只用于让手机端区分来源设备；取不到不影响审批本身
			const deviceKey = await computeDeviceFingerprint().catch(() => '');
			const res = await apiClient.post(INITIATE_PATH, {
				challengeToken,
				originUa: typeof navigator === 'undefined' ? '' : navigator.userAgent,
				deviceKey,
			});
			const data = (res?.data ?? null) as InitiateResponse | null;

			const sessionToken = data?.sessionToken || '';
			const approvalCode = data?.code || '';
			if (!sessionToken || !approvalCode) {
				setStartError(t('auth.appApproval.initiateFailed'));
				return;
			}

			const ttl =
				typeof data?.expiresIn === 'number' && data.expiresIn > 0
					? data.expiresIn
					: DEFAULT_TTL_SECONDS;

			sessionRef.current = sessionToken;
			setCode(approvalCode);
			// 两个 state 必须同批写入：只写 deadline 会让「剩余 0 秒」的中间帧被判成已过期
			setSecondsLeft(ttl);
			setDeadline(Date.now() + ttl * 1000);
			setPhase('waiting');
		} catch (err) {
			setStartError(extractApiError(err, t('auth.appApproval.initiateFailed')).message);
		} finally {
			setStarting(false);
		}
	}, [challengeToken, t]);

	// 轮询会话状态：confirmed / cancelled / expired 各自收敛，其余状态继续等
	useEffect(() => {
		if (phase !== 'waiting') return;
		let failures = 0;
		pollRef.current = setInterval(() => {
			const token = sessionRef.current;
			if (!token) return;
			void (async () => {
				try {
					const res = await apiClient.get(STATUS_PATH, { params: { token } });
					const data = (res?.data ?? null) as StatusResponse | null;
					failures = 0;
					setPollFailed(false);
					const status = data?.status || '';
					if (status === 'confirmed') {
						stopPolling();
						settledRef.current = true;
						sessionRef.current = '';
						const accessToken = data?.accessToken || '';
						const refreshToken = data?.refreshToken || '';
						if (!accessToken) {
							// 确认成功却没拿到凭证：不能假装登录成功，给回落地路径
							setPhase('confirmedNoToken');
							return;
						}
						setPhase('confirmed');
						onConfirmedRef.current(accessToken, refreshToken);
						return;
					}
					if (status === 'cancelled' || status === 'expired') {
						stopPolling();
						settledRef.current = true;
						sessionRef.current = '';
						// superseded（被同主体更新请求替代）与「被拒绝」区分：
						// 前者是用户自己在别处重发，不含安全风险语义；字段缺失 → 仍按 cancelled。
						if (status === 'expired') setPhase('expired');
						else if (data?.superseded === true) setPhase('superseded');
						else setPhase('cancelled');
					}
				} catch {
					failures += 1;
					if (failures >= POLL_FAILURE_LIMIT) setPollFailed(true);
				}
			})();
		}, POLL_INTERVAL_MS);
		return stopPolling;
	}, [phase, stopPolling]);

	// 倒计时：绝对时刻 → 剩余秒；归零由下面的 effect 收敛为过期终态
	useEffect(() => {
		if (!deadline) return;
		const tick = () => {
			setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [deadline]);

	useEffect(() => {
		if (phase !== 'waiting' || deadline === 0 || secondsLeft > 0) return;
		stopPolling();
		setPhase('expired');
	}, [phase, deadline, secondsLeft, stopPolling]);

	// 卸载 / 切走标签页：停轮询 + 撤销未用完的会话（best-effort）
	useEffect(
		() => () => {
			stopPolling();
			if (settledRef.current) return;
			revokeCurrent();
		},
		[stopPolling, revokeCurrent],
	);

	const retry = () => {
		setPhase('init');
		setCode('');
		setDeadline(0);
		setSecondsLeft(0);
		setStartError('');
		setPollFailed(false);
	};

	/**
	 * 等待态的唯一退出口：停轮询 + 撤销本次会话 + 回到未发起态。
	 * 同屏宿主不传 onFallback（没有回落按钮），缺了它用户只能白等 TTL。
	 */
	const cancelWaiting = () => {
		stopPolling();
		revokeCurrent();
		retry();
	};

	// 只有页签式宿主传 onFallback 才给回落按钮；同屏宿主不传 → null（码面本来就在旁边）
	const fallbackButton = onFallback ? (
		<button
			type="button"
			onClick={onFallback}
			className="w-full text-center text-sm text-brand-text hover:underline"
		>
			{t('auth.appApproval.useCode')}
		</button>
	) : null;

	if (phase === 'confirmed') {
		return (
			<div className="rounded-md bg-success/10 p-4 text-center">
				<p className="text-sm font-medium text-success-text">
					{t('auth.appApproval.confirmedTitle')}
				</p>
				<p className="mt-1 text-xs text-[var(--color-text-secondary)]">
					{t('auth.appApproval.confirmedDesc')}
				</p>
			</div>
		);
	}

	if (phase === 'confirmedNoToken') {
		return (
			<div className="space-y-4">
				<div
					role="alert"
					className="rounded-md bg-danger/10 p-4 text-center text-sm text-danger-text"
				>
					{t('auth.appApproval.confirmedMissingToken')}
				</div>
				{fallbackButton}
			</div>
		);
	}

	// 被「更晚的同主体请求」替代：中性提示，不构成安全告警（无红字/无「请检查账号安全」）
	if (phase === 'superseded') {
		return (
			<div className="space-y-4">
				<div className="rounded-md border border-brand/30 bg-[var(--color-bg-surface)] p-4 text-center">
					<p className="text-sm font-medium text-[var(--color-text-primary)]">
						{t('auth.appApproval.supersededTitle')}
					</p>
					<p className="mt-1 text-xs text-[var(--color-text-secondary)]">
						{t('auth.appApproval.supersededDesc')}
					</p>
				</div>
				<Button fullWidth onClick={retry}>
					{t('auth.appApproval.retry')}
				</Button>
				{fallbackButton}
			</div>
		);
	}

	if (phase === 'cancelled' || phase === 'expired') {
		return (
			<div className="space-y-4">
				<div className="rounded-md bg-warning/10 p-4 text-center">
					<p className="text-sm font-medium text-warning-text">
						{t(
							phase === 'cancelled'
								? 'auth.appApproval.cancelledTitle'
								: 'auth.appApproval.expiredTitle',
						)}
					</p>
					<p className="mt-1 text-xs text-[var(--color-text-secondary)]">
						{t(
							phase === 'cancelled'
								? 'auth.appApproval.cancelledDesc'
								: 'auth.appApproval.expiredDesc',
						)}
					</p>
				</div>
				<Button fullWidth onClick={retry}>
					{t('auth.appApproval.retry')}
				</Button>
				{fallbackButton}
			</div>
		);
	}

	if (phase === 'init') {
		return (
			<div className="space-y-4">
				<p className="text-sm text-[var(--color-text-secondary)]">
					{t('auth.appApproval.intro')}
				</p>
				{startError && (
					<div role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger-text">
						{startError}
					</div>
				)}
				<Button fullWidth onClick={() => void start()} isLoading={starting}>
					{t('auth.appApproval.start')}
				</Button>
				{fallbackButton}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-brand/30 bg-[var(--color-bg-surface)] p-4 text-center">
				<p className="text-xs text-[var(--color-text-secondary)]">
					{t('auth.appApproval.codeLabel')}
				</p>
				<p
					data-testid="app-approval-code"
					aria-live="polite"
					className="mt-1 font-mono text-4xl font-bold tracking-[0.3em] text-[var(--color-text-primary)]"
				>
					{code}
				</p>
				<p className="mt-2 text-xs text-[var(--color-text-muted)]">
					{t('auth.appApproval.countdown', { seconds: secondsLeft })}
				</p>
			</div>

			<p className="text-center text-sm text-[var(--color-text-secondary)]">
				{t('auth.appApproval.steps')}
			</p>

			{pollFailed && (
				<p role="status" className="text-center text-sm text-warning-text">
					{t('auth.appApproval.networkRetry')}
				</p>
			)}

			<p className="text-center text-xs text-[var(--color-text-muted)]">
				{t('auth.appApproval.stuckHint')}
			</p>

			<button
				type="button"
				onClick={cancelWaiting}
				className="w-full text-center text-sm text-brand-text hover:underline"
			>
				{t('auth.appApproval.cancel')}
			</button>
		</div>
	);
}
