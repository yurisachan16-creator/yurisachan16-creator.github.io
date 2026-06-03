# Live2D Assistant 开发说明

本项目当前使用 PixiJS + `pixi-live2d-display` 渲染 Live2D 看板娘。入口脚本是 `source/js/live2d-assistant.js`，负责加载 Cubism Core、Pixi、`pixi-live2d-display`、本地模型、台词、站内助理面板、rightside 开关、位置配置和 PJAX 重绑。

`source/live2d-widget/dist` 中仍保留旧 `live2d-widget` 静态资源和 LICENSE，作为历史回退资源；当前默认渲染不再加载 `waifu-tips.js` 或旧 widget runtime。

## 本地运行

```bash
npm install
npm run server
```

打开本地 Hexo 页面后，右下角应出现 Live2D 看板娘，右侧工具栏会多一个“看板娘”按钮。

## 调试

浏览器控制台可用：

```js
window.__live2dAssistant.debug()
window.__live2dAssistant.say('测试台词', 10)
window.__live2dAssistant.toggle()
window.__live2dAssistant.openPanel('search')
window.__live2dAssistant.openPanel('model')
window.__live2dAssistant.applyModelView({ scale: 1.35, x: 0, y: 80 })
window.__live2dAssistant.resetModelView()
window.__live2dAssistant.randomPost()
window.__live2dAssistant.reportProgress()
window.__live2dAssistant.resetPlacement()
window.__live2dAssistant.playRandomMotion()
```

## 关键配置

配置位于 `_config.butterfly.yml` 的 `inject.head`：

- `live2d-enabled`: 是否启用。
- `live2d-tips-path`: 本站台词 JSON。
- `live2d-site-index-path`: 站内搜索索引，默认读取 Hexo 生成的 `/search.xml`。
- `live2d-model-path`: 默认模型入口文件。
- `live2d-cubism5-path`: Cubism 3/4 runtime。
- `live2d-pixi-path`: PixiJS CDN 路径。
- `live2d-pixi-live2d-path`: `pixi-live2d-display` Cubism 4 bundle CDN 路径。
- `live2d-model-id`: 默认模型序号。
- `live2d-tools`: 工具按钮列表。
- `live2d-width` / `live2d-height`: 看板娘渲染区域尺寸。
- `live2d-model-scale`: 模型缩放倍率。面板里的“模型”页可以覆盖并保存这个值。
- `live2d-model-x` / `live2d-model-y`: 模型在渲染区域里的 X/Y 偏移，用于调整全身、半身和构图。
- `live2d-render-scale`: Pixi 内部渲染倍率。
- `live2d-max-fps`: Pixi ticker 帧率上限。
- `live2d-max-panel-posts`: 助理面板里最多展示的文章数量。
- `live2d-position`: 默认停靠方向，支持 `right` 或 `left`。
- `live2d-right` / `live2d-left` / `live2d-bottom`: 默认位置偏移，用于避开右侧工具栏和页面内容。

`_config.yml` 中的 `skip_render` 必须包含 `live2d-widget/**`，避免 Hexo 处理 widget 静态资源。

## 站内助理功能

角色工具栏里的罗盘按钮会打开功能面板。当前面板参考 Bangumi 的“吉祥物作为入口”思路，但只服务本站：

- 读取 `/search.xml`，展示最新文章并支持关键词搜索。
- 随机挑一篇文章跳转。
- 调整模型缩放和 X/Y 偏移，支持全身、半身和重置。
- 汇报当前阅读进度。
- 跳转到分类、标签页。
- 触发已有音乐面板和站点风格切换。

功能面板不依赖外部 API；如果 `/search.xml` 暂时加载失败，会退回读取当前页面 DOM 中的文章链接。

## 本地模型

当前默认模型是阿芙洛狄忒，资源位于 `source/live2d-widget/models/aphrodite/`，入口文件是 `/live2d-widget/models/aphrodite/fense.model3.json`。该模型是 Cubism 3/4 `model3.json`，运行时仍需要加载 `live2d-cubism5-path` 指向的 Cubism Core。

原始贴图为 8192x8192，超过 Cloudflare Pages 单文件 25 MiB 限制，且在博客右下角小尺寸渲染时负载过高；当前 `texture_00.png` 已降采样为 2048x2048 以便发布和改善交互流畅度。

## 更新渲染依赖

当前 Pixi 和 `pixi-live2d-display` 通过 `_config.butterfly.yml` 的 CDN meta 指定。更新版本时：

1. 修改 `live2d-pixi-path` 或 `live2d-pixi-live2d-path`。
2. 运行 `npm run test:unit` 和 `npm run build`。
3. 在 `license-matrix.md` 记录版本和许可变化。

## 逃生通道

需要临时关闭时，把 `_config.butterfly.yml` 中 `live2d-enabled` 改为 `false`，或移除 bottom 中 `/js/live2d-assistant.js` 的注入项。
