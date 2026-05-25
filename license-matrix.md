# Live2D License Matrix

| Item | Source | Version | License | Production status | Notes |
|---|---|---:|---|---|---|
| live2d-widget code | `stevenjoezhang/live2d-widget` / npm `live2d-widgets` | 1.0.1 | GPL-3.0-or-later | Included | Vendored under `source/live2d-widget`; keep LICENSE. |
| Live2D Cubism 2 runtime | `dist/live2d.min.js` from `live2d-widgets@1.0.1` | 1.0.1 package asset | Live2D SDK terms apply | Included | Used for Cubism 2 models. |
| Live2D Cubism 5 Core | `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` | external | Live2D Proprietary Software License | External | Loaded only if selected model requires Cubism 5. |
| Model assets | `https://fastly.jsdelivr.net/gh/fghrsh/live2d_api/` | external | Model-specific | Review before production | Upstream widget README says demo model copyrights belong to original authors. |
| Local tips JSON | `source/live2d-widget/waifu-tips-yurisa.json` | local | Project content | Included | Site-specific text, no upstream NSFW defaults. |
