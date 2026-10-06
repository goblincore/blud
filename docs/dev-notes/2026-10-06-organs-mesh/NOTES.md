# Organs as mesh — notes

Branch `claude/organs-mesh` (worktree `.claude/worktrees/organs-mesh`, off main `c9a6c3d5`).
Spec: `docs/superpowers/specs/2026-10-06-organs-mesh-design.md`. Plan: `docs/superpowers/plans/2026-10-06-organs-mesh.md`.

## What changed

| Piece | File | What |
| --- | --- | --- |
| Pack | `src/lab/sdf-zombie/pack.ts` | `PackOpts.packOrgans` (default true, byte-identical). Off with `packBones` off: `boneCount` 0. |
| Contract | `webgpu/skeleton-spike/contract.ts` | `opts.organs` adds sources of `kind: 'organ'`, keyed `organ:axial:<head>-<tail>`, on the axial frame `applyRig` already poses each organ by. The zombie has two: the gut coil on the pelvis frame (7 prims) and one loop on the spine frame. |
| Reach | `webgpu/skeleton-spike/organ-reach.ts` | Pure: an organ segment is drawn only when one of its owner's wound exposure spheres overlaps its posed bound sphere. |
| Material | `webgpu/skeleton-spike/mesh-organ.ts` | `meshOrganSurface` / `meshOrganWet` WGSL and `ORGAN_LOOKS` (`match`, `veined`, `bloody`). |
| Renderer | `webgpu/skeleton-spike/mesh-renderer.ts`, `mesh.ts` | Organ sources draw in their own instanced batches on a third material; extraction at 5 mm (`ORGAN_MESH_CELL`). |
| Game | `webgpu/game-main.ts`, `game-render-leaves.ts`, `zombie-gpu.ts`, `skeleton-spike/selector.ts` | `?organs=sdf`, `view.setPackOrgans`, per-actor reach spheres, the organ tint copied from a body view each frame. |
| Seams | `webgpu/game-seams-skeleton.ts` | `setOrgans(mode)`, `organs()`, `organSegments(id)`, `setOrganLook(look)`, `meshSkeletonShow({ organs })`. |

No march WGSL changed. `organ.wgsl.ts` and `applyBones` still serve `?skeleton=procedural`, deferred rendering, chunks and `?organs=sdf`.

## Facts found on the way

- **Only the zombie authors organs** (8 prims). `body.ts` `ZOMBIE` (the old hand-built def many tests use) has none; a test that needs organs must build `characters/zombie.blob`.
- **Organs were already rigid.** `bindRig` gives every torso inside-flesh prim an axial `BoneFrame`, organs included. The `'organs'` boneSegment tag is the pack's cull group only.
- **Three torso chops do not show an organ.** The axe gate's cost scene (H, R, L at the torso centre) opens the chest: what shows is the sternum mesh. The gut sits 25 cm lower. The 869,688 inside-flesh evaluations a frame that scene paid were for organs nothing in the frame could see.
- **The player's feet are held on the floor** (`stepPlayer`), so a belly wound is seen from 0.6 m above. The gate and the look sheets view it level by setting the pose under the render lock (a step is then a pure re-render).
- **A debug-mode read leaves its picture in the frame** for a few steps (the first run's chop screenshots were black bodies under a red hatch). The gate takes its screenshots before its counter reads.
- **A frozen boot's first pack predates `setPackBones(false)`** (true on main too): `counts2.x` reads 72 on a mesh-skeleton zombie until its next upload. An unwounded body never folds the rows, so it costs nothing; `setPackOrgans` re-packs at once, which is why the default page reads 0 from boot.
- **`setFlashlight(true)` does nothing while the light clock is frozen** (the level ramps with light time). The gate thaws the clock until the torch is up.

## Matching the SDF organ

Measured on the gate's belly crater (zombie 13, one slug, the player's eye 0.7 m away), mean colour of the organ's own
pixels (sRGB 0..1). SDF organ pixels: a screenshot at `organAmp` 1 against 0. Mesh organ pixels: shown against hidden.

| | torch on | torch off |
| --- | --- | --- |
| SDF organ | 0.734, 0.351, 0.302 | 0.388, 0.106, 0.070 |
| mesh, plain `organColor` on `boneShade` (first try) | 0.716, 0.443, 0.382 | 0.600, 0.332, 0.249 |
| mesh, `match` as committed | 0.661, 0.312, 0.264 | 0.397, 0.097, 0.047 |

The first try was right in red under the torch and wrong everywhere else, for three reasons, each now a term of the
organ shader (`mesh-organ.ts`):

1. **The march reddens an organ pixel.** Its wound overlays (gore, the wet film) run on organ pixels too. In linear
   light the SDF organ is the mesh organ times about (1, 0.59, 0.59): `ORGAN_WASH`, weighted by `cfg.w`.
2. **The march shades an organ inside its crater.** With the torch off the SDF organ is 0.38 of the mesh organ in red
   and 0.08 in green: the room's lights reach it shadowed and already red. `occ.rgb` multiplies every light but the
   beam. The beam's share of the light on a point comes from `bodyLights`' own `lumBeam / lumAll`.
3. **The march lights flesh with its own per-pixel torch** on top of the list's beam slot, which is all a bone mesh
   gets. `occ.w` is the beam's gain, and `gloss.w` a tight highlight where the surface faces the eye (the torch is at
   the eye, so its half vector is the view vector): the hot white glint that makes the march's organ read as wet.

What no candidate reproduces: the march's own shadows. In the gutted scene (`look/02`) the SDF coil has a black side
where the crater wall shades it from the torch. The mesh organ is lit evenly. Same limitation as the mesh skeleton
(wrap-up 2026-09-08).

## The look sheets (the owner picks)

`look/` — columns: SDF organs (today) | `match` | `wet` | `veined` | `pale`. Rows: torch off, torch on. Every tile is
the same frame; the mode and the look are flipped in page. Written by `ONLY=L OUT=docs/dev-notes/2026-10-06-organs-mesh/look
node scripts/organs-mesh-gate.mjs`.

- `01-belly-slug-0.7m.png` — one slug in the belly.
- `02-gutted-two-slugs-0.6m.png` — two slugs: the gut coil and the loop above it.
- `03-three-chops-0.9m.png` — the cut-cost scene. No organ in any column: the chops open the chest.

`ORGAN_LOOK_DEFAULT` is `match` until the pick. `__sdfGame.setOrganLook('wet')` (or numbers) tries one live.

## The gate: `scripts/organs-mesh-gate.mjs`

32 checks, 0 failed (2026-10-06, Chrome 154, ports 5251 / 9251). Three boots; boot M flips the mode in page, so both
modes are measured on the same frame.

| Check | Result |
| --- | --- |
| B: default mode, packed rows | `mesh`; every zombie packs 0 inside-flesh rows |
| U: unwounded | no organ instance; the float march target is bit-identical in both modes (`00a29832`) |
| S: belly crater, inside-flesh evaluations a frame (debug mode 5) | mesh 0; sdf 1,068,632 over 27,990 texels |
| S: organ pixels on screen | mesh 7,546 px; sdf 8,439 px (ratio 0.89); mean colours 0.091 apart |
| C: three torso chops, inside-flesh evaluations | mesh 0; sdf 869,688 over 19,878 texels |
| H: head-only wound | no organ instance for that zombie |
| T: belly crater, torch off | mean colours 0.027 apart; both organs darker than under the torch |
| Q: `?organs=sdf` | mode `sdf`, 8 organ rows, no organ mesh, 1,068,632 evaluations |
| P: `?skeleton=procedural` | mode `sdf` whatever `?organs` says; 72 rows; `setOrgans('mesh')` refused |

The colour tolerance (0.15) is loose on purpose: the look is the owner's pick, and the check only has to catch an
organ that is the wrong material (unlit, unoccluded, untinted).

## Frame cost

All on the ring page, frozen, 1280x800, 400x300 march target, t16 upscaler.

**In page, load-cancelling** (`COST=1` on the gate: 8 rounds of 24 fenced frames, mesh and sdf alternating, each sdf
block against the mesh blocks either side):

| Scene | mesh baseline | SDF organs cost |
| --- | --- | --- |
| belly crater at 0.7 m | 22.40 ms wall, march 14.57 ms GPU | +0.60 ms wall (IQR 0.3 to 1.1), +1.07 ms march GPU (IQR 0.83 to 2.11) |
| three torso chops at 0.9 m | 25.00 ms wall, march 17.44 ms GPU | +0.90 ms wall (IQR 0.6 to 1.25), +1.07 ms march GPU (IQR 0.59 to 2.87) |

**Separate boots** (`scripts/cut-cost.mjs`, `VARIANTS=';organs=sdf' ROUNDS=2`, three chops; median of 3 x 120 frames a boot):

| Variant | before | after 3 chops | the chops cost | inside-flesh evals |
| --- | --- | --- | --- | --- |
| default (mesh organs) | 19.4 ms | 22.2 ms | 2.8 ms | 0 |
| `organs=sdf` | 19.5 ms | 23.8 ms | 4.3 ms | 869,704 over 19,878 texels |

So mesh organs take about 1 to 1.5 ms off a wounded torso at 0.9 m: less than the 2.0 ms the `applyBones`-off ablation
measured (IQR 1.35 to 2.4), inside its spread. The march target is bit-identical between the two on the chop scene
(`31f830b2`): the organs it paid for were never in the frame. The mesh draw's own cost is inside the wall numbers.

**The first wound** (a fresh boot, the first belly slug; sim step, then fenced draws, ms): mesh 75.8, 61.8, 21.6;
sdf 73.1, 4.8, 99.9. The organ pipeline adds no measurable hitch on top of what the first wound already costs (the
bone mesh pipeline is not pre-warmed either; that predates this branch).

## Parity

- `npx vitest run march-golden`: passes without `-u` (no march WGSL changed).
- `march-hash`, six pins, none moved: default `d7392d52…` / wounded `76bd51aa…`; crowd quad `0c71e712…` / `bf6836cd…`;
  per-body `470ff0b3…` / `f618070e…`. With `MARCH_HASH_QUERY=organs=sdf` the default pair is the same pair: its wounded
  scene shows no organ either.
- The three capture gates with `OUT` set: `head-split-gate` 80 checks, `axe-gate` 27, `cut-wound-gate` 30; 0 failed.
- `node scripts/compile-census.mjs 1`: phase `ready`, `uncapturedCount` 0, no device loss, 262 pipeline entries,
  cold `drawOnce` 1731 ms.
- The vitest tree (`npx vitest run src/lab/sdf-zombie scripts/lib`): 528 files, 7649 tests. The first run failed one,
  `game-state-render.test.ts` (it pins the render slice's binding count: 35, now 37 with `organMode` and
  `organReach`); pin updated, that file and `game-context-coverage` pass. `tsc --noEmit` is clean but for
  `pack-golden.test.ts`'s `node:crypto` import, which main has too.

## Boot

`node scripts/boot-time.mjs` (fresh Chrome profile each run), main (`c9a6c3d5`, a `git archive` snapshot) against this
branch, interleaved, three pairs:

| | `drawOnce` ms | `warmMs` |
| --- | --- | --- |
| main | 1839, 1957, 1960 | 2689, 3228, 3377 |
| branch | 2097, 1948, 2002 | 3412, 3267, 3324 |

Medians: `drawOnce` 1957 against 2002, `warmMs` 3228 against 3324. Inside the run-to-run spread (the first pair is the
outlier on both sides). These boots share the OS shader cache, so they are not first-ever-cold; the march shader is
byte-identical on both sides, so that cache is equally warm for each. The organ material is built at the first wound
that exposes an organ, not at boot. The two organ meshes are extracted at boot with the bones (the cache extracts
every source on the first mesh update): 87 entries, 893 ms in all on the ring page, of which the largest single one is
the zombie's rib cage at 494 ms; the organ pair measured 176 ms in node (vitest) at the 5 mm cell.

## Each check was shown to fail

One breaking change at a time, `ONLY=M`, then the file restored:

| Breaking change | Checks that failed |
| --- | --- |
| the view packs organ rows whatever `setPackOrgans` says (`zombie-gpu.ts`) | B2, U4, S2, S5, S7, S8, S9, C2, T1, T2, T3 |
| the reach callback answers null for every owner (`game-main.ts`) | S1, S7, S8, S9, T1, T2, T3 |
| organ instances drawn for every owner, with no exposure or reach test (`mesh-renderer.ts`) | U1, S1, S3, H1 |
| `match` with no cavity occlusion, `occ` = (1, 1, 1) (`mesh-organ.ts`) | T2 |

Not mutated: U2, U3 (identities of the flip itself), S4, S6, C1, C3 (positive controls), Q and P (the selector boots;
Q2 failed for real on its first run, see "A frozen boot's first pack" above). S7 to S9 and T2 also failed for real
while the scene and the look were being built.

## Left open

- **The owner's pick** of the look, then `ORGAN_LOOK_DEFAULT`.
- **No self-shadowing on the mesh organ** (above). A cheap fake would be a directional occlusion from the crater's axis.
- **The bone and organ mesh pipelines are built at the first wound** (about 60 to 100 ms once a session, before and
  after this branch). Warming them at boot is its own task.
- **`applyBones` and `organ.wgsl.ts` are still compiled into the march** for procedural, deferred, chunks and
  `?organs=sdf`. If chunks ever get mesh organs too, the organ branch can leave the shader.
- **New organ shapes** (a liver, a heart, longer loops) are cheap now: author prims with `organ` in the .blob and they
  come out as mesh.
- `scripts/cut-cost.mjs` is not on this branch (it belongs to `claude/cut-cost`, uncommitted there); the numbers above
  came from a local copy with one more seam (`organsSdf`).
