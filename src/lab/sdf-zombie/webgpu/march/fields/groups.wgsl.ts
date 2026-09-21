// src/lab/sdf-zombie/webgpu/march/fields/groups.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): group fold and crowd instance state.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { REC_ANCHOR_BAND, REC_BURN, REC_CENTRE_SEED, REC_COUNTS, REC_COUNTS2, REC_FLASH, REC_GORE, REC_HALF_REV, REC_HEAD_QUAT, REC_HEAD_WCOUNT, REC_MELT, REC_NOISE_YAW, REC_VEC4S, REC_VOL_POSE0, REC_VOL_POSE1, REC_WIND_ALIVE, REC_WOUND_BOUND } from '../../crowd-records';
import { TILE_MAX_ENTRIES } from '../../tile-cull';
import { ROW_PRIM_B, ROW_PRIM_BEND, ROW_PRIM_CLIP, ROW_PRIM_SCALE, ROW_PRIM_SHAPE, ROW_PRIM_SHELL, ROW_PRIM_WARP } from '../layout';

// The cull margin's 4.0 matters: smin scales k by 4 internally, so a cluster
// still bends the surface from 4x the authored blendK away. Using the unscaled
// value clips the fillet and shows up as hard creases along cluster edges.
//
// Carves come first: they are part of the body's own definition. Wounds are
// damage stamped on top of the finished body.
//
// RETURN PACKING (motion-polish task 6): x is the field value, exactly as
// before; y is the DOMINANT prim's index as an f32 — the additive prim whose
// OWN distance was smallest at p (argmin over the fold, tracked with a
// compare against the sd the fold already computed — no extra sdPrim calls,
// no extra textureLoads) — or -1 when no live additive prim was evaluated.
// The march reuses y to anchor the shell displacement and the hit-pixel
// noise without re-running the fold; the noise term below uses it to sample
// the fbm in the dominant prim's REST frame so the texture rides every limb.
// THE SHARED GROUP FOLD (perf task 5 step 2). The per-group work — sphere
// cull with the distortion factor, then the prim loop — exists ONCE here and
// BOTH fold paths call it: the cluster walk (below) and the tile-list path.
// Extracting it is what keeps them from drifting: a cull fix or an smin
// change lands in one place.
//
// bounds = group bound sphere (xyz centre, w radius); grp = the
// ROW_GROUP_RANGE texel (x start, y count, z DISTORTION factor, w flag
// bitfield). band selects the body's row block in a SHARED multi-body data
// texture (merged pass, task 5 step 4): row = ROW + band. Single-body views
// bind a one-band texture and pass 0 — every emitted load is then identical
// to the pre-band shader.
//
// The argmin tracker rides private globals (gFoldBest/gFoldBestIdx) rather
// than pointer params: three's wgslFn parser has no contract for ptr<function>,
// and mapBody re-initialises both before any fold, so there is no cross-call
// state. gDebugPrims counting moved in here too, so both paths (and only real
// folds) feed the prims heatmap.
export const FOLD_GROUP = /* wgsl */ `fn foldGroup(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32, bounds: vec4<f32>, grp: vec4<f32>) -> f32 {
  var d = dIn;
  // Per-step group-sphere cull, WITH the distortion factor — unchanged from
  // the cluster walk (see pack.ts: sd under-reports Euclid by up to this
  // factor; a factor-free test tore black cracks inside wound cavities).
  // Tiles cut the LIST; spheres still cut PER-STEP work.
  // gLimbSlack (per-limb accumulators, 0 unless on and inside the wound
  // bound) keeps groups a LIMB still needs inside a foreign crater, where
  // the limb is less inside than the union. Folding such a group into d is a
  // value no-op: its prims sit beyond d + 4k, where smin is exactly min.
  if (length(p - bounds.xyz) - bounds.w > (d + gLimbSlack + counts.w * 4.0) * grp.z) { return d; }
  let start = i32(grp.x);
  let count = i32(grp.y);
  let flags = i32(grp.w + 0.5);
  let ori = (flags & 1) != 0;
  let shaped = (flags & 2) != 0;
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= count) { break; }
    let idx = start + i;
    if (idx >= i32(counts.x)) { break; }
    let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE} + band), 0);
    // S.w: 0 add, 1 carve, 2 dead (severed mid-limb) — both skip the fold.
    if (S.w > 0.5) { continue; }
    if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }
    let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B} + band), 0).w;
    var r2 = -1.0;
    var prof = 0.0;
    var cpos = vec3<f32>(0.0, 0.0, 0.0);
    if (shaped) {
      let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + band), 0);
      r2 = T.x;
      prof = T.y;
      // Only genuinely-bent prims pay for the bend row; bit 1 (value 2)
      // encodes bend so a straight SHELL (prof 4) skips it. Keeps every
      // "> 0.5 means chamfer" consumer working unchanged.
      if ((i32(prof) & 2) != 0) {
        cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;
      }
    }
    var sd: f32;
    if (ori) { sd = sdPrimO(p, idx, data, r2, prof, cpos, band); }
    else { sd = sdPrim(p, idx, data, r2, prof, cpos, band); }
    // A SHELL (profile bit 2, value 4) thins the closed base field to a
    // sheet and clips it: abs(dBase) - thick, then a rounded-rim clip against
    // the shell plane. Only shell prims read the two extra rows, and only in
    // a shaped group, so additive prims pay nothing.
    //
    // MUST be a mask, not a "prof >= 4" magnitude test: that only ever meant
    // "shell" while bit 2 (shell) was the highest bit anyone set, so nothing
    // outscored it. A BOX sets bit 3 (value 8) with bit 2 clear, and
    // 8 >= 4 is true — a magnitude test would fold every box as a
    // zero-thickness shell (primShell/primClip are all-zero for a box),
    // instead of the plain body it actually is.
    if ((i32(prof) & 4) != 0) {
      let S2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHELL} + band), 0);
      let C2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_CLIP} + band), 0);
      let W2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_WARP} + band), 0);
      sd = sdShell(sd, p, S2.x, S2.y, S2.z, S2.w, C2.xyz, W2.x, W2.yzw, gWindDrift);
    }
    if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }
    // Chamfer is profile bit 0 (value 1); bend is bit 1 (value 2); shell is
    // bit 2 (value 4); box is bit 3 (value 8); METAL is bit 4 (value 16),
    // packed by pack.ts and read ONLY in the shading block (it is a
    // material, not a shape — the fold must treat a metal prim exactly like
    // the same prim without it, and every mask here does: 16 & 7 == 0 and
    // 16 & 8 == 0). "& 7 == 1" means "bit 0 set, bits 1 and 2 clear" —
    // exactly chamfer-and-nothing-else, which is what the OLD bounded-window
    // test (prof strictly between one half and one and a half) meant back
    // when prof topped out at 6.
    //
    // MUST be a mask, not that bounded window: a BOX sets bit 3 (value 8),
    // so prof is no longer bounded above by 6, and a chamfered box (prof 9)
    // falls outside that old window entirely — the author writes chamfer=,
    // the row packs it (see pack.ts), and the crease silently never
    // appears. "& 7" ignores bit 3 entirely, so box+chamfer (9 & 7 == 1)
    // chamfers exactly as a non-box chamfered prim does, and every existing
    // case (0,1,2,3,4,6) keeps its current answer — verified by
    // enumeration, see pack.test.ts / the task 5 report.
    if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }
    // PER-LIMB ACCUMULATOR: the same prim, the same blend, into its own
    // cluster's fold — what the owner re-fold used to rebuild from scratch.
    // SCALAR on purpose: the caller (mapBody) swaps gLimbCur in and out of
    // the per-cluster slots once per cluster. Runtime-indexed private arrays
    // written here, in the inlined prim loop, stopped the march shader from
    // compiling at all (cold boot > 180 s, the whole browser frozen).
    if (gLimbOn > 0.5) {
      if (sd < gLimbCur.y) { gLimbCur = vec4<f32>(gLimbCur.x, sd, f32(idx), grp.z); }
      if ((i32(prof) & 7) == 1) { gLimbCur.x = sminChamfer(gLimbCur.x, sd, k); } else { gLimbCur.x = smin(gLimbCur.x, sd, k); }
    }
  }
  return d;
}
// Tile-list state + fold-argmin state, declared at the TAIL of this source
// because three's wgslFn parser is ^-anchored on "fn" — a var-decl source of
// their own would fail the parse contract. MARCH_BODY fills the tile arrays
// ONCE per pixel (before stepping); every later mapBody call in the same
// fragment — march steps, calcNormal, AO/scatter probes, wound shadow — reads
// them through the same gTileActive gate, so shading sees exactly the field
// the march walked. Fragment invocations start zeroed; the cone pre-pass runs
// in its own invocations where gTileActive stays 0 and the cluster walk
// applies.
var<private> gFoldBest: f32 = 1e9;
var<private> gFoldBestIdx: f32 = -1.0;
// The dominant prim's GROUP DISTORTION factor (grp.z), for MARCH_BODY's
// footprint-AA epsilon (perf round 2 task 6): sdPrimitive under-reports
// Euclid by up to this factor, so the epsilon divides by it. Rides a private
// global rather than mapBody's .w return slot — that slot is owned by the
// wound-pass-r2 chain — under the SAME per-invocation contract as the
// argmin: mapBody resets, foldGroup writes at the argmin, MARCH_BODY reads
// straight after its mapBody call. 1.0 default: groups without distortion
// and the volume branch (which never folds) are exact no-ops.
var<private> gFoldBestDistort: f32 = 1.0;
// PER-LIMB ACCUMULATORS (counts2.z mode 4, option 4 of the 2026-09-21 wound
// cost work): each cluster's own fold, built during the base fold, so the
// owner re-fold needs no prim loops. mapBody resets them per slot.
var<private> gLimbOn: f32 = 0.0;
var<private> gLimbSlack: f32 = 0.0;
// The limb being folded: (fold, best sd, best prim idx, best distortion).
var<private> gLimbCur: vec4<f32> = vec4<f32>(1e9, 1e9, -1.0, 1.0);
var<private> gLimbCurC: i32 = -1;
// One slot per cluster, NAMED (no runtime indexing — see foldGroup).
var<private> gLimb0: vec4<f32>;
var<private> gLimb1: vec4<f32>;
var<private> gLimb2: vec4<f32>;
var<private> gLimb3: vec4<f32>;
var<private> gLimb4: vec4<f32>;
var<private> gLimb5: vec4<f32>;
var<private> gLimb6: vec4<f32>;
var<private> gLimb7: vec4<f32>;
fn limbLoad(c: i32) -> vec4<f32> {
  switch c {
    case 0: { return gLimb0; }
    case 1: { return gLimb1; }
    case 2: { return gLimb2; }
    case 3: { return gLimb3; }
    case 4: { return gLimb4; }
    case 5: { return gLimb5; }
    case 6: { return gLimb6; }
    case 7: { return gLimb7; }
    default: { return vec4<f32>(1e9, 1e9, -1.0, 1.0); }
  }
}
fn limbStore(c: i32, v: vec4<f32>) {
  switch c {
    case 0: { gLimb0 = v; }
    case 1: { gLimb1 = v; }
    case 2: { gLimb2 = v; }
    case 3: { gLimb3 = v; }
    case 4: { gLimb4 = v; }
    case 5: { gLimb5 = v; }
    case 6: { gLimb6 = v; }
    case 7: { gLimb7 = v; }
    default: { }
  }
}
// Switch the accumulator to cluster c (store the old one, load c's slot).
fn limbSwitch(c: i32) {
  if (c == gLimbCurC) { return; }
  limbStore(gLimbCurC, gLimbCur);
  gLimbCur = limbLoad(c);
  gLimbCurC = c;
}
// WIND DRIFT, metres, world space. A private global rather than another
// parameter on foldGroup because foldGroup is reached from mapBody, which has
// TEN call sites — threading a uniform through all of them to serve one
// primitive kind is the churn ROW_PRIM_WARP's own doc warns about. Both entry
// points (marchBody and coneMarch) set it from the same uniform before they
// fold anything, so the cone pre-pass certifies emptiness against exactly the
// surface the march then walks. A path that forgot to set it would see 0,
// which is the no-wind field — wrong, but never a tear.
var<private> gWindDrift: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
// THE BODY'S NOISE FRAME: (rootShiftX, bodyYaw, rootShiftZ), exactly the
// triple noiseLocal takes. Set from ONE uniform at both entry points rather
// than rebuilt from faceCfg3/lodCfg in each, so the march and the cone
// pre-pass cannot end up anchoring to different frames — a divergence there
// certifies emptiness against a surface the march does not have.
var<private> gBodyAnchor: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
var<private> gTileActive: f32 = 0.0;
var<private> gTileN: f32 = 0.0;
// QUAD DISPATCH (stage a-2): the nearest conservative ray-sphere entry over
// the pixel's preloaded tile entries. 1e9 means "the ray entered no inflated
// sphere"; MARCH_TRACE_SETUP discards that fragment before stepping. Only read
// when instCfg.y > 1 (quad mode) — the box path never touches it.
var<private> gTileEntryT: f32 = 1e9;
var<private> gTileBounds: array<vec4<f32>, ${TILE_MAX_ENTRIES}>;
var<private> gTileGrp: array<vec4<f32>, ${TILE_MAX_ENTRIES}>;
var<private> gTileBand: array<f32, ${TILE_MAX_ENTRIES}>;
// PER-RAY WOUND LIST (counts2.w gate, 2026-09-07). Built ONCE per pixel at
// the march entry (see MARCH_BODY) and folded by APPLY_WOUNDS every step
// through the gWoundListOn gate. Private vars are per-invocation and start
// at their INITIALISERS (never at a previous fragment's value), so the
// cone/depth pre-pass chains — separate invocations that never run the
// preload — keep gWoundListOn 0 and fold the full 16-wound loop, which is
// CONSERVATIVE by construction (the cone certifies emptiness against the
// full field, and any correctly-binned list is a subset of it).
var<private> gWoundListOn: f32 = 0.0;
var<private> gWoundN: i32 = 0;
var<private> gWoundList: array<i32, 16>;
var<private> gSlot: i32 = 0;
var<private> gBand: i32 = 0;
var<private> gHitSlot: i32 = 0;
// PINNED SLOT (crowd fix 2026-09-14). Once the hit instance is loaded, every
// later mapBody call in the invocation (calcNormal's four taps, the AO and
// scatter probes, wound/level shadow marches) still walks all the slots in
// this pixel's list and would leave the gInst*/gBand globals on the LAST slot
// it touched — so the material rows, rest anchor, wounds and face after it
// read ANOTHER instance's band (misaligned skin, or a free band's zeros: the
// pale/white zombie). POST pins the hit slot; mapBody restores the pinned
// instance on exit. -1 = unpinned (the march loop, where the winner is what
// matters). A one-slot pixel never reloads: gSlot already equals the slot.
var<private> gPinSlot: i32 = -1;
var<private> gTileSlot: array<f32, ${TILE_MAX_ENTRIES}>;
// Per-pixel slot table, built ONCE in MARCH_TRACE_SETUP from the sorted tile
// entry list: distinct slots present in this pixel's tile and each slot's
// entry range. The per-step loop walks gPixN slots, not MAX_CROWD_INSTANCES,
// and each slot folds only its own contiguous entry run — the old per-step
// slot-membership scan over the full entry list is gone.
var<private> gPixN: i32 = 0;
var<private> gPixSlot: array<i32, ${TILE_MAX_ENTRIES}>;
var<private> gPixFirst: array<i32, ${TILE_MAX_ENTRIES}>;
var<private> gPixEnd: array<i32, ${TILE_MAX_ENTRIES}>;
var<private> gInstCounts: vec4<f32> = vec4<f32>(0.0);
var<private> gInstCounts2: vec4<f32> = vec4<f32>(0.0);
var<private> gInstWoundBound: vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 1e9);
var<private> gInstAnchor: vec3<f32> = vec3<f32>(0.0);
var<private> gInstWind: vec3<f32> = vec3<f32>(0.0);
// The record's alive flag (REC_WIND_ALIVE.w), hoisted out of the wind read so
// the per-step slot gate costs one storage read instead of two.
var<private> gInstAlive: f32 = 0.0;
var<private> gInstMelt: vec4<f32> = vec4<f32>(0.0);
var<private> gInstFlash: vec4<f32> = vec4<f32>(0.0);
var<private> gInstNoiseShift: vec3<f32> = vec3<f32>(0.0);
var<private> gInstYaw: f32 = 0.0;
var<private> gInstHeadCentre: vec3<f32> = vec3<f32>(0.0);
var<private> gInstWoundCount: f32 = 0.0;
var<private> gInstHeadQuat: vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 1.0);
var<private> gInstVolPose0: vec4<f32> = vec4<f32>(0.0);
var<private> gInstVolPose1: vec4<f32> = vec4<f32>(0.0);
var<private> gInstCentre: vec3<f32> = vec3<f32>(0.0);
var<private> gInstSeed: f32 = 0.0;
var<private> gInstHalf: vec3<f32> = vec3<f32>(0.0);
var<private> gInstRevision: f32 = 0.0;
// RUPTURE GORE (body-to-gib task 3). 0 outside a crowd draw (so the per-view
// lodCfg.w remains authoritative there); the doomed body's ramp rides its own
// record because the crowd shares one material and one lodCfg uniform.
var<private> gInstGore: f32 = 0.0;
// BURNING BODY (flame lab): the record's (burn, burnSec, char, spare). 0 outside
// a crowd draw, where the per-view burnCfg is authoritative -- same split as
// gInstGore above.
var<private> gInstBurn: vec4<f32> = vec4<f32>(0.0);
// The surface fire's emissive contribution, written in the surface prep and
// read by the lighting tail, which is a separate WGSL export.
var<private> gBurnEmit: vec3<f32> = vec3<f32>(0.0);
// FLAME TONGUES (flame-tongues task 2): the per-pixel burn mask the layer
// publishes as its fourth MRT attachment. Written in the surface prep's burn
// block, read by marchBurnRead (MARCH_BURN_OUT). rgb = burn, char, surface
// fire; w = 1 on a written pixel and is NEVER a hit gate -- the attachment's
// cleared alpha is 1 too (the sdf-layer MRT note), so readers gate on rgb.
var<private> gBurnOut: vec4<f32> = vec4<f32>(0.0);`;

// Per-instance state, loaded from the record buffer by slot. Everything that
// used to be a per-body uniform parameter is a private global now, so the
// section text that reads it changes by NAME ONLY (counts -> gInstCounts).
//
// The slot index is also the prim-atlas BAND index (REC_ANCHOR_BAND.w =
// slot * DATA_ROWS), so loadInstance leaves gBand ready for every row read
// that follows. gHitSlot is the slot whose field won the union fold; the
// post-hit sections reload it before they read the hit's material rows.
// gTileSlot mirrors the tile entry's bodyIndex so the per-slot loop can fold
// only the entries belonging to the slot it is evaluating.
export const INSTANCE_STATE = /* wgsl */ `fn loadInstance(inst: ptr<storage, array<vec4<f32>>, read>, slot: i32) -> void {
  let base = slot * ${REC_VEC4S};
  gSlot = slot;
  gInstCounts = (*inst)[base + ${REC_COUNTS}];
  gInstCounts2 = (*inst)[base + ${REC_COUNTS2}];
  gInstWoundBound = (*inst)[base + ${REC_WOUND_BOUND}];
  let ab = (*inst)[base + ${REC_ANCHOR_BAND}];
  gInstAnchor = ab.xyz;
  gBand = i32(ab.w);
  let wa = (*inst)[base + ${REC_WIND_ALIVE}];
  gInstWind = wa.xyz;
  // CROWD (2026-09-14): the field's noise anchor and shell wind are per
  // instance too; keep them on the loaded slot so every slot folds its own
  // field (and the analytic gradient, which anchors per owner prim, agrees).
  gWindDrift = gInstWind;
  gBodyAnchor = gInstAnchor;
  gInstAlive = wa.w;
  gInstMelt = (*inst)[base + ${REC_MELT}];
  gInstFlash = (*inst)[base + ${REC_FLASH}];
  let ny = (*inst)[base + ${REC_NOISE_YAW}];
  gInstNoiseShift = ny.xyz;
  gInstYaw = ny.w;
  let hw = (*inst)[base + ${REC_HEAD_WCOUNT}];
  gInstHeadCentre = hw.xyz;
  gInstWoundCount = hw.w;
  gInstHeadQuat = (*inst)[base + ${REC_HEAD_QUAT}];
  gInstVolPose0 = (*inst)[base + ${REC_VOL_POSE0}];
  gInstVolPose1 = (*inst)[base + ${REC_VOL_POSE1}];
  let cs = (*inst)[base + ${REC_CENTRE_SEED}];
  gInstCentre = cs.xyz;
  gInstSeed = cs.w;
  let hr = (*inst)[base + ${REC_HALF_REV}];
  gInstHalf = hr.xyz;
  gInstRevision = hr.w;
  gInstGore = (*inst)[base + ${REC_GORE}].x;
  gInstBurn = (*inst)[base + ${REC_BURN}];
}
`;
