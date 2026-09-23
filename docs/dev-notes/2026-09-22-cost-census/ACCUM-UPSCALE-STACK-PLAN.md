# Accumulation → t16 stack — plan (2026-09-23)

**Owner verdict that sets the direction.** Accumulation v2 at 0.5 (object motion, depth validity, clamp;
commit 18292bcc) removed the old ghost smearing ("the v2 version is great"), but on its own it is worse than
today's 0.5 + t16 upscaler: "better than raw 0.5 but still has jaggies and is soft". So accumulation must feed
the upscaler, not replace it. The owner agreed to try t16 on top.

**Goal.** Today's picture (a 0.5 frame through t16) at a **0.25 march** (−38 % `sdf:march`, 6.0 vs 9.8 ms in
the melee crush, 2026-09-22).

## Idea: rebuild an exact 0.5 frame from four 0.25 frames

Every 2×2 block of the 0.5 grid (400×300) sits under one texel of the 0.25 grid (200×150). Jitter the 0.25
march through the **four 2×2 sub-positions in a fixed order**, not a Halton sequence. Each frame then marches,
exactly, one quarter of the 0.5 pixels: the same ray, depth and colour a 0.5 march would produce there. After
four frames of a still surface, every 0.5 pixel holds a real 0.5 sample. This is checkerboard/ordered-grid
reconstruction. It differs from v1 accumulation, which blended jittered samples into an output-resolution
history, so it averages nothing and blurs nothing.

- **History: 400×300** (the 0.5 grid t16 already consumes), rgb + clip depth. Also a per-pixel **age** (frames
  since this pixel's last direct sample) so stale pixels can be treated differently.
- **Pixels sampled this frame** (1 in 4) take the fresh sample outright: colour, depth, hit or miss.
- **The other 3 in 4** are reprojected. They have no ray of their own this frame, so they borrow depth and
  object motion from the nearest current 0.25 sample (the standard checkerboard trick), reproject with camera +
  object motion (v2), and fetch history. That history is validated by depth, prim-seam and clamp, as in v2.
  If it fails, the pixel falls back to the current 0.25 sample (bilinear colour, nearest coverage), i.e.
  today's 0.25 look for that pixel for up to 3 frames.
- **Silhouettes (the hard part).** v1/v2 took coverage from the CURRENT frame's nearest coarse sample. At 0.25
  that coverage is blocky and jumps with the jitter, and t16 would sharpen the jumps into flickering edges. Here
  each 0.5 pixel carries its OWN coverage from its last direct sample, reprojected. Where the current 3×3
  coarse neighbourhood is all miss or all hit, the neighbourhood decides; only in the mixed silhouette band
  does the history's per-pixel coverage decide. That is the band that rebuilds a 0.5-quality edge.
- **t16 input = the accumulated 400×300 image**, unjittered by construction (history lives on the fixed 0.5
  grid). The upscale stage today reads the march target; point it at the history instead. Composite unchanged.

## Cost (estimate, to be measured)

`march(0.25) 6.0 + stack resolve at 400×300 (a quarter of v1's full-res pass) + 1.9 MB history copy + t16 ~0.6`
vs `ship 9.8 + 0.6`. Measured input: the queued melee run times v2 accumulation at 0.25 (`sdf:accum` pass +
frame) — an upper bound for the 400×300 resolve.

## Risks the owner should judge in motion

- Fast limbs and camera whips: up to 3 of 4 pixels fall back to the 0.25 sample for a few frames there. Motion
  blur and VHS mask it; the question is whether t16 turns it into visible edge crawl.
- Wounds appearing (instant geometry change): depth validity rejects history and they rebuild over 4 frames.

## Steps

1. Ordered 2×2 jitter + 400×300 history + checkerboard resolve (sampled / reprojected / fallback), behind a
   flag; debug view of pixel age. Owner check: a still body at 0.25 matches a 0.5 march.
2. Feed t16 from the history (lift the "stacking is P5" refusal for this path). Owner A/B in motion against
   today's ship.
3. Melee timing, stack vs ship, quiet machine.
