// src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): march trace setup/loop/post and assembled trace.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { TILE_MAX_ENTRIES } from '../../tile-cull';
import { DATA_ROWS, QUAD_ENTRY_SLACK, RAY_CULL_SLACK, ROW_PRIM_CLIP, ROW_PRIM_COLOR, ROW_PRIM_SHAPE, ROW_WOUND, WOUND_STEP_MUL } from '../layout';
import { FACE_LAYER_WGSL } from './face.wgsl';
import { MELT_BLOCK } from './blocks/post/melt.wgsl';
import { BURN_BLOCK } from './blocks/post/burn.wgsl';
import { PAINT_CHAR_BLOCK } from './blocks/post/paint-char.wgsl';
import { SOLDIER_MEAT_BLOCK } from './blocks/post/soldier-meat.wgsl';
import { GORE_BLOCK } from './blocks/post/gore.wgsl';
import { MOTTLE_BLOCK } from './blocks/post/mottle.wgsl';
import { ORGAN_BLOCK } from './blocks/post/organ.wgsl';
import { TISSUE_BLOCK } from './blocks/post/tissue.wgsl';
import { WOUND_MASKS_BLOCK } from './blocks/post/wound-masks.wgsl';
import { SHADING_NORMAL_BLOCK } from './blocks/post/shading-normal.wgsl';

/**
 * SECTION 2 of 4 — the trace: ray setup and pre-pass gates, the march loop,
 * the hit test, and the full post-hit MATERIAL chain (normal evaluation,
 * wound/char masks, tissue ramp, organ/mottle/gore, the face pass, painted
 * prims, char, melt). Everything here is light-independent, so the deferred
 * surface entry reuses this text verbatim. The debug early-returns and the
 * miss discard are part of the trace and behave identically in both entries.
 */
export const MARCH_TRACE_SETUP = /* wgsl */ `  gPinSlot = -1;
  // FIRST STATEMENT, before anything folds. gWindDrift is read inside
  // sdShell, which is reached from foldGroup on every mapBody call in this
  // invocation — the march steps, calcNormal, the AO and scatter probes. Set
  // it late and the normal would be taken against a different surface than
  // the one the march hit.
  loadInstance(inst, i32(instCfg.z));
  gWindDrift = gInstWind;
  gBodyAnchor = gInstAnchor;
  let rd = normalize(worldPos - camPos);
  // QUAD DISPATCH (stage a-2). instCfg.y: 0 per-body, 1 instanced proxy box,
  // 2 screen quad. Declared at SETUP's top so the tile preload (below) and the
  // box-entry block (much later) share one definition; for y <= 1 it is false
  // and every branch below is dead.
  let quadMode = instCfg.y > 1.5;
  // PERF INSTRUMENTATION (task 2): debugCfg.x 0 = off, 1 = steps-per-pixel
  // heatmap, 2 = prims-per-pixel. Everything below is guarded so the
  // shipping path pays exactly one uniform branch; gDebugMode hands the
  // flag to mapBody's fold without forking its signature.
  if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0; gDebugSteps = 0.0; gDebugBones = 0.0; gDebugVolumeSamples = 0.0; gDebugVolumeFallbacks = 0.0; }
  // TILE-LIST PRELOAD (perf task 5 step 2). Read ONCE per pixel, here at the
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
  }
  // PER-RAY WOUND LIST (counts2.w gate, 2026-09-07). Built ONCE per pixel:
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
  }
  // OCCLUDER PRE-PASS. occT is the distance to the nearest point of a
  // conservative INNER hull of the scene — geometry guaranteed to lie inside
  // the real surface, rasterised depth-only before this pass.
  //
  // Clamping tMax by it is the entire consumption path, and it is safe in the
  // one direction that matters: the hull is INSIDE the body, so any true
  // surface along this ray is NEARER than the hull that covers it. Cutting the
  // ray at the hull can therefore never remove a hit that would have been
  // visible — it only stops the march from grinding through the full step
  // budget in space that something solid already covers.
  //
  // + woundCfg2.z (shell displacement, X1.21.2) buys back the one exception
  // that direction had. The shell can also dent the surface INWARD, and a
  // dent retreats up to ~0.9 amp below the smooth field the hull was sized
  // against; the hull clearance is only (1 - shrink) of the prim radius, so on
  // thin limbs a dent can pass BEHIND the hull sphere along the ray — and a
  // march whose tMax stops at the hull discards the pixel outright. On screen
  // that is dark dropout where the displaced skin should be; A/B with the
  // occluder off and the shell on makes it vanish. Extending the bound by one
  // amp reaches every dent the fbm can cut, while bumps stand PROUD of the
  // hull and were never at risk. Zero when the shell is off, so the
  // undisplaced bound is bit-identical.
  // OUTER-HULL BOUNDS (shell-hull-outer.ts). The hull CONTAINS the flesh, so
  // it answers two questions the occluder cannot:
  //
  //   shellOut <= 0 — no hull covers this pixel, therefore no surface can be
  //     here, therefore there is nothing to march. Measured 2026-08-31: that
  //     is 82-92% of every pixel the march rasterises, carrying 63-84% of all
  //     its steps.
  //   shellIn — where the hull's near surface is. No surface exists before it,
  //     so the ray may start there instead of at the proxy box's front.
  //
  // THE return IS NOT REDUNDANT WITH THE discard. In WGSL, discard demotes the
  // invocation to a helper; it does NOT stop execution. Without the return the
  // pixel would still walk its entire budget and only then be thrown away —
  // which is precisely the work this exists to delete.
  // (No backticks in this file: it is one big template literal.)
  //
  // ENTRY AND EXIT ARE SEPARATE for one reason: a camera INSIDE a hull sphere
  // sees no front face, so entry reads 0 there exactly as it does where there
  // is no hull at all. Exit tells them apart — inside the hull it is positive.
  // Collapsing the two would discard flesh at point-blank range.
  //
  // With the shell OFF the fetches hand back shellIn 0 / shellOut 1e9, so both
  // uses below are identities and this path stays bit-identical.
  //
  // shellOut FOLDS INTO tMax ON THE UN-RELAXED PATH, behind perfCfg.x, and
  // there the fold is EXACT: the hull contains the flesh, so no ray can hit
  // anything beyond the hull's back face. Cutting the march there deletes
  // only the empty space a miss ray used to walk between the hull exit and
  // the proxy box's far plane. The game page binds perfCfg.x 1 (see
  // GAME_HULL_EXIT_BOUND); the lab binds zero and stays bit-identical.
  //
  // The relaxed tracer (omega > 1.0) is the exception, and why the fold ships
  // behind a seam at all: X1.15 made that tracer take a CLAMPED FINAL SAMPLE
  // at tMax so an overshoot past tMax could still retract. Clamping tMax to
  // the hull puts that sample ON THE HULL — a surface sitting blendK +
  // shellAmp + chain-inflation OUTSIDE the flesh — and the AA epsilon
  // (t * aaCfg.x, which grows with distance) accepts it as a hit: a bright
  // halo hugging every silhouette and distant ghost outlines, worst far away
  // where the epsilon is largest. Caught by the 2026-08-31 on/off visual
  // gate. The clamped final sample exists only above omega 1.0, so the fold
  // is guarded with !relax and the relaxed path keeps the proxy-box far
  // plane. (History: the fold was first left out entirely as the fix for
  // that halo; perf round 2 re-adds it for the un-relaxed path only.)
  //
  // With the shell OFF the fetch hands back shellOut 1e9, so min() is the
  // identity; with perfCfg.x 0 select() is the identity. Both identities are
  // bit-exact — nothing else about the march changes.
  if (shellOut <= 0.0) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  // THE OCCLUDER NO LONGER BOUNDS tMax, AND IT MUST NOT (2026-09-01).
  //
  // Everything above about the inner hull being safe to clamp against is
  // sound as GEOMETRY, and the hull really is inside the flesh: sampling
  // sdBody at all 300 emitted spheres of the live POSED bodies puts every one
  // of them at least its own radius deep (__sdfGame.hullInsideness). What is
  // not sound is the NUMBER the pre-pass writes for them.
  //
  // Measured with one synthetic sphere of known centre and radius, rasterised
  // alone and read straight back (__sdfGame.syntheticSphereCheck). The value
  // the pre-pass stores tracks the true camera distance only in the near
  // field and then comes apart -- and the error depends on DISTANCE alone,
  // not on the sphere's radius or its size on screen:
  //
  //   true 1.9 -> 1.905    true 2.4 -> 2.405   true 2.9 -> 2.892   (exact)
  //   true 3.9 -> 3.714    true 4.9 -> 4.252   true 5.9 -> 4.447
  //   true 7.9 -> 3.782    true 9.9 -> 2.079   true 11.9 -> 0.367
  //
  // An UNDER-reported occT is the one error this bound cannot survive: tMax
  // lands in front of the surface, the ray gives up before reaching skin, and
  // the fragment discards. On screen that is the owner's report of bodies
  // "full of holes until you get fairly close" -- holes because the clamp
  // bites per pixel wherever the hull covers, and distance-keyed because the
  // encoding is accurate exactly where the player is close. Measured on a
  // single isolated zombie at 4.9 m: 1369 of 1375 lost pixels had tMax IN
  // FRONT of the flesh, worst case 0.68 m short, and the hull's own CPU
  // ray-sphere entry (4.814 m) sat correctly BEHIND the surface (4.757 m)
  // while the pre-pass wrote 4.225 m for the same pixel.
  //
  // The bound bought nothing to weigh against that. Interleaved frame timing
  // with the outer shell hull shipping (room 3, 8 bodies, 6 rounds x 30
  // frames, GPU-fenced): occluder on 14.23 ms mean, off 14.32 ms, against a
  // 13.4-14.9 ms spread WITHIN either leg. That matches what the shell work
  // already recorded -- "the occluder measured as worth nothing anyway".
  //
  // So the clamp goes and the pre-pass ships disabled. Everything else stays:
  // occluder-hull.ts still builds, occFetch still fetches, debug mode 3 still
  // heats occT, and __sdfGame.setOccluder still renders the pass -- so
  // whoever works out why an instanced MeshBasicNodeMaterial writing
  // length(positionWorld - cameraPosition) decays with distance can revive
  // this by putting the term back. Do not put it back before that: the outer
  // hull (shell-hull-outer.ts) writes distance the same way, and is unharmed
  // only because shellIn is a ray START and shellOut a > 0 test, where
  // under-reporting is conservative. Here it is fatal.
  let tMaxBox = length(worldPos - camPos);
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
  let tMax = min(tMaxSel, prevT);
  let steps = i32(marchCfg.x);
  // HIT EPSILON (X1.26): the primitive literal was 1.2 mm. A trilinear
  // reconstruction of a baked SDF is not exact to the surface, so volume
  // mode raises the threshold through the SPARE woundCfg2.w channel to at
  // least half the largest voxel pitch (set by the hands view). max() keeps
  // the primitive path bit-identical at the default 0.
  // HIT EPSILON, and the ANTIALIASING lever on top of it.
  //
  // hitEpsBase is the floor: the original 1.2 mm primitive literal, raised
  // by woundCfg2.w in volume mode (see below).
  //
  // aaCfg.y > 0 additionally ends the march once the field is within the RAY'S
  // OWN PIXEL FOOTPRINT, t * aaCfg.x. That prefilters geometry below Nyquist
  // — detail finer than a pixel is smoothed rather than aliased — which is the
  // principled fix for geometric aliasing, versus FXAA guessing edges after
  // the fact. It is also FASTER, because a larger epsilon converges in fewer
  // steps, and the saving grows with distance: biggest exactly where crowds
  // are. Corner rounding is sub-pixel by construction, so invisible; that IS
  // the antialiasing.
  //
  // THREE THINGS TO KNOW BEFORE RAISING THE STRENGTH:
  //  1. mapBody UNDER-REPORTS Euclid distance by the group distortion factor
  //     (up to 22x — the schoolgirl's sole plate), so d < eps can fire when
  //     the TRUE distance is many times eps, stopping the ray short and
  //     reading blobby/detached, non-uniformly, in high-distortion regions.
  //     CORRECTED (perf round 2 task 6): the fold's argmin carries the
  //     dominant group's packed factor in the private global gFoldBestDistort
  //     and the epsilon below divides by it — same per-sample state as the
  //     argmin, so the correction is exact where the hit lands. This is why
  //     the lever can now ship ON.
  //  2. Craters fill in at range as eps approaches wound depth. Arguably
  //     correct LOD, but it is the distance at which a player judges whether
  //     a shot landed — hence the floor, which never shrinks below 1.2 mm.
  //  3. It does nothing for SHADING aliasing, and henenlotter-latex is the
  //     worst case (specIntensity 0.95 / specRoughness 0.12, plus
  //     surfaceNoiseAmp perturbing normals). Geometric prefiltering will not
  //     stop specular scintillation; that wants roughness widening with the
  //     same footprint, separately.
  //
  // Bonus: the footprint tracks the adaptive-resolution ladder for free, since
  // aaCfg.x is derived from the SDF pass height — so AA quality stays
  // consistent at scale 1.0 and at 0.45, where today the low rungs give more
  // aliasing AND more blur at once.
  let hitEpsBase = max(0.0012, woundCfg2.w);
  let aaK = aaCfg.x * aaCfg.y;
  // NOISE ANCHOR (motion-polish task 6): every fbm below samples the
  // DOMINANT prim's REST frame via restPoint — the noise is baked into the
  // model. noiseShift (faceCfg3.zw + lodCfg.z, the task-3 root-shift anchor)
  // survives ONLY as restPoint's fallback for bodies without rest rows and
  // for the no-live-prim case. Zero = the pre-motion behaviour there.
  let noiseShift = vec3<f32>(gInstNoiseShift.x, gInstYaw, gInstNoiseShift.z);
  // ONLY .x CARRIES MEANING: the silhouette-noise amplitude. y/z/w are dead.
  //
  // They were a parked melt spike's amp/frequency/time (c52b05b), removed in
  // the 2026-09-04 merge because the shipped zombie melt supersedes it. Note
  // what this line read immediately after that merge:
  //   vec4<f32>(marchCfg.z, meltCfg.x, meltCfg.y, meltCfg.z)
  // Both sides had independently named a uniform meltCfg, so git merged the
  // two files with NO conflict marker and quietly fed the zombie melt's
  // PROGRESS into the spike's displacement amplitude — a body that ridges as
  // it melts, from a merge that reported success.
  //
  // The vec4 survives only because hard-surface's gloss/metal kill is written
  // against it (see calcNormal below). Collapsing it back to a plain f32 is a
  // tidy-up worth doing; three permanently-dead lanes on a shared struct is
  // precisely how primClip.w's "spare" comment went stale.
  let noiseCfg = vec4<f32>(marchCfg.z, 0.0, 0.0, 0.0);

  // RELAXED SPHERE TRACING (Keinert et al. 2014; Balint & Valasek 2018).
  //
  // Plain sphere tracing steps by exactly the unbounding radius. This shader
  // used to step by 0.6 of it — UNDER-relaxation, costing ~1.67x the
  // iterations of the textbook algorithm — because the silhouette fbm added to
  // mapBody broke the Lipschitz bound, so the "distance" could overestimate
  // and a full step could tunnel through the surface.
  //
  // The overshoot test is the whole safety argument: if the new unbounding
  // sphere does not reach back far enough to touch the previous one, the step
  // jumped over a gap the spheres never covered, so it is retracted and the
  // step falls back to the conservative radius.
  // woundCfg2.y carries the relaxation factor so it stays tunable — the win is
  // theory until it is measured, and it cannot be measured against a constant.
  // At or below 1.0 the relaxed path is off and marchCfg.y is back in charge.
  // NORMAL WARPING (Hubert-Brierre et al. 2025) took the silhouette fbm OUT
  // of the marched field — see the mapBody call below, which passes 0.0 — so
  // it survives only in calcNormal, where it perturbs the shading normal at
  // the hit point. That made the field an exact CSG of ellipsoid capsules
  // under a conservative smooth-min for EVERY body, not just the distant ones
  // LOD had already stripped.
  //
  // ==> THAT ARGUMENT NO LONGER HOLDS. It was written before wounds existed.
  // applyWounds does NOT return a distance bound (the smax fillet overstates,
  // the lip understates), so the field the tracer sees near a crater is not
  // conservative and over-relaxation is NOT always safe. Relax pinned to 1.0
  // on 2026-08-24 after ω = 1.4 × carved wounds produced the wound-halo
  // "distorted lens": both ω > 1-only paths below step rays BACKWARD at
  // grazing wound angles and fail to reconverge, so whole screen-space
  // circles shade the body from an offset depth. Post-mortem in Obsidian,
  // Claude Notes/Blud/2026-08-24-wound-halo-postmortem.md.
  //
  // DO NOT raise the default above 1.0 until the two retractions below are
  // bounded and provably reconverge — see the "retract-guard reconvergence"
  // lever in docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md.
  // It is worth 1.60× on crowds (X1.10: 10 bodies, 1.0 → 14.89 ms vs
  // 1.4 → 9.31 ms), so it is worth doing properly — but that sweep PREDATES
  // wounds and must be re-run with craters in the scene before 1.4 returns.
  //
  // SHELL DISPLACEMENT (gobs-and-goo task 4) is the owner-approved middle
  // path that brings the bumpy outline BACK: the relaxed march runs the
  // smooth field until it is inside a thin shell of the surface, and only
  // there does the fbm displace the stepped distance — see the loop body.
  var omega = select(marchCfg.y, woundCfg2.y, relax);
  // Near-wound step multiplier, with a live override on perfCfg.z for A/B
  // (__sdfGame.setWoundStep). ZERO IS THE IDENTITY: every view that never
  // writes the lane gets the compiled constant, bit for bit. The lane is on
  // perfCfg and not counts2 because counts2 is re-set on every pack — an
  // override parked there would evaporate on the next body rebuild.
  let woundMul = select(${WOUND_STEP_MUL}, perfCfg.z, perfCfg.z > 0.0);
  // Start where the cone pre-pass proved the tile is still empty, rather than
  // at the camera. Clamped to tMax so a stale or over-eager coarse value can
  // never push the ray straight out the back of the proxy box.
  // max(startT, shellIn): the cone pre-pass proved empty space ahead, and the
  // outer hull proves no surface exists before its own near face. Take
  // whichever reaches further; clamped to tMax so neither can push the ray out
  // the back of the box.
  //
  // QUARTER-RES DEPTH PREPASS (close-up task 3) adds a third lower bound to
  // the max — the coarse pass's first cone-touch distance for this pixel's
  // 4x4 block, provably at or in front of every ray's own first surface
  // (the proof lives on DEPTH_PREPASS_MARCH). The fetch returns 0 for a
  // miss or a disabled pass, and preStart collapses to 0, which is the
  // identity inside the max — the off path is bit-identical.
  //
  // The backoff subtracts three slack terms from the recorded touch. The
  // footprint term (preT * cfg.y) is insurance beyond the cone-radius proof:
  // it would take a depth gradient steeper than one block footprint per
  // block — a grazing silhouette — to put a block ray's own surface nearer
  // than touch minus a footprint, and the proof already covers that case;
  // this term costs one multiply and buys the census a quiet night. The
  // 0.0012 is the coarse touch test's own epsilon (the touch can record up
  // to that far before the field's nearest surface), and shellAmp is the
  // shell displacement the coarse test also stopped short of — the same two
  // slack terms CONE_MARCH's stop carries, handed back to the ray here.
  let preT = depthPreFetch(depthPreTex, screenUV, depthPreCfg);
  let preStart = select(0.0, max(preT - (preT * depthPreCfg.y + 0.0012 + woundCfg2.z), 0.0), preT > 0.0);
  // TEMPORAL REPROJECTION START (plan 2026-09-10). Last fresh frame's hit at
  // this pixel, unprojected with that frame's inverse VP and measured along
  // THIS ray, minus a margin for flesh that moved toward the camera and a
  // slope term - a fourth proven-ahead lower bound. Every off path returns 0,
  // the identity inside the max, so ?tstart=0 is bit-identical. The ndc
  // mapping from screenUV is the layer's own (no flip) - pinned on the GPU by
  // Task 2 step 7.2 of the plan (a wrong flip reads the mirrored row).
  let tempNdc = vec2<f32>(screenUV.x * 2.0 - 1.0, screenUV.y * 2.0 - 1.0);
  let temp = temporalStartFetch(lastTex, tempNdc, lastInvVp, camPos, rd, temporalCfg);
  // OWN-BODY GATE. The layer's depth is the NEAREST body at the pixel, but
  // this pass marches ONE body: if last frame's hit was another body in
  // front, starting there skips this body's own surface (the 2026-09-10
  // see-through - other bodies' silhouettes cut into flesh). Trust the
  // reprojected point only when it lies inside THIS body's proxy box along
  // the ray, margin either side; then confirm the start is OUTSIDE the field
  // with one sample - inside means the surface was skipped, and the
  // recovery probes below rewind to the surface instead of dropping the
  // whole bound.
  var tempStart = 0.0;
  // WINDOW-WIDTH REFUSAL (the holes fix, 2026-09-10 night). On a ray that
  // GRAZES the body, the entry/exit window is razor-thin and the field's
  // convergence dip is narrower than the walk's sampling stride: a temporal
  // start landing at/past the dip can never accept (per-pixel temporalDiag:
  // ~460 broken px at ANY margin; 0.25 -> 607, 1.0 -> 231, cap+slack ->
  // 64-118), and the exit-side accepts cannot recover a walk that skipped
  // its only convergent region. So the temporal start fires only where the
  // window is at least margin + cap + headroom wide — face-on pixels, where
  // the approach-skipping win lives; thin-window silhouette pixels fall
  // back to the safe shellIn walk, which is current-frame and tracks
  // swung limbs.
  if (temp.y > 0.0
      && tMax - shellIn >= temporalCfg.y + 0.18
      && temp.y >= bodyEntry - temporalCfg.y && temp.y <= tMax + temporalCfg.y) {
    // shellAmp backoff: with shell displacement live, the displaced
    // silhouette sticks out up to shellAmp beyond the smooth field the probe
    // below samples — the same slack preStart carries. woundCfg2.z is 0 at
    // the shipping default, so this is the identity there.
    var s = temp.x - woundCfg2.z;
    if (s > 0.0) {
      var dres0 = mapBody(camPos + rd * s, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
      // ACCEPTANCE: outside the field AND outside a wound's near zone
      // (dres0.z). Near a crater applyWounds' smax fillet OVERSTATES the
      // distance — the field is not a bound there — and a start beside the
      // zone lets the first step land inside the carve: the frozen-scene
      // pixel diff (2026-09-10) showed banded deep-tissue/char striping on
      // the wounded closeup at a 0.05 m adaptive margin, while the shipped
      // 0.25 m margin rendered pixel-identical to tstart off. Clean skin
      // keeps the tight start; wound-adjacent pixels back off below.
      // RECOVERY PROBES. Inside (x <= 0) means the surface reached the
      // start — flesh moved toward the camera, or this pixel sits on a
      // silhouette slope the flat slope term undershoots; rewind by twice
      // the reported penetration (twice: the field under-reports Euclid by
      // the group distortion factor). In-zone (z >= 0.5) rewinds by a fixed
      // 0.15 — the zone reaches ~wound radius + rim beyond the crater, so a
      // couple of steps clear it. Three probes at most, then the bound is
      // dropped (max() below still marches from bodyEntry). A rewind before
      // the box entry always probes positive-and-out-of-zone (every prim of
      // this body lies inside the box; zones only exist around its own
      // wounds), so the loop self-terminates there.
      for (var probe = 0; probe < 3; probe = probe + 1) {
        if (dres0.x > 0.0 && dres0.z < 0.5) { break; }
        let back = select(s + 2.0 * dres0.x, s - 0.15, dres0.z >= 0.5);
        if (back <= 0.0) { break; }
        s = back;
        dres0 = mapBody(camPos + rd * s, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
      }
      if (dres0.x > 0.0 && dres0.z < 0.5) {
        // HULL-RELATIVE CAP (the holes fix, 2026-09-10 night). The accepted
        // start may tighten at most 6 cm past the CURRENT frame's hull face:
        // shellIn is rebuilt every frame and tracks swung limbs perfectly,
        // while the temporal history is one frame stale — at melee swing
        // tips the surface moves 0.3-0.5 m per frame, and a stale start past
        // the moved surface re-phases the walk into the razor-thin graze
        // window where acceptance falls off its edge (the stacked-corridor
        // holes: ~460-620 broken px at ANY fixed margin; margin sweep 0.25
        // -> 607, 0.6 -> 622, 1.0 -> 231, meanTOn pinned at the box exit).
        // The 6 cm budget is what the temporal start is FOR — tightening
        // the last stretch where the hull is loose — and it bounds the
        // stale-history damage to less than the hull's own inflation.
        s = min(s, shellIn + 0.06);
        tempStart = s;
      }
    }
  }
  // bodyEntry joins the fold as the FIFTH term (startT, shellIn, preStart,
  // tempStart, bodyEntry). The proxy box CONTAINS the hull contains the
  // flesh, so nothing of this body is nearer than the ray-box entry — the
  // same argument the accumulated-depth discard above already rests on. It is a lower bound
  // like every other term: in a crowd it is the tighter bound for a body
  // whose cone/coarse touch sits at the tile's FRONT surface, and it catches
  // the pixels whose temporal gate failed — those used to restart from the
  // shared shellIn and walk their own empty proxy space.
`;

/** Run 5 (plan 2026-09-13-neural-upscale-run5-sdf-refine): the walk alone — from `var t` to the
 *  line before `if (!hit) { discard; }`. REFINE_LOOP replaces exactly this section. */
export const MARCH_TRACE_LOOP = /* wgsl */ `  var t = clamp(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), 0.0, tMax);
  var hit = false;
  var prevRadius = 0.0;
  var stepLen = 0.0;
  var clamped = false;
  // Dominant prim at the last field sample (mapBody.y) — the hit pixel's
  // noise anchor reuses it instead of re-running the fold (task 6).
  var hitBest = -1;
  // The last field sample's full mapBody result (wound-r2 task 6). Re-assigned
  // every iteration exactly like hitBest/hitNearWound so it always describes
  // the sample the loop actually lands on; at the break it is therefore the
  // ACCEPTING sample, whose .w is the pre-wound field carved — depth
  // beneath the original skin, the tissue ramp's signal.
  var hitField = vec4<f32>(0.0);
  // Whether the ACCEPTED hit sample sat in a wound's near zone (mapBody.z).
  // Re-derived every iteration so it always describes the sample the loop
  // actually lands on — retractions and shell steps included. This is the
  // wound-shadow gate: firing iq's soft shadow march only for pixels inside
  // twice a wound's radius keeps its cost proportional to crater screen
  // area instead of screen size.
  var hitNearWound = false;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }
    // 0.0, not marchCfg.z: the field mapBody returns stays SMOOTH — the fbm
    // still reaches the normal only via calcNormal — but inside a thin shell
    // of the surface the same fbm is added to the REAL stepped distance just
    // below, which is where the silhouette gets its bumps back without
    // paying fbm at every step of the empty approach.
    let dres = mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
    let distort = max(gFoldBestDistort, 1.0);
    var d = dres.x;
    hitBest = i32(dres.y);
    hitField = dres;
    // Shell displacement: inside a thin shell of the smooth surface, the
    // silhouette noise displaces the REAL field — bumpy outlines are back —
    // and stepping goes conservative because the noise breaks the Lipschitz
    // bound. Outside the shell the relaxed march is untouched. The fbm
    // samples the dominant prim's REST frame (task 6), glued to the flesh;
    // restPoint's loads are paid only inside the shell band.
    let shellAmp = woundCfg2.z;
    var conservative = false;
    if (shellAmp > 0.0 && abs(d) < shellAmp * 4.0) {
      d = d + fbm(restPoint(camPos + rd * t, data, i32(dres.y), noiseLocal(camPos + rd * t, noiseShift), gBand) * 3.0) * shellAmp;
      conservative = true;
    }
    // Near a wound (mapBody.z) the field is not a distance bound — see
    // applyWounds — so step UNDER-relaxed at 0.6, exactly as the noise shell
    // does, and skip the overshoot test (a retraction there takes back a
    // step that was never relaxed). Plain 1.0 stepping was tried first and
    // still banded: the smax fillet overstates distance, so even an exact
    // sphere step lands past the crater wall.
    let nearWound = dres.z > 0.5;
    hitNearWound = nearWound;
    let radius = abs(d);
    let overshot = !conservative && !nearWound && omega > 1.0 && (radius + prevRadius) < stepLen;
    if (overshot) {
      // Undo the part of the last step that was not covered by the spheres,
      // and drop to plain sphere tracing for the rest of this ray. Skipped on
      // a displaced sample — the retraction rewinds by the omega excess,
      // which is only the real excess when stepLen was d times omega, and a
      // shell step was already under-relaxed at 0.6 so there is nothing to
      // take back.
      //
      // KNOWN WRONG, dead at the shipping default (relax 1.0) — do not "tidy"
      // this without the gates in the perf spec's retract-reconvergence lever.
      // The last step was d*omega; the excess over a conservative step is
      // d*(omega-1) == stepLen*(omega-1)/omega. This takes back
      // stepLen*(omega-1) instead — at omega 1.4, 0.56*d rather than 0.40*d,
      // a 40% OVER-retraction. It errs conservative (it lands short of the
      // safe point) so it cannot tunnel, but it burns steps and, combined
      // with the unbounded guard below, is half of why wounded rays fail to
      // reconverge. Correct form: stepLen = -stepLen * (omega - 1.0) / omega.
      stepLen = stepLen - omega * stepLen;
      omega = 1.0;
    } else {
      let hitEps = max(hitEpsBase, t * aaK / distort);
      // LAST-STEP SECANT ACCEPT (Claybook, Aaltonen GDC 2018 slide 25; off at
      // perfCfg.w == 0, bit-identical). A sphere trace converges on a
      // geometric series: at a fixed grazing angle each step shrinks d by the
      // same ratio, and the tail from d down to hitEps costs log(d/hitEps)
      // steps that all land on the same planar patch. Assume the surface IS
      // that plane through the last two samples (trilinear/analytic fields
      // are locally linear along the ray) and the remaining distance is the
      // secant root d * stepLen / (dPrev - d). When that root is within
      // perfCfg.w hit-epsilons, jump onto it and accept. The jump is NOT a
      // distance bound, so it fires only where the field is one: never on a
      // displaced (shell) or near-wound sample, only while approaching
      // (dPrev > d, so the ratio is < 1 and the series converges), and only
      // after a forward step (stepLen > 0 — a retraction's previous sample
      // was inside the solid). hitField/hitBest still describe the sample the
      // jump left, which is at most perfCfg.w * hitEps behind the accepted t
      // — the same tolerance the plain accept already grants.
      if (perfCfg.w > 0.0 && !conservative && !nearWound && stepLen > 0.0 && prevRadius > radius) {
        let root = radius * stepLen / (prevRadius - radius);
        if (root < hitEps * perfCfg.w) {
          t = t + root;
          hit = true;
          break;
        }
      }
      if (d < hitEps) {
        // wound-halo r2: an over-relaxed step can cross the skin with
        // radius + prevRadius == stepLen EXACTLY — a perpendicular approach
        // onto near-flat skin makes the sum an equality, not a strict <, so
        // the overshoot test above cannot see it — and the hit then registers
        // up to (omega-1)/omega of the last step INSIDE the solid. Behind the
        // wound grid that landing zone sits in the carve spheres' smax/smin
        // blend, whose gradient contaminates the shading normal: the torso's
        // far side lit up as a red/pale band at wound height (owner,
        // 2026-08-24; instrumented — band hits at z -0.17 vs skin -0.266,
        // normals sideways/up, wm ~ 0). Retract onto the surface and finish
        // the ray at omega 1; the hit is accepted once d is within hitEps.
        // The crossing sample usually sits inside the near-wound zone (the
        // landing is BEHIND the wound spheres even when the crossing is in
        // front of them), so nearWound is NOT a stop signal here — 0.6
        // stepping of the overstated fillet can cross too, and retracting to
        // the wall is strictly more correct than shading a point inside it.
        // Only shell-displaced samples keep the old contract (their retraction
        // assumes the smooth field).
        //
        // KNOWN UNSOUND, dead at the shipping default (relax 1.0). d here is a
        // SCALED-space distance: per the cull-soundness rule sdPrimitive
        // under-reports Euclid by the group's distortion factor (22x on the
        // schoolgirl sole plate), so stepping back by |d| is not guaranteed to
        // leave the solid, and nothing here bounds a retry or caps the
        // back-step to the interval actually travelled. This is the other half
        // of the wounded-ray non-reconvergence. Fixing it needs the packed
        // distortion factor threaded to this site — see the perf spec.
        if (d < -max(hitEpsBase, t * aaK / distort) && omega > 1.0 && !conservative) {
          stepLen = d;
          omega = 1.0;
        } else {
          hit = true;
          break;
        }
      } else {
        // TWO INDEPENDENT REASONS TO UNDER-RELAX, and the stricter one wins.
        // The shell's 0.6 pays for the fbm; the wound zone's own multiplier
        // pays for a field that is not a distance bound (WOUND_STEP_MUL).
        // They used to share the 0.6 literal, which is how the wound side
        // went unexamined for as long as it did — the shell's figure was
        // never measured against a crater.
        //
        // At WOUND_STEP_MUL 0.6 this is the old select() exactly, for every
        // omega the pages ship (all >= 0.6). It differs only BELOW 0.6, where
        // the old form LENGTHENED the step to 0.6 in the very zones that
        // wanted it shortest; min() keeps omega there instead.
        stepLen = d * min(select(omega, 0.6, conservative), select(omega, woundMul, nearWound));
        // CRAWL FLOOR (temporal start): graze rays near the surface step
        // sub-millimetre distances and burn 15-30 samples crossing the last
        // few cm (the gib-segment march cost of the holes fix). A 2 mm floor
        // bounds the crawl to ~window/2mm steps; the graze accept (1 cm) and
        // the eps accept still land hits that the floor steps across.
        stepLen = max(stepLen, select(0.0, 0.002, temporalCfg.x > 0.5));
      }
    }
    prevRadius = radius;
    t = t + stepLen;
    if (t > tMax) {
      // GRAZE ACCEPT (temporal start, 2026-09-10 night). The temporal start
      // re-phases the walk; at silhouette/graze pixels the acceptance window
      // before the exit is razor-thin, and the re-phased crawl (15-30 sub-mm
      // steps) crossed the exit with its last sample a few mm OFF the
      // surface and discarded: the stacked-corridor holes. radius here is
      // the LAST SAMPLE's field value; accept at the crossing when that is
      // within a HARD 1 cm — absolute, deliberately NOT scaled by the AA
      // epsilon (t * aaCfg.x = 2% of distance): the first version multiplied
      // the distance-scaled epsilon by 8 and the band grew to ~1.9 m at
      // 12 m, accepting hits in the air beside distant limbs — white
      // fresnel/spec lint over the whole body (owner report + screenshots,
      // 2026-09-10). 1 cm is sub-visible at every range and still covers
      // the 2-5 mm graze crawls. Scoped to the temporal start so
      // ?tstart=0 stays bit-identical.
      if (temporalCfg.x > 0.5 && radius < 0.01) {
        t = t - stepLen;
        hit = true;
        break;
      }
      // Do NOT break outright on the relaxed path. An over-relaxed step can
      // cross the surface AND tMax together, and the overshoot test cannot
      // fire until the NEXT sample — so breaking here discards a hit the
      // retraction would have recovered. Harmless while tMax was the proxy
      // box's far side; the occluder pre-pass made tMax a bound that can sit
      // millimetres behind the surface, and this break shredded every body
      // whose hull gap was tight (the interpenetrating-crowd holes).
      //
      // Instead, take the pending sample AT tMax: if the step did cross the
      // surface, the overshoot test fires there and the retraction replays
      // the interval at omega 1. One extra visit at most — the clamped flag —
      // so a genuinely empty ray still terminates. The plain path is exempt:
      // at omega <= 1.0 steps are conservative and nothing can be skipped.
      if (omega <= 1.0 || clamped) { break; }
      t = tMax;
      clamped = true;
    }
  }
  // OCCUPANCY MODE (debugCfg.x == 4, 2026-08-31). Returns RAW COUNTERS
  // instead of a colour, and — the whole point — returns BEFORE the discard,
  // so pixels that missed still write. Channels:
  //   r = steps this ray took   g = 1 if it hit flesh, else 0
  //   b = 1 always (this fragment was rasterised and marched)
  //   a = t -- BUT DO NOT READ IT BACK AS A DISTANCE. createMarchMaterial's
  //     outputNode replaces alpha with CLIP-SPACE DEPTH, so a readback of
  //     this channel always lands in [0, 1]. (2026-09-01: that silently
  //     collapsed a whole "lost pixels by distance" histogram into the
  //     0-1 m bucket before it was caught.)
  //
  // ONE MORE BIAS, and it matters for the counts below: this returns BEFORE
  // the discard, so a MISSED ray still writes depth -- at the distance it
  // gave up, which for a near body's proxy box is nearer than a far body's
  // real hit. The missed fragment then wins the depth test and the readback
  // reports "no flesh" for a pixel the shipping render draws. Wherever proxy
  // boxes overlap, occupancy()'s hit counts are therefore a LOWER bound for
  // that reason too, on top of the overdraw one below.
  //
  // WHAT IT MEASURES, and what it does not. Summing over the target gives
  // hits/rasterised = the fraction of proxy-box screen area that actually
  // shows flesh. That is the shell march's addressable market: a bounded
  // hull never rasterises the rest. It is a LOWER BOUND on the waste,
  // because depth-testing means only the front-most body writes to a pixel —
  // where several bodies' boxes overlap, the real fragment-invocation count
  // is higher than this can see.
  //
  // Only ever read back; it does not composite to anything meaningful.
  if (debugCfg.x > 3.5 && debugCfg.x < 4.5) {
    return vec4<f32>(gDebugSteps, select(0.0, 1.0, hit), 1.0, t);
  }
  // BONE-EVAL MODE (debugCfg.x == 5, gore r3 refinement 3). Same contract as
  // occupancy above — raw counters, returned BEFORE the discard so missed
  // rays still write, alpha unusable. r = bone capsule evaluations this ray.
  // This is what the bone-fold cull must move; the timing bench could not
  // resolve the fold at all (+0.0% under a 4% spread), so the counter is the
  // measurement and the bench is only a sanity check.
  if (debugCfg.x > 4.5 && debugCfg.x < 5.5) {
    return vec4<f32>(gDebugBones, select(0.0, 1.0, hit), 1.0, t);
  }
  // VOLUME-EVAL MODE (debugCfg.x == 8): r = in-grid segment samples,
  // g = exact procedural fallbacks. Returned before discard so misses count.
  if (debugCfg.x > 7.5 && debugCfg.x < 8.5) {
    return vec4<f32>(gDebugVolumeSamples, gDebugVolumeFallbacks, select(0.0, 1.0, hit), t);
  }
`;

export const MARCH_TRACE_POST = /* wgsl */ `  if (!hit) { discard; }
  // Reload the slot whose field won the union fold. Every post-hit row read
  // below (material, rest anchor, face, wound masks) is the HIT instance's.
  loadInstance(inst, gHitSlot);
  gPinSlot = gHitSlot;
  // DEBUG MODE 11 (crowd diagnostics 2026-09-14): per-pixel slot / prim / distortion / band readout.
  if (debugCfg.x > 10.5 && debugCfg.x < 11.5) { return vec4<f32>(f32(gHitSlot), gFoldBestDistort, f32(hitBest), f32(gBand)); }
  // FLAT-ALBEDO SEAM (close-up diagnostics task 1, 2026-09-04). Returns the
  // body's base albedo AT THE HIT and skips the entire post-hit chain —
  // calcNormal (4 field evals), the anchor, the micro-detail fbm, wound/char
  // masks, the tissue ramp, organ/mottle/gore/face albedo, the analytic
  // flashlight, spec/fresnel, the scatter and AO probes, the wound soft
  // shadow, the level shadow and the ambient compose. Nothing about the WALK
  // changes: the loop above ran to the same t with the same stepping, and
  // hitBest/hitNearWound/hitField were still maintained because the tracer
  // itself consumes them.
  //
  // debugCfg.y is the seam's gate because debugCfg.y was the one spare
  // channel on a uniform every march variant already binds — a new input in
  // MARCH_BODY's signature would have to be threaded through the entry
  // literal AND every variant literal in signature order (the meltCfg
  // incident), for a diagnostic that must stay inert. Default 0 = the
  // guarded return never fires and the fragment below is bit-identical to
  // the pre-seam shader; a test pins this file to exactly one debugCfg.y
  // occurrence, placed here.
  //
  // Precedence note: with debugCfg.x ALSO in a heatmap mode (1/2/3) the flat
  // return wins — those modes returned after shading, and this seam exists to
  // skip shading. Modes 4/5 (occupancy/bone counters) still win over it:
  // they return above, before the hit test.
  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }
  // Snapshot the counters BEFORE the post-hit probes: calcNormal folds
  // four more mapBody calls and the wound shadow up to fourteen, and the
  // heatmap is about RAY cost, not shading cost.
  let debugSteps = gDebugSteps;
  let debugPrims = gDebugPrims;

  let p = camPos + rd * t;
  // PER-PRIMITIVE MATERIAL READ — hoisted above the noise (hard-surface
  // task 1). gloss must be known BEFORE the shading normal exists: both
  // flesh-noise paths below scale by (1 - gloss), because a polished prim
  // has no pores. This is the SAME single texel the per-prim colour block
  // below used to read (hitBest row, ROW_PRIM_COLOR) — hoisted, not
  // repeated, so no hit pixel pays for it twice. hitBest is -1 on the
  // baked-volume path; there gloss stays 0 and every noise term runs at
  // full flesh amplitude exactly as before.
  // METAL (task 2) rides the same hoist: prof bit 4 (16), read off
  // ROW_PRIM_SHAPE only inside the painted branch (metal is parse-gated on
  // color=, so an unpainted pixel can never change the answer — one extra
  // texel load on painted hit pixels only). metal implies the same noise
  // suppression with no gloss set: a machined surface has no pores either,
  // so both sites below take (1 - max(gloss, metal)).
  var gloss = 0.0;
  var painted = 0.0;
  var metal = 0.0;
  var primGlow = 0.0;
  var primAlbedo = vec3<f32>(0.0);
  if (hitBest >= 0) {
    let PC = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_COLOR} + gBand), 0);
    if (PC.w > 0.0) {
      primAlbedo = PC.xyz;
      gloss = clamp(PC.w - 1.0, 0.0, 1.0);
      painted = 1.0;
      let PS = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SHAPE} + gBand), 0);
      if ((i32(PS.y) & 16) != 0) { metal = 1.0; }
      // GLOW (hard-surface task 3): primClip.w, the lane that was documented
      // spare until now. Loaded ONLY inside the painted branch — glow is
      // parse-gated on color=, so an unpainted pixel can never author one,
      // and this is the third texel a painted hit pixel pays for (colour,
      // shape, clip) and the last.
      primGlow = clamp(textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_CLIP} + gBand), 0).w, 0.0, 1.0);
    }
  }
${SHADING_NORMAL_BLOCK}
${WOUND_MASKS_BLOCK}
${TISSUE_BLOCK}

${ORGAN_BLOCK}

${MOTTLE_BLOCK}

${FACE_LAYER_WGSL}

${GORE_BLOCK}

${SOLDIER_MEAT_BLOCK}

${PAINT_CHAR_BLOCK}

${BURN_BLOCK}

${MELT_BLOCK}
`;

export const MARCH_BODY_TRACE = /* wgsl */ `${MARCH_TRACE_SETUP}${MARCH_TRACE_LOOP}${MARCH_TRACE_POST}`;
