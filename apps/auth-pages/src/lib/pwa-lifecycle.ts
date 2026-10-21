const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const RELOAD_GUARD_MS = 60 * 1000;

/**
 * PWA 生命周期：
 * - 部署后旧页面可能引用已清理的懒加载 chunk → 捕获 vite:preloadError，最多重载一次。
 * - 前台/每 30 分钟主动检查 SW 更新：新版本立即安装并经 skipWaiting + clientsClaim 接管，
 *   当前页面不强制刷新（避免打断表单），下一次导航/刷新使用新资源。
 */
export function setupPwaLifecycle(): void {
  if (typeof window === 'undefined') return;
  setupPreloadRecovery();
  setupUpdateChecks();
}

function setupPreloadRecovery(): void {
  const storageKey = 'autional:pwa-preload-reload-at';
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    try {
      const lastReloadAt = Number(window.sessionStorage.getItem(storageKey) ?? 0);
      if (Number.isFinite(lastReloadAt) && Date.now() - lastReloadAt < RELOAD_GUARD_MS) return;
      window.sessionStorage.setItem(storageKey, String(Date.now()));
    } catch {
      // 存储不可用：宁可保留错误，也不冒重载循环的风险。
      return;
    }
    window.location.reload();
  });
}

function setupUpdateChecks(): void {
  if (!('serviceWorker' in navigator)) return;

  let checking = false;
  const check = () => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.update())
      .catch(() => {
        // 离线或注册尚未就绪：下一轮再试。
      })
      .finally(() => {
        checking = false;
      });
  };

  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
  window.setInterval(check, UPDATE_INTERVAL_MS);
  navigator.serviceWorker.ready.then(check).catch(() => {});
}
