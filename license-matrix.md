# Live2D License Matrix

| Item | Source | Version | License | Production status | Notes |
|---|---|---:|---|---|---|
| live2d-widget code | `stevenjoezhang/live2d-widget` / npm `live2d-widgets` | 1.0.1 | GPL-3.0-or-later | Included | Vendored under `source/live2d-widget`; keep LICENSE. |
| Live2D Cubism 2 runtime | `dist/live2d.min.js` from `live2d-widgets@1.0.1` | 1.0.1 package asset | Live2D SDK terms apply | Included | Used for Cubism 2 models. |
| Live2D Cubism 5 Core | `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` | external | Live2D Proprietary Software License | External | Loaded only if selected model requires Cubism 5. |
| PixiJS | `https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js` | 6.5.10 | MIT | External | Loaded by `source/js/live2d-assistant.js` for the Pixi renderer. |
| pixi-live2d-display | `https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js` | 0.4.0 | MIT | External | Cubism 4 bundle used for Cubism 3/4 model rendering. |
| CDN model assets | `https://fastly.jsdelivr.net/gh/fghrsh/live2d_api/` | external | Model-specific | Not used by default | Kept as bridge default only; current site config uses local model paths. |
| Aphrodite model assets | User-provided zip `阿芙洛狄忒模型文件+(2).zip` | 2023-08 package files | Custom usage rules from bundled README | Included | Stored under `source/live2d-widget/models/aphrodite`; README says copyright belongs to `灵境Sanctuary`, free use is allowed, and modification/sale/rental are prohibited. Texture was downsampled to 2048x2048 for the Cloudflare Pages 25 MiB asset limit and smoother web rendering. |
| Local tips JSON | `source/live2d-widget/waifu-tips-yurisa.json` | local | Project content | Included | Site-specific text, no upstream NSFW defaults. |
