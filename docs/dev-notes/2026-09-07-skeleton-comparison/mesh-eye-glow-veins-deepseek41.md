# Mesh eye glow and socket veins (deepseek41 trial)

Date: 2026-09-08
Base: `273886c0` (predecessor tissue/teeth pass), not `main`.
Branch: `codex/dispatch/2026-09-08-mesh-eye-glow-veins-deepseek41`
Scope: mesh opt-in path only (`?skeleton=mesh`). Procedural tubes, baked volume
and shared defaults are untouched.

## Image-inspection limitation (explicit)

This harness runs the same model as the predecessor and has no image input:
`read_image` returns `model "deepseek-v4.1-flash-expires-on-0910" does not
declare image input`. The owner screenshots were **not** inspected as pixels.
All conclusions below come from the owner's written direction, the predecessor
note, and reading the shader source. Visual acceptance belongs to the
owner/coordinator; no visual-inspection claim is made here.

## Owner direction (this pass)

- Eyes seated in their sockets should glow; red vein-like texture around them.
- Restrained red emissive pupils/iris so the eyes read in darkness, while
  retaining fleshy eyeball volume and wet highlights.
- Irregular branching red vessels across the sclera **and** adjacent socket
  tissue. Markings head/eye-local, confined to the front eye/socket areas, not
  wrapping the whole skull.
- Preserve the patchy organic bone finish, both tooth rows, soldier pose fixes,
  existing eye occlusion and sever/rebuild/disposal.
- No global scene light, no gamma/flashlight change. Eye popping out of scope.

## What the predecessor already had

`mesh-eyes.ts` had a single lit `meshEyeSurface` with a regular
`sin`-based sclera pattern, a dark iris rim and a bright red pupil albedo, all
composed through the shared `BONE_SHADE_WGSL` with `u.look`. There was no
emission term and no vessel field on the socket bone. This pass keeps the
seating (`meshEyePlacements`), the eye material path, geometry and lifecycle
exactly as they were and adds the missing pieces.

## Changes

### `mesh-eyes.ts`

- **`MESH_EYE_VESSEL_WGSL` / `meshEyeVessels`** — irregular branching red
  vessels on the sclera from two ridged noise octaves (`pow(1-|2n-1|,k)`)
  clustered by a low-frequency mask. Front-only and masked off the iris, so the
  markings stay eye-local. Replaces the old regular sine pattern.
- **`MESH_EYE_SURFACE_WGSL` / `meshEyeShading` / `meshEyeVolume`** — fleshy
  rose sclera with a limbal volume falloff (darker around the iris, opening
  toward the equator), branching vessels, deep-red iris and a dark pupil. Still
  returns `vec4(albedo, 0.8)` so the shared compose keeps the wet
  specular/Fresnel highlight on `u.look` (unchanged defaults).
- **`MESH_EYE_EMISSION_WGSL`** — light-independent red glow on the front
  iris/pupil only. Peak pupil emission 0.361 linear (restrained), iris ring
  0.071, tint `(0.95, 0.05, 0.07)`. Zero on the sclera and on the back
  hemisphere.

### `mesh-appearance.ts`

- **`meshSocketVessels` / `MESH_SOCKET_VESSEL_WGSL`** — irregular branching
  vessels in an annulus around each socket (ring units 0.55–1.38 of a 0.30×0.28
  ellipse centred on the seated eye), front-only and head-only. Applied over
  the dark socket recess in `meshBoneSurface`, and given a local wet sheen in
  `meshBoneWet` via `max(gloss, veins*0.45)` so the veins read while the rest of
  the recess stays highlight-free. `meshGlossMask` mirrors the same rule.

### `mesh-renderer.ts`

- Bone include chain gains the socket-vessel function before the surface
  material; eye chain is `hash -> noise -> eye vessels -> eye surface -> eye
  emission`. The eye colour node is
  `vec4(add(boneShade(...).xyz, meshEyeEmission(p)), 1.0)` — the glow is added
  **after** the shared light compose, per eye, and never reaches the bone
  material or the light uniforms. No lighting/gamma/flashlight constant changed.

## Bug found by the real compiler

`patch` is a **reserved keyword in WGSL**. Both new functions initially used
`let patch = ...`; TSL would have accepted the TS source and the failure would
only have surfaced at GPU pipeline build. The real-Dawn compile below caught it
(`'patch' is a reserved keyword`) and the variable was renamed `veinPatch`. This
is exactly the class of error the raw-WGSL probe exists to catch.

## Verification

### Unit (CPU mirrors)

- `npx vitest run mesh-appearance.test.ts mesh-eyes.test.ts` — **25 passed**
  (16 + 9). New coverage: restrained front-only pupil/iris emission (zero on
  sclera and back hemisphere, red-dominant tint), limbal volume monotonicity,
  irregular sclera vessel coverage with real soft edges, vessels off the
  iris/back, socket-vessel annulus confinement (nothing outside the ring, no
  other bone, no back of skull), and the local vein sheen (veins wet, socket
  centre still matte).
- Full spike suite `npx vitest run .../skeleton-spike/` — **89 passed**
  (8 files, including the 79 s volume bake suite), so the preceding tissue/teeth,
  pose, contract, selector and volume behaviour is preserved.

### TypeScript / build

- `npx tsc --noEmit` — clean.
- `npm run build` — passed (exit 0; only the pre-existing >500 kB chunk-size
  warning).

### Real-WGSL compile and numeric probe (no browser)

`/tmp/nodewgpu/compile-eyes.mts` compiles the exact renderer include chains with
a real Dawn WebGPU device in Node and runs the material functions as compute
shaders over synthetic grids:

- **bone chain: 0 errors, 0 warnings** (9153 chars).
- **eye chain: 0 errors, 0 warnings** (4273 chars).
- Eye front sphere (28600 px): pupil emission peak **0.361**, iris ring peak
  **0.071**, sclera emission **0**, glow covers 21 % of the sphere (the
  iris/pupil disc).
- Eye back hemisphere: max emission **0.00e+0**.
- Sclera vessel coverage **10.2 %**, soft-edge share **25.8 %**, full 0.000–0.999
  range — branching filaments, not a stencil.
- Socket front-skull grid: ring max **0.991**, coverage **11.4 %**; outside-ring
  max **0.00e+0**; non-head max **0.00e+0**.

### GPU smoke — NOT run (sandbox)

`lab-servers.sh` on private ports (vite 5406 / CDP 9406) starts vite but Chrome
aborts before the debug port opens:

```
Failed to create socket directory.
Failed to create a ProcessSingleton for your profile directory.
crashpad .../settings.dat: Operation not permitted
```

Chromium's macOS process singleton needs the per-user `DARWIN_USER_TEMP_DIR`
(`/var/folders/...`) outside this session's workspace, and the
`danger-full-access` escalation was rejected ("requires approval, but no
approval channel is available"). So the dim/illuminated GPU capture could **not**
be run. Own ports 5406/9406 were cleaned (verified no listeners); user-owned
preview 5396/5397 were never touched (they were already listening and are left
alone). The TSL material graph is constructed by the renderer unit test but was
**not** GPU-compiled; only the raw WGSL chains were compiled with real Dawn.

## Remaining visual uncertainty

- No image was inspected by this model; acceptance is visual and belongs to the
  owner. In particular the emission strength (0.361 peak) is a judgement call
  and is trivial to dial with the exported `MESH_EYE_GLOW_*` constants.
- Socket veins are albedo + local gloss only, deliberately **not** emissive, so
  the glow cannot become a global light. In darkness only the pupil/iris reads;
  the veins need the flashlight/key light to show. If the owner wants the veins
  to self-illuminate, that is a follow-up with an explicit brightness budget.
- The probe evaluates the material functions on synthetic grids, not the game
  scene, and makes no performance or mesh-vs-volume parity claim.
- Eye popping animation remains out of scope.

## Commit / handoff (sandbox caveat)

Changes are limited to the five mesh files plus this note; nothing outside the
mesh opt-in path changed. No merge/push performed.

The linked worktree's index and object store live under
`/Users/donny/Projects/blud/.git/worktrees/...`, outside this session's
workspace, so plain `git add`/`git commit` fails with
`Unable to create .../index.lock: Operation not permitted`; the
`danger-full-access` escalation was unavailable ("no approval channel"). The
branch ref in the primary repo was therefore **not** moved by this session.

The same change set is committed in a `/tmp` object store that uses the primary
repo's objects as an alternate, so it is a real commit with the correct parent:

- Commit: this note's commit on
  `codex/dispatch/2026-09-08-mesh-eye-glow-veins-deepseek41`; the SHA is
  printed by `git bundle list-heads /tmp/ds41-mesh-eye.bundle` (a note cannot
  contain its own final SHA without changing it).
- Parent: `273886c0ed74d77bfc56021b053bed6a830854ed`
- Branch: `codex/dispatch/2026-09-08-mesh-eye-glow-veins-deepseek41`
- Bundle: `/tmp/ds41-mesh-eye.bundle` (verified; requires the parent, which the
  primary repo has). `git bundle list-heads` prints the commit SHA.
- Patch fallback: `/tmp/ds41-mesh-eye.patch` (format-patch, reverse-apply check
  passed against the worktree) and `/tmp/ds41-mesh-eye-diff.patch` (plain diff).

Coordinator can land it with either:

```
git fetch /tmp/ds41-mesh-eye.bundle \
  'refs/heads/codex/dispatch/2026-09-08-mesh-eye-glow-veins-deepseek41:codex/dispatch/2026-09-08-mesh-eye-glow-veins-deepseek41'
# or
git apply --check /tmp/ds41-mesh-eye-diff.patch && git apply /tmp/ds41-mesh-eye-diff.patch
```

User-owned preview ports 5396/5397 were not touched; own ports 5406/9406 were
cleaned (no listeners remain).

## Coordinator browser review

Actual Chrome game pipeline initially failed with duplicate boneHash/boneNoise declarations. The eye chain created fresh TSL nodes while the shared shade chain already included those functions. Reusing the same hash/noise node objects fixes pipeline generation. Focused eye/appearance tests25/25 and TypeScript pass after the fix. Browser capture `/tmp/ds41-glow-fixed/mesh-r1-torso-wound.png` renders successfully; shader/runtime errors gone. Driver still exits nonzero for known frozen-frame drift, not a pipeline error. First material pass accepted by owner; combined eye preview on5408 awaits owner visual acceptance.
