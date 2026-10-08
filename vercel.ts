import { routes, type VercelConfig } from '@vercel/config/v1';

/**
 * 身份认证（auth.autional.com / auth.autional.cn）的**唯一源站**（B3 单源双区）。
 *
 * 上游 API origin 值 **不写入本仓**，取自 Vercel 项目环境变量 `API_ORIGIN`
 * （cn 项目 = https://api.autional.cn，com 项目 = https://api.autional.com）。
 * 未设置时 **故意抛错**（fail-closed），避免静默产出坏路由。
 *
 * rewrites 承接原 vercel.json 全集（/bff、/api/v1、/oauth/authorize 与 /oauth/callback 直通、
 * /oauth、/tenant）；`/(.*)` 兜底保持 SPA 语义（rewrites 在文件系统检查后生效，静态资源不受影响）。
 */
const rawOrigin = process.env.API_ORIGIN;

if (!rawOrigin) {
  throw new Error(
    '[auth] 缺少环境变量 API_ORIGIN（Vercel 项目设置里配置后重新部署）',
  );
}

const ORIGIN = rawOrigin.replace(/\/+$/, '');

export const config: VercelConfig = {
  framework: 'vite',
  installCommand: 'pnpm install --frozen-lockfile',
  buildCommand: 'pnpm --filter @autional/auth-pages... build',
  outputDirectory: 'apps/auth-pages/dist',
  rewrites: [
    routes.rewrite('/bff/:path*', `${ORIGIN}/bff/:path*`),
    routes.rewrite('/api/v1/:path*', `${ORIGIN}/api/v1/:path*`),
    routes.rewrite('/oauth/api/v1/oauth/authorize', '/index.html'),
    routes.rewrite('/oauth/callback', '/index.html'),
    routes.rewrite('/oauth/api/v1/oauth/callback/:provider', '/index.html'),
    routes.rewrite('/oauth/:path*', `${ORIGIN}/oauth/:path*`),
    routes.rewrite('/tenant/:path*', `${ORIGIN}/tenant/:path*`),
    routes.rewrite('/(.*)', '/index.html'),
  ],
};
