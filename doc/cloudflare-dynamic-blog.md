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

## 7. 管理员审核接口

`POST /api/v1/admin/comments/:id/moderate` 需要 `Authorization: Bearer <admin-jwt>`。  
管理员令牌由 `ADMIN_JWT_SECRET` 签名，建议你在后端单独提供签发脚本并短时效管理。
