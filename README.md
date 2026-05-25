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

## Live2D 看板娘

站点已通过本地 vendored `live2d-widget` 接入看板娘，入口脚本是 `source/js/live2d-assistant.js`，静态资源在 `source/live2d-widget/`。

开发、调试、更新和关闭方式见 [docs/live2d-assistant-dev.md](./docs/live2d-assistant-dev.md)，许可记录见 [license-matrix.md](./license-matrix.md)。

## 线上访问

- 主站（Cloudflare Pages）：`https://yurisachan16-creator-github-io.pages.dev/`
- 旧地址（GitHub Pages）：`https://yurisachan16-creator.github.io/`（仅跳转到主站）

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

说明：`https://yurisachan16-creator.github.io/` 作为旧地址，仅通过 `.github/workflows/github-pages-redirect.yml` 发布重定向页，用于跳转到 Cloudflare 主站。

动态接口由 `worker/` 子项目提供，部署见 `doc/cloudflare-dynamic-blog.md`。

说明：如果你以前用过 `hexo deploy`，本地可能会出现 `.deploy_git/` 目录（部署缓存），可直接删除。

如仍需本地一键部署，可使用：

```bash
npm run deploy
```

## 版本管理

仓库版本与文章版本现在分开管理：

- 仓库版本：根 [package.json](./package.json) 是唯一版本源，`worker/package.json` 会在发版时同步到同一版本。
- 仓库发版：使用 `SemVer`，标签格式固定为 `vX.Y.Z`，GitHub Release 与 tag 同名。
- 仓库变更记录：统一写入 [CHANGELOG.md](./CHANGELOG.md)，分类固定为 `Features`、`Content`、`Fixes`、`Performance`、`SEO`、`Infra`。
- 文章版本：每篇文章通过 `article_version` 和 `article_history` 记录修订历史，并在文章页展示“更新记录”。

### 提交与分支约定

- 分支命名：`feat/*`、`fix/*`、`content/*`、`chore/*`
- 提交格式：Conventional Commits
- 推荐 scope：`site`、`worker`、`content`、`seo`、`perf`、`release`

示例：

```bash
feat(site): add article version timeline
fix(worker): tighten comment moderation guard
content(article): revise welcome post deployment notes
perf(site): defer post-only dynamic scripts
```

### 发布流程

正式发版通过 `release-please` 管理：

1. 功能分支合并到 `main`
2. `Release Please` workflow 基于提交历史生成 release PR
3. release PR 更新版本号与 `CHANGELOG.md`
4. PR 合并后自动创建 Git tag 与 GitHub Release

本地/CI 可先跑 dry-run：

```bash
npm run release:dry-run
```

说明：本地 dry-run 需要可用的 `GITHUB_TOKEN` 才能读取 Release / PR 元数据；在 GitHub Actions 中会自动注入。

完整门禁：

```bash
npm run verify
```
