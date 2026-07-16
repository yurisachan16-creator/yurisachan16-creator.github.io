# Third-Party Notices

## Noto Sans SC

- Source package: `@fontsource/noto-sans-sc@5.2.9`
- Copyright: Google Inc.
- License: SIL Open Font License 1.1
- Preserved license: `source/fonts/noto-sans-sc/LICENSE.txt`

The three launch UI webfonts are character-subset builds of the 300, 400 and
500 weights. They are used only by the launch shell so the approved Chinese
typography is deterministic without a third-party font request.

## Lucide icons

- Source package: `lucide-static@0.468.0`
- License: ISC
- Preserved license: `source/img/launch/icons/LICENSE-lucide.txt`

The launch utility rail and Gate CTA use the upstream Skip Forward, Volume 2,
Volume X, External Link and Arrow Right SVG assets as CSS masks.

## Font Awesome Play icon

- Source package: `@fortawesome/fontawesome-free@7.1.0`
- Copyright: Fonticons, Inc.
- Icon license: CC BY 4.0
- Preserved license: `source/img/launch/icons/LICENSE-fontawesome.txt`

The Ready control uses the upstream solid Play SVG as a CSS mask. No remote
icon font is required for the launch shell.

## `gamemcu/www-genshin`

- Source: <https://github.com/gamemcu/www-genshin>
- Pinned commit: [`090cb905a53a078fb192fc7e3da2a7a679d35ff4`](https://github.com/gamemcu/www-genshin/tree/090cb905a53a078fb192fc7e3da2a7a679d35ff4)
- Upstream code license: MIT, copyright (c) 2023 gamemcu
- Preserved license: `vendor/genshin-launch/original/LICENSE`
- File-level provenance and checksums: `launch/asset-source-manifest.json`

The upstream repository's source code is distributed under the MIT License.
Its repository also contains models, textures and audio associated with the
game *Genshin Impact*. The MIT notice does not by itself establish that those
third-party game assets are covered by the same license or cleared for reuse.

The copied media is included here only for an unofficial, non-commercial web
graphics study. This project is not affiliated with, endorsed by, sponsored
by, or an official product of HoYoverse, miHoYo, or the *Genshin Impact* team.
All game names, visual assets, audio, and related marks remain the property of
their respective rights holders. Do not treat this notice as a grant of rights
to redistribute or commercially use those assets.

### MIT License text from the upstream repository

```text
MIT License

Copyright (c) 2023 gamemcu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
