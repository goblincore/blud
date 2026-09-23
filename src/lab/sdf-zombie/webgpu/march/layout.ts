// src/lab/sdf-zombie/webgpu/march/layout.ts
//
// Data-texture row layout, group capacity, culling slack and the CPU face
// damage mirror — split out of march.wgsl.ts (phase 1, move-only). Pure TS,
// no WGSL. Imported by the barrel and by the WGSL helper modules.

/** Extra metres added to the per-ray tile sphere test (tileCfg.x == 2) so the
 *  off-ray shading probes — calcNormal's 0.0015 eps and the AO probe at
 *  n * 0.06 — still see every group the ray's own march did. */
export const RAY_CULL_SLACK = '0.07';
/** Extra metres added to the QUAD-dispatch entry sphere (stage a-2). The sphere
 *  already carries blendReach x distortion; this covers the smin support's
 *  outward bulge so a ray that just grazes a body still enters before its
 *  surface. It widens `t` only — a conservative lower bound, never a miss. */
export const QUAD_ENTRY_SLACK = '0.02';

export const DATA_ROWS = 25;
export const ROW_PRIM_A = 0;
export const ROW_PRIM_B = 1;
export const ROW_PRIM_SCALE = 2;
export const ROW_CLUSTER_BOUNDS = 3;
export const ROW_CLUSTER_RANGE = 4;
export const ROW_WOUND = 5;
export const ROW_WOUND_META = 6;
/** Wound carve depth-slab (2026-08-27): xyz = INWARD unit normal at the
 *  stamp (prim-local frame rotated out by the uploader), w = max carve depth
 *  below the anchor plane, metres. w <= 0 = uncapped — APPLY_WOUNDS then
 *  carves the plain sphere, bit-identical to the pre-slab field (the max()
 *  with `-1e5` selects the sphere term exactly), which is what keeps the
 *  LAB (which uploads no caps) pixel-stable across this change. */
export const ROW_WOUND_CAP = 18;
/** Per-wound flags (entrails, 2026-09-02): x = 1 when this wound opened a
 *  CAVITY, 0 otherwise; y = owning cluster + 1 (0 = unscoped),
 *  zw = owning flesh primitive span [start, end).
 *
 *  A new row rather than a bit on wMeta because wMeta is full — x type,
 *  y age, z splayScale, w offsetScale — and rather than a new code on
 *  `type`, because the shader tests types with unbounded comparisons
 *  (`isBurn = wMeta.x > 1.5`) that a fourth code would silently break. One
 *  row costs MAX_PRIMS * 16 bytes = 2 KiB per body. */
export const ROW_WOUND_FLAGS = 19;

/** CPU mirror for the damaged Soldier decal's luminance-only shadow mask. */
export function soldierFaceDamageShadow(luma:number,mean:number,woundMask:number,soldier:number):number {
  const clamp=(v:number)=>Math.max(0,Math.min(1,v));
  const t=clamp((woundMask-.02)/.60),w=t*t*(3-2*t);
  return clamp(1-luma/Math.max(mean,1e-3))*w*clamp(soldier);
}
export const ROW_PRIM_QUAT = 7;
export const ROW_REST_A = 8;
export const ROW_REST_B = 9;
export const ROW_PRIM_SHAPE = 10;
export const ROW_PRIM_BEND = 11;
/** xyz linear albedo, w = 1 + gloss; w = 0 means "flesh". See pack.ts. */
export const ROW_PRIM_COLOR = 12;
/** Bound groups (pack.ts boundGroups): the fold's cull unit, finer than a
 *  cluster. BOUNDS xyz centre, w radius; RANGE x start, y count (0 = end of
 *  list), z alive, w flag bitfield as ROW_CLUSTER_RANGE.w. */
export const ROW_GROUP_BOUNDS = 13;
export const ROW_GROUP_RANGE = 14;
/** Group list capacity = one per prim at worst; the texture is MAX_PRIMS wide. */
export const MAX_GROUPS = 128;
/** Per-cluster span into the group list: x = first group, y = group count. */
export const ROW_CLUSTER_GROUPS = 15;
/** `shell` construction (2048-08-25): x = half-thickness, y = rim radius,
 *  z = clip offset, w = hasClip (0/1). Read only by prims with a shell fold
 *  (profile bit 2 set — see ROW_PRIM_SHAPE's `prof`). */
export const ROW_PRIM_SHELL = 16;
/** `shell` clip plane: xyz = unit normal; w = per-prim emissive `glow=`
 *  0..1 (hard-surface task 3), packed on BOTH the shell and plain branches —
 *  the glow COLOUR is the prim's own ROW_PRIM_COLOR albedo, so the lane is
 *  inert (w = 0) unless the author writes `glow=`. See ROW_PRIM_SHELL. */
export const ROW_PRIM_CLIP = 17;
/** WRINKLES (shell cloth spike): x = warp amplitude in metres,
 *  yzw = per-axis frequency in radians per metre. Read only by prims with a
 *  shell fold, and only when the amplitude and the frequency are both
 *  non-zero — a shell authored without
 *  `warp=` packs zeros here and takes the untouched branch in sdShell, which
 *  is why every existing character is bit-identical across this row's
 *  arrival.
 *
 *  Its OWN row rather than a lane on ROW_PRIM_SHELL: that row is full
 *  (x thickness, y rim, z clip offset, w hasClip) and w is genuinely read —
 *  `hasClip < 0.5` is an early return in sdShell — even though pack.ts
 *  happens to write 1 there for every shell today. Aliasing a lane that is
 *  constant by accident rather than by contract is how the box/shell profile
 *  bit went wrong. One row costs MAX_PRIMS * 16 bytes = 2 KiB per body, the
 *  same bargain ROW_WOUND_FLAGS took. */
export const ROW_PRIM_WARP = 20;
/** Strand bundle parameters (hairlock, 2026-09-05): x = strand count,
 *  y = wave (wobble amplitude, fraction of cell), z = cycles, w = fat
 *  (strand diameter as a fraction of the cell). Read only where the prim's
 *  profile carries bit 5 (value 32). The CPU mirror of everything this row
 *  drives is strand.ts; see its header for the construction and the
 *  Lipschitz argument.
 *
 *  21, NOT 20: hairlock and the shell cloth spike each added "the next row"
 *  on their own branch and both landed on 20. A textual merge would have
 *  reported success with two names for one row — every warped shell reading
 *  the strand bundle's parameters as its wrinkle frequency. Same class as
 *  the meltCfg collision the noiseCfg comment records. */
export const ROW_PRIM_STRAND = 21;

/** MOTION VECTORS (2026-09-22, docs/dev-notes/2026-09-22-cost-census/MOTION-VECTORS-PLAN.md):
 *  LAST frame's ROW_PRIM_A / ROW_PRIM_B / ROW_PRIM_QUAT, written by the per-body packer
 *  (zombie-gpu upload(): prev advances only on the per-frame update path). `prevPosed` in
 *  march/fields/carves.wgsl.ts inverts `restPoint` with them to find where a hit surface point was
 *  last frame. ROW_PREV_A.w = 1 marks the rows VALID; 0 (gib chunks, which never write them, and a
 *  body's first frame after its prim count changed) means "no motion vector". Only xyz of A/B is
 *  used — the current rows' w (radius, blendK) is not motion. Read by nothing on the ship path. */
export const ROW_PREV_A = 22;
export const ROW_PREV_B = 23;
export const ROW_PREV_QUAT = 24;

/**
 * Sphere-trace step multiplier inside applyWounds' nearWound zone.
 *
 * The wounded field is NOT a distance bound — the smax fillet overstates, the
 * lip understates, and `rimLocal` ties the lip's amplitude to the pre-wound
 * field so the two move together — and a step of `mul * d` only stays outside
 * the surface while `mul <= 1 / max|grad d|`. Measured (march-step-soundness
 * test, planar flesh, shipped rim constants): a single stock blast wound
 * reaches |grad| 2.06 and a single pellet 2.09, so the largest sound
 * multiplier is ~0.48 — for ONE wound. Overlapping craters compound through
 * the sequential per-wound loop: a blast plus a six-pellet spread measured
 * 3.92, i.e. 0.26.
 *
 * IT STAYS AT 0.6, WHICH IS ABOVE THAT BOUND, AND THAT IS A DECISION — not an
 * oversight, which is what it was until 2026-09-04, when it shared the literal
 * with the shell's under-relaxation and had never been checked against a
 * crater. The owner A/B'd 0.6 against 0.4 on screen (`setWoundStep`, below)
 * and could not tell them apart, so the frame budget wins. Everything below is
 * what that costs, so the next person can re-take the decision with the
 * numbers instead of re-deriving them.
 *
 * WHAT 0.6 LOOKS LIKE, counted over every pixel of a real frame on a torso
 * carrying a blast + a six-pellet spread (game settings: omega 1.0, AA 1.0,
 * outer-hull start, cone off):
 *
 *            mis-shaded px   of hits   normals > 45 deg wrong
 *   1.5 m        10731        4.32%
 *   2.5 m         2903        2.16%            686
 *   4.0 m          649        0.97%
 *
 * "Mis-shaded" = the march accepted a sample further behind the first
 * crossing than the hit epsilon, so the pixel takes its normal from inside
 * the carve blend and its tissue-ramp depth from up to 13.7 mm too deep —
 * far enough to shift a patch a whole band down fat -> muscle -> clot. They
 * are CONTIGUOUS (99% have an affected 4-neighbour), and STABLE: turning the
 * camera 0.23 degrees keeps 2892 of 2903. A stable wrong patch inside a
 * crater reads as "that is what the crater looks like", which is why this sat
 * unreported for as long as it did.
 *
 * ONE WOUND IS FINE at any of these values — a single stock blast produced
 * zero mis-shaded pixels at every range. This is a STACKING artifact; it
 * needs a body someone emptied a shotgun into.
 *
 * WHAT FIXING IT WOULD COST. The zone is large (r < 2 * wound radius), so the
 * ray pays over its whole approach, not just at the lip. Marched pixels only,
 * on that same shotgunned body, against 0.6:
 *
 *          extra march steps (2 m / 4 m / 8 m)   what it removes
 *   0.4          +23% / +18% / +16%              every > 45 deg error, 92% of the pixels
 *   0.3          +45% / +36% / +32%              all of them, at both ranges measured
 *
 * Unwounded bodies are untouched at any value — nothing raises nearWound —
 * and hit counts are unchanged, so nothing drops out of the image. Flip it
 * live with `__sdfGame.setWoundStep(0.4)` / `__sdfLab.setWoundStep(0.4)`
 * (perfCfg.z, see the marchBody loop; 0 = this constant). If it is ever worth
 * paying for, the cheap direction is a SMALLER zone or a per-sample count of
 * overlapping wounds — not a longer step.
 *
 * (Moved ABOVE the depth-prepass fn, close-up task 3: both template literals
 * interpolate it, and a const used before declaration is a TS error.)
 */
export const WOUND_STEP_MUL = 0.6;
