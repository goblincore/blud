# The cost ladder: where the march's walk spends its time (2026-11-09)

Stage 0 of [NOTES.md](NOTES.md). Measurement only; no renderer code changed.

**Answer.** On a clean body the field itself (the primitive folds and the carves) is about a seventh
of the walk-only frame. Most of the rest is what `mapBody` carries around each call for features
this body does not use. Calling a stripped field function from the walk gives the same picture to
the bit and takes 24 to 29 % off the shipped march pass.

## Method

One frame's `sdf:march` pass, captured off the live game (`scripts/native-spike/capture.mjs`) and
replayed through bare WebGPU in the lab Chrome (`replay.html`), with the fragment shader's TEXT
edited one rung at a time (`scripts/native-spike/ladder.mjs`, new). Every rung reads the game's own
buffers and textures, so the primitives are the live posed ones.

- **Frame:** ship defaults, the bench close-up: one clean zombie at 0.6 m, 73 % of the 400 × 300
  target covered, crowd quad dispatch, tile lists on. Two captures of the same frozen frame from one
  boot: as shipped, and with the flat-albedo seam on (the walk without the post-hit chain).
- **Timing:** 10 back-to-back copies of the pass per submit, 15 rounds, the median; rungs run in
  rotation, 5 to 8 repeats.
- **Parity:** each rung's colour target is compared with the game's own readback of that frame
  (colour and clip depth, 1e-4 bar). "Identical" below means 0 texels differ and the largest
  difference is 0.
- **Noise:** the machine was shared and warmed up over the session. Run 1's first two repeats were
  quiet and agree within 0.3 ms (A/A control −0.2 ms); runs 2 and 3 read every rung 3 to 9 ms higher.
  Absolute times below are run 1's quiet repeats. Changes are the median of each repeat's
  difference from the base rung measured in the same repeat, with the range over the three runs.
  Raw data: `ladder-run1.json`, `ladder-run2.json`, `ladder-run3.json`.

## Counters (exact)

| | Pixels | Loop steps | Primitive folds |
| --- | --- | --- | --- |
| Rays that hit | 87,587 | 255,349 (2.9 a ray) | 2,253,336 |
| Rays that walked and missed | 16,058 | 384,310 (24 a ray) | 2,045,088 |

The folds include the temporal start's probe calls, which the step counter does not see. **The
missed rays are 15 % of the walked pixels, 60 % of the steps and 48 % of the folds.**

## The rungs

| Rung | ms a pass | Change | Picture |
| --- | --- | --- | --- |
| The shipped pass | 20.6 | | identical |
| Walk only (flat albedo) | 15.8 | | identical |
| The same text with a comment appended (A/A) | 15.9 | −0.2 to +0.1 | identical |
| One extra `mapBody` a step, result unused | 22.7 | +7.2 | identical |
| Two extra | 30.5 | +15.5 | identical |
| `loadInstance` returns at once for a loaded slot | 15.2 | −0.6 | identical |
| `applyCarves` removed | 15.1 | −0.6 | identical (see below) |
| `applyWounds` removed | 12.3 | −3.6 to −4.7 (−22 %) | identical |
| The owner re-fold removed | 13.9 | −1.9 (−12 %) | identical |
| The bone fold removed | 14.6 | −1.0 (−6 %) | identical |
| Wounds, re-fold, bones, the volume branch and the reload removed | 11.0 | −4.7 to −5.3 (−26 to −30 %) | identical |
| **Walk on `mapLean`** (the tile-list fold, the carves, three record reads a slot) | 9.9 | −5.9 to −7.7 (−32 to −37 %) | identical |
| One extra `mapLean` a step | 12.1 | +2.3 over `mapLean` | identical |
| `mapLean` reading tile entries from the buffer, not the private arrays | 8.0 | −7.9 to −9.1 (−42 to −48 %) | identical |
| `mapLean` or `mapBody` chosen per pixel, in the loop and the probe | | −5.9 to −6.4 (−25 to −29 %) | identical |
| **The shipped pass, walk on `mapLean`** (with or without the probe on it too) | 14.6 | −6.7 to −7.8 (−24 to −29 %) | identical |
| The shipped pass, chosen per pixel | | −4.6 to −7.0 (−16 to −22 %) | identical |

- **A field call costs 11 ns through `mapBody` and 3.6 ns through `mapLean`** (7.2 ms and 2.3 ms
  over 640 k loop steps). At no more than 4.3 M folds that is no less than 0.5 ns a fold for the
  stripped call: the clean-room tracer's rate.
- **This zombie has no wounds, no open head, no exposed bone.** Removing that code changes no pixel,
  and the walk gets 26 to 30 % faster. The removed branches are not taken; their presence in the
  loop's field call is what costs. Why is not established (candidates: per-thread register or
  scratch memory, the compiler hoisting work out of branches).
- The single strips overlap (the re-fold contains its own wound and carve calls), so they do not add.
- `applyCarves` removed reads identical because this frame's carves do not move the hit depth by
  1e-4; it is not exact in general.
- **Choosing per pixel keeps most of the gain**: 25 to 29 % of the walk-only frame against 32 to
  37 %, and 16 to 22 % of the shipped pass against 24 to 29 %. The test used here reads one slot's
  record; a real one must cover every slot in the pixel's tile.
- Reading the tile entries directly helps the walk-only frame and not the shipped one (−23 to −26 %
  against −24 to −29 %): not resolved.

## The per-pixel setup

| Rung (the loop never runs; a miss writes its start bounds) | ms a pass |
| --- | --- |
| Setup with the temporal start's probe | 7.1 (quiet), 8.8 (median) |
| The same with the probe on `mapLean` | 5.7, 6.4 |
| Setup without the probe | 0.2 |

- **The setup itself is 0.2 ms**: the tile preload, the slot table, the hull and start bounds.
- The temporal start's probe (one to four full field calls a pixel before the walk) is everything
  else in these rungs. That is not its cost in the real frame: a probe that is removed hands its
  first-touch reads to the walk's first step. Moving the probe to `mapLean` in the full walk read
  −2.0 ms in run 2 and nothing in run 3. Not resolved.
- An earlier rung (`steps0`, 6.3 ms) was reported as "setup alone". It was not: with the probe also
  off it read 0.14 ms, because a shader that always discards is removed whole.

## What this says to do

1. **A clean-body fast path in the real shader.** `mapLean` as a real function beside `mapBody`,
   called from the walk and the temporal probe when every slot in the pixel's tile is clean (no
   wounds, closed head, no volume, no bare-bones bypass, no melt). Bit-identical on those pixels by
   construction, so the clean `march-hash` pins should not move. Measured ceiling here: 16 to 22 %
   of the shipped pass on a clean close-up.
2. **Extend it per sample to wounded bodies.** `applyWounds` returns its input outside the body's
   wound bound, and the re-fold and the bones are gated on being near a wound, so a sample outside
   the wound bound is `mapLean`'s exactly. The walk on a wounded body is where the heavy scenes
   are; this is not measured yet.
3. **The missed rays.** Half the folds on 15 % of the pixels. The fast path makes each of their
   steps cheaper; ending them sooner is a separate lever with no design yet.
4. **Find the mechanism.** If untaken wound code costs this much in the walk, it costs in the
   normal taps, the probes and the shadow march too. A rung that moves the wound, re-fold and bone
   code into one non-inlined shape (or a second pipeline) would say whether the cost follows the
   code or the call.

Not verified: any body but the zombie, a wounded frame, a crowd frame, the live game (this is a
replayed pass), cold compile cost of the extra call sites (each edited rung compiled in 15 to 40 s
here, on a warm system cache for the rest of the shader).

## Running it

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
LAB_TMP=.lab-tmp SPIKE_VARIANTS='ship=0;flat=__sdfGame.setFlatAlbedo(true)' \
  scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs 5291 9291 .scratch/ladder/cap
LAB_TMP=.lab-tmp scripts/native-spike/servers.sh node scripts/native-spike/ladder.mjs .scratch/ladder/cap 5
rm -rf /tmp/blud-gpu-timing.lock
```

A third argument names the rungs to run (`ship,ship-lean,flat,lean`). A rung whose edit no longer
matches the shader text throws by name. `scripts/native-spike/compile-check.mjs` prints the
compiler's message for a rung that fails to build.
