import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	classifyPasskeyFailure,
	isConditionalMediationSupported,
	isPasskeyAvailable,
	isPasskeyHostAllowed,
	isPasskeySupported,
} from '@/lib/passkey-support';

// B3 passkey 可用性判定：`.com` 注册域不提供 / 设备能力 / 条件式能力 / 降级归因
// 全部收敛在 lib/passkey-support，此处逐条锁定（组件只做呈现）。

afterEach(() => {
	delete (window as any).PublicKeyCredential;
	if (originalLocation) {
		Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
		originalLocation = null;
	}
});

// jsdom 的 location.hostname 不可在实例上重定义 → 整体替换 location（同 login.test.tsx 口径）
let originalLocation: Location | null = null;

function stubHostname(hostname: string) {
	if (!originalLocation) originalLocation = window.location;
	const original = originalLocation;
	delete (window as any).location;
	(window as any).location = Object.defineProperties(
		{},
		{
			...Object.getOwnPropertyDescriptors(original),
			hostname: { get: () => hostname, configurable: true },
		},
	);
}

describe('isPasskeyHostAllowed', () => {
	it('`.com` 注册域不允许（RP ID 不可跨注册域）', () => {
		expect(isPasskeyHostAllowed('auth.autional.com')).toBe(false);
		expect(isPasskeyHostAllowed('portal.example.com')).toBe(false);
	});

	it('`.com` 结尾之外的域允许', () => {
		expect(isPasskeyHostAllowed('auth.autional.cn')).toBe(true);
		expect(isPasskeyHostAllowed('auth.example.com.cn')).toBe(true);
		expect(isPasskeyHostAllowed('localhost')).toBe(true);
		expect(isPasskeyHostAllowed('127.0.0.1')).toBe(true);
	});

	it('无 host（SSR / 夹具）不拦截', () => {
		expect(isPasskeyHostAllowed('')).toBe(true);
	});

	it('缺省取 window.location.hostname', () => {
		stubHostname('auth.autional.com');
		expect(isPasskeyHostAllowed()).toBe(false);

		stubHostname('auth.autional.cn');
		expect(isPasskeyHostAllowed()).toBe(true);
	});
});

describe('isPasskeySupported / isConditionalMediationSupported', () => {
	it('无 PublicKeyCredential 视为不支持', () => {
		delete (window as any).PublicKeyCredential;
		expect(isPasskeySupported()).toBe(false);
	});

	it('有 PublicKeyCredential 视为支持', () => {
		(window as any).PublicKeyCredential = function () {};
		expect(isPasskeySupported()).toBe(true);
	});

	it('缺 isConditionalMediationAvailable 时条件式不可用', async () => {
		(window as any).PublicKeyCredential = function () {};
		await expect(isConditionalMediationSupported()).resolves.toBe(false);
	});

	it('isConditionalMediationAvailable() 返回 false / 抛错时条件式不可用', async () => {
		(window as any).PublicKeyCredential = Object.assign(function () {}, {
			isConditionalMediationAvailable: vi.fn(async () => false),
		});
		await expect(isConditionalMediationSupported()).resolves.toBe(false);

		(window as any).PublicKeyCredential = Object.assign(function () {}, {
			isConditionalMediationAvailable: vi.fn(async () => {
				throw new Error('boom');
			}),
		});
		await expect(isConditionalMediationSupported()).resolves.toBe(false);
	});

	it('isConditionalMediationAvailable() 返回 true 时条件式可用', async () => {
		(window as any).PublicKeyCredential = Object.assign(function () {}, {
			isConditionalMediationAvailable: vi.fn(async () => true),
		});
		await expect(isConditionalMediationSupported()).resolves.toBe(true);
	});
});

describe('isPasskeyAvailable', () => {
	it('域 + 设备双条件都满足才可用', () => {
		(window as any).PublicKeyCredential = function () {};
		expect(isPasskeyAvailable('auth.autional.cn')).toBe(true);
		expect(isPasskeyAvailable('auth.autional.com')).toBe(false);

		delete (window as any).PublicKeyCredential;
		expect(isPasskeyAvailable('auth.autional.cn')).toBe(false);
	});
});

describe('classifyPasskeyFailure', () => {
	it('用户取消 / 无可用凭据（NotAllowedError）归为 cancelled', () => {
		expect(classifyPasskeyFailure(new DOMException('x', 'NotAllowedError'))).toBe('cancelled');
	});

	it('超时归为 timeout', () => {
		expect(classifyPasskeyFailure(new DOMException('x', 'TimeoutError'))).toBe('timeout');
	});

	it('域 / origin 校验失败归为 security', () => {
		expect(classifyPasskeyFailure(new DOMException('x', 'SecurityError'))).toBe('security');
	});

	it('能力缺失归为 unsupported', () => {
		expect(classifyPasskeyFailure(new DOMException('x', 'NotSupportedError'))).toBe('unsupported');
	});

	it('租户关闭（403 passkey disabled by tenant policy）归为 tenant_disabled', () => {
		expect(
			classifyPasskeyFailure({
				response: {
					status: 403,
					data: { code: 40300001, title: 'passkey disabled by tenant policy' },
				},
			}),
		).toBe('tenant_disabled');
	});

	it('其它 403 不误判为租户关闭', () => {
		expect(
			classifyPasskeyFailure({
				name: 'AxiosError',
				response: { status: 403, data: { code: 40300002, title: 'membership pending approval' } },
			}),
		).toBe('error');
	});

	it('AbortError 与其它异常归为 error（主动 abort 由调用方先短路）', () => {
		expect(classifyPasskeyFailure(new DOMException('x', 'AbortError'))).toBe('error');
		expect(classifyPasskeyFailure(new Error('network'))).toBe('error');
		expect(classifyPasskeyFailure(undefined)).toBe('error');
	});
});
