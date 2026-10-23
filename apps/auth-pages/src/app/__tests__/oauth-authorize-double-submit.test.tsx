import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Suspense } from 'react';

// 挂起式 mock：精确控制「提交在途」与「自动同意晚到」的并发时序。
const { mockGetOAuthClient, mockConsentCheck, mockAccessToken } = vi.hoisted(() => ({
	mockGetOAuthClient: vi.fn(),
	mockConsentCheck: vi.fn(),
	mockAccessToken: 'mock-token',
}));

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, opts?: any) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
		i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: any) => children,
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
		Link: ({ to, children }: any) => <a href={to}>{children}</a>,
	};
});

vi.mock('@autional/shared', () => ({
	decodeJwtPayload: () => ({ user_id: 'user-1', tenant_id: 'tenant-1' }),
	extractItem: (x: any) => x,
	getAccessToken: () => mockAccessToken,
	loginWithTokens: vi.fn(),
	apiClient: { get: (...args: any[]) => mockConsentCheck(...args), post: vi.fn() },
	generatePKCE: vi.fn(),
	useAuthStore: { getState: () => ({ clearAuth: vi.fn() }) },
}));

vi.mock('@autional/shared/generated/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@autional/shared/generated/api')>();
	return {
		...actual,
		PublicAuthConfigByAuthConfig: vi.fn(() => Promise.resolve({ data: {} })),
		authMe: vi.fn(() => Promise.resolve({})),
	};
});

vi.mock('@/lib/api.generated', () => ({
	getOAuthClient: (...args: any[]) => mockGetOAuthClient(...args),
}));

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: Record<string, unknown>) =>
			opts ? `${key} ${JSON.stringify(opts)}` : key,
		lang: 'zh-CN',
	}),
}));

import OAuthAuthorizePage from '../oauth/authorize/page';

const DEFAULT_PARAMS =
	'/oauth/authorize?client_id=test-client&redirect_uri=https://example.com/callback&scope=openid+profile&state=random-state';

function renderOAuthAuthorize(url = DEFAULT_PARAMS) {
	return render(
		<MemoryRouter initialEntries={[url]}>
			<Suspense fallback={<div>Loading</div>}>
				<OAuthAuthorizePage />
			</Suspense>
		</MemoryRouter>,
	);
}

function errorResponse() {
	return {
		ok: false,
		status: 500,
		redirected: false,
		url: '',
		json: async () => ({ error: 'server_error' }),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetOAuthClient.mockResolvedValue({ data: { clientName: 'Test App', logoUri: '' } });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('OAuthAuthorizePage 授权决定并发锁', () => {
	it('自动同意与手动点击并发 → 只发一次 authorize POST', async () => {
		// consent/check 挂起：同意表单已渲染，自动提交尚未发生
		let resolveConsentCheck!: (v: any) => void;
		mockConsentCheck.mockReturnValue(
			new Promise((resolve) => {
				resolveConsentCheck = resolve;
			}),
		);

		// authorize 请求挂起：第一次提交保持在途，撑开并发窗口
		let resolveAuthorize!: (v: any) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise((resolve) => {
					resolveAuthorize = resolve;
				}),
		);
		vi.stubGlobal('fetch', fetchMock);

		const user = userEvent.setup();
		renderOAuthAuthorize();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'auth.oauth.approve' })).toBeInTheDocument();
		});

		// 1) 用户先点：提交进入并在 fetch 上挂起
		await user.click(screen.getByRole('button', { name: 'auth.oauth.approve' }));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// 2) consent/check 此刻返回 hasConsent=true：自动提交与在途提交并发 → 被锁挡住
		resolveConsentCheck({ data: { hasConsent: true } });
		await waitFor(() => expect(mockConsentCheck).toHaveBeenCalled());
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// 3) 收尾：让在途提交失败，释放锁并可重试
		resolveAuthorize(errorResponse());
		expect(await screen.findByText('oauth.error.serverError')).toBeInTheDocument();
	});

	it('表单重复提交（双击/回车连发）→ 只发一次 authorize POST', async () => {
		let resolveAuthorize!: (v: any) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise((resolve) => {
					resolveAuthorize = resolve;
				}),
		);
		vi.stubGlobal('fetch', fetchMock);
		mockConsentCheck.mockReturnValue(new Promise(() => {})); // 自动同意不参与

		renderOAuthAuthorize();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'auth.oauth.approve' })).toBeInTheDocument();
		});

		const form = document.querySelector('form')!;
		fireEvent.submit(form);
		fireEvent.submit(form);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		resolveAuthorize(errorResponse());
		expect(await screen.findByText('oauth.error.serverError')).toBeInTheDocument();
	});

	it('用户已拒绝后，晚到的自动同意不得再发授权 POST', async () => {
		let resolveConsentCheck!: (v: any) => void;
		mockConsentCheck.mockReturnValue(
			new Promise((resolve) => {
				resolveConsentCheck = resolve;
			}),
		);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		// 拒绝出口是整页跳转：stub window.location.href（沿用既有成功链测试的写法）
		const hrefSetter = vi.fn();
		const originalLocation = window.location;
		delete (window as any).location;
		(window as any).location = Object.defineProperties(
			{},
			{
				...Object.getOwnPropertyDescriptors(originalLocation),
				href: { get: () => 'http://localhost/oauth/authorize', set: hrefSetter },
			},
		);
		try {
			const user = userEvent.setup();
			renderOAuthAuthorize();
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'auth.oauth.deny' })).toBeInTheDocument();
			});

			await user.click(screen.getByRole('button', { name: 'auth.oauth.deny' }));
			expect(hrefSetter).toHaveBeenCalledTimes(1);

			// 自动同意晚到：决定已作出，不得再发 authorize（否则拒绝被授权覆盖）
			resolveConsentCheck({ data: { hasConsent: true } });
			await waitFor(() => expect(mockConsentCheck).toHaveBeenCalled());
			await new Promise((r) => setTimeout(r, 0));
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
		}
	});
});
