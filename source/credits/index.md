---
title: 素材与开源致谢
date: 2026-07-14 00:00:00
type: "credits"
comments: false
---

## 原神式 Three.js 启动体验

这是一个用于学习 Three.js、WebGL 场景组织和网页过场动画的非官方练习项目，不是《原神》官方页面，与 HoYoverse、miHoYo 及《原神》项目组没有关联，也未获得其背书或赞助。

### 参考实现

- 开源仓库：[gamemcu/www-genshin](https://github.com/gamemcu/www-genshin)
- 固定参考版本：[commit `090cb905a53a078fb192fc7e3da2a7a679d35ff4`](https://github.com/gamemcu/www-genshin/tree/090cb905a53a078fb192fc7e3da2a7a679d35ff4)
- 上游仓库代码许可证：MIT，Copyright (c) 2023 gamemcu

本站没有复制上游的 React 启动 UI、原神 Logo 或鼠标样式；三维运行时使用 Three.js 重新实现。

### 模型、纹理和音频

练习中复用了上述仓库内的 GLB 模型、PNG 场景纹理和 MP3 音频。上游仓库提供了 MIT 许可证，但其中与《原神》相关的游戏素材没有逐文件的独立权利声明。因此，本页的来源标注不等于声称这些第三方游戏素材已经获得 MIT 授权，也不构成再分发或商业使用许可。

《原神》名称、游戏素材、音频及相关标识的权利归各自权利人所有。本站仅将它们用于非商业、非官方的网页图形练习。

### 技术依赖

- [Three.js](https://threejs.org/) — MIT License
- [Vite](https://vite.dev/) — MIT License

更完整的文件级来源、校验值和许可风险记录，见项目仓库中的 `THIRD_PARTY_NOTICES.md`、`launch/asset-source-manifest.json` 和 `doc/genshin-launch-license-matrix.md`。
