# Deferred work

- [ ] Fix the Vereis homepage title clipping at 390×844. Replace the mobile `white-space: nowrap` behavior with a `clamp()`-based font size, allow at most two lines, and add a mobile visual regression. This is intentionally outside the Genshin launch experience implementation.
- [ ] During the required Android/iPhone launch acceptance, inspect the first `gate-forming` frame for a one-time shadow-depth shader compilation spike. The main door shader is awaited with `compileAsync()` before ready, but Three.js creates the hidden door's automatic shadow variant only when it first casts a shadow; add a dedicated warm-up render only if a real device trace shows a visible stall.
