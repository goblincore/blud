# Tesla arc: the zap state — build notes

2026-11-17. Plan: `docs/superpowers/plans/2026-11-17-tesla-1-zap-state.md`.

## Task 4: the glow on the flesh

The glow rides `burnCfg.w` per view and `REC_BURN.w` per crowd record, signed (negative = bones inverted).
`ZAP_BLOCK` (trace post, after the burn block) gathers the terms into the private `gZap`; `ZAP_LIGHT_BLOCK`
(end of the lighting tail) mixes the lit colour toward the flat glow. `game-zap.ts` copies each actor's
`zapLook()` to its view after the burn step.

### The trace (`node scripts/zap-trace.mjs`)

Arena, one zombie about 2.6 m away in the flashlight, `__sdfGame.zapActor()`, a sample every 0.25 s of sim
time (15 steps of 1/60 s) for 4 s. Numbers from the last run (`zap-trace.json`); three runs agreed to within
a few luminance units.

| t (s) | phase | glow | char | centre 30% luma | chest box luma |
| --- | --- | --- | --- | --- | --- |
| before | none | – | – | 74.70 | 197.72 |
| 0.25 | zapped | 0.735 | 0 | 84.89 | 227.49 |
| 0.50 | zapped | 0.931 | 0 | 81.55 | 222.61 |
| 0.75 | zapped, inverted (a jolt) | 0.697 | 0 | 43.35 | 75.30 |
| 1.00 | zapped | 0.638 | 0 | 101.98 | 228.32 |
| 1.25 | zapped | 0.969 | 0.026 | 95.96 | 218.65 |
| 1.50 | zapped | 0.789 | 0.376 | 88.61 | 222.68 |
| 1.75 | zapped | 0.559 | 0.828 | 84.76 | 218.28 |
| 2.00 | statue | 0 | 1 | 59.26 | 149.72 |
| 2.25 | statue | 0 | 1 | 60.09 | 152.02 |
| 2.50 | statue | 0 | 1 | 61.38 | 155.01 |
| 2.75 | statue | 0 | 1 | 60.60 | 153.28 |
| 3.00 | none (dead, falling) | 0 | 1 | 46.43 | 111.98 |
| 3.25 | none | 0 | 1 | 32.41 | 81.35 |
| 3.50 | none | 0 | 1 | 25.24 | 24.83 |
| 3.75 | none | 0 | 1 | 25.28 | 24.83 |
| 4.00 | none | 0 | 1 | 25.36 | 24.96 |

- Pipelines (`pipelineLog().totalPipelines`): 120 before, 120 after (121 and 121 in the two earlier runs).
  The zap compiles nothing.
- **The plan's 1.5x on the centre crop is not met: 1.20x** (mean of the six un-inverted zapped samples
  against the frame before). Two reasons, both about the measurement: the arena zombie stands in the
  flashlight with a chest luminance of 198 of 255 before the zap, so nothing can be 1.5x brighter; and at
  2.6 m the centre 30% crop is mostly the dark room, with the star's raised arms outside it. The script
  reports that ratio and gates on a chest box instead (6% x 11% of the frame, flesh only): every un-inverted
  zapped sample is brighter than before (min 218.28 against 197.72, mean 1.13x) and the colour turns from
  warm to blue-white (blue minus red: -23.7 before, +22.8 zapped).
- The last crop is darker than the first (25 against 75), but that is the empty room: the statue has
  fallen out of the crop by 3.5 s. The statue itself, standing, has a chest luminance of 152 against 198.

### What the frames show

- Zapped: a flat blue-white figure in the star (arms up and out, legs under it), edges clipped to white,
  no shading, wounds or face visible. The eye glow is gone under it. No skeleton (Task 5).
- The jolt at 0.75 s: the flesh goes DARK grey, dimmer than the unzapped body. That is `gZap.y` swapping
  flesh and bone colours; with no skeleton drawn yet the frame reads as the glow switching off for a
  moment. It needs Task 5's bright bones to read as an inversion.
- Statue: a dark brown charred figure holding the star, still carrying bright specular highlights from
  the flashlight (the burn block's char look at burn 0). Not ash-grey.
- From 3.0 s the dead statue falls over backward as a ragdoll; the last frame, looking down, shows the
  charred corpse on the floor.

PNGs under `docs/dev-notes` are gitignored; the script rewrites them and the contact sheet on each run.

### Boot time (`node scripts/boot-time.mjs`, fresh Chrome profile each run, interleaved)

| run | branch `drawOnce` (ms) | `main` `drawOnce` (ms) | branch warmMs | main warmMs |
| --- | --- | --- | --- | --- |
| 1 | 974.9 | 981.8 | 24308 | 23783 |
| 2 | 1022.3 | 1092.0 | 1394 | 1517 |

`main` was the primary checkout at e8fb57110 (ahead of this branch's base c7242cfb6). The branch is inside
`main`'s run-to-run spread. The drop in warmMs between run 1 and run 2 is on both checkouts.

### Departures from the plan's code

- `prim-material.wgsl.test.ts` pinned "primGlow is assigned exactly three times"; the zap fade is a fourth,
  so the pin is now four and names both fades.
- `ZAP_LOOK` colours are written through the float formatter (`1.0`, not `1`) in the WGSL.
- `zaps()` also returns `invert`, which the trace needs to tell a jolt from the glow.
