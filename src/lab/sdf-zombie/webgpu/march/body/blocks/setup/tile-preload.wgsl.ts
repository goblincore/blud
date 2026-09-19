// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/tile-preload.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): tile-list preload and quad-mode entry.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.
import { TILE_MAX_ENTRIES } from '../../../../tile-cull';
import { DATA_ROWS, QUAD_ENTRY_SLACK, RAY_CULL_SLACK } from '../../../layout';

export const TILE_PRELOAD_BLOCK = /* wgsl */ `  // TILE-LIST PRELOAD (perf task 5 step 2). Read ONCE per pixel, here at the
  // march entry — never per step. The entry's groups then ride every mapBody
  // call in this fragment through gTileActive (march steps AND the post-hit
  // normal/AO/scatter probes, so shading sees exactly the field the ray
  // walked). The cone pre-pass is a separate invocation chain and keeps
  // gTileActive 0 — it marches the full cluster field, which is CONSERVATIVE
  // relative to any correctly-binned tile list.
  gTileActive = select(0.0, 1.0, tileCfg.x > 0.5);
  if (tileCfg.x > 0.5) {
    // The grid travels IN THE UNIFORM — deliberately not textureDimensions(),
    // whose inference-from-resource-size is exactly what broke when adaptive
    // resolution moved rungs under the old DataTexture path.
    let gx = max(1, i32(tileCfg.y));
    let gy = max(1, i32(tileCfg.w));
    let tid = clamp(vec2<i32>(floor(screenUV * vec2<f32>(f32(gx), f32(gy)))), vec2<i32>(0, 0), vec2<i32>(gx - 1, gy - 1));
    let head = (*tileHdr)[tid.y * gx + tid.x];
    let n = min(head.y, ${TILE_MAX_ENTRIES}u);
    // PER-RAY SPHERE COMPACTION (prototype, tileCfg.x == 2). The tile list
    // is a 16px-wide frustum's worth of groups, projected at each sphere's
    // NEAREST depth and clamped outward to whole tiles, so a single ray
    // carries groups it never comes near. One ray-vs-sphere test per entry,
    // HERE and never per step, drops those before any marching. The sphere
    // is inflated the way both cull sites already agree on: the binner's
    // blendReach (counts.w * 4) scaled by the group's distortion factor as
    // the per-step foldGroup test scales its threshold, plus RAY_CULL_SLACK
    // for the post-hit probes that leave the ray (calcNormal eps, the AO
    // probe at n * 0.06) — those sample the same gTile list.
    let rayCull = tileCfg.x > 1.5;
    // QUAD DISPATCH (stage a-2): the per-ray cull's reach is slot 0's record
    // (gInstCounts.w) in box/boxless mode; a quad frame has no per-instance
    // record bound, so the type's max blend K rides instCfg.w instead. select
    // keeps the box reach verbatim when quadMode is false.
    let reach = select(gInstCounts.w, instCfg.w, quadMode) * 4.0 + ${RAY_CULL_SLACK};
    var w = 0;
    // Nearest conservative sphere entry, accumulated over the entries that
    // survive (or skip) the per-ray cull. Only meaningful in quad mode.
    var entryT = 1e9;
    for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
      if (e >= i32(n)) { break; }
      // Entry stream: TILE_STRIDE vec4s per entry at base head.x. Same record
      // layout the CPU binner packs; kTileWrite emits it verbatim.
      let lin = (head.x + u32(e)) * 3u;
      let b = (*tileEnt)[lin];
      let g = (*tileEnt)[lin + 1u];
      if (rayCull) {
        let oc = b.xyz - camPos;
        let tc = max(dot(oc, rd), 0.0);
        let rInf = b.w + reach * max(g.z, 1.0);
        if (dot(oc, oc) - tc * tc > rInf * rInf) { continue; }
      }
      if (quadMode) {
        // Ray vs the INFLATED bound sphere (reach x distortion + slack). entryT
        // is a lower bound on this body's first possible surface, so clamping
        // the march to it can never drop a hit; max(tc - th, 0) folds the
        // camera-inside-sphere case.
        let ocQ = b.xyz - camPos;
        let tcQ = dot(ocQ, rd);
        let rQ = b.w + reach * max(g.z, 1.0) + ${QUAD_ENTRY_SLACK};
        let d2Q = dot(ocQ, ocQ) - tcQ * tcQ;
        if (d2Q <= rQ * rQ) {
          entryT = min(entryT, max(tcQ - sqrt(max(rQ * rQ - d2Q, 0.0)), 0.0));
        }
      }
      gTileBounds[w] = b;
      gTileGrp[w] = g;
      gTileBand[w] = (*tileEnt)[lin + 2u].x * ${DATA_ROWS}.0;
      gTileSlot[w] = (*tileEnt)[lin + 2u].x;
      w = w + 1;
    }
    gTileN = f32(w);
    // QUAD DISPATCH (stage a-2): a quad fragment whose tile list is EMPTY can
    // have no surface — discard before the wound list and before any stepping.
    // This sits inside the tiles-on block on purpose: tiles off falls through
    // to the else-if below and marches from the camera instead.
    if (quadMode && gTileN < 0.5) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
    gTileEntryT = entryT;
    // PER-PIXEL SLOT TABLE (perf 7d). The binder emits entries sorted by slot
    // (groups are appended per slot in CrowdType.sync, and the ray-cull
    // filter is a monotone subset), so a slot's entries are one contiguous
    // run. Collapse that into (slot, first, end) triples HERE, once per
    // pixel, and MAP_BODY's per-step loop walks gPixN slots with a bounded
    // range fold instead of scanning all MAX_CROWD_INSTANCES slots.
    gPixN = 0;
    {
      var prev = -1;
      for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
        if (f32(e) >= gTileN) { break; }
        let s = i32(gTileSlot[e]);
        if (s != prev) {
          gPixSlot[gPixN] = s;
          gPixFirst[gPixN] = e;
          gPixEnd[gPixN] = e + 1;
          gPixN = gPixN + 1;
          prev = s;
        } else {
          gPixEnd[gPixN - 1] = e + 1;
        }
      }
    }
  } else if (quadMode) {
    // QUAD DISPATCH (stage a-2): tiles off, so there is no tile list to take a
    // conservative entry from — march from the camera. Correct (an entry is
    // only ever a lower bound), slow, and debug-only: sync() logs once.
    gTileEntryT = 0.0;
  }`;
