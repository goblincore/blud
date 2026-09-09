# `'bodies'` field style — handoff (2026-09-09)

**Status: FIXED in 9f205aaa** (same day). The rest of this document is the
handoff as written before the diagnosis; it is kept because the six earlier
fixes and the reproduction commands are still accurate.

## Resolution

Two mechanical defects in the mesh pass, neither in the four hypotheses below:

1. **The alpha-0 coverage clear was undone.** `renderer.clear()` with clear
   alpha 0 was followed by `renderer.render()` with `autoClear` still on,
   which re-clears with the renderer's clear alpha (1) before drawing a bone.
   Every empty texel then passed the weave's coverage gate and the weave
   painted the clear colour over every held scanline of the whole frame —
   the see-through, striped bodies. The march's own `clear()` already turns
   `autoClear` off for its draw; the mesh pass now does the same.
2. **`fieldMeshPrev`'s depth was 1x1.** `RenderTarget.setSize` resizes only
   the colour textures; a `DepthTexture` keeps its construction-size image
   until the target is actually rendered to. `fieldMeshPrev` was only ever a
   copy destination, so its depth was allocated 1x1 and the depth retain
   failed WebGPU validation every frame (a depth copy must cover the whole
   subresource). Held rows then wove bone at garbage depth. It joins the
   init-clear list, which is why `fieldPrev` never had the problem.

Both are pinned by tests against a fake renderer in `sdf-layer.test.ts`.
What discriminated: `'sdf'` at comb 0.6 was clean on a fresh tab while
`'bodies'` was striped at comb 0, 0.6 and 1 — hypothesis A's own test — and
the fresh-tab console showed ~236 `copyTextureToTexture` validation errors
naming a 1x1 `Depth24Plus` destination.

`'bodies'` remains reachable via `__sdfGame.setFieldStyle('bodies')`; the
default is still `'frame'` — whether to flip it is the owner's call.

**Symptom (owner, in play):** bodies render **semi-transparent** — you see the
wall through them — with **black speckle** over the flesh. Present in motion
and, from the last screenshot, when standing too. HUD ~44 ms, so it is also
costing time it should not.

Two rounds of fixes from me did not clear it. I am handing this over rather
than guessing a third time.

---

## What the feature is

Interlaced scanline fields: march half the scanlines each frame and weave them,
halving the dominant GPU pass. This part WORKS and is a big win — worst frame
125 → 38 ms in `'frame'`. See `field-rendering-result.md`.

`fieldStyle` picks *what* gets interlaced:

| style | interlaced | status |
| --- | --- | --- |
| `off` | — | fine |
| `sdf` | marched flesh only | works; has a flesh/bone disagreement by design |
| **`bodies`** | flesh **+ skeleton meshes** | **BROKEN — this document** |
| `frame` | the whole assembled picture | works, shipped |

`'bodies'` exists so characters carry the interlace while the level and
viewmodel stay crisp.

## How `'bodies'` is meant to work

`src/lab/sdf-zombie/webgpu/sdf-layer.ts`:

1. Pass 1 renders the polygonal scene at FULL resolution to `outputTarget`,
   with `FIELD_MESH_LAYER` (8) **disabled** — the skeleton is excluded (~L800).
2. The march renders into `target`, which `resize()` has made HALF height
   (L887), with a half-texel vertical jitter via `camera.setViewOffset`.
3. The composite weaves flesh from `target` + `fieldPrev` and writes colour +
   depth into `outputTarget`. That is the `INTERLACED FIELDS` branch inside
   `COMPOSITE_WGSL` (L272), gated by `uCompositeField` (L587, passed at L847).
   It **discards on `alpha >= 1`** — the march's "nothing here" sentinel — and
   `quadMat.depthNode = sampled.w`, i.e. depth rides the alpha channel.
4. The skeleton renders alone into `fieldMesh` (half height, own depth
   texture), camera limited to `FIELD_MESH_LAYER`.
5. `meshQuadMat` (L682-692) weaves `fieldMesh` + `fieldMeshPrev` through
   `FIELD_INTERLEAVE_WGSL` (L345) into `outputTarget` with `depthTest: true`,
   republishing depth so the hardware resolves bone against level and flesh.
6. Retain: `copyTextureToTexture` for colour AND depth on both pairs.

## What is verified

- Boots with **zero console errors** on a fresh tab.
- All style transitions cycle cleanly; targets reallocate without error.
- `npx tsc --noEmit` clean; renderer suite 1744/1745 (the pre-existing
  `surface-nets.wgsl.test.ts` failure is unrelated and predates this work).
- `'frame'` and `'off'` render correctly, so the shared machinery — jitter,
  parity, retain, interleave — is not wholly wrong.

## Bugs I already found and fixed (do not re-fix these)

1. **`fieldPrev` missing from the lazy-init clear.** Alpha 0 is not the
   "nothing here" sentinel; the composite read it as a valid surface at depth 0
   and painted black over the scene.
2. **Retain was a fullscreen-quad blit.** `target` is written by the
   rasteriser; a quad sampling `uv()` writes with the opposite Y origin, so the
   retained field came back vertically MIRRORED. Now `copyTextureToTexture`.
   **Do not "fix" a flip by mirroring the row index** — that hard-codes one
   platform's convention.
3. **`RGBA16Float` vs `RGBA32Float`.** `copyTextureToTexture` demands identical
   formats; the retain failed every frame while the picture looked plausible.
   All field buffers are now `RGBA32Float`, matching `target`.
4. **Depth stopped being republished** when the frame moved to a half-height
   buffer, so the goo layer drew blood over everything.
5. **Depth was being interpolated** — `mix(dNow, dHeld, comb)`. A blended depth
   describes no real surface. Held rows now take the held depth verbatim.
6. **No coverage gate on the mesh weave.** It forced `colorNode` alpha to 1 and
   the material was `transparent`, so it painted opaque black wherever its
   depth passed. Now an explicit `discard` on source alpha, opaque material,
   and `fieldMesh` clears with `setClearAlpha(0)`.

Fixes 5 and 6 are the most recent and did NOT resolve the reported symptom.

## Leading hypotheses, untested

**A. Flesh dropout on held rows (my best guess).** The composite's field branch
discards on `alpha >= 1`. On a held row it reads `fieldPrev`. If `fieldPrev` is
stale, mis-sized or mis-oriented in `'bodies'` specifically, half the rows
discard — which would read exactly as "semi-transparent with speckle", because
every other scanline shows the wall behind. Note `'sdf'` shares this path, so
**compare `'sdf'` against `'bodies'`**: if `'sdf'` is clean, the flesh weave is
fine and the fault is the mesh pass; if `'sdf'` shows it too, the flesh weave
is the culprit and the mesh pass is innocent.

**B. `fieldPrev` sizing.** L903 sizes it `(w, h)` for `'sdf'`/`'bodies'` and
`(fw, fh)` for `'frame'`. Those differ when `sdfScale != 1`. Verify with
`__sdfGame.setSdfScale(1)` explicitly.

**C. Mesh material alpha.** The coverage gate assumes the skeleton material
writes alpha 1 where it draws. `mesh-renderer.ts` sets
`material.colorNode = lit(...)`. **If that alpha is not 1, the gate discards
the bones themselves** — which would also let flesh-behind show through.
Cheapest thing to check first; a one-line probe of the rendered alpha settles it.

**D. Depth precision across a `DepthTexture` round trip.** Depth is copied
half-height→half-height then republished through `depthNode`. If the copy or
the format loses precision, the republished depth may fail its own test at
grazing angles, punching holes.

## How to reproduce and bisect

```bash
npm run dev            # or the running server on :5273
```

In the console — **a reload restores the defaults, so set these after load**:

```
__sdfGame.setFieldStyle('bodies')   // the broken one
__sdfGame.setFieldStyle('sdf')      // shares the flesh weave, NOT the mesh pass
__sdfGame.setFieldStyle('frame')    // known good
__sdfGame.setFieldComb(0)           // no comb; isolates weaving from holding
__sdfGame.setFieldComb(1)           // full hold
```

`setFieldComb(0)` is the sharpest probe: at 0 the held field is interpolated
away entirely, so anything still wrong is NOT about holding stale pixels.

## Two process notes that cost me real time today

- **Use a FRESH browser tab.** The console accumulates across HMR reloads, so a
  tab you have been editing against buries live errors under stale ones. Three
  of today's bugs only surfaced on a clean tab.
- **Screenshots do not catch this bug class.** Every one of the six above
  rendered convincingly while being wrong underneath. Prefer mechanical checks
  — read back alpha, assert formats, parse the shader — over looking.
