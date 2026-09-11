# Do the tracers light the room? YES — and the shipped gain sat below the visible threshold

**Question (owner, 2026-09-10):** *"i cant tell if the tracers light up the room
or not (i suppose shooting down a dark hallway would be a good test) maybe they
need to be amped up a bit so i can see."*

**Answer: they light the room, the plumbing works, and at the OLD shipped gain the
effect was a 1–2 level lift of the whole frame — real, measured, and below what
anyone would notice in motion.**

## 0. APPLIED — the shipping values changed

| seam | was | now |
| --- | --- | --- |
| `tracerLightGain` (`?tracerlight`) | 2.0 | **6.0** |
| `tracerLightSlots` (`?tracerlightslots`) | 2 | **4** |

Measured IN ONE BOOT, one frozen volley, only the two seams changing between
rungs (so the two-state branch cannot confound it). Noise floor for the run: 284
pixels changed, **zero** above 2 levels, max delta 1; the probe layer matches
**bit for bit** between the two gain-0 rungs (0/6400 floats).

| config | gather's lights | probe-layer floats moved | max layer delta | pixels changed >2 levels | max channel delta |
| --- | --- | --- | --- | --- | --- |
| gain 0 (control) | 2 | 0 | 0 | 0 (floor) | 1 |
| **BEFORE (2 slots, gain 2)** | 4 | 4800/6400 | 1.068 | **1,796 (0.37%)** | 29 |
| **AFTER (4 slots, gain 6)** | 6 | 4800/6400 | 6.429 | **369,088 (76.9%)** | 68 |
| (8 slots, gain 6) | 8 | 4800/6400 | 9.768 | 400,644 (83.5%) | 70 |
| (4 slots, gain 20) | 4+2 | 4800/6400 | 21.43 | 417,882 (87.1%) | 79 |

**The shipped change takes visibly-changed pixels from 0.37% to 76.9% of the
frame — 205x — with no measurable cost.** Images (full frame + centre crop, same
boot, same volley): `shots/02-BEFORE-shipped-2slots-gain2.png`,
`shots/03-AFTER-shipped-4slots-gain6.png`, and the two `-zoom.png` crops beside
them.

The layer response is **exactly linear in BOTH seams**, which is the internal
check that the light count is what the cap says it is: 0.5338 per gain unit at 2
slots (= 2 tracers), 1.0715 at 4 (= 4 tracers), 1.628 at 8 slots, where the
8-light allocation caps it at 6 tracers — i.e. exactly 3x the 2-slot response.

---

Rig: `scripts/sdf-game-tracer-light-check.mjs` (+ `.sh`). It fires one volley
down room 1's measured clear lane, freezes it mid-flight, and then takes a gain
ladder from that ONE frozen frame. `TRACER_LADDER=slots:gain,...` varies BOTH
seams per rung, which is how the table above stays in one boot.

## 1. The old configuration (2 tracer slots, gain 2 — the default until today)

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

## 4. Recommendation — APPLIED (kept as the reasoning)

Applied as `tracerLightGain` 2 → **6** and `tracerLightSlots` 2 → **4**, the two
defaults at the seam declarations in `game-main.ts`. Nothing else was touched: the
plumbing, the room gate, the nearest-first cap and the probe path all work as
designed, and the change is one line each.

- Gain 6 rather than 8: the threshold is between 2 and 8, and at 6 the frame is
  already 76.9% visibly changed against 82.0% at 8 — the curve is saturating, so
  the extra gain buys little and risks reading as a muzzle flash rather than a
  travelling glow.
- 4 slots rather than 8: 76.9% against 83.5%, i.e. most of the benefit with half
  the lights, and it leaves the gather's 8-light allocation room for real lights.
  It is the seam to turn first if the owner wants more.
- Both are reversible live: `?tracerlight=N` (0/off = the old behaviour) and
  `?tracerlightslots=N`, or `__sdfGame.setTracerLight(n)` /
  `setTracerLightSlots(n)`.
- Images: `shots/` in this directory (full frames + centre crops, all from ONE
  boot so they are directly comparable). Regenerate with
  `TRACER_LADDER=0:0,2:2,4:6,8:6,4:20,0:0 scripts/sdf-game-tracer-light-check.sh`.

## 5. WHY SHOOTING INTO ANOTHER ROOM LIGHTS NOTHING — it is single-room by construction

**Owner, after the change shipped: "i dont really see any difference ... i shoot
into another room i guess i expect to see like the tracer light up the room."**
That expectation is correct about what a dynamic light SHOULD do and wrong about
what this system can do today, and no gain value can bridge it. Three separate
mechanisms each forbid it:

1. **The tracer is dropped from the light list before it can matter.**
   `tracerGatherLights` (src/lab/sdf-zombie/tracer-lights.ts) keeps only
   projectiles inside the gather's room grown by a 1.5 m margin, x/z:
   `if (p.pos[0] < room.minX - margin || p.pos[0] > room.maxX + margin) continue;`
   A round that has crossed into the next room is outside that box and returns
   `[]` for that tracer.
2. **The probes being lit are the PLAYER'S room's probes.**
   `dynRoom` is `enclosureKeyAt(player.pos)` (or the nearest room by centre from a
   tunnel/doorway) and the gather packs THAT room's enclosure, furniture, capsule
   set and grid — game-main.ts ~1249-1275. So even a light that survived the gate
   would illuminate the player's own grid, not the far room's.
3. **There is exactly ONE dynamic layer, and it is sized for one grid.**
   `createProbeGatherBinding(..., { maxProbes: 10*4*10, ... })` allocates a single
   400-probe buffer (game-main.ts ~2107) and exactly one `probeDyn` node is bound
   into the level lighting (~2255). Room B's surfaces, if visible through a
   doorway, are not reading a layer computed for room B.

**The muzzle flash has the same gate**, which is the giveaway that this is the
architecture and not the tracer feature: a shot fired through a doorway does not
light the far room either, flash and all.

**What it would take to do it** — a real capability, not a tweak: bake a grid per
room (already done: `roomProbes.gridOf(roomId)`, per-room worker bakes exist),
allocate a dynamic layer per LIT room, dispatch the gather once per room that has
a light in it, and bind each room's surfaces to their own layer. The gather is
now 0.18 ms per room, so lighting the player's room plus the two nearest would
cost on the order of half a millisecond — it is the bookkeeping (N buffers, N
dispatches, per-room material binding, and deciding which rooms are "visible
enough to bother") that is the work, not the GPU time.

**Not attempted here**: the owner's interest was "a way of testing the dynamic
light", not a new subsystem.

## 6. A limit of THIS rig: it measures an UPPER BOUND, not the in-play value

Every number above comes from a volley FROZEN mid-flight with the afterglow seams
pinned (`setProbeBlend(1); setProbeFall(1)`). That makes the layer equal to the
frame's estimate for a light that SITS STILL — the steady state. In play the light
MOVES with the pellets, so each probe sees it briefly, and the shipped afterglow
ramps toward the estimate at 0.6 per gather (i.e. ~84% after two gathers, ~4
frames), while a pellet crossing an 8 m room at 30 m/s is present for ~0.27 s
(~8 gathers). So the in-play response is BELOW these figures by an amount this
rig does not measure — the 1,796 → 369,088 pixel comparison is still a like-for-
like comparison of the two shipped configurations, but "76.9% of the frame" is
not what a shot in play changes.

The live-fire version of this measurement (no freeze: fire a burst in a room and
diff the layer against a no-fire control, same boot, same # of steps) is the
honest follow-up if this matters. It is not written yet.

## 7. Rig traps — three of them cost a run each

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
