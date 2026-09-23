// src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): march trace setup/loop/post and assembled trace.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { WOUND_STEP_MUL } from '../layout';
import { FACE_LAYER_WGSL } from './face.wgsl';
import { TILE_PRELOAD_BLOCK } from './blocks/setup/tile-preload.wgsl';
import { WOUND_LIST_BLOCK } from './blocks/setup/wound-list.wgsl';
import { HULL_BOUNDS_BLOCK } from './blocks/setup/hull-bounds.wgsl';
import { RAY_WINDOW_BLOCK } from './blocks/setup/ray-window.wgsl';
import { STEP_CONFIG_BLOCK } from './blocks/setup/step-config.wgsl';
import { START_BOUNDS_BLOCK } from './blocks/setup/start-bounds.wgsl';
import { DEBUG_COUNTERS_BLOCK } from './blocks/loop/debug-counters.wgsl';
import { PRIM_MATERIAL_BLOCK } from './blocks/post/prim-material.wgsl';
import { SHADING_NORMAL_BLOCK } from './blocks/post/shading-normal.wgsl';
import { WOUND_MASKS_BLOCK } from './blocks/post/wound-masks.wgsl';
import { TISSUE_BLOCK } from './blocks/post/tissue.wgsl';
import { ORGAN_BLOCK } from './blocks/post/organ.wgsl';
import { MOTTLE_BLOCK } from './blocks/post/mottle.wgsl';
import { GORE_BLOCK } from './blocks/post/gore.wgsl';
import { SOLDIER_MEAT_BLOCK } from './blocks/post/soldier-meat.wgsl';
import { PAINT_CHAR_BLOCK } from './blocks/post/paint-char.wgsl';
import { BURN_BLOCK } from './blocks/post/burn.wgsl';
import { MELT_BLOCK } from './blocks/post/melt.wgsl';

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
  // DISTANCE SPLIT, FAR PASS EARLY-OUT (2026-09-23): the proxy draws its BACK faces, so worldPos is
  // where the ray leaves the box; a box that ends nearer than the split (-depthPreCfg.w) holds nothing
  // for the far pass. Discard before the tile preload / wound list / hull bounds instead of in the ray
  // window after them: measured, the far pass cost 7.2-7.5 ms in the melee crush, most of it paying
  // that setup at half scale on the NEAR bodies' boxes. Off (w >= 0) on every ship frame.
  if (!quadMode && depthPreCfg.w < 0.0 && length(worldPos - camPos) < -depthPreCfg.w) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  // PERF INSTRUMENTATION (task 2): debugCfg.x 0 = off, 1 = steps-per-pixel
  // heatmap, 2 = prims-per-pixel. Everything below is guarded so the
  // shipping path pays exactly one uniform branch; gDebugMode hands the
  // flag to mapBody's fold without forking its signature.
  if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0; gDebugSteps = 0.0; gDebugWoundRows = 0.0; gDebugRefolds = 0.0; gDebugRefoldWins = 0.0; gDebugBones = 0.0; gDebugVolumeSamples = 0.0; gDebugVolumeFallbacks = 0.0; }
${TILE_PRELOAD_BLOCK}
${WOUND_LIST_BLOCK}
${HULL_BOUNDS_BLOCK}
${RAY_WINDOW_BLOCK}
${STEP_CONFIG_BLOCK}
${START_BOUNDS_BLOCK}
  // NEAR-MISS EDGE (checker edge experiment, 2026-09-23): the closest the walk came to a surface, in
  // footprint units (field distance / (t * aaCfg.x)). Tracked only while the edge switch
  // (gInstMelt.y == 2, set by the layer with the checker) is on; a missed ray then writes it
  // instead of discarding (MARCH_TRACE_POST). Declared here, not in the loop, because REFINE_LOOP
  // replaces the loop section and its post must still compile.
  var missNear = 1e9;
`;

/** Run 5 (plan 2026-09-13-neural-upscale-run5-sdf-refine): the walk alone — from `var t` to the
 *  line before `if (!hit) { discard; }`. REFINE_LOOP replaces exactly this section. */
export const MARCH_TRACE_LOOP = /* wgsl */ `  var t = clamp(max(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), winFar), 0.0, tMax);
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
  // Which limb's re-fold won at the ACCEPTED sample (gRefoldWin, 0 = none), for
  // the NORMAL HINT around calcNormal. Re-assigned every iteration like the rest.
  var hitRefold = 0.0;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }
    // 0.0, not marchCfg.z: the field mapBody returns stays SMOOTH — the fbm
    // still reaches the normal only via calcNormal — but inside a thin shell
    // of the surface the same fbm is added to the REAL stepped distance just
    // below, which is where the silhouette gets its bumps back without
    // paying fbm at every step of the empty approach.
    gWalkStep = 1.0;
    let dres = mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
    gWalkStep = 0.0;
    // WALK SKIP bookkeeping: a call that ran the re-fold refreshes the gap (0 if any
    // limb won); a call that skipped it keeps the decremented budget; a call where the
    // gate never opened leaves no promise (0).
    if (gWalkAttempted > 0.5) { gWalkGap = gWalkGapNew; } else if (!(gWalkGap > 0.0)) { gWalkGap = 0.0; }
    let distort = max(gFoldBestDistort, 1.0);
    // DISTANCE-BASED ACCEPT (aaCfg.z/w, 2026-09-22): a stronger footprint accept up
    // close, fading to aaCfg.y over [w/2, w] metres (the owner saw the fattened edge
    // on FAR bodies only). z = 0 keeps the old aaK exactly.
    let aaKt = select(aaK, aaCfg.x * mix(aaCfg.z, aaCfg.y, smoothstep(aaCfg.w * 0.5, aaCfg.w, t)), aaCfg.z > 0.0);
    var d = dres.x;
    hitBest = i32(dres.y);
    hitField = dres;
    hitRefold = gRefoldWin;
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
    if (gInstMelt.y > 1.5 && t > 1e-3) { missNear = min(missNear, radius * distort / (t * aaCfg.x)); }
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
      let hitEps = max(hitEpsBase, t * aaKt / distort);
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
        if (d < -max(hitEpsBase, t * aaKt / distort) && omega > 1.0 && !conservative) {
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
    gWalkGap = gWalkGap - 4.0 * abs(stepLen);
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
${DEBUG_COUNTERS_BLOCK}
`;

export const MARCH_TRACE_POST = /* wgsl */ `  if (!hit) {
    // NEAR-MISS EDGE: with the edge switch on, a ray that passed within 16 footprints of a surface
    // writes that distance (x) under the -7 sentinel (y; the clear colour can never be negative)
    // instead of discarding. w < 0 tells the material to write a miss depth just short of the far
    // plane (nearer miss wins the depth test, any hit beats every miss) and alpha 1 (still a miss
    // to every reader). Off, this is the old discard exactly.
    if (gInstMelt.y > 1.5 && missNear < 16.0) { return vec4<f32>(missNear, -7.0, 0.0, -1.0); }
    discard;
  }
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
${PRIM_MATERIAL_BLOCK}
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
