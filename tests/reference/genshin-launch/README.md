# Genshin launch visual references

The immutable visual truth is `gamemcu/www-genshin@090cb905a53a078fb192fc7e3da2a7a679d35ff4` at Three revision 150. Bilibili `BV1E8411v7xy` is an editorial reference for composition and timing only.

Maintainers regenerate upstream canvas references explicitly:

```bash
npm run launch:reference:capture -- --upstream-dir /absolute/path/to/www-genshin
```

The checkout must already be on the pinned commit with dependencies installed. The command pins a 1280×720 viewport, seeded `Math.random`, Playwright's controllable clock, Chromium software ANGLE flags, and writes PNG hashes plus browser/source provenance. Pull requests compare against reviewed, checked-in files and must never clone or build upstream over the network.

Reference PNG updates require a human source-video comparison. Do not accept `--update-snapshots` merely because the current renderer changed.
