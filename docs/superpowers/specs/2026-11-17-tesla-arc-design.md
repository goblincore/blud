# The tesla arc: zap state, the arc, and the ash death

Date: 2026-11-17. Status: design, not built, nothing measured.

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
| statue | `cook` reached 1 on a tier that dies | The arc on it cuts. Rigid pose held, fully charred, glow out, smoking. |
| crumble | after `statueSec` | Flesh erodes top-down into an ash heap; bones and kit drop into it. |
| heap | after | A set ash heap. A corpse to every reader; no per-frame work. |

Rules at the edges:

- An arc that returns during `recovering` puts the body straight back to `zapped`; `cook` carries on from
  where it had fallen to.
- A body whose tier does not die holds at `cook` 1 for as long as the arc stays, and recovers on release.
- A zapped body killed by something else takes that death. The glow cuts on the frame it dies and the
  char it had stays.
- A burning body can be zapped. If the arc kills it, the fire is retired the way `meltActor` retires it.
- A melting, tearing or gib-queued body cannot be zapped (the same refusal `meltActor` makes).
- A statue or a crumbling body takes no hits, as a melting body takes none.

## Pieces

### 1. The zap clock: `zap.ts` (new, pure)

`src/lab/sdf-zombie/zap.ts`. No clock of its own, no randomness beyond the seed.

```ts
export interface ZapTier { cookSec: [number, number]; dies: boolean; recoverSec: number; star: boolean; }
export interface ZapState { phase: 'zapped' | 'recovering' | 'statue'; cook: number; cookSec: number;
                            t: number; seed: number; dies: boolean; recoverSec: number; }
export interface ZapOut { glow: number; char: number; tremor: number; jolt: number; variant: number;
                          invert: boolean; done: boolean; die: boolean; }
export function createZap(seed: number, tier: ZapTier): ZapState;
export function stepZap(s: ZapState, dt: number, arcOn: boolean): ZapOut;
```

- `cookSec` is rolled once from the seed inside the tier's range. `cook` rises at `1 / cookSec` while the
  arc is on and falls at `ZAP.coolRate` (default 0.5 per second) while it is off.
- `glow` snaps to 1 within `ZAP.attackSec` (0.06 s) of the arc landing and fades over `recoverSec`. It
  carries the flicker: two incommensurate noise rates off the seed, in the range 0.55 to 1.
- `char` is `smoothstep(ZAP.charFrom, 1, cook)` with `charFrom` 0.6: the flesh darkens only in the last
  stretch, so a brief zap leaves no mark.
- `jolt` is a short pulse (about 0.08 s) fired at seeded irregular intervals of 0.25 to 0.7 s. Each jolt
  picks a new `variant` (0 to 2) and sets `invert` for its length.
- `die` is true on the one step `cook` reaches 1 with `dies` set; `done` is true when a recovery ends.
- `ZapTier` lives in `motion-profile.ts` beside `BurnTier`. Default: `cookSec [1.6, 2.2]`, `dies` true,
  `recoverSec` 0.6, `star` true. Per-character values are tuning, set when the owner judges it in the arena.

### 2. The pose: `zap-pose.ts` (new, pure)

In `burn-flail.ts`'s mould: it returns hand targets in shoulder coordinates and trunk and head angles;
`motion.ts` places the arms with `solveElbow`, so no segment stretches.

- Base: arms out and slightly up, back arched, head thrown back, jaw open, up on the toes, legs straight
  and a little apart. Fingers splayed where the rig has them.
- Three variants, chosen by `ZapOut.variant`: arms higher; arms level with knees bent; one arm up and one
  out. A jolt snaps between them in one frame; no blend, because the snap is the look.
- Tremor: a positional shake of the whole body, `ZAP.tremorM` (0.012 m) at about 25 Hz, scaled by
  `ZapOut.tremor`.
- Bodies that fail `canDeathFall`'s biped test, and the gorehound, which passes it with a non-biped rig,
  get the tremor and a stiffened current pose instead of the star: their tier sets `star` false.

### 3. The actor: `game-actor.ts`

A `zap` slot beside `burnPanic`, applied as an override of the mind's verdict (the `doomed` pattern), so
no brain learns a zap state.

```ts
beginZap(): boolean;          // false if melting, tearing, a corpse, or already a statue
setArc(on: boolean): void;    // the weapon calls this each tick for the body it is on
zapping(): boolean; zapPhase(): 'none' | ZapState['phase'] | 'crumble' | 'heap';
```

- While zapped: movement zero, attacks and gunfire refused, the pose channel fed from `zap-pose.ts`.
- The step uses the WORLD `dt`. The weapon's own timers use `pdt` (the bullet-time split in
  `game-tick.ts`).
- The death sets `blowAwayRolled`, so a `physicsDeath` body does not roll a slump under the statue.
- `burnPanic` is suspended, not cleared, while the body is zapped, and resumes on recovery.

### 4. The look

**The per-body lane.** `REC_BURN.w` (spare today) carries `glow`, with the sign bit carrying `invert`.
It is per body and not per view for the reason `REC_BURN` exists: the crowd shares one material. `char`
goes through the existing `REC_BURN.z`, taking the max with any burn char.

**The flesh:** a new post-hit block `webgpu/march/body/blocks/post/zap.wgsl.ts`, after `burn`. Where
`glow > 0` the lit colour is replaced, in proportion to `glow`, by a flat emission: blue-white
(`ZAP_LOOK.core`), brighter toward the silhouette by a view-angle rim term, with no shadowing and no
wound or blood colour. Zero on every body that is not zapped, so no other pixel pays.

**The skeleton.** Three ways to show it were weighed:

| Approach | Result | Cost |
| --- | --- | --- |
| Draw the mesh skeleton over the glowing flesh (chosen) | The real kit skeleton: ribs, skull, pelvis. | A second draw of a zapped body's bone batches. |
| Bone probe in the body shader, as `burn.wgsl.ts` does | No new pass. | Bones read as soft capsules; ribs sit too deep to show. |
| Screen-space pass over a body mask | Any look at all. | A new post pass for one weapon. |

The mesh skeleton is the forward default (`skeleton-spike/selector.ts`) and is already posed under the
flesh every frame. `mesh-renderer.ts` gains an x-ray batch per bone material: the same geometry and
instance matrices, drawn only for zapped owners, unlit and flat (`ZAP_LOOK.bone`, near black; white when
`invert`), with its clip-space depth pulled toward the camera by `ZAP_LOOK.xrayPullM` (0.6 m). That
clears the body's own flesh while a wall nearer than the pull still hides it. The batch is created at
boot and drawn with a count of zero when nothing is zapped, so no pipeline is built mid-game.

Procedural-skeleton bodies (`?skeleton=procedural`, and anything the selector sends there) fall back to
the bone probe inside `zap.wgsl.ts`, reusing `applyBones` as the burn does. The deferred renderer is out
of scope and shows the glow with no skeleton.

### 5. The weapon harness: `game-tesla.ts` (new), slot 9

`WeaponSlot` gains `'tesla'` on `Digit9`. A placeholder primitive prop in the melter's mould.

- While fire is held and the slot is ready, each tick traces the aim ray to `TESLA.rangeM` (12 m).
- A body hit becomes the target: `beginZap()` once, then `setArc(true)` every tick. The arc sticks to its
  target while the aim stays within `TESLA.stickDeg` (8 degrees) of the body's centre and the line to it
  is clear, so a small aim wobble does not drop it.
- No body hit: the arc ends on the surface the ray reached (sparks there), or at full range in open air.
- Release, a weapon switch, or the target reaching `statue` ends the arc: `setArc(false)`.
- Console: `__sdfGame.zapActor(id?)`, `__sdfGame.fireTesla(on)`, `__sdfGame.zaps()`.

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

The statue is `ZapState.phase === 'statue'` for `ASH.statueSec` (0.8 s): the star pose frozen at the
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
  body as a surface and ends on it.
- A target that is removed, gibbed or made a corpse by another weapon mid-arc drops the arc that tick.
- An actor with no bone meshes for the x-ray batch (not built yet, or procedural) uses the probe
  fallback; the glow never waits on the skeleton.
- A reset (`` ` `` respawn, level change) clears the zap slot with the other burn fields.

## Testing

Focused tests beside the files; no full suite locally.

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

## Open after this spec

- Per-character `ZapTier` values, and which bodies get `star: false`.
- Whether a long zap should set a body alight instead of charring it (the owner raised it; not built).
- The weapon model and its coil arcs in the hand.
