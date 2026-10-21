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

## Limits, known

- Torso only. Limbs would each need their own cylinder (round the bone's rest axis) — a second region type.
- The projection is a single vertical cylinder: surfaces facing straight up or down (the tops of the traps)
  get stretched texels.
- March-resolution: the map is applied in the march, not in the output-resolution detail pass, so after
  upscale it is softer than the pores.
- Bake time is minutes (CPU sdBody); fine for an offline asset step.
