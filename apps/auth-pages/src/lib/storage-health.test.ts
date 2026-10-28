import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	purgeRebuildableCaches,
	persistSessionWithRetry,
	sessionPersisted,
	trimCaches,
} from './storage-health';

const SESSION = 'autional-auth-v1';

function seedSession(token = 'tok'): void {
	localStorage.setItem(SESSION, JSON.stringify({ state: { accessToken: token, currentTenantId: 't1' } }));
}

beforeEach(() => {
	localStorage.clear();
});

describe('storage-health（R1/R5 回归）', () => {
	it('purgeRebuildableCaches 只删可重建缓存，保留会话与偏好', () => {
		seedSession();
		localStorage.setItem('page-init:oauth-providers:t1', JSON.stringify({ data: [], _ts: Date.now() }));
		localStorage.setItem('auth-config:t1', JSON.stringify({ data: {}, _ts: Date.now() }));
		localStorage.setItem('tenant-branding:t1', JSON.stringify({ data: {}, _ts: Date.now() }));
		localStorage.setItem('auth_dashboard_slug', 't1');
		localStorage.setItem('oauth_client_id', 'cid');
		localStorage.setItem('lang', 'zh-CN');

		const removed = purgeRebuildableCaches();

		expect(removed).toBe(3);
		expect(localStorage.getItem(SESSION)).toBeTruthy();
		expect(localStorage.getItem('auth_dashboard_slug')).toBe('t1');
		expect(localStorage.getItem('oauth_client_id')).toBe('cid');
		expect(localStorage.getItem('lang')).toBe('zh-CN');
		expect(localStorage.getItem('page-init:oauth-providers:t1')).toBeNull();
	});

	it('persistSessionWithRetry：首次写入失败时清缓存重试并成功', () => {
		// 先塞满缓存，模拟"没空间"
		for (let i = 0; i < 5; i++) {
			localStorage.setItem(`page-init:k${i}`, JSON.stringify({ data: 'x'.repeat(100), _ts: Date.now() }));
		}
		let calls = 0;
		const apply = () => {
			calls += 1;
			if (calls === 1) throw new Error('QuotaExceededError'); // 首次失败
			seedSession();
		};

		const ok = persistSessionWithRetry(apply);

		expect(ok).toBe(true);
		expect(calls).toBe(2);
		expect(sessionPersisted()).toBe(true);
		// 缓存被清理，腾出空间
		expect(localStorage.getItem('page-init:k0')).toBeNull();
	});

	it('persistSessionWithRetry：两次都失败时返回 false（调用方必须报错，不得静默）', () => {
		const apply = vi.fn(() => {
			throw new Error('QuotaExceededError');
		});
		const ok = persistSessionWithRetry(apply);
		expect(ok).toBe(false);
		expect(apply).toHaveBeenCalledTimes(2);
	});

	it('trimCaches：删除过期与超额条目，保留会话', () => {
		seedSession();
		const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
		localStorage.setItem('page-init:old', JSON.stringify({ data: 1, _ts: old }));
		for (let i = 0; i < 45; i++) {
			localStorage.setItem(`page-init:fresh${i}`, JSON.stringify({ data: 1, _ts: Date.now() - i }));
		}

		const before = Object.keys(localStorage).filter((k) => k.startsWith('page-init:')).length;
		const removed = trimCaches();
		const after = Object.keys(localStorage).filter((k) => k.startsWith('page-init:')).length;
		expect({ before, removed, after }).toEqual({ before: 46, removed: 6, after: 40 });

		expect(localStorage.getItem('page-init:old')).toBeNull();
		expect(localStorage.getItem(SESSION)).toBeTruthy();
	});
});
