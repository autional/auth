# Autional 身份认证

**域名**：[auth.autional.cn](https://auth.autional.cn)（cn）· [auth.autional.com](https://auth.autional.com)（com）
**技术栈**：Vite + React 19 + TypeScript + Tailwind CSS
**仓库**：[github.com/autional/auth](https://github.com/autional/auth)

登录、注册、多因素认证与单点登录。

## 开发

```bash
pnpm install
pnpm dev      # http://localhost:13101（构建前自动生成 env.js/robots.txt）
pnpm build    # 构建产物：apps/auth-pages/dist/
pnpm test     # Vitest 单元测试
```

## 部署（单源双区）

`main` → `auth`（com）自动部署；`main` → `cn-auth`（cn）自动部署。两区**同一份源码**，
区域差异全部由 Vercel 项目环境变量在构建期注入（见 `docs/positioning/24`）：

| 变量 | com | cn |
| --- | --- | --- |
| `REGION` | `com` | `cn` |
| `SITE_URL` | `https://auth.autional.com` | `https://auth.autional.cn` |
| `DEFAULT_LANG` / `FALLBACK_LANG` | `en` | `zh` |
| `API_ORIGIN` | `https://api.autional.com` | `https://api.autional.cn` |
| `CDN_HOST` | `https://cdn.autional.com` | `https://cdn.autional.cn` |

- 路由/重写：`vercel.ts`（fail-closed：`API_ORIGIN` 缺失即构建失败）。
- 生成物（勿手改、勿入库）：`apps/auth-pages/public/{env.js,robots.txt}` ← `scripts/gen-env.mjs`；区域文案在 `scripts/region-copy.mjs`。
- 本地无 env 时兜底 cn 值（与迁移前基线一致）。
