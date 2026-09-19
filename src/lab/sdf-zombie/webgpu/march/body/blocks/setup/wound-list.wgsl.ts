// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/wound-list.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): per-ray wound list.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.
import { RAY_CULL_SLACK, ROW_WOUND } from '../../../layout';

export const WOUND_LIST_BLOCK = /* wgsl */ `  // PER-RAY WOUND LIST (counts2.w gate, 2026-09-07). Built ONCE per pixel:
  // a wound whose REACH sphere the ray never enters cannot change this
  // ray's field on any step, nor the post-hit probes within RAY_CULL_SLACK
  // of the ray. Same reach formula as applyWounds (pinned by test, + slack
  // for the off-ray probes). The cone/depth pre-pass chains never run this
  // block, so their gWoundListOn stays 0 and they fold every wound —
  // conservative by construction.
  gWoundListOn = select(0.0, 1.0, gInstCounts2.w > 0.5);
  if (gWoundListOn > 0.5) {
    gWoundN = 0;
    let nW = min(i32(gInstWoundCount), 16);
    for (var i = 0; i < 16; i = i + 1) {
      if (i >= nW) { break; }
      let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND} + gBand), 0);
      let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25 + ${RAY_CULL_SLACK};
      let oc = w.xyz - camPos;
      let tc = max(dot(oc, rd), 0.0);
      if (dot(oc, oc) - tc * tc > reach * reach) { continue; }
      gWoundList[gWoundN] = i;
      gWoundN = gWoundN + 1;
    }
  }`;
