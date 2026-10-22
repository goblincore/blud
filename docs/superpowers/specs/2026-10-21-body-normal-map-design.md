# Body normal maps — design (2026-10-21)

Owner, on the twinhead: "the body would be nice if it had some more definition with the muscles via maybe
normal map or something", then "i think we need to add support for normal maps on the body". Chosen over a
tiling detail map: a **projected anatomy map** — per-character, baked, muscle-level.

## The problem

A raymarched body has no UVs, and every bit of shape costs a prim folded per pixel. Muscle separations,
veins, fibres and swellings are exactly the detail that is expensive as prims and only ever seen as shading.

## Design

**Runtime (one post-hit block).** `webgpu/march/body/blocks/post/body-normal.wgsl.ts`, spliced into
`MARCH_TRACE_POST` after the body grain, so the forward, refine and deferred entries all run it.

- The hit's REST-space position is already known: `anchor` (`restPoint`), the hit mapped into the dominant
  prim's rest frame, which is the `.blob`'s own unposed coordinates (`pack.ts` restA/restB).
- The texture is a tangent-space normal map projected **cylindrically round a vertical axis through the torso
  in rest space**: u = angle (0.5 faces +z), v = rest height across a band. Because every torso prim maps into
  the same rest body, the map does not seam where the dominant prim changes, and it rides the flesh as the
  body moves.
- The tangent frame (round-the-axis tangent, rest +y) is carried rest -> world by the conjugate of restPoint's
  rotation, orthonormalised against the current shading normal, and the texel bends that normal.
- Scope: only hits whose dominant prim is in the torso cluster's prim range. Masked like the grain (face sheet,
  gloss/metal, painted prims, wounds, cut faces). Strength 0 skips the block: bodies without a map shade
  bit-identically.
- Inputs: `bodyNormTex`, `bodyNormCfg` (strength, yMin, yMax), `bodyNormAxis` (axis x, z; prim start, end),
  positionally last after `lightList`, bound by name in `zombie-gpu.ts`. Crowd types inherit them through
  `copyUniformValues`. Gib chunks keep strength 0 (their prims are a subset; the range would be wrong).
- Cost: post-hit only, four `textureLoad` taps (manual bilinear; the march has no sampler) plus the rows
  restPoint already reads. No `mapBody`/`calcNormal` call, so no new cold-compile driver.

**Authoring (offline bake).** `scripts/bake-body-normal.ts <character>`:

- Inputs: the `.blob`, plus `characters/<character>.detail` — ordinary `body` lines folded in for the bake
  only, never marched.
- Per texel, march a ray toward the axis to the TORSO-ONLY plain body's skin and the TORSO-ONLY detailed body's
  skin; store the detailed normal in the plain surface's tangent frame. Writes `<character>-body-n.png` and a
  `<character>-body-n.json` sidecar (band, axis, size) the runtime reads.
- Detail is placed ON the skin by a generator that probes the marched torso
  (`scripts/twinhead-detail-gen.ts` for the twinhead), so ridges stand a set number of millimetres proud.

**Wiring.** `character-registry.ts` `bodyNormal: { url, meta, strength }`; `webgpu/body-normal-load.ts`
loads (NoColorSpace, no flip — row 0 is the band's top) and computes the torso prim range; `game-spawn.ts` and
the lab hero call `setBodyNormal`.

## Limb regions (added 2026-10-21, same day)

Owner: veins expected on the arms too. Each region is now a cylinder round a REST-space segment, baked into its
own band of rows of one atlas; the torso is region 0, a vertical segment, which is exactly the original
projection.

- **Bake.** `bake-body-normal.ts ... --limb bone:t0:t1:rMax:rows` adds a limb region round that bone's segment
  t0..t1. Only that limb's cluster is marched, and each row marches only the prims within reach of its axis point,
  so arm rows are cheap.
- **The table lives in the texture.** Row 0 is a header: `'B','N',version,count`, then five texels per region of
  16-bit pairs (head, tail, rMax, row0, rows, kind). So the march inputs did not change: same three, same
  positions, no new pins.
- **Runtime selection.** Torso-prim hits take region 0. Other hits take the limb region whose segment their
  rest point lies along, within rMax, nearest axis first. The test is on the rest point, so a limb in any pose
  finds its own region and a swinging arm never picks up chest.
- **Frame per region.** A = axis, f = rest +z made perpendicular to A, s = f x A; u = atan2(r.s, r.f).
- **Arm detail.** The twinhead's arm detail (varicose veins) is placed on the arm skin by
  `twinhead-detail-gen.ts`, using `side=` prims on the arm bones.

## Limits, known

- A limb region is one straight segment per bone: a strongly bent prim (a hooked horn) drifts off its cylinder.
  Joint areas are covered by whichever adjacent segment is nearer.
- The projection is a single vertical cylinder: surfaces facing straight up or down (the tops of the traps)
  get stretched texels.
- March-resolution: the map is applied in the march, not in the output-resolution detail pass, so after
  upscale it is softer than the pores.
- Bake time is minutes (CPU sdBody); fine for an offline asset step.
