# First debris chunk froze the game on a cold shader cache (2026-11-02)

**Owner of the shader.** Pipeline `MeshBasicNodeMaterial_247`, 364 KB of fragment WGSL, 6,667 lines, rgba32float: the
shared chunk material (`ctx.bake.material`). Every marched piece uses it: `spawnChunkPiece` from severs, gore bits, head
pops, the test hook, and blast pieces whose offline mesh is missing. Blast pieces with a mesh do not touch it.

**Why the warm missed it.** The background warm borrowed the first actor's prims and uniforms. `?level=fixtures/sectors`
boots with no actors, so it returned false and the gib job settled `failed`. Levels that boot with an actor were not
affected: the ring testbed compiles the program async and its first chunk creates nothing.

**Why the degrade did not save it.** `gibDraw() === 'skip'` only emptied the list passed to `setBodies`. The pieces stay
in the scene on `SDF_LAYER`, so the merged march drew them anyway, and three built the pipeline nobody had queued
synchronously. three's not-ready skip covers only a queued pipeline.

**The fix.** The warm view needs no actor, and the pieces are hidden from `sdfLayer.render` until the job is ready.
No look-alike problem: the async compile and the live draw share one pipeline (same fragment hash, no creation at the
first draw).

## Measured

`scripts/first-chunk-stall-probe.sh`, one run per row, cold by a fresh value of `hash13`'s `0.1031`. The gap is the
longest rAF gap from the spawn until 16 s later.

| Run | Longest rAF gap | Chunk program |
| --- | --- | --- |
| Before, test chunks | 26,702 ms | SYNC at first draw |
| After, spawned once the job is ready | 55 ms | async, 67 s |
| After, spawned while compiling (`--no-wait`) | 43 ms | async, 36 s |
| After, real gore route (`PROBE_SPAWN=headpop`) | 18 ms | async, 37 s |

While the job compiles (about 30-70 s cold) the pieces simulate but do not draw, then appear (screenshots confirmed).
The compile timeout is 180 s; past it the job is `failed` and marched pieces stay hidden for that session.

## Shader size

Not cheap to reduce. Only 2 of 88 functions are unreachable (3.5 KB). `marchBody` alone is 187 KB and `mapBody` 25 KB,
so real savings mean restructuring the march. Left alone.

## Still open

On a boot with no actors the first BODY in view has the same problem: its 367 KB march builds synchronously, a 34.4 s
rAF gap, measured cold. The probe reports it separately as `rafGapLook` (use `LOOK_MS=60000`; the default 6 s window
ends inside the stall, visible as a large `sinceLastFrameMs`).

Not measured on three r187: this ran on r186 (main at 54444a37).
