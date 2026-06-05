# Cloudflare Worker API

该目录提供博客动态能力 API（评论/点赞/阅读量），用于配合 Hexo 静态页面实现“静态前台 + 动态后端”。

## 目录

- `src/index.ts`：Worker 入口与全部路由
- `src/db/migrations/0001_init.sql`：D1 初始化表结构
- `wrangler.toml`：Worker 配置

## 快速开始

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create blog_d1
npx wrangler kv namespace create RATE_LIMIT
```

把上一步拿到的 `database_id` 和 KV `id` 填入 `wrangler.toml`。

## 初始化数据库

```bash
npm run migrate:remote
```

## 必要密钥（生产）

使用 `wrangler secret put` 写入：

- `TURNSTILE_SECRET`
- `JWT_SECRET`
- `ADMIN_JWT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI`

## 本地开发

```bash
npm run dev
```

默认 API 路径前缀：`/api/v1`。

## 管理员审核

评论审核前端在站点 `/admin/comments/`，需要粘贴管理员 JWT。

在仓库根目录本地签发短期管理员 JWT：

```bash
ADMIN_JWT_SECRET=你的生产密钥 npm run admin:token -- --ttl 1h --subject yurisa
```

生产 API 烟测同样在仓库根目录执行：

```bash
BLOG_API_BASE=https://api.yurisa.top/api/v1 ADMIN_JWT=你的管理员JWT npm run smoke:api
```

默认烟测不会调用可能写入 D1 的公开文章接口；如需覆盖 metrics/comments，需要显式设置 `BLOG_SMOKE_ALLOW_WRITES=true` 和 `BLOG_SMOKE_SLUG`。

管理员接口：

- `GET /api/v1/admin/comments?status=pending|approved|hidden|all`
- `POST /api/v1/admin/comments/:id/moderate`

两个接口都要求 `Authorization: Bearer <admin-jwt>`；该 JWT 需要由 `ADMIN_JWT_SECRET` 签名，并包含 `role=admin`。
