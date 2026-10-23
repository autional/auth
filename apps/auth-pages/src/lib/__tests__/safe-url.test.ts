import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from '@/lib/safe-url';

// 与 user 门户 `lib/safe-url.test.ts` 同一组断言：两站语义不得分叉。
// 2026-10-23 背景：auth 仪表盘的 AppTile 曾用 `new URL(value, origin)`，
// 协议相对地址（//evil.com）会被解析成外站并被放行，与 user 门户判定不一致。

describe('safeExternalUrl (auth)', () => {
	it('放行 http/https 并规范化', () => {
		expect(safeExternalUrl('https://novel.example.com')).toBe('https://novel.example.com/');
		expect(safeExternalUrl('http://a.example.com/path?q=1')).toBe('http://a.example.com/path?q=1');
	});

	it('拒绝脚本/数据/本地协议', () => {
		for (const bad of [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			'  javascript:alert(1)  ',
			'java\nscript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'blob:https://evil.example.com/x',
			'file:///etc/passwd',
			'vbscript:msgbox(1)',
		]) {
			expect(safeExternalUrl(bad), bad).toBeUndefined();
		}
	});

	it('拒绝协议相对与畸形地址（相对路径不得被 base 解析成站内链接）', () => {
		for (const bad of [
			'//evil.com',
			'\\\\evil.com',
			'/relative/path',
			'dashboard',
			'https://',
			'https://a b',
			'not a url',
			'',
			'   ',
			null,
			undefined,
		]) {
			expect(safeExternalUrl(bad), String(bad)).toBeUndefined();
		}
	});
});
