import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 区域回归锁（B3 单源双区；执行卡 §1.7）：站点区域值不得散落源码/HTML。
// 唯一合法出处在构建期单点链路：scripts/env.mjs（node 侧）+ src/lib/site-env.ts（客户端侧，
// 本地兜底值在此一处）；index.html 一律 {{TOKEN}} 占位符，由 vite regionPlugin 注入。
// 白名单：__tests__（夹具）、src/lib/site-env.ts（区域读单点）。
// 不在扫描面：i18n locale JSON（内容语料，非 ts/tsx）。
const BANNED: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /autional\.(cn|com)/, label: '区域域名字面量（应走 site-env / {{TOKEN}}）' },
	{ pattern: /tianv/, label: 'tianv 遗留域名' },
];

const APP_ROOT = process.cwd();
const SRC_ROOT = resolve(APP_ROOT, 'src');
const EXEMPT = new Set([resolve(SRC_ROOT, 'lib', 'site-env.ts')]);

function collectSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === '__tests__' || entry.name === 'test') continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectSourceFiles(full));
		} else if (/\.tsx?$/.test(entry.name) && !EXEMPT.has(resolve(full))) {
			out.push(full);
		}
	}
	return out;
}

function findOffenders(files: string[]): string[] {
	const offenders: string[] = [];
	for (const file of files) {
		const content = readFileSync(file, 'utf8');
		for (const { pattern, label } of BANNED) {
			if (pattern.test(content)) {
				offenders.push(`${file.slice(APP_ROOT.length)} [${label}]`);
			}
		}
	}
	return offenders;
}

describe('区域字面量回归锁', () => {
	it('index.html 无区域字面量（占位符 {{TOKEN}} 由构建期注入）', () => {
		expect(findOffenders([resolve(APP_ROOT, 'index.html')])).toEqual([]);
	});

	it('src 源码无区域字面量（唯一例外 = site-env 白名单）', () => {
		expect(findOffenders(collectSourceFiles(SRC_ROOT))).toEqual([]);
	});
});
