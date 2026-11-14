import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import React from 'react';

// AUTH-53⑤（独立验证 P2 扩展）：QR 扫码登录确认后建立会话必须调用
// anchorSessionFromToken 锚定租户（slug 取路由；tenantId 走 JWT claim 兜底）。

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

const { mockApiPost } = vi.hoisted(() => ({ mockApiPost: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	loginWithTokens: vi.fn(),
	apiClient: { post: (...args: unknown[]) => mockApiPost(...args) },
	// 深链改 https 的回归锁需要确定性门户地址（jsdom 下真实解析依赖 window.location）
	getPortalUrl: () => 'https://authenticator.example.test',
}));

vi.mock('@autional/shared/generated/api', () => ({
	authQrLoginInitiatePost: vi.fn(),
	authQrLoginStatus: vi.fn(),
}));

vi.mock('@/hooks/use-countdown', () => ({
	useCountdown: () => ({ seconds: 300, isActive: true, start: vi.fn(), reset: vi.fn() }),
}));

vi.mock('qrcode', () => ({
	default: { toDataURL: vi.fn(async () => 'data:image/png;base64,x') },
}));

vi.mock('@autional/ui', async () => {
	const ReactMod = await import('react');
	return {
		Button: ({ children, onClick, isLoading, variant, fullWidth, disabled, ...rest }: any) =>
			ReactMod.createElement('button', { onClick, disabled, ...rest }, children),
	};
});

import QRLoginPanel from '@/components/auth/QRLoginPanel';
import QRCode from 'qrcode';
import { anchorSessionFromToken } from '@/lib/anchor-session';
import { loginWithTokens } from '@autional/shared';
import {
	authQrLoginInitiatePost,
	authQrLoginStatus,
} from '@autional/shared/generated/api';

beforeEach(() => {
	vi.clearAllMocks();
	mockApiPost.mockReset();
	mockApiPost.mockResolvedValue({});
	vi.mocked(authQrLoginInitiatePost).mockResolvedValue({
		sessionToken: 'tok-1',
		numberMatching: '42',
	} as any);
	vi.mocked(authQrLoginStatus).mockResolvedValue({
		status: 'confirmed',
		accessToken: 'at-1',
		refreshToken: 'rt-1',
	} as any);
});

describe('QRLoginPanel - AUTH-53⑤ 会话锚定', () => {
	it('扫码确认后锚定租户（slug 取路由、tenantId 为 null 走 claim 兜底）', async () => {
		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));

		// 无租户 prop ⇒ 发起不带显式租户（旧调用方行为不变）
		expect(vi.mocked(authQrLoginInitiatePost)).toHaveBeenCalledWith(undefined);

		// 轮询周期 2s——等待确认分支建立会话并锚定（real timers，超时上限 8s）
		await waitFor(
			() => {
				expect(vi.mocked(anchorSessionFromToken)).toHaveBeenCalledWith('at-1', {
					slug: 'demo',
					tenantId: null,
				});
			},
			{ timeout: 8000 },
		);
		// 75242d9 起扫码登录会带上 user（store 拒绝空 user），第 3 参不断言具体形状
		const [[at, rt]] = vi.mocked(loginWithTokens).mock.calls;
		expect(at).toBe('at-1');
		expect(rt).toBe('rt-1');
	}, 10000);

	it('手机已扫码（scanned）→ 桌面切到「已扫描」提示，并继续轮询到成功', async () => {
		vi.mocked(authQrLoginStatus)
			.mockResolvedValueOnce({ status: 'scanned', numberMatching: '42' } as any)
			.mockResolvedValue({ status: 'confirmed', accessToken: 'at-9', refreshToken: 'rt-9' } as any);

		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));

		await waitFor(
			() => {
				expect(screen.getByText('qrLogin.scanned')).toBeInTheDocument();
			},
			{ timeout: 5000 },
		);

		// scanned 不是终态：轮询继续，confirmed 后进入成功态
		await waitFor(
			() => {
				expect(screen.getByText('qrLogin.success')).toBeInTheDocument();
			},
			{ timeout: 8000 },
		);
	}, 12000);

	it('confirmed 但未携带令牌（一次性交付已被消费）→ 终态提示 + 停止轮询', async () => {
		vi.useFakeTimers();
		try {
			// 令牌一次性交付：首次响应丢失后，同 token 再轮询只有 status、无 accessToken
			vi.mocked(authQrLoginStatus).mockResolvedValue({ status: 'confirmed' } as any);

			render(
				<MemoryRouter initialEntries={['/demo/login']}>
					<Routes>
						<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
					</Routes>
				</MemoryRouter>,
			);

			fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			// 首个轮询周期（2s）→ 进入终态
			await act(async () => {
				await vi.advanceTimersByTimeAsync(2100);
			});

			expect(screen.getByText('qrLogin.confirmedWithoutToken')).toBeInTheDocument();
			// 不得误建空会话
			expect(vi.mocked(loginWithTokens)).not.toHaveBeenCalled();
			// 真实出路：重新获取 + 返回登录
			expect(screen.getByRole('button', { name: 'qrLogin.retry' })).toBeInTheDocument();
			expect(screen.getByText('auth.common.backToLogin')).toBeInTheDocument();

			// 停止轮询：再走 3 个周期不再请求
			const callsAtTerminal = vi.mocked(authQrLoginStatus).mock.calls.length;
			await act(async () => {
				await vi.advanceTimersByTimeAsync(6000);
			});
			expect(vi.mocked(authQrLoginStatus).mock.calls.length).toBe(callsAtTerminal);

			// 「重新获取」复位回 init，可重新发起
			fireEvent.click(screen.getByRole('button', { name: 'qrLogin.retry' }));
			expect(screen.getByRole('button', { name: 'qrLogin.getCode' })).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	}, 15000);

	it('点取消 → 调用公开 revoke；撤销请求失败也照常本地取消', async () => {
		vi.mocked(authQrLoginStatus).mockResolvedValue({ status: 'pending' } as any);
		mockApiPost.mockRejectedValue(new Error('network'));

		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));
		await waitFor(
			() => {
				expect(screen.getByRole('button', { name: 'qrLogin.cancel' })).toBeInTheDocument();
			},
			{ timeout: 5000 },
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.cancel' }));

		await waitFor(() => {
			expect(mockApiPost).toHaveBeenCalledWith(
				'/identity/api/v1/auth/qr-login/revoke',
				{ token: 'tok-1' },
			);
		});
		// 撤销失败（网络）也照常回到 init
		expect(screen.getByRole('button', { name: 'qrLogin.getCode' })).toBeInTheDocument();
	}, 10000);

	it('cancelled + superseded:true → 中性「已被替代」提示（不是被取消/拒绝），可重新获取', async () => {
		vi.mocked(authQrLoginStatus).mockResolvedValue({ status: 'cancelled', superseded: true } as any);

		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));

		await waitFor(
			() => {
				expect(screen.getByText('qrLogin.supersededTitle')).toBeInTheDocument();
			},
			{ timeout: 8000 },
		);
		expect(screen.getByText('qrLogin.supersededDesc')).toBeInTheDocument();
		// 与普通 cancelled 严格分离：不得落 danger 提示的「登录已取消」
		expect(screen.queryByText('qrLogin.cancelled')).toBeNull();
		// 不误建会话
		expect(vi.mocked(loginWithTokens)).not.toHaveBeenCalled();

		// 重新获取 = 复位回 init
		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.retry' }));
		expect(screen.getByRole('button', { name: 'qrLogin.getCode' })).toBeInTheDocument();
	}, 10000);

	it('cancelled 且无 superseded 字段（旧后端）→ 行为不变：登录已取消', async () => {
		vi.mocked(authQrLoginStatus).mockResolvedValue({ status: 'cancelled' } as any);

		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));

		await waitFor(
			() => {
				expect(screen.getByText('qrLogin.cancelled')).toBeInTheDocument();
			},
			{ timeout: 8000 },
		);
		expect(screen.queryByText('qrLogin.supersededTitle')).toBeNull();
	}, 10000);

	it('二维码深链用 https（PWA 无法注册自定义 scheme）', async () => {
		vi.mocked(authQrLoginStatus).mockResolvedValue({ status: 'pending' } as any);

		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));

		await waitFor(() => {
			expect(vi.mocked(QRCode.toDataURL)).toHaveBeenCalledWith(
				'https://authenticator.example.test/login-approve?token=tok-1&nm=42',
				expect.objectContaining({ margin: 1 }),
			);
		});
		const [[payload]] = vi.mocked(QRCode.toDataURL).mock.calls as unknown as [[string]];
		expect(payload.startsWith('autional://')).toBe(false);
		expect(payload.startsWith('https://')).toBe(true);
	}, 10000);

	it('小屏提示：面板给出「手机扫不了自己」的替代路径', () => {
		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByText('qrLogin.mobileHint')).toBeInTheDocument();
	});

	it('轮询连续失败 3 次 → 显示网络重试提示', async () => {
		vi.useFakeTimers();
		try {
			vi.mocked(authQrLoginStatus).mockRejectedValue(new Error('net'));

			render(
				<MemoryRouter initialEntries={['/demo/login']}>
					<Routes>
						<Route path=":tenantSlug/login" element={<QRLoginPanel />} />
					</Routes>
				</MemoryRouter>,
			);

			fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(7000);
			});

			expect(screen.getByText('qrLogin.networkRetry')).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	}, 15000);

	it('带 tenantId prop：发起 body 与锚定租户均取地址栏租户', async () => {
		render(
			<MemoryRouter initialEntries={['/demo/login']}>
				<Routes>
					<Route
						path=":tenantSlug/login"
						element={<QRLoginPanel tenantId="tenant_demo" />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'qrLogin.getCode' }));

		expect(vi.mocked(authQrLoginInitiatePost)).toHaveBeenCalledWith({
			tenantId: 'tenant_demo',
		});

		await waitFor(
			() => {
				expect(vi.mocked(anchorSessionFromToken)).toHaveBeenCalledWith('at-1', {
					slug: 'demo',
					tenantId: 'tenant_demo',
				});
			},
			{ timeout: 8000 },
		);
	}, 10000);
});
