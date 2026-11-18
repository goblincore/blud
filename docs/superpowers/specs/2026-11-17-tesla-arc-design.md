# The tesla arc: zap state, the arc, and the ash death

Date: 2026-11-17. Status: plan 1 (the zap state) built 2026-11-17; plans 2 and 3 not built.

Pieces 1 to 5 below say what was built. Pieces 6 and 7 are still design. The build's numbers and frames are in
`docs/dev-notes/2026-11-17-tesla-zap/NOTES.md`; the plan is
`docs/superpowers/plans/2026-11-17-tesla-1-zap-state.md`.

## Why

The owner wants a personal tesla coil: a weapon that throws a massive electric arc and gives its target
the classic electrocution, rigid and glowing with the skeleton showing through. There is no weapon model
yet; like the flare and the melter, the first build is a placeholder prop on a dev slot.

The owner's calls (2026-11-17):

- **Held stream.** Hold fire for a continuous arc. The target stays zapped as long as the arc is on it.
- **Glowing x-ray.** The flesh becomes a bright blue-white glow and the skeleton shows inside it.
- **Rigid star with a tremor.** One authored electrocuted pose, vibrating, with jolts between variants.
- **Fat jagged bolt with forks.** White core, blue-violet edge, re-rolled many times a second.
- **Ash statue, then crumble.** A body zapped to death holds its pose charred, then falls to an ash heap.

## Scope

One spec, three plans, built in this order. Each plan ends playable.

1. The zap state on a body, fired from a placeholder on slot 9.
2. The arc: bolt, forks, crawl arcs, light.
3. The ash death.

Left out: the weapon model, ammo, the arc chaining between bodies, sound, the deferred renderer, and any
effect on things that are not SDF bodies (props, chunks, the player).

## The sequence

One zap clock per body. The game has no health, so, as with burning (`BurnTier`), how long a body takes
to cook and whether the arc can kill it at all is set per character.

| phase | when | what the body does |
| --- | --- | --- |
| zapped | the arc is on it | Rigid star pose, tremor, x-ray glow. No movement, no attacks, no gunfire. `cook` climbs. |
| recovering | the arc left it, for `recoverSec` | Glow and tremor fade, the pose eases out, the body staggers. `cook` falls. |
| statue | `cook` reached 1 on a tier that dies | The arc on it cuts. Rigid pose held, fully charred, glow out. (Smoke: plan 3.) |
| crumble | after `ZAP.statueSec` (0.8 s) | Plan 3: flesh erodes top-down into an ash heap; bones and kit drop into it. |
| heap | after | Plan 3: a set ash heap. A corpse to every reader; no per-frame work. |

In plan 1 there is no crumble and no heap. When the statue's time is up the body dies its ordinary death (its
ragdoll or its own fall; a soldier through his own fatal path) and falls as a charred corpse.

Rules at the edges:

- An arc that returns during `recovering` puts the body straight back to `zapped`; `cook` carries on from
  where it had fallen to.
- A body whose tier does not die holds at `cook` 1 for as long as the arc stays, and recovers on release.
  It is fully charred by then (`char` is 1 at `cook` 1).
- A zapped body killed by something else takes that death. The glow cuts on the frame it dies and the
  char it had stays. As built: the zap is dropped when the body is doomed or down by another cause, a
  statue included, so only a standing statue reaches the zap's own death.
- A burning body can be zapped: its panic is suspended under the arc and resumes when the arc leaves. If
  the arc kills it, the fire is retired the way `meltActor` retires it (plan 3, with the crumble; in plan 1
  nothing retires the fire and the body dies its ordinary death still alight).
- A melting, tearing or gib-queued body cannot be zapped (the same refusal `meltActor` makes). Nor can a
  corpse, a body going down, or a downed soldier who is alive on the floor (he is not stood back up into
  the star).
- A statue or a crumbling body takes no hits, as a melting body takes none. Not in plan 1: a statue still
  takes hits, and one killed another way takes that death. The no-hit rule arrives with the crumble.

## Pieces

### 1. The zap clock: `zap.ts` (new, pure)

`src/lab/sdf-zombie/zap.ts`. No clock of its own, no randomness beyond the seed.

```ts
export interface ZapTier { cookSec: [number, number]; dies: boolean; recoverSec: number; star: boolean; }
export interface ZapState { phase: 'zapped' | 'recovering' | 'statue'; cook: number; cookSec: number;
                            t: number; seed: number; dies: boolean; recoverSec: number;
                            /* plus private clock fields */ }
export interface ZapOut { glow: number; char: number; tremor: number; jolt: number; variant: number;
                          invert: boolean; pose: number; done: boolean; die: boolean; statueDone: boolean; }
export function createZap(seed: number, tier: ZapTier): ZapState;
export function stepZap(s: ZapState, dt: number, arcOn: boolean): ZapOut;
```

- `cookSec` is rolled once from the seed inside the tier's range. `cook` rises at `1 / cookSec` while the
  arc is on and falls at `ZAP.coolRate` (default 0.5 per second) while it is off.
- `glow` snaps to 1 within `ZAP.attackSec` (0.06 s) of the arc landing and fades over `recoverSec`. It
  carries the flicker: two incommensurate noise rates off the seed, in the range 0.55 to 1.
- `pose` is the same envelope without the flicker: how far into the star the body is. `tremor` follows it.
- `char` is `smoothstep(ZAP.charFrom, 1, cook)` with `charFrom` 0.6: the flesh darkens only in the last
  stretch, so a brief zap leaves no mark. It never falls again for the life of the state, and the actor
  keeps the most char the arc has left on the body after the zap ends.
- `jolt` is a short pulse (`ZAP.joltSec`, 0.08 s). The gap to the next is rolled from `ZAP.joltGapSec`
  (0.25 to 0.7 s) and its timer does not run during a jolt, so jolts land 0.33 to 0.78 s apart, start to
  start. Each jolt picks one of the other two variants (0 to 2), so every jolt is a visible change, and
  sets `invert` for its length.
- `die` is true on the one step `cook` reaches 1 with `dies` set; `done` is true when a recovery ends.
- The statue's time is `ZAP.statueSec` (0.8 s), in `ZAP` and not in `ASH`, because plan 1 needs it.
  `statueDone` is true once the statue has stood that long. A statue ignores the arc.
- `ZapTier` lives in `motion-profile.ts` beside `BurnTier`. Default: `cookSec [1.6, 2.2]`, `dies` true,
  `recoverSec` 0.6, `star` true. Per-character values are tuning, set when the owner judges it in the arena.

### 2. The pose: `zap-pose.ts` (new, pure)

In `burn-flail.ts`'s mould: it returns hand targets in shoulder coordinates and trunk and head angles;
`motion.ts` places the arms with `solveElbow`, so no segment stretches.

- Base: arms out and slightly up, back arched, head thrown back, jaw open. The legs are left to the foot
  plants: no tiptoes and no bent knees. The star is arms, trunk, head and jaw.
- Three variants, chosen by `ZapOut.variant`: 0 the star; 1 arms higher; 2 one arm up and one out. A jolt
  snaps between them in one frame; no blend, because the snap is the look.
- Tremor: a rotation of the trunk, not a translation of the root. A side sway and a pitch a quarter turn
  apart, of `ZAP.tremorM / 0.5 m` radians, move the chest by `ZAP.tremorM` (0.012 m) at `ZAP.tremorHz`
  (25 Hz), scaled by `ZapOut.tremor`. It needs no new motion channel. The hands carry a small jitter with it.
- A tier with `star` false gets the tremor only, with its arms left alone. Built for the gorehound and the
  gutcrawler. Whether every body that fails `canDeathFall`'s biped test should have it is open (below).

### 3. The actor: `game-actor.ts`

A `zap` slot beside `burnPanic`, applied as an override of the mind's verdict (the `doomed` pattern), so
no brain learns a zap state.

```ts
beginZap(): boolean;          // false if melting, tearing, a corpse, going down, or already a statue
setArc(on: boolean): void;    // sticky: the weapon sets it each tick for the body it is on, and clears it
zapping(): boolean; zapPhase(): 'none' | ZapState['phase'];   // 'crumble' and 'heap' come with plan 3
zapLook(): { glow: number; invert: boolean; char: number } | null;   // what the renderer draws
```

- While zapped: movement zero, attacks and gunfire refused, the pose channel fed from `zap-pose.ts`.
- A lunge or a pounce already under way is cancelled (the mind's `advance` is cleared), so a body zapped
  mid-lunge stops where it is.
- A floater's idle drift is suppressed while it is zapped.
- The zap is dropped when the body is doomed or down by another cause, statue included.
- When the statue's time is up the actor forces the body's ordinary collapse. This is plan 1's death.
- The step uses the WORLD `dt`. The weapon's own timers use `pdt` (the bullet-time split in
  `game-tick.ts`).
- Plan 3: the death sets `blowAwayRolled`, so a `physicsDeath` body does not roll a slump under the
  statue. Plan 1 does not set it, because its death is the ordinary one.
- `burnPanic` is suspended, not cleared, while the body is zapped, and resumes on recovery.

### 4. The look

**The per-body lane.** `REC_BURN.w` carries `glow`, negative while the bones are inverted (a jolt). It
is per body and not per view for the reason `REC_BURN` exists: the crowd shares one material. The game
writes the glow to the view's `burnCfg.w` and `writeViewRecord` carries it to the body's own record. The
shader reads the record alone (`gInstBurn.w`), never `burnCfg.w`: a crowd type's material copies its
source body's uniforms every frame, so a value read from the view is every body's of that type. The first
build read the larger of the two and the whole type glowed with the one body.

`char` reaches the existing `REC_BURN.z` by the same route and for the same reason. It is held in a
per-view value, `zapChar`, that the march does not read; `writeViewRecord` puts the larger of the burn's
char and `zapChar` in the body's own record.

**The flesh:** `webgpu/march/body/blocks/post/zap.wgsl.ts`, in two blocks, because the lit colour exists
only in the lighting tail. `ZAP_BLOCK` sits in the post-hit material beside the burn block and gathers the
terms (glow, invert, the bone probe). `ZAP_LIGHT_BLOCK` sits at the end of the lighting tail
(`light.wgsl.ts`) and mixes the colour. Where `glow > 0` the lit colour is replaced, in proportion to
`glow`, by a flat emission: blue-white (`ZAP_LOOK.core`), brighter toward the silhouette by a view-angle
rim term, with no shadowing and no wound or blood colour. The body's own face and prim glow fade under it.
Zero on every body that is not zapped, so no other pixel pays.

**The skeleton.** Three ways to show it were weighed:

| Approach | Result | Cost |
| --- | --- | --- |
| Draw the mesh skeleton over the glowing flesh (chosen) | The real kit skeleton: ribs, skull, pelvis. | As designed, a second draw of a zapped body's bone batches. As built, none (below). |
| Bone probe in the body shader, as `burn.wgsl.ts` does | No new pass. | Bones read as soft capsules; ribs sit too deep to show. |
| Screen-space pass over a body mask | Any look at all. | A new post pass for one weapon. |

The mesh skeleton is the forward default (`skeleton-spike/selector.ts`) and is already posed under the
flesh every frame. There is no extra batch. Each bone and eye instance on the existing skeleton batches
carries a per-instance `iZap`, its owner's signed glow (`skeleton-spike/zap-xray.ts`; `mesh-renderer.ts
syncZap`, once a frame). Where it is not zero:

- the vertex is pulled toward the eye along its own view ray by `ZAP_XRAY.pullM` (0.6 m), never to under
  a quarter of its distance. Its place on screen does not move, only its depth. That clears the body's
  own flesh while a wall nearer than the pull still hides it;
- the fragment is mixed toward a flat colour: `ZAP_LOOK.bone` (near black) in the glow, the glow's colour
  on a jolt. The mix is the glow times `ZAP_XRAY.saturate` (4), so the bones are flat from a glow of 0.25
  up and hold one colour while the glow flickers, and still fade over the attack and the recovery.

An intact body draws only its head segment, so a body is added to the bone exposure set while it glows
(`boneExposedActors`, `zapLook().glow > 0`) and its whole skeleton is drawn. A statue is not in the set.
Organs are left out: an organ batch's `iZap` is always 0, so an organ is never pulled or flattened. Eyes
take the zap with the skull and go flat, so the pupil is gone.

The un-pulled surface point is carried separately (`segmentWorldPosition`, `segment-instance.ts`). The
head-split clip, the wound exposure and the bone's lights read it, so a split head stays split in the
x-ray and a wound still exposes what it should. No batch, material or pipeline is added, so nothing is
built mid-game. The split bone and split plate batches are now at the limit of 8 vertex buffers.

Procedural-skeleton bodies (`?skeleton=procedural`, and anything the selector sends there) fall back to
the bone probe inside `zap.wgsl.ts`, reusing `applyBones` as the burn does. The probe is written and has
not been run. The deferred renderer is out of scope and shows the glow with no skeleton.

### 5. The weapon harness: `game-tesla.ts` (new), slot 9

`WeaponSlot` gains `'tesla'` on `Digit9`. A placeholder primitive prop in the melter's mould.

- While fire is held and the slot is ready, each tick traces the aim ray to `TESLA.rangeM` (12 m). The
  trace is a straight segment with the range as its reach (`traceMeleeHitFrom`, the rod's), not the
  ballistic slug trace the melter and the flare use: that one drops about 0.5 m at 12 m and has no reach.
- The trace sees bodies only, so walls are tested separately (`sightBlocked`: collider boxes, and sector
  walls on a sector level). A wall in the way stops the arc from landing on a body and from staying on one.
- A body hit becomes the target: `beginZap()`, then `setArc(true)` every tick. The arc holds while the
  crosshair is on the body itself, or while the aim is within `TESLA.stickDeg` (8 degrees) of the body's
  centre with the centre in sight (no wall and no other body on the line). The first half is there because
  from close up an arm is far more than 8 degrees off the centre. The centre is the posed torso's.
- No body hit: nothing happens in plan 1. The arc ending on a surface with sparks, or at full range in
  open air, is plan 2's.
- `setArc` is sticky, so the harness re-derives the arc from scratch every tick, whatever the live slot,
  and takes it off in every other case: release, a weapon switch (from the moment the slot starts to
  lower), the aim leaving, a wall, the body refusing (a statue, a corpse, a melt), the body gone or queued
  to gib, input blocked, a demo replay, the window losing focus or the pointer lock.
- Console: `__sdfGame.zapActor(id?)`, `unzapActor(id?)`, `zaps()`, `fireTesla(on)`, `tesla()`, and
  `boneZap(id?)` for the x-ray's per-instance values.

### 6. The arc: `arc-path.ts` (new, pure) and `game-arc.ts` (new)

**The path.** `arcPath(from, to, seed, tick)` returns a polyline by midpoint displacement: 5 levels,
displacement `ARC.jagFrac` (0.09) of the span at the top level and halving below it, perpendicular to the
span. `tick` advances at `ARC.rerollHz` (24); the same seed and tick give the same line. The two ends are
pinned.

**Forks.** Two to four per reroll. Each leaves the main bolt at a seeded point along it and reaches for
a surface point the game side supplies (a few level raycasts from the bolt, refreshed at 6 Hz, not per
reroll). A fork with no surface in `ARC.forkReachM` (2.5 m) trails off into the air at half length. Forks
are 0.35 of the main bolt's width and live for one to three rerolls.

**Crawl arcs.** Three to five short arcs between joints of the target (hand to hip, shoulder to head,
knee to knee), picked by seed each reroll, at 0.2 of the main width.

**Render.** One instanced draw of camera-facing ribbon segments, additive, depth-tested and not
depth-written, in hand-written WGSL (`arc.wgsl.ts`): a white core, `ARC.edge` blue-violet falling off
across the ribbon, brightness flickering with `glow`. Main bolt width `ARC.widthM` 0.07 m. The buffer is
sized once for the maximum segment count. The existing glow post picks it up; nothing new in the post
chain.

**Light.** One pooled `PointLight` under a parent that is never hidden, intensity only, zero when the
arc is off (the `LightsNode` re-key rule). It sits at the arc's end point, coloured `ARC.edge`, and
flickers with the reroll. It counts against the 8-light dynamic budget. The zapped body also goes into
`directFlashes` so neighbouring bodies catch the flash.

**Impact.** Where the arc ends on a surface: a small spark burst per reroll through the existing
particle path. On a body: none; the crawl arcs are the impact.

### 7. The ash death: `ash.ts` (new, pure), `game-ash.ts` (new)

The statue is `ZapState.phase === 'statue'` for `ZAP.statueSec` (0.8 s, built in plan 1): the star pose frozen at the
variant it died in, no tremor, `char` 1, `glow` 0, smoke through the existing burn-smoke cards.

The crumble reuses the melt: `beginMelt` / `stepMelt` on the actor, `melt-bones.ts` groups released as
bone-only chunk pieces, `dropKit` for armour and the held prop. What differs is carried by a
`MeltProfile` that `beginMelt` takes (default: today's melt):

| | melt | ash |
| --- | --- | --- |
| front | rises from the feet and the hit | falls from the top of the head |
| body tuning | `stagger`, `stretch`, `neck`: flesh sags and runs | all three zero: prims shrink in place and drop |
| blend | fuses as it sags (`meltBlendK`) | no fuse; the edge is broken by a noise threshold |
| residue | thin wide pool | cone: `ASH.heapR` 0.45 m, `ASH.heapH` 0.18 m |
| surface | red, wet | matte grey-black, wetness zero, ember speckle fading over `ASH.emberSec` (6 s) |
| drips | blood droplets | grey flake particles, drifting |
| rate | 2 s | `ASH.crumbleSec` 1.4 s |

`ash.ts` holds the profile's numbers and the two pure functions that are not the melt's: the top-down
front and the erode threshold. The surface look is a branch in `post/melt.wgsl.ts` keyed on a profile
flag in `meltCfg`. That uniform's lanes are scarce (`z` is the skin detail k); the plan must find the
flag a home before anything else in this piece is built, and use a new vec4 if none is free.

Bones dropped by the crumble are tinted toward char so they sit in the heap as burnt bone.

## Error handling

- `beginZap` on a body that cannot be zapped returns false and does nothing; the arc then treats the
  body as a surface and ends on it (plan 2; in plan 1 nothing is drawn).
- A target that is removed, gibbed or made a corpse by another weapon mid-arc drops the arc that tick.
- An actor with no bone meshes for the x-ray batch (not built yet, or procedural) uses the probe
  fallback; the glow never waits on the skeleton.
- A reset (`` ` `` respawn, level change) clears the zap slot with the other burn fields.

## Testing

Focused tests beside the files; no full suite locally. Built in plan 1: `zap.test.ts`, `zap-pose.test.ts`,
`game-actor-zap.test.ts` (without the crumble and heap), `game-weapon-slots.test.ts`, `scripts/zap-trace.mjs`,
and also `game-zap.test.ts`, `game-tesla.test.ts`, `tesla-stick.test.ts`, `zap-xray.test.ts` and
`zap.wgsl.test.ts`. `arc-path.test.ts` and `ash.test.ts` belong to plans 2 and 3.

- `zap.test.ts`: cook rises and falls at the stated rates; `die` fires once and only for a dying tier;
  the same seed gives the same jolt times; an arc returning mid-recovery resumes.
- `zap-pose.test.ts`: every variant, at every tremor phase, keeps each arm within its reach (no stretch).
- `arc-path.test.ts`: pinned ends; the same seed and tick give the same line; displacement inside bounds;
  fork count and lifetimes.
- `ash.test.ts`: the front is monotonic top-down; everything ends inside the heap cone.
- `game-actor-zap.test.ts`, on the stub-view pattern of `game-actor-melt.test.ts`: a zapped body does not
  move or attack; release recovers; a full cook reaches statue, crumble and a set heap that does no
  further work; a shotgun kill mid-zap takes the shotgun's death; a melting body refuses the zap.
- `game-weapon-slots.test.ts`: slot 9.
- `scripts/zap-trace.mjs`, headless, in the mould of `burn-behaviour-trace.mjs`: hold the arc on one
  body to the heap, and report phases, timings and `pipelineLog().totalPipelines` before and after (no
  rebuild from the light or the x-ray batch).
- March goldens re-recorded if `zap.wgsl.ts` changes any unzapped pixel; it should not.

Not covered by any of this: how it looks. The glow, the skeleton read, the bolt and the crumble are the
owner's to judge in the arena (`npm run dev:arena`), and every number above is a first guess.

Not verified in plan 1 (the full list is in the notes): the look in motion, any character but the zombie,
the procedural-skeleton probe, bullet time, Night Train and sector levels, and a zapped body with anything
within 0.6 m in front of it.

## Open after this spec

- Per-character `ZapTier` values, and which bodies get `star: false` (today the gorehound and the
  gutcrawler; every other body takes the default tier).
- Whether a long zap should set a body alight instead of charring it (the owner raised it; not built).
- The weapon model and its coil arcs in the hand.

For the owner to judge, from plan 1's frames:

- The bones nearly fill the body, so the glow reads as a rim round the skeleton, not as a body with bones
  inside it.
- Up close (1.1 m) the flat skull is a featureless dark oval: no sockets, teeth or jaw line.
- The statue is a glossy dark brown figure with bright highlights, not matte ash.
- Tapping the trigger can still cook a body. Cook falls at 0.5 a second, so a body whose roll is under
  2.0 s gains more under the arc than it loses in an equal time off it.
- A tier that does not die ends fully charred.
- Whether the arc should finish a downed soldier. Today it refuses him.

For plan 2 to handle:

- Pulled bones write depth up to 0.6 m in front of their body. The arc's end on the chest, and anything
  pressed close to a zapped body, is covered by the skeleton unless the arc is drawn over it.
- Inside about 0.8 m the pull is held to a quarter of the bone's distance, so a very near body's bones sit
  at a quarter of their distance from the eye.
