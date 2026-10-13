import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

// ============================================================
// TASK-LS-06 登出确认页（AC-LS-019）
//  - 零副作用：渲染仅只读展示参数，无 XHR、无本地会话清除、无导航
//  - 导航闭合：唯一出站目标是**服务端响应里的 location**；URL 上的
//    post_logout_redirect_uri 参数只做展示，绝不直接导航；无 location
//    （401 / 200 无 location / 网络失败）→ 落 auth 域根兜底（不出站）
// ============================================================

const { mockFetch, mockLogout, mockGetAccessToken, mockTraceEvent } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	mockLogout: vi.fn(),
	mockGetAccessToken: vi.fn(() => null as string | null),
	mockTraceEvent: vi.fn(),
}));

vi.mock('@autional/shared', async () => {
	// traceRedirect 取真实现：整页跳转出口的语义（目标 = 页面传入值 + rt 装饰）在此被
	// 真实验证（断言 window.location.href 收到什么），白名单 mock 其余键保持隔离
	const actual = await vi.importActual<typeof import('@autional/shared')>('@autional/shared');
	return {
		traceRedirect: actual.traceRedirect,
		traceEvent: (...args: unknown[]) => mockTraceEvent(...args),
		AuthService: { logout: () => mockLogout() },
		getAccessToken: () => mockGetAccessToken(),
		extractItem: (payload: any) => payload?.data ?? payload,
	};
});

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key} ${JSON.stringify(opts)}` : key,
		lang: 'zh-CN',
	}),
}));

import LogoutConfirmPage from '../logout-confirm/page';

const CONFIRM_PATH = '/logout-confirm';
/** 服务端回跳（命中客户端注册白名单时才由服务端给出） */
const SERVER_LOCATION = 'https://user.autional.cn/demo/?state=st-1';
/** URL 参数面上的未注册地址（越权面）：页面绝不得导航到它 */
const UNREGISTERED = 'https://evil.example/after-logout';
const CONFIRM_QUERY = `?client_id=client-1&post_logout_redirect_uri=${encodeURIComponent(UNREGISTERED)}&state=st-1`;

let locationMock: Record<string, any>;
let hrefValue: string;
/** href 被赋值时 AuthService.logout 已完成的调用数（验证「先本地终结、后导航」时序） */
let hrefAssignedAfterLogoutCalls: number | null;

function renderPage() {
	return render(
		<MemoryRouter initialEntries={[CONFIRM_PATH + CONFIRM_QUERY]}>
			<LogoutConfirmPage />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockLogout.mockResolvedValue(undefined);
	mockGetAccessToken.mockReturnValue(null);

	vi.stubGlobal('fetch', mockFetch);

	// jsdom location 不可直接赋值：先 delete 再重建（同 oauth-authorize-cold-start.test.tsx）
	hrefValue = '';
	hrefAssignedAfterLogoutCalls = null;
	delete (window as any).location;
	locationMock = {
		origin: 'https://auth.autional.cn',
		// hostname/protocol：auth-trace 装饰器（station / URL 派生）真实依赖，缺了会被
		// decorateTarget 的 catch 吞成裸目标，测试将失去「装饰后整页跳转」的真实语义
		hostname: 'auth.autional.cn',
		protocol: 'https:',
		pathname: CONFIRM_PATH,
		search: CONFIRM_QUERY,
		replace: vi.fn(),
		assign: vi.fn(),
		get href() {
			return hrefValue;
		},
		set href(v: string) {
			hrefValue = v;
			hrefAssignedAfterLogoutCalls = mockLogout.mock.calls.length;
		},
	};
	(window as any).location = locationMock;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('登出确认页 — 零副作用（直接打开无操作）', () => {
	it('渲染仅只读展示 client_id / post_logout_redirect_uri / state：无 XHR、无清除、无导航', async () => {
		const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
		renderPage();

		expect(screen.getByText('logoutConfirm.title')).toBeInTheDocument();
		expect(screen.getByText('client-1')).toBeInTheDocument();
		expect(screen.getByText(UNREGISTERED)).toBeInTheDocument();
		expect(screen.getByText('st-1')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'logoutConfirm.confirm' })).toBeInTheDocument();

		// 渲染后等一拍：仍无任何副作用
		await new Promise((r) => setTimeout(r, 20));
		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockLogout).not.toHaveBeenCalled();
		expect(mockGetAccessToken).not.toHaveBeenCalled();
		expect(removeItemSpy).not.toHaveBeenCalled();
		expect(hrefValue).toBe('');
		removeItemSpy.mockRestore();
	});
});

describe('登出确认页 — 确认后导航闭合（仅服务端 location 出站）', () => {
	it('200 + 服务端 location → 先本地终结再导航服务端 location；未注册参数不出站', async () => {
		const user = userEvent.setup();
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				code: 200,
				message: 'ok',
				data: { logged_out: true, location: SERVER_LOCATION },
			}),
		});

		renderPage();
		await user.click(screen.getByRole('button', { name: 'logoutConfirm.confirm' }));

		await waitFor(() => {
			expect(hrefValue).toContain('user.autional.cn');
		});
		// 只导航服务端 location（含服务端回拼的 state）；未注册参数（evil.example）绝不出现
		expect(hrefValue.startsWith('https://user.autional.cn/demo/')).toBe(true);
		expect(hrefValue).toContain('state=st-1');
		expect(hrefValue).not.toContain('evil.example');
		// 本地会话先终结（唯一实现），后导航
		expect(mockLogout).toHaveBeenCalledTimes(1);
		expect(hrefAssignedAfterLogoutCalls).toBe(1);

		// XHR 契约：POST + Accept 显式 JSON + 原 query 原样透传（防落 302 确认页支）
		const call = mockFetch.mock.calls[0];
		expect(String(call[0])).toBe(`/bff/oauth/api/v1/oauth/logout${CONFIRM_QUERY}`);
		expect((call[1] as any)?.method).toBe('POST');
		expect((call[1] as any)?.headers?.Accept).toBe('application/json');
		expect((call[1] as any)?.headers?.Authorization).toBeUndefined();
	});

	it('401（无会话）→ 本地终结 + 落 auth 域根兜底，未注册参数不出站', async () => {
		const user = userEvent.setup();
		mockFetch.mockResolvedValue({
			ok: false,
			status: 401,
			json: async () => ({ error: 'invalid_request' }),
		});

		renderPage();
		await user.click(screen.getByRole('button', { name: 'logoutConfirm.confirm' }));

		await waitFor(() => {
			expect(hrefValue).toContain('auth.autional.cn');
		});
		expect(hrefValue.startsWith('https://auth.autional.cn/')).toBe(true);
		expect(hrefValue).not.toContain('evil.example');
		expect(hrefValue).not.toContain('user.autional.cn');
		expect(mockLogout).toHaveBeenCalledTimes(1);
	});

	it('200 但无 location（未命中注册白名单）→ 同样不出站，落 auth 域根兜底', async () => {
		const user = userEvent.setup();
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ code: 200, message: 'ok', data: { logged_out: true, location: '' } }),
		});

		renderPage();
		await user.click(screen.getByRole('button', { name: 'logoutConfirm.confirm' }));

		await waitFor(() => {
			expect(hrefValue).toContain('auth.autional.cn');
		});
		expect(hrefValue).not.toContain('evil.example');
		expect(mockLogout).toHaveBeenCalledTimes(1);
	});

	it('网络失败 → 本地终结 + 兜底不出站（不白屏不卡死）', async () => {
		const user = userEvent.setup();
		mockFetch.mockRejectedValue(new Error('network down'));

		renderPage();
		await user.click(screen.getByRole('button', { name: 'logoutConfirm.confirm' }));

		await waitFor(() => {
			expect(hrefValue).toContain('auth.autional.cn');
		});
		expect(hrefValue).not.toContain('evil.example');
		expect(mockLogout).toHaveBeenCalledTimes(1);
	});

	it('有本地令牌 → XHR 补 Bearer；提交中按钮禁用，重复点击不重发', async () => {
		const user = userEvent.setup();
		mockGetAccessToken.mockReturnValue('token-abc');
		let resolveFetch: ((v: unknown) => void) | undefined;
		mockFetch.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);

		renderPage();
		await user.click(screen.getByRole('button', { name: 'logoutConfirm.confirm' }));

		const submitting = await screen.findByRole('button', { name: 'logoutConfirm.confirming' });
		await waitFor(() => {
			expect(submitting).toBeDisabled();
		});
		await user.click(submitting);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect((mockFetch.mock.calls[0][1] as any)?.headers?.Authorization).toBe('Bearer token-abc');

		resolveFetch?.({ ok: false, status: 401, json: async () => ({}) });
		await waitFor(() => {
			expect(mockLogout).toHaveBeenCalledTimes(1);
		});
	});
});
