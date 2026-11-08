#!/usr/bin/env node
/**
 * check-non-tenant — auth 门户「业务路由首段」名单与 App.tsx 路由表一致性闸门。
 *
 * 背景（2026-11-08）：裸 /activity、/security 曾漏登记，被 extractSlugFromPath 与
 * shared buildLoginUrl 当成租户 slug。cn 单仓的 ui/scripts/check-non-tenant.mjs 能发现，
 * 但部署源是本仓（没有 sites/ 兄弟目录），闸门被跳过。
 *
 * 本脚本把同一派生规则搬进部署仓，挂在 prebuild：漂移即构建失败（Vercel 部署前拦截）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP = join(ROOT, 'apps/auth-pages');
const APP_TSX = join(APP, 'src/App.tsx');
const DECL = join(APP, 'src/non-tenant-segments.ts');

// 与 shared/src/auth/slug-from-url.ts 的 RESERVED_SEGMENTS 保持一致。
const RESERVED = ['oauth', 'bff', 'api', 'api-v1', 'health', 'metrics', 'assets', 'docs', 'scalar', 'fonts', 'env.js', 'sdk', 'static'];

function deriveSegments(appTsx) {
  const paths = Array.from(readFileSync(appTsx, 'utf8').matchAll(/<Route[^>]*?\spath="([^"]*)"/g)).map((m) => m[1]);
  return Array.from(new Set(
    paths
      .map((p) => p.replace(/^\/+/, '').split('/')[0])
      .filter((x) => x && x !== '*' && x.indexOf(':') !== 0)
      .map((x) => x.toLowerCase()),
  )).filter((x) => !RESERVED.includes(x)).sort();
}

function declaredSegments(file) {
  const t = readFileSync(file, 'utf8');
  const m = /export const NON_TENANT_SEGMENTS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(t);
  if (!m) return null;
  return Array.from(m[1].matchAll(/'([^']*)'/g)).map((x) => x[1].toLowerCase()).sort();
}

function main() {
  if (!existsSync(APP_TSX)) {
    console.error(`[check-non-tenant] 缺少 ${APP_TSX}`);
    process.exit(2);
  }
  if (!existsSync(DECL)) {
    console.error('[check-non-tenant] 缺少 src/non-tenant-segments.ts');
    process.exit(1);
  }

  const expected = deriveSegments(APP_TSX);
  const declared = declaredSegments(DECL);
  if (declared === null) {
    console.error('[check-non-tenant] non-tenant-segments.ts 里找不到 NON_TENANT_SEGMENTS 数组声明');
    process.exit(1);
  }

  const missing = expected.filter((x) => !declared.includes(x));
  const extra = declared.filter((x) => !expected.includes(x));
  if (missing.length || extra.length) {
    if (missing.length) console.error(`[check-non-tenant] 路由表有、名单缺：${missing.join(', ')}`);
    if (extra.length) console.error(`[check-non-tenant] 名单有、路由表没有：${extra.join(', ')}（会误伤同名真实租户）`);
    console.error('[check-non-tenant] 修法：按 App.tsx 重新派生并更新 apps/auth-pages/src/non-tenant-segments.ts');
    process.exit(1);
  }

  // 名单存在还不够：必须真的被 main.tsx 以副作用 import。
  const MAIN = join(APP, 'src/main.tsx');
  if (!existsSync(MAIN) || !/import\s+['"]\.\/non-tenant-segments['"]/.test(readFileSync(MAIN, 'utf8'))) {
    console.error("[check-non-tenant] main.tsx 没有 import './non-tenant-segments'（名单未注册）");
    process.exit(1);
  }

  console.log(`[check-non-tenant] OK：${declared.length} 段业务路由首段，已注册且与 App.tsx 一致`);
}

main();
