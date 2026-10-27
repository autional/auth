import { routes, type Rewrite, type VercelConfig } from '@vercel/config/v1';

/**
 * 身份认证（auth.autional.com / auth.autional.cn）的**唯一源站**（B3 单源双区）。
 *
 * 上游 API origin 值 **不写入本仓**，取自 Vercel 项目环境变量 `API_ORIGIN`
 * （cn 项目 = https://api.autional.cn，com 项目 = https://api.autional.com）。
 * 未设置时 **故意抛错**（fail-closed），避免静默产出坏路由。
 *
 * rewrites 承接原 vercel.json 全集（/bff、/api/v1、/oauth/authorize 与 /oauth/callback 直通、
 * /oauth）；SPA 兜底只在 Accept 含 text/html 时生效——缺失的 /assets/*.js 返回 404，
 * 不会被兜底成 200 的 index.html。
 */
const rawOrigin = process.env.API_ORIGIN;

if (!rawOrigin) {
  throw new Error(
    '[auth] 缺少环境变量 API_ORIGIN（Vercel 项目设置里配置后重新部署）',
  );
}

const ORIGIN = rawOrigin.replace(/\/+$/, '');

const NO_CACHE = 'public, max-age=0, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';

const spaFallback: Rewrite = {
  source: '/(.*)',
  destination: '/index.html',
  has: [{ type: 'header', key: 'accept', value: { re: 'text/html' } }],
};

export const config: VercelConfig = {
  framework: 'vite',
  installCommand: 'pnpm install --frozen-lockfile',
  buildCommand: 'pnpm --filter @autional/auth-pages... build',
  outputDirectory: 'apps/auth-pages/dist',
  headers: [
    routes.header('/assets/(.*)', [{ key: 'Cache-Control', value: IMMUTABLE }]),
    routes.header('/workbox-(.*).js', [{ key: 'Cache-Control', value: IMMUTABLE }]),
    routes.header('/', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/index.html', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/sw.js', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/registerSW.js', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/manifest.webmanifest', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/env.js', [{ key: 'Cache-Control', value: NO_CACHE }]),
  ],
  rewrites: [
    routes.rewrite('/bff/:path*', `${ORIGIN}/bff/:path*`),
    routes.rewrite('/api/v1/:path*', `${ORIGIN}/api/v1/:path*`),
    routes.rewrite('/oauth/api/v1/oauth/authorize', '/index.html'),
    routes.rewrite('/oauth/callback', '/index.html'),
    routes.rewrite('/oauth/callback/:provider', '/index.html'),
    routes.rewrite('/oauth/api/v1/oauth/callback/:provider', '/index.html'),
    routes.rewrite('/oauth/:path*', `${ORIGIN}/oauth/:path*`),
    spaFallback,
  ],
};
