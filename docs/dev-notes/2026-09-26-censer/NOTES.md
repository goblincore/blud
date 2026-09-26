# Censer flail — in-game gate, first tuning pass, look pass (Task 9)

## For the owner

**How to try it.** `npm run dev` opens the game; Night Train starts with the censer in hand, or
press **1** anywhere you own it. Free aim (**G**, on by default) lets the weapon drift inside the
dead zone — **where it sits picks the stroke**: high → an overhead slam, low → an uppercut,
right/left → a hook back across, centred → a diagonal forehand.
- **Tap** the left button (under 0.18 s) for a quick stroke.
- **Hold** to wind up — the censer whirls in the stroke's plane and charges over 1 s — and
  **release** for the heavy stroke. You can drift the weapon while spinning to aim the slam.
- **Where to aim.** The head is fastest ~0.9–1.3 m in front of you and well below eye level.
  Stand about arm-and-chain's length from a zombie (1–1.3 m) and hit its chest or hips. A tap
  aimed at the chest from close up tends to land on the curve of the torso at a glancing angle:
  it gouges, but the crater is small (3 cm) and hard to see. Hooks land squarer (6 cm craters).

**Decided (2026-09-26): charged release timing is a skill.** A full charge swings at ~13–20 m/s
depending on where in the orbit you let go — the stroke either adds to the whirl or fights it.
Kept on purpose, not flattened. (Every full charge now *does* spin up; see Part B below.)

**Things to know, and open questions:**
1. **Glancing heavy blows now leave NOTHING**, not a smaller wound: a blow with under 30% of its
   speed going into the skin skids off unless it turns into the flesh further along. Should a fast
   glance leave a scrape instead?
2. **Severing is generous.** `severMul` 1.6 applies to *every* wound sphere, taps included: a
   well-placed tap takes a forearm off at the elbow on the **2nd** hit (the spec said ~3), and the
   one full-charge slam that took the head off **took the right arm too** (its crater sat on the
   shoulder). A decapitation needs that much: the neck's cut section sits inside the shoulders.
   The margin for the head is thin (a slam 1 cm further out fails). Want a heavy-only sever
   multiplier instead, so taps sever less?
3. **Reach.** Should the sweet spot move up toward the reticle, so chest taps land square?
4. **Hit-stop and the camera kick are untested** — the gate runs with hit-stop off. Judge the
   30–70 ms pause and the kick in play.
5. **The look** — the head's fill light (1.8% of your torch), the hand at ×0.8 and the faint
   resting smoke are first guesses from screenshots.

---


2026-09-26. Plan: [`2026-09-26-censer-flail.md`](../../superpowers/plans/2026-09-26-censer-flail.md) Task 9.
Spec: [`2026-09-26-censer-flail-design.md`](../../superpowers/specs/2026-09-26-censer-flail-design.md).
Earlier notes in this folder: [`NOTES-blur-hitch.md`](NOTES-blur-hitch.md) (Task 8b).

Everything here is headless (Chrome `--headless=new`, WebGPU, 1280×800), on
`/sdf-game.html?seed=1&vhs=off&loader=0`. The sandbox's **arena (room 6) holds 8 zombies**, so
no `?spawn=` was needed; the gate picks the room with the most zombies.

## Running

```bash
# bash, not zsh (scripts/lab-servers.sh header)
. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
node scripts/censer-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"   # the gate, ~4 min → gate/
node scripts/censer-look.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"   # look metrics → look/ (TAG=before|after)
npm test -- censer gib-shutter && npx tsc --noEmit
```

## 1. The gate — `scripts/censer-gate.mjs`

Final run (after the tuning and the look pass):

```
PASS: taps land from all four sides; 4/4 gouges run the stroke's way
PASS: a full-charge slam severs the head
PASS: three taps sever the arm
PASS: a tap at nothing adds no wounds (nearest zombie 5.2 m)
PASS: no console errors
GATE PASSED
```

**Staging to the real reach.** The plan's fixed `DIST 0.95` and "pitch at the limb" did not
match the swing that exists now (an arc about the shoulder with an end-brake whip). Each stroke
is first **calibrated** at the arena's empty centre (5.2 m from the nearest zombie): swung at the
air at pitches −0.6…0.3 in 0.1 steps, recording the head's path relative to the eye. The fastest
point where the path crosses the target's height, in front (0.6–1.7 m out) and moving the
stroke's way (down for a slam, up for an uppercut), picks the pitch; the player is then stood so
that point lands on the target. The pitch has to be part of the search: the swing is authored in
view space and gravity is not, so the same stroke lands elsewhere at another pitch (a first
version that solved the pitch by secant on a fixed calibration flip-flopped by 0.2–0.5 m).
Strokes are deterministic — the grip (Part B) erases whatever the head was doing before the press
— so the calibration stroke is the stroke that gets swung (verified: 4 heavy strokes from
different pre-states produced identical paths to 1 cm).

**Where the strikes are aimed, and why.**
- Taps: the torso centre, one fresh zombie per side, approached from the room centre.
- **Slam: onto the top of the shoulder beside the neck, from behind** (the flail's centre 0.15 m
  to the side, 0.02 m behind, 0.10 m above the neck base). The head's section is tested at the
  **neck base** (connectivity.ts `cutLimbs`), which sits ~8 cm *inside* the shoulders, and the
  skull hides the nape from above. Measured: straight down on the nape hit the skull glancing
  (6–12 m/s into it of 19); 13–24 cm behind the neck it landed on the upper back at 8 m/s or
  missed; beside the skull it comes down square on the trapezius (14–20 m/s into it).
- Arm: **hook taps (weapon parked right) at the elbow joint**, from the arm's own side. Cuts are
  decided at joints (`cutChains`), not mid-limb; aiming at the upper arm's middle carved it and
  never cut.

**Per case (final run)** — wounds are the censer's spheres on that zombie (crater + gouge);
R−G rise is mean red minus mean green in a 40×40 crop on the crater, after − before, from a
look camera aimed at the target (the stroke's own framing often has the target at the lens
edge):

| Case | Pitch | Wounds (radii m) | Peak head speed | Into the surface | Gouge on screen vs stroke | R−G rise |
| --- | --- | --- | --- | --- | --- | --- |
| tap high (slam dir) | −0.5 | 4 (.032 .025 .020 .016) | 11.7 m/s | 4.8 m/s | dot 0.77 | −4.8 |
| tap low (uppercut) | −0.2 | 4 (.026 .021 .017 .013) | 8.0 | 3.9 | dot 0.53 | −0.3 |
| tap right (hook left) | −0.5 | 4 (.060 .048 .038 .031) | 14.3 | 9.9 | dot 0.35 | 27.5 |
| tap left (hook right) | −0.5 | 4 (.060 .048 .038 .031) | 13.0 | 9.6 | dot 0.34 | 1.0 |
| full-charge slam | −0.5 | 9 (crater .112 …) | 19.9 | 13.8 | — | 20.4 |
| 3 hook taps, elbow | −0.3 | 3 + 5 + 4 | 12.1 / 11.5 / 11.5 | — | — | — |

Sever readbacks: slam — head prims **5 → 0** (and the zombie's right arm, whose shoulder ball
took the crater, came off with it); arm — armR prims **4 → 2** on the **second** tap (forearm
and hand off at the elbow), unchanged by the third.

Honest reading of those numbers:
- **Every tap gouges** (4 spheres, the crater + the cap of 3), and all four gouges run the
  stroke's way on screen, but the hooks only just (dot 0.34–0.35 against the gate's 0.3): the
  gouge on a round torso bends round it.
- **R−G > 10 (the plan's "a wound that reads") in 2 of 5**: the right hook (27.5) and the slam
  (20.4). The high/low taps land at 4–5 m/s into the skin — the head arrives on the curve of
  the torso — so their craters are floor-sized (0.03 m) and do not read in a 40 px crop; the left
  hook's crater sits under the hanging arm, out of the look camera's view.
- Wound radii: a tap's crater is 0.06 only when ≥ 9 m/s goes into the skin; glancing taps are
  0.026–0.034.

## 2. Part B — why in-game heavies peaked anywhere from 2 to 19 m/s

Measured with `state().headSpeed` every frame (`.lab-tmp/p2.mjs`), hit-stop off, no zombie in
reach, aim fixed (so the steer rate, `velScale` and hit-stop are out of it), 1/60 frames.

**Cause 1 — the FOV-compensation rig squeezed the swing (a bug).** The censer's rig hangs under
the view model's `fovRig`, scaled (s, s, 1) with s = `viewmodelFovScale` ≈ 0.735 at the default
lens. The swing's handle excursion (authored in true metres in the pure model) was applied raw,
so the arc and the wind-up circle ran ~26% small sideways and vertically. Tap: **8.6 m/s in game
vs 13.1 in the model**. Fix (`game-censer.ts anchorWorld`): the excursion is divided by the rig's
x/y scale; the rest pose stays framed. After: tap **13.0**, its per-frame trace identical to the
model's.

**Cause 2 — the wind-up only formed its orbit from a head hanging still (a model fragility).**
The reel-in during a recover conserves the head's spin, so the reeled head was still whirling at
4–5 m/s at idle entry and 1.8 m/s a second later. Pressed then, the open-loop windmill drove the
anti-phase wobble instead of the orbit: a **full charge swung at 2–5 m/s in 4 of 13 in-game
presses**; the pure model reproduced it (3% of 1,280 presses after a previous stroke, 14% of
overhead ones). Fix — the hand holds the chain (`censer-swing.ts handHold` →
`censer-head.ts HandHold`):
- **grip** (`gripHold 14`/s): the head's velocity *relative to the hand* is damped from the press
  through the choke-up, so it is carried with the hand;
- **the wrist** (`spinFloor 2 → 9 m/s` by charge): during the wind-up, once paying out, the head's
  speed round the knot in the stroke plane is held up to a floor (never braked). A floor of 13
  also sped up the orbit's slow top and cost the heavy up to 2.6 m/s at some release phases;
  9 does not.

Tried and dropped: making the hand *wait* for the head (limiting its lead round the circle) —
every setting made the capture worse (36 → 186 failures of 256 overhead presses).

After: 0 of 1,280 pure-model presses fail; **every in-game full charge spins at 17–19 m/s**.

**What remains is a real feel property: the release phase.** A full charge released at a
different point of the orbit peaks at 13–20 m/s in game; the pure model, sampled finely (48
phases), gives 14.5–21. The stroke's arc either adds to the orbit or fights it. **Owner
decision (2026-09-26): kept as a timing skill** (spec §2, decision 6). Checked and not the cause: collisions with level boxes (arena
centre, no box within reach), hit-stop (off), `velScale` (no bodies), dt (1/60 both), the camera
anchor (the knot is re-read off the final camera; the physics lags one frame, invisible).

## 3. Part C — the tuning log

| # | Constant | Old → new | Why / result |
| --- | --- | --- | --- |
| B1 | `game-censer anchorWorld` | raw → ÷ fovRig scale | Part B cause 1 |
| B2 | `CENSER_SWING.gripHold` (new) | — → 14 /s | Part B cause 2 |
| B3 | `CENSER_SWING.spinFloor` (new) | — → [2, 9] m/s over charge [0.3, 0.85], gain 8, ≤ 40 m/s² | Part B cause 2 |
| 1 | `CENSER_HIT.severMul` | 1.15 → 1.6 | slam: crater 0.11 at 0.163 m from the neck base → sever 0.176 < the 0.208 needed (distance + 0.045 girth): **fail** |
| 2 | `CENSER_HIT.heavy.craterR` | 0.11 → 0.12 | sever 0.192: **fail** |
| 3 | `CENSER_HIT.heavy.craterR` | 0.12 → 0.13 | sever 0.208: **head off** (union with the first gouge sphere). Stopped here. |
| 4 | `CENSER_SWING.gripRest` (new) | 0 → 3 /s | the dangle kept whirling for seconds after a stroke; a tap's 3-frame press grips too briefly to settle it, so the gate's three identical arm taps landed 0.07, 0.20 m and nowhere from the elbow. Now they repeat to 1 mm. |
| 5 | `CENSER_HIT.glanceFrac` (new) 0.3, `grazeDepth` (new) 0.035 | behaviour | a contact is a GRAZE unless ≥ 30% of the head's speed goes into the skin; a grazing head slides on inside the contact shell and strikes where it turns in. Before: a slam that brushed the skull was disarmed and plowed into the shoulder leaving **no wound at all**; a 1.9 m/s brush (of 20) spent the stroke's one crater on a floor-sized dent. Two unit tests, both failing on the old code. |
| — | `CENSER_REST`, `ropeLen`, `tap.craterR` | unchanged | reach was never the problem once staged to the real sweet spot; taps sever at 0.06 with severMul 1.6 (0.096, the grapeshot's proven 0.10) |

The plan's order was followed (severMul in steps up to its 1.6 cap, then `heavy.craterR` in 0.01
steps, cap 0.14). I stepped `severMul` straight to its cap because the measured requirement
(×1.9 at 0.11) was already past it; rounds 1–3 are single measured runs each.

Also found by the gate, and fixed with it (not tuning):
- **`__sdfGame.censer.limbAlive` said 5 of 5 head prims alive after a decapitation.** A full-limb
  sever (`sever.ts severLimb`) marks the *cluster* dead and leaves the prims' `dead` flags alone
  (only a distal cut marks prims). The seam now counts prims of live clusters only. Before this
  fix, rounds with severMul 1.6 / craterR 0.14 had already taken heads off while the gate said no;
  the log above was re-measured from the original constants with the fixed seam.

## 4. Part D — the look pass

Measured by `scripts/censer-look.mjs` on one frozen frame per number, as DIFFERENCE shots (the
part hidden with `__sdfGame.censer.hide`, or the blur off), standing 2.3 m from a zombie in the
arena. `look/before-metrics.json` vs `look/after-metrics.json`.

| Item | Before | After | Change |
| --- | --- | --- | --- |
| 3. Head at rest: clipped pixels (max ≥ 245) / mean luma | **97.8% / 251** | **7.6% / 89** | the torch swapped for a fill in the censer's own light list |
| 2. Hand (arm + bracer) share of the frame | 2.56% | 1.80% (−30%) | arm ×0.8, fist at the haft's foot, IK shoulder lower/right |
| 4. Chain contrast kept under blur, heavy recover (f22) | **0.07** | **0.59** | chain gain 1 → 0.12 |
| 4. Chain, tap f8 / f7 | 0.53 / 0.76 | 0.77 / 0.82 | |
| 4. Haft, tap f7 (its worst frame) / other frames | 0.67 / ≥ 0.94 | 0.71 / ≥ 0.96 | haft gain 0.35 → 0.2 |
| 1. Smoke contrast (rest / spin / after a stroke) | 40 / 23 / 21 | 16 / 16 / 13 | softer, greyer |
| 1. Smoke blob elongation, median (spin / after) | 1.6 / 1.3 | 3.3 / 3.4 | wisps, not bubbles |

(Blur retention = the mean, over the part's own pixels in the sharp frame, of how much of its
contrast against the room survives with the blur on; 1 = as sharp as blur off. The "before"
blur numbers were re-shot with the old gains on the new lighting, so they isolate the gains.)

1. **Smoke** (`CENSER_LOOK.smoke`): each puff is stretched along the head's motion when it was
   shed (along its rise at rest) — length = size × (1.6 + 0.3 × speed, ≤ 3.5), width 0.45 ×
   size — rolled to that direction on screen, fading in over the first 15% of its life and out
   quadratically, drifting sideways. 30 pooled puffs, one every 0.075 s (was 0.05), living 2.2 s
   (was 1.4), alpha 0.3 peak (was 0.35 flat-decay), colour 0x96938f (was warm 0xb8b0a4). Same
   overlay scene, same texture. Photos: `look/ba-smoke-spin.png`, `look/ba-smoke-rest.png`.
   At rest it is now faint — a thin haze above the knot.
2. **The hand** (`CENSER_LOOK.handScale 0.8`, `handGrip 0.0` m up the haft (was 0.03),
   `handShoulder (0.35, −0.47, 0.08)` (was the gun arms' 0.26, −0.30, 0.06)). The fist sits at
   the haft's foot with the ribbon-wrapped grip showing above it; the forearm leaves the frame
   down the corner. `look/ba-rest.png`.
3. **The head's blow-out** was the player's torch, not the coal: the flashlight hangs ~1 m above
   the eye at intensity 90 with a 1.6 decay, and the head (~0.9 m from it) took ~4× a zombie
   two metres out. The censer's own light list (it already had one, for the blur layer) now
   leaves out the torch and its shadow twin and carries a **fill** instead: a SpotLight with the
   torch's pose, cone and colour, **no distance falloff**, at 1.8% of the torch's live intensity
   (`CENSER_LOOK.flashFill`; it dims and flickers with the torch and is 0 when the torch is off).
   It lives on render layer 30, which no camera draws, with `userData.onlyRooms` empty, so
   neither three's default lists nor the level's per-room lists pick it up. The GLB materials
   were right (RustIron 0.30/0.13/0.07, metal 0.15, rough 0.9; CoalGlow emissive ×6); no
   material or tone-mapping change. Tried: no torch at all (dark but readable), fill 1.5–4 —
   1.5–2 reads as rusted iron, 4 goes copper. `look/ba-rest.png`; the grid of variants is
   `.lab-tmp/lightvar-grid3.png` (not committed).
4. **Blur** (`censer-blur.ts`): `CENSER_HAFT_BLUR_GAIN` 0.35 → 0.2; new
   `CENSER_CHAIN_BLUR_GAIN` 0.12 (was effectively 1) scales the chain's ring end (its knot end
   rides the haft's gain). The chain now survives the recover (`look/ba-heavy-recover-blur.png`:
   before, no chain; after, a clear chain). **The haft barely moved** (0.67 → 0.71 at its worst
   frame): in the frames I could measure it is mostly out of frame or behind the fist when it is
   fastest (`look/ba-tap-f7-blur.png` looks alike before and after). If the owner still sees it
   vanish, the next lever is the head's own streak, which is what dominates those frames.

## Photos

Gate (`gate/`), final run:
- `censer-rest.png` — **rest pose**, 1.6 m from a zombie: rusted head with its slot glowing,
  smaller hand at the haft's foot, haft and knot readable.
- `tap-{high,low,right,left}-mid.png` — the stroke's own framing at the calibrated sweet frame.
  **Two are poor photos**: the staging looks 0.5 rad down and the hooks' sweet point is off to
  the side, so for the two hooks the zombie is out of frame (`tap-right-mid.png` and
  `tap-left-mid.png` show only the wall and floor). **`tap-high-mid.png`** is the good one — the
  zombie's chest with the blow landing, red, on the upper chest; `tap-low-mid.png` is point
  blank on the face with the haft in front.
- `tap-{side}-wound.png` — the look camera on the target after the hit. `tap-right-wound.png`
  shows the censer head against the flank with blood (R−G +27.5); the craters themselves are
  small and partly under the hanging arm.
- `slam-spin.png` — the wind-up, 12 frames before the release.
- `slam-strike.png` — the sweet frame: the head is **already off** (the hit lands a frame or two
  earlier), the arm and haft blurred.
- **`slam-after.png` — the severed head**: a headless torso with the neck stump, blood gibs
  above it, the head on the floor at the left, the censer at rest.
- `arm-third-tap.png` — the third hook tap mid-stroke.
- **`arm-after.png` — the arm sever**: the forearm is gone below the elbow (stump with blood),
  the forearm lying on the floor behind.
- `negative-mid.png` — a tap at nothing at the empty centre.
- `gate-rows.json` — the per-case numbers above.

Look (`look/`): `ba-rest.png` (**rest, before | after**), `after-rest-night-train.png` (the
same rest pose on Night Train, where the loadout starts with the censer: the head reads as rusted
iron there too), `ba-tap-f7-blur.png`,
`ba-heavy-recover-blur.png`, **`ba-smoke-spin.png`, `ba-smoke-rest.png` (the smoke)**, plus the
raw frames (`before-*`, `after-*`, `blur-before-*`) and both metrics JSONs.

## Open feel questions for the owner

Moved to the top ("For the owner"). Release timing is decided: a skill.

## Update after the branch review

- **A graze that turns into flesh now strikes at game step length** (`6e0163dc`). The grazing
  branch bailed on `grazeDepth` before judging the blow; at 16–20 m/s the head moves 6.7–8.3 cm per
  240 Hz substep, so the substep it turned into the shoulder was already past the depth and left
  no wound. The skull→shoulder test now runs at 5 mm and at `speed / CENSER_HEAD.stepHz`; the two
  step-length cases fail on the previous code. The gate still passes (same numbers).
- Cleanups (`5f0a187b`): no per-frame allocation in the censer's tick, `CENSER_FILL_LAYER`
  registered beside `GIB_BLUR_LAYER`, the wind-up sweep committed as
  `scripts/censer-windup-sweep.ts`.
