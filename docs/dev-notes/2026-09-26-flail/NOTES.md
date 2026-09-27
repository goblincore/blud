# Spike flail — gate and first look pass (Task 6)

Spec: [2026-09-26-spike-flail-design.md](../../superpowers/specs/2026-09-26-spike-flail-design.md).
Gate: [`scripts/flail-gate.mjs`](../../../scripts/flail-gate.mjs). Run it from bash with servers up:

```bash
. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
node scripts/flail-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
```

The gate runs in the sandbox (`seed=1`), in the arena (room 6, 8 zombies), with the zombies
frozen and hit-stop off. Each check uses a fresh zombie, and the player stands on the
arena-centre side of it.

## Gate output (2026-09-26, headless Chrome, WebGPU)

```
rest: ball NDC (0.54, -0.71), bolt (0.58, -0.03), grip (0.83, -1.05), ball r 0.115; ball↔bolt 0.326 m
rest clipping: ball {"n":7556,"clipped":0,"meanLuma":69.7}; haft {"n":56,"clipped":0,"meanLuma":58.8}
front hit: zombie 11 +1 wounds (radii 0.140); lastStrike {"side":"R","hits":[11]}; swing ball↔bolt worst 0.494 m, clamped on 5/30 frames
  R-G in the 40x40 crop: 79.9 before → 89.7 after
  crater at px (605, 671): R-G rise 9.8
PASS: front hit at 1.5 m: exactly one wound, radius 0.140, lastStrike holds 11
too far: zombie 12 at 2.2 m, side L: +0 wounds; lastStrike {"side":"L","hits":[]}
PASS: too far (2.2 m): no hit
too wide: zombie 13 at 1.2 m, turned 70°: +0 wounds; lastStrike {"side":"R","hits":[]}
PASS: too wide (70° off at 1.2 m): no hit
behead click 1 (L): neck y 1.48, pitch 0.193 (ray miss 2.8e-15 m); +2 wounds (y@radius/type 1.48@0.140/blast 1.48@0.112/blast); head prims 5/5
behead click 2 (R): neck y 1.48, pitch 0.193 (ray miss 5.9e-16 m); +1 wounds (y@radius/type 1.48@0.140/blast); head prims 0/5
PASS: beheading: the head is off after 2 neck-height click(s)
PASS: zero console errors or exceptions
GATE PASSED
```

All five checks passed on the first run. **No strike tuning was needed**: `FLAIL_FEEL`,
`FLAIL_STRIKE` and the impact keys are unchanged.

Staging notes:

- **Screen coordinates.** The canvas is letterboxed: it is 4:3, 1067×800 at x 107, inside the
  1280×800 window. The screen image is also warped by the fisheye post-pass. So `state().ndc`
  and the new `flail.toScreen()` return screen NDC *through the lens* (`reticleNdc`), and the
  gate maps NDC onto the canvas rect. Before this, the Task 5 smoke's ball crops sat about
  45 px off the ball.
- **Beheading.** The gate aims the strike's own eye → impact ray through the neck capsule's
  midpoint. It solves yaw and pitch in the page with the game's own `viewToWorld` and
  `FLAIL_IMPACT`, and re-solves before every click for that click's side, because R and L
  impacts differ in x.
- **Open question.** Behead click 1 added **two** blast wounds (0.140 + 0.112, same height)
  from one strike, while the torso front hit added exactly one. The flail hands `blast()`
  exactly one wound. The 0.112 = 0.8 × 0.14 companion must come from somewhere downstream.
  I did not track it down. The gate asserts "exactly one" only on the front hit, as the plan
  specifies.

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
- All 20 `flail-swing` tests pass unchanged: the speed-at-strike ratio (≥ 0.8), the
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
  - The fill is forward-route only.

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
  running down. It plainly reads as a big crater. However, the 40×40 R−G rise is **9.8**,
  just under the plan's 10. The torch already turns this skin saturated pink (R−G 79.9 before
  the hit), so there is little headroom for the metric to rise.
- `behead-after.png`: the head is off at the neck, with a large burst of blood and gore. The
  flail is back at rest, lower right, and the ball is not blown out.

**Clipping the camera.** Nothing clips the camera in these frames:

- The windup ball goes off-screen right (NDC x ≈ 1.2) and never comes near the eye.
- The follow-through leaves the frame low-left for R and low-right for L.

## Open feel questions for the owner

- **Strike reads as a mace, not a flail.** The chain is nearly straight and short at the
  hit. Should the strike key let the ball lag *behind* the haft line (a visible whip) rather
  than lead along it? That trades against "ball ahead of the hand".
- **The fist at rest** is just below the frame. Should it show more of the hand, and raise
  the ball a little with it?
- **The fill level** (0.018 of the torch) makes the iron read dark, with little specular.
  Try it a bit brighter?
- **The crater metric** is borderline (9.8) on torch-pink skin. Is the visual enough, or
  should the crater be bigger or deeper, or darker inside?
- **The neck strike made two wounds** (0.140 + 0.112) from one hit. Is that expected (for
  example, a seam or joint companion), or should it be tracked down?
