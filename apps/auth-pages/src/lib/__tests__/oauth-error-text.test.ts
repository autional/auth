import { describe, it, expect } from 'vitest';
import { oauthErrorText } from '../oauth-error-text';

// 只做「键选择」断言：translate 原样返回键，避免把文案本体耦合进单测。
const t = (key: string) => key;

const PORTAL_DESC =
	'redirect_uri not registered for this client (this is the tenant portal client; create a dedicated OAuth client for your app)';
const PLAIN_DESC = 'redirect_uri not registered for this client';

describe('oauthErrorText — 回调未登记子型（U555）', () => {
	it('kind=portal → 门户客户端专用文案', () => {
		expect(
			oauthErrorText(t, { code: 'invalid_request', description: PORTAL_DESC, fallback: 'fb', clientKind: 'portal' }),
		).toBe('oauth.error.redirectNotRegisteredPortal');
	});

	it('kind=portal 大小写/空白不敏感', () => {
		expect(
			oauthErrorText(t, { code: 'invalid_request', description: PLAIN_DESC, fallback: 'fb', clientKind: ' Portal ' }),
		).toBe('oauth.error.redirectNotRegisteredPortal');
	});

	it('kind 为空 → 保持原文案（普通应用/未取到 kind）', () => {
		expect(
			oauthErrorText(t, { code: 'invalid_request', description: PLAIN_DESC, fallback: 'fb', clientKind: '' }),
		).toBe('oauth.error.redirectNotRegistered');
	});

	it('kind 缺失（未传）→ 保持原文案', () => {
		expect(oauthErrorText(t, { code: 'invalid_request', description: PLAIN_DESC, fallback: 'fb' })).toBe(
			'oauth.error.redirectNotRegistered',
		);
	});

	it('kind=idp 不误伤 → 保持原文案', () => {
		expect(
			oauthErrorText(t, { code: 'invalid_request', description: PLAIN_DESC, fallback: 'fb', clientKind: 'idp' }),
		).toBe('oauth.error.redirectNotRegistered');
	});
});

describe('oauthErrorText — 既有行为不回退', () => {
	it('PKCE 描述子型优先于码级', () => {
		expect(
			oauthErrorText(t, { code: 'invalid_request', description: 'PKCE code_challenge is required', fallback: 'fb' }),
		).toBe('oauth.error.pkceRequired');
	});

	it('仅错误码 → 码级文案', () => {
		expect(oauthErrorText(t, { code: 'access_denied', fallback: 'fb' })).toBe('oauth.error.accessDenied');
	});

	it('未知码 + 未知描述 → 保留描述原文（AUTH-47）', () => {
		expect(oauthErrorText(t, { code: 'weird_code', description: 'some upstream detail', fallback: 'fb' })).toBe(
			'some upstream detail',
		);
	});

	it('全空 → 兜底文案', () => {
		expect(oauthErrorText(t, { fallback: 'fb' })).toBe('fb');
	});
});
