---
title: Hexo Butterfly 主题：从零打造侧边栏音乐播放器
date: 2026-02-14 12:00:00
updated: 2026-02-14 12:00:00
tags:
  - 博客
  - Hexo
  - Butterfly
  - 教程
categories:
  - 博客搭建
cover: /2026/02/14/butterfly-music-player-tutorial/cover.jpeg
description: 不修改主题源码，用纯 JS 动态注入的方式为 Butterfly 主题添加一个侧边抽屉音乐播放器，支持本地音频文件 (mp3/ogg/wav/aac/m4a/opus/flac) + 网易云歌单双源播放。
permalink: /2026/02/14/butterfly-music-player-tutorial/
top_img: false
---

# Hexo Butterfly 主题：从零打造侧边栏音乐播放器

想给博客加个音乐播放器，但你可能会遇到一个棘手的问题——Butterfly 主题的 `sync-themes.mjs` 脚本在每次 `npm install` 时会**完全重置** `themes/butterfly/` 目录，导致所有对 pug 模板的修改都被覆盖。

本文介绍一种**零侵入方案**：全部 DOM 通过 JavaScript 动态注入，不修改任何主题文件，配合 `_config.butterfly.yml` 的 `inject` 机制完成集成。

<!-- more -->

## 效果预览

最终效果：

- 📌 页面右下角 rightside 区域出现 🎵 音乐按钮（紧邻「回到顶部」上方）
- 📌 点击弹出侧边抽屉面板，包含封面、进度条、播控按钮、音量控制、播放列表
- 📌 支持**本地音频文件** (mp3/ogg/wav/aac/m4a/opus/flac) + **网易云歌单**双源，自动去重合并
- 📌 深色模式自适应
- 📌 PJAX 页面切换不中断播放
- 📌 移动端全宽适配（≤768px 自动拉满屏幕宽度）

## 核心思路

```plain
┌─────────────────────────────────┐
│  _config.butterfly.yml          │
│  ├─ inject.head → meta 标签     │  ← 传递网易云歌单 ID
│  └─ inject.bottom → JS/CSS     │  ← 加载播放器脚本
├─────────────────────────────────┤
│  source/js/music-player.js      │  ← 核心：动态创建所有 DOM
│  source/css/custom.css          │  ← 样式（约 350 行）
│  source/music/playlist.json     │  ← 本地播放列表元数据
├─────────────────────────────────┤
│  themes/butterfly/ (不修改!)     │  ← sync-themes 随便覆盖
└─────────────────────────────────┘
```

关键在于 `createDOM()` 函数——JS 加载后**自动**在 `#rightside-config-show` 容器中注入音乐按钮，在 `document.body` 上创建遮罩层和抽屉面板。整个流程不需要改动任何主题文件。

## 架构概览

播放器由四个核心模块组成：

| 模块 | 职责 |
|------|------|
| `createDOM()` | 动态创建所有 HTML 元素（按钮、遮罩、抽屉面板） |
| `PlaylistManager` | 管理本地 + 网易云双源播放列表，去重合并 |
| `AudioBridge` | 封装原生 Audio API，统一播控接口 |
| `DrawerController` | UI 状态管理，抽屉开关、播控、进度条、音量、键盘快捷键 |

整体包裹在一个 IIFE（立即执行函数表达式）中，避免全局污染。

---

## 第一步：准备本地播放列表

新建 `source/music/playlist.json`，定义本地音乐的元数据：

```json
[
  {
    "title": "使一颗心免于哀伤",
    "artist": "知更鸟 / HOYO-MiX / Chevy",
    "url": "/music/知更鸟 _ HOYO-MiX _ Chevy - 使一颗心免于哀伤.mp3",
    "cover": "/img/star-rail/cover.jpg",
    "album": "崩坏：星穹铁道 知更鸟专辑"
  },
  {
    "title": "在银河中孤独摇摆",
    "artist": "知更鸟 / HOYO-MiX / Chevy",
    "url": "/music/知更鸟 _ HOYO-MiX _ Chevy - 在银河中孤独摇摆.ogg",
    "cover": "/img/star-rail/cover.jpg",
    "album": "崩坏：星穹铁道 知更鸟专辑"
  }
]
```

每首歌需要 5 个字段：

| 字段 | 说明 |
|------|------|
| `title` | 曲名 |
| `artist` | 歌手/艺术家 |
| `url` | 音频文件路径（放在 `source/music/` 下） |
| `cover` | 封面图路径 |
| `album` | 专辑名（可选） |

然后把音频文件（支持 `.mp3`、`.ogg`、`.wav`、`.aac`、`.m4a`、`.opus`、`.flac` 等格式）放到 `source/music/` 目录下即可。播放器会自动检测浏览器对各格式的支持情况。

> 💡 如果你**只使用网易云歌单**不需要本地音乐，这个文件留空数组 `[]` 即可。

---

## 第二步：编写播放器核心 JS

新建 `source/js/music-player.js`，整体结构如下：

```javascript
;(function () {
  'use strict'

  // 1. 常量 & 枚举
  var State = { IDLE: 'idle', LOADING: 'loading', PLAYING: 'playing', PAUSED: 'paused', ERROR: 'error' }
  var PLAYLIST_URL = '/music/playlist.json'

  // 2. 工具函数
  //    formatTime, saveState, loadState, fetchWithRetry

  // 3. createDOM() — 最关键：动态注入所有 DOM
  // 4. injectRightsideButton() — 在 rightside 注入入口按钮

  // 5. PlaylistManager — 播放列表管理
  // 6. AudioBridge — 音频引擎封装
  // 7. DrawerController — UI 控制器

  // 8. init() 入口 + PJAX 兼容
  // 9. module.exports 测试导出
})()
```

下面详细讲解每个关键模块。

### 2.1 动态 DOM 注入（最关键的部分）

这是整个方案的**核心**——不修改 pug 模板，全部通过 JS 动态创建：

```javascript
function createDOM () {
  // 幂等保护：已注入则跳过
  if (document.getElementById('music-drawer')) return true

  // 1. 在 rightside 中注入音乐按钮
  injectRightsideButton()

  // 2. 创建遮罩层
  var mask = document.createElement('div')
  mask.id = 'music-drawer-mask'
  document.body.appendChild(mask)

  // 3. 创建抽屉面板
  var drawer = document.createElement('div')
  drawer.id = 'music-drawer'
  drawer.innerHTML =
    '<div class="music-drawer-header">' +
      '<span class="music-drawer-title">🎵 播放列表</span>' +
      '<div class="music-drawer-header-actions">' +
        '<select id="music-source-switch">' +
          '<option value="local">本地音乐</option>' +
          '<option value="netease">网易云</option>' +
          '<option value="both">全部</option>' +
        '</select>' +
        '<button id="music-drawer-close" title="关闭">' +
          '<i class="fas fa-times"></i>' +
        '</button>' +
      '</div>' +
    '</div>' +
    // ... 封面区、进度条、控制按钮、音量、状态、播放列表
    '<ul id="music-playlist"></ul>'

  document.body.appendChild(drawer)
  return true
}
```

按钮注入的位置很讲究——插入到 `#go-up`（回到顶部按钮）**之前**：

```javascript
function injectRightsideButton () {
  // 幂等保护
  if (document.getElementById('music-player-btn')) return

  var show = document.getElementById('rightside-config-show')
  var goUp = document.getElementById('go-up')
  if (!show) return

  var btn = document.createElement('button')
  btn.id = 'music-player-btn'
  btn.type = 'button'
  btn.title = '音乐播放器'
  btn.innerHTML = '<i class="fas fa-music"></i>'

  // 插入到 go-up 之前，保证视觉位置在底部倒数第二个
  if (goUp) show.insertBefore(btn, goUp)
  else show.appendChild(btn)
}
```

> 🔑 **为什么这样做？** Butterfly 的 `sync-themes.mjs` 脚本会在 `npm install` 的 postinstall 钩子中执行 `fs.rm` + `fs.cp`，完全删除并重建 `themes/butterfly/` 目录。任何对 pug 模板、layout 文件的修改都会被覆盖。纯 JS 注入会完全绕过这个问题，因为我们的文件全部在 `source/` 目录下。

### 2.2 PlaylistManager — 双源播放列表

```javascript
function PlaylistManager () {
  this.localTracks = []     // 本地音乐
  this.neteaseTracks = []   // 网易云歌单
  this.merged = []          // 合并后（去重）
  this.source = 'local'     // 当前源：'local' | 'netease' | 'both'
}
```

核心方法：

- **`loadLocal()`** — 通过 `fetch` 请求 `/music/playlist.json`，自带重试机制（2s → 4s → 8s 递增延迟）
- **`loadNetease(id)`** — 调用 [Meting API](https://github.com/metowolf/MetingJS) 获取网易云歌单数据，自动转换字段格式
- **`merge()`** — 按 `title|artist` 组合键去重合并两个来源，本地版本优先保留
- **`getList()`** — 根据当前 `source` 返回对应列表

```javascript
PlaylistManager.prototype.loadNetease = function (id) {
  if (!id) return Promise.resolve([])
  var self = this
  var url = 'https://api.i-meto.com/meting/api?server=netease&type=playlist&id=' + id
  return fetchWithRetry(url).then(function (data) {
    self.neteaseTracks = (Array.isArray(data) ? data : []).map(function (t) {
      return {
        title: t.name || t.title,
        artist: t.artist || t.author,
        url: t.url,
        cover: t.pic || t.cover,
        album: t.album || ''
      }
    })
    return self.neteaseTracks
  }).catch(function () {
    self.neteaseTracks = []
    return []
  })
}
```

### 2.3 AudioBridge — 音频引擎封装

封装原生 `Audio` API，提供统一接口：

```javascript
function AudioBridge () {
  this.audio = new Audio()
  this.audio.preload = 'auto'
  this.audio.volume = 0.4
  this._bound = false
}

// 播放控制
AudioBridge.prototype.play = function () { return this.audio.play() }
AudioBridge.prototype.pause = function () { this.audio.pause() }
AudioBridge.prototype.seek = function (time) { this.audio.currentTime = time }
AudioBridge.prototype.setVolume = function (v) {
  this.audio.volume = Math.max(0, Math.min(1, v))  // 钳位到 0~1
}

// 音频格式兼容性检测
AudioBridge.prototype.canPlayType = function (mime) {
  return this.audio.canPlayType(mime) !== ''
}
```

事件绑定通过回调属性传递给 `DrawerController`，包括 `timeupdate`、`ended`、`error`、`canplay`、`loadstart`。

### 2.4 DrawerController — UI 状态管理

这是最大的模块，负责所有 UI 交互：

```javascript
function DrawerController (opts) {
  this.playlist = opts.playlist   // PlaylistManager 实例
  this.bridge = opts.bridge       // AudioBridge 实例
  this.currentIndex = 0
  this.state = State.IDLE
  this.order = 'list'             // 'list' | 'random'
  this.isOpen = false

  this.els = {}
  this._cacheDom()           // 缓存所有 DOM 引用
  this._bindBridgeEvents()   // 绑定音频事件
  this._bindUIEvents()       // 绑定 UI 交互事件
  this._restoreState()       // 从 localStorage 恢复状态
  this._renderPlaylist()     // 渲染播放列表
}
```

功能亮点：

- **抽屉开关** — CSS `translateX(100%)` → `translateX(0)` 动画，配合遮罩层
- **播放/暂停/上一首/下一首** — 标准播控
- **随机/顺序切换** — 点击切换 `fa-list-ol` ↔ `fa-random` 图标
- **进度条拖拽** — `<input type="range">` 监听 `input` 事件实时 seek
- **音量控制 + 静音** — 滑块 + 静音按钮，记忆上次音量
- **键盘快捷键** — 抽屉打开时 Space 暂停/播放，← → 前进/后退 5 秒
- **localStorage 持久化** — 记住播放位置、音量、顺序、音源偏好
- **播放列表点击选歌** — 事件委托到 `<ul>` 上
- **音频格式兼容检测** — 根据文件扩展名检测浏览器支持，不支持时自动跳过并提示

### 2.5 init 入口与 PJAX 兼容

```javascript
function init () {
  createDOM()  // 先动态注入所有 DOM

  if (!document.getElementById('music-drawer')) {
    console.warn('[MusicPlayer] DOM creation failed, aborting init')
    return
  }

  var pm = new PlaylistManager()
  var bridge = new AudioBridge()
  var ctrl = new DrawerController({ playlist: pm, bridge: bridge })
  ctrl._loadPlaylists()

  // 暴露给全局，方便在控制台调试
  window.__musicPlayer = { ctrl: ctrl, playlist: pm, bridge: bridge }
}

// DOMContentLoaded 或立即执行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

// PJAX 兼容：页面切换后重新注入按钮
document.addEventListener('pjax:complete', function () {
  injectRightsideButton()
  // 重新绑定按钮事件...
})
```

PJAX 切换页面时，`#rightside` 容器会被替换，但抽屉面板和遮罩层在 `document.body` 层级不受影响。只需重新注入 rightside 按钮即可。

---

## 第三步：添加 CSS 样式

在 `source/css/custom.css` 中添加播放器相关样式（约 350 行），核心部分：

### 入口按钮动画

```css
#music-player-btn.playing {
  animation: music-pulse 1.5s ease-in-out infinite;
}
@keyframes music-pulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
}
```

播放中时按钮会有脉冲呼吸动画，提示用户正在播放音乐。

### 遮罩层

```css
#music-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.35s ease, visibility 0.35s ease;
}
#music-drawer-mask.open {
  opacity: 1;
  visibility: visible;
}
```

### 抽屉面板

```css
#music-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  z-index: 1000;
  transform: translateX(100%);   /* 默认隐藏在右侧 */
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  overflow-y: auto;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
}
#music-drawer.open {
  transform: translateX(0);      /* 滑入显示 */
}
```

### 深色模式适配

```css
[data-theme="dark"] #music-drawer {
  background: rgba(30, 30, 46, 0.95);
}
[data-theme="dark"] .music-drawer-header {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}
/* 更多深色模式覆写... */
```

### 响应式适配

```css
@media screen and (max-width: 768px) {
  #music-drawer {
    width: 100vw;    /* 移动端全宽 */
  }
}
```

---

## 第四步：配置 Butterfly

编辑 `_config.butterfly.yml`，需要修改两个地方。

### 4.1 添加音乐播放器配置块（可选，仅做记录）

```yaml
music_player:
  enable: true
  source: both                    # local / netease / both
  netease_playlist_id: "你的歌单ID"
  volume: 0.4
  autoplay: false
  order: list
```

### 4.2 配置 inject（关键！）

```yaml
inject:
  head:
    - <link rel="stylesheet" href="/css/custom.css">
    # ⚠️ 关键：传递网易云歌单 ID 到前端 JS
    - <meta name="music-netease-id" content="你的歌单ID">
  bottom:
    # APlayer CDN 资源
    - <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.css">
    - <script src="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.js"></script>
    - <script src="https://cdn.jsdelivr.net/npm/meting@2/dist/Meting.min.js"></script>
    # 自定义播放器脚本
    - <script src="/js/music-player.js"></script>
```

> ⚠️ **这里有个关键一步容易遗漏**：`<meta name="music-netease-id" content="歌单ID">` **必须**添加到 `inject.head` 中。因为 `_config.butterfly.yml` 中的 YAML 配置不会自动传到 HTML 页面，JS 通过 `document.querySelector('meta[name="music-netease-id"]')` 来获取歌单 ID。如果没有这个 meta 标签，网易云歌单加载会静默失败。

### 如何获取网易云歌单 ID

打开网易云音乐网页版，找到你想要的歌单：

```
https://music.163.com/#/playlist?id=6894709007
                                    ^^^^^^^^^^
                              这串数字就是歌单 ID
```

将这个 ID 填入 meta 标签的 `content` 属性即可。

> 💡 **只需要确保歌单是公开的**，私有歌单无法通过 API 访问。

---

## 第五步：构建与验证

```bash
npx hexo clean
npx hexo generate
npx hexo server
```

打开 `http://localhost:4000`，向下滚动触发 rightside 显示，应该能看到 🎵 按钮。点击即可打开播放器抽屉。

你也可以打开浏览器控制台，输入 `__musicPlayer` 查看播放器内部状态，方便调试。

---

## 音源切换说明

在抽屉面板的右上角有一个下拉菜单，可以切换音乐来源：

| 模式 | 作用 |
|------|------|
| **本地音乐** | 仅播放 `playlist.json` 中定义的本地文件 |
| **网易云** | 仅播放网易云歌单中的曲目 |
| **全部** | 合并两个来源，自动按 `title + artist` 去重 |

---

## 测试覆盖

项目包含完整的测试基础设施。

### 单元测试（Vitest + jsdom）

```bash
npm run test:unit
```

30 个测试用例覆盖所有核心模块：

| 测试组 | 用例数 | 覆盖内容 |
|--------|--------|----------|
| `formatTime` | 5 | 时间格式化边界值 |
| `PlaylistManager` | 5 | 加载、重试、去重、源切换 |
| `AudioBridge` | 5 | 音量钳位、事件绑定幂等性 |
| `State` | 1 | 枚举值验证 |
| `DrawerController` | 10 | 抽屉开关、播放列表渲染、状态切换 |
| `createDOM` | 4 | DOM 注入、幂等保护、按钮位置 |

### E2E 测试（Playwright）

```bash
npx playwright install
npm run test:e2e
```

13 个场景覆盖：入口可见性、抽屉开关、播放列表加载、播放控制、切歌、音量/静音、响应式布局、播放列表选歌、PJAX 兼容、键盘快捷键、播放顺序切换、截图回归。

---

## 踩坑记录

### 🕳️ 坑 1：sync-themes.mjs 覆盖一切

**现象**：每次 `npm install` 后播放器凭空消失。

**原因**：项目中的 `tools/sync-themes.mjs` 在 postinstall 钩子中执行：

```javascript
await fs.rm(destinationPath, { recursive: true, force: true })
await fs.cp(sourcePath, destinationPath, { recursive: true, force: true })
```

这会把 `themes/butterfly/` 目录完全删除后从 `node_modules` 重建。

**方案**：放弃修改 pug 模板，改用纯 JS 动态注入所有 DOM——这就是 `createDOM()` 函数的由来。最终结果是**对 `themes/` 目录零修改**。

### 🕳️ 坑 2：网易云歌单 ID 无法传递到前端

**现象**：本地音乐正常播放，切到网易云后播放列表为空。

**原因**：`_config.butterfly.yml` 里配置了 `netease_playlist_id`，但 YAML 配置不会自动注入到生成的 HTML 中。JS 通过 `document.querySelector('meta[name="music-netease-id"]')` 查找歌单 ID，但页面中没有这个 meta 标签。

**方案**：在 `inject.head` 中手动添加 `<meta name="music-netease-id" content="歌单ID">`。

### 🕳️ 坑 3：jsdom 不实现 HTMLMediaElement

**现象**：单元测试中 `audio.load()` 抛出 `Not implemented` 错误。

**方案**：在测试中 stub 相关方法：

```javascript
bridge.canPlayType = () => true
bridge.audio.load = () => {}
```

---

## 完整文件清单

| 文件 | 作用 | 类型 |
|------|------|------|
| `source/js/music-player.js` | 播放器核心逻辑（~700 行） | 新增 |
| `source/css/custom.css` | 抽屉样式 + 深色模式（+350 行） | 追加 |
| `source/music/playlist.json` | 本地播放列表元数据 | 新增 |
| `source/music/*.*` | 本地音频文件 (mp3/ogg/wav/aac/m4a/opus/flac) | 新增 |
| `_config.butterfly.yml` | inject 配置 + meta 标签 | 修改 |
| `tests/unit/music-player.test.js` | 30 个单元测试 | 新增 |
| `tests/e2e/music-player.spec.ts` | 13 个 E2E 测试 | 新增 |

**主题目录修改数：0**。全部通过 `source/` 和 `inject` 机制完成。

---

## 总结

这种纯 JS 动态注入的方案虽然代码量比直接改 pug 模板多一些，但带来了几个重要优势：

1. **不侵入主题** — 主题更新、sync-themes 随便跑，播放器不受影响
2. **可移植** — 只需复制 3 个文件 + 改配置，可以搬到任何 Butterfly 站点
3. **可测试** — 完整的单元测试和 E2E 测试覆盖
4. **双源融合** — 本地高品质音频文件 (支持 mp3/ogg/wav/aac/m4a/opus/flac) + 网易云在线歌单，取两者之长

希望这篇教程能帮到同样想给 Butterfly 博客加音乐播放器的朋友！🎵
