# march — split WGSL modules

Phase 1 of the `march.wgsl.ts` split (2026-09-18). `webgpu/march.wgsl.ts` is a
barrel of `export * from './march/…'` lines; the shader text lives here.

## MOVE-ONLY

Every export keeps its exact name and exact string value. The sha1 golden
snapshot in `__snapshots__/march-golden.test.ts.snap` was recorded before the
first move and must never change during phase 1. A diff there means a move
altered shader text — fix the move, never update the snapshot.

## How `wgslFn` parses (the rules that keep the page from going blank)

Two hard constraints, both discovered the painful way, both presenting as the
single unhelpful error `FunctionNode: Function is not a WGSL code.`

1. **Each source string must BEGIN with `fn`.** three's `declarationRegexp` is
   `^`-anchored (see `WGSLNodeFunction.js`), so a leading comment — even a blank
   first line — makes the parse fail outright. Every comment therefore sits
   *outside* the template strings, or inside a body. A split block that is
   spliced into the middle of a body is not a helper and has no such constraint,
   but its exact bytes still matter.

2. **Helpers cannot simply be concatenated ahead of the entry point**, because
   of (1), nor after it, because WGSL requires declaration before use. They are
   passed through `wgslFn`'s second argument, `includes` — the `HELPERS` list in
   `helpers.ts`. Its order is load-bearing and must not be reordered.

## Module map

| Module | Contents |
| --- | --- |
| `layout.ts` | row-table constants, `MAX_GROUPS`, `soldierFaceDamageShadow` |
| `math.wgsl.ts` | hash/noise/fbm and quaternion helpers |
| `primitives.wgsl.ts` | smin/smax, cone/strand/box SDF primitives, `DETAIL_FIELD` |
| `melt.ts` | face-melt and melt-skin constants |
| `shade-helpers.wgsl.ts` | `TEXEL`, `SOFT_SHOULDER`, `FLICKER`, `LEVEL_SHADOW` |
| `fields/carves.wgsl.ts` | `REST_POINT`, `APPLY_CARVES` |
| `fields/wounds.wgsl.ts` | `APPLY_WOUNDS`, `WOUND_MASK`, `WOUND_SHADOW` |
| `fields/tissue.wgsl.ts` | `TISSUE_RAMP`, `CHAR_MASK` |
| `fields/volume.wgsl.ts` | `SAMPLE_VOLUME` |
| `fields/groups.wgsl.ts` | `FOLD_GROUP`, `INSTANCE_STATE` |
| `fields/bones.wgsl.ts` | `FOLD_BONE_RANGE`, `APPLY_BONES` |
| `map-body.wgsl.ts` | `MAP_BODY`, `CALC_NORMAL` |
| `cone-march.wgsl.ts` | `CONE_MARCH`, `DEPTH_PREPASS_MARCH`, `DEPTH_PRE_FETCH`, `QUAD_TILE_EMPTY_WGSL` |
| `body/params.wgsl.ts` | `MARCH_BODY_PARAMS` |
| `body/trace.wgsl.ts` | trace setup/loop/post, assembled `MARCH_BODY_TRACE` |
| `body/face.wgsl.ts` | `FACE_LAYER_WGSL` |
| `body/surface.wgsl.ts` | surface prep, normal/anchor/burn readers |
| `body/light.wgsl.ts` | `MARCH_BODY_LIGHT` |
| `body/entry.wgsl.ts` | `MARCH_BODY`, `REFINE_LOOP`/`PARAMS`/`BODY` |
| `helpers.ts` | the `HELPERS` include list |

Modules under `march/` import each other directly and **must not** import the
`../march.wgsl` barrel (that would be a cycle).
