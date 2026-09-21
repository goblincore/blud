// src/lab/sdf-zombie/webgpu/march/map-body.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): the signed-distance body field and its normal.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { MAX_CROWD_INSTANCES } from '../crowd-records';
import { ROW_CLUSTER_BOUNDS, ROW_CLUSTER_GROUPS, ROW_CLUSTER_RANGE, ROW_GROUP_BOUNDS, ROW_GROUP_RANGE } from './layout';

export const MAP_BODY = /* wgsl */ `fn mapBody(p: vec3<f32>, data: texture_2d<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, volumeTex: texture_3d<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, segVolumeAtlas: texture_3d<f32>, segVolumeMeta: texture_2d<f32>, perfCfg: vec4<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>) -> vec4<f32> {
  // PER-SLOT UNION FOLD (crowd stage a). One draw traces every instance of a
  // character type; each instance's FULL field is evaluated in turn and the
  // min is the union surface. PER-INSTANCE state (counts, counts2, woundBound,
  // the volume pose, noise shift, band) is loaded from the record buffer by
  // slot, so the body below is the pre-crowd mapBody verbatim with those names
  // bound to locals.
  //
  // SINGLE-INSTANCE BIT IDENTITY: with instCfg.x == 1 and gTileActive == 0 the
  // loop runs exactly once with band 0, and its body is the pre-change mapBody
  // character for character. The final min against 1e9 and the argmin
  // save/restore touch only the RETURN value, never the per-sample float ops
  // that produce it, so d is bit-identical.
  var dUnion = 1e9;
  var bestSlot = gSlot;          // the slot POST will reload
  var bestIdxU = -1.0;
  var bestU = 1e9;
  var bestDistortU = 1.0;
  var nearWoundU = 0.0;
  var carvedU = 0.0;
  // PER-STEP SLOT ITERATION. Tiles off: walk the capacity bound and take slot
  // k directly (the pre-crowd one-slot case is k == 0). Tiles on: walk the
  // per-pixel table built in MARCH_TRACE_SETUP — gPixN distinct slots, each
  // with its contiguous entry run — instead of scanning all
  // MAX_CROWD_INSTANCES slots and testing each for membership per step.
  //
  // BIT IDENTITY: with one instance and tiles off, tiled = false, nIter =
  // nInst = 1, k = 0, s = 0, and the body below is the pre-change mapBody
  // character for character. The alive read is the same value, now hoisted
  // into gInstAlive by loadInstance.
  let nInst = i32(instCfg.x);
  // BASE SLOT (crowd stage a, task 7c). A material drawing ONE field out of a
  // SHARED record buffer (the chunk views) sets instCfg.z to its record slot
  // and marches with tiles off, where the slot index is s = 0. Every existing
  // caller passes z = 0, so base + s is s and the canonical march is untouched.
  let base = i32(instCfg.z);
  let tiled = gTileActive > 0.5;
  let nIter = select(nInst, gPixN, tiled);
  for (var k = 0; k < ${MAX_CROWD_INSTANCES}; k = k + 1) {
    if (k >= nIter) { break; }
    let s = select(k, gPixSlot[k], tiled);
    loadInstance(inst, base + s);
    if (gInstAlive < 0.5) { continue; }
    let counts = gInstCounts;
    let counts2 = gInstCounts2;
    let woundBound = gInstWoundBound;
    let noiseShift = gInstNoiseShift;
    let volumePose0 = gInstVolPose0;
    let volumePose1 = gInstVolPose1;
    let band = gBand;
    var d = 1e9;
    // Argmin tracking now lives in private globals shared with foldGroup
    // (above); reset per slot — calcNormal calls mapBody four times and each
    // must track its own dominant prim.
    gFoldBest = 1e9;
    gFoldBestIdx = -1.0;
    gFoldBestDistort = 1.0;
    gWoundCluster = 0.0;
    gWoundOwners = 0u;
    gWoundRaisers = 0u;
    gWoundThreat = 0u;
    gWoundAmp = array<f32, 9>();
    // counts2.z = re-fold mode (0 ship, 1 off, 2 raiser gate, 3 threat mask)
    // + 4 when the exact fixes are on (d-aware reach, re-fold pre-scan).
    let exactFix = counts2.z > 3.5;
    let refoldMode = select(counts2.z, counts2.z - 4.0, exactFix);
    gWoundExact = select(0.0, 1.0, exactFix);
  // VOLUME BRANCH (X1.26): volumePose0.w is the enable flag. Enabled, the
  // baked texture IS the body — d comes from sampleHandVolume and the whole
  // primitive/cluster fold is skipped (counts are zeroed by the hands view,
  // but the branch, not the counts, is what keeps it dead). bestIdx stays -1
  // — the dominant-prim index has no meaning against a volume, and faking
  // one would point restPoint at an unwritten prim row; -1 is its documented
  // no-live-prim path, so the noise falls back to the world-frame anchor.
  if (volumePose0.w > 0.5) {
    d = sampleHandVolume(p, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip);
  } else {
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  if (tiled) {
    // TILE-LIST PATH (perf task 5 step 2, range-walked in 7d). MARCH_BODY
    // preloaded this pixel's tile entries into gTile* ONCE, before any
    // stepping, and MARCH_TRACE_SETUP collapsed them into the per-pixel slot
    // table. Every march step folds exactly this slot's contiguous run
    // through the SAME foldGroup the cluster walk uses, so the two paths
    // cannot drift. No per-step bound texel reads before the prim work and
    // no per-step slot scan — one table lookup plus the run's own fold.
    for (var e = gPixFirst[k]; e < gPixEnd[k]; e = e + 1) {
      d = foldGroup(d, p, data, counts, band, gTileBounds[e], gTileGrp[e]);
    }
  } else {
  // TWO-LEVEL CULL. The outer loop is the cluster (limb) sphere it has
  // always been; a cluster that survives walks its own BOUND GROUPS
  // (pack.ts boundGroups) — contiguous runs of two to four prims in fold
  // order, each with a sphere small enough that a hip pixel no longer folds
  // the shin (the schoolgirl folded 42 of 56 prims per step through the fat
  // limb spheres alone). Measured against a FLAT group list: iterating all
  // ~37 groups per step cost more in bound reads than the culled prims
  // saved (zombie 2.6 -> 4.8 ms); nesting them under the surviving clusters
  // keeps the far-limb cost at the old two texels.
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let crange = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE} + band), 0);
    if (crange.z < 0.5) { continue; }
    let cbounds = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS} + band), 0);
    let gspan = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_GROUPS} + band), 0);
    // The CLUSTER test carries the factor too. A factor-free test (as
    // always shipped) was tried for speed and TORE THE FIELD inside wound
    // cavities: there the running d is negative, the threshold collapses,
    // and an anisotropic cluster culls while still inside smin support —
    // drawn as thin black crack seams across the flesh around wounds
    // (owner, 2026-08-23). The factor makes a plate-bearing cluster
    // (schoolgirl sole: 22x) nearly uncullable, but its GROUPS still cull
    // soundly below, so the cost is a few texel reads, not a full fold.
    if (length(p - cbounds.xyz) - cbounds.w > (d + counts.w * 4.0) * gspan.z) { continue; }
    let gFirst = i32(gspan.x);
    let gCount = i32(gspan.y);
  for (var gi = 0; gi < 64; gi = gi + 1) {
    if (gi >= gCount) { break; }
    let g = gFirst + gi;
    let range = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_RANGE} + band), 0);
    let bounds = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_BOUNDS} + band), 0);
    // range.w is a BITFIELD, not a bool: 1 = oriented group, 2 = some prim
    // here is tapered or chamfered. Both are per-group hoists of a per-prim
    // decision, for the reason sdPrimO's header measures — paying an extra
    // textureLoad for EVERY prim cost +10-18% frame time. A group with no
    // shaped prims never touches ROW_PRIM_SHAPE at all. The prim loop,
    // sphere cull and argmin tracking all live in foldGroup (above), shared
    // with the tile-list path.
    d = foldGroup(d, p, data, counts, band, bounds, range);
  }
  }
  }
  }
  let carved = applyCarves(d, p, data, counts, band);
  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band);
  var dmg = dmgRes.x;
  let nearWound = dmgRes.y;
  // Preserve independently moving limbs under somebody else's wound.
  // Keep the original smooth body/carve fold, then union each threatened
  // limb with only ITS wounds applied. This retains authored blend seams
  // without letting an arm crater erase a nearby jaw when the arm rises.
  // No wounds/unscoped chunk wounds take the original path exactly.
  //
  // counts2.z is the ATTRIBUTION GATE (pass timing, 2026-09-07): 1 skips
  // this re-fold entirely — a WRONG frame on purpose (a raised arm's crater
  // can erase the jaw again) that prices the mechanism. 0, the shipped
  // value, is bit-identical to the pre-gate shader; only the bench's
  // owner-refold-off leg sets it (__sdfGame.setOwnerRefold).
  //
  // counts2.z == 2 is the RAISER GATE (2026-09-21, wound-cost investigation;
  // docs/dev-notes/2026-09-21-multiscale-march). A limb's re-fold can only win
  // the limbDamage < dmg test below if a wound it does NOT own raised the field
  // at p. Proof sketch — every wound step is monotone in its input, the limb's
  // own fold is >= the whole-body fold, and a foreign wound that did not raise
  // the field can only have lowered it through its rim bump, so without a
  // foreign raiser the whole-body result is already <= the limb's. The shipped
  // trigger fires across the whole near zone and the whole rim footprint, where
  // the re-fold then loses on every sample; this one fires inside foreign
  // craters only. raisersAtBase is read HERE, before the re-fold's own
  // applyWounds calls add to it. 0 stays bit-identical to the ungated shader.
  //
  // counts2.z == 3 is the THREAT MASK: the raiser gate, narrowed per cluster by
  // the CPU. A raising wound names the clusters whose prim groups actually reach
  // its carve bowl (the flags.x fraction, see applyWounds); a cluster no raising
  // wound names cannot have flesh inside any foreign crater at p, so its
  // re-fold cannot win. Only views that upload the masks may run at 3 — an
  // unwritten mask is zero and would switch the re-fold off entirely.
  let raisersAtBase = gWoundRaisers & ~1u;
  let threatAtBase = gWoundThreat;
  if ((nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u && volumePose0.w < 0.5 && (refoldMode < 0.5 || (refoldMode > 1.5 && refoldMode < 2.5 && raisersAtBase != 0u) || (refoldMode > 2.5 && threatAtBase != 0u))) {
    let owners = gWoundOwners;
    for (var c = 0; c < 8; c = c + 1) {
      if (c >= i32(counts.y)) { break; }
      if ((owners & ~(1u << u32(c + 1))) == 0u) { continue; }
      if (refoldMode > 1.5 && (raisersAtBase & ~(1u << u32(c + 1))) == 0u) { continue; }
      if (refoldMode > 2.5 && (threatAtBase & (1u << u32(c + 1))) == 0u) { continue; }
      let cr = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE} + band), 0);
      if (cr.z < 0.5) { continue; }
      let cb = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS} + band), 0);
      let gs = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_GROUPS} + band), 0);
      if (length(p - cb.xyz) - cb.w > (dmg + counts.w * 4.0) * gs.z) { continue; }
      // PRE-SCAN (exact fixes): the limb can only win if its fold dips below
      // dmg + the bump its own (and unowned) rows can subtract. foldGroup's
      // cull asserts a group whose sphere fails (T + 4k) * z cannot pull a
      // fold under T; if every group fails at T = dmg + ownAmp, the limb's
      // fold >= T, carves and wound smax only raise it, its bumps lower it
      // by <= ownAmp, so limbDamage >= dmg and the re-fold must lose.
      if (exactFix) {
        let T = dmg + gWoundAmp[0] + gWoundAmp[c + 1];
        var anyGroup = false;
        for (var gi = 0; gi < 64; gi = gi + 1) {
          if (gi >= i32(gs.y)) { break; }
          let gb = textureLoad(data, vec2<i32>(i32(gs.x) + gi, ${ROW_GROUP_BOUNDS} + band), 0);
          let gr = textureLoad(data, vec2<i32>(i32(gs.x) + gi, ${ROW_GROUP_RANGE} + band), 0);
          if (length(p - gb.xyz) - gb.w <= (T + counts.w * 4.0) * gr.z) { anyGroup = true; break; }
        }
        if (!anyGroup) { continue; }
      }
      let savedBest = gFoldBest;
      let savedIdx = gFoldBestIdx;
      let savedDistort = gFoldBestDistort;
      gFoldBest = 1e9;
      gFoldBestIdx = -1.0;
      gFoldBestDistort = 1.0;
      var limb = 1e9;
      for (var gi = 0; gi < 64; gi = gi + 1) {
        if (gi >= i32(gs.y)) { break; }
        let group = i32(gs.x) + gi;
        let range = textureLoad(data, vec2<i32>(group, ${ROW_GROUP_RANGE} + band), 0);
        let bounds = textureLoad(data, vec2<i32>(group, ${ROW_GROUP_BOUNDS} + band), 0);
        limb = foldGroup(limb, p, data, counts, band, bounds, range);
      }
      gWoundCluster = f32(c + 1);
      let limbCarved = applyCarves(limb, p, data, counts, band);
      let limbDamage = applyWounds(limbCarved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band).x;
      if (limbDamage < dmg) {
        dmg = limbDamage;
      } else {
        gFoldBest = savedBest;
        gFoldBestIdx = savedIdx;
        gFoldBestDistort = savedDistort;
      }
    }
    gWoundCluster = 0.0;
  }
  // Inside-flesh rows, gated on nearWound (see APPLY_BONES): ORGANS, plus
  // bones only when packBones is on (the shipped default until bone tubes
  // ship). Outside a wound the call is provably a no-op — the inside-flesh
  // rows are contained inside flesh — so skipping it is exact, not an
  // approximation. counts2.x carries boneCount: counts was already full and
  // woundCfg2.w is the volume hitEps override, not spare. counts2.y is the
  // BARE-BONES bypass (melt task 5): the gate's proof ("bones are contained
  // in flesh") stops holding the moment flesh moves without a wound — a
  // melting body sags off its own skeleton, and a bone-only chunk (a
  // released skeleton group) has no flesh and no wound to be near, so gated
  // it would march an EMPTY field.
  if ((nearWound > 0.5 || counts2.y > 0.5) && counts2.x > 0.0) {
    dmg = applyBones(dmg, p, data, counts, counts2.x, band, segVolumeAtlas, segVolumeMeta);
  }
  // bestIdx is read AFTER the bone fold so a bone that won the min is the
  // reported dominant prim — shading identifies bone via primScale.w == 4.
  // Kept as the bare f32 global so the returns below stay paren-free.
  let bestIdx = gFoldBestIdx;
  // Silhouette detail. The MARCH passes 0.0 here and only calcNormal passes a
  // real amplitude, so this term no longer displaces the surface — it survives
  // solely to give calcNormal's tetrahedron differences something to
  // differentiate, which warps the shading normal. See MARCH_BODY.
  //
  // Keeping it expressed as a field displacement rather than as a hand-written
  // gradient is deliberate: calcNormal returns normalize(grad(d + h)), which is
  // EXACTLY the normal the displaced surface had before. So the shading is
  // unchanged to the precision of the differencing, and only the silhouette
  // and the hit position lose the detail — which is the whole trade.
  //
  // The guard stays and now matters more than ever, since the march relies on
  // this call costing nothing: fbm is two 3D value-noise lookups, sixteen
  // hash13 calls, and without the branch a zero amplitude still pays in full.
  var dmgFinal = dmg;
  if (noiseCfg.x > 0.0) {
    // NOISE ANCHOR (motion-polish task 6): the fbm samples the DOMINANT prim's
    // REST frame — the texture is baked into the model, so gait bob, arm raises
    // and jiggle carry their skin instead of sliding through the world-frame
    // field. restPoint falls back to the old root-shift anchor (noiseLocal)
    // when there is no live prim or the rest rows were never written.
    let anchor = restPoint(p, data, i32(bestIdx), noiseLocal(p, noiseShift), band);
    dmgFinal = dmg + fbm(anchor * 3.0) * noiseCfg.x;
  }
    // UNION MIN. .w keeps the PRE-WOUND carved field value, exactly as the
    // one-slot entry returned it; POST's tissue-depth read is unchanged.
    if (dmgFinal < dUnion) {
      dUnion = dmgFinal;
      bestSlot = base + s;
      nearWoundU = nearWound;
      carvedU = carved;
      bestIdxU = gFoldBestIdx;
      bestU = gFoldBest;
      bestDistortU = gFoldBestDistort;
    }
  }
  gFoldBest = bestU;
  gFoldBestIdx = bestIdxU;
  gFoldBestDistort = bestDistortU;
  gHitSlot = bestSlot;
  // Leave the instance globals on the slot the caller expects: the pinned hit
  // slot after the hit, else the union's winner. No-op for a one-slot pixel.
  let wantSlot = select(bestSlot, gPinSlot, gPinSlot >= 0);
  if (gSlot != wantSlot) { loadInstance(inst, wantSlot); }
  return vec4<f32>(dUnion, bestIdxU, nearWoundU, carvedU);
}`;

// Tetrahedron differences. Epsilon stays SMALL: the prior blendshell experiment
// used 0.02 (2 cm on 6 cm limbs) and smeared normals exactly at the
// high-curvature joints where they matter most.
export const CALC_NORMAL = /* wgsl */ `fn calcNormal(p: vec3<f32>, data: texture_2d<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, volumeTex: texture_3d<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, segVolumeAtlas: texture_3d<f32>, segVolumeMeta: texture_2d<f32>, perfCfg: vec4<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * gNormalEps;
  return normalize(
    e.xyy * mapBody(p + e.xyy, data, noiseCfg, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x +
    e.yyx * mapBody(p + e.yyx, data, noiseCfg, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x +
    e.yxy * mapBody(p + e.yxy, data, noiseCfg, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x +
    e.xxx * mapBody(p + e.xxx, data, noiseCfg, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x);
}

// Run 5: the refine entry (REFINE_LOOP) sets this to its output-pixel footprint; the march never
// touches it, so x * 0.0015 is the exact pre-run-5 stencil.
var<private> gNormalEps: f32 = 0.0015;`;
