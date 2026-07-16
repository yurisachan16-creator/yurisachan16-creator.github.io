# 原神式启动体验：开发、验证与发布手册

这份文档描述 `Three.js` 启动体验的日常开发、自动化门禁和真机放行流程。素材来源与权利边界见 [许可矩阵](./genshin-launch-license-matrix.md)；该功能是非官方、非商业练习项目。

## 运行方式与开关

- 正式开关位于 `_config.butterfly.yml` 的 `yurisa-launch-enabled` meta，默认必须为 `false`。
- `/?launch=preview`：在开关关闭时强制预览，但仍尊重 reduced-motion、Save-Data 和 WebGL2 门槛。
- `/?launch=off`：最高优先级关闭，用于普通站点回归和紧急排障。
- 正常自动播放每个会话只发生一次，记录键为 `sessionStorage.yurisa_launch_seen_v1`；重播与 preview 不写该键。
- 紧急回滚只需把 meta 改回 `false` 并重新部署。关闭状态不得请求 `/assets/launch/manifest.json` 或任何 3D/音频资源。

运行时边界如下：

```text
head bootstrap（资格/单例/fail-open）
  └─ runtime manifest（散列入口与素材表）
      └─ controller（状态机/DOM/音频）
          └─ scene adapter（Three.js/道路接缝/门动画/里程碑/画质）
              └─ ResourceScope（RAF/监听器/GPU/音频释放）
```

关键入口：

- `source/js/genshin-launch.js`：不包含 Three.js 的同步 bootstrap。
- `source/css/genshin-launch.css`：启动外壳、响应式和安全区样式。
- `launch/src/`：Vite/TypeScript 场景运行时。
- `launch/asset-source-manifest.json`：固定来源、散列、层级和关键性。
- `tools/build-genshin-launch.mjs`：派生资源、runtime manifest 与发布预算校验。

## 本地开发

要求 Node.js `>=20.19.0`、npm，以及可执行的 `ffmpeg`。首次安装后运行：

```bash
npm ci
npm run dev
```

`npm run dev` 会先生成素材，再并行运行 Hexo 和 launch runtime watch。访问：

- `http://localhost:4000/?launch=preview`：真实启动场景。
- `http://localhost:4000/?launch=off`：原站回归。

常用验证：

```bash
npm run test:unit
npm run test:coverage:launch
npm run build
npm run test:e2e:critical
npm run test:e2e:release
npm run test:e2e:visual
```

`npm run build` 的固定顺序是博客数据 → Hexo → 派生素材 → Vite → prune → 最终 manifest 校验。不要直接编辑 `public/assets/launch/`；它是可删除的构建产物。

高还原基线在 ready 前加载全部视觉必需资源，发布体积上限为 3.5 MiB；总视觉资源上限仍为 4.5 MiB。高档使用上游原始 PNG mask，512 WebP 只允许低档选择。主 3D JS gzip 硬上限为 220 KiB，连同 Draco decoder 不得超过 300 KiB。

维护者需要更新作者基准时，先准备固定在 `090cb905a53a078fb192fc7e3da2a7a679d35ff4` 且已安装依赖的上游 checkout，再运行：

```bash
npm run launch:reference:capture -- --upstream-dir /absolute/path/to/www-genshin
```

该命令固定 Three revision 150、seed、1280×720 与 Chromium SwiftShader，并写入 PNG 散列和 provenance。PR 只消费审阅后提交的参考文件，不联网重建上游。

## CI 与发布门禁

| 场景 | 工作流/命令 | 强制内容 |
|---|---|---|
| Pull Request | `quality.yml` / `test:e2e:critical` + `test:e2e:visual` | verify；Chromium + WebKit 核心启动、跳过、失败恢复；macOS Chromium/SwiftShader 消费签入的作者参考图，不联网重建上游 |
| 每日回归 | `launch-nightly.yml` | 完整 verify；五个 Playwright 项目；Slow 4G；context loss；五轮重播清理 |
| 正式 Release | `release-please.yml` → `launch-release-gate.yml` | 与每日回归相同；门禁通过后 Release Please 才能运行 |
| 手动复核 | Actions → `Launch Release Gate` → Run workflow | 与正式 Release 相同，报告保留 14 天 |
| 受信任预览 | `pages-preview.yml`（`codex/**`） | verify 后部署 Cloudflare branch preview，仍保持正式开关关闭 |

自动化分层：

- `tests/e2e/genshin-launch.spec.ts` 使用确定性 scene adapter，覆盖接缝武装、场景里程碑、context loss、资源失败和 generation finalizer，不依赖 CI GPU。
- `tests/e2e/genshin-launch-release.spec.ts` 的 Chromium CDP 配置为 400ms RTT、400kbps 下载、128kbps 上传；验证慢网时外壳仍可用且 Skip 在约 2 秒出现。
- release spec 连续创建/释放五个 generation，并要求 host、canvas、RAF、事件监听器与音频节点计数回到基线。
- `tests/e2e/genshin-launch-visual.spec.ts` 使用轻量 scene adapter 快速覆盖 shell 的 loading、ready、gate-ready 与 Hero 交接；它不冒充 3D 白场证据。
- `tests/e2e/genshin-launch-scene-visual.spec.ts` 直接 import content-hashed 生产 runtime，真实加载 GLB、Draco、原始 PNG 与 shader，覆盖 ready、道路升起 0.6 秒、门形成 1.458 秒、5 秒门前、entering 0.5/0.7/0.84 秒和 Hero 交还。规范视口为 1280×720，另测 1440×900、844×390；390×844 只验证舞台旋转及退出恢复。固定 seed/clock/quality 仅通过 adapter API 传入，生产 bootstrap 不读取测试 query。
- `launch:verify` 校验来源、散列、关键资源完整性、文件数、Cloudflare 单文件限制与传输预算；解码纹理、几何和 render-target 的 GPU 估算由真实 scene debug 与运行时预算保护负责。

本地只跑发布附加门禁：

```bash
npx playwright test tests/e2e/genshin-launch-release.spec.ts --project=chromium
```

查看 HTML 报告：

```bash
npx playwright show-report
```

## 故障判定

- reduced-motion、Save-Data、无 WebGL2：不创建 host，且 launch 网络请求数必须为 0。
- manifest、任一视觉必需模型/纹理/Shader、renderer、首帧或 context loss：150ms 目标内 fail-open，恢复页面滚动、焦点、inert 和 Live2D；本页重播按钮禁用。
- 音频请求、解码或播放失败：静音降级，不中断视觉主流程。
- Skip/Escape、PJAX、旧 watchdog 和晚到 promise 必须只结束自己的 generation；`yurisa:launch-complete` 每代只触发一次。
- 任意失败后先确认 `document.querySelectorAll('.yurisa-launch').length === 0`、`#body-wrap` 无 `inert`，再检查控制台与 Playwright trace。

## Android 与 iPhone 真机验收

自动化不能替代真实移动 GPU、系统音频策略、刘海安全区和浏览器内存压力。每次把正式 meta 从 `false` 改成 `true` 前，必须在一台中档 Android 和一台 iPhone 上完成以下清单，并把证据链接附到发布 PR。

### 设备记录

| 字段 | Android | iPhone |
|---|---|---|
| 品牌/型号 |  |  |
| OS 版本 |  |  |
| 浏览器与版本 | Chrome： | Safari： |
| 屏幕尺寸/刷新率 |  |  |
| 测试 commit |  |  |
| Cloudflare preview URL |  |  |
| 测试日期/执行人 |  |  |

### 必测清单

- [ ] 清理站点数据后首次访问自动出现；同一会话刷新不再自动播放；门形按钮可以重播。
- [ ] 加载阶段 Escape 从第一帧可用；Skip 在 2 秒后出现，点击后站点可在 150ms 目标内滚动和交互。
- [ ] 两步 CTA 文案、下一道路接缝触发、5 秒靠门、0.6 秒冲门、0.7 秒全白及 2.1 秒 Hero 交接均完整，无黑帧或闪回。
- [ ] 竖屏仅旋转启动 host 为横屏舞台；旋转过程中 canvas 不拉伸、不重启状态机；退出后博客恢复正常竖屏。
- [ ] 首次“启动”点击前没有 BGM 请求或声音；点击后音频可播放；静音状态在重播中保持；系统静音时画面不阻断。
- [ ] 系统“减少动态效果”开启时零 launch 请求；Android Data Saver/Save-Data 可用时零 launch 请求。
- [ ] 飞行模式、Slow 4G、manifest 失败或中途断网均能跳过/fail-open，原首页、音乐播放器和 Live2D 可继续使用。
- [ ] 连续重播并退出 5 次；每次只存在一个 canvas；结束后运行 `document.querySelectorAll('.yurisa-launch canvas').length` 得到 `0`。
- [ ] Android Chrome 远程 Performance 记录 travelling 段，帧耗 p90 ≤33.3ms；用 Spector.js/同等工具记录 draw calls ≤80。
- [ ] iPhone Safari Web Inspector 记录 travelling 段，无持续 long task、context loss 或显著内存阶梯增长。
- [ ] 触控目标至少 44×44px，最亮云层和 Bloom 前一帧仍可辨认焦点、Skip、静音和 CTA。
- [ ] 来源链接打开 `/credits/`，不出现原神 Logo，不暗示官方关联。

### 五轮资源回收记录

在每轮完成/跳过后记录：

| 轮次 | host 数 | canvas 数 | 页面可滚动 | Live2D 恢复 | JS heap/备注 |
|---:|---:|---:|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |
| 5 |  |  |  |  |  |

验收后结论只能填写 `PASS` 或 `BLOCKED`：

```text
Android: PASS/BLOCKED — 证据链接：
iPhone: PASS/BLOCKED — 证据链接：
自动化 Launch Release Gate run：
最终批准人/日期：
```

Android、iPhone 或自动化任一项为 `BLOCKED` 时，不得开启正式 meta；保持 `false` 并使用 preview URL 继续修复。
