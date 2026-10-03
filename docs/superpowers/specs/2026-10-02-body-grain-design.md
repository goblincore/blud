# Body grain: the face sheet's texture on the body (design)

**Date:** 2026-10-02 · **Status:** approved by the owner ("lgtm", 2026-10-02) · **First user:** the goblin
**Context:** [goblin refinement](2026-10-01-goblin-refinement-design.md) (phase 1 done) ·
[look-dev notes, "Skin texture"](../../dev-notes/2026-10-01-goblin-body-lookdev/notes.md)

## Why

The owner, looking at the rebuilt goblin in the lab: *"apply the noise texture that is on his face to his body to give it
more texture."* In the lab frames the face reads finely grainy and the body reads as smooth plastic.

**The face** is a generated 64×64 sheet (`blob-face-sheet.ts`). Its base tone carries per-texel white noise
(`v = 0.46 + (hash - 0.5) · 2 · grain`; the goblin uses `grain 0.10`). It is uploaded with nearest filtering and
projected onto the head, so each grain cell is hard-edged and about 3.1 × 3.7 mm. It is drawn in two ways
(`march/body/face.wgsl.ts`):
- as an albedo MULTIPLY (`albedo · tex / mean`), about ±22% at grain 0.10;
- as a relief bump from neighbour-texel luma differences, about 0.28 of normal tilt at the default `texRelief` 1.4.

**The body** has no albedo grain. Its only fine texture is the micro-detail normal noise: smooth two-octave fbm with
features of about 5–11 mm, normal only. It runs at `surfaceNoiseAmp`, inherited at 0.06 (about 1° of tilt). A data-only
preview on 2026-10-01 raised it to 0.22. That reads as pebbled skin, not the face's speckle.

## What we build

A per-character palette setting, **`grain`**, that gives the body the face sheet's kind of texture.

- **Units match the face sheet's `grain`.** A character that sets the same value in both gets the same contrast on face
  and body. The goblin sets `grain 0.10`, as its sheet does.
- **The look:** hard-edged noise cells about 3.5 mm across (the face texel's size). Per cell:
  - an albedo multiply matching the face's, `1 + (h − 0.5) · 2 · grain / 0.46`, where `h` is a per-cell hash in 0..1 and
    0.46 is the sheet's base tone;
  - a per-cell normal tilt scaled like the face's relief, so each cell catches the light a little differently, as the
    face's nearest-filtered bump does.
  - It is a low-res-texture grain, which suits the 90s look.
- **It sticks to the skin.** Cells are cut in the hit's rest-space anchor (the same `anchor` the mottle and the
  micro-detail use), so they ride each limb through animation instead of swimming over it.
- **The face is not grained twice.** Where the face sheet covers the head, the body grain fades out by that coverage.
- **Two scales, so it never vanishes and never crawls** (owner, 2026-10-02). A single 3.5 mm cell fading below about
  1.5 pixels would be invisible beyond about 0.9 m in the lab (the plan's measurement: full grain only within about
  0.43 m). The face never fades, so at 1.35 m its texels are about 0.6 px and it crawls in motion. So there are two
  octaves of the same grain:
  - the **fine** octave, with face-sized cells (about 3.5 mm), at full strength up close, where it matches the face;
  - a **coarse** octave, with cells of about 1.2 cm, which takes over as the fine one fades.
  Each fades by the march's pixel cone (`aaCfg.x` × hit distance); the coarse one is weighted by what the fine one has
  lost. The body reads textured at game distances, and no octave is drawn below about a pixel. Both cell sizes are
  constants that are tuned on the owner's frames.
- **Gloss and metal skip it,** as they skip the micro-detail.
- **Off by default.** Every preset has `grain 0`; with `grain 0` the shading takes the old path, and every other
  character renders exactly as before.

## Where it lives

- **Pure data:** `material.ts` gets a `grain` field (default 0 in every preset). `compilePalette` already accepts any
  `FleshMaterial` field, so `.blob` palettes can author it with no grammar change.
- **Uniforms:** the `surfCfg*` lanes are full, so `grain` needs a new parameter (or a spare lane, if the plan finds a
  documented free one). It follows the march's positional-uniform rules in `zombie-gpu.ts`: append last, and no `:`
  inside comments in `march.wgsl.ts`'s positional lists.
- **WGSL:** a new post-hit block, hand-written like its neighbours (`march/body/blocks/post/`), spliced into
  `trace.wgsl.ts`'s post-hit chain. It goes after the face layer so it can read the face's coverage, or before it with
  the coverage passed in, whichever the existing order allows.
  - It is shared by `marchBody`, `refineBody` and the deferred `marchSurface` (all use `MARCH_TRACE_POST`).
  - It must stay post-hit and amplitude-guarded: never in `mapBody` or the walk.
- **Not covered:** settled gib chunks (`baked-chunks.ts` `chunkShade` reimplements the march's shading). They won't get
  the grain. The goblin is not an enemy, so this is noted, not built.

## How we know it is done

1. Unit tests:
   - the new block's WGSL (it is guarded on `grain > 0`; it uses `anchor`; its cell size; the face-coverage fade);
   - `material.ts`'s presets (`grain` is 0 in all of them);
   - the palette parses `grain` (mirroring the mottle palette test);
   - the goblin's palette sets it.
2. `march-golden.test.ts` re-pinned with `-u` for this deliberate shader change, and its diff reviewed.
3. `npm run blob:render-check -- goblin` exits 0.
4. **Cost:**
   - GPU frame time in the lab, before and after, within noise (the post-hit noise budget is about 0 ms);
   - cold-boot `drawOnce` against the base branch (the plan template's gate for shader changes).
5. Lab turntable before and after (kit hidden), with a close-up. **The owner looks** and decides:
   - whether the grain reads like the face;
   - whether `surfaceNoiseAmp` stays at the preview's 0.22 or comes back toward 0.06 now that the grain carries the
     texture.

## Out of scope

- Gib chunks.
- Other characters' grain values.
- Changing the face sheet.
- The first-person arms' own pit texture (`goblin-skin.ts`), which is a different look.
