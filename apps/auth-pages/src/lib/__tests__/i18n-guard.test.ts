import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 语言回归锁（W4 系，同 region-guard 口径）：① 源码（注释除外）不得出现中文字面量 —— 文案一律 t() + 双 bundle；
// 默认值形态放行：单行 t('键','含中文默认值')（或 t('键') || '含中文'）且键在双 bundle 齐备
// —— 默认值 = 防失键兜底，运行时文案仍取 bundle（键存在性由 ② 锁死，键集合一致性由 ③ 锁死）。
// ② t() 字面量键必须同时存在于 zh-CN / en-US（keySeparator:false 平铺键）；
// ③ 双 bundle 键集合一致（防单边新增/漏译）。
// 豁免机制：行尾或上一行的 `i18n-exempt: <原因>`；文件任意处的 `i18n-exempt-file: <原因>`。
// 扫描面排除：__tests__ / test / harness / locales（语料本体）。
// 建锁时存量（2026-10-14）：单行默认值 73 处（EmailCode/PhoneCode/IdentifierFirst 等表单族，键均双 bundle 齐备）；
// i18n-exempt 1 处（verify-email/page.tsx 服务端响应文案归一匹配）。
const APP_ROOT = process.cwd();
const SRC_ROOT = resolve(APP_ROOT, 'src');
const CJK = /[一-鿿]/;
const SKIP_DIRS = new Set(['__tests__', 'test', 'harness', 'locales', 'node_modules', 'dist']);

function collectSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectSourceFiles(full));
		} else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|stories)\./.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

// 注释置空（保留行结构）：字符串常量为实际文案，必须保留在检测面内
function stripComments(src: string): string {
	let out = '';
	let i = 0;
	let state = 'code';
	while (i < src.length) {
		const c = src[i];
		const c2 = src[i + 1];
		if (state === 'code') {
			if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
			if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
			if (c === "'") state = 'sq';
			else if (c === '"') state = 'dq';
			else if (c === '`') state = 'tpl';
			out += c; i++; continue;
		}
		if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } else out += ' '; i++; continue; }
		if (state === 'block') { if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; } out += c === '\n' ? c : ' '; i++; continue; }
		if (c === '\\') { out += c + (c2 || ''); i += 2; continue; }
		if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
		out += c; i++;
	}
	return out;
}

function flatKeys(obj: unknown, prefix = ''): Set<string> {
	const out = new Set<string>();
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return out;
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
			for (const f of flatKeys(v, key)) out.add(f);
		} else {
			out.add(key);
		}
	}
	return out;
}

const FILES = collectSourceFiles(SRC_ROOT);
const ZH_KEYS = flatKeys(JSON.parse(readFileSync(resolve(SRC_ROOT, 'i18n/locales/zh-CN.json'), 'utf8')));
const EN_KEYS = flatKeys(JSON.parse(readFileSync(resolve(SRC_ROOT, 'i18n/locales/en-US.json'), 'utf8')));

function rel(file: string): string {
	return file.slice(SRC_ROOT.length + 1).split('\\').join('/');
}

// 单行 t() 带中文默认值且键在双 bundle 齐备 → 放行（该行其余位置出现中文仍会被 ① 之外形态捕获）
function hasBundledDefault(line: string): boolean {
	const withDefault = line.match(/\bt\(\s*(['"])([^'"]+)\1\s*,\s*(['"])((?:\\.|(?!\3).)*?)\3/);
	if (withDefault && ZH_KEYS.has(withDefault[2]) && EN_KEYS.has(withDefault[2])) return true;
	const orDefault = line.match(/\bt\(\s*(['"])([^'"]+)\1\s*\)\s*(?:\|\||\?\?)\s*(['"])((?:\\.|(?!\3).)*?)\3/);
	if (orDefault && ZH_KEYS.has(orDefault[2]) && EN_KEYS.has(orDefault[2])) return true;
	return false;
}

describe('语言字面量回归锁', () => {
	it('src 源码（注释外）无中文字面量（双 bundle 默认值 / 豁免注记除外）', () => {
		const leaks: string[] = [];
		for (const file of FILES) {
			const raw = readFileSync(file, 'utf8');
			const rawLines = raw.split('\n');
			if (rawLines.some((l) => l.includes('i18n-exempt-file:'))) continue;
			const lines = stripComments(raw).split('\n');
			for (let i = 0; i < lines.length; i++) {
				if (!CJK.test(lines[i])) continue;
				const self = rawLines[i] || '';
				const above = rawLines[i - 1] || '';
				if (self.includes('i18n-exempt:') || above.includes('i18n-exempt:')) continue;
				if (hasBundledDefault(lines[i])) continue;
				leaks.push(`${rel(file)}:${i + 1}`);
			}
		}
		expect(leaks).toEqual([]);
	});

	it('t() 字面量键在双 bundle 中存在', () => {
		const missing: string[] = [];
		for (const file of FILES) {
			const stripped = stripComments(readFileSync(file, 'utf8'));
			for (const m of stripped.matchAll(/\bt\(\s*(['"])([^'"\\]+)\1/g)) {
				const key = m[2];
				if (!ZH_KEYS.has(key)) missing.push(`${rel(file)}: t('${key}') 缺 zh-CN`);
				if (!EN_KEYS.has(key)) missing.push(`${rel(file)}: t('${key}') 缺 en-US`);
			}
		}
		expect(missing).toEqual([]);
	});

	it('双 bundle 键集合一致', () => {
		const zhOnly = [...ZH_KEYS].filter((k) => !EN_KEYS.has(k));
		const enOnly = [...EN_KEYS].filter((k) => !ZH_KEYS.has(k));
		expect({ zhOnly, enOnly }).toEqual({ zhOnly: [], enOnly: [] });
	});
});
