## 目标
- 把当前 Hexo + Butterfly + GitHub Actions 博客工程，整理成一份可维护的 Excel（`doc/需求.xlsx`），覆盖：项目结构、接口/命令、格式规范、扩展方式。

## 输入来源（从仓库自动提取）
- 工程与依赖：`package.json`（scripts、dependencies）
- Hexo 主配置：`_config.yml`（permalink、post_asset_folder、目录、deploy 等）
- 主题配置：`_config.butterfly.yml`（menu、cover、inject、自定义资源注入等）
- 自动化：`.github/workflows/pages.yml`（Actions 构建与发布流程）
- 目录结构：根目录与 `source/` 下主要目录（posts/pages/static/tools 等）

## Excel 设计（写入到 需求.xlsx 的多个 Sheet）
1) `Overview`（总览）
- 列：模块/主题｜说明｜入口（文件/命令）｜输出物｜维护要点
- 行：Hexo 生成、Butterfly 主题、GitHub Pages Actions 发布、本地开发流程等

2) `Structure`（结构清单）
- 列：路径｜类型(dir/file)｜归类(内容/配置/构建/自动化/工具)｜用途｜示例/关键点｜是否发布到站点(Y/N)｜备注
- 自动填充：仓库根目录、`source/`、`tools/`、`.github/` 的关键项（含你当前文章与资源目录的示例）

3) `Interfaces`（接口与命令）
- 列：接口类型(CLI/CI/配置/Front-matter)｜名称｜入口（命令/文件#键）｜输入｜输出/影响｜常见问题/排查
- 自动填充：`npm run server/build/clean`、`pages.yml` 触发条件、`post_asset_folder`、`permalink` 等

4) `ContentSpec`（写作与格式规范）
- 列：规范项｜规则｜示例｜检查方式｜备注
- 自动填充：Front-matter 必填模板、标题层级、`<!-- more -->`、图片 `{% asset_img %}`、参考资料格式等

5) `Extend`（如何扩展）
- 列：扩展目标｜修改点（文件/目录）｜最小步骤｜验证方式｜风险/回滚
- 自动填充：新增页面、增加全站 JS/CSS、引入 Hexo 插件、调整主题布局/菜单等

6) `ReleaseOps`（发布与运维）
- 列：场景｜操作｜触发条件｜产物｜故障现象｜处理办法
- 自动填充：路线 B（Actions）发布流程、Pages 设置、常见构建失败定位点

## 写入策略（不破坏现有 Excel）
- 先对 `doc/需求.xlsx` 做同目录备份（例如 `doc/需求.backup.xlsx`）。
- 读取现有工作簿：
  - 若已存在同名 Sheet：覆盖其内容（保留工作簿其它 Sheet）。
  - 若不存在：新增上述 Sheet。
- 写入时统一：首行冻结、自动筛选、列宽自适应、关键列加粗。

## 落地实现方式（执行阶段会做）
- 在仓库新增一个一次性脚本（Node 方案优先）：
  - 使用 `xlsx` 类库读取/写入 `doc/需求.xlsx`（需要在 `package.json` 增加依赖并更新 lockfile）。
  - 脚本会把上面 6 张表写入并填充。

## 验证
- 脚本执行后：
  - 重新打开 `doc/需求.xlsx` 确认 6 个 Sheet 均存在、表头与数据完整。
  - 核对关键路径与配置项（例如 `_config.yml`、`pages.yml`、`source/_posts`）。

确认后我会开始执行：备份原 xlsx → 写入/更新 6 张 Sheet → 输出完成的 `doc/需求.xlsx`。