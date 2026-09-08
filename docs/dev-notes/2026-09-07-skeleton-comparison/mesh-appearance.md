# Mesh skeleton appearance pass

Date: 2026-09-08

## Decision

The mesh comparison path now has a mesh-only material treatment. It keeps the
existing `BONE_SHADE_WGSL` forward light composition and its ambient, key and
flashlight uniforms, while replacing the old clean ivory surface input with a
darker tissue-stained surface. Broad dirt and small flecks are evaluated from
segment-local position, so the markings remain attached while a segment moves.
World position is still used for wound exposure because crater centres are
world-space data.

The head mesh carries normalized coordinates derived from the contract source's
local bounds. The renderer uses those coordinates for broad paired eye sockets,
a central nasal opening and a short tooth row on the lower front of the head.
The mapping follows the zombie authoring frame explicitly: x is left/right, y
is up and +z is forward. A front gate prevents these marks from wrapping around
the sides or back. The same cached geometry is shared across actors; a constant
per-vertex attribute stores the normalized coordinate and head flag, so this
does not allocate a material per actor.

## Scope

- Mesh mode only. The procedural bone tubes, baked SDF/volume paths and shared
  bone material defaults are unchanged.
- The extracted anatomy and source field are unchanged. The facial openings are
  material cues on the existing surface, not geometric recesses or holes.
- Intact-flesh coverage is unchanged because mesh depth composition and source
  bounds are unchanged.
- No textures, external assets, full-character bake, or per-frame cache work was
  added.

## Verification

- `npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-appearance.test.ts src/lab/sdf-zombie/webgpu/skeleton-spike/mesh.test.ts`
  - 18 tests passed.
- `npx tsc --noEmit`
  - Passed.

The coordinator owns the serial GPU/browser run. This pass therefore does not
claim shader compilation or visual acceptance. Manual comparison should judge
whether the skull reads at gameplay distance, whether the mouth stays confined
to the lower front, and whether the darker local stains make the mesh sit nearer
the procedural/baked SDF result without losing wound readability.
