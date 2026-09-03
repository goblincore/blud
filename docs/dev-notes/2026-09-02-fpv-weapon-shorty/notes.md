# The goblin sawed-off — captures and gates

**Date:** 2026-09-02 · **Branch:** `dispatch/2026-09-02-fpv-weapon-task-8` · **Status:** all 8 plan tasks done, gates green
**Spec:** `docs/superpowers/specs/2026-09-02-fpv-weapon-overhaul-design.md` · **Plan:** `docs/superpowers/plans/2026-09-02-fpv-weapon-overhaul.md`

## What shipped

`sdf-game.html`'s view-model is the break-action sawed-off double
(`shorty-double.glb`, procedural, from `scripts/model_grapeshot_shorty.py`)
with goblin-matched hands and forearms, a muzzle flash that lights both the
level (one `PointLight`) and the marched SDF bodies (a bias folded into the
per-actor beam replay), and a 2-shell, six-beat, ~0.95 s Doom-rhythm reload
whose break hinge is a code-driven rotation of the GLB's `Barrels` node about
the `Hinge` locator. View-model timing lives in the pure, unit-tested
`game-viewmodel.ts`; the Three.js wiring stays in `game-main.ts`.

## Gates — all green (2026-09-02)

Full suite: **`npm test` = 2764 tests, 2757 passed.** The 7 failures are the
documented pre-existing environmental failures in
`scripts/blob-measure.test.ts` (they fail identically on `b771ab8`, per
`TASKS.md`; not touched here). `npm run build` (`tsc --noEmit && vite build`)
clean.

Model asset gate — re-run fresh for this note, exit 0, GLB byte-identical to
the committed export:

```
[shorty] exported .../public/assets/lab/shorty-double.glb (244220 bytes)
[shorty] verify: {'tris': 11906, 'missing_nodes': [], 'barrel_descendants': 18}
[shorty] OK
```

Runtime gate — `scripts/sdf-game-shorty-gate.sh` on the default port pair
5281/9281, exit 0, ten shots written into this directory. Every check passed:

1. **Boot** — `backend=webgpu`, zero console errors, `anchorChildren=5`.
2. **The gun** — `viewModelAnchor` present, `Barrels` node found under it
   (a missing GLB or a lost export grouping throws at boot).
3. **Flash** — `flashVisible` true on the shot frame, false 300 ms later
   (`flash-on.png` / `flash-off.png`).
4. **The bodies** — `spotCfg.x` **1 → 3.2073** on the flash frame
   (`flash-zombie.png`); the PointLight cannot touch this uniform, so the
   rise is the beam-replay bias working.
5. **Reload** — two shots empty it (`shells 2 → 0`), the hinge peaks at
   **0.610 rad** (~35°, the `RELOAD.openRad` constant) across the six
   hand-stepped beats, and the gun returns to a shut, loaded rest on its own
   (`shells 2`, hinge 0 rad). Frames: `reload-{120,260,400,550,740,900}.png`.

Captures in this directory: `fpv-rest.png` (rest pose), `flash-on/off.png`
(flash envelope), `flash-zombie.png` (bodies lit by the flash), and the six
`reload-*.png` beats. The five model-script previews (`left`, `threequarter`,
`rear34`, `detail`, `fpv`) are from Task 1.

## ⚠ The flash's uniform borrow is TEMPORARY

The flash lights the marched bodies by **borrowing the flashlight's
`spotCfg` / `spotColor` uniforms** inside `handle.setDrawFn`'s per-actor beam
replay (`game-main.ts`): it raises the intensity gate (`spotOn + 6·fv`),
widens the cone (subtracts from both cosines — a wider cone is a SMALLER
cosine) and pushes the colour warm. This is **deliberately temporary**,
pending a **second light slot in the march** (`march.wgsl.ts`), which cannot
land while the sdf-render-perf-r2 chain is rewriting that file — the borrow
exists specifically to avoid that collision. See the spec's "Deferred". When
the second slot lands, the bias moves out of the replay and into its own
uniform set; nothing else here depends on it.

## Owner look gate (pending)

Per the plan, the owner still needs eyes on the FPV framing and the reload
strip before this becomes the default or merges — the pose numbers are the
model script's preview constants and are expected to need one live tuning
pass.
