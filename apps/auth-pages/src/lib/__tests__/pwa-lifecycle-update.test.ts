import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPwaLifecycle } from '../pwa-lifecycle';

function installServiceWorker(controller: object | null) {
  const events = new EventTarget();
  const registration = { update: vi.fn().mockResolvedValue(undefined) };
  const serviceWorker = Object.assign(events, {
    controller,
    // 永不 resolve：避免更新检查定时器与 ready 回调渗入用例。
    ready: new Promise<typeof registration>(() => {}),
    getRegistration: vi.fn().mockResolvedValue(registration),
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  return { emitControllerChange: () => events.dispatchEvent(new Event('controllerchange')) };
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  document.body.innerHTML = '';
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('PWA 更新接管后的刷新', () => {
  it('已受控页面在新版本接管后整页重载', () => {
    const reload = vi.fn();
    const { emitControllerChange } = installServiceWorker({});
    setupPwaLifecycle(reload);

    emitControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('首访 clientsClaim 的首次接管不重载，之后的更新才重载', () => {
    const reload = vi.fn();
    const { emitControllerChange } = installServiceWorker(null);
    setupPwaLifecycle(reload);

    emitControllerChange();
    expect(reload).not.toHaveBeenCalled();

    emitControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('60 秒内不重复重载', () => {
    const reload = vi.fn();
    const { emitControllerChange } = installServiceWorker({});
    setupPwaLifecycle(reload);

    emitControllerChange();
    emitControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each(['/oauth/callback', '/acme/magic-link/confirm', '/acme/verify-email', '/acme/sso/initiate'])(
    '一次性凭据页 %s 不自动重载',
    (path) => {
      const reload = vi.fn();
      const { emitControllerChange } = installServiceWorker({});
      window.history.replaceState({}, '', path);
      setupPwaLifecycle(reload);

      emitControllerChange();

      expect(reload).not.toHaveBeenCalled();
    },
  );

  it('有未提交文本输入时不重载', () => {
    const reload = vi.fn();
    const { emitControllerChange } = installServiceWorker({});
    const input = document.createElement('input');
    input.value = 'user@example.com';
    document.body.appendChild(input);
    setupPwaLifecycle(reload);

    emitControllerChange();

    expect(reload).not.toHaveBeenCalled();
  });

  it('空输入或只读输入不阻止重载', () => {
    const reload = vi.fn();
    const { emitControllerChange } = installServiceWorker({});
    const readonly = document.createElement('input');
    readonly.value = 'readonly';
    readonly.readOnly = true;
    document.body.append(readonly, document.createElement('input'));
    setupPwaLifecycle(reload);

    emitControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('不支持 Service Worker 时安全退出', () => {
    expect(() => setupPwaLifecycle()).not.toThrow();
  });
});
