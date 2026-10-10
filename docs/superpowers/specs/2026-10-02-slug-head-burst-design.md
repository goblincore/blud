# Slug head burst (lethal burst + glancing rupture) — Design

**Date:** 2026-10-02 · **Status:** built 2026-10-02; **switched off by default 2026-10-07** after the owner's
second playtest (it stays behind `burstTune({ opening: true })`; what a gun round does to a head now is in
[the 2026-10-07 notes](../../dev-notes/2026-10-07-sculpt-skull-2/NOTES.md))
**Branch:** `claude/head-explosion-effect-d6231e`
**Follows:** [melee head damage](2026-09-28-melee-head-damage-design.md) (the region ladder, jelly wobble, dents, eye pop,
brain gib). This spec reuses its machinery and does not change the flail ladder.

## 1. What it is

Today a shotgun slug that hits a zombie's head stamps one generic 0.16 m "blast" crater (`woundFromSlug`) that takes
the flesh off and shows the skull. There is no head-specific slug response, and decapitation is a separate sever path.

This adds two slug-on-head outcomes, chosen by how centred the shot is:

- **Lethal burst** (dead-centre): the skull bursts, the flesh and head deform and open up, skull shards, brain and
  blood fly out, and the zombie dies. The head stays on the body as a ruptured shell. It is not a decapitation and
  not the cultist's vanish-into-mist pop.
- **Glancing rupture** (off-centre or side): the zombie lives. The skull breaks and brain leaks on the struck side,
  the flesh and head deform lastingly, and the next head hit finishes it.

**Reference.** The owner's ballistic-dummy stills: a slug hits the upper side of a gel head and it bursts with skull
bits and blood while the existing flesh and skull deform like jelly, then stays open with torn scalp flaps (the
fourth still). The jelly motion is the reference for how the SDF flesh should move.

## 2. Decisions (owner, 2026-10-02)

1. **Two outcomes, not one.** A kill burst and a non-lethal deforming wound.
2. **Chosen by centring.** Offset from head centre along the shot line, not by head region.
3. **Slugs only.** Pellets, the flail, body and limb slugs and blasts are unchanged.
4. **Scope is approach A + B.** A: composed from existing pieces (deform, craters, gore debris). B: hinged torn scalp
   flaps as attached pieces. Both ship in this spec's plan.
5. **C is a separate spike, not part of this work.** C is a shader-side burst/peel displacement field in the march
   WGSL. It looks interesting for fidelity but is new shader work, touches shared march cost, and would need porting to
   the Rust renderer. Record it on the task wiki as a follow-up idea.

## 3. What exists (explored 2026-10-02)

- **Slug impact seam.** `game-main.ts` projectile loop: after the nearest-actor trace, `hitActor.hitSlug(hitPoint,
  dirN, p.shot)` stamps the wound, then `registerBleed(ctx, hitActor, stamped, p.kind, {...})`.
  `woundFromSlug` (`game-weapon.ts`) uses `SLUG.woundRadius` 0.16 and `severRadius` 0.13, type `'blast'`, and sets
  `spillCalibre = 'slug'`.
- **Never key slug-vs-blast on `Wound.type`** (dualmem warning): slugs stamp `'blast'`. This feature is routed by the
  projectile kind at the impact seam, not by wound type.
- **Head model.** `head-damage.ts` (pure region ladder: flesh per region, skull crack, eyes, events),
  `webgpu/game-head-damage.ts` (the leaf: turns events into craters, attached pieces, gore, blood, forced collapse),
  `head-deform.ts` (damped wobble spring plus per-side dents, one affine map applied to the head's flesh and bone
  prims, exported as `headAffine`/`headAffineMatrix` so the skeleton-mesh path moves the skull identically),
  `head-crown.ts` (brain lumps, skull chips, whole-brain mesh launch), `flesh-bits.ts` (thrown meat bits with caps),
  `head-pop.ts` (cultist Scanners pop: swell then burst; `inflateHead`).
- **Attached pieces.** `ctx.boot.attachPiece(actor, prims, pos, opts)` returns `AttachedPiece { update(at, localEnds),
  dispose() }`: one pooled chunk view, one draw per piece, hand-posed each frame. The eye stalks ride the head through
  `Wound` trackers that `woundWorldPos` re-reads every frame, so they follow the posed, wobbling head.
- **Craters.** Wounds are a ring of `MAX_WOUNDS` 16 per actor; head craters follow the head-slot rule from the melee
  head spec §8 (a head crater evicts only a head crater).
- **Gore dispatch.** `GorePiece` through `onGoreDispatch` into the chunk system, with caps and eviction order (flesh
  first, snapped eyes last). The blood sim burst is `deps.burst`.

## 4. Routing and verdict (`head-burst.ts`, pure)

**Routing.** In the impact seam, a slug (`p.kind === 'slug'`) whose hit point lies on a head-limb prim is handed to the
head-burst leaf instead of `hitActor.hitSlug`. "On the head" is decided by the same head-region test the flail uses
(a head prim, or within the flail's head radius of the head centre); the plan confirms the exact helper to reuse.
Every other projectile and every non-head slug takes the existing path unchanged. If the head is already gone
(severed or popped) the slug takes the existing path.

**Verdict.** A pure function of the slug ray and the head frame (`HeadFrame`: centre, quat, axes). No rendering inputs.

- `offset` = perpendicular distance from the head centre to the shot line ÷ head radius (the geometric mean of the
  head's half-axes, or the plan's chosen equivalent; the head is a few large ellipsoids, not a sphere).
- `offset < BURST.centreFrac` → `lethal`. Initial value **0.35**, a tuning constant.
- Otherwise `glancing`, with `side` (which half of the head the line passes, in head-local coordinates) and
  `severity` = 1 − offset clamped to [0, 1] (closer to centre = harsher).
- The result also carries: entry point, exit point (the ray against the un-deformed head's far side), burst axis (the
  shot direction in head-local coordinates), and a **seeded plan** for shards and flaps (counts, directions, speeds)
  drawn from the per-actor stream already used by `ActorHead.rand`, so a run is reproducible.

Because the test is geometric, side shots and shots from behind the head can be lethal too.

## 5. State and consequences

**Lethal.**
- The head model is marked dead and the actor's collapse is forced (the existing `kill` path in the leaf, which ends
  in `forceCollapse`).
- The head remains attached and ruptured: scalp open, flaps hanging, entry and exit craters.
- Dangling eyes snap and fly as they do on any head death (`headDeath`).

**Glancing.**
- The zombie lives. The struck region gets its flesh set to at most the skull-exposed threshold and its skull marked
  cracked, and a `brainLeak` flag on the head state (new, additive; default false).
- It does not add to the regular `skullPerHit` accumulation by itself beyond that crack; a follow-up head hit, by the
  flail or by any weapon through the existing ladder, finishes it by the existing rules in `head-damage.ts`.
- Eye state follows the existing machine: an eye whose orbit the line passes through can pop through the existing
  events (`orbit-exposed`, `eye-pop`) rather than a new path.
- A glancing slug that also happens to strip enough flesh to satisfy the existing kill rule kills via the existing
  rule. Nothing new is needed.

**Unchanged:** the flail ladder, `REGION_TUNING`, and all existing events. New events are additive.

## 6. The look

### 6.1 Jelly rupture deform (`head-deform.ts`, new `burst` term)

An additional spring-driven term alongside the wobble and dents, applied by the same affine so the flesh, bone/organ
prims and (via `headAffineMatrix`) the skeleton-mesh skull all move together.

1. **Swell (≈0.1 s).** A hard, lopsided inflate along the burst axis, biased toward the exit side. Reuses the idea of
   `inflateHead` (cultist pop) but short and one-sided.
2. **Spring back into a lasting rupture.** The head settles into an asymmetric shape: a bulge on the exit side and a
   cave on the entry side. The lasting part is stored like the existing per-side dents (capped), so it persists after
   the spring settles.
3. **Wobble.** The existing damped jelly wobble rings out afterwards, kicked harder for a burst than for a plain hit.

Severity scales swell size and the lasting rupture. Glancing hits use the struck side only. Constants live in a new
`BURST` table next to `HEAD_DEFORM`; nothing in `HEAD_DEFORM` changes value.

### 6.2 Craters
- **Entry crater:** large, skull-exposing, anchored at the entry point as a head-slot wound, carved past the measured
  skull depth as `regionCarve` already does for exposed regions.
- **Exit crater (lethal only):** larger, on the exit side.
- Both obey the head-slot rule (they evict only head craters) and the existing 16-wound ring.
- Slug-vs-blast stays keyed by the stamp-time marker, never by `Wound.type`.

### 6.3 Debris (gore through `onGoreDispatch`, blood through `deps.burst`)
- **Skull shards:** many thin curved bone-coloured plates (a new `skullShards` in `head-crown.ts`, replacing the three
  flat chips for this path), thrown mostly along the shot direction and out of the exit side, with spread.
- **Brain:** glancing throws brain lumps and leaks from the crater; lethal also throws the whole brain mesh
  (`brainLaunch`, with the SDF `brainPiece` fallback when the GLB is not loaded).
- **Flesh bits:** the existing `fleshBits`, scaled by severity, within the existing cap (`FLESH_BITS.cap`).
- **Blood:** a cone along the shot line from the exit side, plus the entry gout the normal slug path would have made
  (the leaf calls the same `bleed`/`burst` deps rather than reimplementing the bleed).
- All new gore respects the chunk budget and eviction order already documented in `flesh-bits.ts`.

### 6.4 Scalp flaps (B)
- **What:** 2–4 torn flaps of scalp (flesh colour with a bone-coloured underside near the rim), hinged on the crater
  rim, as in the owner's reference 4.
- **How:** each flap is an attached piece (`attachPiece`) riding the head through `Wound` trackers on the entry crater
  rim, so it follows the posed, wobbling, dented, collapsing head. A short verlet chain gives it a hang and settle
  after a kick, then it rests open. Flaps use the same pooled-chunk-view mechanism and cleanup as the eye pieces
  (disposed on head gone, actor gone, `forget()`, `reset()`).
- **Draw budget:** a hard cap on flaps per head, and where possible flaps share one piece. The plan measures the
  extra draws and frame cost against the existing head gate; a flap count that exceeds the head gate's budget is
  reduced rather than the gate loosened.
- Prim budget per piece must stay constant after attach (pieces are packed once; to grow a prim send per-prim scale
  via `AttachedPiece.update`, as the leaf's eye pieces do).

## 7. Architecture and file map

| Unit | What | Depends on |
| --- | --- | --- |
| `head-burst.ts` (new, pure) | verdict, `BURST` constants, seeded shard/flap plan | head frame types only |
| `head-deform.ts` (extend) | `burst` state, swell/rupture/wobble stepping, extended affine | existing deform |
| `head-crown.ts` (extend) | `skullShards`, flap prim builders | `head-pop` prim helpers |
| `head-damage.ts` (extend, additive) | `brainLeak` flag, glancing crack helper | existing model |
| `webgpu/game-head-damage.ts` (extend) | `burst(...)` entry: verdict → deform, craters, gore, flaps, blood, kill | all above |
| `webgpu/game-main.ts` impact seam | route slug-on-head to the leaf | leaf API |
| debug UI + `scripts/head-burst-gate.mjs` (new) | toggles, sliders, capture gate | `fireSlug()` seam |

Pure modules stay renderer-free per the repo's plan rules. Hand-written WGSL is not touched by this spec.

## 8. Testing

- **Pure unit tests (vitest, colocated):** verdict classification (dead-centre, edge of the threshold, offsets from
  front, side and rear, near-miss of the head); burst phase stepping and settle-to-rest; the lasting rupture caps; shard
  and flap plans are deterministic for a seed; state transitions (glancing then a follow-up head hit then kill; lethal
  marks dead; head already gone falls through).
- **Browser gate (`scripts/head-burst-gate.mjs`, modelled on `head-damage-gate.mjs`).** Per the repo's capture
  notes: wait for `window.__warmGate.phase === 'ready'`; use the real seam `fireSlug()` rather than
  `__sdfGame.stampWoundAt` (which skips `registerBleed`); run on the bare `/sdf-game.html` ring page, because on Night
  Train the player owns no shotgun until pickup and `fireSlug()` returns false. Captures: centre, offset and glancing
  hits from front, side and rear, before/after, and measures draws and frame cost.
- **Debug UI.** A toggle and sliders (`centreFrac`, swell size, shard count, flap count). Default: on for slugs only.
  Matches the owner's preference for visual changes applied step by step with side-by-side comparison and debug
  toggles.
- **Honesty.** Lightweight checks are not a build/test/GPU pass; the plan lists exactly what each gate proves. Whether
  it feels like the ballistic dummy is the owner's call at playtest.

## 9. Out of scope

- Approach C (shader-side burst field). Separate spike; add to `docs/tasks/combat-and-gore.md` as an idea.
- Pellet, flail, dynamite or other weapons' head response.
- Non-zombie characters' flaps. The zombie ships first. Whether other characters' heads (goblin, bride, minotaur,
  warbull) resolve a usable head frame and bone prims is **unverified**; the plan checks it. Any that do get the
  deform and debris, and any that do not skip the burst and keep today's slug behaviour.
- A new decapitation path. The existing sever path is untouched.

## 10. Open questions for the plan

1. The exact reuse of the flail's head-region test for routing slug hits (helper name and its radius).
2. The head-radius definition for `offset` on the zombie's non-spherical head (frame axes), and the final `centreFrac`
   after playing it.
3. Whether the skeleton-mesh skull needs any extra handling for the lasting rupture beyond `headAffineMatrix`.
4. Flap count and sharing under the draw budget, set by measurement.
5. Which other characters' head frames resolve through `headShape` (goblin, bride, minotaur, warbull).

## 11. As built (deviations from §1–10)

Built 2026-10-02 from [the plan](../plans/2026-10-02-slug-head-burst.md); what was and was not verified is in
[the build notes](../../dev-notes/2026-10-02-head-burst/NOTES.md).

1. **Debug surface** is console seams, `__sdfGame.head.burstTune({ on, centreFrac, swell, shardScale, flapCount })` and
   `burstTuning()`, not a UI panel. The game's convention is seams (`setFleshBits`); sliders exist only in the lab pages.
2. **Finishing a glancing rupture.** The next hit nearest the cracked region finishes it (the existing `skullPerHit` rule),
   and so does a second *glancing slug* on the same region (it escalates by `skullPerHit`; found by the gate: it used to
   stay at 0.8 forever). A follow-up on a different region follows the ordinary ladder.
3. **Eyes on a glancing hit** are not popped by the burst; only dangling eyes snap. Later hits pop them via the existing events.
4. **Shards are flattened plates**, not curved. Curvature is unproven on the gib view's capsules.
5. **Eligibility is `a.profileName() === 'zombie'`**, which excludes soldiers, armoured characters and every other character
   in one test (the plan had proposed a new `armored` accessor; the existing profile name is simpler and stricter). Other
   characters keep today's slug behaviour. Whether any of them resolves a usable head frame is still unmeasured.
6. **Head crater slots** went 7 → 8 (`MAX_HEAD_WOUNDS`) for the exit crater.
7. **A slug on the neck or shoulder** (hit point beyond `BURST.maxHs` = 1.35 head-ellipsoid units from the head centre)
   takes the ordinary path, which still severs through `severRadius`.
8. **Slug on a corpse's head** still ruptures it (the model reports `burst` without changing a dead head's state).
9. **Frame cost is unmeasured** (see the notes): the gate checks that all flaps share one draw, not milliseconds.
10. **After the first playtest (2026-10-03):** the scalp flaps are OFF by default (they read as orange tubes; kept for a future
    monster); a centred slug SPLITS the head open and the zombie LIVES unless `burstTune({ lethal: true })` (§1's lethal burst
    is now opt-in); repeats on a cracked region add `repeatStep` 0.04 (kills on the fifth repeat); craters, the lasting exit
    bulge and a new lasting `splay` are bigger. See the build notes.
