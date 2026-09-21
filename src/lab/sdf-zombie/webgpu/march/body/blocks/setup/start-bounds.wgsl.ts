// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/start-bounds.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): cone, depth-prepass and temporal ray start bounds.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const START_BOUNDS_BLOCK = /* wgsl */ `  // Start where the cone pre-pass proved the tile is still empty, rather than
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
      var dres0 = vec4<f32>(0.0);
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
      // One mapBody call site (cold-compile 2026-09-21): the first probe and
      // the three recovery probes share it — every call site is an inlined
      // copy of the field in the Metal compile. Same probes, same order.
      for (var probe = 0; probe < 4; probe = probe + 1) {
        dres0 = mapBody(camPos + rd * s, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
        if (probe == 3 || (dres0.x > 0.0 && dres0.z < 0.5)) { break; }
        let back = select(s + 2.0 * dres0.x, s - 0.15, dres0.z >= 0.5);
        if (back <= 0.0) { break; }
        s = back;
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
  // shared shellIn and walk their own empty proxy space.`;
