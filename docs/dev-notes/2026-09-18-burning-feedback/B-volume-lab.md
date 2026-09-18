# B — Volumetric fire + smoke in the flame lab (round 2, task 4)

Date: 2026-09-18. Branch: `dispatch/2026-09-18-burning-fire-volume-lab`.
Spec: `docs/superpowers/specs/2026-09-18-burning-feedback-pass-design.md` §B.
Plan: `docs/superpowers/plans/2026-09-18-burning-feedback-pass.md` Task 4.

## What shipped

A low-res **volumetric fire + smoke march** fed by each burning body's own
posed capsules, composited under the existing flame cards, wired as a post-aa
pass on the screen-space-tongue seam.

| File | What it is |
| --- | --- |
| `fire-capsules.ts` | pure: fattest flesh prim per limb + head crown + per-capsule midpoint velocity |
| `fire-volume-tuning.ts` | the `FIRE_VOLUME_TUNING` record, `FIRE_VOLUME_BOUNDS`, `resolveFireVolumeTuning` |
| `fire-volume-pack.ts` | nearest-first body ranking, `Float32Array` packer, `fireLagOffset` |
| `fire-volume.wgsl.ts` | march / resolve / composite WGSL + `FireVolumeFrame` |
| `post-aa.ts` | `setFireVolume(on, frame)` / `setFireVolumeData(buf)`; four draws on the tongue seam |
| `flame-lab-main.ts` | technique `'volume'`, capsule packing, `VOLUME` panel record, `run` fixture, `__flameLab` access |
| `flame-panel.ts` | `VOLUME` slider section (one row per `FIRE_VOLUME_TUNING` field) |
| `flame-cards.ts` | `maxCardsPerBody` + `limitFlameCards` (evenly spread accents) |
| `scripts/flame-capture.mjs` | `--fixture run`, GPU cost mode (`--cost`), boot-failure diagnostics |

The pass is **four draws**, each into its own target so nothing samples what it
writes:

1. `post:fire-march` — low-res (`resolutionScale`) rgba16f; view ray from the
   inverse view-projection, ray/AABB over the packed capsules, scene-depth stop,
   per-pixel/per-frame jittered start, 32 steps, shared curl warp, Blood-palette
   emission + soot transmittance.
2. `post:fire-resolve` — full-res; bilinear upsample, previous-view-projection
   reprojection through the scene depth, 3×3 min/max history clamp.
3. `post:fire-composite` — `scene * T + emission` into its own target.
4. `post:fire-copy` — raw copy back into the capture.

Off never binds a material (the all-off parity test stays exact). `steps = 0`
early-outs the march with no pipeline change.

## Field tuning corrections (deviations from the plan's first pass)

The plan's field produced a **solid saturated orange AABB wall** on the first
capture (frame above / first screenshot). Two additions fixed it:

- **heat gate**: `emission` is multiplied by `smoothstep(0.08, 0.5, temp)` so
  the `exp(-d/0.06)` tail cannot accumulate a red haze along a long AABB path;
- **self-absorption**: `T *= exp(-(soot*sootGain + temp*1.4) * stepM)`, so a
  grazing ray through the dense core cannot accumulate unbounded emission.

`tempGain` default is **0.7** (plan said 1.6): at 1.6 the core clipped to white
even with the gate. Both changes are documented in the WGSL.

## Captures

Directory: `docs/dev-notes/2026-09-18-burning-feedback/captures/`.

- `volume-{stand,walk,close}-{fresh,charred}.png` and `volume-contact.png` —
  1380×820; the contact sheet ends with the three Blood reference tiles.
- `volume-run-live-*.png` / `volume-run-stop-*.png` — the run fixture
  (fixed side camera at 6 m, `lag 0.9 / lagMaxM 1.1`).
- `cards-*` — the cards-technique baseline shot the same way.

What the images show (the pass's own luma std, from the capture log):

| capture | luma std |
| --- | --- |
| `volume-stand-fresh` | 38.31 |
| `volume-stand-charred` | 32.80 |
| `volume-walk-fresh` | 38.52 |
| `volume-close-fresh` | 62.32 |
| `volume-run-live-fresh` | 19.11 |

- The flame reads as **one continuous mass** around the body — no repeated card
  tiles, no card rectangles. `close` shows the volume as a fused shell.
- **Smoke rises dark above the fire** (visible as the dark plume in the `close`
  and `stand` frames) — the soot band starts at `0.4 * rise` and fades by
  `sootRise`.
- The cards survive as accents (`cardsPerBody 5`, evenly spread, enlarged ×1.35 /
  softened ×1.8), so the crisp Blood licks sit on top of the field.

### Run-trail: measured, and too weak to claim

The run fixture lights one body, hides the other (body **and** kit/prop — the kit
attaches to the scene, not `gpu.object`, which is why the first run captures had
a gun floating on a hidden soldier), parks a fixed 6 m side camera, and zeros the
wander idle pause so the body keeps moving.

Live vs stop frame change, measured (`volume-run-{live,stop}-fresh.png`,
1380×820): **mean abs RGB 0.19, 0.37 % of pixels changed** — far too small to
call "the flame trails behind and straightens when the body stops". The body
sits at nearly the same screen position in both frames, so the lag never got a
clean moving frame; the wander policy's target picking kept the run near
stationary despite the idle-pause zeroing. The **formula** is implemented and
unit-tested (`fireLagOffset`; the WGSL string test pins `lag * h` and the
`lagMaxM` clamp), and the live frame's plume does extend slightly further
down-left than the stop frame's, but that is not a measured trail. Round 3
should script a straight-line dash with a known heading and a perpendicular
camera, or record a burst across a target switch.

## Cost (step 12)

`npm run flame:capture -- --cost <dir>` measures the four labelled fire passes
with the lab's WebGPU timestamp queries (medians over ~60 frames) and writes
`cost.json`. Bodies replicate the burning capsules (`setFireLoad`). The lab has
two bodies, so 4/8 are emulated by the capsule count, not by spawning actors —
the march cost is the capsule loop, which is exactly what this varies.

**Caveat, stated up front:** the capture runs in headless Chrome on the CI/dev
path, not the owner's GPU. `wall_on`/`wall_off` were pinned at 16.6–16.7 ms
(vsync), so the wall-time fallback gives no delta; the timestamp split below is
the only signal, and it is likely software/slow-path inflated. Treat the
absolute ms as an upper bound, not the owner's-machine figure.

| scale | bodies | march | resolve | composite | copy | total |
| --- | --- | --- | --- | --- | --- | --- |
| 0.5 | 1 | 2.64 | 2.68 | 2.64 | 2.67 | 10.63 |
| 0.5 | 4 | 3.26 | 3.36 | 3.36 | 3.30 | 13.28 |
| 0.5 | 8 | 3.80 | 4.03 | 4.02 | 4.02 | 15.87 |
| 0.25 | 1 | 2.58 | 2.57 | 2.60 | 2.58 | 10.33 |
| 0.25 | 4 | 3.97 | 4.13 | 4.11 | 4.12 | 16.33 |
| 0.25 | 8 | 4.01 | 4.10 | 4.08 | 4.06 | 16.25 |

(ms; medians of per-frame timestamp samples.)

**Budget: ≤ 2 ms at 4 bodies / 0.5 scale — MISSED here** (13.3 ms total; the
march alone is 3.3 ms). What dominates is **not** the capsule loop: the march
grows only 2.6 → 3.8 ms from 1 → 8 bodies, while the three **full-res** passes
(resolve + composite + copy) cost ~10 ms and do not shrink at 0.25 scale (they
are full content-size regardless of `resolutionScale`), which is why the 0.25
total (16.3 ms) is no better than 0.5.

If the budget must hold on the owner's machine, the order to attack is:
1. drop the `copy` draw and composite directly into the capture with
   `One, SrcAlpha` blending (saves one full-res pass + `fireOut`);
2. resolve at `resolutionScale` and upsample in the composite (moves 2 full-res
   passes to low-res);
3. only then trim `steps`/`resolutionScale`.

## Still looks off

- **Budget** (above) — the biggest open item.
- The march at 0.5 scale reads **blobby** at close range (capsule shells
  upsampled), not like the reference's crisp licks; the cards carry the detail.
- The AABB's `sootRise` padding marches a lot of empty space; a tighter soot
  band or a real capsule-bin scheme (the wildfire teardown's `binSlots`) would
  cut the march cost.
- No first-ignite pipeline stall was measured here (the lab boots the technique);
  round 3 owns the warm-up check in the game.

## Console / capture surface

- `__flameLab.setVolume(partial)` / `volume()` / `state().volume` — live tuning.
- `__flameLab.fixture('run'|'stop'|'stand')` — the run fixture.
- `__flameLab.setFireLoad(n)` — the cost probe's capsule replication.
- `__flameLab.passTimings()` / `frameMs()` — GPU per-pass ms and wall frame ms.
- `__flameLab.capture(burn, char, only)` — `only` pins a single body (the run
  fixture needs one burner).
