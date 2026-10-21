/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

type PrecacheEntry = { url: string; revision: string | null };
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

/** 直通上游的路径：绝不进 Cache Storage（认证/租户数据按请求实时取）。 */
const API_PATH = /^\/(?:bff|api\/v1|tenant|push)\//;
/** 被 Vercel 重写到 index.html 的 OAuth 页面（其余 /oauth/ 是上游代理）。 */
const OAUTH_SPA_PATH = /^\/oauth\/(?:callback$|api\/v1\/oauth\/(?:authorize$|callback\/[^/]+$))/;

function isApiPath(pathname: string): boolean {
  if (API_PATH.test(pathname)) return true;
  return pathname.startsWith('/oauth/') && !OAUTH_SPA_PATH.test(pathname);
}

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const NETWORK_TIMEOUT_MS = 4000;

// 离线/超时兜底：随版本预缓存的应用壳。在线导航始终先取网络，HTML 不进运行时缓存。
const offlineShell = createHandlerBoundToURL('index.html');

registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' && url.origin === self.location.origin && !isApiPath(url.pathname),
  async (options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      return await fetch(options.request, { signal: controller.signal });
    } catch {
      return offlineShell(options);
    } finally {
      clearTimeout(timer);
    }
  },
);

registerRoute(
  ({ url }) => url.origin === self.location.origin && isApiPath(url.pathname),
  new NetworkOnly(),
);

self.skipWaiting();
// 直接调 self.clients.claim() 在安装期执行会被丢弃（激活前无控制器资格）；
// workbox-core 的 clientsClaim() 把 claim 挂到 activate 事件，首访页面才会被接管。
clientsClaim();
