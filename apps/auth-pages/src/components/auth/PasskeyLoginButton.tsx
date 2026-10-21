'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Button } from '@autional/ui';
import { Fingerprint } from 'lucide-react';
import { apiClient, extractApiError, loginWithTokens } from '@autional/shared';
import {
	authWebauthnAuthenticateBeginPost,
	authWebauthnAuthenticateCompletePost,
} from '@autional/shared/generated/api';
import { loadAuthExtras } from '@/lib/api';
import { anchorSessionFromToken } from '@/lib/anchor-session';
import { getPostLoginTarget } from '@/lib/post-login-redirect';
import { useI18n } from '@/lib/i18n';

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
}

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
 * PasskeyLoginButton — WebAuthn Conditional UI integration.
 *
 * 条件式 UI 只在 mode="conditional"（密码表单内）启动：
 *   WebAuthn Conditional Mediation — 绑定 `autocomplete="username webauthn"` 输入框，
 *   浏览器在自动填充列表里提供 passkey，不弹登录框。
 *
 * mode="button" 只响应用户点击，不在挂载时发起任何 WebAuthn 请求。
 * 条件式请求用 AbortController 管理，卸载/切标签/显式登录时立即 abort。
 * 密码自动填充交给浏览器原生 autocomplete，不发起 Credential Management 请求
 * （那会在页面打开时弹出非 passkey 的密码选择框）。
 */
export function PasskeyLoginButton({ email, tenantId, mode = 'button' }: PasskeyLoginButtonProps) {
	const { t } = useI18n();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const { tenantSlug } = useParams();
	const [searchParams] = useSearchParams();
	const redirect = searchParams.get('redirect');

	const isSupported =
		typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

	// === 条件UI (Conditional Mediation)：仅在密码表单内启动 ===
	useEffect(() => {
		if (mode !== 'conditional' || !isSupported) return;
		// 条件式 UI 必须绑定到用户名输入框，否则浏览器无自动填充载体
		if (!document.querySelector('input[autocomplete~="webauthn"]')) return;
		if (
			typeof (window.PublicKeyCredential as any)?.isConditionalMediationAvailable !== 'function'
		) {
			return;
		}

		const controller = new AbortController();
		abortActiveConditional();
		activeConditionalController = controller;

		(async () => {
			try {
				// 检查浏览器是否支持条件UI
				const available = await (window.PublicKeyCredential as any).isConditionalMediationAvailable();
				if (!available || controller.signal.aborted) return;

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
				// NotAllowedError/AbortError = 用户取消或主动中止 — 静默忽略
				if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return;
				// 其他错误静默失败, 不阻塞用户通过常规方式登录
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
	}, [mode, isSupported, tenantId]);

	const handlePasskeyLogin = async () => {
		if (!isSupported) return;
		// 先中止条件式请求：同一时刻浏览器只允许一个 WebAuthn get()，
		// 否则会报 "A request is already pending."。
		abortActiveConditional();
		setLoading(true);
		setError('');

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
			if (err.name === 'AbortError') {
				// 主动中止（切标签/显式登录抢占）不打扰用户
				setError('');
			} else if (err.name === 'NotAllowedError') {
				// 无可用可发现凭据与用户取消同为 NotAllowedError，不能静默：
				// 静默会让「点了没反应」无从排查（2026-10-21 线上实证）。
				setError(t('passkey.noCredentialHint'));
			} else {
				// Problem 契约无 message 字段，标题在 title；直接取 err.message 会退化成
				// axios 的 "Request failed with status code 404"。
				const { code, message } = extractApiError(err, t('passkey.loginFailed'));
				// 61000004：服务端无此用户的凭据记录（行已删除/租户不符）。给可操作文案，
				// 不透出后端英文 title。
				setError(String(code) === '61000004' ? t('passkey.credentialNotFound') : message);
			}
		} finally {
			setLoading(false);
		}
	};

	if (!isSupported) return null;

	if (mode === 'conditional') {
		return null;
	}

	return (
		<div data-testid="passkey-login-button">
			<Button
				variant="outline"
				fullWidth
				onClick={handlePasskeyLogin}
				isLoading={loading}
				data-testid="passkey-submit-button"
			>
				<Fingerprint className="mr-2 h-4 w-4" />
				{t('passkey.submitLogin')}
			</Button>
			{error && (
				<p className="mt-2 text-center text-xs text-danger-text" data-testid="passkey-error">
					{error}
				</p>
			)}
		</div>
	);
}
// force HMR refresh
