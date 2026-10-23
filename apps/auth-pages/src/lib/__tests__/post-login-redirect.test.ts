import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCurrentRole = vi.fn();
const mockIsValidRedirect = vi.fn();
const mockCrossAppUrl = vi.fn((path: string) => path);

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	getCurrentRole: () => mockGetCurrentRole(),
	isValidRedirect: (url: string) => mockIsValidRedirect(url),
	crossAppUrl: (path: string) => mockCrossAppUrl(path),
	ADMIN_CONSOLE_URL: () => '/admin',
	SECURITY_DASHBOARD_URL: () => '/security',
}));

import {
	getPostLoginTarget,
	resolvePostLoginRedirect,
	buildMfaChallengeUrl,
} from '../post-login-redirect';

describe('getPostLoginTarget', () => {
	beforeEach(() => {
		mockGetCurrentRole.mockReturnValue('member');
		mockIsValidRedirect.mockImplementation(
			(url: string) => url.startsWith('/') && !url.includes('/login'),
		);
	});

	describe('角色路由 (无 redirect)', () => {
		it('admin → admin-console', () => {
			mockGetCurrentRole.mockReturnValue('admin');
			expect(getPostLoginTarget({ tenantSlug: 'Default' })).toBe('/admin');
		});

		it('super_admin → admin-console', () => {
			mockGetCurrentRole.mockReturnValue('super_admin');
			expect(getPostLoginTarget({ tenantSlug: 'Default' })).toBe('/admin');
		});

		it('security_admin → security-dashboard', () => {
			mockGetCurrentRole.mockReturnValue('security_admin');
			expect(getPostLoginTarget({ tenantSlug: 'Default' })).toBe('/security');
		});

		it('member → /{slug}/dashboard', () => {
			mockGetCurrentRole.mockReturnValue('member');
			expect(getPostLoginTarget({ tenantSlug: 'acme' })).toBe('/acme/dashboard');
		});
	});

	describe('redirect 参数', () => {
		it('有效 redirect 优先于角色路由', () => {
			mockIsValidRedirect.mockReturnValue(true);
			expect(getPostLoginTarget({ tenantSlug: 'X', redirect: '/developer' })).toBe('/developer');
		});

		it('无效 redirect 回退到角色路由', () => {
			mockIsValidRedirect.mockReturnValue(false);
			mockGetCurrentRole.mockReturnValue('member');
			expect(getPostLoginTarget({ tenantSlug: 'Default', redirect: '/login' })).toBe(
				'/Default/dashboard',
			);
		});
	});

	describe('tenantSlug', () => {
		it('null slug → /dashboard', () => {
			expect(getPostLoginTarget({ tenantSlug: null })).toBe('/dashboard');
		});

		it('empty slug → /dashboard', () => {
			expect(getPostLoginTarget({ tenantSlug: '' })).toBe('/dashboard');
		});
	});
});

describe('resolvePostLoginRedirect（MFA/密码登录共用回程）', () => {
	beforeEach(() => {
		mockIsValidRedirect.mockImplementation((url: string) => url.startsWith('/'));
	});

	it('合法相对回程原样返回', () => {
		expect(resolvePostLoginRedirect('/platform/dashboard?tab=security', 'acme')).toBe(
			'/platform/dashboard?tab=security',
		);
	});

	it('无回程或非法回程 → null', () => {
		expect(resolvePostLoginRedirect(null, 'acme')).toBeNull();
		mockIsValidRedirect.mockReturnValue(false);
		expect(resolvePostLoginRedirect('//evil.example', 'acme')).toBeNull();
	});
});

describe('buildMfaChallengeUrl', () => {
	beforeEach(() => {
		mockIsValidRedirect.mockImplementation((url: string) => url.startsWith('/'));
	});

	it('带租户 slug 与回程目标', () => {
		expect(buildMfaChallengeUrl('acme', '/platform/dashboard')).toBe(
			'/acme/mfa-challenge?redirect=%2Fplatform%2Fdashboard',
		);
	});

	it('无回程目标时只带挑战路径', () => {
		expect(buildMfaChallengeUrl('acme', null)).toBe('/acme/mfa-challenge');
	});

	it('无租户 slug 走非租户路由（不得拼 /null/）', () => {
		expect(buildMfaChallengeUrl(null, '/platform/dashboard')).toBe(
			'/mfa-challenge?redirect=%2Fplatform%2Fdashboard',
		);
		expect(buildMfaChallengeUrl(null, null)).toBe('/mfa-challenge');
	});

	it('非法回程目标不透传', () => {
		mockIsValidRedirect.mockReturnValue(false);
		expect(buildMfaChallengeUrl('acme', '//evil.example')).toBe('/acme/mfa-challenge');
	});
});
