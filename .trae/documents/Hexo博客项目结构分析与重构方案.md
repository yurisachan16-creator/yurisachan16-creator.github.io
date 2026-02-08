## 项目结构盘点（当前仓库）

### 根目录（工程级）
- [.github/](file:///d:/BlogFlie/Yurisachan.github.io/.github/)
  - 用途：GitHub 平台自动化/运维配置。
  - 主要内容：仅有 [dependabot.yml](file:///d:/BlogFlie/Yurisachan.github.io/.github/dependabot.yml)，用于每天检查并更新 npm 依赖。
- [package.json](file:///d:/BlogFlie/Yurisachan.github.io/package.json)
  - 用途：Node.js 依赖与脚本入口。
  - 主要内容：Hexo 相关脚本（build/clean/deploy/server）与 Hexo 插件、主题依赖。
- [package-lock.json](file:///d:/BlogFlie/Yurisachan.github.io/package-lock.json)
  - 用途：锁定依赖版本，保证构建可复现。
- [_config.yml](file:///d:/BlogFlie/Yurisachan.github.io/_config.yml)
  - 用途：Hexo 站点主配置（站点信息、URL、permalink、目录约定、主题、部署等）。
  - 重点：`theme: butterfly` 与 git 部署配置（deploy 到 main）。
- [_config.butterfly.yml](file:///d:/BlogFlie/Yurisachan.github.io/_config.butterfly.yml)
  - 用途：Butterfly 主题的独立配置（菜单、样式、组件、注入资源等）。
  - 重点：通过 `inject` 注入自定义 CSS/JS 与外部库（NES.css、APlayer）。
- [_config.landscape.yml](file:///d:/BlogFlie/Yurisachan.github.io/_config.landscape.yml)
  - 现状：空文件（0 行）。
  - 说明：当前主题已设为 butterfly，landscape 配置很可能是历史遗留。
- [.gitignore](file:///d:/BlogFlie/Yurisachan.github.io/.gitignore)
  - 用途：忽略生成物与本地依赖目录（node_modules、public、.deploy* 等）。

### 内容与站点源（source/）
- [source/](file:///d:/BlogFlie/Yurisachan.github.io/source/)
  - 用途：Hexo 站点“源内容”（文章、页面、会被复制到 public 的静态资源）。
  - 主要子目录：
    - [source/_posts/](file:///d:/BlogFlie/Yurisachan.github.io/source/_posts/)
      - 用途：文章（Markdown）。
      - 例子：[hello-world.md](file:///d:/BlogFlie/Yurisachan.github.io/source/_posts/hello-world.md)、[player-model.md](file:///d:/BlogFlie/Yurisachan.github.io/source/_posts/player-model.md) 等。
    - [source/about/](file:///d:/BlogFlie/Yurisachan.github.io/source/about/)、[source/categories/](file:///d:/BlogFlie/Yurisachan.github.io/source/categories/)、[source/tags/](file:///d:/BlogFlie/Yurisachan.github.io/source/tags/)
      - 用途：独立页面（关于/分类/标签）入口。
    - [source/css/](file:///d:/BlogFlie/Yurisachan.github.io/source/css/)
      - 用途：自定义样式。
      - 主要内容：[custom.css](file:///d:/BlogFlie/Yurisachan.github.io/source/css/custom.css)（字体 + 动态云朵背景主题 + 深色模式覆盖）。
    - [source/js/](file:///d:/BlogFlie/Yurisachan.github.io/source/js/)
      - 用途：自定义脚本。
      - 主要内容：[cloud-bg.js](file:///d:/BlogFlie/Yurisachan.github.io/source/js/cloud-bg.js)（根据 URL 判定页面类型，配合 CSS 切换主题；兼容 PJAX）。
    - [source/fonts/](file:///d:/BlogFlie/Yurisachan.github.io/source/fonts/)
      - 用途：自托管字体（ttf）。
    - [source/img/](file:///d:/BlogFlie/Yurisachan.github.io/source/img/)
      - 用途：图片/媒体静态资源。
      - 现状：包含大量分组图片（不同主题天空、文章配图等）。
      - 重要风险点：存在脚本文件会被“当作静态文件发布”，例如 [make_gif.py](file:///d:/BlogFlie/Yurisachan.github.io/source/img/make_gif.py) 与 [star-rail/rename.py](file:///d:/BlogFlie/Yurisachan.github.io/source/img/star-rail/rename.py)。这会导致：
        - 仓库内容与站点发布内容混杂
        - 可能无意暴露本地处理脚本
        - 增加后续维护噪音

### Hexo 脚手架（scaffolds/）
- [scaffolds/](file:///d:/BlogFlie/Yurisachan.github.io/scaffolds/)
  - 用途：`hexo new post/page/draft` 时生成的模板。
  - 主要内容：
    - [post.md](file:///d:/BlogFlie/Yurisachan.github.io/scaffolds/post.md)
    - [page.md](file:///d:/BlogFlie/Yurisachan.github.io/scaffolds/page.md)
    - [draft.md](file:///d:/BlogFlie/Yurisachan.github.io/scaffolds/draft.md)

### 主题（themes/）
- [themes/](file:///d:/BlogFlie/Yurisachan.github.io/themes/)
  - 现状：仅有 [.gitkeep](file:///d:/BlogFlie/Yurisachan.github.io/themes/.gitkeep)。
  - 说明：主题依赖在 [package.json](file:///d:/BlogFlie/Yurisachan.github.io/package.json#L14-L30) 中通过 npm 安装（`hexo-theme-butterfly`、`hexo-theme-landscape`）。
  - 潜在问题：Hexo 传统加载主题路径是 `themes/<theme-name>`，如果本地/CI 没有额外步骤把主题放到 `themes/butterfly`，可能出现“装了依赖但找不到主题”的构建差异。建议后续在重构方案中明确“主题来源策略”。

### 测试与CI
- 仓库未发现 `test/`、`__tests__/`、GitHub Actions workflow（除 dependabot 外）。
- 对博客站点属于常见情况，但意味着：
  - 缺少自动化构建验证（依赖升级后是否可生成）
  - 缺少内容质量检查（链接、front-matter、Markdown 规范、图片体积）

## 依赖关系与技术栈（从配置与依赖推断）

### 运行时与构建工具
- Node.js + npm（通过 `package.json`/`package-lock.json` 管理）。
- 静态站点生成器：Hexo（依赖 `hexo`，站点声明 `hexo.version: 8.1.1`）。
- 常用命令入口（见 [package.json](file:///d:/BlogFlie/Yurisachan.github.io/package.json#L5-L10)）：
  - `hexo generate`（生成到 `public/`）
  - `hexo server`（本地预览）
  - `hexo deploy`（依赖 `hexo-deployer-git`）

### Hexo 插件生态（功能分层）
- 生成器（把 Markdown/页面生成站点结构）：
  - archive/category/index/tag（归档/分类/首页/标签）
  - search/searchdb（本地搜索索引输出，配合主题搜索）
- 渲染器（把不同格式转为 HTML/CSS）：
  - ejs、marked、stylus
- 部署：
  - `hexo-deployer-git`：配合 [_config.yml](file:///d:/BlogFlie/Yurisachan.github.io/_config.yml#L102-L107) 的 `deploy` 字段把生成物推送到仓库分支。
- 主题：
  - `hexo-theme-butterfly`（当前启用）
  - `hexo-theme-landscape`（当前未启用，且 `_config.landscape.yml` 为空）
- 内容统计：
  - `hexo-wordcount` + 主题配置中 `wordcount` 开启

### 前端层（主题 + 自定义资源注入）
- 主题：Butterfly（PJAX、fancybox、lazyload 等能力由主题配置启用）。
- 自定义样式/脚本：
  - [custom.css](file:///d:/BlogFlie/Yurisachan.github.io/source/css/custom.css)：页面类型驱动主题色；深色模式覆盖范围很大。
  - [cloud-bg.js](file:///d:/BlogFlie/Yurisachan.github.io/source/js/cloud-bg.js)：基于 URL path 判断页面类型并切换 body class。
- 外部库注入（见 [_config.butterfly.yml](file:///d:/BlogFlie/Yurisachan.github.io/_config.butterfly.yml#L392-L407)）：
  - NES.css（像素风）
  - APlayer + Meting（音乐播放器；目前 `data-id` 仍是占位符“你的歌单ID”）

## 结构优化建议（问题清单 + 改进空间）

### 1) “站点发布内容”与“仓库工具脚本”混放
- 现状：`source/img/` 下存在 `.py` 脚本（会被公开发布）。
- 建议：把所有用于本地处理素材的脚本迁移到仓库级 `tools/` 或 `scripts/`（不在 `source/` 下），并在 `.gitignore` 中忽略其产物。

### 2) 主题来源策略不够明确
- 现状：`themes/` 空，但 `theme: butterfly`；主题依赖在 npm。
- 风险：不同环境（本地/CI）可能表现不一致。
- 方案二选一（后续重构里落地）：
  - A. 明确“主题由 npm 依赖提供”，并增加自动把主题落到 `themes/butterfly` 的机制（postinstall 脚本/构建脚本）。
  - B. 直接把主题作为 `themes/butterfly/` 目录纳入仓库管理（git submodule 或复制主题源码），npm 只保留 Hexo 插件。

### 3) 不必要/历史遗留配置与依赖
- `_config.landscape.yml` 为空 + 依赖 `hexo-theme-landscape` 很可能无用。
- 建议：删除空配置、移除未使用依赖（减少维护面与依赖升级噪音）。

### 4) 静态资源体积与组织
- `source/img/` 资源较多，未来容易出现：
  - 图片体积过大导致首屏慢
  - 资源命名/分类不统一
- 建议：
  - 统一命名规范（kebab-case）与分层（按页面/文章/组件）。
  - 引入图片压缩/格式转换（优先 WebP/AVIF），并对文章引用做统一约束。
  - 如需保留大量原图，考虑 Git LFS（视图片体积而定）。

### 5) 缺少工程级文档与自动化质量门禁
- 建议补充：
  - README（启动、发布、目录说明、常见问题）
  - Node 版本约束（.nvmrc 或 .node-version，或在 package.json 中注明）
  - 可选的 CI：至少 `hexo generate` 构建验证 + 链接检查/Markdown lint

## 具体重构方案（可执行的落地步骤）

1) 资产与脚本分离
- 新增 `tools/`（或 `scripts/`）目录，迁移 `source/img/*.py` 等本地处理脚本。
- 清理 `source/` 下非发布文件，保证 `source/` 只包含“需要发布到站点”的内容。

2) 明确主题管理方式（推荐：npm 依赖 + 自动同步到 themes）
- 增加一致性机制：安装依赖后自动保证 `themes/butterfly` 存在。
- 同步策略：
  - 若你希望主题可随依赖升级：从 `node_modules/hexo-theme-butterfly` 同步到 `themes/butterfly`（构建前执行）。
  - 若你希望主题可定制：把 `themes/butterfly` 纳入仓库（并在升级时手动合并）。

3) 移除无用配置与依赖
- 删除 `_config.landscape.yml`（空文件）
- 从 `package.json` 移除 `hexo-theme-landscape`（如果确认不再使用）
- 保持主题配置文件只保留当前启用主题（`_config.butterfly.yml`）

4) 增强文档与可维护性
- 新增 `README.md`：
  - 项目定位（Hexo source repo vs deploy repo）
  - 目录结构说明
  - 本地开发/构建/部署流程
- 明确部署策略：
  - 选项 A：保留 `hexo deploy`（本地生成并推送）
  - 选项 B（更推荐）：GitHub Actions 自动构建并发布（减少本地环境差异）

5) 引入轻量质量检查（可选）
- CI：每次 push/PR 执行 `npm ci` + `hexo generate`，确保依赖升级不破站。
- 内容质量：Markdown lint、链接检查（尤其是外链与图片路径）。

---

如果你确认这个方案，我会在下一步按上述“具体重构方案”直接落地改动（新增/移动文件、精简依赖、补充 README 与 CI），并在本地验证 `hexo generate` 可通过。