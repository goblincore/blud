# The spike flail (first player melee weapon, simplified) — Design

**Date:** 2026-09-26 · **Status:** v1.2 built (§11) and playtested; v1.3 built (§12); owner playtest pending
**Supersedes:** [the censer flail](2026-09-26-censer-flail-design.md). The owner playtested the censer
(physics head on a rope, dead-zone-driven strokes, tap/hold charge) and scrapped it: "too complicated
for what it is… very hard to land a good hit… looks way too goofy." This design replaces it with a
classic weapon on preset animations. Resolves Wake task W-B4.

## 1. What it is

A classic **ball-and-spike flail**. **Click** plays a preset swing; the next click swings back the other
way. On contact the zombie takes **one big wound crater**, with a stagger, a shove, and a sever when
the crater lands on a joint. No physics, no charge, no aim-dependent strokes: a click is a hit if a
zombie is in front of you.

## 2. Decisions (owner, 2026-09-26)

1. **Scrap the censer, keep the branch.** Strip the censer's systems from branch
   `claude/melee-weapon-design-7d1423` (PR goblincore/blud#22) and build the flail on top. The censer
   stays in git history.
2. **Swings: alternating left/right presets.** Right→left, then left→right on the next click; holding
   the button chains them.
3. **Hit test: a forgiving strike window.** At the strike frame, every zombie within reach and inside a
   wide arc in front of the player is hit; the crater lands where the ball's authored impact point
   meets the zombie's skin. No precise ball sweep.

## 3. Kept from the censer branch

- **The melee slot on key 1:** the `'censer'` slot is renamed **`'flail'`**, owned through the level
  inventory item `'melee'` (`ownsSlot` maps it); the other weapons stay on 2 (shotgun), 3 (dynamite)
  and 4 (flare); a melee-only loadout starts with it in hand; the `'melee'` pickup equips it when the
  player is empty-handed.
- **`ActorBlastEffect.reaction`** (`'blast' | 'flinch' | 'none'`, default `'blast'`) and the rule that a
  soft target (cultist) dies only from a `'blast'` reaction.
- **Gib shutter layer fixes:** the layer's own render-object pass id (no engage hitch), no demotion
  of a mesh another subject lifted, and the per-piece cap.

## 4. Removed

`censer-swing.ts`, `censer-head.ts`, `censer-hit.ts`, `censer-blur.ts` (and tests),
`game-censer.ts`, `game-seams-censer.ts`, `scripts/model_censer.py`, `public/assets/lab/censer.glb`,
`scripts/censer-gate.mjs`, `scripts/censer-look.mjs`, `scripts/censer-windup-sweep.ts`, and the
censer's own light list and flashlight fill (reinstated only if the flail's ball blows out under the
flashlight the same way). Any other code, seam, layer id or doc that exists only for the censer goes
with them.

## 5. Architecture

Logic lives in pure, renderer-free modules (the [plan template](../plan-template.md) rule); the game
file only reads their output.

| File | Job |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/flail-swing.ts` (pure) | Two keyframe tables, **R→L** and **L→R**, each giving the handle pose (view-space offset + rotation) and the ball's authored position (view space) over the swing. State: `idle` or `swing(side, t)`. A click starts the next side; a click in the last `bufferSec` of a swing is queued. Outputs per step: handle pose, ball position, and a **strike event** exactly once per swing at `strikeT`. |
| `src/lab/sdf-zombie/webgpu/flail-strike.ts` (pure) | On a strike: each actor whose torso centre is within `reach` of the eye and within `arcDeg` of the facing (horizontal angle) is hit. Impact point = the ball's authored impact position (world) **projected onto that actor's surface** by stepping along the distance-field gradient (`p ← p − ∇f·f`, a few iterations). Output: `{ actorId, point, dir }[]`, `dir` = unit vector from the eye to the point. |
| `src/lab/sdf-zombie/webgpu/game-flail.ts` | Haft + hand on the aim rig (the censer's `sync()`-after-camera ordering is kept, so nothing lags the camera). Ball and chain are drawn from the keyframes: chain as a slight catenary between the haft tip and the ball, with a small rest sway. On a strike: one `'blast'` wound per hit through `ZombieActor.blast()`, bleed, hit-stop, camera kick. Swing motion blur on the ball through the gib shutter layer if it is cheap to wire; otherwise later. |
| `src/lab/sdf-zombie/webgpu/game-seams-flail.ts` | `__sdfGame.flail.{ click, hold(on), state, limbAlive }` for gates. |
| `scripts/model_flail.py` | Headless Blender → `public/assets/lab/flail.glb`: a wooden haft with iron bands and a pommel, a short chain, and an iron ball with ~12 spikes. Nodes: `Haft`, `ChainAnchor` (child of `Haft`), `Ball`, `ChainLink`. |

## 6. Feel (starting numbers, tuned in play)

| | Value |
| --- | --- |
| Swing | 0.45 s: wind-back 0–0.12, strike at `strikeT` 0.18, follow-through to 0.45 |
| Buffer | a click in the last 0.15 s queues the next swing; holding the button chains |
| Reach / arc | 1.8 m from the eye; ±50° of the facing |
| Wound | one crater, radius 0.14 m, `severRadius` = radius × 1.3, wound type `'blast'` |
| Collapse meter | 0.35 per hit (≈ 3 hits drop a zombie); a crater on a joint (neck, shoulder, elbow, knee) severs it |
| Reaction | `'blast'`: stagger + ~1 m shove away from the player |
| Impact feel | 50 ms hit-stop, 0.02 rad camera kick, the slug's bleed |
| Multi-hit | every zombie in the arc is hit |

## 7. Edge cases

- Switching weapons or dying mid-swing cancels it; no strike fires after a cancel.
- A zombie hugging the player is hit (the arc starts at 0 m).
- Nothing in range: the swing plays, no hit (a whoosh).
- Walls do not block the strike in v1 (the arc test ignores level geometry). Add a line-of-sight check
  if hitting through thin walls shows up in play.
- A zombie hit twice in one swing is impossible: the strike fires once per swing.

## 8. Testing

**Unit (vitest):**
- `flail-swing`: sides alternate; the strike fires exactly once per swing, at `strikeT`, for any dt
  split; a click in the buffer window queues the next swing, and one outside it is ignored; holding
  chains swings; cancel returns to idle with no strike; handle and ball poses are continuous (no pops).
- `flail-strike`: reach and arc filters (in, too far, too wide); the surface snap lands within 5 mm of
  the skin on a sphere and on a capsule; two actors in the arc are both hit.

**In game, `scripts/flail-gate.mjs`** (headless, zombies frozen):
- a zombie 1.5 m in front gets exactly one new crater (radius ≈ 0.14) per click;
- a zombie at 2.2 m, or 70° off the facing, is not hit;
- strikes at neck height sever the head within 3 hits;
- zero console errors.

**Photos** for the owner: rest pose, mid-swing (both sides), the wound.

## 9. Later

Swing motion blur (if not in v1), embers or other flourishes, a line-of-sight check, severed limbs as
physical debris (its own TASKS row), demo recording of melee input.

## 10. v1.1 — owner playtest feedback (2026-09-27)

Decisions (owner, 2026-09-27), from the first playtest ("already feels better"):

1. **The ball and chain must move like a ball and chain: a whip.** Chosen: a *visual-only* chain
   simulation, **animation-guided**. A pure module `flail-chain.ts` simulates ~8 rope nodes in view
   space (position-based: gravity, damping, fixed link lengths, 240 Hz fixed step), pinned at the
   haft's eye bolt. The ball node is pulled toward the swing's authored ball position by a **guide
   weight**: loose through the wind-up (the ball lags the haft), ramping to exactly **1.0 at
   `strikeT`** (the drawn ball sits on `FLAIL_IMPACT`, so hits stay exactly where the strike window
   puts them), loose again through the follow-through (it whips past and wraps), and a light hold at
   rest (it hangs and sways). The strike logic is unchanged (`FLAIL_IMPACT`). Walking/turning does
   not jostle the chain in v1.1 (view-space sim).
2. **The hand is too small.** `FLAIL_LOOK.handScale` 0.8 → about 1.0, tuned from photos so more of
   the fist shows at rest.
3. **Iron look: keep.**
4. **Weapons clip walls** (all weapons): lower priority, its own TASKS row; not in v1.1.
5. **Decapitation is too instant: damage the head gradually.** Head-region hits are counted per
   zombie (a hit whose wound rides a `head` prim, or lands within 0.25 m of the head cluster's
   centre). Head hits **1–2**: a smaller **0.09 m** crater and **no sever** (`severRadius` 0), so the
   face and skull cave in progressively. Head hit **3**: the full 0.14 m crater with sever. Body hits
   unchanged.

Testing adds: chain unit tests (link lengths hold; the ball is exactly on `FLAIL_IMPACT` when
pinned on the strike frame, at 30–240 Hz and with jittered frames; the ball lags a fast anchor; it
hangs straight down at rest) and a head-rule unit test; the gate's
beheading check becomes "head still on after head hits 1 and 2, off on hit 3", with photos of the
face damage after each hit.

## 11. v1.2 — second playtest (owner, 2026-09-27) — BUILT 2026-09-27

Owner feedback: the whip is whippy enough; the post-swing settle is fine; the rest framing is fine.
Problems: (a) head hits still decapitate on the first hit in play; (b) the weapon is too powerful
(it drops zombies faster than the shotgun; it should take 4–5 hits); (c) the hand is still too
small; (d) the first swing (R→L) reads as "a weird weak punch" and should be **a big overhand
swipe** (the L→R cross-screen swing is fine); (e) the craters are too big (one chest hit opens a
gaping centre).

Approved changes (owner, 2026-09-27):

| Change | Now | v1.2 |
| --- | --- | --- |
| Hits to drop a zombie (`FLAIL_FEEL.meterCredit`) | 0.35 (~3 hits) | **0.18 (~5 hits)** |
| Body crater (`FLAIL_FEEL.craterR`) | 0.14 m | **0.09 m** (`severMul` stays 1.3) |
| Face crater (`FLAIL_HEAD.faceCraterR`) | 0.09 m | **0.06 m** |
| Head hits to sever (`FLAIL_HEAD.hitsToSever`) | 3 | **4** |
| Head region (`isHeadRegion`) | head prim, or < 0.25 m from the head centre | also **< ~0.2 m from the neck joint** (the head cluster's attach point), so neck and upper-chest hits count as head hits and cannot sever early |
| Impact point (`FLAIL_IMPACT`, the strike keys' ball) | ~0.35 m BELOW the crosshair (chest height) | **on or just below the crosshair** (view y ≈ −0.05…−0.1), so you hit what you aim at |
| First swing R→L keys (`flail-swing.ts` KEYS_R) | forward jab | **big overhand swipe**: wind up high over the right shoulder (ball above and behind the frame's top right), then a heavy diagonal down onto the crosshair |
| L→R keys | — | unchanged, except the strike ball moves to the crosshair |
| Hand (`FLAIL_LOOK.handScale`) | 1.0 | **~1.3** (rest framing unchanged) |

**Decapitation cause: CONFIRMED 2026-09-27** (crosshair-on-head probe: at 0.9 m the chest crater sat 0.16 m from the neck root and cut the head on hit 1). The hypothesis was: the impact point is authored ~0.35 m
below the crosshair, so aiming at the head puts the crater on the neck or upper chest. That is more
than 0.25 m from the head centre, so the hit is not a "head hit" and the full crater (sever 0.18)
cuts the neck. Confirm it FIRST with a gate case that aims the CROSSHAIR at the head (as a player
does), not the strike ray at the neck as the current gate does. Also rule out other paths: head
pop, collapse/death dismemberment, and a torso prim near the neck.

Acceptance (gate):
- Aiming the crosshair at the head: the head stays on after head hits 1–3 and comes off on the 4th.
- A body zombie needs ≥ 4 hits to collapse (target ~5).
- Chest craters are about 0.09 m.
- All current checks still pass (positive controls, reach/arc refusals, strike-frame ball pin at
  60 and 144 Hz, zero console errors).
- Swing tests stay green (speed-at-strike ratio, overshoot, pops, reach ≤ 0.37 m, min ball–bolt
  ≥ 0.28 m, whip gates).
- Photos: an R overhand frame strip, and the head after hits 1–4.

**As built (2026-09-27):** as the table, plus: the 4th head hit also stamps a **neck-snap** wound at the
neck midpoint (sever calibre 0.12 m, visible carve 0.02 m), so the head comes off wherever on the head the
last blow lands; `neckDist` is 0.2 m from the neck root. Strike balls at view y −0.08 (≈4° under the
crosshair). Gate green: head on after hits 1–3, off on 4; collapse on hit 5; no limb severed by chest hits.

## 12. v1.3 — third playtest (owner, 2026-09-28) — BUILT 2026-09-28

Owner feedback on v1.2:
1. It needs a horizontal swipe across the screen, perhaps as the 3rd click of a quick chain.
2. It should hit where you point. It mostly does, but exact aim is sometimes hard (not a big deal).
3. Zombies are still too easy to take down.
4. The flail should **not decapitate at all**. The head should take more granular damage instead: an eyeball
   popping out comically on a pink stalk, the head's flesh deforming, the scalp and forehead exposing the
   skull (hard to reach today, so fudge the aim), and the brain destroyed, with matter or a whole brain
   flying out.

**Decisions (owner, 2026-09-28):**
- **Split.** v1.3 is items 1–3 plus "no decapitation". The granular head damage (item 4) gets its own spec,
  the *melee head damage model*, designed after v1.3 ships.
- **The sweep is the 3rd hit of a combo** (chosen over always cycling or a second button).
- **About 8 body hits drop a zombie.**

### 12.1 The combo: overhand → cross → horizontal sweep

- `flail-swing.ts` gets a third side, **`'H'`**: a flat **right-to-left** sweep at crosshair height.
  - It winds up wide on the right at shoulder level, sweeps through the crosshair, follows through far
    left, then returns to rest.
  - Length is about **0.55 s**, with its strike at about **0.2 s**. R and L stay at 0.45 s with the strike
    at 0.18 s.
- **Combo rule.** Swings advance **R → L → H → R** when chained. A swing is chained if its click was
  queued during the previous swing (the existing `bufferSec` queue, or a held button), or the click lands
  within **`comboWindowSec` 0.35 s** after the previous swing ends. Otherwise the swing starts at **R**.
- **Key quality.** The H keys must pass every predicate R and L pass:
  - the chain nearly taut at the strike (the ball 0.34–0.36 m from the bolt);
  - the ball at least 0.28 m from the bolt all swing;
  - the ball within chain reach at every key;
  - at most 3 cm overshoot;
  - no speed jump over 2×;
  - at least 0.8 of peak speed at the strike;
  - no pops;
  - the strike on the crosshair (`y/−z` between −0.1 and −0.04, `|x/−z|` ≤ 0.1).

  The H ball at the strike must also move mostly sideways (|vx| ≥ 2·|vy|).
- **Chain pin.** The chain sim's strike-frame pin (ball on `FLAIL_IMPACT.H`) holds at 30–240 Hz and on
  jittered frames, like R and L.

### 12.2 Per-swing feel (`FLAIL_FEEL`)

| | R / L | H (sweep) |
| --- | --- | --- |
| Arc (`inStrikeArc`) | ±50° | **±70°** |
| Collapse credit (`meterCredit`) | **0.10** (was 0.18) | **0.14** |
| Shove | 6 | **9** |
| Hit-stop | 50 ms | **70 ms** |
| Crater | 0.09 m (`severMul` 1.3) | 0.09 m |

The collapse threshold is 0.8, so a zombie drops on the **8th** body hit, or the 7th when an H is among
the hits.

### 12.3 The flail never decapitates

- A head-region hit is **always** a 0.06 m face crater with `severRadius` 0. The head region is:
  - a hit on a `head` prim;
  - a hit within 0.25 m of the head centre;
  - a hit within 0.2 m of the neck root.
- Remove `hitsToSever`, `snapNeck`, the neck-snap wound, `neckSeverR` and `snapCarveR`.
- `headHits` stays as a counter. The head damage model will use it.
- Arms and legs can still be cut at a joint, as now.

### 12.4 Aim: the hit goes where the crosshair points

`resolveStrike` casts its ray along the **view forward** (the crosshair) instead of eye → `FLAIL_IMPACT`,
keeping the fallback ray to the torso centre and the surface snap. `FLAIL_IMPACT` still drives the drawn
ball, which lands about a ball-width under the crosshair on the strike frame.

### 12.5 Testing

**Unit (vitest):**
- the combo order, the window edge (0.35 s in and out), reset after a pause, a held button chaining
  R → L → H → R, and exactly one strike per swing at any dt;
- the H key predicates above;
- per-swing arc and feel lookups;
- the head rule never severs (`severRadius` 0 on any head-region hit count);
- the crosshair ray.

**Gate (`scripts/flail-gate.mjs`):**
- three chained clicks strike R, L, H in order;
- H hits two zombies standing 55–65° either side of the facing, while R and L clicks from the same spot
  hit neither;
- **8** crosshair-aimed head hits: the head stays on, every hit is a 0.06 m crater within 0.15 m of the
  head centre;
- a body zombie collapses on hit **≥ 7**;
- every crater lands within 5 cm of the crosshair ray;
- the strike-frame ball pin holds for all three sides at 60 Hz and at 144 Hz (steady and jittered);
- the existing reach and arc refusals and the zero-console-errors check still pass.

**Photos:** an H frame strip (`look/sweep-H-strip.png`) and the face after 8 hits.

### 12.6 Next: the melee head damage model (its own spec)

Staged, flail-specific head destruction on the zombie:
- the eyeball pops out on a stalk (reuse `head-pop.ts`'s eyeballs and optic nerve);
- the head's SDF flesh dents and deforms;
- the scalp tears to expose the skull (the zombie's hidden skull bone), with an aim fudge so the crown can
  be reached;
- the brain is destroyed, with matter or a whole brain flying out, as the head kill.

Designed after v1.3 ships.

## 13. v1.4 — fourth playtest (owner, 2026-09-29) — BUILT 2026-09-29

Owner feedback: (1) aiming at the head still hits the body; (2) the zombie goes down too fast; (3) "the
animations need work": the ball should swing back, then **drag behind the swing**, but it always stays in
front.

**Findings (live, unfrozen zombies, free aim, hit-stop on):**
- Aiming at the head, the strike ray passes 1–3 cm from the head centre, but the zombie's raised arms are in
  front of its face and the ray meets the forearm first (a strike point 53 cm from the head centre, the
  wound on `armL`).
- The zombie lunges during the 0.17 s from click to strike: the head moved 13–28 cm on 3 of 7 swings.
- The collapse meter counts every hit, head and body alike, so mixed hits drop a zombie in about 8 swings
  (`phase falling` at head hit 3 after 5 body hits).
- Ball: the chain's guide (`swingFloor` 0.3, `guideRate` 140: a time constant of about 24 ms) holds the
  ball to its authored key through the whole swing, so it trails the haft by at most ~13 cm and reads as
  always in front.

**Decisions (coordinator, from the feedback; the owner can veto in play):**
1. **Head magnet.** If the strike ray passes within `headMagnetR` (0.18 m) of a zombie's head centre at
   the strike, the hit lands on the head (the head surface point nearest the ray), whatever is in front of
   it. This is a forgiving strike window in the spirit of §2.3.
2. **Toughness.** Body hits add 0.065 to the collapse meter (R and L; H 0.09), about 12 hits. Head hits add
   0.02: the head model kills, not the meter. Head strips: 0.20 (R, L) and 0.28 (H); `skullPerHit` 0.34, so
   a head kill takes about 7–10 hits.
3. **Ball drag.** Through wind-up and swing the ball is nearly free (the guide floor drops from 0.3 to
   0.05), so it swings back behind the hand and trails the haft; the guide ramps up only in the last 60 ms
   before the strike, which stays exactly on `FLAIL_IMPACT`, and releases after it (the follow-through
   whips). The wind-up gets a visible "back" beat: the hand draws back and the ball swings out behind it.

**As built:** the head-only field is `sdBody` over the live head clusters; `skullPerHit` is 0.25 (not 0.34: at
0.20 strips, 0.34 killed a single region on hit 6); body collapse on about hit 11, head kill on about hit 8; the
ball drag needed a wind-up hold and a back-beat key per swing as well as the lower guide floor. See NOTES.

## 14. v1.5 — impact and viscera (owner, 2026-09-29)

Owner feedback (fifth playtest, plus a screen recording played back):
- Hits still lack impact: "more of a recoil or judder from the impact".
- In the recording the head expanding and the rest are there, but "at game speed it was easy to miss";
  "make it feel a little slower, just slightly slower".
- "Apply some shutter blur to the chain/ball motion", and "it would be cool if it accumulated shiny blood".
- The flesh removal on the face is not visceral: thicker flesh, "more splayed edges with red shiny matter".
- "Both eyes should pop out of the sockets at once."

Decisions (owner, 2026-09-29): build **v1.5a (impact)** first, then **v1.5b (flesh)** once it has been felt.
All four impact options were chosen (view-model recoil, camera judder, stronger hit-stop with an FOV punch,
a zombie reaction) and the three flesh options (torn lips, flying flesh chunks, red matter strings).

### 14.1 v1.5a — impact

Every effect scales by swing: R and L 1.0, H 1.4; head-region hits add 20%.

1. **A slightly slower feel.** After each contact the game's time scale steps to 0.4 and eases back to 1.0
   over 0.3 s (H: 0.35 and 0.4 s). This follows the hit-stop (R/L 70 ms, H 100 ms, was 50/70). It is the
   same time-scale channel as the hit-stop (`hitStopScale`), so the wobble and the zombie's reaction play
   inside it.
2. **View-model recoil.** The flail rig kicks on contact: about 0.10 m back, 0.04 m up, 12° pitch and 5°
   roll, sprung with an overshoot or two over about 0.3 s. The chain gets a jolt: its guide relaxes for
   about 50 ms, so it snaps taut and whips.
3. **Camera judder.**
   - The pitch kick grows from 0.02 to 0.045 rad and recovers with a small overshoot instead of a pure
     exponential.
   - A damped shake runs for about 0.3 s on the existing eye-offset channel (`player-hit-feedback.ts`, 23 Hz),
     plus a little roll.
4. **FOV punch.** A 3° pinch in about 60 ms and back over about 0.2 s. The lens is re-synced with
   `postAa.setLens` as `game-main.ts` requires.
5. **The zombie takes it.** The shove is bigger, and a head hit adds a head-snap impulse at the head.
6. **Shutter blur** on the ball and chain during swings, through the existing gib shutter layer
   (`gib-motion-blur.ts`).
7. **Blood on the flail.** Each hit adds blood to the ball, chain and haft: a red, glossy tint that pools
   on the spikes. It dries slowly (about 2 minutes) and persists between swings.
8. **Both eyes pop at once (head model).**
   - When either eye pops, the other pops too, from whatever state it is in (painted or in its orbit):
     its painted glow goes out, its orbit gets a crater (that orbit's flesh is set to the exposure
     threshold) and it dangles on its own stalk.
   - The next head hit, or death, snaps both together.
   - Both sockets are dark plugs. The eye cost roughly doubles while both dangle: accepted, and cut if
     the profile says otherwise.

### 14.2 v1.5b — flesh (after v1.5a is felt)

- **Torn, splayed lips.** Flail wounds get the existing `ragged` option (a lobed outline) and a thicker,
  higher, splayed rim shaded wet-red and glossy over a glossy-red interior and a darker clot floor. Head
  craters get bigger and deeper. Gated so the shotgun's wounds are unchanged by default.
- **Flying flesh.** Each hit throws 3–5 wet meat bits, with a bigger, faster gout (more on head hits),
  capped and pooled.
- **Red matter strings** (stretch). Wet red drops that cling along the rim and slowly sag and drip.
