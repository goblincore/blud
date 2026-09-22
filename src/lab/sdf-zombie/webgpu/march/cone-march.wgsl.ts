import { MAX_CROWD_INSTANCES } from '../crowd-records';
import { ROW_CLUSTER_BOUNDS } from './layout';
// src/lab/sdf-zombie/webgpu/march/cone-march.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): cone march, depth prepass and empty-tile gate.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { WOUND_STEP_MUL } from './layout';

/**
 * QUAD EMPTY-TILE GATE (crowd firefight task 2, 2026-09-14). True when this
 * pixel's tile header carries no entries, i.e. no instance can have a surface
 * on any ray through the tile. The quad material calls this BEFORE the
 * occ/shell/prev fetches and the march, so an empty-tile fragment discards
 * without paying the per-pixel input setup. The index formula is the SAME one
 * MARCH_TRACE_SETUP uses for its tile preload (gx/gy, floored screenUV,
 * clamp-to-grid, row-major tid.y * gx + tid.x) — march.wgsl.test.ts pins the
 * two texts together so they cannot drift.
 */
export const QUAD_TILE_EMPTY_WGSL = /* wgsl */ `fn quadTileEmpty(
  tileHdr: ptr<storage, array<vec2<u32>>, read>,
  tileCfg: vec4<f32>,
  screenUV: vec2<f32>
) -> bool {
  let gx = max(1, i32(tileCfg.y));
  let gy = max(1, i32(tileCfg.w));
  let tid = clamp(vec2<i32>(floor(screenUV * vec2<f32>(f32(gx), f32(gy)))), vec2<i32>(0, 0), vec2<i32>(gx - 1, gy - 1));
  return (*tileHdr)[tid.y * gx + tid.x].y < 1u;
}`;

// CONE MARCH — the coarse pre-pass.
//
// Runs at a fraction of the resolution and answers one question per tile: how
// far can EVERY ray in this tile travel before any of them could possibly hit
// something? The full-resolution march then starts there instead of at the
// camera, skipping the empty space in front of the body.
//
// The cone is what makes it safe. A ray marched at tile centre would report a
// distance valid only for that one ray; a neighbouring ray in the same tile
// might have geometry nearer and would tunnel straight through it. So this
// marches a CONE whose radius grows with distance to cover the tile's whole
// screen footprint, and stops as soon as the field comes within that radius.
// The result is conservative for every ray the tile covers.
//
// `coneK` is the footprint radius per unit distance: tilePixels * tan(fovY/2)
// / viewportHeight. Stepping by (d - r) rather than d is the standard cone
// march step — it is what keeps the cone outside the surface.
//
// LEVELS CHAIN, AND FINER IS WHAT HELPS. A coarser level above the first would
// only cheapen the pre-pass, which is already a fraction of the pixels; it
// would not improve the distance handed to the full march. A FINER level does,
// because coneK shrinks with tile size and a narrower cone travels further
// before it touches. So the chain runs wide to narrow — 8x8, then 2x2 — each
// starting from the last.
//
// Returns the distance, or tMax when the cone never came near anything. tMax
// is the right answer for a miss rather than zero: a cone that missed means
// every ray in the tile misses too, so there is nothing for them to skip past.
export const CONE_MARCH = /* wgsl */ `fn coneMarch(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  coneK: f32,
  startT: f32,
  perfCfg: vec4<f32>,
  inst: ptr<storage, array<vec4<f32>>, read>,
  instCfg: vec4<f32>
) -> f32 {
  // The cone pre-pass certifies "empty up to t" for the march that follows.
  // It passes noiseCfg 0 deliberately (the noise lives on the normal), but
  // wind is NOT like the noise: it moves the FIELD. A cone that marched the
  // no-wind surface would certify space the drifted cloth actually occupies
  // and the march would start inside it. Same uniform, same surface.
  loadInstance(inst, i32(instCfg.z));
  gWindDrift = gInstWind;
  gBodyAnchor = gInstAnchor;
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);
  // Chained levels: this cone begins where the coarser one stopped. Safe
  // because a NARROWER cone can only travel further than a wider one before
  // touching — which is the whole reason a second, finer level is worth
  // running at all.
  var t = clamp(startT, 0.0, tMax);
  for (var i = 0; i < 64; i = i + 1) {
    // 0.0 for the noise: it lives on the normal now, not in the field. The
    // pre-pass must see the same field the march does, or the distance it
    // certifies as empty is not a distance the march can trust. The noise
    // shift is irrelevant at amplitude 0 (mapBody short-circuits the fbm), so
    // the zero vector keeps this pass independent of the motion plumbing.
    // The volume block rides along for the same reason (X1.26): a cone that
    // ignored an enabled volume would certify empty space inside the hand.
    let d = mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x;
    let r = t * coneK;
    // + woundCfg2.z (shell displacement, X1.21.2): the emptiness this pass
    // certifies is measured against the SMOOTH field, but the shell displaces
    // the real surface OUTWARD by up to ~0.9 amp wherever the fbm dips. A
    // bump standing proud of the smooth surface can sit CLOSER to the camera
    // than the distance this pass proved empty, so a march started there
    // skips its crest whole — hard-edged pale tile-shaped patches across
    // shoulders and arms, because the miss is per tile. Stopping one amp
    // early hands that band back to the full march, which walks it
    // conservative and hits the bumps properly. Zero when the shell is off,
    // so the undisplaced behaviour is bit-identical.
    if (d < r + 0.0012 + woundCfg2.z) { return t; }
    t = t + max(d - r, 0.0005) * marchCfg.y;
    if (t > tMax) { return tMax; }
  }
  return t;
}`;

// QUARTER-RESOLUTION DEPTH PREPASS (close-up task 3) — the coarse march the
// full-resolution ray starts from. Same construction as coneMarch, at 4x4
// SDF-pixel granularity instead of 8x8 tiles, with the cone radius sized to
// the BLOCK's half-diagonal angular footprint rather than the tile's:
//
// A coarse texel's ray stands in for every full-resolution ray through its
// 4x4 block. Any such ray differs from the coarse ray in direction by at
// most the block's half-diagonal angle, so its point at parameter s lies
// within s * blockK of the coarse ray's point at s. March the coarse ray
// with a cone of EXACTLY that radius (steps of d - r keep the whole cone
// outside the surface) and the first touch t_first is a lower bound on the
// first hit of EVERY ray in the block — if some block ray hit the surface at
// s, its hit point would be within r(s) of the coarse point at s, and the
// cone would have stopped at or before s. Starting there cannot start past
// any block ray's own surface. That proof is why the radius is the
// half-diagonal 2*sqrt(2) SDF pixels, not one coarse texel — the corner
// pixels of the block are that far from the texel centre.
//
// Runs per body on the body's own proxy box (BackSide, like the cone twins),
// into a shared float target whose hardware depth test (frag_depth set to
// the touch distance) resolves OVERLAPPING proxy boxes to the NEAREST touch
// — the one value that is safe for every body whose box covers the pixel.
// The full march then takes max(startT, shellIn, coarseStart) at its ray
// start — the max of three lower bounds is the tightest of them and still a
// lower bound.
//
// Returns the first-touch distance, or -1.0 on a miss (the ray walked out of
// the proxy box or ran out of iterations without touching — the consumer
// reads <= 0 as "no start", which is the conservative identity). The -1
// rather than coneMarch's tMax convention: a miss here must contribute
// NOTHING, where coneMarch's caller wants tMax as the ray's own terminal.
// The shell-displacement amp rides the touch test exactly as coneMarch's
// does (a bump standing proud of the smooth field can sit nearer the camera
// than the proved-empty distance), and the wind drift moves the FIELD so it
// rides too — same reasons, same two uniforms.
export const DEPTH_PREPASS_MARCH = /* wgsl */ `fn depthPrepassMarch(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  depthPreCfg: vec4<f32>,
  perfCfg: vec4<f32>,
  inst: ptr<storage, array<vec4<f32>>, read>,
  instCfg: vec4<f32>,
  aaCfg: vec4<f32>
) -> f32 {
  // QUAD DISPATCH (stage a-2). A quad-mode crowd draws ONE screen quad and
  // hands this entry the reconstructed pixel ray as worldPos, so the coarse
  // walk runs against the union field. This entry has no tile list to take a
  // sphere entry from, so the walk stays conservative from t = 0; an empty
  // pixel returns -1, which DEPTH_PRE_FETCH reads as the no-start identity.
  // Every per-body caller is unchanged: there worldPos is the proxy-box
  // fragment position and no quad branch is reachable.
  loadInstance(inst, i32(instCfg.z));
  gWindDrift = gInstWind;
  gBodyAnchor = gInstAnchor;
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);
  // MISS CULL (depthPreCfg.z, 2026-09-22). With it on, a coarse walk that gets
  // past tFar without touching CERTIFIES that no ray in the block can hit this
  // body: every surface point lies in some cluster bound sphere (the fold's own
  // cull contract), so a block ray hitting at s has s <= |c - cam| + r for that
  // cluster, and the cone proves emptiness out to t for every block ray. The
  // margin covers the shell displacement and the rim bumps the spheres do not.
  // Returns -2 (the MISS sentinel) there. Leaving the proxy box (tMax) no longer
  // ends the walk — a neighbouring block ray exits the box elsewhere.
  let missCull = depthPreCfg.z > 0.5;
  var tFar = tMax;
  var t = 0.0;
  if (missCull) {
    // CONE vs CLUSTER SPHERES, before any field evaluation (2026-09-22 levers).
    // The block's rays lie in a cone of half-angle atan(k) around rd, apex at the
    // camera. A sphere (centre c, radius R, margin-inflated) at distance D subtends
    // asin(R / D); the cone misses it iff the angle between rd and (c - cam)
    // exceeds atan(k) + asin(R / D). Every surface lies inside some sphere, so a
    // cone that misses them all certifies the block empty for this body with no
    // walk at all. Otherwise the walk starts at the nearest reachable sphere:
    // along any block ray a point at s is at least D - s from c, and a block ray
    // strays at most k * s from the coarse one, so nothing is reachable before
    // (D - R) / (1 + k). The far bound stays the farthest reachable D + R.
    let k = depthPreCfg.y;
    let coneA = atan(k);
    var tNear = 1e9;
    tFar = 0.0;
    var reach = false;
    // EVERY instance the field folds: mapBody walks slots base + s for s < instCfg.x
    // (a crowd box's prepass sees the whole type's union), so the spheres must too —
    // testing only the loaded slot certified blocks empty for bodies it never looked at.
    let nInst = i32(instCfg.x);
    let base = i32(instCfg.z);
    for (var s = 0; s < ${MAX_CROWD_INSTANCES}; s = s + 1) {
      if (s >= nInst) { break; }
      loadInstance(inst, base + s);
      if (gInstAlive < 0.5) { continue; }
      for (var c = 0; c < 8; c = c + 1) {
        if (c >= i32(gInstCounts.y)) { break; }
        let cb = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS} + gBand), 0);
        let R = cb.w + 0.05 + woundCfg2.z;
        let v = cb.xyz - camPos;
        let D = length(v);
        if (D > R) {
          let ang = acos(clamp(dot(v, rd) / D, -1.0, 1.0));
          if (ang > coneA + asin(clamp(R / D, 0.0, 1.0))) { continue; }
          tNear = min(tNear, (D - R) / (1.0 + k));
        } else {
          tNear = 0.0;
        }
        reach = true;
        tFar = max(tFar, D + R);
      }
    }
    if (!reach) { return -2.0; }
    t = max(tNear, 0.0);
  }
  for (var i = 0; i < 64; i = i + 1) {
    // The FULL field (noiseCfg 0, full cluster list, no tile binning) — the
    // same conservative choice the cone pre-pass makes. The full march may
    // run a per-pixel TILE list whose field is LARGER than this one (culling
    // a prim from a min-fold can only raise the field), so a distance proven
    // empty against the full field is empty against every tile-listed
    // sub-field too.
    let dres = mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
    let d = dres.x;
    let r = t * depthPreCfg.y;
    // With the miss cull on, "no touch" must also mean "no block ray ACCEPTS a hit":
    // the full march accepts d < max(hitEpsBase, t * aaK / distort) (distort >= 1),
    // so a ray grazing a silhouette within that epsilon counts as a hit without
    // crossing the surface. Widen the touch by the same worst case. Off: unchanged.
    let acceptEps = select(0.0012, max(max(0.0012, woundCfg2.w), t * aaCfg.x * aaCfg.y), depthPreCfg.z > 0.5);
    if (d < r + acceptEps + woundCfg2.z) { return t; }
    // Near a wound the field is not a distance bound (the smax fillet
    // overstates), so the coarse walk uses the SAME step multiplier the full
    // march does near craters — woundMul, with the perfCfg.z override. The
    // shipped game value is 1.0 (owner look verdict, 426b55e); the A/B seam
    // setWoundStep carries over to this pass unchanged.
    let nearWound = dres.z > 0.5;
    let woundMul = select(${WOUND_STEP_MUL}, perfCfg.z, perfCfg.z > 0.0);
    let stepMul = select(marchCfg.y, woundMul, nearWound);
    t = t + max(d - r, 0.0005) * stepMul;
    if (missCull) {
      if (t > tFar) { return -2.0; }
    } else if (t > tMax) { return -1.0; }
  }
  // Out of iterations: UNKNOWN (-1), never a certified miss.
  return -1.0;
}`;

// Quarter-res depth prepass fetch (close-up task 3). NEAREST texel of the
// 4x4 block this SDF pixel falls in — never interpolated, same rule as
// coneFetch — because an average of two block starts is a start neither
// block proved. ZERO is "no start" and covers three cases — pass disabled,
// no coarse ray touched anything in this block, and a recorded touch at or
// below zero — so the consumer's max() folds to the identity on all three.
// Grid size comes from textureDimensions, never a captured uniform (the
// adaptive controller resizes the layer under this pass at runtime).
// MISS CULL fetch (2026-09-22): true when this pixel's 4x4 block holds the MISS
// sentinel (-2) — every body whose (dilated) prepass proxy covers the block
// certified a miss, since any touch (t > 0) or unknown (-1, written at depth 0)
// wins the depth test over a miss (written at the far end). Off when the pass or
// the cull is disabled, and in quad dispatch (no per-body prepass boxes there).
export const DEPTH_PRE_MISS = /* wgsl */ `fn depthPreMiss(
  tex: texture_2d<f32>,
  screenUV: vec2<f32>,
  cfg: vec4<f32>
) -> bool {
  if (cfg.x < 0.5 || cfg.z < 0.5) { return false; }
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(tex, c, 0).x < -1.5;
}`;

export const DEPTH_PRE_FETCH = /* wgsl */ `fn depthPreFetch(
  tex: texture_2d<f32>,
  screenUV: vec2<f32>,
  cfg: vec4<f32>
) -> f32 {
  if (cfg.x < 0.5) { return 0.0; }
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let v = textureLoad(tex, c, 0).x;
  if (v <= 0.0) { return 0.0; }
  return v;
}`;
