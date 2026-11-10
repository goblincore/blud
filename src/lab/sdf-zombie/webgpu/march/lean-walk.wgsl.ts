// src/lab/sdf-zombie/webgpu/march/lean-walk.wgsl.ts
//
// The CLEAN-BODY FAST PATH of the march's walk: mapLean, the per-pixel test that chooses it, the census that counts
// it, and the test's CPU mirror. On by default; `?leanwalk=0` is the march without it (lean-walk-flag.ts). Spec, with the exactness argument branch by
// branch: docs/superpowers/specs/2026-11-09-march-lean-walk-design.md.
//
// In brief: on a walk call (noise 0, unpinned, no normal hint, no probe pass, before the hit) for a tile-list pixel
// whose every live slot is unwounded, closed, volume-free and not on the bare-bones bypass, mapBody's applyWounds
// returns its input and writes nothing, the owner re-fold and the bone fold are not entered, the piece loop runs once
// at pIn and the volume branch is dead. What is left is the tile fold, the carves and the union min, which is mapLean,
// with mapBody's exit bookkeeping (gLastFold*, gFoldBest*, gHit*, gRefoldWin, gWalk*) and its instance reload tail.
//
// NOT re-exported by the barrel (march.wgsl.ts): the golden snapshot hashes the barrel's export NAMES, so the text is
// spliced into map-body.wgsl.ts / trace.wgsl.ts under the flag instead.
import { TILE_REF as TR } from './tile-ref-flag';
import { MAX_CROWD_INSTANCES, REC_ANCHOR_BAND, REC_COUNTS, REC_COUNTS2, REC_HEAD_WCOUNT, REC_SPLIT_N, REC_VEC4S, REC_VOL_POSE0, REC_WIND_ALIVE } from '../crowd-records';

export const MAP_LEAN = /* wgsl */ `fn mapLean(pIn: vec3<f32>, data: texture_2d<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>) -> vec4<f32> {
  gRefoldWin = 0.0;
  gWalkGapNew = 1e9;
  gWalkAttempted = 0.0;
  var dUnion = 1e9;
  var bestSlot = gSlot;
  var bestIdxU = -1.0;
  var bestU = 1e9;
  var bestDistortU = 1.0;
  var foldU = 1e9;
  var carvedU = 0.0;
  var splitFU = 1e9;
  let base = i32(instCfg.z);
${TR ? `  var tRun = 0;
` : ''}  for (var k = 0; k < ${MAX_CROWD_INSTANCES}; k = k + 1) {
    if (k >= gPixN) { break; }
${TR ? `    // THE TILE REFERENCE LIST (tile-ref-flag.ts): this slot's run of the pixel's list, as mapBody finds it.
    let rFirst = tRun;
    let rEnd = tileRunEnd(rFirst);
    tRun = rEnd;
    let s = i32(gTileRef[rFirst] >> 8u);
` : `    let s = gPixSlot[k];
`}    // THREE record reads a slot, not loadInstance's twenty-two: what the fold and the carves read.
    let rb = (base + s) * ${REC_VEC4S};
    let wa = (*inst)[rb + ${REC_WIND_ALIVE}];
    if (wa.w < 0.5) { continue; }
    // mapBody's piece skip for a closed slot (cap -1e9 against the running union): never taken on a real field.
    if (-1e9 >= dUnion) { continue; }
    let counts = (*inst)[rb + ${REC_COUNTS}];
    let ab = (*inst)[rb + ${REC_ANCHOR_BAND}];
    let band = i32(ab.w);
    // loadInstance's two writes that foldGroup reads (sdShell's wind and noise frame), per slot.
    gWindDrift = wa.xyz;
    gBodyAnchor = ab.xyz;
    var d = 1e9;
    gFoldBest = 1e9;
    gFoldBestIdx = -1.0;
    gFoldBestDistort = 1.0;
    // UPPER-BOUND CULL, mapBody's expression for a closed slot (piece 0, no limb mode).
    gCullRef = select(1e9, gCullUB, base + s == gCullSlot && gCullPiece == 0);
${TR ? `    for (var e = rFirst; e < rEnd; e = e + 1) {
      d = foldGroup(d, pIn, data, counts, band, tileBounds(data, e, band), tileRange(data, e, band));
    }
` : `    for (var e = gPixFirst[k]; e < gPixEnd[k]; e = e + 1) {
      d = foldGroup(d, pIn, data, counts, band, gTileBounds[e], gTileGrp[e]);
    }
`}    gCullRef = 1e9;
    let carved = applyCarves(d, pIn, data, counts, band);
    if (carved < dUnion) {
      dUnion = carved;
      bestSlot = base + s;
      carvedU = carved;
      bestIdxU = gFoldBestIdx;
      bestU = gFoldBest;
      bestDistortU = gFoldBestDistort;
      foldU = d;
      splitFU = carved;
    }
  }
  gLastFold = foldU;
  gLastFoldSlot = bestSlot;
  gLastFoldPiece = 0;
  gFoldBest = bestU;
  gFoldBestIdx = bestIdxU;
  gFoldBestDistort = bestDistortU;
  gHitSlot = bestSlot;
  gHitPiece = 0;
  gHitSplitF = splitFU;
  // THE LOADED INSTANCE, as mapBody leaves it: the winning slot (the pinned one after a hit). gSlot names a fully
  // loaded instance (loadInstance is its only writer), so this reloads only when the winner changes.
  let wantSlot = select(bestSlot, gPinSlot, gPinSlot >= 0);
  if (gSlot != wantSlot) { loadInstance(inst, wantSlot); }
  gWindDrift = gInstWind;
  gBodyAnchor = gInstAnchor;
  return vec4<f32>(dUnion, bestIdxU, 0.0, carvedU);
}`;

export const LEAN_TEST_BLOCK = /* wgsl */ `  // LEAN WALK (lean-walk-flag.ts). Once per pixel, after the tile preload, the slot table and the wound
  // list. True only when mapLean is exact for EVERY slot of the pixel's table (the argument, branch by branch, is in
  // docs/superpowers/specs/2026-11-09-march-lean-walk-design.md). debugCfg.x == -1 is the runtime A/B switch
  // (__sdfGame.setLeanWalk(false)). A non-empty per-ray wound list rules the pixel out whatever its bodies carry,
  // because applyWounds walks that list for every slot, not the slot's own wound count.
  var leanOk = gTileActive > 0.5 && debugCfg.x > -0.5 && !(gWoundListOn > 0.5 && gWoundN > 0);
  if (leanOk) {
    let leanBase = i32(instCfg.z);
${TR ? `    var lRun = 0;
` : ''}    for (var lk = 0; lk < ${MAX_CROWD_INSTANCES}; lk = lk + 1) {
      if (lk >= gPixN) { break; }
${TR ? `      let lFirst = lRun;
      lRun = tileRunEnd(lFirst);
      let lrb = (leanBase + i32(gTileRef[lFirst] >> 8u)) * ${REC_VEC4S};
` : `      let lrb = (leanBase + gPixSlot[lk]) * ${REC_VEC4S};
`}      // A dead slot folds in neither function.
      if ((*inst)[lrb + ${REC_WIND_ALIVE}].w < 0.5) { continue; }
      let lc2 = (*inst)[lrb + ${REC_COUNTS2}];
      let lsn = (*inst)[lrb + ${REC_SPLIT_N}].xyz;
      // Wounds, an open head split, the baked-volume branch, the bare-bones bone fold. The wound count is
      // written so a not-a-number lane fails; the other three are mapBody's own comparisons, so such a lane agrees.
      if (!((*inst)[lrb + ${REC_HEAD_WCOUNT}].w < 0.5) || dot(lsn, lsn) > 0.5 || (*inst)[lrb + ${REC_VOL_POSE0}].w > 0.5 || (lc2.y > 0.5 && lc2.x > 0.0)) { leanOk = false; break; }
    }
  }`;

export const LEAN_CENSUS_BLOCK = /* wgsl */ `
  // LEAN WALK CENSUS (debugCfg.x == 23). Raw counters, returned before the miss discard.
  // r = 1 where the walk took mapLean, g = slots in the pixel's table, b = steps + 1000 * hit. Only ever read back.
  // -23 is the same census with the runtime switch held (any negative mode holds it): r must then be 0 on every
  // pixel, which is how the switch is shown to reach the shader. The step counter only runs for a positive mode.
  if (abs(debugCfg.x) > 22.5 && abs(debugCfg.x) < 23.5) {
    return vec4<f32>(select(0.0, 1.0, leanOk), f32(gPixN), gDebugSteps + select(0.0, 1000.0, hit), t);
  }`;

/** The per-slot part of LEAN_TEST_BLOCK on the CPU: is mapLean exact for the body in `slot` of a record buffer
 *  (`CrowdRecords.floats`)? Term for term the WGSL above. */
export function leanSlotExact(floats: ArrayLike<number>, slot: number): boolean {
  const b = slot * REC_VEC4S * 4;
  if (floats[b + REC_WIND_ALIVE * 4 + 3]! < 0.5) return true;
  const n = b + REC_SPLIT_N * 4;
  const open = floats[n]! * floats[n]! + floats[n + 1]! * floats[n + 1]! + floats[n + 2]! * floats[n + 2]! > 0.5;
  const c2 = b + REC_COUNTS2 * 4;
  const bareBones = floats[c2 + 1]! > 0.5 && floats[c2]! > 0;
  return floats[b + REC_HEAD_WCOUNT * 4 + 3]! < 0.5 && !open && !(floats[b + REC_VOL_POSE0 * 4 + 3]! > 0.5) && !bareBones;
}
