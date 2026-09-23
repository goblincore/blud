# Body motion vectors — plan (2026-09-22)

**Why.** The owner wants to revisit temporal accumulation at a lower march resolution (0.25 is −38 % `sdf:march`,
measured 2026-09-22; see HYBRID-TIMING-PLAN.md). The 2026-09-10 attempt (PASSOFF-3.md) failed in motion because it
reprojected with the CAMERA only. With a still camera, a moving limb's history is fetched from the same screen spot,
which holds the body's OLD pose, and the only guard was "is this pixel flesh now?". So past poses stacked inside
the current silhouette ("its trapped within the body"). The standard fix is per-pixel object motion vectors, plus
a validity test and neighbourhood clamping. This plan covers the motion vectors (step 1 of 3).

## How the motion vector is computed (no new bindings)

- The march hit point `p` is in WORLD space, and so are the prim rows (`restPoint` uses `p - midP` directly).
- After the hit, the march already computes `anchor = restPoint(p, data, hitBest, …)`: the point in the hit prim's
  REST frame, built from the current `PRIM_A/B` and `PRIM_QUAT` plus the constant `REST_A/B`.
- Running that map backwards with LAST frame's `PRIM_A/B/QUAT` gives where the same surface point was last frame:
  `prevP = prevMid + qRot(conj(qPrev), anchor − midR)`. Object motion = `prevP − p`, in world metres. Camera motion is
  added later, in the accumulation resolve, which already has a previous view-projection (`uAccumPrevVp`).
- Last frame's rows live in **three new rows of the existing data texture**: `ROW_PREV_A` 22, `ROW_PREV_B` 23,
  `ROW_PREV_QUAT` 24 (`DATA_ROWS` 22 → 25). No new texture binding, so the positional-uniform order and the
  TextureNode-uuid traps are avoided. Every consumer already derives band offsets from `DATA_ROWS`.
- `PREV_A.w = 1` marks the prev rows valid. Gib chunks never write them (w = 0), which reads as "no motion
  vector", and so does a body whose prim count changed (sever / respawn) on its first frame.
- The per-body packer (`zombie-gpu.ts upload()`) advances prev ← current only on the per-frame `update()` path.
  Re-packs from setters (bone cull, rebind) keep prev, so a frozen frame reads zero motion.

## Steps

1. **Motion vectors + debug view (this step).** The rows, the packer, the WGSL inverse (`prevPosed`, beside
   `restPoint`), and debug mode 16: object motion as colour (grey = still, magenta = no valid prev). Owner check:
   limbs light up in the direction they swing, and a static body is flat grey. Cost: one cold compile.
   `march-golden` is unaffected (the ship path is not changed; mode 16 is off).
2. **Accumulation v2.** A motion-vector MRT attachment behind a flag, and the resolve reprojects by camera + object
   motion. History is rejected on depth / prim mismatch and neighbourhood-clamped. History buffers are swapped,
   not copied (the 2026-09-10 "performance really tanks" was a full-res RGBA32F copy per frame). Owner looks at it
   in motion at 0.5 first.
3. **0.25 + accumulation**, timed on the melee bench, then owner A/B in play.
