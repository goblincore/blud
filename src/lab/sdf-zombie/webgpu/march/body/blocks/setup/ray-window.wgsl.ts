// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/ray-window.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): ray window: tMax, proxy-box entry, early discards.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const RAY_WINDOW_BLOCK = /* wgsl */ `  let tMaxBox = length(worldPos - camPos);
  let relax = woundCfg2.y > 1.0;
  let tMaxSel = select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax);
  // Accumulated-depth gate (perf round 2 task 5): a nearer body already
  // owns this pixel out to prevT — the front-to-back per-body passes blit
  // the accumulated frame state before each pass, and prevFetch decodes its
  // alpha (clip depth) into a ray distance.
  //
  // bodyEntry is the fragment's OWN conservative entry along the ray: its
  // proxy box (centre = the mesh's world origin, half extents = bodyHalf)
  // contains the hull contains the flesh, so nothing of this body can be
  // nearer than the ray-box entry. shellIn is a second lower bound on the
  // same first-possible hit (the SHARED nearest hull entry across ALL
  // bodies — weaker here, but never wrong). The exact discard takes the MAX
  // of the two: the larger of two lower bounds on the first possible hit is
  // still a lower bound on it, and the tighter of the two, so discarding
  // when max(shellIn, bodyEntry) > prevT can never drop a fragment this
  // body would have shaded — while min(shellIn, bodyEntry) <= shellIn <=
  // prevT almost everywhere was inert (task 5 shipped it and measured the
  // counters bit-identical on/off; task 5b proves the max form bites).
  //
  // invRd's 1e9 fallback (parallel axis) keeps the slab algebra finite: a
  // fragment's ray genuinely hits the box, so its fixed coordinate lies
  // inside that slab and the ±1e9 pair cancels in the min/max. The 0 clamp
  // is the camera-inside-the-box case: entry 0 never discards.
  let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));
  // Crowd proxy box - Task 5. The instanced crowd material carries its own
  // centre and half extent as vertex attributes: every instance shares ONE
  // record buffer, so the record's slot-0 box cannot describe the fragment's
  // own box. instCfg.y > 0.5 marks a crowd material; per-body materials bind
  // zeros and keep reading gInstCentre/gInstHalf bit-identically.
  let boxCentre = select(gInstCentre, instCentre, instCfg.y > 0.5);
  let boxHalf = select(gInstHalf, instHalf, instCfg.y > 0.5);
  let bLo = (boxCentre - boxHalf - camPos) * invRd;
  let bHi = (boxCentre + boxHalf - camPos) * invRd;
  let boxEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));
  // QUAD DISPATCH (stage a-2): in quad mode the fragment's conservative entry
  // is the nearest tile-sphere entry (gTileEntryT == 1e9 when the ray entered
  // none), not a box face. BIT IDENTITY: for instCfg.y <= 1 quadMode is false,
  // both discards below are dead, bodyEntry == boxEntry verbatim, and
  // gTileEntryT is never read.
  let bodyEntry = select(boxEntry, gTileEntryT, quadMode);
  if (quadMode && bodyEntry > 1e8) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  // DISTANCE SPLIT (ACCUM-UPSCALE-STACK-PLAN.md, owner idea 2026-09-23): depthPreCfg.w > 0 = the NEAR
  // pass, rays end at w metres; w < 0 = the FAR pass, rays start at -w; 0 = off (every ship frame, so
  // tMax is the old min and winFar folds away in the loop's max). Near bodies go through the quarter-
  // scale checker, far ones get real half-scale rays.
  let winNear = select(1e9, depthPreCfg.w, depthPreCfg.w > 0.0);
  let winFar = select(0.0, -depthPreCfg.w, depthPreCfg.w < 0.0);
  let tMax = min(min(tMaxSel, prevT), winNear);
  if (bodyEntry > winNear || tMax < winFar) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let steps = i32(marchCfg.x);`;
