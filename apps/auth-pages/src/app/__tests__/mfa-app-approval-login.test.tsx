import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * 页面级回归锁：「用 App 确认」confirmed 后必须走**页面自己的**登录落地。
 *
 * 面板只负责把 access/refresh 交回宿主；真正落地是 mfa-challenge 页的 finishLogin
 * （loginWithTokens + anchorSessionFromToken + 回程跳转）。面板单测只能锁到回调，
 * 锁不到「页面确实把这个回调接上了」——本文件补这一环。
 */

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
		useParams: () => ({}),
		Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
			<a href={to}>{children}</a>
		),
	};
});

const mockLoginWithTokens = vi.fn();
const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('@autional/shared', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared')>()),
	loginWithTokens: (...args: unknown[]) => mockLoginWithTokens(...args),
	decodeJwtPayload: (token: string) => {
		try {
			const part = token.split('.')[1];
			if (!part) return null;
			const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
			return JSON.parse(atob(b64));
		} catch {
			return null;
		}
	},
	extractApiError: (err: unknown, fallback: string) => ({
		code: 'UNKNOWN',
		message: (err as { message?: string })?.message || fallback,
	}),
	usePublicTenantSlugs: () => ({ data: [] }),
	apiClient: {
		get: (...args: unknown[]) => mockGet(...args),
		post: (...args: unknown[]) => mockPost(...args),
	},
}));

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({ t: (key: string) => key, lang: 'zh-CN' }),
}));

vi.mock('@/lib/api.generated', () => ({
	verifyMFAChallenge: vi.fn(),
	sendMFAChallengeCode: vi.fn(),
}));

vi.mock('@/lib/anchor-session', () => ({
	anchorSessionFromToken: vi.fn(),
}));

import MFAChallengePage from '../mfa-challenge/page';
import { anchorSessionFromToken } from '@/lib/anchor-session';

function b64url(obj: unknown): string {
	return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function seedPreAuth() {
	sessionStorage.setItem(
		'mfa_pre_auth',
		JSON.stringify({
			challengeToken: `header.${b64url({
				exp: Math.floor(Date.now() / 1000) + 300,
				sub: 'test-user-id',
			})}.sig`,
			tenantId: '',
			riskLevel: '',
			requiredMfaMethods: ['totp'],
			enrolledMfaMethods: ['totp'],
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	mockGet.mockReset();
	mockPost.mockReset();
});

describe('MFA 挑战页 · 用 App 确认 → 登录落地', () => {
	it('App 审批 confirmed 后走页面的 finishLogin（loginWithTokens + 会话锚定 + 跳转）', async () => {
		seedPreAuth();
		mockPost.mockResolvedValue({
			data: { requestId: 'req_1', sessionToken: 'sess-1', code: '482913', expiresIn: 300 },
		});
		mockGet.mockResolvedValue({
			data: { status: 'confirmed', accessToken: 'AT-PAGE', refreshToken: 'RT-PAGE' },
		});

		render(
			<MemoryRouter initialEntries={['/mfa-challenge']}>
				<MFAChallengePage />
			</MemoryRouter>,
		);

		// 「用 App 确认」标签排在码方法之前；默认仍停在 TOTP，要求用户主动切过去
		const appTab = await screen.findByRole('tab', { name: 'auth.appApproval.tab' });
		expect(screen.getByRole('tab', { name: 'mfa.challenge.tabTOTP' })).toHaveAttribute(
			'aria-selected',
			'true',
		);

		fireEvent.click(appTab);
		fireEvent.click(screen.getByRole('button', { name: 'auth.appApproval.start' }));

		await waitFor(
			() => {
				expect(mockLoginWithTokens).toHaveBeenCalled();
			},
			{ timeout: 8000 },
		);

		const [[at, rt]] = mockLoginWithTokens.mock.calls;
		expect(at).toBe('AT-PAGE');
		expect(rt).toBe('RT-PAGE');

		// 落地不只写 token：还要锚定租户（AUTH-53⑤）并跳转到目标页
		expect(vi.mocked(anchorSessionFromToken)).toHaveBeenCalledWith(
			'AT-PAGE',
			expect.objectContaining({ slug: null, tenantId: null }),
		);
		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
		});
		expect(sessionStorage.getItem('mfa_pre_auth')).toBeNull();
	}, 15000);
});
