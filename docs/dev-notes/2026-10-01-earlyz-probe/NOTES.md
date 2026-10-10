# Early-Z probe: does conservative depth work in our Chrome? (2026-10-01)

Research probe, not a gate. Asked while scoping the early-Z + hull spike (see
the Obsidian note `Claude Notes/Research/2026-10-01-dreams-sdf-techniques-vs-blud.md`).

**Answer: yes, on Chrome 154 / Apple Metal 3.** `@builtin(frag_depth, greater)`
restores hardware early-Z for a depth-writing fragment shader, even with
`discard`. Plain `@builtin(frag_depth)`, which is what three emits for every
SDF march material today, shades every hidden fragment.

## Shader acceptance (`DRIVER=wgsl-features.mjs ./run-probe.sh`)

- `navigator.gpu.wgslLanguageFeatures.has('fragment_depth')` is **false**: Chrome 154
  does not advertise it.
- Yet `requires fragment_depth;` + `@builtin(frag_depth, greater)` compiles with no
  messages, and `createRenderPipelineAsync` succeeds inside a validation error
  scope. The qualifier also compiles WITHOUT the `requires` line.
- Control: `requires bogus_feature_xyz;` errors (`feature 'bogus_feature_xyz' is not
  supported`), so the check is real.
- The gpuweb proposal (`proposals/fragment-depth.md`) is still marked **Draft**. Treat
  the syntax as possibly unstable: feature-detect by compiling at boot, and fall
  back to plain `frag_depth`.

## Timing (`./run-probe.sh`, `earlyz-probe.html`)

The setup:
- target 1024², depth32float, depth compare `less`;
- a full-screen occluder at depth 0.1;
- then 16 full-screen layers at raster depth 0.5, each with a 600-iteration
  fragment loop, writing `fc.z + 0.01` where they write depth;
- GPU timestamp queries, median of 12.

| variant | GPU ms |
| --- | ---: |
| occluded, no depth write | 0.057 |
| **occluded, plain `frag_depth`** | **115.98** |
| occluded, `frag_depth, greater` | **0.057** |
| occluded, `greater` + `discard` | 0.057 |
| occluded, `discard`, no depth write | 0.057 |
| reference: no occluder, no depth write (layer 1 shades, 2–16 early-reject on equal depth) | 6.88 |

Plain `frag_depth` paid every hidden layer (16 × 6.9 ms ≈ 110 ms); `greater`
rejected them all before the fragment shader ran.

## What it means for the march

- The march material rasterises a **back-face** proxy box (`zombie-gpu.ts:1552`)
  and writes plain `frag_depth` (`zombie-gpu.ts:1608`), so a body hidden by
  another body pays the full march. The march target also holds no level depth,
  so bodies behind walls pay it too.
- `greater` promises the written depth is at or beyond the raster depth. That is
  true for a ray marched from a proxy's **front** face, but not from a back face.
  So proxies must draw front faces, with a separate back-face path when the camera
  is inside the box. Clamp the written depth to `max(hit, fragCoord.z)` so a
  rounding error at the entry face can never break the promise.
- three's `WGSLNodeBuilder.getFragDepth` (three 0.186, `WGSLNodeBuilder.js:1648`)
  emits the builtin. It needs a per-material opt-in: other depth-writing passes
  (composite, goo, back-face proxies) must keep plain `frag_depth`.
