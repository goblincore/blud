# Anatomical skull — 2026-10-06

**Opt-in since 2026-10-07.** The owner playtested this skull against the sculpted one and chose the sculpted skull
as the game's default: it fills the head and reads better at the game's resolution, where this one is small in the
zombie's head (56% of the sculpted skull's box volume) and harder to read. This skull is drawn with
`?skull=anatomical`, and everything below still describes it; where the text says "by default" read "with
`?skull=anatomical`", and `?skull=sculpt` no longer means the earlier skull (that is `?sculpt=classic`). The decision,
the defaults and what each character draws now:
[`../2026-10-07-sculpt-skull-2/NOTES.md`](../2026-10-07-sculpt-skull-2/NOTES.md).

Implemented in `/Users/donny/.codex/worktrees/anatomical-skull/blud`. The primary checkout is unchanged. The user confirmed separate permission for the supplied source after its embedded WitmerLab / CC BY-NC-ND metadata was identified. Attribution is retained in the manifest and GLB extras.

## Asset

`public/assets/lab/anatomical-skull.glb` is approximately 1.3 MB: 9,947 triangles from 1,126,157 imported source triangles (99.12% fewer), fourteen named pieces and one embedded 1024 × 1024 normal atlas. Blender preserves the assembled frame-1 transforms and simplifies each group independently. Open cavities, teeth silhouette and bone thickness remain geometry; small surface features use the bake. The nasal core is deliberately more simplified than the exterior plates. No SPOM pass was added.

Editable scene, hidden high reference, bake and studio previews are in ignored `.scratch/anatomical-skull/`. They are not public build assets. `skull.blend` opens assembled with the high source hidden. Previews: `three-quarter.png`, `exploded.png`, `wireframe.png`. Copies for PR review are `blender-three-quarter.png`, `blender-exploded.png` and `blender-wireframe.png` in this directory.

Regenerate with Blender 5.2.0 LTS:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/simplify_anatomical_skull.py -- --source /Users/donny/Downloads/detailed_exploding_skull.glb --publish
```

The low mesh remains within 1.29 mm at the 95th percentile of sampled source-to-low distances for all thirteen exterior/base groups. Nasal-core p95 is 3.94 mm, max 14.59 mm. These are nearest-surface distances, not a Hausdorff bound. See `surface-error.json`; the Blender wireframe and exploded previews were also inspected.

## Runtime

Forward mesh mode loads this skull by default. `?skull=sculpt` compares the earlier skull; asset failure falls back to it. Thirteen humanoids are supported, with source-revision geometry caching and flesh-clearance tests. Intact heads share one geometry/draw; damaged heads draw surviving plates individually. Skull normals and surface shading use hand-written WGSL with derivative tangent frames.

`skull-fracture.ts` holds renderer-free triangle selection, damage masks and deterministic launch data. A slug removes the struck plate; three pellets accumulate enough damage to remove it. Head pops release remaining plates once. The melee brain stage calls the same seam, retaining old chips if no plate is released. Fragments ride existing mesh-gib physics, preserve head deformation and use extremal-vertex collision supports. Up to 32 skull fragments remain live in a separate pool from the eight existing mesh gibs; owned fragment geometry is freed on eviction/reset.

Deferred/procedural skeletons, nonhumanoids and bones embedded in detached flesh chunks retain their earlier path. This change does not replace every procedural skull in every rendering mode.

## Verification

Raw test/typecheck output is retained in `final-regression.txt`, `gib-regression.txt`, `tsc-last.txt` and `base-tsc.txt`.

- 100 focused tests passed across fracture, actual asset containment, per-actor draw/damage isolation, existing renderer/eye/skull logic, head damage/crown/pop and game context coverage.
- Two additional passing mesh-gib ownership tests cover complete explosions, pool eviction, reset and geometry/material lifetime.
- Vite build passed. Full typecheck still reports the existing `pack-golden.test.ts:11` missing `node:crypto` types, reproduced on the base checkout. No additional type errors.
- Headless WebGPU capture waited for the warm gate, rendered both skull modes, hit the actual skull seam, removed the frontal plate, then released thirteen remaining plates. No console or renderer pipeline errors. `game-validation.json` and screenshots contain evidence. A separate crowd-on smoke run also passed (`crowd-on-smoke.txt`).
- Capture deliberately hides flesh for the isolated bone pictures. It is a render/fracture smoke test, not a full combat or melee playthrough. The final melee hook is covered by typechecking and existing head-damage tests; it was not exercised in a separate GPU playthrough.

Cold boots used fresh Chrome profiles, identical seed/frozen query, and the same Node 25 executable on both checkouts. Base `drawOnce`: 2512.2 / 5645.9 ms; anatomical default: 4530.8 / 3990.6 ms. Means: 4079.1 / 4260.7 ms (+4.45%). Warm-total means: 6326 / 6420 ms (+1.49%). Two samples with overlapping ranges do not establish a reliable performance change. Review-capture boot values are not comparable cold-boot measurements. No steady-state GPU frame-time claim is made. Raw controlled runs are in `boot-comparison.json`.

Capture driver: `scripts/anatomical-skull-capture.mjs`, with caller-owned Vite/Chrome sessions via `scripts/lab-servers.sh`. The capture closes its own CDP tab; the session wrapper stops its own servers. All sessions started for this task were cleaned up.
