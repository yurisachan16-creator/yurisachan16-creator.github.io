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
npm run server
```

访问 `http://localhost:4000/` 预览。

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

推荐使用 GitHub Actions 自动构建并发布到 GitHub Pages（仓库 Settings → Pages 中选择 “GitHub Actions” 作为 Source）。

如仍需本地一键部署，可使用：

```bash
npm run deploy
```
