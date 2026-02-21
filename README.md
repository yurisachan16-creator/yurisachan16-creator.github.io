# Yurisachan 的 Hexo 博客

这是一个基于 Hexo 的静态博客源码仓库，使用 Butterfly 主题，并在 `source/` 中维护文章与静态资源。

## 技术栈

- Node.js + npm
- Hexo（站点生成）
- Butterfly 主题（通过 npm 安装并同步到 `themes/butterfly`）

## 目录结构

- [.github/](./.github/)：仓库自动化配置（Dependabot）
- [scaffolds/](./scaffolds/)：文章/页面脚手架模板
- [source/](./source/)：站点源内容
  - `_posts/`：文章（Markdown）
  - `about/`、`categories/`、`tags/`：独立页面
  - `css/`、`js/`、`fonts/`、`img/`：站点静态资源
- [themes/](./themes/)：Hexo 主题目录（`themes/butterfly` 由脚本自动生成，不纳入版本控制）
- [tools/](./tools/)：本地素材处理脚本与辅助工具（不会发布到站点）
- 关键配置
  - [_config.yml](./_config.yml)：站点主配置
  - [_config.butterfly.yml](./_config.butterfly.yml)：主题配置

## 本地开发

建议使用 Node.js 18+。

```bash
npm install
npx hexo new post "第一篇文章"
npm run server
```

访问 `http://localhost:4000/` 预览。

## 写作

- 新建文章：`npx hexo new post "标题"`（生成到 `source/_posts/`）
- 新建页面：`npx hexo new page "页面名"`（生成到 `source/页面名/index.md`）
- 图片资源：放到 `source/img/`，文章里用 `/img/xxx.png` 引用（当前未启用文章资源文件夹）

## 构建

```bash
npm run clean
npm run build
```

生成物输出到 `public/`（默认已在 `.gitignore` 忽略）。

## 主题同步机制

本仓库通过 npm 安装 `hexo-theme-butterfly`，并在依赖安装后自动将主题同步到 `themes/butterfly`，以确保 Hexo 在不同环境下都能稳定找到主题。

如需手动同步：

```bash
npm run sync-themes
```

## 部署

当前默认部署目标是 **Cloudflare Pages**（由 GitHub Actions 触发构建与发布）：

1) 在 Cloudflare 创建 Pages 项目并绑定仓库
2) 在 GitHub 仓库 Secrets 配置：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3) 推送到 `main` 分支后，`.github/workflows/pages.yml` 会自动构建并部署 `public/`

动态接口由 `worker/` 子项目提供，部署见 `doc/cloudflare-dynamic-blog.md`。

说明：如果你以前用过 `hexo deploy`，本地可能会出现 `.deploy_git/` 目录（部署缓存），可直接删除。

如仍需本地一键部署，可使用：

```bash
npm run deploy
```
