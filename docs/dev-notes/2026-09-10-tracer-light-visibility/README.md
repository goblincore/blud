# Do the tracers light the room? YES — and the shipped gain sits below the visible threshold

**Question (owner, 2026-09-10):** *"i cant tell if the tracers light up the room
or not (i suppose shooting down a dark hallway would be a good test) maybe they
need to be amped up a bit so i can see."*

**Answer: they light the room, the plumbing works, and at the SHIPPED gain the
effect is a 1–2 level lift of the whole frame — real, measured, and below what
anyone would notice in motion. At gain 8 it is 2–12 levels and unmistakable. The
binding limit is the 2-tracer slot cap as much as the gain.**

Rig: `scripts/sdf-game-tracer-light-check.mjs` (+ `.sh`). It fires one volley
down room 1's measured clear lane, freezes it mid-flight, and then takes a gain
ladder from that ONE frozen frame.

---

## 1. The shipped configuration (2 tracer slots — the default)

Frozen volley of 16 projectiles, `?vhs=off`, sim locked, only the tracer gain
changing between rungs. **The probe layer is bit-identical between the two gain-0
rungs (digest `99c59420`, 0/6400 floats moved) and the frame's noise floor is 569
pixels changed with ZERO above 2 levels (max delta 1)** — so everything below is
signal.

| tracer gain | gather's light list | probe layer: floats moved | max layer delta | pixels changed >2 levels | max channel delta |
| --- | --- | --- | --- | --- | --- |
| 0 (off) | 2 (base + muzzle flash) | — | — | 0 (floor) | 1 |
| **2 (SHIPPED)** | **4** | **4800/6400** | **1.068** | **1,930 (0.40%)** | **27** |
| 8 | 4 | 4800/6400 | 4.270 | 291,630 (60.8%) | 80 |
| 20 | 4 | 4800/6400 | 10.68 | 406,069 (84.6%) | 83 |

The layer delta is **exactly linear in the gain** (0.5338 per gain unit at 2, 8
and 20 — see both tables), which is what a correctly plumbed light should do.

**WHERE it lands** (mean |delta| per cell; `. ` <0.5, `:` <2, `+` <5, `#` <12,
`@` ≥12, `*` = a pixel in that cell moved ≥10 levels; columns = x, rows = y):

```
gain 2 (SHIPPED)                     gain 8
:  :  :  :  :  :  :  :  :  :         +  :  +  +  +  +  +  +  +  +
:  :  :  :  :  :  :  :  :  :         +  +  +  +  +  +* +  +  +  :
:  :  :  :  :  :  :  :  :  :         +  +  +  +* +* +  +  +  +  +
:  :  :  :  .  .  :  :  :  :         +  +  +* :* .* :* +  +  +  +
:  :  :  :  :  .  .  :  :  :  :      +  +  #  :  .  .  +* #* #* +*
:  :  :  :  :* .* .  .* :* :* .*     +  +  +* :* :* .  :* :* :* :*
```

**At the shipped gain the entire frame lifts by roughly one 8-bit level.** There
is no localised glow to see — that is exactly the "I can't tell" report, and it
is not a bug. At gain 8 the lift is 2–5 levels everywhere with 5–12 on the floor
and lower walls down the lane, i.e. the room visibly brightens.

## 2. The slot cap is the bigger lever

Same rig, same frozen volley, but `setTracerLightSlots(8)` so six tracers are in
the gather instead of two — **at the shipped gain of 2**:

| tracer slots at gain 2 | gather's light list | pixels changed >2 levels | max channel delta |
| --- | --- | --- | --- |
| 2 (SHIPPED) | 4 | 1,930 (0.40%) | 27 |
| 8 | 8 | 207,929 (43.3%) | 80 |

A 3x increase in gathered tracer light (2 → 6 lights) produces a **108x** increase
in visibly-changed pixels, because the shipped case sits just under the 8-bit
threshold and the effect is nonlinear through it. Its spatial map shows `+` cells
(2–5 levels) across the middle of the frame and scattered `*` pixels, against the
shipped case's nearly uniform `:`.

Gain ladder at 8 slots, for completeness (layer delta exactly linear: 1.628 per
gain unit):

| gain | pixels >2 levels | max channel delta |
| --- | --- | --- |
| 0 | 0 (floor: 1,052 px, 0 over 2 levels) | 1 |
| 2 (shipped gain) | 207,929 (43.3%) | 80 |
| 4 | 370,106 (77.1%) | 82 |
| 8 | 411,575 (85.7%) | 85 |
| 20 | 419,208 (87.3%) | 153 |
| 60 | 420,976 (87.7%) | 154 |

## 3. What it costs: nothing measurable

The gather's pass row stayed inside **0.14–0.39 ms across every configuration
tested**: 1/2/4-light caps and 16/32/64 rays (`scripts/sdf-game-bench.mjs` legs
`probe-lights1/2/4`, `probe-rays16/64`, run 2026-09-10), and the tracer rig's
8-light frozen case. Adding six tracer lights is therefore **under ~0.25 ms per
frame** at the shipped cadence — the whole pass is a fifth of a millisecond.

**Honest limit:** that sweep could NOT resolve a cost CURVE. The pass is now at
0.1–0.4 ms, which is this instrument's own resolution floor, and the six legs
came back non-monotonic (lights 1/2/4 → 0.39/0.21/0.39 ms; rays 16/32/64 →
0.24/0.15/0.14 ms). What is defensible is the BOUND (everything measured ≤0.39 ms),
not a slope. The bench run also had a cold-first-leg confound: the `baseline` leg
read `sdf:march` 7.16 ms / frame 15.17 while the five legs after it read
4.5–4.9 ms / 9.7–11.7 ms, and several of those legs are near-no-ops, so that
spread is leg ORDER, not the seams. Do not read that run's `baseline` row.

## 4. Recommendation (owner's look call)

- **`tracerLightGain` 2 → 6–8.** The threshold is between 2 and 8; at 8 the room
  visibly brightens on every shot. Cost: unmeasurable.
- **`tracerLightSlots` 2 → 4–8** (there is already a seam:
  `?tracerlightslots=N` / `setTracerLightSlots`, and `tracerLightGather` fills
  only the slots the flash and the flashlight left). This is the bigger lever at
  the shipped gain and it also makes a burst read as a moving glow rather than a
  single point.
- Both are one-line changes in `game-main.ts` (the defaults at the seam
  declarations). Nothing else needs touching — the plumbing, the room gate, the
  nearest-first cap and the probe path all work as designed.
- PNGs to judge by eye were written to `/tmp/sdf-tracer-light-slots2/`
  (shipped case: `00-gain000.png`, `01-gain002.png`, `02-gain008.png`,
  `03-gain020.png` plus `-zoom.png` crops) and `/tmp/sdf-tracer-light-slots8/`
  (the wide-slot case). Regenerate any time with
  `TRACER_SLOTS=2 TRACER_GAINS=0,2,8,20,0 scripts/sdf-game-tracer-light-check.sh`.

## 5. Rig traps — three of them cost a run each

1. **A CROSS-BOOT PIXEL DIFF IS THE TWO-STATE BRANCH, NOT YOUR LIGHT.** The first
   version of this rig fired a fresh volley in a fresh page per gain. Two gain-0
   boots matched BIT FOR BIT in the probe layer (0/6400 floats) and still differed
   in **27.6% of the frame's pixels**, max channel delta 17. Fix: one boot, one
   volley, frozen mid-flight with `setRenderLock(true)`, gains laddered in place.
2. **A READBACK WITHOUT A GPU FENCE BELONGS TO THE PREVIOUS RUNG.** The second
   attempt laddered correctly but read the layer without `resolveGpu()`: the rung
   that had just set gain 0 reported eight lights' worth of layer, and gain 8 came
   back with gain 0's digest byte for byte. `demoScenario` calls
   `handle.resolveGpu()` before every `hashFrame` for this exact reason. Fix:
   `await __sdfGame.resolveGpu()` after the step, before the read.
3. **THE INTERLACED MARCH HOLDS ROWS FROM THE PREVIOUS FRAME.** With the fence
   fixed, the gain-0/gain-0 floor STILL differed in 448k pixels while the layer
   was bit-identical — the rows held from the rung before (gain 60) had not been
   repainted. Fix: step 8 frames (four field cycles, four gathers) after each gain
   change. The floor then collapses to 569–1,052 pixels, **zero** of them above 2
   levels.

All three are encoded in the rig's header. `?dynblend=1&dynfall=1` (the R1
verification seams, `2026-09-10-r1-gather-dispatch-implemented/`) is what makes a
layer diff readable at all: it removes the afterglow's dependence on how many
frames the run dispatched before the read.
