# Mesh tissue, teeth and cavity pass (deepseek41 trial)

Date: 2026-09-08
Base: `e447ea21` (latest mesh follow-ups), not `main`.
Branch: `codex/dispatch/2026-09-08-mesh-tissue-teeth-deepseek41`

## Image-inspection limitation (explicit)

This harness runs a model without image input. `read_image` returned
`model "deepseek-v4.1-flash-expires-on-0910" does not declare image input`, so
the three owner screenshots were **not** inspected as pixel data:

- `/Users/donny/Desktop/Screenshot 2026-09-08 at 8.54.54 AM.png` (mesh)
- `/Users/donny/Desktop/Screenshot 2026-09-08 at 8.56.34 AM.png` (SDF volume)
- `/Users/donny/Desktop/Screenshot 2026-09-08 at 8.27.19 AM.png` (earlier desired style)

All appearance conclusions below come from the owner's written description and
from reading the shader source, not from viewing the images. No claim of visual
inspection is made anywhere in this note. Visual acceptance is left to the
owner/coordinator.

## Owner playtest (verbatim direction, condensed)

- Bones now look like uniformly pink/rose-tinted **metal**.
- Want discontinuous, painted-looking **organic tissue patches** with **varying
  gloss**; wetness in patches, not polished metallic shine everywhere.
- Mix dark burgundy blood/attachment patches, pink connective tissue and
  limited exposed ivory. Skull needs the same treatment. Eyes are acceptable;
  preserve them.
- Teeth too straight/symmetric, only the upper row visible. Rework the
  mouth/teeth region so **both** upper and lower rows read in the exposed skull;
  vary widths/heights/gaps/alignment subtly, keep recognizable human dentition.
- No eye-popping animation in this task.
- Mesh wound cavity appears lighter than the SDF/volume reference. Investigate
  why with matched pose/light/wound where possible; darken the relevant cavity
  response **locally** if justified. Do not globally darken scene, flashlight,
  gamma or flesh.

## Diagnosis from source (before change)

Three independent causes produced the "rose metal" read. All three are
mesh-path-only; the procedural tubes, baked volume and shared defaults were not
touched.

1. **One continuous albedo gradient.** `MESH_BONE_SURFACE_WGSL` mixes a single
   burgundy→pink ramp through `tissue = smoothstep(0.28, 0.75, broad*0.72 +
   fibers*0.28)` and then a low-contrast ivory term. Every pixel is a blend of
   the same two colours, so the surface reads as one tinted material instead of
   separate tissue zones.
2. **Gloss is spatially constant.** `mesh-renderer.ts` built
   `wetLook = vec4(look.x, look.y, max(look.z, 0.85), max(look.w, 0.12))` and
   fed that to every fragment. `BONE_SHADE_WGSL`'s specular
   (`shine*pow(dot(n,H),48)*look.z*keyI`) and Fresnel (`look.w`) therefore had
   the same strength on dry bone and wet tissue. With default `look = (0.65,
   0.5, 1.2, 0.6)` the highlight plus a full-strength grazing Fresnel rim is
   what reads as polished metal. The `max(..., 0.85)` floor is the "prior
   global gloss floor" the brief says not to reuse.
3. **Exposure brightens the wound.** The mesh surface did
   `albedo = mix(albedo, pink, expo*0.18)`, i.e. the crater's exposed bone was
   pushed *toward bright pink* as `expo` rose. The shared light compose also
   raises `ao = mix(0.45, 1.0, expo)` to 1.0 under a crater. So the mesh wound
   cavity is brightened twice, locally, by mesh-specific albedo plus the shared
   AO term. That is the strongest candidate for "mesh wound cavity lighter than
   SDF/volume".

Skull cavities are material cues on a smooth convex surface (documented in
`mesh-appearance.md`): there is no geometric recess, so there is no self
occlusion and the socket normal still catches the key light and the specular
highlight. The volume/SDF reference has a real concavity with inward normals
and depth occlusion. **Caveat: the mesh and volume screenshots were taken in
different rooms/distances, so they do not prove a numeric lighting regression.**
The correction below is localized to the mesh material and is justified by the
source asymmetry, not by a pixel comparison.

Teeth: the old mask was one band, `toothBand = smoothstep(-0.67,-0.58,y) *
(1-smoothstep(-0.45,-0.37,y))`, cut by `abs(cos(x*28))` separators. A single
symmetric band with uniform pitch is exactly the "regular fence" the owner saw,
and it cannot read as two rows.

## Intended changes (mesh mode only)

### mesh-appearance.ts

- **Discontinuous tissue zones.** Threshold three independent local-space noise
  fields (large blotches + an organic warp + a mid-frequency weave + fine
  grain) into separate `blood` (dark burgundy attachment), `connect` (pink
  connective tissue), and rare `ivory` classes. Layer them in that order so
  edges are hard enough to read as painted patches at gameplay distance but
  still warped/organic. Ivory stays rare and is further suppressed on the skull.
- **Exposure stains instead of brightening.** Replace the `pink` brighten with
  a dark, mottled blood stain so a fresh crater reads as dark red attachment.
- **Two tooth rows.** Add `meshToothRow(q, upper)`: seven teeth per side on a
  widening human arc (narrow incisors → wider molars), each with a per-tooth
  hash for width, crown height, centre offset and incisal-edge alignment, and
  real gaps. Upper crowns hang below the bite line, lower crowns rise above it,
  with a dark mouth-cavity gap between. Gate by the front-only mouth mask.
- **Localized cavity darkening.** `meshSkullCavity` keeps sockets/nose/mouth
  front-only; cavity albedo drops to a very dark blood tone and the wet/gloss
  mask is forced to ~0 inside it, so no socket or wound recess catches a
  highlight.
- **Spatial gloss mask.** Add `meshBoneWet(pLocal, feature, expo)` returning a
  gloss multiplier in `[~0.05, 1]` from a noise field *independent* of the
  colour fields, biased up by wound exposure and forced to ~0 in cavities. A TS
  mirror (`meshGlossMask`) is exported so the mapping is unit-tested.
- Keep `meshAppearanceCoord` and the head-local normalized frame unchanged.

### mesh-renderer.ts

- Delete the blanket `wetLook` gloss floor.
- Build a per-fragment `meshLook = vec4(stain, wetTint, look.z*gloss*SPEC_SCALE,
  look.w*gloss*FRES_SCALE)` from the wet mask and pass it to the unchanged
  shared `BONE_SHADE_WGSL`.
- Eyes keep the previous uniform look path (`u.look`), which is identical to the
  old `wetLook` under defaults, so eye placement/appearance is preserved and
  the eye material never references the bone `meshFeature` attribute.
- `BONE_SHADE_WGSL`, procedural tubes, volume path, defaults, flashlight,
  soldier pose contract and sever/eye lifecycle are untouched.

## Validation plan

1. Focused unit tests for the CPU mirrors (mapping, front-face occlusion, two
   distinct tooth rows with irregular widths/gaps, gloss dry-vs-wet-vs-cavity,
   `meshAppearanceCoord` unchanged) plus the existing spike tests
   (`mesh`, `mesh-eyes`, `contract`, `selector`, `segment-diagnostics`,
   `volume`). `volume-gpu.test.ts` needs a browser and was not run.
2. `npx tsc --noEmit` and `npm run build` for the cross-cutting renderer edit.
3. A short **serial** WebGPU smoke on private ports (vite 5406 / CDP 9406);
   preview 5396/5397 are user-owned and are not touched. Boot
   `/sdf-game.html?skeleton=mesh`, confirm `__sdfGame.skeletonMesh()` segments
   and zero page errors, then capture skull/ribs/wound frames. Repeated-frame
   drift in `skeleton-compare.mjs` is a known harness limitation and is not
   being fixed here; render/compile errors are recorded separately from drift.
4. Honest handoff: list actual changes, tests run, and the remaining visual
   uncertainty (no image inspection by this harness; cavity parity across
   different rooms is unproven).

## Verification results

### Unit tests (CPU mirrors)

- `npx vitest run mesh-appearance.test.ts` — 13 passed. Covers: discontinuous
  patch coverage and blood/connective disjointness, skull ivory suppression,
  sharp patch edges over 5 mm, both tooth rows with a dark bite-line gap,
  front-face occlusion of cavities/teeth, irregular run widths, and gloss
  variation (dry/matte, wet, cavity-killed, exposure-raised).
- `npx vitest run mesh-appearance mesh mesh-eyes contract selector
  segment-diagnostics` — 56 passed.
- `npx vitest run volume.test.ts` — 12 passed (56 s, CPU bake; slow but green).

### TypeScript / build

- `npx tsc --noEmit` — clean.
- `npm run build` — passed (exit 0, only the pre-existing >500 kB chunk-size
  warning).

### Real-WGSL compile and numeric probe (no browser)

The sandbox cannot start Chrome: Chromium's process singleton needs
`base::GetTempDir()`, which on macOS is the per-user `DARWIN_USER_TEMP_DIR`
(`/var/folders/.../T/`) and is **not writable** under this session's
workspace-write policy (Chromium explicitly reverted `$TMPDIR` support for
macOS, so `TMPDIR` cannot redirect it). `lab-servers.sh` therefore aborts with
"chrome (debug port) never came up"; no approval channel is available to widen
the sandbox. **The game boot / visual GPU smoke was NOT run.** Own ports
5406/9406 were cleaned; user-owned 5396/5397 were never touched.

To keep the shader honest anyway, the exact renderer include chain
(`boneHash → boneNoise → meshToothRow → meshSkullCavity → meshBoneSurface →
meshBoneWet → boneShade`) was compiled with a real Dawn WebGPU device in Node
(`webgpu@0.6.0`, `/tmp/nodewgpu`), and the material functions were then run as
a compute shader over synthetic grids. Results (real WGSL, not the TS mirror):

- **Compile: 0 errors, 0 warnings.**
- Head grid (front skull, 256×200): `toothUp` 2135 px vs `toothDn` 2179 px —
  both rows read with equal coverage; 15624 px of dark bite-line gap between
  them; 13 irregular upper-row runs with widths 0.049–0.131 normalized
  (incisor→molar arc, one molar pair touching).
- Cavity gloss: mean **0.022** inside sockets/nose/mouth vs **0.587** on the
  open surface — the recess correction is local, not a global darkening.
- Rib grid (256×200, 0.16 m × 0.05 m): albedo luminance spans 0.047–0.610;
  sharp spatial jumps (>0.15 L1 between neighbours) in **3.0 %** of pairs vs
  **0.0 %** for the old continuous burgundy→pink ramp — the finish is
  measurably discontinuous, not a smooth gradient.
- Gloss spans 0.050–1.000 (dry→wet). Gloss/albedo-luminance correlation over a
  single rib is 0.26 (was 0.58 with the first wetness scale); over a
  multi-rib domain it is ~0.0. The wetness field is an independent noise
  field; the residual per-rib correlation is a small-domain low-frequency
  artifact, not shared colour math.

### Remaining visual uncertainty

- No image was inspected by this model; the three owner screenshots were not
  read. Acceptance is visual and belongs to the owner/coordinator.
- The mesh-vs-volume cavity comparison used different rooms/distances in the
  owner screenshots, so no numeric lighting regression is proven either way.
  The correction here is justified by the source asymmetry (mesh crater was
  brightened by `mix(albedo, pink, expo*0.18)` plus a convex surface catching
  the key highlight; the volume has a real recess), and is deliberately local.
- The compute probe renders material functions on synthetic grids, not the game
  scene; it proves the mapping, not the in-game look.

## Commit / handoff (sandbox caveat)

The session sandbox is workspace-write and the linked worktree's index and
object store live under `/Users/donny/Projects/blud/.git/worktrees/...`, which
is outside the workspace. Plain `git add`/`git commit` fails with
`Unable to create .../index.lock: Operation not permitted`, and the
danger-full-access escalation is unavailable ("no approval channel"). The branch
in the primary repo was therefore **not** moved by this session.

The same change set was committed in a workspace/tmp-local object store that
uses the primary repo's objects as an alternate, so it is a real commit with the
correct parent:

- Parent: `e447ea21a3ff1c7bbe68749f8ca46c241e67e4eb`
- Branch: `codex/dispatch/2026-09-08-mesh-tissue-teeth-deepseek41`
- Bundle: `/tmp/ds41-mesh-tissue.bundle` (verified; requires the parent, which
  the primary repo has). `git bundle list-heads` prints the commit SHA.
- Patch fallback: `/tmp/ds41-mesh-tissue.patch`

Coordinator can land it with either:

```
git fetch /tmp/ds41-mesh-tissue.bundle \
  'refs/heads/codex/dispatch/2026-09-08-mesh-tissue-teeth-deepseek41:codex/dispatch/2026-09-08-mesh-tissue-teeth-deepseek41'
# or
git apply --check /tmp/ds41-mesh-tissue.patch && git apply /tmp/ds41-mesh-tissue.patch
```

No merge/push was performed. User-owned preview ports 5396/5397 were not
touched; own ports 5406/9406 were cleaned up.

DualMem writes are blocked the same way (`attempt to write a readonly
database`): the store lives outside the workspace. The durable facts for this
pass are therefore recorded here instead of in the memory system.
