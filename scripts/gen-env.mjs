#!/usr/bin/env node
/**
 * gen-env.mjs —— B3 构建前生成物（执行卡 §1.2；写进 apps/auth-pages/public/，
 * Vite 构建时随 public 拷进 dist/）：
 *
 *   public/env.js       ← window.__APP_CONFIG__（@autional/shared 运行时配置形状）
 *   public/robots.txt   ← SITE_URL + 区域注释
 *
 * 纪律：均为生成物（已 gitignore + git rm --cached）——勿手改、勿入库；幂等（同 env 输出一致）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildEnv } from './env.mjs';
import { REGION_COPY } from './region-copy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const buildEnv = readBuildEnv();
const copy = REGION_COPY[buildEnv.defaultLang];
const publicDir = join(root, 'apps', 'auth-pages', 'public');

const write = (rel, content) => {
  const file = join(publicDir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

// ── 1. env.js（@autional/shared getEnv 读取形状，勿改键名）────────────────────
const PORTALS = [
  ['landing', 'www'],
  ['auth', 'auth'],
  ['user', 'user'],
  ['authenticator', 'authenticator'],
  ['admin', 'admin'],
  ['developer', 'developer'],
  ['security', 'security'],
  ['platform', 'platform'],
  ['status', 'status'],
  ['trust', 'trust'],
  ['brand', 'brand'],
];
const portalConfig = PORTALS.map(([name, host]) => `    ${name}: { host: "${host}", base: "" }`).join(',\n');
write(
  'env.js',
  `window.__APP_CONFIG__ = {
  BASE_PATH: "/",
  VITE_ROOT_DOMAIN: "${buildEnv.rootDomain}",
  VITE_PORTAL_CONFIG: {
${portalConfig}
  },
  VITE_COOKIE_DOMAIN: ".${buildEnv.rootDomain}",
  VITE_API_BASE_URL: "/bff"
};
`,
);

// ── 2. robots.txt ────────────────────────────────────────────────────────────
write(
  'robots.txt',
  `# ${buildEnv.siteHost} — ${copy.robotsComment.join('\n# ')}\nUser-agent: *\nAllow: /\n`,
);
