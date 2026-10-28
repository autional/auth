/**
 * 本地存储健康（R1/R5，2026-10-28 浏览器实测后新增）。
 *
 * 背景（实测）：
 *  - localStorage 写满时，`loginWithTokens` 的 persist 会失败：登录接口 200，但会话只存在
 *    内存里，刷新即丢失；旧实现直接落到 catch，界面停在登录表单且**没有任何提示**。
 *  - `page-init:*` 与 legacy `auth-config:*` / `tenant-branding:*` 只增不减，且同一份数据
 *    写两遍（多租户长期使用后可达上百键），是写满的主要来源。
 *
 * 本模块只做两件事，且都只碰「可重建缓存」，绝不碰会话与偏好：
 *  1. persistSessionWithRetry：会话写失败 → 清缓存 → 重试一次 → 仍失败则由调用方明确报错。
 *  2. trimCaches：启动时按「过期 + 数量上限」裁剪缓存，防止无限增长。
 */

/** 会话持久化键（与 @autional/shared 的 zustand persist name 一致）。 */
const SESSION_KEY = 'autional-auth-v1';

/** 可重建缓存的前缀：删掉只会触发重新拉取。 */
const REBUILDABLE_PREFIXES = ['page-init:', 'auth-config:', 'tenant-branding:'];

/** 永不删除的键（会话、落点、登出用 client_id、偏好与指纹）。 */
const PROTECTED_KEYS = new Set([
	SESSION_KEY,
	'auth_dashboard_slug',
	'oauth_client_id',
	'lang',
	'i18nextLng',
	'device_fingerprint',
	'remember_me',
]);

const PROBE_KEY = '__storage_probe__';

/** 会话是否真的落到了 localStorage（有 token 才算）。 */
export function sessionPersisted(): boolean {
	try {
		const raw = localStorage.getItem(SESSION_KEY);
		if (!raw) return false;
		const state = JSON.parse(raw)?.state;
		return Boolean(state && (state.accessToken || state.refreshToken));
	} catch {
		return false;
	}
}

/** 删除可重建缓存，返回删除条数。不触碰会话与偏好。 */
export function purgeRebuildableCaches(): number {
	let removed = 0;
	try {
		const doomed: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || PROTECTED_KEYS.has(key)) continue;
			if (REBUILDABLE_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
		}
		for (const key of doomed) {
			localStorage.removeItem(key);
			removed += 1;
		}
	} catch {
		/* localStorage 不可用：静默，调用方按持久化失败处理 */
	}
	return removed;
}

/**
 * 尝试持久化会话：写一次 → 没落库就清缓存再写一次。
 * @param apply 触发持久化的动作（通常是 `loginWithTokens(...)`）
 * @returns 最终是否真的落到 localStorage
 */
export function persistSessionWithRetry(apply: () => void): boolean {
	try {
		apply();
	} catch {
		/* 写失败（可能 QuotaExceeded）：继续走清理重试 */
	}
	if (sessionPersisted()) return true;
	purgeRebuildableCaches();
	try {
		apply();
	} catch {
		/* 清理后仍失败：交给调用方报错 */
	}
	return sessionPersisted();
}

/** 是否还有可写空间（探测写入，不保留）。 */
export function hasStorageHeadroom(bytes = 16 * 1024): boolean {
	try {
		localStorage.setItem(PROBE_KEY, 'x'.repeat(bytes));
		localStorage.removeItem(PROBE_KEY);
		return true;
	} catch {
		return false;
	}
}

interface CacheShape {
	_ts?: number;
}

/**
 * 启动时裁剪：先删过期（默认 7 天），再按数量上限保留最新（默认 40 条）。
 * 只作用于可重建缓存；任何异常都吞掉（不能因为清理失败挡住应用启动）。
 */
export function trimCaches(maxAgeMs = 7 * 24 * 60 * 60 * 1000, maxEntries = 40): number {
	let removed = 0;
	try {
		const now = Date.now();
		// 先收集再删除：边遍历边 remove 会让索引位移、漏掉条目（单测已抓过一次）。
		const scanned: Array<{ key: string; ts: number }> = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || PROTECTED_KEYS.has(key)) continue;
			if (!REBUILDABLE_PREFIXES.some((p) => key.startsWith(p))) continue;
			let ts = 0;
			try {
				ts = Number((JSON.parse(localStorage.getItem(key) || '{}') as CacheShape)._ts) || 0;
			} catch {
				ts = 0;
			}
			scanned.push({ key, ts });
		}

		const doomed: string[] = [];
		const fresh: Array<{ key: string; ts: number }> = [];
		for (const entry of scanned) {
			if (!entry.ts || now - entry.ts > maxAgeMs) doomed.push(entry.key);
			else fresh.push(entry);
		}
		if (fresh.length > maxEntries) {
			fresh.sort((a, b) => b.ts - a.ts);
			for (const entry of fresh.slice(maxEntries)) doomed.push(entry.key);
		}
		for (const key of doomed) {
			localStorage.removeItem(key);
			removed += 1;
		}
	} catch {
		/* 清理失败不影响启动 */
	}
	return removed;
}
