/**
 * 构建期区域环境读取单点（apps/auth-pages/vite.config.ts 与 scripts/gen-env.mjs 共用）。
 *
 * 变量名与值域见 docs/positioning/24 §3（Vercel 项目侧注入）：
 *   REGION=cn|com  SITE_URL  DEFAULT_LANG=zh|en  FALLBACK_LANG=zh|en  CDN_HOST
 * 本地 dev 无 env 时兜底 cn 值（与迁移前基线一致）；**生产（VERCEL_ENV=production）缺失即抛错**，见下方 assertStrictEnv。
 */
export const CDN_PIN = 'v0.1.0-rc.f0db1b97';

const pickLang = (v) => (v === 'en' || v === 'zh' ? v : undefined);

/**
 * 生产构建的硬门（2026-10-08 拍板，第 63 轮补·六）：区域变量**缺失即抛错**，不回落到本机开发值。
 * 与 API_ORIGIN 同一条纪律（fail-closed）——「静默产出一个错区域的站点」比构建失败糟得多：
 * 错 CDN 域、错 canonical/robots/OG、错语言，四道闸门在本地都看不见。
 * 触发条件：VERCEL_ENV=production（Vercel 生产部署）或显式 AUTIONAL_STRICT_ENV=1（本地演练）。
 * 另做**串台校验**：REGION 与 SITE_URL 的顶级域必须一致（cn↔.cn / com↔.com）——
 * 两区环境变量一旦配反，产出的整站会指向另一个区域，而页面本身看起来"完全正常"。
 */
const STRICT_REQUIRED = ['REGION', 'SITE_URL', 'CDN_HOST'];

function assertStrictEnv(env) {
  if (env.AUTIONAL_STRICT_ENV !== '1' && env.VERCEL_ENV !== 'production') return;
  const missing = STRICT_REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      '[build-env] 生产构建缺少区域环境变量：' + missing.join(' / ') +
        ' —— 请在 Vercel 项目设置里补齐（见 docs/positioning/20 §2.1）。\n' +
        '           缺失即失败是刻意的：回落本机开发值会静默产出错区域的站点。',
    );
  }
  if (!['cn', 'com'].includes(env.REGION)) {
    throw new Error('[build-env] REGION 只允许 cn|com，收到：' + env.REGION);
  }
  const host = new URL(env.SITE_URL).host;
  if (!host.endsWith('.' + env.REGION)) {
    throw new Error(
      '[build-env] REGION=' + env.REGION + ' 与 SITE_URL=' + env.SITE_URL +
        ' 的顶级域不一致（两区环境变量串台？）',
    );
  }
  for (const k of ['DEFAULT_LANG', 'FALLBACK_LANG']) {
    if (env[k] && !['zh', 'en'].includes(env[k])) {
      throw new Error('[build-env] ' + k + ' 只允许 zh|en，收到：' + env[k]);
    }
  }
}

export function readBuildEnv(env = process.env) {
  assertStrictEnv(env);
  const region = env.REGION === 'com' ? 'com' : 'cn';
  const siteUrl = (env.SITE_URL || 'https://auth.autional.cn').replace(/\/+$/, '');
  const defaultLang = pickLang(env.DEFAULT_LANG) ?? (region === 'com' ? 'en' : 'zh');
  const fallbackLang = pickLang(env.FALLBACK_LANG) ?? defaultLang;
  const cdnHost = (env.CDN_HOST || 'https://cdn.autional.cn').replace(/\/+$/, '');
  const siteHost = new URL(siteUrl).host;
  const rootDomain = siteHost.split('.').slice(-2).join('.');
  return { region, siteUrl, defaultLang, fallbackLang, cdnHost, siteHost, rootDomain };
}
