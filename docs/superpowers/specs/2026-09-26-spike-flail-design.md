# The spike flail (first player melee weapon, simplified) — Design

**Date:** 2026-09-26 · **Status:** v1 built and playtested; v1.1 (§10, whip chain + gradual head damage) in progress
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

Testing adds: chain unit tests (link lengths hold; the ball is exactly on target at guide 1; the
ball lags a fast anchor; it hangs straight down at rest) and a head-rule unit test; the gate's
beheading check becomes "head still on after head hits 1 and 2, off on hit 3", with photos of the
face damage after each hit.
