# Lower march resolution: what was tried, what was measured, what the owner judged (2026-09-22/23)

**Question.** Can the bodies march at 0.25 (−38 % `sdf:march`, measured) and still look like today's 0.5 + t16?
**Answer so far: not with hand-built reconstruction.** Every approach either looked wrong or cost more than it saved.
The follow-up the owner wants to try later is a **trained network with temporal inputs** (see the end).

Owner rules that shaped every step: judge by eye in play, not by metrics ("similarity numbers" misled more than once);
the footprint hit tolerance (`setAa`/`setAaDistance`) is a perf side-effect and is OFF for quality captures/probes.

## Timeline

| # | Approach | Result | Where |
| --- | --- | --- | --- |
| 1 | Offline probe: 0.25 bilinear vs 16× truth | Inside of the body holds up; edges are the problem. The pale fat halo at 0.25 was the HIT TOLERANCE (sized to one march pixel, ×6 near), not the upscaler | `scripts/upscale4x-probe.mjs` |
| 2 | 0.35 plain (half the rays) | Owner: "closer to 0.25 than 0.5", not good | `upscale4x-sheets.ts` |
| 3 | Hybrid: coarse + real full-res rays on edges/seams/face (offline splice) | LOOKED right (owner: 0.25 ≈ 0.35 ≈ 0.5), but measured **NO-GO**: hard pixels are 23–28 % of the crush and the most expensive rays → ~20–26 ms vs today ~10.4 | `upscale4x-splice.ts`, `HYBRID-TIMING-PLAN.md`, melee `MELEE_HYBRID_EST=1` |
| 4 | Per-pixel object motion vectors (prev prim rows + inverse restPoint) | Works; limbs, feet planted = 0, debug mode 16 | commit e7aa65b9, `MOTION-VECTORS-PLAN.md` |
| 5 | Accumulation v2 at 0.5 (object motion + depth validity + clamp) | Ghost smearing GONE ("the v2 version is great"), but alone worse than 0.5 + t16 (jaggies, soft) | commit 18292bcc |
| 6 | Checker reconstruction: 0.25 jittered through a fixed 2×2 cycle → exact 0.5 grid → t16 | Still: matches a 0.5 march. Motion: shimmer, then blockiness, then stair-step close edges, through 4 iterations | commit 648a7baf (parked, flags only) |
| 7 | Distance split (owner idea): < D checker, ≥ D real 0.5 rays (far pass) | Transition invisible; medium/far fixed. Close edges still "not clean or good enough to ship" | same commit |

## What each checker iteration taught

- **Direct sample returned outright** → 4-frame flicker: in rejected blocks one exact pixel sat beside three soft fallback
  pixels, rotating each frame, and t16 sharpened the pattern.
- **Consistent fallback + drifting kept pixels toward the fill** → the whole image settled at 0.25 detail (the fresh
  sample only pulls back one frame in four). Kept pixels must HOLD.
- **Nearest history fetch** → compounding stair-steps under sub-pixel motion. Catmull-Rom history fixed the blockiness.
- **Coverage tied to colour validity** → silhouettes fell back to 0.25 steps (the background behind an edge always fails
  the depth test). Deciding coverage separately (fresh pixel exact; band pixels from motion-reprojected history, not
  depth-gated) improved it — still not shippable up close.
- History rejection was NOT the problem (debug view mostly kept, not red).

## Measured costs (melee crush, quiet, clean phase, tolerance off unless noted)

`sdf:march`: ship 0.5 (tolerance on) 9.8 ms · 0.5 10.6 · 0.35 7.2 · 0.25 6.0 · 1.0 33.1. t16 ≈ 0.6 ms.
The checker/stack/split itself was never timed (the look failed first).

## Traps found (each cost time)

- `readMarchTarget` re-renders a frame (`step(0)`), so it always reads ZERO motion: verify motion in the live loop.
- The agent's own game tab running during the owner's cold compile made the owner's Chrome LOSE THE WEBGPU DEVICE.
- A probe that never calls `process.exit` hangs forever on its CDP socket; chained `&&` steps never run.
- `debugCfg` is a vec2 (no `.z`); nothing compiles WGSL offline, so a bad swizzle only shows in the browser.
- The shipped model loader forces `sdfScale` to 0.5 (`applyUpscaleAbMode`); the stack must halve it.
- `setTemporalAccumCfg({})` resets history: use the `checkerAccum` getter to read state.
- Mode 11 `.r` is the BODY INSTANCE (`gHitSlot`); the prim id is `.b` (`hitBest`).

## Follow-up (owner, 2026-09-23): trained network with temporal inputs

t16-style, fed the current 0.25 frame + motion-reprojected history + motion vectors + disocclusion/validity mask, trained
against 0.5 + t16 (or 16× truth) on captured MOTION sequences, so it learns what to trust instead of hand rules.
Everything it needs as INPUT already exists behind flags: object motion vectors (`marchMotion` attachment), the checker
history on the 2× grid, the far/near split. The capture side exists (`scripts/upscale-capture-v2.mjs`, `nupscale`);
it would need motion sequences and a TS twin of the new model.
