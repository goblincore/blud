// src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): wound field, mask and shadow.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { ROW_WOUND, ROW_WOUND_CAP, ROW_WOUND_FLAGS, ROW_WOUND_META } from '../layout';

// Carves every wound out of the field. Burns barely subtract; they char.
//
// woundCfg  = (count, blendK, rimSplay, rimOffset)
// woundCfg2 = (rimWidth, relax, shellAmp, spare) — y and z are consumed by
//             MARCH_BODY, not here; see the woundCfg2 note at the entry point.
// Returns (field, nearWound). nearWound is 1 within twice a wound's radius —
// crater, lip and a margin — where the field is NOT a distance bound (the
// smax fillet overstates distance, the lip understates it), so the relaxed
// march must step plain there or its overshoot test misfires and the crater
// floor comes out in depth bands (the dark streaks across the cyclops's
// craters, 2026-08-23: gone at relax 1.0, back at 1.4).
//
// SEQUENTIAL per-wound smax + bump, the 2026-08-22 form — deliberately
// (owner bisect parity, 2026-08-24). The 2026-08-23 smin-union-then-one-smax
// rework smoothed overlapping craters into one cavity, but the owner-judged
// reference build carves sequentially, and after every other 2026-08-23
// change was walked back this was the last geometric delta standing. If the
// overlap ridge returns as a complaint, re-derive the union against THIS
// baseline with the owner judging, one change at a time.
// WOUND-BOUND CULL (close-up wound-cull task, 2026-09-05): woundBound is the
// bounding sphere of every wound's REACH (xyz centre, w radius), computed on
// the CPU at upload time from the SAME uniforms the reach formula below reads
// (zombie-gpu.ts woundReachBound; w = 1e9 is the no-cull identity the chunk
// and hands views keep). A sample outside it is outside EVERY per-wound reach
// sphere, so every loop iteration would hit the early-out `continue` — the
// early return is bit-identical to running the loop: d unchanged, near 0.
export const APPLY_WOUNDS = /* wgsl */ `fn applyWounds(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32>, band: i32) -> vec2<f32> {
  var d = dIn;
  var near = 0.0;
  // One sphere test before the loop replaces up to 16 wound-row loads plus a
  // length() each, on every mapBody evaluation, for every sample nowhere near
  // a crater. Tested BEFORE the loop (pinned by test): the whole point is
  // that a far sample pays nothing per-wound.
  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }
  let n = i32(gInstWoundCount);
  // PER-RAY WOUND LIST (counts2.w gate, 2026-09-07): with the gate ON the
  // loop iterates only the preloaded reachable set; with it OFF this is the
  // same iteration sequence as before (k == i, same break on n), so OFF is
  // bit-identical to the shipped shader.
  for (var k = 0; k < 16; k = k + 1) {
    var i = k;
    if (gWoundListOn > 0.5) {
      if (k >= gWoundN) { break; }
      i = gWoundList[k];
    } else {
      if (k >= n) { break; }
    }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND} + band), 0);
    let r = length(p - w.xyz);
    // Reach of this wound's influence, beyond which the carve, the fillet
    // and the rim bump all contribute exactly nothing (see the test):
    //   crater .......... r < depth <= w.w, and nearWound at 2 depth
    //   smax fillet ..... quadratic smin is exactly min once |a-b| >= 4k;
    //                     a-b here is (r - depth) + d, and d >= -0.25 inside
    //                     any limb this game has
    //   rim bump ........ exp(-x^2) at x >= 3 is 1.2e-4 of amp — sub-micron
    // Skipping here saves the two texel loads below and every op after them
    // for every wound the sample is nowhere near — which, per march step,
    // is all of them but one. (perfCfg.y seam, game page ON; lab default 0
    // keeps its reference bit-identical.)
    // EXACT REACH (gWoundExact, 2026-09-21): the fillet is live only while
    // r < depth - d + 4k, so the constant 0.25 (a bound on -d inside any limb)
    // can be the running -d itself. Surface and outside samples (d >= 0) then
    // drop every row whose crater and rim are out of range. Off = ship.
    let slack = select(0.25, max(0.0, -d), gWoundExact > 0.5);
    let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + slack;
    if (perfCfg.y > 0.5 && r > reach) { continue; }
    if (gDebugMode > 0.5) { gDebugWoundRows = gDebugWoundRows + 1.0; }
    let wFlags = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_FLAGS} + band), 0);
    let owner = wFlags.y;
    // THREAT MASK (2026-09-21): the fraction of flags.x is a CPU-computed bitfield
    // over 1024 — bit c+1 set when cluster c is NOT this wound's owner and
    // some prim group of it reaches this wound's carve bowl (zombie-gpu.ts
    // woundThreatMasks). The cavity readers test x > 0.5 and the fraction
    // stays below 0.5, so they are untouched. Zero when no view wrote it.
    let threat = u32(fract(wFlags.x) * 1024.0 + 0.5);
    if (gWoundCluster > 0.0 && owner > 0.0 && owner != gWoundCluster) { continue; }
    if (owner > 0.0) { gWoundOwners = gWoundOwners | (1u << u32(owner)); }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META} + band), 0);
    // Depth slab (2026-08-27): the sphere stays centred on the uploaded
    // anchor — the lab's deep bowl — and is clipped by a plane through the
    // anchor facing inward, at most wCap.w deep. The carve region is the
    // CONVEX INTERSECTION {inside sphere} ∩ {shallower than the cap}; its
    // inside-positive SDF is -max(sphereSDF, slabSDF) = min(depth - r,
    // capEff - dot). The sign of the dot term matters more than it looks:
    // a dot - capEff term is positive BEYOND the cap, so a max() with that
    // form kept the term positive across the entire half-space behind the
    // kept the term positive across the entire half-space behind the cap
    // plane — every wound silently deleted all flesh deeper than its cap,
    // out to infinity, and a body with wounds from mixed directions (the
    // shotgun) lost whole quadrants of itself while a single wound looked
    // perfect from the front. That regression is why whole zombies went
    // invisible on 2026-08-27. With min(depth - r, capEff - dot) the carve
    // is a bounded bowl: shallow+inside carves, beyond the cap flesh
    // remains, outside the sphere nothing changes. With wCap.w <= 0
    // (uncapped: the lab uploads no caps, old wounds, chunk torn-ends) the
    // 1e5 term loses the min for any real distance, so the carve is
    // BIT-IDENTICAL to the pre-slab sphere — that is what keeps the lab
    // reference stable.
    let wCap = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP} + band), 0);
    let capEff = select(1.0e5, wCap.w, wCap.w > 0.0);
    // Bounded torso preview: a fixed sphere recipe, with its owner's depth
    // cap. Negative type is upload-only; stock gameplay types remain 0..2.
    if (wMeta.x < -0.5) {
      let dPre = d;
      d = max(d, min(w.w - r, capEff - dot(p - w.xyz, wCap.xyz)));
      if (d > dPre) { gWoundRaisers = gWoundRaisers | (1u << u32(owner)); gWoundThreat = gWoundThreat | threat; }
      if (r < w.w * 2.0) { near = 1.0; }
      continue;
    }
    let isBurn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), isBurn);
    // RAGGED CRATER (option 3, 2026-09-21): the fraction of the type texel is
    // how far the edge may grow, by direction, in place of the three lobe rows
    // a soldier wound used to upload. rN = r / s with s = 1 + A * n(dir) in
    // [1, 1 + A]: the zero set is r = depth * s, and the rim follows it. The
    // direction is taken in the BODY frame (gInstYaw) so the lobes turn with
    // the body, seeded by the radius so neighbours differ. The carve term is
    // scaled by 0.75 because an angularly varying radius steepens the field
    // (slope ~ sqrt(1 + (A * 1.8 * 1.5)^2) = 1.3 at A = 0.3); the zero set is
    // unchanged by the scale. Every reach bound stays valid: s <= 1.45 < 2.
    // A = 0 (every round wound) takes rN = r, carveK = 1 — bit-identical.
    let ragged = select(0.0, fract(wMeta.x), wMeta.x > -0.5 && !isBurn);
    var rN = r;
    var carveK = 1.0;
    if (ragged > 0.0) {
      let v = (p - w.xyz) / max(r, 1e-6);
      let cy = cos(gInstYaw);
      let sy = sin(gInstYaw);
      let q = vec3<f32>(cy * v.x - sy * v.z, v.y, sy * v.x + cy * v.z);
      let n = noise3(q * 1.8 + vec3<f32>(w.w * 917.0, w.w * 413.0, w.w * 211.0)) * 0.5 + 0.5;
      rN = r / (1.0 + ragged * n);
      carveK = 0.75;
    }
    let dBefore = d;
    d = smax(d, min(-(rN - depth) * carveK, capEff - dot(p - w.xyz, wCap.xyz)), woundCfg.y);
    // Which owners' carves actually RAISED the field here — see the owner
    // re-fold's raiser gate in MAP_BODY. Bit 0 collects unowned wounds.
    if (d > dBefore) { gWoundRaisers = gWoundRaisers | (1u << u32(owner)); gWoundThreat = gWoundThreat | threat; }
    if (rN < depth * 2.0) { near = 1.0; }
    let x = (rN - depth * woundCfg.w * wMeta.w) / max(depth * woundCfg2.x, 1e-4);
    let amp = depth * woundCfg.z * wMeta.z * select(1.0, 0.25, isBurn);
    // Own-amp bound for the re-fold pre-scan (MAP_BODY): the most this
    // row's bump can LOWER a field, filed under its owner (0 = unowned).
    if (gWoundCluster == 0.0) { gWoundAmp[u32(owner)] = gWoundAmp[u32(owner)] + amp; }
    let rimLocal = 1.0 - smoothstep(-amp * 0.3, amp * 0.7, dIn);
    d = d - exp(-x * x) * amp * rimLocal;
  }
  return vec2<f32>(d, near);
}
// Per-map ownership selection. 0 keeps the original whole-body carve;
// a positive cluster id restricts the independent limb field below.
var<private> gWoundCluster: f32 = 0.0;
var<private> gWoundOwners: u32 = 0u;
// Owners whose carve raised the field at p since mapBody's reset.
var<private> gWoundRaisers: u32 = 0u;
// Union of the threat masks of every wound whose carve raised the field at p.
var<private> gWoundThreat: u32 = 0u;
// Exact-fix switch (counts2.z >= 8): the d-aware wound reach and the re-fold
// pre-scan. Set per slot by mapBody; 0 in every other caller = ship.
var<private> gWoundExact: f32 = 0.0;
// Set by the AO/scatter probe loop around its mapBody call (cheap probes, counts2.z + 16).
var<private> gProbePass: f32 = 0.0;
// NORMAL HINT (counts2.z + 32, 2026-09-22): the re-fold is decided ONCE per pixel.
// gRefoldWin = cluster + 1 whose re-fold won on the latest mapBody call (0 = none);
// gNormalHint >= 0 while calcNormal's taps run: re-fold only that cluster (0 = none).
var<private> gRefoldWin: f32 = 0.0;
var<private> gNormalHint: f32 = -1.0;
// Per-owner sum of rim-bump amplitudes over the rows the BASE applyWounds
// reached at p (index = owner cluster + 1, 0 = unowned).
var<private> gWoundAmp: array<f32, 9>;
// Set only for final surface shading; -1 retains unscoped chunk/volume masks.
var<private> gWoundShadePrim: f32 = -1.0;`

// 0 at the surface far from wounds, 1 deep inside one. ONE mask, shared by
// every wound shading term — the owner-decided shape of this function
// (bisect A/B, 2026-08-24). The 2026-08-23 crater pass split it three ways
// (colouring pulled in to 1.25x + a facing gate, the fresnel fade widened to
// its own 1.3x/2x mask, an AO darkening at a third radius) and THAT was the
// halo the owner chased for two days: each split mask has an edge somewhere
// on healthy skin, and wherever two edges disagree there is an annulus that
// is faded-but-not-coloured (grey ring) or coloured-but-not-faded (white
// crescent), sweeping with the camera because fresnel is view-dependent.
// The unified 1.6x mask has a footprint too — but its fade edge coincides
// with its colour gradient, so it reads as "flesh going wounded", a material
// change, not a ring. A membership-based fade (carve-field derived) was
// built and looked clean in stills, but the owner judged the restored
// unified mask decisively better in motion against every variant.
// The far-side white sheets the 2026-08-23 gates were chasing turned out to
// be the tracer overshoot bug (fixed at the retract guard above): with rays
// no longer landing inside the body, the ungated mask is safe again.
export const WOUND_MASK = /* wgsl */ `fn woundMask(p: vec3<f32>, nrm: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>) -> vec3<f32> {
  var m = 0.0;
  var cav = 0.0;
  // Per-instance wound count: the slot loop's loadInstance set this before
  // the post-hit readback (POST reloads gHitSlot).
  let n = i32(gInstWoundCount);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let flags = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_FLAGS} + gBand), 0);
    if (flags.y > 0.0 && gWoundShadePrim >= 0.0 &&
        (gWoundShadePrim < flags.z || gWoundShadePrim >= flags.w)) { continue; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND} + gBand), 0);
    // Ragged craters (see applyWounds): the footprint follows the same edge.
    let tId = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META} + gBand), 0).x;
    let ragged = select(0.0, fract(tId), tId > -0.5 && tId < 1.5);
    var rM = length(p - w.xyz);
    if (ragged > 0.0) {
      let v = (p - w.xyz) / max(rM, 1e-6);
      let cy = cos(gInstYaw);
      let sy = sin(gInstYaw);
      let q = vec3<f32>(cy * v.x - sy * v.z, v.y, sy * v.x + cy * v.z);
      rM = rM / (1.0 + ragged * (noise3(q * 1.8 + vec3<f32>(w.w * 917.0, w.w * 413.0, w.w * 211.0)) * 0.5 + 0.5));
    }
    let contribution = 1.0 - smoothstep(0.0, w.w * 1.6, rM);
    m = max(m, contribution);
    // Cavity-ness (entrails, 2026-09-02): the SAME radial footprint,
    // accumulated only over wounds whose flags row says the hit opened a
    // cavity. Deliberately NOT a second footprint — a second mask edge is
    // how the 2026-08-23 halo happened.
    if (flags.x > 0.5) { cav = max(cav, contribution); }
  }
  return vec3<f32>(m, m, cav);
}`

/**
 * Helper sources in DEPENDENCY ORDER — each one may only call those before it,
 * because WGSL requires declaration before use and three emits includes in the
 * order given.
 */
// WOUND SOFT SHADOW (iq's sphere-traced soft shadow,
// <https://iquilezles.org/articles/rsmshadows/>). A crater viewed at many
// angles still reads ambiguously as a BALL because its concave dish casts no
// shadow — the missing cue is occlusion from the crater's own wall (owner
// decision 2026-08-24: "cast shadow vs darker floor"; the shadow won).
//
//   res = min(res, k * h / t)   marched from the surface toward the light
//
// FIRED ONLY NEAR WOUNDS — the caller gates on mapBody's nearWound zone, so
// the cost scales with crater screen area, not screen size. Everywhere else
// the caller keeps shadow = 1 and pays nothing.
//
// Quality budget, chosen for a fill-bound renderer:
//   - 14 steps max (12-16 band), marching mapBody at noiseAmp 0 — same field
//     the tracer sees, no fbm cost.
//   - t starts at 0.02: self-intersection clearance. Right at the everted lip
//     the field is NOT a clean distance bound (see applyWounds' nearWound
//     comment — the smax fillet overstates distance), and an h sampled at t=0
//     would immediately clamp res to 0 everywhere.
//   - tMax 0.4 m: this is LOCAL crater self-shadowing, not global occlusion.
//   - Early-out once res < 0.02: fully shadowed, more samples cannot un-darken.
//   - Step clamp(h, 0.01, 0.06): the floor keeps tiny-h walls from stalling;
//     the ceiling keeps wall detail (which the softness k needs) from being
//     stepped over.
// Softness k ≈ 8-16 arrives as a parameter so the panel can tune it live.
export const WOUND_SHADOW = /* wgsl */ `fn woundShadow(
  p: vec3<f32>,
  L: vec3<f32>,
  k: f32,
  data: texture_2d<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  volumeTex: texture_3d<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  perfCfg: vec4<f32>,
  inst: ptr<storage, array<vec4<f32>>, read>,
  instCfg: vec4<f32>
) -> f32 {
  var res = 1.0;
  var t = 0.02;
  // TRIANGULATED coverage (iq's improved estimator, the same article; the
  // Claybook talk's slide 39 reports it as their fix for banding). The
  // single-sample min sees the occluder only where a sample happens to land
  // nearest it, so the penumbra bands at the step spacing. Two consecutive
  // samples h (now) and ph (previous), stepped apart, bound a closest point
  // BETWEEN them: y is that point's offset back along the ray and d its
  // distance off the ray, and k * d / (t - y) is the cone coverage there.
  // Same 14 samples, same field, two extra multiplies; ph starts at 1e10
  // so the first sample degrades to the plain estimator (y -> 0, d -> h).
  var ph = 1e10;
  for (var i = 0; i < 14; i = i + 1) {
    let h = mapBody(p + L * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x;
    let y = h * h / (2.0 * ph);
    let dd = sqrt(max(h * h - y * y, 0.0));
    res = min(res, k * dd / max(t - y, 1e-4));
    ph = h;
    if (res < 0.02 || t > 0.4) { break; }
    t = t + clamp(h, 0.01, 0.06);
  }
  return clamp(res, 0.0, 1.0);
}`;
