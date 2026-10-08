/**
 * 构建期区域环境读取单点（apps/auth-pages/vite.config.ts 与 scripts/gen-env.mjs 共用）。
 *
 * 变量名与值域见 docs/positioning/24 §3（Vercel 项目侧注入）：
 *   REGION=cn|com  SITE_URL  DEFAULT_LANG=zh|en  FALLBACK_LANG=zh|en  CDN_HOST
 * 本地 dev 无 env 时兜底 cn 值（与迁移前基线一致）。
 */
export const CDN_PIN = 'v0.1.0-rc.f0db1b97';

const pickLang = (v) => (v === 'en' || v === 'zh' ? v : undefined);

export function readBuildEnv(env = process.env) {
  const region = env.REGION === 'com' ? 'com' : 'cn';
  const siteUrl = (env.SITE_URL || 'https://auth.autional.cn').replace(/\/+$/, '');
  const defaultLang = pickLang(env.DEFAULT_LANG) ?? (region === 'com' ? 'en' : 'zh');
  const fallbackLang = pickLang(env.FALLBACK_LANG) ?? defaultLang;
  const cdnHost = (env.CDN_HOST || 'https://cdn.autional.cn').replace(/\/+$/, '');
  const siteHost = new URL(siteUrl).host;
  const rootDomain = siteHost.split('.').slice(-2).join('.');
  return { region, siteUrl, defaultLang, fallbackLang, cdnHost, siteHost, rootDomain };
}
