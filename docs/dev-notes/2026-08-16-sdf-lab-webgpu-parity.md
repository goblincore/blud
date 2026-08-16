# SDF lab on WebGPU — parity reached, and what it revealed

**Date:** 2026-08-16
**Task:** `X1.2` · [spec](../superpowers/specs/2026-08-15-sdf-lab-webgpu-design.md)
**Run:** `npm run dev` → `/sdf-lab-webgpu.html` · bench twin `/sdf-lab-webgpu-bench.html`

Phases 0–3 of the WebGPU spec are done. The lab is at feature parity with the
WebGL one, and it is now the path to build on.

---

## What landed

| Feature | Where |
| --- | --- |
| Wounds, everted rims, wound + char masks | `webgpu/march.wgsl.ts` — `applyWounds`, `woundMask`, `charMask` |
| Face: planar + spherical projection, atlas crop, relief, glowing eyes, flicker | `MARCH_BODY`, `texel`, `flicker` |
| Severing | already CPU-side; the view re-packs cluster alive flags |
| Gib chunks with torn ends, severed head keeps its face | `createChunkGpuView` |
| Tuning panel, shooting, rig, gib-all, crowd spawner | `webgpu/lab-main.ts` |

Every pure module — `build-body`, `clusters`, `pack`, `validate`, `face`,
`damage`, `sever`, `rig`, `rig-bind`, `gib-chunks`, `panel` — is shared
**unchanged**. Only the rendering tail differs, so the field maths cannot drift
between the paths. `chunkExtent` moved from `zombie.ts` (which imports `three`)
into its own `extent.ts`, because a WebGPU module reaching into `zombie.ts`
would pull a second copy of three into the bundle.

### Wounds ride the data texture

The GLSL path had to use uniform arrays. Here wounds are two more rows of the
same RGBA32F texture the primitives already live in (rows 5 and 6), since
`MAX_WOUNDS` (16) fits comfortably inside `MAX_PRIMS` (48). One upload carries
the whole per-body payload.

---

## The finding that matters: WebGPU applies the sRGB encode, WebGL never did

**Measured, not assumed.** Flatten both shaders to a constant — albedo 0.5,
`keyIntensity` 0, `fillIntensity` 1, no spec/fresnel/translucency/noise — and:

| Path | Rendered grey |
| --- | --- |
| WebGL (`ShaderMaterial`) | ~128 — raw linear 0.5 |
| WebGPU (`MeshBasicNodeMaterial`) | ~188 — `0.5^(1/2.2) x 255 = 186` |

A raw `ShaderMaterial` writes `outColor` straight to the target with no engine
involvement; three only injects its output-encode chunk into its own materials.
A node material goes through three's output pipeline, and the encode lands via
the canvas configuration rather than in the fragment shader — the generated WGSL
has no sRGB maths in it at all, which is why reading the shader alone would have
been misleading.

**So WebGPU is the correct one, and the flesh presets are what look wrong.**
They were hand-tuned to compensate for the missing encode, so through a correct
chain they read far too bright. This makes the preset retune a single job that
unblocks three things at once: the WebGPU lab's look, leaving post-fx on, and
bloom for the eye glow.

Two smaller differences found the same way, neither currently visible:

- The node material respects `scene.fog`; the raw `ShaderMaterial` ignores it.
  Fog starts at 10 units and the lab sits at 1.4–4, so the term is zero here.
- `MeshBasicNodeMaterial` is genuinely unlit — the generated shader sets
  `indirectDiffuse = 1.0` and `ambientOcclusion = 1.0`, so our computed colour
  passes through unmodulated. Worth having checked rather than assumed.

Silhouettes match between the paths exactly, so the field port is faithful.

---

## New trap: WGSL reserved words

`let meta = ...` in the wound loops cost a blank page. WGSL reserves a long list
of ordinary-looking identifiers GLSL is happy with — `meta`, `type`, `filter`,
`set`, `shared`, `sample`, `mut`, `ref`, `match`, `pass`, `precise`. The failure
is one `CreateShaderModule` validation error buried under a dozen cascading
"invalid due to a previous error" lines.

`march.wgsl.test.ts` now lints declarations against the reserved list, so this
class of failure is a test failure instead. The same file also asserts the
`wgslFn` parse contract (every source starts with `fn`; `HELPERS` is
dependency-ordered), that the ported features are actually reachable from the
entry point, that `atan2` is used rather than GLSL's two-argument `atan`, and
that the GLSL depth remap did not come along.

**Also learned:** two live GPU contexts in one browser pane starve the second —
the WebGPU lab silently hung at `renderer.init()` while the WebGL lab was open
in another tab, with no console error at all. Close the other tab before
concluding the page is broken.

---

## LOD baseline

Apple M3, 960x540, 96 march steps, 23 primitives, full lab (rig, face, wounds
on body zero; crowd bodies static but **with** the face, because a crowd that
skipped it would under-report real cost):

| Bodies | Median | p95 |
| --- | --- | --- |
| 15 | 36.8 ms | 44.7 ms |

Consistent with the renderer bench's 36.5 ms, so the feature work added roughly
nothing per body. Target for the LOD pass is ~16 ms. `[` and `]` add and remove
crowd bodies.

---

## What is still not done

- **Post-fx.** pmndrs `postprocessing` is WebGL-only, so the WebGPU lab has no
  Bayer dither or BLOOD.PAL snap. Deliberate per the spec — but note it is now
  the *only* thing the WebGL lab still has that this one does not, and it is
  gated on the same preset retune.
- **Timestamp queries.** Frame time is still wall-clock. `timestamp-query` is
  available on this device and would separate GPU cost from CPU cost, which the
  LOD work will want.
- **Compute.** The whole point of migrating. Nothing here uses it yet.
