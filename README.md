# Yurisachan 的 Hexo 博客

这是一个基于 Hexo 的静态博客源码仓库，使用 Butterfly 主题，并在 `source/` 中维护文章与静态资源。

## 技术栈

- Node.js + npm
- Hexo（站点生成）
- Butterfly 主题（通过 npm 安装并同步到 `themes/butterfly`）
- Three.js + Vite + TypeScript（原神式首页启动体验）

## 目录结构

- [.github/](./.github/)：仓库自动化配置（Dependabot）
- [scaffolds/](./scaffolds/)：文章/页面脚手架模板
- [source/](./source/)：站点源内容
  - `_posts/`：文章（Markdown）
  - `about/`、`categories/`、`tags/`：独立页面
  - `reading/`、`updates/`、`admin/comments/`：阅读路线、最近更新和评论审核页面
  - `css/`、`js/`、`fonts/`、`img/`：站点静态资源
  - `data/`：构建时生成的博客内容索引
- [themes/](./themes/)：Hexo 主题目录（`themes/butterfly` 由脚本自动生成，不纳入版本控制）
- [tools/](./tools/)：本地素材处理脚本与辅助工具（不会发布到站点）
- [launch/](./launch/)：Three.js 启动场景、状态机与素材来源清单
- [vendor/](./vendor/)：固定上游 commit 的原始练习素材，不由 Hexo 直接发布
- 关键配置
  - [_config.yml](./_config.yml)：站点主配置
  - [_config.butterfly.yml](./_config.butterfly.yml)：主题配置

## 本地开发

要求 Node.js 20.19+；构建启动音频还需要本机安装 `ffmpeg`。

```bash
npm install
npx hexo new post "第一篇文章"
npm run server
```

访问 `http://localhost:4000/` 预览。

## Three.js 启动体验

首页接入了非官方的原神式天空长廊与开门动画。正式开关默认关闭，本地可用以下地址检查真实场景：

```text
http://localhost:4000/?launch=preview
```

开发场景与 Hexo 并行 watch：

```bash
npm run dev
```

实现架构、故障处理、CI/release 门禁和 Android/iPhone 真机验收清单见 [启动体验发布手册](./doc/genshin-launch-operations.md)；素材来源与风险边界见 [许可矩阵](./doc/genshin-launch-license-matrix.md)。

## Live2D 看板娘

站点已通过 PixiJS + `pixi-live2d-display` 接入 Live2D 看板娘，入口脚本是 `source/js/live2d-assistant.js`，模型静态资源在 `source/live2d-widget/`。

看板娘不是单纯装饰：当前已内置站内助理面板，可搜索文章、随机跳转、汇报阅读进度、调整模型全身/半身构图，并联动音乐播放器和站点风格切换。

开发、调试、更新和关闭方式见 [docs/live2d-assistant-dev.md](./docs/live2d-assistant-dev.md)，许可记录见 [license-matrix.md](./license-matrix.md)。

## 博客功能页

- `/reading/`：按专题组织现有文章路线，数据来自 `source/data/blog-content-index.json`
- `/updates/`：聚合文章 front-matter 中的 `article_history`
- 文章页“阅读动作”：使用 localStorage 保存稍后读和最近阅读，不需要登录
- `/admin/comments/`：评论审核前端，需要粘贴由 `ADMIN_JWT_SECRET` 签名且 `role=admin` 的管理员 JWT

`source/data/blog-content-index.json` 由 `tools/build-blog-data.mjs` 生成；`npm run build` 会先运行该脚本，再执行 Hexo 生成。

本地签发短期管理员 Token：

```bash
ADMIN_JWT_SECRET=你的生产密钥 npm run admin:token -- --ttl 1h --subject yurisa
```

生产 API 烟测需要显式指定目标，默认不会猜测生产地址：

```bash
BLOG_API_BASE=https://api.yurisa.top/api/v1 ADMIN_JWT=你的管理员JWT npm run smoke:api
```

该烟测默认只检查 CORS、管理员鉴权边界和管理员评论列表读取。公开文章 metrics/comments 接口会调用 Worker 的 `ensurePost`，可能写入 D1；只有明确允许时才会运行：

```bash
BLOG_API_BASE=https://api.yurisa.top/api/v1 BLOG_SMOKE_SLUG=2026/04/02/claude-code-architecture BLOG_SMOKE_ALLOW_WRITES=true npm run smoke:api
```

不访问外网的本地 mock 验证：

```bash
npm run smoke:api -- --mock
```

## 线上访问

- 主站（Cloudflare Pages）：`https://yurisa.top/`
- 备用地址（Cloudflare Pages）：`https://yurisachan16-creator-github-io.pages.dev/`
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

上线前建议至少执行：

```bash
npm run verify
npm run test:e2e -- --project=chromium --project=mobile-chrome
```

完整 Playwright 矩阵包含 Chromium、Firefox、WebKit、移动 Chrome 和移动 Safari；首次运行完整矩阵前需要先安装 Playwright 浏览器：

```bash
npx playwright install
npm run test:e2e
```

启动体验的发布级矩阵（五浏览器项目、Slow 4G、context loss 和五轮资源回收）：

```bash
npm run test:e2e:release
```

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

说明：`https://yurisachan16-creator.github.io/` 作为旧地址，仅通过 `.github/workflows/github-pages-redirect.yml` 发布重定向页，用于跳转到 Cloudflare 主站 `https://yurisa.top/`。

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
- 版本门禁：`npm run content:validate` 会检查 `source/_posts/` 下每篇文章都有 `article_version` 和至少一条完整 `article_history`；该检查已接入 `npm run verify`。

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
