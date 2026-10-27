#!/usr/bin/env node
/**
 * PWA 预缓存守卫（各站逐字同源）。
 *
 * 背景：`vite-plugin-pwa` 的 includeIcons() 会把 manifest.icons 直接塞进
 * additionalManifestEntries，这条路径**绕过 globIgnores**。于是
 * globIgnores 里写 android-chrome-*.png 看着像生效了，实际每次装 SW 仍会
 * 下载 android-chrome-512（145KB）+ -192（24KB）+ apple-touch-icon（22KB）。
 * 2026-10-27 五个站同时栽在这里，故用构建期守卫挡住复发。
 *
 * 运行时机：`npm/pnpm` 的 prebuild（本地与 Vercel 构建都会先跑它）。
 * 判定：
 *   - 无 VitePWA → 跳过；
 *   - manifest.icons 存在但没写 includeManifestIcons: false → **失败**；
 *   - 用了 cdnHeadPlugin 但 index.html 缺 `<!-- preconnect:cdn -->` → **失败**；
 *   - globIgnores 未排除 apple-touch-icon.png → 仅告警（不阻断，属优化项）。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const configPath = join(cwd, 'vite.config.ts');
const indexPath = join(cwd, 'index.html');

if (!existsSync(configPath)) {
	console.error(`[check-pwa] 未找到 ${configPath}（本脚本需在 apps/<app>/ 目录下运行）`);
	process.exit(1);
}

const config = readFileSync(configPath, 'utf8');
const errors = [];
const warnings = [];

const hasPwa = config.includes('VitePWA(');
if (hasPwa) {
	const hasManifestIcons = /manifest:\s*\{[\s\S]*?icons:\s*\[/.test(config);
	const hasDisabled = /includeManifestIcons:\s*false/.test(config);
	if (hasManifestIcons && !hasDisabled) {
		errors.push(
			'manifest.icons 存在但未设 includeManifestIcons: false —— ' +
				'插件会把 manifest 图标注入 additionalManifestEntries，globIgnores 拦不住，' +
				'每次安装多下约 190KB。修法：VitePWA({ ..., includeManifestIcons: false })。',
		);
	}
	if (hasManifestIcons && !/globIgnores:\s*\[[\s\S]*?apple-touch-icon/.test(config)) {
		warnings.push('globIgnores 未排除 **/apple-touch-icon.png（22KB，安装图标不进离线壳）');
	}
}

if (config.includes('cdnHeadPlugin')) {
	if (!existsSync(indexPath)) {
		errors.push('用了 cdnHeadPlugin 但缺少 index.html');
	} else if (!readFileSync(indexPath, 'utf8').includes('<!-- preconnect:cdn -->')) {
		errors.push('用了 cdnHeadPlugin 但 index.html 缺少占位 <!-- preconnect:cdn -->');
	}
}

for (const warning of warnings) console.warn(`[check-pwa] warn: ${warning}`);
if (errors.length > 0) {
	for (const error of errors) console.error(`[check-pwa] error: ${error}`);
	process.exit(1);
}
console.log('[check-pwa] ok');
