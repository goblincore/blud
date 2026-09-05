# Close-up task 5 — bake what has stopped moving (settled-chunk bake)

Branch `dispatch/2026-09-04-closeup-task-5` (kimi/glm-5.3-flash:xhigh), cherry-picked onto
main 2026-09-05 (its history still carries the pre-rewrite 116 MB glb, so it was never merged).
Dispatch timed out (exit 124) after ~5 h with **all nine gates green**; only the look capture was
left. The owner did the look pass in-game instead.

## What it does

A gib chunk that has come to rest is a rigid static field that will never change again. When
the seam is on, the settle predicate (`chunkSettled` in `gib-chunks.ts`: grounded, no angular
velocity, squash relaxed, topple < 0.011 rad, speed < settleSpeed) fires ONCE per chunk; the
chunk is spliced out of `liveChunks`, extracted on the CPU (`chunk-bake-field.ts`: the field
plus a per-vertex albedo bake that mirrors the march's tissue ramp, hash13/noise3/fbm, bone and
organ attribution, torn-end gore) into a static lit mesh (`baked-chunks.ts`, flashlight uniforms
mirrored from the bone instancer's `boneShade`), drawn in the MAIN scene as a real early-Z
occluder. Its `ChunkGpuView` goes back to a ring (cap 12) and is recycled. A baked piece stays
hittable: the pellet loop tests baked pieces (summed radii) BEFORE the floor kill, and a hit
sends the piece back through the live gib path.

## Gates (gate.json, 2026-09-05 17:42)

| gate | result |
|---|---|
| smoke-boot | 0 console errors |
| sever-staging | 2 chunks from 17 shots |
| off-determinism | c76adada == c76adada |
| off-parity-vs-main | seam-off march target identical to main |
| bake-happens | 2 baked, 2 views |
| bake-not-slow | lastBakeMs 5.3 (128 verts, 252 tris) |
| on-differs-from-off | a349a686 != c76adada |
| baked-piece-hittable | piece 1 gibbed via overhead buckshot |
| leak-bounded | views plateau at 12, baked 11–12, totalBakes 10→25 over the soak |

The firefight bench (bake on/off, rooms 3 and 4) was NOT run — the dispatch ran out of time.
The per-frame saving is by construction (a settled chunk is no longer marched or stepped); the
number is still owed.

## Look verdict (owner, 2026-09-05)

"The chunk bake as far as I can tell looks great! Nothing I noticed as off from non baked."
Compared in-game at close range on http://localhost:5410, baked pieces beside marched ones.

## Ships ON

`GAME_CHUNK_BAKE = 1` in `game-main.ts` since the look verdict. Two things changed on landing:

- **One bake per frame.** A bake is ~5 ms of CPU and a double-barrel gib lands several chunks
  that settle within a few frames of each other; unbounded, that stacks into the close-up spike
  this whole plan is about. A settled chunk stays settled, so the rest bake on following frames.
- The gate driver now calls `setChunkBake(false)` after boot, because its off legs assumed
  boot-off.

Seams: `__sdfGame.setChunkBake(on)`, `.chunkBake`, `.chunkStats()` (live/baked/views/totalBakes/
lastBakeMs/lastBakeInfo/pieces/livePieces), `.spawnTestChunk`, `.slugRay`, `.muzzleWorld`.
Drivers: `scripts/sdf-chunk-bake-gate.sh` (WITH_MAIN=1 adds the parity leg),
`scripts/sdf-chunk-bake-look.mjs`.

## The trap that ate the dispatch (hours)

The pellet loop killed a pellet at `p.pos[1] <= 0.02` BEFORE the baked-piece hit test, and a
settled piece rests at exactly that plane, so the crossing segment was never tested. The agent
found the ordering, fixed it, and then its own debug instrumentation re-inserted the floor check
above the test, so the fix vanished while it was measuring. Rule, now pinned by ORDER comments
on both sites: **anything at floor height must be hit-tested before the floor kill.**

## What a corpse needs on top of this

Same recipe, bigger field: the bake is per-piece and one-shot, so a whole-body death state
needs either a chunked bake (several pieces over several frames under the per-frame cap) or an
offline bake budget; the albedo mirror already covers wounds, bones and organs.
