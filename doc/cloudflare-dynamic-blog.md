# Cloudflare 动态博客部署说明

本文档对应仓库内已实现的方案：Hexo 静态站 + Cloudflare Pages + Worker(D1/KV) 动态接口。

## 1. 前置资源

1. Cloudflare Pages 项目（部署 `public/`）
2. D1 数据库（名称示例：`blog_d1`）
3. KV 命名空间（名称示例：`RATE_LIMIT`）
4. Turnstile 站点密钥与密钥（用于评论防刷）
5. GitHub OAuth App（可选，混合身份登录）

## 2. 配置 wrangler

编辑 `worker/wrangler.toml`：

- `database_id` 填 D1 实际 ID
- `kv id` 填 KV 实际 ID
- `CORS_ORIGIN` 改为你的博客域名

## 3. 初始化 D1

```bash
cd worker
npm install
npm run migrate:remote
```

## 4. 写入 Worker Secrets

```bash
cd worker
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_JWT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_OAUTH_REDIRECT_URI
```

## 5. GitHub Actions Secrets

在仓库 Settings -> Secrets and variables -> Actions 中配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

可选 Variables：

- `CLOUDFLARE_PAGES_PROJECT`（如果你修改了默认项目名）

## 6. 域名与 API 路由

推荐将 Worker 挂到同域名 `/api/*`，这样前端默认 `dynamic-api-base=/api/v1` 可直接使用。  
如果用独立 `workers.dev` 域名，请把 `_config.butterfly.yml` 里的：

```yaml
- <meta name="dynamic-api-base" content="/api/v1">
```

改成完整地址，例如：

```yaml
- <meta name="dynamic-api-base" content="https://your-worker.workers.dev/api/v1">
```

## 7. 管理员审核后台

前端入口是 `/admin/comments/`，页面本身不公开 Token，也不会把 Token 写入 localStorage；当前会话内仅保存到 sessionStorage。

后台使用两个管理员接口：

- `GET /api/v1/admin/comments?status=pending|approved|hidden|all`
- `POST /api/v1/admin/comments/:id/moderate`

两个接口都需要请求头 `Authorization: Bearer <admin-jwt>`。管理员令牌必须由 `ADMIN_JWT_SECRET` 签名，并包含 `role=admin`。建议使用短时效 Token，审核完成后在页面点击“清除 Token”。

可在仓库根目录本地签发短时效 Token：

```bash
ADMIN_JWT_SECRET=你的生产密钥 npm run admin:token -- --ttl 1h --subject yurisa
```

生产 API 烟测：

```bash
BLOG_API_BASE=https://api.yurisa.top/api/v1 ADMIN_JWT=你的管理员JWT npm run smoke:api
```

默认烟测只检查 CORS、未授权访问必须返回 401、以及管理员评论列表结构。公开文章 metrics/comments 接口会调用 Worker 的 `ensurePost`，可能写入 D1；如需检查公开接口，必须显式允许：

```bash
BLOG_API_BASE=https://api.yurisa.top/api/v1 BLOG_SMOKE_SLUG=2026/04/02/claude-code-architecture BLOG_SMOKE_ALLOW_WRITES=true npm run smoke:api
```

## 8. Workers Builds 误触发排查

仓库内 Worker 的实际配置在 `worker/wrangler.toml`，服务名是 `yurisachan-blog-api`。仓库自己的 Worker 部署入口是 `.github/workflows/worker-deploy.yml`，只会在 `main` 分支且 `worker/**` 或该 workflow 变化时触发。

如果 GitHub PR 上出现 `Workers Builds: yurisachan-blog` 失败，而 `Cloudflare Pages` 和 `verify` 都成功，通常表示 Cloudflare Dashboard 里还有一个独立的 Workers Builds Git Integration 绑定到了旧服务或错误根目录。它不影响静态博客 Pages 部署，但会让 PR 检查变红。

推荐修复：

1. 打开 Cloudflare Dashboard -> Workers & Pages -> Workers -> `yurisachan-blog`。
2. 进入该 Worker 的 Builds / Settings / Git repository 配置。
3. 如果 `yurisachan-blog` 是旧服务或不再负责本仓库部署，断开它的 Git repository 绑定，不删除 Worker。
4. 如果仍要保留 Workers Builds，改为绑定实际服务 `yurisachan-blog-api`，Root directory 设为 `worker`。
5. 配置 Build watch paths：Include `worker/*`，必要时 Exclude `*` 后再只 include `worker/*`，确保博客 CSS/文章/Pages 改动不会触发 Worker build。
6. 保留 GitHub Actions 的 `worker-deploy.yml` 作为主要 Worker 部署入口，避免 Cloudflare 原生 Workers Builds 和 GitHub Actions 同时部署同一个 Worker。
