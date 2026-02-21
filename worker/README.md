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
