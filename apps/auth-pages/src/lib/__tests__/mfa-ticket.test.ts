import { describe, it, expect, beforeEach } from 'vitest';
import { consumeMfaTicketFragment, parseMfaTicketFragment } from '../mfa-ticket';

// Phase 1（docs/MFA-BRIDGE-BOUNDARY-PHASE1 §5.8）：fragment 增 `client_id`（公开标识）。
// 非真实 ULID 夹具：避免与「前端源码 client_id 字面量 = 0」守卫冲突，本模块也不校验格式。
const CLIENT_ID = 'client_test_bridge01';

describe('parseMfaTicketFragment', () => {
	it('解析 mfa_ticket + identity（identity 走百分号解码）；无 client_id 时为空串', () => {
		expect(parseMfaTicketFragment('#mfa_ticket=mt_abc&identity=alice%40example.com')).toEqual({
			ticket: 'mt_abc',
			identity: 'alice@example.com',
			clientId: '',
		});
	});

	it('解析 client_id（Phase 1 受众绑定），与票据/身份证独立取值', () => {
		expect(
			parseMfaTicketFragment(
				`#mfa_ticket=mt_abc&identity=alice%40example.com&client_id=${CLIENT_ID}`,
			),
		).toEqual({
			ticket: 'mt_abc',
			identity: 'alice@example.com',
			clientId: CLIENT_ID,
		});
		// 只有票据 + 受众（无 identity）也如实解析
		expect(parseMfaTicketFragment(`#mfa_ticket=mt_abc&client_id=${CLIENT_ID}`)).toEqual({
			ticket: 'mt_abc',
			identity: '',
			clientId: CLIENT_ID,
		});
	});

	it('空 ticket + client_id：纯解析如实返回，不抛异常（是否使用由调用方按有无票据决定）', () => {
		expect(parseMfaTicketFragment(`#mfa_ticket=&identity=alice&client_id=${CLIENT_ID}`)).toEqual({
			ticket: '',
			identity: 'alice',
			clientId: CLIENT_ID,
		});
		expect(parseMfaTicketFragment(`#client_id=${CLIENT_ID}`)).toEqual({
			ticket: '',
			identity: '',
			clientId: CLIENT_ID,
		});
	});

	it('重复键取首值（mfa_ticket / client_id 同规则）', () => {
		expect(
			parseMfaTicketFragment(
				`#mfa_ticket=mt_first&mfa_ticket=mt_second&client_id=${CLIENT_ID}&client_id=client_second`,
			),
		).toEqual({ ticket: 'mt_first', identity: '', clientId: CLIENT_ID });
	});

	it('容忍无前导 # / 只有票据 / 参数顺序颠倒', () => {
		expect(parseMfaTicketFragment('mfa_ticket=mt_abc')).toEqual({
			ticket: 'mt_abc',
			identity: '',
			clientId: '',
		});
		expect(parseMfaTicketFragment('#identity=alice%40example.com&mfa_ticket=mt_abc')).toEqual({
			ticket: 'mt_abc',
			identity: 'alice@example.com',
			clientId: '',
		});
	});

	it('无关 fragment / 空串 → 无票据（不遗留 clientId）', () => {
		expect(parseMfaTicketFragment('')).toEqual({ ticket: '', identity: '', clientId: '' });
		expect(parseMfaTicketFragment('#')).toEqual({ ticket: '', identity: '', clientId: '' });
		expect(parseMfaTicketFragment('#access_token=at')).toEqual({
			ticket: '',
			identity: '',
			clientId: '',
		});
	});
});

describe('consumeMfaTicketFragment', () => {
	beforeEach(() => {
		window.history.replaceState(null, '', '/acme-corp/login');
	});

	it('读取后立即剥离 fragment，保留 path + search（client_id 一并清除）', () => {
		window.history.replaceState(
			null,
			'',
			`/acme-corp/login?redirect=%2Fdashboard#mfa_ticket=mt_abc&identity=alice%40example.com&client_id=${CLIENT_ID}`,
		);

		expect(consumeMfaTicketFragment()).toEqual({
			ticket: 'mt_abc',
			identity: 'alice@example.com',
			clientId: CLIENT_ID,
		});
		expect(window.location.hash).toBe('');
		expect(window.location.pathname).toBe('/acme-corp/login');
		// 剥离只动 fragment：search（含 redirect）必须原样保留
		expect(window.location.search).toBe('?redirect=%2Fdashboard');
	});

	it('无 fragment 时不动地址栏', () => {
		window.history.replaceState(null, '', '/acme-corp/login?x=1');

		expect(consumeMfaTicketFragment()).toEqual({ ticket: '', identity: '', clientId: '' });
		expect(window.location.search).toBe('?x=1');
		expect(window.location.hash).toBe('');
	});

	it('票据与受众不落任何持久层', () => {
		window.history.replaceState(
			null,
			'',
			`/acme-corp/login#mfa_ticket=mt_abc&client_id=${CLIENT_ID}`,
		);

		consumeMfaTicketFragment();
		expect(sessionStorage.getItem('mfa_ticket')).toBeNull();
		expect(sessionStorage.getItem('mfaTicket')).toBeNull();
		expect(sessionStorage.getItem('client_id')).toBeNull();
		expect(sessionStorage.getItem('clientId')).toBeNull();
		expect(localStorage.getItem('mfa_ticket')).toBeNull();
		expect(localStorage.getItem('mfaTicket')).toBeNull();
		expect(localStorage.getItem('client_id')).toBeNull();
		expect(localStorage.getItem('clientId')).toBeNull();
	});
});
