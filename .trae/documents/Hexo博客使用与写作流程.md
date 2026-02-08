## 现状说明（你看到的目录）
- `Yurisachan.github.io/`：博客源码目录（你写文章只改这里的 `source/_posts` 等）。
- `.deploy_git/`：这是路线 A（本地 `hexo deploy`）才会用到的临时部署目录。你既然选路线 B，它可以删除，不影响 Actions。

## 路线 B：你需要做的事（只涉及 GitHub 网页端设置）
1) 推送源码到 GitHub 的 `main` 分支
- 确保当前仓库的源码（含 `package.json`、`source/`、以及 `.github/workflows/pages.yml`）都在 `main`。

2) 在 GitHub 仓库开启 Pages 的 Actions 发布源
- 打开仓库 → Settings → Pages
- Source 选择：`GitHub Actions`

3) 触发一次部署
- 方式一：直接 push 一次到 `main`（改一行 README 也行）
- 方式二：Actions → 选择 “Build and Deploy (Hexo)” → Run workflow

4) 查看部署结果
- Actions 里等 workflow 绿色通过
- Pages 页面会显示站点 URL（通常是 `https://<用户名>.github.io/`）

## 以后怎么写文章（保持不变）
- 新建：`npx hexo new post "标题"`
- 写作：编辑 `source/_posts/xxx.md`
- 本地看效果：`npm run server`
- 发布：把源码提交并 push 到 `main`，Actions 自动生成并发布

## 可选的“清爽化”（你确认后我再做）
- 删除 `.deploy_git/`（本地缓存）
- 未来如果完全不用路线 A：可以移除 `_config.yml` 的 deploy 段与 `hexo-deployer-git` 依赖，减少混淆
