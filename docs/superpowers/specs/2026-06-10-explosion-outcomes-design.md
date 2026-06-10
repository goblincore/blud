---
title: NotBlood-Faithful Explosion Outcomes — Launched Dudes, Flung Corpses, Gib Composition
date: 2026-06-10
status: approved
supersedes: launched-corpse sections of docs/dev-notes/2026-04-26-notblood-fidelity-research.md
---

# NotBlood-Faithful Explosion Outcomes

## Problem

Two fidelity gaps vs NotBlood, both confirmed by playtest:

1. **No launched-alive behavior.** In Blood/NotBlood, explosions physically throw
   nearby enemies into the air — alive survivors fly, fall, and resume fighting.
   Blud's zombies are `kinematicPositionBased` and ignore explosion impulses
   entirely while alive; the only physics response is an XZ-only fling on death.
2. **Every dynamite gib reads as "a lone zombie head."** The launched-corpse
   branch in `src/game/gibs/index.ts` (impulse ≥ threshold) replaces the full
   chunk burst with a single chunk + tumbling corpse prop, so nearly every
   dynamite kill spawns one flying head and nothing else.

## Source findings (corrects the 2026-04-26 research doc)

Verified directly in `/Users/donny/Documents/Raze/NotBlood/source/blood/src/`:

- **Physics and damage are decoupled.** The explosion sprite lives ~60 tics;
  each tic `ConcussSprite` (actor.cpp:2677) adds velocity — **including a
  vertical component** — to every `kPhysMove` sprite in proximity: alive dudes,
  corpses, things. Magnitude scales with sprite size ÷ mass ÷ distance²
  (0x40000 baseline). "Launched alive" is emergent, not a state.
- **Death-outcome branch** (actDamageSprite, actor.cpp:~3563): killing blow of
  type `kDamageExplode` with damage **< 160** is converted to `kDamageFall` →
  the *normal* death SEQ plays, but the body keeps its concussion velocity →
  an intact corpse tumbles through the air. Damage **≥ 160** → full gib.
- **Corpses persist and re-gib.** `DudeToGibCallback1` (actor.cpp:7887) turns
  the dead dude into a `kThingBloodChunks` thing with **health 8** and full gib
  vulnerability (`data4=319`). A later explosion bursts it into chunks.
- **The head IS spawned on every zombie explosion gib** (actKillDude nSeq==2,
  actor.cpp:3196): `GIBTYPE_27` (tile 3405) launched from the sprite's **top**
  with velocity `(xvel/2, yvel/2, -0xccccc up)` — *in addition to*
  `nGibType[0]=15` = `gibHuman` = **7 body chunks, no head** (tiles 1454×2,
  1267×2, 1268, 1269, 1456) + 4 blood FX (+16 blood + 2 small chunks in gore
  mode). Blud's bug is the head *replacing* the burst, not the head existing.
- **Head-pop signature on normal deaths:** 25% of non-explosion zombie deaths
  (`Chance(0x4000)`, nSeq==1) play the seq+7 "flung" death variant + pop the
  head off with a gentler up-velocity + continuous blood spurt.
- **explodeInfo[1] real field order** (the 2026-04-26 doc mislabeled columns):
  repeat=80, dmg=20, dmgRng=10, **radius=150**, **dmgType(concussion)=900**,
  burnTime=0, ticks=60, quake=160, flash=60. Blud's radius=150 and impulse=900
  already match the source exactly.

## Design

Port the **outcome model**, not the per-tick architecture: Blud keeps its
single-shot explosion, but splits its effects into damage and physics applied
to everyone in radius. Applies to **both AxeZombie and ShotgunCultist**.

### A. Three-tier outcome selector (`GibSystem.spawnExplosion`)

For each dude in radius compute damage (existing falloff, unchanged) and a
**launch velocity** (new, §B):

| Tier | Condition | Result |
|---|---|---|
| Full gib | damage ≥ `GIB_THRESHOLD` (160) | Full chunk burst: head + body chunks + blood FX (§E). Launched-corpse branch deleted. |
| Flung corpse | damage < 160 but lethal | Death anim plays on the body while it goes ballistic (§C); lands and persists as a re-gibbable corpse (§D). |
| Launched alive | survives | Same ballistic launch while alive; lands, brief stagger, resumes AI. |

### B. Concussion launch velocity

Pure function + `EXPLOSION_LAUNCH` tuning block in `src/game/gibs/tuning.ts`:
radial direction from blast to dude with an **upward bias** (NotBlood's
ConcussSprite z-term: a ground blast at the feet kicks upward), magnitude
scaled by the same linear falloff as damage. Point-blank ≈ 7–10 m/s; tuned in
playtest. Mass/sprite-size scaling skipped — all current dudes are human-sized.

### C. Ballistic mode on the enemy entity + `Launched` brain state

- Replace the `flingVel` XZ hack in `AxeZombie.update` with kinematic
  ballistics: integrate `vel.y -= g·dt`, move via
  `setNextKinematicTranslation`, land at floor height. One code path serves
  both alive and dead launches; the death anim plays on the flying body,
  matching NotBlood's death-SEQ-on-launched-sprite behavior.
- `ZombieBrain` gains a `Launched` state (pure transition functions, TDD):
  entered via `launch()`, AI suspended while airborne; on landing →
  `Stagger` → `Chase` if alive, stays `Dead` if dead.
- Same treatment for `CultistBrain`/`ShotgunCultist`.

### D. Corpse persistence + re-gib

- Non-gibbed dead dudes stay registered in `GibSystem` as corpse-dudes
  (`isCorpse: true`, hp = 8, matching `kThingBloodChunks`).
- Any explosion damage on a corpse → instant full gib, **no 160 check**
  (corpses are fragile things in the source).
- Reaping changes from after-death-anim to a corpse cap + timer
  (initial: max 12 corpses, 30 s; tune in playtest).

### E. Gib composition + head-pop signature

- Full gib keeps `spawnsKickableHead` (head-every-gib is source-accurate), but
  the head launches from **head height** with an upward kick at half the body
  velocity (NotBlood `(xvel/2, yvel/2, -0xccccc)`) — "head pops out of the
  burst," not "head is the burst."
- `ZOMBIE_GIB_PROFILE.bodyPartCount` → `{min: 4, max: 7}` (source spawns 7
  body chunks; picnums already match `gibHuman`).
- New: 25% of normal (non-explosion) zombie deaths pop the head off with a
  gentler up-velocity + blood burst.

### F. Cleanup

Delete `src/game/gibs/launched-corpse.ts`, its tests, and its wiring in
`main.ts`/`GibSystem` — superseded by ballistic mode on the entity itself
(one corpse system; the animated sprite stays correct).

### G. Testing

- Pure-function TDD: outcome-tier selection, launch-velocity math, ballistic
  integration + landing, `Launched` transitions (both brains), corpse re-gib
  rule, reap cap/timer.
- Manual playtest gate: dynamite at mixed range produces visibly distinct
  outcomes (gib / tumbling intact corpse / flying live zombie that gets up);
  a second stick into a corpse pile bursts it into chunks; no Rapier
  freed-handle crashes when a launched dude carrying stuck flares dies or gibs.

## Non-goals

- Per-tick multi-frame explosion entity (NotBlood's 60-tic loop) — not visible
  at Blud's timescale; the single-shot equivalent is sufficient.
- Mass/sprite-size concussion scaling — revisit if non-human-sized enemies land.
- Cascade gibs on chunk impact (`F2.cascade-gibs`) — separate task.
- Player launch physics — player damage path unchanged for now.
