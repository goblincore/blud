# Light layers and the owner's look — hand-off, 2026-09-28

**Branch:** `claude/night-train-9-27-handoff-d270c3` (worktree `system-resources-cleanup-078e59`), merged to local
`main` at the end of the session and pushed (`d401dddf`). **Previous hand-off:** [2026-09-27](../2026-09-27-night-train-handoff.md).

## The decision

After playtesting against the melee branch (`claude/melee-weapon-design-7d1423`, base `40619045`, before the
dynamic light and the shared list), the owner settled the body lighting:

- **No flashlight:** the shared light list on, "torch through the list" on — the list's dominant light keys the body.
- **Flashlight lit:** the list on, "torch through the list" OFF — the old per-pixel beam (falloff across the body,
  whitening shoulder) keys it, and the list adds the other lights. The final S-curve off.

That is the shipped default now: **every light layer on except "torch through the list" and "final S-curve"**, with
"torch through the list: off" only taking effect while the torch is lit (`torchLane(ctx)`).

## LIGHT LAYERS (`light-layers.ts`, panel `light-layers-panel.ts`)

Every change to how bodies are lit since `40619045` sits behind a switch. The **LIGHT LAYERS** panel (top-left,
under the HUD; H hides it) toggles them live; its bottom line reproduces the state as `?layers=`.

| key | what | since |
| --- | --- | --- |
| `list` | each body lit by its own 4 strongest lights, with presentation profiles | 6540bd05 |
| `listTorch` | with the torch lit: on = the torch is a list light (chest-judged, pink tail, white clip); off = the old per-pixel beam under the list | 83dcd38c, d88c7bb7, 2742f5c8 |
| `presentKey` | old path: the lamp keys the body from the viewer's side, back rim, lightning rim | deba3ea3 … 2b6761cb |
| `roomFill` | Doom 3 dark: fill and probe follow the room's live lamps | fafdc730 |
| `stormKey` | cold base key on storm levels (reload) | ee87176d |
| `bodyFog` | bodies take the range fog | 5ba4e40d |
| `sCurve` | final S-curve 0.25, pivot 0.18 | 80946978 |
| `skinDetail` | detail-preserving shoulder, soldier k 1 | 032f3878 |

- `?layers=none` is the melee look ([all-off-vs-melee.png](all-off-vs-melee.png): mean |diff| 2–6 vs 7–11 before);
  `?layers=all` is everything; no param is the owner's pick. `?lightlist=0|1` still forces the list.
- **The hybrid torch** (`lightListCfg.z = 1`): `flashlight.wgsl.ts` runs under the list, `bodyLights(…, skipBeam)`
  skips the torch's slot, all four picks add without taking the key, and compose's old shoulder applies. At z 0 the
  shader is inert (march-hash pin reproduced).
- **Gates pin the pre-switch look** with explicit params: march-hash and the disco/train gates boot `?layers=all`,
  the light gate all but `sCurve` (its bounds predate it). `LIGHT_LAYERS=` overrides.
- Seams: `layers()`, `setLayer(k, on)`, `lightLayersPanel(on)`, `bodyListLanes()`, `setListLook({ floor, viewBias,
  backRim, secondary })` (live list-profile scales; tried as a "middle ground", it only darkened tube-lit bodies —
  [list-middle-ground.png](list-middle-ground.png)). A "stronger main light" gain was tried and reverted (no clear win).

## Also this session

- `npm run dev` opens the Night Train; the ring testbed (`/sdf-game.html`) is in **god mode** by default (`?god=0`).
- **Warbull** (goblincore/blud#23, both drafts) merged locally; its kit palette had `metal=/rough=/emit=`, which real
  WAM rejects — stripped, kit rebuilt ([warbull-second-draft.png](warbull-second-draft.png)).
- **Torch white clip** (driven by the torch's own share of the light), trim 0.43 → 0.65; only acts with `listTorch` on.
- **Skin detail** prototype: zombie off, soldier k 1 ([skin-detail.png](skin-detail.png)); cavity rejected (blotches).
- **Ring orbs** at half power (`RING_ACCENT_SCALE` 0.5) ([ring-orbs.png](ring-orbs.png)).
- **S-curve** built pivoted low (0.18): these frames sit dark, a mid-grey pivot only dimmed them ([s-curve.png](s-curve.png)). Off by default.
- **march-hash re-pinned** (default 2daf514e / quad 55ed3dfc / per-body ee9ae359) after bisecting four intended moves;
  the old pin was already stale on main (the 09-27 flashlight commits).
- **Boiler Room 8 × 28 m** built through the real pipeline (kit arch rise scales above 4.2 m; every existing kit mesh
  identical), JSON verified (room 5 bigger, tender and cab 8 m north, the rest unchanged), level test updated.

## Open

1. **Boiler Room resize, Task 3:** `sdf-disco-check.mjs`, `sdf-game-train-gate.mjs` and the light gate's Boiler Room
   poses still hard-code the old room 5 (x ±2.1, z −90…−110). Then the look/cost check (plan Task 4).
2. **Beacons with the owner's default:** check the red beacon sweeps read on bodies after the strobe.
3. **Light gate, unexplained:** the `?lightlist=0` comparison boot's gibs under the torch read 0.296 (0.163 on an earlier
   run); the check passes.
4. **Optimisation — parked** (owner: the resize first). 256² tube shadow maps are approved; baking the static art
   into the shadows is the favoured bigger win. Full menu: [optimisation-strategies.md](optimisation-strategies.md).

**Next session: the Boiler Room resize, Tasks 3–4** — start at the plan's "Next session starts here" block.

## Gotchas

- Headless captures: treat a missing `window.__warmGate` as NOT ready (cold compiles showed the loader); the torch's
  wall pool lags one placement in hand-stepped captures — step again before shooting.
- A kit rebuilt with `--out` elsewhere keeps texture paths relative to that folder; build `kit.blend` in place.
- Load average matters: march-hash's background compiles "failed" and the light gate's gib floor flaked at load ~18.
