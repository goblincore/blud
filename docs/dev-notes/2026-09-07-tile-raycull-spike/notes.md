# Per-ray tile sphere compaction spike (2026-09-07)

Prompted by "would three-mesh-bvh help the SDF raymarch?" — it would not
(triangle BVH, GLSL/WebGL; the field is analytic smin prims in WGSL and the
cluster -> group spheres + tile bins already act as a two-level BVH). The one
BVH-shaped idea worth a test: at the tile-list preload in march.wgsl.ts
(tileCfg.x == 2), drop entries whose sphere, inflated by counts.w*4*distort +
0.07 m probe slack, the pixel's ray never enters. Once per pixel, never per step.

Lever: `__sdfGame.setTileRayCull(true)` (needs `?tiles-playtest`).
Bench: `BENCH_QUERY=tiles-playtest BENCH_LEGS=baseline,tiles-on,tiles-raycull BENCH_ROOMS=2,4 scripts/sdf-game-bench.sh`.

Parity: room 3 screenshot, tiles-on vs tiles-raycull differs in 194 px; two
consecutive tiles-on frames differ in 150 px. No silhouette edges in the mask.

Result (bench.md): UNRESOLVED / slightly negative. Machine was NOT quiet
(user's Chrome ~100% CPU); baseline spread 123%, tiles-on 63%.
room2 tiles-on 10.67 vs raycull 10.55 (inside spread); room4 20.03 vs 21.50,
raycull the one quiet leg (8% spread). Per-ray test cost ~= the fold work it
removes at 2-4 bodies: the tile list is already short enough that the
per-step group-sphere cull handles the rest. Not worth shipping at this
body count; revisit only for crowd scenes or if TILE_MAX_ENTRIES lists get long.
