# VHS post-processing for the SDF game — design

**Date:** 2026-09-09 · **Status:** approved in brainstorm
**Source of truth for the look:** `SoftPostFxPipeline.ts`, `soft` preset, from
`/Users/donny/Projects/2026/club-mutant/client/src/pipelines/`.

## Why

The owner is adding interlaced field rendering
(`2026-09-09-interlaced-field-rendering-design.md`), which produces a
deliberate comb artifact modelled on old digital video. A VHS grade makes that
artifact read as intentional rather than as a glitch — the interlace becomes
part of a coherent picture instead of an isolated defect.

The look is not being invented here. club-mutant already has a tuned pipeline
the owner likes, with three intensity presets. `soft` is the chosen one:

| | intensity | blur | noise | grade | warp | warpFreq | warpSpeed | chroma | chromaJitter | motionThresh | burstChance | burstStr | burstRate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **soft** | 0.7 | 0.45 | 0.04 | 0.55 | 1.25 | 1.5 | 0.25 | 0.6 | 0.6 | 0.12 | 0.02 | 0.6 | 12 |
| balanced | 1.0 | 0.35 | 0.07 | 0.60 | 2.5 | 2.0 | 0.35 | 2.5 | 1.75 | 0.08 | 0.08 | 0.9 | 18 |
| chaotic | 1.0 | 0.25 | 0.14 | 0.85 | 3.5 | 2.5 | 0.50 | 7.0 | 4.0 | 0.04 | 0.38 | 1.6 | 55 |

All three presets ship; `soft` is the default. The other two cost nothing to
carry and make the knob range meaningful.

## Scope: port whole, and take over temporal duty

Owner decision. The full `soft` term set is ported — blur included — and the
VHS pass becomes the single owner of temporal blending while it is on.

**Why blur is kept even though it fights the interlace.** Blur exists to soften
exactly what field rendering creates. That is a real conflict, and the
resolution is a knob, not a guess: every term is a live uniform, so the two
features get tuned against each other in play once both exist. Dropping blur
now would diverge from the look the owner already likes and remove the ability
to A/B it.

**The SMEAR handover.** `post-aa` already runs a temporal accumulation
(`smear`, default 0.25, max 0.6) and the C2 notes warn "measure half-rate with
smear 0; the smear is its own temporal filter". Stacking it under a VHS pass
that also samples the previous frame, on top of interlaced fields, is three
temporal filters compounding. So:

- While VHS is ON, the chain uses an **effective smear of 0**.
- The owner's `smear` SETTING is preserved, not overwritten — turning VHS off
  restores today's look exactly.
- `postAa.effectiveSmear` is exposed so diagnostics can say which filter is
  actually running.

## Architecture

A fourth stage in `post-aa.ts`'s existing chain, following its established
idiom (`POST_AA_*_WGSL` strings composed with `wgslFn`):

```
CAPTURE → FXAA → VHS → BLIT
                  ↑ replaces SMEAR while on
```

**Order is load-bearing.** VHS runs AFTER FXAA. FXAA-then-VHS degrades a clean
image, which is the intent. VHS-then-FXAA would antialias the artifacts away —
the opposite of the point.

**New:** `POST_VHS_WGSL` in a new `post-vhs.ts` (the term set is ~350 lines
ported; putting it in `post-aa.ts` would push that file past what it should
hold), plus `VHS_PRESETS` as plain data.

**Interface additions on `PostAa`:** `setVhs(preset | null)`,
`setVhsTerm(name, value)`, `readonly vhs`, `readonly effectiveSmear`.
Seams on `__sdfGame` following the `setAdaptive` convention, and both the
preset and every term recorded in telemetry metadata so a capture says what
look it was running.

## The port

club-mutant is **Phaser + GLSL ES 1.0**; Blud is **three.js WebGPU + WGSL**.
This is a rewrite, not a copy. The mechanical part: `varying` → function
parameter, `texture2D` → `textureSample`, `uMainSampler` → the captured scene
texture, GLSL `mod` → WGSL `%` semantics on negatives, and `hash21`/noise
helpers emitted after the main fn (three anchors `wgslFn`'s declaration parse
at `^`, so the main function must come first — the same rule `post-aa.ts`
already documents).

The previous-frame sampler (`uPrevSampler`/`uHasPrev`, used for motion-gated
chroma bursts) maps onto post-aa's existing ping-pong history pair, which is
the machinery SMEAR uses — so taking over temporal duty is a reuse, not new
plumbing.

## Constraint that must not break

`post-aa`'s all-off path is an **exact pass-through** — the redirect is dropped
and the chain draws to the canvas as it always has — and its A/B parity gate
depends on that being the SAME code path, not an equivalent one. VHS off must
leave that path byte-identical. A new stage that is merely a no-op when
disabled is not sufficient.

## Testing

Pure (vitest, no GPU): the preset table matches the club-mutant values exactly
(it is the source of truth and drift would be silent); term clamping matches
the source's ranges; `effectiveSmear` is 0 when VHS is on and equals the user
setting when off, and the user setting survives a VHS on→off cycle.

WGSL: `post-vhs.wgsl.test.ts` in the style of the existing
`post-aa.test.ts` / `march.wgsl.test.ts` — the shader source parses, declares
the expected uniforms, and its main fn comes first.

GPU/owner: an A/B capture with VHS off vs `soft`, judged for whether the
interlace comb reads as intentional. **Judge it only once field rendering
lands** — the two features exist to be seen together, and tuning blur against a
comb that is not there yet would be tuning against the wrong picture.

## Risks

| Risk | Mitigation |
| --- | --- |
| Blur erases the interlace comb | Every term a live uniform; tuned in play with both on |
| All-off parity broken by the new stage | Explicit constraint above; parity gate is the test |
| Three temporal filters compound | VHS takes over SMEAR while on; setting preserved |
| Preset values drift from club-mutant | Pinned by a test against the table above |
| Ported GLSL misreads on negatives (`mod`) | Called out; covered by the WGSL parse/uniform test |
