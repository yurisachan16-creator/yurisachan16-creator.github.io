# Live2D Assistant 开发说明

本项目当前按 Fork-first 思路接入 `stevenjoezhang/live2d-widget`：将 `live2d-widgets@1.0.1` 的 `dist` 自托管在 `source/live2d-widget/dist`，再通过 `/js/live2d-assistant.js` 做博客侧配置、PJAX 重绑、rightside 开关和调试入口。

## 本地运行

```bash
npm install
npm run server
```

打开本地 Hexo 页面后，左下角应出现 Live2D 看板娘，右侧工具栏会多一个“看板娘”按钮。

## 调试

浏览器控制台可用：

```js
window.__live2dAssistant.debug()
window.__live2dAssistant.say('测试台词', 10)
window.__live2dAssistant.toggle()
```

## 关键配置

配置位于 `_config.butterfly.yml` 的 `inject.head`：

- `live2d-enabled`: 是否启用。
- `live2d-widget-base`: vendored widget dist 路径。
- `live2d-tips-path`: 本站台词 JSON。
- `live2d-cdn-path`: 模型资源 CDN。
- `live2d-model-id`: 默认模型序号。
- `live2d-tools`: 工具按钮列表。

`_config.yml` 中的 `skip_render` 必须包含 `live2d-widget/**`，避免 Hexo 处理 widget 静态资源。

## 更新上游 widget

1. 重新获取固定版本的 `live2d-widgets` npm 包或你的 Fork 构建产物。
2. 替换 `source/live2d-widget/dist`。
3. 保留或更新 `source/live2d-widget/LICENSE`。
4. 运行 `npm run test:unit` 和 `npm run build`。
5. 在 `license-matrix.md` 记录版本和许可变化。

## 逃生通道

需要临时关闭时，把 `_config.butterfly.yml` 中 `live2d-enabled` 改为 `false`，或移除 bottom 中 `/js/live2d-assistant.js` 的注入项。
