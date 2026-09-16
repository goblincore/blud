# Gib physics — NotBlood launch distribution and grounded rest

Task 3 of the 2026-09-16 playtest follow-ups. This is the engineering reference
for the two changes: the **per-piece launch distribution** (why pieces no longer
cluster) and the **orientation-aware floor support** (why settled pieces no
longer float). Owner-facing evidence is in
[RESULTS.md](RESULTS.md); this file is the "how it works and where the numbers
come from" companion.

## 0. Source availability — read this first

**The NotBlood C source tree is NOT present on this machine.** The path the
earlier memory/notes cite (`/Users/donny/Documents/Raze/NotBlood/source/blood/src`)
does not exist; `~/Documents/Raze` contains only `raze.log`, the iCloud archive
holds `NotBlood/platform/` but no `source/`, and a filesystem search for
`gib.cpp` / `actor.cpp` finds nothing (checked 2026-09-16).

Everything below is therefore cited to **Blud's own ported/generated artifacts**,
which the project treats as the verified authority:

| Artifact | What it carries |
| --- | --- |
| `src/game/notblood/notblood-tables.gen.ts` | codegen from the C aggregate tables (`scripts/gen_notblood_tables.py`): `gibList[]`, `thingInfo[]`, `explodeInfo[]`, `dudeInfo[]` |
| `src/game/notblood/death-outcome.ts` | the pure `GibThing` no-`pVel` velocity math (`spread()`), `actKillDude`'s `nGibType` loop |
| `src/game/notblood/outcome-adapter.ts` | the raw-field → m/s unit chain, with the `xvel >> 12` `MoveThing` integration documented |
| `src/game/gibs/tuning.ts` | `BU_PER_METER`, `TICS_PER_SECOND`, `buPerTicToMps`, ConcussSprite-derived `EXPLOSION_LAUNCH` |
| `docs/tuning-sources-gibs.md` | the `gibList[]` / `GibSprite` / `GibThing` behaviour survey |

No fidelity claim here is stronger than those artifacts support. Where a raw C
value is genuinely needed and only the port has it, that is called out.

## 1. The two NotBlood launch paths, and which one a gib is

NotBlood dispatches gib spawns through `GibSprite(spritetype*, GIBTYPE, pos, vel)`
(`gib.cpp:435`) and launches bodies/chunks through two *different* mechanisms:

1. **`GibThing`'s no-`pVel` branch** (`gib.cpp:361-432`), reached for a body gib
   because `actKillDude` calls `GibSprite(..., NULL, NULL)` (`actor.cpp:3463-3468`).
   Each thing gets its **own random spread** from the gib table's `atc` (Build
   x/y floor plane) and `at10` (Build −z, upward) fields. There is **no radial /
   blast bias** — independence is the source behaviour
   (`death-outcome.ts` `spawnBodyChunks`).
2. **`ConcussSprite`** (`actor.cpp:2677`) — a generic shockwave shove applied to
   every `kPhysMove` sprite in the blast radius, radial and inverse-square in
   distance. It is coherent: two body parts a few centimetres apart get almost
   the same vector.

The two coexist (a gib thing is still a `kPhysMove` sprite), so the
source-faithful lab launch is **independent per-piece table spread + one shared
coherent shove**, which is what `src/lab/sdf-zombie/gib-launch.ts` implements.

**What the active lab used to do** (`game-main.ts` `gibActor`): call
`concussionVelocity(at, g.origin, impulse × launchFall × gibVelScale)` *per
piece*. Because `g.origin` is the piece's own region centre, neighbouring pieces
received near-parallel velocities — the "pieces cluster too much" the owner saw.
That is path 2 applied where path 1 belongs.

## 2. Unit chain (verified against the port)

```
GibThing (no pVel):      vx = Random2((atc  << 18) / 120)      raw xvel field
                         vz = -Random((at10 << 18) / 120)      raw zvel field (Build -z = up)
MoveThing integration:   position += xvel >> 12                (actor.cpp:4429/4449)
  => true BU/tic        = raw field / 4096
buPerTicToMps:           m/s = (BU/tic) * TICS_PER_SECOND / BU_PER_METER
                              = BU/tic * 120 / 256
```

For `gibList[15]` = `gibHuman` (the human overkill set — every one of its 7
things carries `atc: 300, at10: 900`; zombies and cultists share it, see
`docs/tuning-sources-gibs.md`):

| axis | raw field | BU/tic | m/s |
| --- | --- | --- | --- |
| horizontal `atc` | `(300 << 18)/120` = 655 360 | 160 | **75** |
| upward `at10` | `(900 << 18)/120` = 1 966 080 | 480 | **225** |

`sourceSpreadMps()` in `gib-launch.ts` reproduces this chain and
`gib-launch.test.ts` pins both numbers.

**Axis remap.** Blood's x/y are the floor plane and −z is up. In the lab
(+y up) the remap is Build x → lab x, Build y → lab z, Build −z → lab +y, so the
table's horizontal square spread maps to lab x/z and the upward kick to lab +y.

## 3. Calibration — match the distribution, calibrate the magnitude

75 / 225 m/s are genuine Blood numbers, but Blood's physics scale is not the
lab's: the lab runs `CHUNK_TUNING.gravity = -9.8 m/s²`, against which a 225 m/s
up-kick arcs for ~15 s and leaves the arena in one frame. `GIB_LAUNCH.spreadScale`
(0.027, **a Blud feel value — NOT derived**) scales the source envelope down
while preserving the **source ratio exactly** (`at10/atc = 3`):

- horizontal envelope ≈ 2.0 m/s per axis,
- upward envelope ≈ 6.1 m/s,
- the same arc class as the concussion launch it replaces (point-blank ≈ 8.8 m/s),
  which is the energy the owner already accepted.

This is the same reasoning recorded for `DYNAMITE_COOK` in `tuning.ts` ("match
the source RANGE, not its raw launch speed"). Changing the *distribution* is the
fix; changing the *energy* is not the goal.

## 4. The launch model (`gib-launch.ts`)

```
v = clamp( spread(key, seed) + coherentFrac * bodyVel, maxSpeedMps )
```

- `spread` — independent uniform lab-x/z ∈ [−h, +h] and lab-y ∈ [0, 3h], rolled
  from `hash01(key, salt, seed)`. `key = "<part>#<index>"` (the region's own
  identity, the same convention as the rupture spin's seeded axis).
- `bodyVel` — ONE coherent velocity computed at the body's torso centre with the
  existing `concussionVelocity(at, torsoC, impulse × launchFall × gibVelScale)`;
  this is the shove the body itself would have taken (ConcussSprite + inherited
  motion). It is shared, not per-piece, which is what removes the correlation.
- `coherentFrac` — 0.6. 1 would move the whole set on one vector and read as a
  single mass; 0 would drop the blast read.
- `maxSpeedMps` — 16, a hard bound so a hot body shove cannot produce a
  confetti-cannon.

**Determinism.** The spread is a pure FNV-1a hash of `key`/salt/`seed`, not a
draw from `rngStreams.misc`, so adding this launch cannot shift the draw order of
any other system (torn-end radii, head faces, sprite frame picks). The same
`?seed=` and the same body always produce the same burst; a different seed
re-rolls it.

**One kick, not two.** The launch velocity is still applied through the existing
`pendingGibImpulses` release with the rupture hand-off's `delay = 0` (task 2), so
the piece integrates it on the release tick. The rupture's own separation
translation and the task-4 angular hand-off (`spinQuat` / `spinAngVel`) are
untouched: orientation and angular velocity remain continuous across the
hand-off, and the new launch adds only the linear term.

## 5. Grounded rest — narrow-phase support

### The bug

`stepChunk` pinned the chunk **origin** to y = `radius`, and `radius` is
`chunkExtent(prims, origin)` — the **furthest reach** of the piece, i.e. half a
limb's *length*. As the piece rotated, the origin stayed at that half-length
height, so a shin lying flat hovered by roughly `(half-length − thickness)`, and
`chunkSettled` (which tested `y <= radius`) froze it there. `boneChunkRadius`'s
1.6× girth margin has the same class of error for bones.

### The model

`Chunk.support` is a list of **local support spheres** — one per capsule end, at
that prim's own cross-section girth
(`chunkSupportSpheres()` in `extent.ts`, conservative like every outer bound:
`radius × boxReach × strandReach × maxScale + shellReach`). Two functions read
it, both pure:

- `chunkSupportOffset(c)` = origin → **lowest** world point (floor contact),
- `chunkTopOffset(c)` = origin → **highest** world point (ceiling contact).

`stepChunk` floors at `chunkSupportOffset` and caps at `chunkTopOffset` for the
current `quat` (and applies `squashFactors` so impact flattening is consistent
with the renderer's transform). `chunkSettled` uses the same offset, so a
floating piece is never frozen.

**Broad phase stays broad.** `Chunk.radius` is unchanged and still drives the
wall/box sweep (`resolveBoxes`) — a sphere is the right conservative bound there.
The support shape is only the narrow-phase plane contact. This split is explicit
so a future wall contact can get its own shape without touching the floor.

**Bake continuity.** `ChunkGpuView.bakeData()` packs world-space prims through
`chunkPoint` (pos + rotate + squash). At settle `squash = 0`, and the support
offset is derived from the same local geometry, so a piece that rests with its
lowest point at y = 0 bakes with its lowest point at y = 0 — no sink or pop at
the live → baked swap.

**Topple.** Unchanged: a grounded, slow chunk eases its long axis toward
horizontal. As it flattens the support offset *decreases*, gravity lowers the
origin onto the new offset, and the piece ends flat on the floor rather than
standing on end.

### Conservative gaps (honest)

- A tapered or squashed prim uses `max(radius, radiusB) × maxScale` for both end
  spheres, so a piece can rest a few millimetres high at the thin end. It never
  sinks.
- `?gibrender=carve` pieces carry a pre-baked `piece.radius`/`longAxis` and no
  prim list, so they keep the historical single-sphere support. Carve is
  non-default; recorded as a limit.
- The floor is the y = 0 plane (`dynamite-flight.ts`). Real room floors at a
  different height would need the support plane threaded through
  `chunkCollidersAt`; the lab's floor is 0, the walls/ceiling are the real level
  colliders.

## 6. Knobs

| Knob | Where | Meaning |
| --- | --- | --- |
| `GIB_LAUNCH.spreadScale` | `gib-launch.ts` | Blud calibration of the source envelope (NOT derived) |
| `GIB_LAUNCH.coherentFrac` | `gib-launch.ts` | shared body shove applied to every piece |
| `GIB_LAUNCH.maxSpeedMps` | `gib-launch.ts` | hard per-piece speed bound |
| `GIB_TABLE_SPREAD` | `gib-launch.ts` | the source `atc`/`at10` fields (per gib set) |
| `chunkSupportSpheres(..., maxCount)` | `extent.ts` | support-point budget; past it, one conservative extent sphere |
| `CHUNK_TUNING.*` | `gib-chunks.ts` | unchanged gravity/restitution/topple/settle tuning |
