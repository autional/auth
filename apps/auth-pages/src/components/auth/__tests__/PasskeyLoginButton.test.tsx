import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import React from 'react';

// AUTH-53 约束⑤（独立验证 F1 回归锁）：passkey 两登录路径（条件 UI 自动填充 /
// 手动按钮）建立会话后必须调用 anchorSessionFromToken 锚定租户——缺失时从
// 「他租户会话残留」上下文发起的 passkey 新会话会被跨租户守卫误清。

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({ t: (key: string) => key, lang: 'zh-CN', setLang: vi.fn() }),
}));

vi.mock('@/lib/anchor-session', () => ({
	anchorSessionFromToken: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
	loadAuthExtras: vi.fn(async () => {}),
}));

vi.mock('@/lib/post-login-redirect', () => ({
	getPostLoginTarget: vi.fn(() => '/demo/dashboard'),
}));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	apiClient: {},
	loginWithTokens: vi.fn(),
}));

vi.mock('@autional/shared/generated/api', () => ({
	authWebauthnAuthenticateBeginPost: vi.fn(),
	authWebauthnAuthenticateCompletePost: vi.fn(),
}));

vi.mock('@autional/ui', async () => {
	const ReactMod = await import('react');
	return {
		Button: ({ children, onClick, isLoading, variant, fullWidth, ...rest }: any) =>
			ReactMod.createElement('button', { onClick, ...rest }, children),
	};
});

vi.mock('lucide-react', () => ({ Fingerprint: () => null }));

import { PasskeyLoginButton } from '@/components/auth/PasskeyLoginButton';
import { anchorSessionFromToken } from '@/lib/anchor-session';
import { loginWithTokens } from '@autional/shared';
import {
	authWebauthnAuthenticateBeginPost,
	authWebauthnAuthenticateCompletePost,
} from '@autional/shared/generated/api';

const token = (n = 8) => new Uint8Array(n).buffer;

function makeCredential() {
	return {
		id: 'cred-1',
		rawId: token(),
		type: 'public-key',
		response: {
			clientDataJSON: token(),
			authenticatorData: token(),
			signature: token(),
			userHandle: null,
		},
	};
}

function renderButton() {
	return render(
		<MemoryRouter initialEntries={['/demo/login']}>
			<Routes>
				<Route
					path=":tenantSlug/login"
					element={<PasskeyLoginButton email="u@example.com" tenantId="tenant-1" />}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

function renderConditional() {
	return render(
		<MemoryRouter initialEntries={['/demo/login']}>
			<Routes>
				<Route
					path=":tenantSlug/login"
					element={
						<>
							<input autoComplete="username webauthn" />
							<PasskeyLoginButton mode="conditional" tenantId="tenant-1" />
						</>
					}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();

	Object.defineProperty(window, 'PublicKeyCredential', {
		value: Object.assign(function () {}, {
			isConditionalMediationAvailable: vi.fn(async () => false),
		}),
		configurable: true,
	});
	Object.defineProperty(navigator, 'credentials', {
		value: { get: vi.fn(async () => makeCredential()) },
		configurable: true,
	});

	vi.mocked(authWebauthnAuthenticateBeginPost).mockResolvedValue({
		publicKey: { challenge: 'Y2hhbGxlbmdl', allowCredentials: [] },
	} as any);
	vi.mocked(authWebauthnAuthenticateCompletePost).mockResolvedValue({
		accessToken: 'at-1',
		refreshToken: 'rt-1',
		user: { id: 'u-1' },
	} as any);
});

describe('PasskeyLoginButton - AUTH-53⑤ 会话锚定', () => {
	it('手动按钮路径：登录成功后锚定租户（slug 取路由、tenantId 取 prop）', async () => {
		renderButton();

		fireEvent.click(screen.getByTestId('passkey-submit-button'));

		await waitFor(() => {
			expect(vi.mocked(anchorSessionFromToken)).toHaveBeenCalledWith('at-1', {
				slug: 'demo',
				tenantId: 'tenant-1',
			});
		});
		expect(vi.mocked(loginWithTokens)).toHaveBeenCalledWith('at-1', 'rt-1', { id: 'u-1' });
		// 子租户缺口回归锁：complete 必须显式带 tenant_id（公开路由 ctx 无租户）
		expect(vi.mocked(authWebauthnAuthenticateCompletePost)).toHaveBeenCalledWith(
			expect.objectContaining({ tenantId: 'tenant-1' }),
		);
	});

	// 回归锁（2026-10-21 线上：页面一打开连弹密码选择框、点按钮又弹第二个框）：
	// Credential Management 的 password 请求已移除，点按钮只允许发起一个 passkey 请求。
	it('点击登录只发起一次 passkey 请求，不发起 password 凭据请求', async () => {
		renderButton();

		fireEvent.click(screen.getByTestId('passkey-submit-button'));

		await waitFor(() => {
			expect(vi.mocked(navigator.credentials.get)).toHaveBeenCalledTimes(1);
		});
		const calls = vi.mocked(navigator.credentials.get).mock.calls;
		expect(calls[0][0]).toHaveProperty('publicKey');
		for (const [opts] of calls) {
			expect(opts).not.toHaveProperty('password');
		}
	});

	// 回归锁（2026-10-21 线上：本机无可发现凭据时浏览器返回 NotAllowedError，
	// 旧实现当作用户取消静默吞掉，表现为「点按钮没反应」）。
	it('无可用可发现凭据（NotAllowedError）时显示提示而非静默', async () => {
		vi.mocked(navigator.credentials.get).mockRejectedValueOnce(
			new DOMException('no credentials available', 'NotAllowedError'),
		);

		renderButton();
		fireEvent.click(screen.getByTestId('passkey-submit-button'));

		await waitFor(() => {
			expect(screen.getByTestId('passkey-error')).toHaveTextContent('passkey.noCredentialHint');
		});
	});

	// 回归锁（2026-10-21 线上：complete 返回 problem 契约 404/61000004，
	// 旧实现只读 data.message，退化成 axios 的 "Request failed with status code 404"）。
	it('服务端无凭据（61000004）时显示本地化提示，而非 axios 状态码文案', async () => {
		vi.mocked(authWebauthnAuthenticateCompletePost).mockRejectedValueOnce({
			message: 'Request failed with status code 404',
			response: {
				status: 404,
				data: { code: 61000004, title: 'no credentials found for user', status: 404 },
			},
		});

		renderButton();
		fireEvent.click(screen.getByTestId('passkey-submit-button'));

		await waitFor(() => {
			expect(screen.getByTestId('passkey-error')).toHaveTextContent(
				'passkey.credentialNotFound',
			);
		});
	});

	// 回归锁（2026-10-23 线上 61000101 user not found）：残留租户 A + 地址栏 platform
	// 时旧实现透出后端英文 title；必须本地化为可操作提示。
	it('该租户查无此用户（61000101）时显示本地化提示', async () => {
		vi.mocked(authWebauthnAuthenticateCompletePost).mockRejectedValueOnce({
			message: 'Request failed with status code 400',
			response: {
				status: 400,
				data: { code: 61000101, title: 'user not found', status: 400 },
			},
		});

		renderButton();
		fireEvent.click(screen.getByTestId('passkey-submit-button'));

		await waitFor(() => {
			expect(screen.getByTestId('passkey-error')).toHaveTextContent('passkey.userNotFound');
		});
	});

	it('其他服务端错误透出 problem title，而不是 axios 泛化文案', async () => {
		vi.mocked(authWebauthnAuthenticateCompletePost).mockRejectedValueOnce({
			message: 'Request failed with status code 400',
			response: { status: 400, data: { code: 40000502, title: 'invalid tenant', status: 400 } },
		});

		renderButton();
		fireEvent.click(screen.getByTestId('passkey-submit-button'));

		await waitFor(() => {
			expect(screen.getByTestId('passkey-error')).toHaveTextContent('invalid tenant');
		});
	});

	it('条件 UI 自动填充路径：登录成功后同样锚定租户', async () => {
		(window.PublicKeyCredential as any).isConditionalMediationAvailable = vi.fn(
			async () => true,
		);

		renderConditional();

		await waitFor(() => {
			expect(vi.mocked(anchorSessionFromToken)).toHaveBeenCalledWith('at-1', {
				slug: 'demo',
				tenantId: 'tenant-1',
			});
		});
		// 子租户缺口回归锁：条件 UI 的 complete 同样必须显式带 tenant_id
		expect(vi.mocked(authWebauthnAuthenticateCompletePost)).toHaveBeenCalledWith(
			expect.objectContaining({ tenantId: 'tenant-1' }),
		);
	});
});

describe('PasskeyLoginButton - 条件式请求生命周期', () => {
	it('button 模式挂载时不发起任何 WebAuthn 请求', async () => {
		renderButton();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(vi.mocked(authWebauthnAuthenticateBeginPost)).not.toHaveBeenCalled();
		expect(navigator.credentials.get).not.toHaveBeenCalled();
	});

	it('conditional 模式不渲染按钮，且只启动一次条件式请求', async () => {
		(window.PublicKeyCredential as any).isConditionalMediationAvailable = vi.fn(
			async () => true,
		);

		renderConditional();

		await waitFor(() => {
			expect(vi.mocked(authWebauthnAuthenticateBeginPost)).toHaveBeenCalledTimes(1);
		});
		expect(screen.queryByTestId('passkey-submit-button')).not.toBeInTheDocument();

		const getCalls = vi.mocked(navigator.credentials.get).mock.calls;
		expect(getCalls[0][0]).toMatchObject({ mediation: 'conditional' });
		expect((getCalls[0][0] as any).signal).toBeInstanceOf(AbortSignal);
	});

	it('没有 username webauthn 输入框时不启动条件式请求', async () => {
		(window.PublicKeyCredential as any).isConditionalMediationAvailable = vi.fn(
			async () => true,
		);

		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<PasskeyLoginButton mode="conditional" tenantId="tenant-1" />
			</MemoryRouter>,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(vi.mocked(authWebauthnAuthenticateBeginPost)).not.toHaveBeenCalled();
	});

	it('卸载时 abort 条件式请求，避免阻塞后续登录', async () => {
		(window.PublicKeyCredential as any).isConditionalMediationAvailable = vi.fn(
			async () => true,
		);
		let captured: any;
		vi.mocked(navigator.credentials.get).mockImplementationOnce((opts: any) => {
			captured = opts;
			return new Promise((_resolve, reject) => {
				opts.signal?.addEventListener('abort', () =>
					reject(new DOMException('aborted', 'AbortError')),
				);
			}) as any;
		});

		const { unmount } = renderConditional();
		await waitFor(() => expect(captured).toBeTruthy());

		unmount();

		expect(captured.signal.aborted).toBe(true);
	});

	it('显式点击登录前中止挂起的条件式请求', async () => {
		(window.PublicKeyCredential as any).isConditionalMediationAvailable = vi.fn(
			async () => true,
		);
		let conditionalOpts: any;
		vi.mocked(navigator.credentials.get).mockImplementation((opts: any) => {
			if (opts.mediation === 'conditional') {
				conditionalOpts = opts;
				return new Promise((_resolve, reject) => {
					opts.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError')),
					);
				}) as any;
			}
			return Promise.resolve(makeCredential()) as any;
		});

		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route
						path=":tenantSlug/login"
						element={
							<>
								<input autoComplete="username webauthn" />
								<PasskeyLoginButton mode="conditional" tenantId="tenant-1" />
								<PasskeyLoginButton tenantId="tenant-1" />
							</>
						}
					/>
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => expect(conditionalOpts).toBeTruthy());
		fireEvent.click(screen.getByTestId('passkey-submit-button'));

		await waitFor(() => expect(conditionalOpts.signal.aborted).toBe(true));
	});
});
