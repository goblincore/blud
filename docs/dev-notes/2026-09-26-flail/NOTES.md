# Spike flail — gate and look passes (v1: Task 6; v1.1: Task 11)

## For the owner

### v1.1 (2026-09-27): what changed

- **The chain is a whip now.** The ball hangs on a simulated 9-node chain
  (`flail-chain.ts`), pinned at the eye bolt. It trails the haft on the wind-up, is pinned
  exactly on the impact point on the strike frame, then flies on and settles. At rest it
  hangs under gravity and sways a little. The hits are unchanged: the crater still lands
  where the strike window puts it. The drawn ball is 0.000 cm off the impact on all six of
  the gate's strike frames.
- **No slack loop before the hit.** The keyed ball used to cut inside the haft's arc and
  pass 0.19 m from the bolt just before the strike, so the chain bunched into a loop above
  the haft tip. Two extra keys per swing (at 0.15 s and 0.37 s) keep it 0.31–0.36 m out.
  See the tuning log below.
- **Gradual head damage.** Head hits 1 and 2 leave a smaller crater (0.09 m) and don't
  sever. Hit 3 takes the head off. See `gate/head-hit-1/2/3.png`.
- **Bigger hand** (`handScale` 0.8 → 1.0).
- **Not in v1.1:** weapons still poke through walls when you stand close. That is its own
  TASKS row, for all weapons.

### v1.1 feel questions

- **Is the whip whippy enough?** The wind-up trails the haft by up to ~16 cm. The
  follow-through whips past, but the ball doesn't wrap around anything. Try more lag, a
  looser guide, or less damping?
- **Does hit 2 read?** In the gate, hits 1 and 2 land on the same spot (the neck, aimed
  twice). Hit 2 changed only ~4% of the head crop's pixels, so the second cave-in is hard
  to see. In play your hits will spread more. Should a repeat hit grow the crater (e.g.
  0.09 → 0.11) so it always reads?
- **The fist at rest is still just a sliver** (0.2% of the screen). `handScale` 1.0 only
  shows during a swing (up to ~4% of the screen, plus the bracer, on the L wind-up). Showing
  more fist at rest means moving the rest GRIP up and in, not scaling the hand again. Want
  that?
- **The ball bounces after a swing.** For ~0.3 s after the swing ends, it rides up
  (ball–bolt 0.25 m) before it settles. Fine, or too loose?

### v1 (2026-09-26)

- **How to try it:** key `1` equips the flail; click to swing (alternates right→left, then
  left→right); hold to chain swings.
- **What to judge:** timing (does a click land when you expect it to), reach, crater size, the
  50 ms hit-stop, and the camera kick.
- **One known limitation:** the strike ignores walls — a zombie behind a wall but inside the
  reach/arc window still takes the hit.
- **Open feel questions** (from the tuning log below):
  - Should the strike show a visible whip, with the ball lagging the haft?
  - Should more of the fist show at rest?
  - Is the fill too dark?
  - Is the crater visually strong enough (red-minus-green +9.8 on torch-pink skin)?
  - Does it matter that walls don't block the strike?

Spec: [2026-09-26-spike-flail-design.md](../../superpowers/specs/2026-09-26-spike-flail-design.md).
Gate: [`scripts/flail-gate.mjs`](../../../scripts/flail-gate.mjs). Run it from bash with servers up:

```bash
. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
node scripts/flail-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
```

The gate runs in the sandbox (`seed=1`), in the arena (room 6, 8 zombies), with the zombies
frozen and hit-stop off. Each check uses a fresh zombie, and the player stands on the
arena-centre side of it.

## v1.1 gate output (2026-09-27, headless Chrome, WebGPU, after 1cb8f702)

The beheading check is now the gradual one. Exactly three clicks on a fresh zombie at neck
height:
- hits 1 and 2 leave the head on, add one wound of radius 0.09 ± 0.005 within 0.25 m of
  the head centre, and `lastStrike.headHits` counts 1 and 2;
- hit 3 takes the head off.

New check: on every click's strike frame, the drawn (simulated) ball is ≤ 2 cm from
`FLAIL_IMPACT` (`lastStrike.ballErr`). All other checks, and the per-click positive
control, are unchanged.

```
flail ready; canvas {"x":107,"y":0,"w":1067,"h":800}
room 6 (arena): 8 zombies; centre (28.00, 0.00, -4.80)
rest: ball NDC (0.54, -0.76), bolt (0.58, -0.03), grip (0.83, -1.05), ball r 0.114; ball↔bolt 0.325 m
rest clipping: ball {"n":7476,"clipped":0,"meanLuma":67.8}; haft {"n":56,"clipped":0,"meanLuma":61}
front hit: zombie 11 +1 wounds (radii 0.140); lastStrike {"side":"R","hits":[11],"eye":[23.990598178534697,1.62,-9.358942745935575],"impact":[23.213405785011975,1.2600000000000002,-10.166947686174446],"headHits":{"11":0},"ballDrawn":[-0.05000000000000002,-0.36,-1.12],"ballErr":1.3877787807814457e-17}; swing ball↔bolt worst 0.491 m, clamped on 23/30 frames
  f6 swing/R ball (1.19, 0.44) grip (1.03, -0.40) keyed 0.36 drawn 0.31
  f7 swing/R ball (1.14, 0.43) grip (0.94, -0.46) keyed 0.39 drawn 0.27
  f8 swing/R ball (0.77, 0.06) grip (0.79, -0.59) keyed 0.39 drawn 0.28
  f9 swing/R ball (0.39, -0.28) grip (0.64, -0.72) keyed 0.36 drawn 0.30
  f10 swing/R ball (0.13, -0.46) grip (0.48, -0.87) keyed 0.31 drawn 0.30
  f11 swing/R ball (-0.06, -0.61) grip (0.35, -0.97) keyed 0.37 drawn 0.34
  f12 swing/R ball (-0.25, -0.77) grip (0.22, -1.01) keyed 0.45 drawn 0.36
  f13 swing/R ball (-0.33, -0.82) grip (0.09, -1.02) keyed 0.49 drawn 0.37
  R-G in the 40x40 crop: 82.3 before → 88.6 after
  crater contrast (ring 1.2–1.6 r minus disc 0–0.6 r, r 90 px): -11.3 before → 29.0 after (rise 40.3); disc luma 133.9 → 97.0
  crater at px (604, 685): R-G rise 6.4
PASS: front hit at 1.5 m: exactly one wound, radius 0.140, lastStrike holds 11
too far: zombie 12 at 2.2 m, side L (expected L), strike fired true: +0 wounds; hits []
PASS: too far (2.2 m): the L strike fired and missed
too wide: zombie 13 at 1.2 m, turned 70°, side R (expected R), strike fired true: +0 wounds; hits []
PASS: too wide (70° off at 1.2 m): the R strike fired and missed
head hit 1 (L): neck y 1.48, pitch 0.206 (solved miss 4.5e-16 m, real strike ray 0.00 cm from the neck); +1 wounds (y@radius/type 1.48@0.090/blast; from the head centre 0.127 m); headHits 1; head prims 5/5
PASS: head hit 1: the head is still on (5/5 prims), one 0.090 crater 0.127 m from the head centre, headHits 1
head hit 2 (R): neck y 1.48, pitch 0.209 (solved miss 2.6e-15 m, real strike ray 0.00 cm from the neck); +1 wounds (y@radius/type 1.48@0.090/blast; from the head centre 0.127 m); headHits 2; head prims 5/5
PASS: head hit 2: the head is still on (5/5 prims), one 0.090 crater 0.127 m from the head centre, headHits 2
head hit 3 (L): neck y 1.48, pitch 0.206 (solved miss 4.5e-16 m, real strike ray 0.00 cm from the neck); +2 wounds (y@radius/type 1.48@0.140/blast 1.48@0.112/blast; from the head centre 0.127 0.110 m); headHits 3; head prims 0/5
PASS: head hit 3: the head came off (headHits 3)
PASS: head hits: every strike ray passed within 5 cm of the neck (worst 0.00 cm)
strike-frame ball error per click (cm): 0.000 0.000 0.000 0.000 0.000 0.000
PASS: strike frame: the drawn ball within 0.000 cm of the impact on all 6 clicks (≤ 2 cm)
PASS: positive control: every click struck exactly once, on the side nextSide promised
PASS: zero console errors or exceptions
GATE PASSED
```

- **Hit 3 adds two wounds**, as before: the 0.14 crater and the 0.112 sever stump.
- **The front-hit readbacks moved slightly** (clamped 23/30, crater contrast rise 40.3).
  That is the whip: `clamped` now counts frames where the drawn ball sits inside the keyed
  one, which is expected with a simulated chain. The contrast rise is still strong (51.1 in v1);
  the crop geometry differs slightly (crater at px 604, 685 vs 605, 671).

Photos (`gate/`):

- `head-hit-1.png`: the zombie in profile. A dark crater at the jaw/throat line, the neck
  opened to a yellow cross-section, blood running down the chest. The head is on.
- `head-hit-2.png`: almost the same frame. The second 0.09 crater lands on the same spot as
  the first, so the face barely changes: the cut is slightly wider and there is more blood
  on the chest. Mean abs luma diff over the head crop is 5.2/255, and 4% of pixels changed
  by more than 30. The ball is mid-sway after the swing.
- `head-hit-3.png`: the head is gone. A spray of blood and chunks bursts above the
  shoulders, and the severed head lies at the lower right beside the ball.
- `behead-after.png` is the v1 photo (one-click beheading), kept for the record.

## v1.1 look pass (2026-09-27)

Captured one 60 Hz frame at a time, frozen crowd, 2.4 m from a zombie (out of reach, so no
hits). Harness: a throwaway in `.lab-tmp/`. Strips: `look/whip-R-strip.png` and
`look/whip-L-strip.png`, 8 frames each: f0 (rest), f3, f6, f8, f10, f11 = STRIKE, f14, f18.

- **R:**
  - f3–f6: the haft rises right, the ball goes up and off-screen right.
  - f8: the haft is upright at the right edge, and the chain arcs over the tip to the ball,
    which trails beside the haft. It reads as a whip trail, not a knot.
  - f10: the haft points into the scene, the ball at its tip.
  - f11: the ball is out ahead at the zombie's hip.
  - f14–f18: the ball whips low-left and away.
- **L:**
  - f6: the ball is up-left on a taut chain, and the fist and bracer cross the lower left.
  - f8: the clearest whip frame: the chain curves back from the tip and the ball trails
    well behind it.
  - f10–f11: the ball leads into the hit.
  - f14–f18: it whips out low right.
- **The drawn chain through the swing:**
  - drawn ball–bolt is 0.27–0.37 m; the minimum is the wind-up trail at f7–f8;
  - link error ≤ 0.02% on every frame;
  - strike-frame error 0.
  - The old loop (drawn 0.19 m at f9, chain slack 0.16 m) is gone: slack is now ≤ 0.07 m
    in the pure 60 Hz replay.
- **Rest hang and sway** (3 s idle): the ball hangs 0.353 m below the bolt (the chain
  nearly straight). It sways 2.4 cm side to side and 1.6 cm fore-aft, with 0.06 cm
  vertical. On screen that is 0.04 NDC (~21 px). Visible but subtle; left as is.
- **The hand at `handScale` 1.0** (green-pixel share of the canvas):
  - rest 0.2%;
  - R wind-up peak 2.9% (f8);
  - L wind-up 4.3% (f6), plus the brown bracer covering the lower-left quarter.
  - Big during the L wind-up, but it reads as an arm crossing the body. Not too dominant,
    and not changed.
  - At rest it is still only a sliver: scale doesn't help there, the rest grip does (feel
    question above).
- The earlier `look/whip-R-f*.png` single frames predate the loop fix. The strips replace
  them.

### v1.1 tuning log (Task 11)

- **Swing keys (flail-swing.ts): +2 keys per side, at t 0.15 s and t 0.37 s.**
  - **Why.** The haft sweeps ~107° from the wind-up to the strike. The bolt runs on an
    arc, and the ball's spline ran on the chord, so the keyed ball came to 0.188 m (R) /
    0.220 m (L) from the bolt at t 0.158. On the return to rest it came to 0.24 m at
    t 0.36.
  - **How.** Each new key takes the old curve's grip and rot at its time. The ball offset
    was found by a constrained random search with every swing test as a hard bound, then
    rounded to the cm and pulled inside reach:

    | side | t | ball |
    | --- | --- | --- |
    | R | 0.15 | (0.29, −0.15, −1.03) |
    | R | 0.37 | (−0.11, −0.52, −1.12) |
    | L | 0.15 | (−0.17, −0.15, −1.00) |
    | L | 0.37 | (0.38, −0.45, −1.23) |

  - **Min keyed ball–bolt over the swing:**
    - R: 0.188 → **0.308 m**
    - L: 0.220 → **0.318 m**
    - New test: ≥ 0.28 m.
  - **Other swing numbers:**
    - speed-at-strike / peak: R 0.826 → 0.855, L 0.812 → 0.876;
    - strike speed: R 14.6 → 15.6 m/s, L 12.4 → 13.5 m/s;
    - worst overshoot: 2.6 → 2.3 cm;
    - worst 240 Hz speed ratio: 1.91–1.94 → 1.91;
    - new-key reach 0.354 / 0.356 m (≤ 0.37).
- **`PIN_FABRIK` (flail-chain.ts): 16 → 32.** The reshaped approach left the L ring link
  0.2% long on the pinned strike frame, against a 0.1% test. 32 passes are exact; the cost
  is once per strike.
- **`FLAIL_CHAIN_SIM` is unchanged** from e40f7ccb: damping 2.5, 20 iterations,
  guideRate 140, swingFloor 0.3, guide/release windows 0.1 s, settle 0.12 s,
  ballInvMass 0.05. The look pass didn't call for a change.
- **`handScale`: unchanged at 1.0.**

## Gate output (2026-09-26, headless Chrome, WebGPU — after the Task 6 review fixes)

```
flail ready; canvas {"x":107,"y":0,"w":1067,"h":800}
room 6 (arena): 8 zombies; centre (28.00, 0.00, -4.80)
rest: ball NDC (0.54, -0.71), bolt (0.58, -0.03), grip (0.83, -1.05), ball r 0.115; ball↔bolt 0.326 m
rest clipping: ball {"n":7556,"clipped":0,"meanLuma":69.7}; haft {"n":56,"clipped":0,"meanLuma":58.9}
front hit: zombie 11 +1 wounds (radii 0.140); lastStrike {"side":"R","hits":[11],"eye":[23.990598178534697,1.62,-9.358942745935575],"impact":[23.19359382144128,1.27,-10.189475138304536]}; swing ball↔bolt worst 0.494 m, clamped on 5/30 frames
  R-G in the 40x40 crop: 79.9 before → 89.7 after
  crater contrast (ring 1.2–1.6 r minus disc 0–0.6 r, r 91 px): -29.2 before → 21.9 after (rise 51.1); disc luma 149.7 → 102.5
  crater at px (605, 671): R-G rise 9.8
PASS: front hit at 1.5 m: exactly one wound, radius 0.140, lastStrike holds 11
too far: zombie 12 at 2.2 m, side L (expected L), strike fired true: +0 wounds; hits []
PASS: too far (2.2 m): the L strike fired and missed
too wide: zombie 13 at 1.2 m, turned 70°, side R (expected R), strike fired true: +0 wounds; hits []
PASS: too wide (70° off at 1.2 m): the R strike fired and missed
behead click 1 (L): neck y 1.48, pitch 0.193 (solved miss 2.8e-15 m, real strike ray 0.00 cm from the neck); +2 wounds (y@radius/type 1.48@0.140/blast 1.48@0.112/blast); head prims 0/5
PASS: beheading: every strike ray passed within 5 cm of the neck (worst 0.00 cm)
PASS: beheading: the head came off on click 1 (of at most 3)
PASS: positive control: every click struck exactly once, on the side nextSide promised
PASS: zero console errors or exceptions
GATE PASSED
```

All checks pass. **No strike tuning was needed**: `FLAIL_FEEL`, `FLAIL_STRIKE` and the
impact keys are unchanged.

What each check proves (after the review of 519d8090):

- **Every click is a positive control.** It must raise `state().strikes` by exactly 1, and
  `lastStrike.side` must be the side `state().nextSide` promised before the click. So the
  too-far and too-wide refusals can no longer pass on a dropped click. Each asserts that its
  strike *fired* and that `lastStrike.hits` does not hold the target.
- **Beheading.** The gate aims the strike's own eye → impact ray through the neck capsule's
  midpoint. It solves yaw and pitch in the page with the game's own `viewToWorld` and
  `FLAIL_IMPACT`, re-solving before every click for that click's side (read from
  `nextSide`). It then checks the ray the game actually cast (`lastStrike.eye` →
  `lastStrike.impact`): it passed 0.00 cm from the neck, against a 5 cm bound.
  - **The head comes off on click 1.** The first run's "after 2 clicks" was a stale
    readback: `limbAlive` counted `drawnBody()`, the posed body. `detach()` swaps `current`
    without re-posing, and a frozen actor does not step, so the posed body kept the head
    until click 2's `blast()` re-posed it. `limbAlive` now reads the actor's CURRENT body
    (`a.body`).
  - The same staleness shows in the photo. A frozen, one-click-beheaded actor still DRAWS
    its head until something re-poses it. In play it steps every frame, so this is a gate
    artefact. The gate thaws the crowd for 3 frames before `behead-after.png`.
- **The second neck wound is the sever stump, as expected.** The neck click stamps two
  blast wounds: the flail's crater (r 0.140), and the stump (r 0.112 = the head cluster's
  radius × 0.45; sever.ts:70–77, `injuryIgnored`). `detach()` stamps the stump at
  game-actor.ts:919–922. The front hit on the torso, where nothing is severed, stamps
  exactly one wound.
- **First capture thrown away.** The first render-locked capture of a session came back
  twice with neither the level nor the flail drawn. The gate now throws two captures away
  before `rest.png`, which is also the crater's BEFORE frame.

Staging notes:

- **Screen coordinates.** The canvas is letterboxed: it is 4:3, 1067×800 at x 107, inside the
  1280×800 window. The screen image is also warped by the fisheye post-pass. So `state().ndc`
  and `flail.toScreen()` return screen NDC *through the lens* (`reticleNdc`), and the gate
  maps NDC onto the canvas rect. Before this, the Task 5 smoke's ball crops sat about 45 px
  off the ball.

## Tuning log (old → new, and why)

### The rest pose (`FLAIL_REST`, flail-swing.ts)

This is also the first and last key of both swings.

| | old | new |
| --- | --- | --- |
| grip | (0.22, −0.3, −0.4) | (0.4, −0.33, −0.5) |
| rot | (−1.1, 0, 0) | (−0.6, 0, 0.1) |
| ball | (0.24, −0.5, −0.55) | (0.355, −0.29, −0.75) |

**Why:** the old ball hung 0.5 m below the fist, at screen NDC y −1.15, which is off the
bottom of the frame. It was also 0.47 m from the eye bolt, so it was drawn clamped. The new
pose has the fist just below the lower-right corner and the haft rising up and slightly
inward. The ball hangs 0.33 m under the bolt, inside chain reach, so it is not clamped.

**Measured (gate):**

- Ball screen NDC is **(0.54, −0.71)**, inside the target of x 0.3–0.6 and y −0.4 to −0.8.
- The bolt is at (0.58, −0.03).
- The grip is at (0.83, −1.05), just off-screen.

To find it, I mutated `FLAIL_REST` in place in the page (the keys share its arrays) and
compared candidates. I fitted the GLB's ChainAnchor from those probes (rms 0.4 mm): it sits
at **(0, 0.448, 0) haft-local**. That anchor is what the key reach numbers below use.

### The swing keys (flail-swing.ts)

The old follow-through balls sat at z −1.6, about 1 m from the bolt. The renderer clamped
them to 0.415 m, so the drawn ball did not follow the authored arc. The old windup balls
(0.35 m from the grip) were also closer than the haft is long.

The new keys are built so that at every key the haft points from the grip toward the ball,
with the ball within chain reach (≤ 0.415 m) of the bolt. At the strike, the haft points at
the ball and the chain runs straight out past its tip, so the ball leads the hand into the
hit. The haft's roll (`rot` y) is now 0 everywhere.

| key | old grip / rot / ball | new grip / rot / ball |
| --- | --- | --- |
| R windup t 0.1 | (0.32, −0.02, −0.3) / (0.3, 0, −0.6) / (0.55, 0.25, −0.3) | (0.34, −0.05, −0.35) / (0.1, 0, −0.41) / (0.7, 0.15, −0.6) |
| R strike t 0.18 | (0.05, −0.2, −0.55) / (−1.2, 0.6, 0.3) / (−0.05, −0.35, −1.15) | (0.12, −0.22, −0.46) / (−1.76, 0, 0.24) / **unchanged** |
| R follow t 0.3 | (−0.2, −0.35, −0.45) / (−1.4, 1.0, 0.6) / (−0.6, −0.6, −1.6) | (−0.1, −0.34, −0.61) / (−1.89, 0, 0.49) / (−0.5, −0.58, −1.33) |
| L windup t 0.1 | (−0.05, −0.05, −0.3) / (0.3, 0, 0.6) / (−0.35, 0.2, −0.35) | (−0.02, −0.08, −0.35) / (0.1, 0, 0.52) / (−0.45, 0.1, −0.6) |
| L strike t 0.18 | (0.12, −0.2, −0.55) / (−1.2, −0.6, −0.3) / (0.1, −0.35, −1.15) | (0.22, −0.22, −0.46) / (−1.76, 0, 0.17) / **unchanged** |
| L follow t 0.3 | (0.35, −0.35, −0.45) / (−1.4, −1.0, −0.6) / (0.65, −0.55, −1.6) | (0.45, −0.34, −0.61) / (−1.89, 0, −0.43) / (0.8, −0.58, −1.33) |

- **The impact keys are unchanged**, so the strike's eye → impact rays, and so where craters
  land, are exactly as in Task 5.
- **Why the follow-through ball is deeper than the strike's (z −1.33 vs −1.15).** The strike
  tangent carries the ball forward at about 12 m/s in z. A follow-through key shallower than
  about −1.33 made the spline overshoot it, and failed the "no key overshot by more than 3 cm"
  test. I tried −0.92, −1.24, −1.30 and −1.32. All failed, the last three by 0.3–3 mm. At
  −1.33 the test passes. So the follow-through grip moved forward to z −0.61 to keep that
  ball in reach.
- **Why the windup ball moved forward to z −0.6.** This lowers the incoming z speed, which
  shrinks that overshoot.
- **Where the renderer still clamps.** The keys are all within reach, but between keys the
  R follow-through briefly overruns it. It reaches 0.49 m near t 0.23, and is clamped on 5
  of 30 gate frames, by at most about 8 cm. L peaks at 0.414 m and is not clamped. Before
  this pass, the ball was clamped by up to 0.6 m.
- A new pure test checks that at every key of both swings, and at rest, the ball is within
  `maxBallBolt()` (0.415 m) of the eye bolt. The bolt is computed as grip + Euler(rot)·(0,
  `FLAIL_CHAIN.anchorY`, 0). The chain numbers now live in flail-swing.ts `FLAIL_CHAIN`, and
  game-flail.ts reads its `chainLen`, `ringOffset` and clamp from there. As a cross-check,
  the test's bolt maths puts the OLD rest ball at 0.474 m against 0.472 m measured in game,
  so it would have failed.
- The original 20 `flail-swing` tests pass unchanged: the speed-at-strike ratio (≥ 0.8), the
  overshoot bound, the pop bounds and the speed-jump bounds. No bound was loosened.

### Blow-out: the flashlight fill (game-flail.ts), ported from the censer (8c24de2a)

The torch hangs about 1 m above the eye with a 1.6 decay. The flail is 0.5–0.9 m from it,
and it rendered the brown haft white.

I measured this at the new rest pose, same frame and same pose, before and after. The crop
is 0.8 of the ball's projected radius. The haft is sampled as the brightest pixel across 56
steps from the bolt to the grip.

| | ball clipped | ball mean luma | haft clipped | haft mean luma |
| --- | --- | --- | --- | --- |
| torch (before) | 15.5% | 172 | **83.9%** | 232 |
| fill 0.018 (after) | 0% | 72 | 0% | 54 |

Photos: `look/rest-torch-before.png` and `look/rest-fill-after.png` (sandbox room 1).

- **Why I ported it although the ball was under 50%.** The brief's trigger was ball clipping
  over 50%, and the ball was at 15.5%. I ported the fix anyway because the haft was 84%
  clipped: brown wood rendering pure white is a blow-out.
- **What was ported.** This is the censer's OWN LIGHT LIST:
  - Every flail material, including the GLB's, the chain link's and the goblin hand's (which
    is cloned), gets `lightsNode` pointed at a list. That list mirrors the scene's lights, but
    swaps the torch and its shadow twin for a FILL.
  - The FILL has the same pose, cone and colour as the torch, no falloff, and
    `FLAIL_LOOK.flashFill` = 0.018 of the torch's live intensity. It sits on layer 30, with
    `onlyRooms` empty.
  - game-main calls `flail.refreshLights()` when the muzzle flash is added, as it did for the
    censer.
  - The fill is forward-route only; `syncFill` returns at once in deferred mode.
  - **Review fixes.** `FLAIL_FILL_LAYER = 30` is exported from gib-motion-blur.ts, next to
    `GIB_BLUR_LAYER`, with a "no camera draws this layer" note, and game-flail.ts imports
    it. `syncFill()` now runs in the render callback right after
    `flashlight.update(camera)`, so the fill takes THIS frame's torch pose. It used to run
    in the flail's tick, before the torch was placed. Rest clipping is identical after the
    move: 0%, ball luma 69.7.

### Task 5 review follow-ups (game-flail.ts)

1. **`aimHand`.** `view.updateMatrixWorld(true)` re-walked the whole view-model subtree
   every tick. It is now `haft.updateWorldMatrix(true, false)`. `viewModelAnchor` is an
   ancestor of the haft (game-main: `viewModelAnchor.add(aimRig)`, and the flail rig is under
   `aimRig`), so the matrices it reads are identical.
2. **Scaled arm.** `aimArm` solves with unscaled FORE_LEN_M/UPPER_LEN_M in the haft's space,
   but the arm is drawn at `handScale` 0.8. The rotations are scale-free, so the drawn chain
   ends at `hand + 0.8·(target − hand)`. The fix passes the shoulder's offset from the hand
   **divided** by `handScale` (moved away from the hand, not toward it). The drawn upper arm
   then ends at the real shoulder. In the photos the upper arm never enters the frame (the
   forearm leaves at the lower-right corner), so the old 20% short-fall was not visible. The
   fix is in anyway, because it is exact and cheap.
3. **Chain sag.** The sag is applied along WORLD down, converted into rig-local space (the
   inverse of the rig's world quaternion). It no longer tilts with aim pitch or the holster.

### Seams / readback (for the gate)

- `state().ndc` gained `grip`, and all its points are screen NDC through the lens.
- `state()` gained `nextSide`, and `lastStrike` gained `eye` and `impact`: the world
  points the strike's ray was cast through.
- `flail.limbAlive` reads the actor's CURRENT body (see Beheading above).
- New `__sdfGame.flail.toScreen(x, y, z)` returns a world point in screen NDC through the
  lens, or null if it is behind the camera. It is used for the crater crop.

## The look check (photos in `gate/`)

- `rest.png`: the flail at rest, in the arena, 1.5 m from a zombie. The haft rises from the
  lower right, and the dark spiked iron ball hangs on a short chain in the lower-right third.
  Only a sliver of the green fist shows at the corner. Neither the ball nor the haft is blown
  out (0% clipped). The zombie's lit side is washed out by the torch at this range. That is
  the game's own lighting, not the flail's.
- `swing-R-mid.png` (R, t ≈ 0.15): the haft sweeps in from the right with the fist and spiked
  bracer in the corner. The ball trails behind the haft's tip. It reads as a wind-through,
  though the ball is partly hidden behind the haft.
- `swing-R-strike.png` (R, t ≈ 0.18): the ball is on the chest, *ahead* of the hand along the
  haft, and the crater is appearing under it. The chain is very short here (the ball sits
  close to the tip), so it reads more like a mace hit than a flail's whip.
- `swing-L-mid.png` (L, t ≈ 0.15, the too-far zombie at 2.2 m): the backhand. The ball swings
  out left on its chain from the haft's tip. This is the most "flail"-looking frame.
- `hit-wound.png`: one big ringed crater (r 0.14) on the chest, with ribs showing and blood
  running down. It plainly reads as a big crater.
  - **R−G metric.** The plan's 40×40 red-minus-green rise is **9.8**, just under 10. The
    metric is saturated: the torch already makes this skin pink, and R−G is 79.9 before
    the hit.
  - **Crater contrast (the measure used instead).** A crater reads by its dark interior, so
    the gate compares mean luma in a ring just outside the crater (1.2–1.6 r) with mean luma
    inside it (0–0.6 r). r is the crater's 0.14 m projected along the camera's right: 91 px.
    Results, before the hit → after:
    - ring minus disc: −29.2 → **+21.9**, a **rise of 51.1**;
    - the disc's own luma: 149.7 → **102.5**, 32% darker.
  - **Reading the contrast.** The ring reaches past the body's edge onto the dark wall. That
    is why the before-value is negative: the static background offsets both frames equally,
    and it cancels in the rise. By this measure the crater reads strongly, so it was not
    tuned.
- `behead-after.png`: the head came off on click 1. The stump is a red burst of gore, the
  headless body reaches forward (the crowd was thawed for 3 frames), and the severed head
  lies at the lower right beside the flail at rest. The ball is not blown out.

**Clipping the camera.** Nothing clips the camera in these frames:

- The windup ball goes off-screen right (NDC x ≈ 1.2) and never comes near the eye.
- The follow-through leaves the frame low-left for R and low-right for L.

## Task 14 gate run — section 4 stays RED (L/R asymmetry in the strike-frame ball, not a
   connectivity issue)

After the Task 14 wiring (`FLAIL_FEEL.craterR` 0.09, `meterCredit` 0.18, the `headNeck`/
`neck.mid` snap batch, `handScale` 1.3), the gate's sections 1 and 4b went green, but
section 4 (crosshair-aimed head hits) did not. This is NOT the connectivity-coverage
question Task 14's step 4 anticipated ("if hit 4 does not take the head off, measure the
connectivity disc samples' coverage before changing `neckSeverR`") — `headHits` never
reaches 4, so the neck-snap sever is never even attempted.

**What the gate measured**, aiming the crosshair dead-on the head centre from 0.9 m
(alternating L, R, L, R over 4 clicks, deterministic — repeat clicks on the same side land
on the identical point since the zombie is frozen and the head hasn't moved):

| hit | side | wound limb/bone | toHead | toNeck | region? (regionDist 0.25 / neckDist 0.2) |
| --- | ---- | ---------------- | ------ | ------ | ----------------------------------------- |
| 1   | L    | torso/spine      | 0.371 m | 0.225 m | **false** (misses both thresholds) |
| 2   | R    | torso/spine      | 0.277 m | 0.158 m | true (within neckDist) |
| 3   | L    | torso/spine      | 0.371 m | 0.225 m | **false** (identical to hit 1) |
| 4   | R    | torso/spine      | 0.277 m | 0.158 m | true (within neckDist) |

`headHits` therefore reaches only 2 by hit 4 (misses hits 1 and 3), the head never comes
off, and every wound is a `torso/spine` hit, never a `head` prim.

**Root cause: `FLAIL_IMPACT`'s two sides are not equally close to the crosshair.**
`flail-swing.ts`'s strike-frame ball keys (`FLAIL_SWING.strikeT`, view-space) are:
`R: [-0.05, -0.36, -1.12]`, `L: [0.1, -0.36, -1.13]`. Both sides drop the impact point
~18° below the boresight (`y/-z` ≈ −0.32, matching the spec §11 root-cause paragraph's
measured 0.29–0.48 m miss from the head centre at the OLD `regionDist`-only check) — that
part is shared and is exactly what Task 13's `neckDist` was added to tolerate. But the
*horizontal* offset is not mirrored: R sits almost dead-centre (`x/-z` ≈ −0.045) while L
sits nearly twice as far off-axis (`x/-z` ≈ +0.089, same sign convention). The extra
horizontal miss on L pushes the 3-D distance to the neck root from 0.158 m (R, inside the
0.2 m `neckDist`) to 0.225 m (L, outside it by 2.5 cm) — small in isolation, but it is the
whole difference between "counts as a head hit" and "doesn't."

This is precisely what Task 15 ("The keys — strike on the crosshair, R as a big overhand
swipe") is scoped to fix: its own new test (`flail-swing.test.ts`) asserts
`y/-z` in [-0.1, -0.04] and `|x/-z| <= 0.1` for BOTH sides — i.e. it requires the strike
ball to land close to the crosshair on both axes, which the current keys clearly fail
(`y/-z` ≈ −0.32 on both sides, 3–8× outside that band). Task 14 does not touch
`flail-swing.ts` (out of its stated file scope), so this asymmetry is left for Task 15 to
resolve; section 4 is expected to go green once the strike-frame keys are re-authored
there, not by changing `FLAIL_HEAD.neckDist`/`regionDist` (flail-strike.ts, Task 13,
already covered by its own passing unit tests) or `neckSeverR` (untested here because
`headHits` never reaches the sever threshold).

The `head-hit-1..4.png` photos bear this out: the face crater never appears (every wound
lands on the chest/torso, out of frame low), and the head looks visually identical across
all four shots — it never takes any face damage, let alone comes off.

## Open feel questions for the owner

- **Strike reads as a mace, not a flail.** The chain is nearly straight and short at the
  hit. Should the strike key let the ball lag *behind* the haft line (a visible whip) rather
  than lead along it? That trades against "ball ahead of the hand".
- **The fist at rest** is just below the frame. Should it show more of the hand, and raise
  the ball a little with it?
- **The fill level** (0.018 of the torch) makes the iron read dark, with little specular.
  Try it a bit brighter?
- **The crater:** the new contrast measure reads it strongly (rise 51), and it looks big in
  the photo. Judge it in play.
