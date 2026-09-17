# Task 1 — Exposure contract and sampled lab reference

Branch: `codex/shutter-blur-task-1` (isolated dispatch worktree)
Base: `761cf8d3` (merged HEAD)
Task: extend `/sdf-blood-compare.html` with a Shutter mode; no game integration, no default flips.

## What landed

Pure, GPU-free core (the testable heart):

| File | Contract |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/shutter-timing.ts` | Fixed-second exposure: `SHUTTER_PRESETS` (off, 1/240, 1/120, 1/60, 1/30), `angleToExposureSeconds(angle, referenceFps) = angle/360/referenceFps`, `resolveExposureSeconds`, `trailingInterval`, `streakPixels = speedPxPerSec*exposureSeconds`, `clampSampleCount`, `effectiveExposureSeconds`. No render delta anywhere. |
| `src/lab/sdf-zombie/webgpu/shutter-timeline.ts` | Deterministic, identity-preserving timeline. `recordTimeline({dt, duration, keepFrom, sim, step})` records timestamped snapshots from a **scratch** sim; a `WeakMap` gives each droplet a stable id so a reused slot gets a NEW id; births, floor contacts, expiries and evictions are classified against the predicted next step. `particlesAt(timeline, t)` linearly interpolates only particles present in BOTH bracketing frames. `eventsInRange`. |
| `src/lab/sdf-zombie/webgpu/shutter-reference.ts` | Box-filter `planShutterSamples(now, exposure, n)` (N equal-weight midpoint samples in `[now-exposure, now]`); selected/static `splitSimForShutter`; `movingSimAt`; `simFromParticles`; working-linear premultiplied accumulate/average/composite math; `SHUTTER_REFERENCES` (efficient `implemented: false`); projection parity probe. |

Small reusable render API:

- `goo-layer.ts`: new `renderLayer(camera, target): boolean` renders the density + blur + a **premultiplied layer material** (colour `lit*cov`, alpha `cov`, Additive/One-One, depth-test on, depth-write off). It never draws the scene and never calls `between`. New reference-only `makeLayerMat` sits beside the surface materials; the shipped `render()` path is unchanged.

Lab page (`webgpu/blood-compare-main.ts`), new independent `mode` axis (surface/shape controls retained):

- `mode = Surface/shape | Shutter`; entering Shutter resolves the Current sim.
- `reference = Sharp | Sampled | efficient (DISABLED, "unavailable until task 2")`. The API rejects `setShutter({reference:'efficient'})` rather than aliasing it.
- Exposure presets with ms, plus angle mode with an **explicit reference fps** (never the measured frame rate).
- Sample-count slider, max-streak-px slider, and a live `effective exposure N ms · K samples` label.
- Repeatable fixtures via production emitters: `burst`, `jet`, `overlap`, `landing`, new `bleed` (slow pellet dribble), `trail` (`emitTrails` from a 6 m/s crossing source), `crossing` (two opposed `stump` streams with distinct stream ids). Obstacle toggle retained.
- Sampled reference: `splitSimForShutter` → sharp half (fixture + static pools/guts, mist/ribbons sharp) into `refScene`; N per-sample `movingSimAt` → `renderLayer` into half-float `refAccum` with the frozen fixture depth (`scene.overrideMaterial = depthOnly`, colour writes off); one composite `scene*(1-a/N) + rgb/N`. Density is never combined across times.
- **Zero exposure routes to the fused sharp render** for both reference selections, so off is the existing frame exactly.
- `__bloodCompare.setMode`, `setShutter`, `shutterState`, `state().shutter` (exposure seconds/ms, sample times, interval, last sample/budget, `candidateAvailable:false`).

## Verification (exact commands and results)

```
npx tsc --noEmit
  -> exit 0

npx vitest run \
  src/lab/sdf-zombie/webgpu/shutter-timing.test.ts \
  src/lab/sdf-zombie/webgpu/shutter-timeline.test.ts \
  src/lab/sdf-zombie/webgpu/shutter-reference.test.ts \
  src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts \
  src/lab/sdf-zombie/webgpu/goo-layer.test.ts
  -> Test Files 5 passed (5); Tests 201 passed (201)
```

Covered by tests: preset seconds and ms; `angle/360/fps`; trailing interval; constant-velocity streak table (600 px/s → 2.5/5/10/20 px at 1/240…1/30); cadence independence at 30/60/120 (sample plan and reconstructed motion identical, no fps input); zero exposure collapse; birth/death/contact classification; reused-slot new-identity and no long spurious vector; timeline determinism; selected/static split; normalized premultiplied average (two half-covered samples average to 0.5, not 1); projection parity; the page's shutter tripwires and the disabled efficient candidate.

GPU (WebGPU, headless Chrome 152, own vite 5433 / CDP 9433, own profile, no unsafe flags):

```
node scripts/shutter-lab-capture.mjs 5433 9433 docs/dev-notes/2026-09-16-shutter-blur/evidence
  -> WebGPU probe: ok
  -> page booted; backend = webgpu
  -> zero-exposure parity byte-identical: true (25155 bytes)
```

Evidence in `docs/dev-notes/2026-09-16-shutter-blur/evidence/` (PNG + `state.json` per shot):

- `00-zero-exposure-sampled` and `01-zero-exposure-sharp` are **byte-identical** PNGs: exposure-off parity holds even through the sampled selection.
- `02-sharp-1-30` is also the same image: Sharp ignores exposure.
- `10-angle-180-at-60fps` reports `exposureMs = 8.33` — the same seconds as `03-sampled-1-120`, confirming the angle equation end to end.
- `05-sampled-1-30` shows the moving blood at the same screen position as the sharp frame with a visible exposure smear; `livePos` vs `samplePos` in `state.json` agree to ~2 mm.
- Orientation is **asymmetric and correct**: the obstacle sits at world +x (right of frame) in every shot; the fixture is not mirrored.

### Orientation bug found and fixed during GPU verification

The first capture showed the sampled composite vertically mirrored against the sharp half (visible in `12-wipe-*` as the capsule at two different heights). Cause: the reference textures land in an offscreen target with the opposite Y orientation to the canvas blit path. Fix: the composite samples `refScene`/`refAccum` with Y inverted (`vec2(uv().x, 1-uv().y)`). Post-fix, `11-sampled-near-zero-angle` matches the sharp frame's position and the wipe halves align. This is recorded because it is a real trap for Task 2's layer extraction.

## Honest limitations / remaining work

- **Moving/static topology split.** The reference reconstructs selected moving blood and static pools/guts in separate density fields, so a droplet overlapping a pool does not metaball-fuse with it. Zero exposure bypasses the split (fused sharp), so the difference is only visible at non-zero exposure. Task 2's single-pass candidate must preserve the fused boundary; this oracle cannot settle it.
- **Mist/ribbons are not exposure-sampled** — they stay sharp (the plan's independent fine-spray switch). The `trail` fixture therefore shows the production trail's own low-inherited-velocity droplets as near-discrete beads, not long streaks; fixture/velocity tuning is Task 3 review work.
- **Timeline semantics.** Particles absent from either bracketing snapshot contribute nothing at an intermediate time (conservative anti-spurious-vector choice → a partial-tick undercount at births/deaths). The last recorded frame is floored to the 1/60 grid; the live sim is exact at `eventTime`, so a ≤1/60 s endpoint difference is possible.
- **`max streak px` is display-only** in Task 1. The sampled oracle shades every sample; the cap belongs to the efficient candidate. The `efficient` entry is intentionally disabled and rejects API selection.
- **Cost.** The oracle renders N full goo chains plus a fixture depth pre-pass and is explicitly **not** the shipping frame cost; no performance measurement was attempted (out of scope for Task 1).
- **Visual acceptance is PENDING.** Captures exist and orientation/parity are verified, but no owner look and no quality claim. Game integration, default flips, flying-gib and actor work remain untouched.

## Reproducing the lab

```
npm run dev            # then open http://localhost:5173/sdf-blood-compare.html (WebGPU)
```

Controls: `mode` = Shutter; `scenario` = bleed / trail / crossing / burst; `reference` = Sharp vs Sampled (efficient disabled); `exposure` presets show ms; `exposure mode` = seconds or angle with an explicit reference fps; `samples (oracle)`; Play/Pause/Step/Replay; `wipe A/B` bounds Sharp (right) against Sampled (left). `__bloodCompare.state().shutter` records the exact exposure, sample times and budget beside a capture.
