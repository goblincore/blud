# Offline gib assets — Task 1: generator and saved assets

Branch `codex/offline-gib-assets-task-1`, baseline `30e66c84` (this commit's
parent). Isolated dispatch worktree; no merge, no push, primary checkout
untouched. CPU-only: no browser, no WebGPU, no GPU run (Task 3 owns the visual
gate).

## What this delivers

A CPU-only, versioned, **offline** generator that bakes the zombie and soldier
gib splits to committed mesh assets, plus a schema/validation module the runtime
loader (Task 2) consumes. Nothing in the running game changed: import of the
asset modules is not on any app path, so `main`'s behavior is identical until
Task 2 wires a loader.

| File | Role |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/gib-asset.ts` | Schema: manifest/piece types, section layout, binary encode/decode, numeric validation, bounded skinning reference, recipe fingerprint. No three/DOM/node. |
| `src/lab/sdf-zombie/webgpu/gib-asset-build.ts` | CPU builder: `bakeChunkGeometry` per planned piece, bone isolation, per-vertex binding, approximation metrics. |
| `src/lab/sdf-zombie/webgpu/gib-asset-archetypes.ts` | Archetype table + the shared recipe/look/palette builders (one builder, used by script and test). |
| `scripts/build-gib-assets.ts` | CLI: incremental build, `--check`, `--force`, `--archetype`, `--cell`, `--out`. Reads `.blob` with `node:fs` (works outside Vite). |
| `src/lab/sdf-zombie/webgpu/gib-asset.test.ts` | 10 focused tests: round-trip/schema, corrupt-payload rejection, equal-length source edit, determinism, binding rigid-motion, committed-asset validation + stale check. |
| `public/assets/lab/gibs/{manifest.json,zombie,soldier}.gib.{json,bin}` | The committed owned assets. |

`gib-parts.ts` gained one **optional** field (`GibCutLink.overhang`) so a cut's
boundary — not just its plane — survives into the asset. Additive; all 113
related gib/chunk tests still pass.

## Exact usage

```bash
npm run gib:assets                      # rebuild only archetypes whose fingerprint changed
npm run gib:assets -- --force           # rebuild all
npm run gib:assets -- --archetype zombie
npm run gib:assets -- --check           # validate + stale-check committed assets; non-zero on stale/missing/invalid
npm run gib:assets -- --cell 0.02       # override extraction cell (also changes the fingerprint)
```

Incremental logic: a per-archetype recipe fingerprint covers the full `.blob`
text, build options, compiled face, palette, look, surface response and bake
settings. If the committed fingerprint matches a fresh recompute, that archetype
is skipped. `--check` re-decodes every committed piece and re-runs the numeric
validator, then recomputes the recipe from the current source.

## Generated sets (recorded, not assumed)

Default cell `0.012 m`; `bakeChunkGeometry` (surface nets + Newton pull, 10 mm
runtime settle bake's ancestor). Reproduced byte-for-byte (see determinism test
and manual `cmp`).

| Archetype | Pieces | Verts | Tris | Bin | JSON | Offline bake | Build |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zombie | 24 | 37,738 | 75,552 | 3,925,208 B | 147,920 B | 2,893.5 ms | 3,331 ms |
| soldier | 19 | 42,918 | 85,820 | 4,463,376 B | 114,360 B | 2,400.2 ms | 2,701 ms |
| **total** | 43 | 80,656 | 161,372 | **8,388,584 B** | 262,280 B | ~5.29 s | ~6.03 s |

Fingerprints: zombie `9db13e4696486eaf`, soldier `106b1bf11692e6d7`.
Blob hashes: zombie `f5cb86c185c0ba6d`, soldier `851476176d087d64`.

Every piece is present, including the skeleton, which `gib-library.ts` cannot
bake at all (`gib-library.test.ts`'s `it.fails` gap): its field folds bones only
near a wound, so a bone-only piece extracts empty. Here a bone-only piece is
extracted from the **bone union itself** (bone prims cloned `op:'add'` handed to
the baker as the additive field), so `bone.cage`, `bone.skull`, `bone.pelvis`,
the long bones and `organ.gut` all have real geometry.

## Approximation (measured offline, recorded per piece)

- **Extraction field error** — max `|field(vertex)|`: `1.1–7.1 mm` (bone.cage
  worst; thin ribs at a 12 mm cell). Mean well under 1 mm.
- **Cut seams** — nearest-neighbour gap between neighbours across each cut, from
  baked vertices near the plane: `0.9–4.6 mm` minimum, mean `21–31 mm` because
  the band includes vertices curving away from the plane. The two sides
  deliberately overlap by the cap overhang (`~6 mm`), so a small positive gap is
  expected and the pieces meet.
- **Smooth-union skinning error** — `deformedFieldErrorMax`: `1.4–31.8 mm` under
  a deliberately aggressive synthetic motion (±10° per prim about its own
  midpoint, independently), `|field_deformed(reconstructed)|`. This is an upper
  bound that says "a vertex blended across a fillet does not follow the deformed
  union exactly"; it is **not** the runtime slough value. Worst pieces are thin
  lower limbs. Task 2's deformer should treat this as the reason to prefer the
  stored per-vertex weights plus the source endpoints, and to re-measure under
  the real slough.

## Asset → runtime contract (for Task 2)

**Local frame.** Each piece's positions are `bodyPosition − piece.offset`, where
`offset` is the planner's REST-pose piece origin (`g.origin`). A spawn that puts
the chunk at `piece.origin` + the actor transform can place the geometry with no
extra offset. Local geometry carries the baked procedural channels, never
world-space settled geometry and never extracted pixels.

**Binding.** Each piece stores a `bind.prims` table (rest endpoints/radii/scale
copied from the plan's piece prims and bones). `source`/`index` name where the
deformed twin lives at runtime:

- `source: 'flesh'`, `index i` → `RuptureFrame.deformedPrims[i]`
  (`posed.prims[i]` when there is no slough).
- `source: 'bone'`, `index i` → `RuptureFrame.deformedBones[i]`
  (`posed.bonePrims[i]`).
- `source: null` → a `sub` cap or unsourced row; it has no deformed twin and
  follows the piece transform rigidly.

Per vertex, `bindIndex` (u16) and `bindWeight` (u8, rows sum to exactly 255)
hold up to `bind.maxPrims = 4` entries. `deformBoundVertex()` in
`gib-asset.ts` is the reference capsule-frame reconstruction (exact for a
capsule, approximate for a rounded box/strand). Rest→rest is identity; a rigid
motion of all prims reproduces exactly (tested). `piece.material` is
`'flesh' | 'bone' | 'organ'`: bone/organ pieces must be drawn with the skeleton
material — their `bakeColor` is a meat-palette fallback because the CPU baker has
no bone branch.

**Face.** The head piece carries a `face` frame (`centre`, `quat`, `axes`,
`forward`, `reach`) in the REST body frame. The face **texture stays an external
reference**; no pixels are stored or embedded.

**Cuts.** `piece.cuts` lists each shared cut with the neighbour part name,
`at`, `n` (from this piece toward the neighbour) and `overhang`.

**Loading.** `manifest.json` → entry → fetch `<archetype>.gib.json` +
`.gib.bin` → `decodeGibAssetPiece(piece, bin)` → `validateGibAssetPiece(...)`.
Missing/stale/malformed must fall back (Task 2), never block READY. Run
`npm run gib:assets:check` in CI/boot tooling to detect staleness.

## Limitations / honest scope

- **No runtime integration, no GPU, no visual claim.** This task produces and
  validates files only; Task 2 owns loading/deformation/handoff, Task 3 the
  visual gate. Anything here is a CPU/asset claim.
- **Bone/organ albedo is a fallback.** Geometry is correct; color must come from
  the skeleton material at render time.
- **Capsule-frame skinning is an approximation** for rounded boxes/strands;
  measured above. The runtime deformer may do better (e.g. store per-vertex
  local coordinates) but the committed contract supports the capsule-frame path.
- **No benchmark claim.** Offline bake is ~5.3 s total; loader/parse cost is for
  Task 2/3 to measure. Offline meshes remove runtime extraction, not every
  renderer/perf cost.
- **Size is a tradeoff, stated**: 8.4 MB committed at 12 mm cells. `--cell`
  overrides; 20 mm roughly quarters the vertex count. Task 3 should confirm the
  chosen cell visually before locking it.
- **Ownership preserved**: all committed data is generated geometry/procedural
  attributes from tracked `.blob` sources. No extracted Blood pixels/textures
  were read, baked or embedded; head textures remain external references.

## Later candidates (not this task)

Other archetypes in `character-registry.ts` could use the same pipeline once
Task 2/3 prove the zombie/soldier sets. No measured rationale yet; deliberately
not expanded.
