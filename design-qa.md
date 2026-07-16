# Three.js launch shell — design QA

## Target and evidence

- Approved design source: [Yurisachan Launch UI in Figma](https://www.figma.com/design/Lw4zx7YhR7Rx8TPV3pwRh9)
- Visual-language reference supplied by the user: preserved in the combined comparison evidence below.
- Combined reference/implementation comparison: [yui-reference-vs-launch-loading.png](output/design-qa/yui-reference-vs-launch-loading.png)
- Portrait state contact sheet: [mobile-state-contact-sheet.png](output/design-qa/mobile-state-contact-sheet.png)
- Implementation snapshots: `tests/e2e/genshin-launch-visual.spec.ts-snapshots/`

The approved Figma contract is the implementation target; the yui540 capture is used only to verify the restrained warm-paper visual language. The Three.js scene itself remains governed by the upstream `www-genshin@090cb90` reference and is outside this shell-only design pass.

## Viewports and states checked

| Viewport | Loading | Ready | Gate-ready | Hero handoff |
| --- | --- | --- | --- | --- |
| 1440 × 900 | checked | checked | checked | checked |
| 390 × 844 portrait host rotation | checked | checked | checked | checked |

## Final comparison findings

- Typography: passed. Local Noto Sans SC 300/400/500 is used consistently; the former generic/browser glyph treatment is gone.
- LoadingCard: passed. The 420 × 230 paper card, 56 px brand mark, restrained tracking, 2 px progress line, solid diamond endpoints, percentage and plain Escape hint match the approved hierarchy.
- UtilityDock: passed. The 52 × 148 dock contains three 44 px controls in skip/mute/source order, appears as a unit after two seconds, and uses official Lucide assets rather than text glyphs.
- Primary controls: passed. Ready uses the 64 px circular filled-Play control; gate-ready uses the 320 × 52 inner pill inside the 96%-wide hit area. Both disappear during entering.
- Color and depth: passed. Warm paper, ink grey, subtle borders and compact shadows match the Figma tokens and the yui540 reference language without obscuring the scene. Small muted text clears 4.5:1 on paper, while the two-tone paper/ink focus ring remains visible across both the control surface and the full sky gradient.
- Responsive composition: passed. Portrait rotates the complete launch stage by -90 degrees and remaps safe-area insets; the blog returns to its normal portrait layout after finalization.
- Interaction and accessibility: passed. Hidden controls are inert and excluded from focus, labels stay descriptive, progress exposes `aria-valuenow` and `aria-valuetext`, pressed/focus states survive hover, and Escape remains active from the first frame.
- Scope safety: passed. Scene timing, camera, road/door animation, PJAX handoff, Live2D suspension and idempotent finalization were not redesigned by this UI pass.

## Iteration history

1. Replaced the provisional single-character controls and glassy central CTA with the approved component structure.
2. Added local Noto Sans SC subsets, warm-paper tokens, measured geometry and explicit state visibility.
3. Replaced text/approximate icons with licensed official Lucide and Font Awesome assets.
4. Corrected the portrait rotation direction and safe-area mapping, then regenerated loading/ready/gate-ready visual baselines.
5. Compared the reference and implementation together and checked all desktop/mobile state captures for typography, spacing, alignment, radius, shadow and control placement.

final result: passed
