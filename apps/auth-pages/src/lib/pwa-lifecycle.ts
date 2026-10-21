const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const RELOAD_GUARD_MS = 60 * 1000;
const UPDATE_RELOAD_KEY = 'autional:pwa-update-reload-at';

/**
 * 加载即消费一次性凭据的页面：新 SW 接管后自动重载会重放或二次消费凭据
 * （OAuth code、邮件/短信验证码、魔法链接、重置 token、SSO 跳转）。
 * 这些页面保持旧版，直到下一次整页导航。
 */
const ONE_TIME_TOKEN_PATH =
  /(?:^|\/)(?:oauth|verify-email|verify-phone|magic-link|reset-password|sso)(?:\/|$)/;

/** 可承载未提交输入的控件类型；select 恒有值，不参与判断。 */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'tel',
  'url',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/**
 * PWA 生命周期：
 * - 部署后旧页面可能引用已清理的懒加载 chunk → 捕获 vite:preloadError，最多重载一次。
 * - 前台/每 30 分钟主动检查 SW 更新；新版本经 skipWaiting + clientsClaim 立即接管，
 *   接管后自动整页重载，让当前标签页用上新资源。
 * - 一次性凭据页与有未提交文本输入时不重载，避免重放凭据或丢失输入。
 */
export function setupPwaLifecycle(reload: () => void = () => window.location.reload()): void {
  if (typeof window === 'undefined') return;
  setupPreloadRecovery(reload);
  setupUpdateReload(reload);
  setupUpdateChecks();
}

/** 有未提交的文本输入时暂不重载：避免打断登录、验证码与表单填写。 */
function hasUnsavedTextInput(): boolean {
  for (const el of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
    if (el instanceof HTMLInputElement) {
      if (!el.disabled && !el.readOnly && TEXT_INPUT_TYPES.has(el.type) && el.value !== '') {
        return true;
      }
    } else if (el instanceof HTMLTextAreaElement) {
      if (!el.disabled && !el.readOnly && el.value !== '') return true;
    } else if (el instanceof HTMLElement && el.isContentEditable && el.textContent?.trim()) {
      return true;
    }
  }
  return false;
}

function setupUpdateReload(reload: () => void): void {
  if (!('serviceWorker' in navigator)) return;

  // 首访页面未受控：clientsClaim 带来的第一次 controllerchange 是首次接管，不是版本更新。
  // 之后的 controllerchange 才意味着新版本已接管当前页。
  let sawController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!sawController) {
      sawController = true;
      return;
    }
    if (ONE_TIME_TOKEN_PATH.test(window.location.pathname)) return;
    if (hasUnsavedTextInput()) return;
    try {
      const lastReloadAt = Number(window.sessionStorage.getItem(UPDATE_RELOAD_KEY) ?? 0);
      if (Number.isFinite(lastReloadAt) && Date.now() - lastReloadAt < RELOAD_GUARD_MS) return;
      window.sessionStorage.setItem(UPDATE_RELOAD_KEY, String(Date.now()));
    } catch {
      // 存储不可用：宁可保留旧页，也不冒重载循环的风险。
      return;
    }
    reload();
  });
}

function setupPreloadRecovery(reload: () => void): void {
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
    reload();
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
