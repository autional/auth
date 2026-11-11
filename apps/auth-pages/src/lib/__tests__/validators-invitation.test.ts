import { describe, it, expect } from 'vitest';
import { createRegisterSchema } from '../validators';

// 邀请邮箱绑定（A 方案）：邮箱/验证码为可选字段，但填了验证码就必须同时填邮箱。
const t = (key: string) => key;

const base = {
	username: 'invitee01',
	password: 'Password123!',
	confirmPassword: 'Password123!',
	agreeTerms: true as const,
	invitation_code: 'INV-123',
};

describe('createRegisterSchema (invitation_only)', () => {
	const schema = createRegisterSchema(t, undefined, 'invitation_only');

	it('accepts invitation without email fields (internal invites)', () => {
		expect(schema.safeParse(base).success).toBe(true);
	});

	it('accepts invitation with matching email + 6-digit code', () => {
		const r = schema.safeParse({ ...base, email: 'invitee@example.com', email_code: '123456' });
		expect(r.success).toBe(true);
	});

	it('rejects a code without an email', () => {
		const r = schema.safeParse({ ...base, email_code: '123456' });
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues.some((i) => i.path.includes('email'))).toBe(true);
		}
	});

	it('rejects a malformed email', () => {
		const r = schema.safeParse({ ...base, email: 'not-an-email', email_code: '123456' });
		expect(r.success).toBe(false);
	});

	it('rejects a non-6-digit code', () => {
		const r = schema.safeParse({ ...base, email: 'invitee@example.com', email_code: '12ab' });
		expect(r.success).toBe(false);
	});
});
