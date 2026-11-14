import { describe, it, expect, beforeEach } from 'vitest';
import { consumeMfaTicketFragment, parseMfaTicketFragment } from '../mfa-ticket';

describe('parseMfaTicketFragment', () => {
	it('解析 mfa_ticket + identity（identity 走百分号解码）', () => {
		expect(parseMfaTicketFragment('#mfa_ticket=mt_abc&identity=alice%40example.com')).toEqual({
			ticket: 'mt_abc',
			identity: 'alice@example.com',
		});
	});

	it('容忍无前导 # / 只有票据 / 参数顺序颠倒', () => {
		expect(parseMfaTicketFragment('mfa_ticket=mt_abc')).toEqual({
			ticket: 'mt_abc',
			identity: '',
		});
		expect(parseMfaTicketFragment('#identity=alice%40example.com&mfa_ticket=mt_abc')).toEqual({
			ticket: 'mt_abc',
			identity: 'alice@example.com',
		});
	});

	it('无关 fragment / 空串 → 无票据', () => {
		expect(parseMfaTicketFragment('')).toEqual({ ticket: '', identity: '' });
		expect(parseMfaTicketFragment('#')).toEqual({ ticket: '', identity: '' });
		expect(parseMfaTicketFragment('#access_token=at')).toEqual({ ticket: '', identity: '' });
	});
});

describe('consumeMfaTicketFragment', () => {
	beforeEach(() => {
		window.history.replaceState(null, '', '/acme-corp/login');
	});

	it('读取后立即剥离 fragment，保留 path + search', () => {
		window.history.replaceState(
			null,
			'',
			'/acme-corp/login?redirect=%2Fdashboard#mfa_ticket=mt_abc&identity=alice%40example.com',
		);

		expect(consumeMfaTicketFragment()).toEqual({
			ticket: 'mt_abc',
			identity: 'alice@example.com',
		});
		expect(window.location.hash).toBe('');
		expect(window.location.pathname).toBe('/acme-corp/login');
		expect(window.location.search).toBe('?redirect=%2Fdashboard');
	});

	it('无 fragment 时不动地址栏', () => {
		window.history.replaceState(null, '', '/acme-corp/login?x=1');

		expect(consumeMfaTicketFragment()).toEqual({ ticket: '', identity: '' });
		expect(window.location.search).toBe('?x=1');
		expect(window.location.hash).toBe('');
	});

	it('票据不落任何持久层', () => {
		window.history.replaceState(null, '', '/acme-corp/login#mfa_ticket=mt_abc');

		consumeMfaTicketFragment();
		expect(sessionStorage.getItem('mfa_ticket')).toBeNull();
		expect(sessionStorage.getItem('mfaTicket')).toBeNull();
		expect(localStorage.getItem('mfa_ticket')).toBeNull();
		expect(localStorage.getItem('mfaTicket')).toBeNull();
	});
});
