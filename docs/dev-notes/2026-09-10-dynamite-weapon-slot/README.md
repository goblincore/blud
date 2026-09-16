# Dynamite as weapon slot 2 — for tuning the blast, the gib and the cost of both

**Branch:** `claude/dynamite-weapon-slot` (worktree `.claude/worktrees/dynamite-weapon-slot`)
**Date:** 2026-09-10
**Ask:** *"add weapon switching so I hit 2 to select dynamite and then the player
can throw at the zombies and soldiers so we can tune the gibbing and
performance of that"* — plus a procedural (not sprite-atlas) explosion.

**Working tree note.** This session started in the primary checkout by mistake;
another agent was committing held-row reprojection there at the same time
(`fc7c70c7`). The work was moved to its own worktree and the primary checkout was
left clean. Everything below lives on the branch.

---

## 1. What shipped

| Piece | Where |
| --- | --- |
| Slot switch state machine (1 = grapeshot, 2 = dynamite) | `webgpu/game-weapon-slots.ts` + 10 tests |
| Real level collision for a thrown bundle | `dynamite-flight.ts` (`FlightWorld`: box list + ceiling) + 7 new tests |
| A blast that does more than crater geometry | `game-actor.ts` — new `blast()` |
| Slot input, bundle prop, cook, throw, flight, detonation, live-actor gib, HUD | `game-main.ts` |
| Procedural GPU explosion (fireball / smoke / embers / shockwave) | `webgpu/explosion-vfx.ts` + 29 tests, routed into `characterEffects.scene` |
| Gates | `scripts/sdf-game-dynamite-gate.mjs`, `scripts/sdf-explosion-fx-shot.mjs` |
| Seams | `__sdfGame.dynamite()`, `.detonate()`, `.actorList()`, `.chunkCensus()`, `.selectSlot()`, `.dynamitePress/Release()`, `.overcook()`, `.explosionFx()`, `.spawnExplosionFx()`, `.setExplosionFxTuning()` |

**Tuning knobs:** `?maxchunks=N` (1–64), `?gib=pieces|clusters`, `?dynspeed=K`,
`?explosionfx=procedural|standin`.

### What the game did NOT have before this

- **No direct gib at all.** `gibAll`/`gibAllPieces` were used only by the lab;
  `explosion-aoe.ts` computed `gibbed` and its one live caller discarded it.
  Killing anything was a collapse into a corpse. There is now a live-actor gib:
  `gibActor()` builds the pieces, spawns one chunk per piece with the blast's own
  concussion velocity, and retires the actor.
- **No dynamite, no slots, no thrown object** in the active game.
- A blast had **no shove, no meter credit and no sever tail** — `stampBlast()` is
  documented as wound-geometry-only. `blast()` is the missing half.

### The meter contract (do not "simplify" this)

`blast()` credits the collapse meter with the resolver's `meterCredit`
**directly** and deliberately does NOT push the wounds through `pendingWounds`.
That array is motion's `freshWounds` channel, and `stepCollapse` weights each
entry by `WOUND_PROFILES[type].radius` — the *profile's* radius, not the wound's
own. A 16-wound blast would debit 16 × 0.13 = 2.08 meter whatever the actual
falloff, collapsing a body from a single edge-of-radius hit. This is the X1.23
contract, now enforced in the active game's actor rather than only in the lab.

---

## 2. Two bugs the gate caught (both mine, both silent by inspection)

1. **The bundle was released at the SCENE ORIGIN.** `throwBundle` reparented the
   prop out of the camera rig and *then* read its world position, so the flight
   started at `(0, 0, 0)` — inside the level's solid centre block. The bundle was
   pushed out downward (release point `y = -0.08`) and slid along the floor. The
   gate's `release point y=` line is what exposed it; fixed by reading the origin
   **before** the reparent, with a comment saying the order is load-bearing.
2. **The next bundle appeared during the throw.** The hand refilled as soon as
   the cook left `'cooking'`, which includes fpv.ts's 0.4 s `'cooldown'` — i.e. a
   bundle back in a hand that was still visibly mid-throw. Reacquisition now
   requires `'idle'`.

Also caught in the measurement rig rather than the code: `Page.captureScreenshot`
returns what the **compositor** last presented, and a page driven by
`__sdfGame.step()` presents nothing between reads — three captures of three
different states came back byte-identical. Both capture scripts use
`presentedShot()` (the canvas readback) instead.

---

## 3. Evidence

`scripts/sdf-game-dynamite-gate.mjs` — **PASS**, zero page errors:

```
immediately after Digit2: live=shotgun target=dynamite phase=lowering ready=false
after 30 steps:          live=dynamite phase=up ready=true gunLower=1 bundleLower=0 inHand=true
shotgun refused while dynamite is out: ok
while cooking: charge 0.158 → 0.658 (of 1.0)
after release: thrown=1 inFlight=1 inHand=false fuse=4.97
release point y=1.65; nearest body 3.87 m away
bundle travelled 3.72 m before detonating
detonation: gibbed=1 pieces=20 lastBlastMs=27.2
after recovery: inHand=true cookPhase=idle
gib probe: actors 14 → 12, pieces 20 → 58
chunk views 12 → 12 of 12; 38 of this gib's pieces recycled immediately
```

`scripts/sdf-explosion-fx-shot.mjs` — differential capture, frozen scene, VHS
off, `presentedShot()` readback; **PASS** in both modes:

| mode | 3.4 m | 6.5 m |
| --- | --- | --- |
| procedural | 39.7% of frame changed, luma 27 → 119, box 800×497 | 9.0%, luma 32 → 114, box 772×426 |
| standin (control) | 26.0%, luma 33 → 73, box 664×450 | 5.9%, luma 34 → 61, box 735×381 |

So the procedural burst draws, is roughly 1.5× the area and 1.7× the brightness
lift of the additive-card stand-in, and **scales with distance** (39.7% → 9.0%)
— a mis-scaled billboard would not.

**What these numbers do NOT establish:** whether it looks good. Shape, colour,
noise scale and smoke weight are the owner's call, and the PNGs are written out
for it.

### The finding that matters for the tuning pass

**A full-body gib is 19–20 pieces and the live chunk budget is 12.** Across the
gate's two detonations, 38 pieces were recycled the instant they spawned — they
never draw. `?maxchunks=N` raises the budget; what it buys is bounded by the bake
queue (ONE job in flight, one swap per frame), which is the cost the knob exists
to expose. `?gib=clusters` is the cheaper shape (one chunk per limb).

`lastBlastMs` is **25–28 ms** per detonation on this headless boot — CPU time
inside `detonateAt` (the resolver's per-prim sphere traces plus the chunk spawns).
That is a real frame hitch and the most obvious single thing to attack next.

---

## 3b. The blast cost, round 2 — 2026-09-11

The first pass (`bd280754`) capped `probeFlesh` for the RIM measurement. That
was half of it. `worldHitToWound` probes the flesh **twice** per wound:

| probe | consumer | capped by `bd280754`? |
| --- | --- | --- |
| `rimScaleFor` | a THRESHOLD (`min(1, thick / 2·lip)`) | yes — every value past `2·lip` is the same answer |
| the depth-slab carve | a CONTINUOUS value (`carveDepth = 0.45 · thick`) | **no** |

The uncapped one is the expensive one: `PROBE_MAX / PROBE_STEP` = **150
`sdBody` folds per wound** against the capped probe's 36, and a 5-body blast
stamps 16 wounds on each. Measured with `sdf-blast-profile.mjs` in the arena:
`resolve 22.0 = trace 3.4 + WOUND 18.1 + cut 0.2`, i.e. 69% of the blast, and it
scales with bodies × 16, not with prims.

**It is cap-able EXACTLY, and this is why.** `APPLY_WOUNDS` intersects the carve
SPHERE (radius = the wound radius) with a slab through the anchor at `capEff`.
A slab that reaches the sphere's centre cannot bind anywhere, so
`capEff ≥ radius ⟺ thick ≥ radius / 0.45` is the point past which every
measurement produces the same carve. Capping there is not an approximation; it
is the same field. `damage.test.ts`'s "thick flesh: the slab never binds" still
holds at 0.131 against a 0.13 radius — barely, and deliberately, because the
cap sits exactly on the boundary.

**And the rest of the wound phase had no reader at all.** A body this blast has
already decided to GIB gets 16 wounds stamped on it, carried through the meter
arithmetic and dropped: `detonateAt` takes the `gibbed` branch, calls
`gibActor` and `continue`s, so `pb.wounds` is never read and `blast()` never
runs. That is now optional — `ResolveExplosionOpts.woundsOnGibbed`, default
TRUE so the lab and the wound tests keep their contract, FALSE from the game.
Meter credit is 0 on that path, which is what the gib branch's contract already
was.

**Measured, interleaved inside ONE boot** (12 alternating blasts on the arena
horde — the only way an A/B on this machine counts):

| arm | woundMs median |
| --- | --- |
| gibbed bodies stamped (`setGibWounds(true)`) | **8.5** |
| gibbed bodies skipped (shipped) | **0.0** |

and the carve cap, two boots each (weaker evidence than the above, and reported
as such):

| arm | woundMs median (stamped arm) |
| --- | --- |
| carve probe capped (shipped) | **7.6** |
| `?carvecap=0` (uncapped) | **13.6** |

Together the wound phase goes from ~18 ms to ~7.6 ms on a 5-body blast, and to
**zero** for a blast whose in-range bodies are all gibbed. Seams: `?gibwounds=1`
and `?carvecap=0`, plus `__sdfGame.setGibWounds(on)` for the interleaved A/B.

## 4. Known open items

- **The burst does not light the room yet.** `explosion-vfx.ts` exposes
  `lightIntensity` "for the caller to feed the dynamic light list" and nothing
  consumes it. Feeding the probe gather's dynamic light list is what would make a
  detonation visibly light the walls and bodies — and the gather is single-room by
  construction (see `TASKS.md`), so it lights the player's room and nothing else.
- **The gibbed actor's GPU view is retained, not disposed.** Every chunk's
  template borrows that view's uniforms and volume texture (the sever path makes
  the same borrow), so disposing it would take the gib's own geometry with it.
  Bounded and documented; not free.
- **No look pass has been done on either the bundle prop or the explosion.** The
  bundle is the procedural four-stick prop at a held pose I placed by hand.
- The slab-sided crate/wall bounces are point-radius against `levelColliders()`;
  the bundle does not collide with actors inside the flight module — the body
  test lives in the wiring, per 120 Hz sub-step.
