'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Button } from '@autional/ui';
import { Fingerprint } from 'lucide-react';
import { extractApiError, loginWithTokens } from '@autional/shared';
import {
	authWebauthnAuthenticateBeginPost,
	authWebauthnAuthenticateCompletePost,
} from '@autional/shared/generated/api';
import { loadAuthExtras } from '@/lib/api';
import { anchorSessionFromToken } from '@/lib/anchor-session';
import { getPostLoginTarget } from '@/lib/post-login-redirect';
import { useI18n } from '@/lib/i18n';
import {
	classifyPasskeyFailure,
	isConditionalMediationSupported,
	isPasskeyHostAllowed,
	isPasskeySupported,
} from '@/lib/passkey-support';

function base64urlToBuffer(base64url: string): ArrayBuffer {
	const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
	const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
	const bytes = Uint8Array.from(atob(base64 + pad), (c) => c.charCodeAt(0));
	return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const base64 = btoa(String.fromCharCode(...bytes));
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface PasskeyLoginButtonProps {
	email?: string;
	tenantId?: string;
	/**
	 * button（默认）：只渲染显式按钮，不发条件式请求。
	 * conditional：在密码表单内静默启动 WebAuthn 条件式自动填充，不渲染按钮。
	 * 两种模式互斥挂载，避免同一页面同时存在多个 WebAuthn 请求。
	 */
	mode?: 'button' | 'conditional';
	/** 视觉权重：passkey 为首选入口时用 primary（默认 outline = 备选入口）。 */
	variant?: 'primary' | 'secondary' | 'outline';
	/** 触发按钮的 data-testid（登录页首推入口另给值，与标签页面板区分）。 */
	testId?: string;
	/** 降级入口（改用密码 / 验证码登录）：用户取消、超时、设备不支持时展示。 */
	onFallback?: () => void;
}

type PasskeyNotice = { tone: 'hint' | 'error'; text: string };

// 降级原因 → 文案键。可预期结果（取消/超时/设备不支持/租户关闭）一律走 hint（非红色），
// 只有服务端真实故障才走 error（红色）。
const HINT_KEY_BY_FAILURE = {
	cancelled: 'passkey.cancelledHint',
	timeout: 'passkey.timeoutHint',
	security: 'passkey.securityErrorHint',
	unsupported: 'passkey.deviceUnsupportedHint',
	tenant_disabled: 'passkey.tenantDisabledHint',
} as const;

// 全页共享的条件式请求控制器：显式登录或切换标签时先中止旧请求，
// 否则浏览器会以 "A request is already pending." 拒绝后续 get()。
let activeConditionalController: AbortController | null = null;

function abortActiveConditional() {
	if (activeConditionalController) {
		activeConditionalController.abort();
		activeConditionalController = null;
	}
}

/**
 * PasskeyLoginButton — WebAuthn 登录入口（第一步认证）。
 *
 * 条件式 UI 只在 mode="conditional"（密码表单内）启动：
 *   WebAuthn Conditional Mediation — 绑定 `autocomplete="username webauthn"` 输入框，
 *   浏览器在自动填充列表里提供 passkey，不弹登录框，也**不打断用户输入**。
 *
 * mode="button" 只响应用户点击，不在挂载时发起任何 WebAuthn 请求。
 * 条件式请求用 AbortController 管理，卸载/切标签/显式登录时立即 abort。
 * 密码自动填充交给浏览器原生 autocomplete，不发起 Credential Management 请求
 * （那会在页面打开时弹出非 passkey 的密码选择框）。
 *
 * 三条降级约束（B3）：
 *   · `.com` 注册域不提供 passkey —— 不渲染入口、不发起条件式请求（RP ID 不可跨注册域）；
 *   · 设备不支持 / 无法条件式 / 用户取消 / 超时 → 人话说明 + 「改用密码 / 验证码」出路，
 *     其中取消与超时属可预期结果，**不弹红色错误**；
 *   · 租户关闭（后端 403 passkey disabled by tenant policy）→ 同样给降级出路。
 */
export function PasskeyLoginButton({
	email,
	tenantId,
	mode = 'button',
	variant = 'outline',
	testId = 'passkey-submit-button',
	onFallback,
}: PasskeyLoginButtonProps) {
	const { t } = useI18n();
	const [loading, setLoading] = useState(false);
	const [notice, setNotice] = useState<PasskeyNotice | null>(null);
	const [conditionalUnavailable, setConditionalUnavailable] = useState(false);
	const { tenantSlug } = useParams();
	const [searchParams] = useSearchParams();
	const redirect = searchParams.get('redirect');

	// 域白名单：`.com` 注册域下 passkey 必然 origin 校验失败 → 组件彻底隐身
	const hostAllowed = isPasskeyHostAllowed();
	const isSupported = isPasskeySupported();

	// === 条件UI (Conditional Mediation)：仅在密码表单内启动 ===
	useEffect(() => {
		if (mode !== 'conditional' || !hostAllowed || !isSupported) return;
		// 条件式 UI 必须绑定到用户名输入框，否则浏览器无自动填充载体
		if (!document.querySelector('input[autocomplete~="webauthn"]')) return;

		const controller = new AbortController();
		abortActiveConditional();
		activeConditionalController = controller;

		(async () => {
			try {
				// 检查浏览器是否支持条件UI（不支持 → 只保留按钮入口，并说明原因）
				const available = await isConditionalMediationSupported();
				if (controller.signal.aborted) return;
				if (!available) {
					setConditionalUnavailable(true);
					return;
				}

				// 1. 从服务端获取认证挑战（空 email + mediation 表示 discoverable 挑战）
				const beginData = await authWebauthnAuthenticateBeginPost({
					mediation: 'conditional',
					tenantId: tenantId || undefined,
				});
				if (controller.signal.aborted) return;
				// 后端返回 go-webauthn CredentialAssertion（{publicKey:{...}}，经 NewDataResponse 解包后亦然）
				const options = (beginData as any)?.publicKey ?? (beginData as any)?.response ?? beginData;

				// 2. 构建WebAuthn请求选项
				const publicKey: PublicKeyCredentialRequestOptions = {
					challenge: base64urlToBuffer(options.challenge),
					rpId: options.rpId || window.location.hostname,
					userVerification: options.userVerification || 'preferred',
					timeout: options.timeout || 60000,
					// 条件UI使用空allowCredentials, 浏览器自动匹配
					allowCredentials:
						options.allowCredentials?.map((cred: any) => ({
							id: base64urlToBuffer(cred.id),
							type: 'public-key' as const,
							transports: cred.transports as AuthenticatorTransport[],
						})) || [],
				};

				// 3. 启动条件UI（非阻塞 — 浏览器在有可用Passkey时提供自动填充）
				const credential = await navigator.credentials.get({
					publicKey,
					mediation: 'conditional',
					signal: controller.signal,
				});
				if (controller.signal.aborted || !credential) return;

				// 4. 用户选择了Passkey → 自动完成认证
				const cred = credential as PublicKeyCredential;
				const assertion = cred.response as AuthenticatorAssertionResponse;

				const completeData = await authWebauthnAuthenticateCompletePost({
					// 公开路由无租户 ctx：子租户登录页必须显式带上租户，否则凭据按默认租户查
					tenantId: tenantId || undefined,
					credential: {
						id: cred.id,
						rawId: bufferToBase64url(cred.rawId),
						type: cred.type,
						response: {
							clientDataJSON: bufferToBase64url(assertion.clientDataJSON),
							authenticatorData: bufferToBase64url(assertion.authenticatorData),
							signature: bufferToBase64url(assertion.signature),
							userHandle: assertion.userHandle ? bufferToBase64url(assertion.userHandle) : null,
						},
					},
				});

				loginWithTokens(completeData.accessToken, completeData.refreshToken, completeData.user);
				// AUTH-53⑤：会话建立即锚定（slug 取路由上下文；tenantId 尽 prop、JWT claim 兜底）
				anchorSessionFromToken(completeData.accessToken || '', {
					slug: tenantSlug || null,
					tenantId: tenantId || null,
				});
				await loadAuthExtras();
				window.location.href = getPostLoginTarget({
					tenantSlug,
					redirect,
					user: completeData.user,
				});
			} catch (err: any) {
				// 条件式是**静默**尝试：NotAllowedError/AbortError = 用户取消或主动中止，
				// 不打断正在输入的用户，也不留任何提示（显式按钮仍可用）。
				if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return;
				// 其他错误同样静默失败, 不阻塞用户通过常规方式登录
			} finally {
				if (activeConditionalController === controller) {
					activeConditionalController = null;
				}
			}
		})();

		return () => {
			controller.abort();
			if (activeConditionalController === controller) {
				activeConditionalController = null;
			}
		};
	}, [mode, hostAllowed, isSupported, tenantId]);

	const handlePasskeyLogin = async () => {
		if (!isSupported) return;
		// 先中止条件式请求：同一时刻浏览器只允许一个 WebAuthn get()，
		// 否则会报 "A request is already pending."。
		abortActiveConditional();
		setLoading(true);
		setNotice(null);

		try {
			// 1. Request authentication options from server
			// 无邮箱时仍传 mediation=conditional：后端用该字段允许空邮箱、返回
			// discoverable 挑战（空 allowCredentials）。浏览器侧不启用条件式 mediation。
			const beginData = await authWebauthnAuthenticateBeginPost({
				email: email || undefined,
				tenantId: tenantId || undefined,
				mediation: email ? undefined : 'conditional',
			});
			const options = (beginData as any)?.publicKey ?? (beginData as any)?.response ?? beginData;

			// 2. Convert server response to WebAuthn request options
			const publicKey: PublicKeyCredentialRequestOptions = {
				challenge: base64urlToBuffer(options.challenge),
				allowCredentials: options.allowCredentials?.map((cred: any) => ({
					id: base64urlToBuffer(cred.id),
					type: 'public-key' as const,
					transports: cred.transports as AuthenticatorTransport[],
				})),
				userVerification: options.userVerification || 'preferred',
				timeout: options.timeout || 60000,
				rpId: options.rpId || window.location.hostname,
			};

			// 3. Prompt user with browser native Passkey dialog
			const credential = await navigator.credentials.get({ publicKey });
			if (!credential) throw new Error('No credential returned');

			const cred = credential as PublicKeyCredential;
			const assertion = cred.response as AuthenticatorAssertionResponse;

			// 4. Send signed assertion to server (后端契约: 顶层 credential 包裹)
			const data = await authWebauthnAuthenticateCompletePost({
				// 公开路由无租户 ctx：子租户登录页必须显式带上租户，否则凭据按默认租户查
				tenantId: tenantId || undefined,
				credential: {
					id: cred.id,
					rawId: bufferToBase64url(cred.rawId),
					type: cred.type,
					response: {
						clientDataJSON: bufferToBase64url(assertion.clientDataJSON),
						authenticatorData: bufferToBase64url(assertion.authenticatorData),
						signature: bufferToBase64url(assertion.signature),
						userHandle: assertion.userHandle ? bufferToBase64url(assertion.userHandle) : null,
					},
				},
			});

			// 5. Complete login
			loginWithTokens(data.accessToken, data.refreshToken, data.user);
			// AUTH-53⑤：会话建立即锚定（与条件 UI 路径同法）
			anchorSessionFromToken(data.accessToken || '', {
				slug: tenantSlug || null,
				tenantId: tenantId || null,
			});
			await loadAuthExtras().catch(() => {});
			window.location.href = getPostLoginTarget({ tenantSlug, redirect, user: data.user });
		} catch (err: any) {
			if (err?.name === 'AbortError') {
				// 主动中止（切标签/显式登录抢占）不打扰用户
				setNotice(null);
				return;
			}
			const kind = classifyPasskeyFailure(err);
			if (kind !== 'error') {
				// 可预期结果：取消 / 超时 / 域校验失败 / 设备不支持 / 租户关闭
				// → 非红色人话 + 降级入口（继续用密码 / 验证码），不当故障报错
				setNotice({ tone: 'hint', text: t(HINT_KEY_BY_FAILURE[kind]) });
				return;
			}
			// Problem 契约无 message 字段，标题在 title；直接取 err.message 会退化成
			// axios 的 "Request failed with status code 404"。
			const { code, message } = extractApiError(err, t('passkey.loginFailed'));
			// 61000004：无凭据记录；61000101：该租户下查无此用户（地址栏租户与残留租户
			// 不一致的典型表现）。两者都给可操作文案，不透出后端英文 title。
			setNotice({
				tone: 'error',
				text:
					String(code) === '61000004'
						? t('passkey.credentialNotFound')
						: String(code) === '61000101'
							? t('passkey.userNotFound')
							: message,
			});
		} finally {
			setLoading(false);
		}
	};

	// `.com` 注册域：不渲染入口（按钮与条件式提示都不出）
	if (!hostAllowed) return null;

	const fallbackLink = onFallback ? (
		<button
			type="button"
			onClick={onFallback}
			className="mx-auto block text-xs text-brand-text transition-all duration-200 hover:underline decoration-2 underline-offset-4"
			data-testid={`${testId}-fallback`}
		>
			{t('passkey.usePasswordInstead')}
		</button>
	) : null;

	if (mode === 'conditional') {
		// 条件式 UI 不渲染按钮；仅在「设备支持 passkey 但不支持自动填充」时补一句说明，
		// 让用户知道自动填充里为什么没有 passkey（显式按钮入口仍在）。
		return conditionalUnavailable ? (
			<p
				className="mt-2 text-center text-xs text-[var(--color-text-muted)]"
				data-testid="passkey-conditional-unavailable"
				role="status"
			>
				{t('passkey.conditionalUnavailableHint')}
			</p>
		) : null;
	}

	if (!isSupported) {
		// 设备/浏览器不具备 WebAuthn：不留空白，给明确人话 + 降级出路
		return (
			<div data-testid="passkey-login-button" className="space-y-1">
				<p
					className="text-center text-xs text-[var(--color-text-muted)]"
					data-testid="passkey-unsupported-hint"
					role="status"
					aria-live="polite"
				>
					{t('passkey.deviceUnsupportedHint')}
				</p>
				{fallbackLink}
			</div>
		);
	}

	return (
		<div data-testid="passkey-login-button">
			<Button
				variant={variant}
				fullWidth
				onClick={handlePasskeyLogin}
				isLoading={loading}
				data-testid={testId}
			>
				<Fingerprint className="mr-2 h-4 w-4" />
				{t('passkey.submitLogin')}
			</Button>
			{notice && (
				<p
					className={`mt-2 text-center text-xs ${
						notice.tone === 'error'
							? 'text-danger-text'
							: 'text-[var(--color-text-muted)]'
					}`}
					data-testid={notice.tone === 'error' ? 'passkey-error' : 'passkey-hint'}
					role={notice.tone === 'error' ? 'alert' : 'status'}
					aria-live="polite"
				>
					{notice.text}
				</p>
			)}
			{notice && fallbackLink && <div className="mt-1">{fallbackLink}</div>}
		</div>
	);
}
// force HMR refresh
