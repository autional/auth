/**
 * 授权页「会话租户 ≠ 客户端租户」守卫回归（P0 修复，2026-11-07 线上实证）。
 *
 * 背景：用户门户等第一方门户客户端登记在**平台租户**，而登录用户属于各自租户。
 * 旧实现用裸 tenant 比较 → 误判跨租户 → 清会话 → 回登录页 → 再授权 → 无限往返。
 * 现口径：只有 kind=idp（第一方联邦 RP）才在客户端提前引导；其它 kind 交给服务端
 * CrossTenantAuthorizeBlocked 裁决，并用限次断路器兜底。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Suspense } from 'react';

const { mockGetOAuthClient, mockClearAuth, mockReplace, mockFetchSlug } = vi.hoisted(() => ({
	mockGetOAuthClient: vi.fn(),
	mockClearAuth: vi.fn(),
	mockReplace: vi.fn(),
	mockFetchSlug: vi.fn(() => Promise.resolve('acme-corp')),
}));

// 会话租户 tenant-session；客户端租户 tenant-client（跨租户）
const SESSION_TENANT = 'tenant-session';
const CLIENT_TENANT = 'tenant-client';

function makeJwt(payload: Record<string, unknown>): string {
	const b64 = (o: unknown) => {
		const s = JSON.stringify(o);
		const encoded =
			typeof Buffer !== 'undefined'
				? Buffer.from(s).toString('base64')
				: btoa(unescape(encodeURIComponent(s)));
		return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	};
	return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}
const TOKEN = makeJwt({ sub: 'user-1', user_id: 'user-1', tenant_id: SESSION_TENANT, exp: 9999999999 });

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, opts?: any) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
		i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: any) => children,
}));

vi.mock('@autional/shared', async () => {
	const actual = await vi.importActual<typeof import('@autional/shared')>('@autional/shared');
	return {
		decodeJwtPayload: actual.decodeJwtPayload,
		getAccessToken: vi.fn(() => TOKEN),
		loginWithTokens: vi.fn(),
		apiClient: {
			get: vi.fn(() => Promise.resolve({ data: {} })),
			post: vi.fn(() => Promise.resolve({ data: {} })),
		},
		useAuthStore: { getState: () => ({ clearAuth: mockClearAuth }) },
	};
});

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
	authorizeOAuth: vi.fn(),
}));

vi.mock('@/lib/oauth-cold-start', () => ({
	buildTenantLoginUrl: (slug: string, target: string) => `/login/${slug}?redirect=${target}`,
	fetchTenantSlugByClientId: () => mockFetchSlug(),
}));

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({
		t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
		lang: 'zh-CN',
	}),
}));

import OAuthAuthorizePage from '../oauth/authorize/page';

const STATE = JSON.stringify({ csrf: 'c1', redirect: 'https://user.autional.cn/acme-corp/' });
const URL_WITH_STATE = `/oauth/authorize?client_id=test-client&redirect_uri=https://user.autional.cn/oauth/callback&scope=openid+profile&state=${encodeURIComponent(STATE)}`;

function renderPage() {
	return render(
		<MemoryRouter initialEntries={[URL_WITH_STATE]}>
			<Suspense fallback={<div>Loading</div>}>
				<OAuthAuthorizePage />
			</Suspense>
		</MemoryRouter>,
	);
}

function clientInfo(extra: Record<string, unknown>) {
	return { data: { clientName: 'End-User Portal OAuth Client', logoUri: '', tenantId: CLIENT_TENANT, ...extra } };
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	// jsdom 的 location.replace 不可直接 spy，整体替换
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { ...window.location, replace: mockReplace, href: 'https://auth.autional.cn/oauth/api/v1/oauth/authorize' },
	});
	global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ slug: 'acme-corp' }] }) })) as never;
	mockFetchSlug.mockResolvedValue('acme-corp');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('OAuthAuthorizePage 跨租户守卫', () => {
	it('第一方门户客户端（kind=app/空）跨租户：不清会话、不跳登录（P0 回归）', async () => {
		mockGetOAuthClient.mockResolvedValue(clientInfo({ kind: '' }));

		renderPage();

		// 同意页正常渲染（说明守卫没有把会话清掉/踢回登录页）
		await waitFor(() => {
			expect(screen.getByText('auth.oauth.authorizeTitle')).toBeInTheDocument();
		});
		await new Promise((r) => setTimeout(r, 50));

		expect(mockClearAuth).not.toHaveBeenCalled();
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it('kind=idp 且跨租户：清会话并回登录页（保留联邦防错人）', async () => {
		mockGetOAuthClient.mockResolvedValue(clientInfo({ kind: 'idp' }));

		renderPage();

		await waitFor(() => {
			expect(mockClearAuth).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(mockReplace).toHaveBeenCalled();
		});
	});

	it('kind=idp 跨租户重复回跳：第 4 次触发断路器，报错而不继续循环', async () => {
		mockGetOAuthClient.mockResolvedValue(clientInfo({ kind: 'idp' }));

		for (let i = 0; i < 3; i++) {
			const view = renderPage();
			await waitFor(() => expect(mockReplace).toHaveBeenCalled());
			mockReplace.mockClear();
			mockClearAuth.mockClear();
			view.unmount();
		}

		renderPage();
		await waitFor(() => {
			expect(screen.getByText(/oauth\.authorize\.tenantMismatchLoop/)).toBeInTheDocument();
		});
		expect(mockReplace).not.toHaveBeenCalled();
	});
});
