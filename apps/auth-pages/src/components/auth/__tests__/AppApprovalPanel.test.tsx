import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// 「用 App 确认」回归锁：
//   ① 审批码只能来自 initiate 的返回（不前端自造）
//   ② confirmed 后把 access/refresh 交回宿主页（登录落地由页面统一实现）
//   ③ 卸载（切 tab / 离开）必须 best-effort 撤销会话，且只用 initiate 拿到的 session_token

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key} ${JSON.stringify(opts)}` : key,
		lang: 'zh-CN',
	}),
}));

vi.mock('@/lib/device-fingerprint', () => ({
	computeDeviceFingerprint: vi.fn(async () => 'dfp_test'),
}));

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	apiClient: {
		get: (...args: unknown[]) => mockGet(...args),
		post: (...args: unknown[]) => mockPost(...args),
	},
	extractApiError: (err: unknown, fallback: string) => ({
		message: (err as { message?: string })?.message || fallback,
	}),
}));

vi.mock('@autional/ui', async () => {
	const ReactMod = await import('react');
	return {
		Button: ({ children, onClick, isLoading, ...rest }: Record<string, unknown>) =>
			ReactMod.createElement(
				'button',
				{ onClick, disabled: Boolean(isLoading), ...rest },
				children as React.ReactNode,
			),
	};
});

import AppApprovalPanel from '@/components/auth/AppApprovalPanel';

const INITIATE_PATH = '/identity/api/v1/auth/login-approval/initiate';
const STATUS_PATH = '/identity/api/v1/auth/qr-login/status';
const REVOKE_PATH = '/identity/api/v1/auth/qr-login/revoke';

function renderPanel(props: Partial<React.ComponentProps<typeof AppApprovalPanel>> = {}) {
	const onFallback = vi.fn();
	const onConfirmed = vi.fn();
	const view = render(
		<AppApprovalPanel
			challengeToken="challenge-token-1"
			onFallback={onFallback}
			onConfirmed={onConfirmed}
			{...props}
		/>,
	);
	return { ...view, onFallback, onConfirmed };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGet.mockReset();
	mockPost.mockReset();
	mockPost.mockResolvedValue({ data: { requestId: 'req_1', sessionToken: 'sess-1', code: '482913', expiresIn: 300 } });
	mockGet.mockResolvedValue({ data: { status: 'pending' } });
});

describe('AppApprovalPanel', () => {
	it('点按钮才发起：审批码与会话令牌来自 initiate 返回', async () => {
		const { onConfirmed } = renderPanel();

		// 未点击前零请求（避免 mount 即推送）
		expect(mockPost).not.toHaveBeenCalled();
		expect(screen.getByText('auth.appApproval.intro')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));

		await waitFor(() => {
			expect(screen.getByTestId('app-approval-code')).toHaveTextContent('482913');
		});
		expect(mockPost).toHaveBeenCalledWith(INITIATE_PATH, {
			challengeToken: 'challenge-token-1',
			originUa: expect.any(String),
			deviceKey: 'dfp_test',
		});
		// 倒计时起点来自 expires_in（300s）
		expect(
			screen.getByText('auth.appApproval.countdown {"seconds":300}'),
		).toBeInTheDocument();
		expect(onConfirmed).not.toHaveBeenCalled();
	});

	it('轮询到 confirmed → 把 access/refresh 交回宿主页', async () => {
		mockGet.mockResolvedValue({
			data: { status: 'confirmed', accessToken: 'AT-1', refreshToken: 'RT-1' },
		});
		const { onConfirmed } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));

		await waitFor(
			() => {
				expect(onConfirmed).toHaveBeenCalledWith('AT-1', 'RT-1');
			},
			{ timeout: 8000 },
		);
		expect(mockGet).toHaveBeenCalledWith(STATUS_PATH, { params: { token: 'sess-1' } });
		expect(screen.getByText('auth.appApproval.confirmedTitle')).toBeInTheDocument();
	});

	it('cancelled → 终态提示 + 可重新获取（不自动重试）', async () => {
		mockGet.mockResolvedValue({ data: { status: 'cancelled' } });
		const { onConfirmed } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));

		await waitFor(
			() => {
				expect(screen.getByText('auth.appApproval.cancelledTitle')).toBeInTheDocument();
			},
			{ timeout: 8000 },
		);
		expect(onConfirmed).not.toHaveBeenCalled();

		const callsBefore = mockGet.mock.calls.length;
		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.retry' }));
		// 重新获取只是回到初始态，等待用户再点一次（不自动发起）
		expect(screen.getByRole('button', { name: 'auth.appApproval.start' })).toBeInTheDocument();
		expect(mockGet.mock.calls.length).toBe(callsBefore);
	});

	it('cancelled + superseded:true → 展示「已被替代」（中性），不落「被拒绝」安全文案', async () => {
		mockGet.mockResolvedValue({ data: { status: 'cancelled', superseded: true } });
		const { onConfirmed } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));

		await waitFor(
			() => {
				expect(
					screen.getByText('auth.appApproval.supersededTitle'),
				).toBeInTheDocument();
			},
			{ timeout: 8000 },
		);
		expect(screen.getByText('auth.appApproval.supersededDesc')).toBeInTheDocument();
		// 与「被拒绝」严格分离：不得出现 cancelledTitle/Desc（后者含安全告警语义）
		expect(screen.queryByText('auth.appApproval.cancelledTitle')).toBeNull();
		expect(screen.queryByText('auth.appApproval.cancelledDesc')).toBeNull();
		expect(onConfirmed).not.toHaveBeenCalled();

		// 「重新获取」回到初始态（不自动重发）
		const callsBefore = mockGet.mock.calls.length;
		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.retry' }));
		expect(screen.getByRole('button', { name: 'auth.appApproval.start' })).toBeInTheDocument();
		expect(mockGet.mock.calls.length).toBe(callsBefore);
	});

	it('cancelled 且无 superseded 字段（旧后端）→ 行为不变：仍是被拒绝', async () => {
		mockGet.mockResolvedValue({ data: { status: 'cancelled' } });
		renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));

		await waitFor(
			() => {
				expect(screen.getByText('auth.appApproval.cancelledTitle')).toBeInTheDocument();
			},
			{ timeout: 8000 },
		);
		expect(screen.queryByText('auth.appApproval.supersededTitle')).toBeNull();
	});

	it('卸载时停止轮询并撤销会话（session_token 取自 initiate）', async () => {
		const { unmount } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));
		await waitFor(() => {
			expect(screen.getByTestId('app-approval-code')).toBeInTheDocument();
		});

		unmount();

		await waitFor(() => {
			expect(mockPost).toHaveBeenCalledWith(REVOKE_PATH, { token: 'sess-1' });
		});
	});

	it('revoke 失败不抛错（本地收尾照常）', async () => {
		mockPost.mockImplementation((url: string) =>
			url === REVOKE_PATH ? Promise.reject(new Error('network')) : Promise.resolve({ data: { sessionToken: 'sess-9', code: '111222', expiresIn: 60 } }),
		);
		const { unmount } = renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));
		await waitFor(() => {
			expect(screen.getByTestId('app-approval-code')).toHaveTextContent('111222');
		});

		expect(() => unmount()).not.toThrow();
	});

	// 等待态必须自带退出口：同屏宿主不传 onFallback，没有回落按钮，
	// 缺了「取消本次请求」用户只能白等 300s TTL。
	it('等待态点「取消本次请求」→ 撤销会话一次并回到未发起态', async () => {
		renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));
		await waitFor(() => {
			expect(screen.getByTestId('app-approval-code')).toHaveTextContent('482913');
		});

		// 等待态：卡住提示在场（引导用户确认手机端已登录）
		expect(screen.getByText('auth.appApproval.stuckHint')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.cancel' }));

		// 回到未发起态：发起按钮重现、审批码消失（不自动重发）
		expect(screen.getByRole('button', { name: 'auth.appApproval.start' })).toBeInTheDocument();
		expect(screen.queryByTestId('app-approval-code')).toBeNull();
		expect(screen.queryByText('auth.appApproval.stuckHint')).toBeNull();

		// 撤销只用 initiate 拿到的 session_token，且只发一次
		expect(mockPost).toHaveBeenCalledWith(REVOKE_PATH, { token: 'sess-1' });
		expect(
			mockPost.mock.calls.filter(([url]) => url === REVOKE_PATH),
		).toHaveLength(1);
		// 未重新发起：只有最初的 initiate 一次 POST
		expect(mockPost.mock.calls.filter(([url]) => url === INITIATE_PATH)).toHaveLength(1);
	});
});
