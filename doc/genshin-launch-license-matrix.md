# 原神式启动体验素材许可矩阵

| 项目 | 来源与固定版本 | 上游声明 | 本项目状态 | 发布策略与说明 |
|---|---|---|---|---|
| `www-genshin` 源代码 | `gamemcu/www-genshin`，commit `090cb905a53a078fb192fc7e3da2a7a679d35ff4` | MIT，Copyright (c) 2023 gamemcu | 参考实现；不复制 React/xviewer UI 代码 | 保留上游 LICENSE，并由 Vite/Three.js 重新实现运行时 |
| 13 个 GLB 模型 | 同一仓库 `public/Genshin/Login/` | 仓库包含 MIT LICENSE，但未单独说明游戏模型权属 | 13 个全部归档、发布并在 ready 前作为必需视觉资源加载；任一失败均安全交还博客 | 非官方、非商业练习；不据此主张游戏素材获得 MIT 授权 |
| 7 张场景 PNG | 同一仓库 `public/Genshin/Login/Textures/` | 未发现逐文件授权声明 | 已归档；5 张参与发布并在 ready 前作为必需视觉资源加载，`Tex_0061.png` 与 `Tex_0077.png` 仅留档 | 只发布运行时实际引用的纹理；逐文件散列见 source manifest |
| 4 个 MP3 | 同一仓库 `public/Genshin/` | 未发现逐文件授权声明 | 已归档；按用户手势延迟加载 | 非关键能力，静音不阻断启动流程；不用于商业发行 |
| *Genshin Impact* 名称及相关标识 | 相关权利人 | 商标及其他权利归各自权利人 | 不复制原神 Logo；页面标记为非官方练习 | 不暗示 HoYoverse、miHoYo 或游戏团队认可、赞助或关联 |

## 追溯与复核

- 原始目录：`vendor/genshin-launch/original/`
- 上游许可证：`vendor/genshin-launch/original/LICENSE`
- 文件清单、SHA-256、字节数、加载层级和发布目标：`launch/asset-source-manifest.json`
- 面向访客的来源说明：`/credits/`
- 总体第三方声明：`THIRD_PARTY_NOTICES.md`

此矩阵用于记录来源和风险边界，不构成法律意见或额外授权。若项目从个人练习转为公开推广、商业化或大规模分发，应在发布前重新完成素材权利审查，必要时替换为自制或已明确授权的素材。
