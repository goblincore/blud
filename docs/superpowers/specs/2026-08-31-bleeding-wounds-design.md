# Bleeding wounds — design

**Date:** 2026-08-31 · **Status:** approved (brainstormed with owner)
**Scope:** `sdf-game.html` + shared `src/lab/sdf-zombie/` sim modules. WebGPU only.
**Owner intent:** "add some bleeding particle stuff to the wounds to make it
more apparent" — part of the base combat-loop feel push (weapon → enemy
reaction), prioritised above bestiary/arena work.

## Decisions (owner calls, recorded)

- **Per-calibre behaviour**, not uniform: pellets ooze briefly, slug craters
  spurt-then-drip, severed stumps gush. Reuses the wound-type system that
  already routes stagger (per-kind impulse work, 2026-08-28).
- **Splat decals** on landing — not a goo-layer port (that upgrade can layer
  on later), not vanish-on-contact.
- **Visual-only** (assumption stated and accepted): no damage-over-time
  gameplay hook. Every bleed decays to a stop on its own clock. If bleed-out
  mechanics are ever wanted, the emitter clock is the natural hook.

## The emitter model

New `WoundEmitter` machinery in `blood-sim.ts`, beside the existing
burst/trail/splat paths (which stay untouched — the lab consumes them):

```
WoundEmitter {
  bodyId, woundRef (primIdx + wound index or torn-end ref),
  kind: 'pellet' | 'slug' | 'stump',
  bornAt: seconds,
}
```

Per-kind tuning (constants in one exported table, `WOUND_BLEED`, so the panel
and tests share it):

| kind | rate curve | speed band | lifetime |
| --- | --- | --- | --- |
| pellet | low, constant | short dribble | ~2 s then dead |
| slug | high initial, exp decay to a drip | medium spurt | ~6–8 s |
| stump | highest, arcing gush | high, cone around the stump normal | ~10 s |

Burn wounds do not bleed (charred). Additionally, **flying severed chunks turn
trail emission on** — the sim already supports chunk trails (lab-proven); the
game page has simply never enabled them.

Determinism: all spawn decisions run on the seeded RNG (`mulberry32` house
pattern) so tests can pin exact droplet counts per (kind, dt, age).

## Anchoring — the part that makes it read

Emitters store **references, not positions**. Every frame the anchor is
recomputed via `woundWorldPos(posedPrims, wound, yaw)` — the same function
`debugWounds` and the placement gate use — so blood rides the walking,
staggering, collapsing body for free. Emit direction is a cone around the
carve normal (`woundCarveNormal`). Stump emitters anchor at the torn end on
the remaining body (`tornAt` from the sever path).

A dead/removed body (collapsed past its despawn, if that ever exists) kills
its emitters; a merely collapsed body keeps bleeding — pooling under a corpse
is desirable.

## Rendering (game page)

- **Droplets: main polygonal pass, depth write on.** No muzzle-flash-style
  post-composite special case — the SDF composite depth-tests against
  polygonal depth (sdf-layer's depth-in-alpha contract), so droplets in front
  of flesh occlude it and droplets behind flesh are hidden, both for free.
  This is the key simplification and should be verified by the first capture.
- Renderer: adapt `blood-view-gpu.ts` (the lab's WebGPU droplet renderer)
  for the game page; one instanced draw for droplets. **Visual = the existing
  gib-blood droplet look, as placeholder** (owner call 2026-08-31): reuse what
  the lab's gib blood already renders rather than authoring a new droplet
  sprite. A gooey-layer-derived look is an explicit later pass.
- **Splats: flat dark decal quads** where droplets settle, from the sim's
  existing splat stamps. Depth-tested against the floor, slight offset to
  avoid z-fighting. Capped, oldest-recycled.

## Budgets

- Global droplet cap: start at the sim's `MAX_DROPLETS` 600; re-measure under
  sustained fire and tune.
- Per-body emitter cap (a body porcupined with pellets should coalesce, not
  spawn 30 emitters — merge or evict oldest).
- Splat cap: `MAX_SPLATS` 256, oldest recycled.
- Cost gated with the existing firefight bench — the `fire` segment is the
  natural probe, and this feature finally gives it real per-hit work.

## Testing

- Pure sim: per-kind rate/decay/lifetime under seeded RNG; caps and recycling;
  emitter death on body removal.
- Game wiring: hit → emitter registered → droplets spawned → splat landed
  (deterministic step counts).
- Visual gates, shell-gate protocol (freeze + settle + same-state noise
  floor): per-calibre side-by-sides (pellet vs slug vs sever), and an
  off-state bit-identical capture with the feature disabled.
- Bench: `fire`-segment delta at the droplet cap, chunked+fenced only.

## Out of scope

- Goo-layer port to the game page (pooling upgrade, later) — and likewise a
  goo-derived droplet/splat LOOK; the placeholder is the existing gib-blood
  visual (owner: "can be later pass").
- Blood on walls behaving differently from floors (splats stamp whatever the
  droplet settles on).
- Any gameplay effect of bleeding.
- Lab-page changes beyond what shared-module edits require (lab stays
  bit-identical for its existing paths).
