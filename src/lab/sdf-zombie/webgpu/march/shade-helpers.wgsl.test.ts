// src/lab/sdf-zombie/webgpu/march/shade-helpers.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `shade-helpers`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { HELPERS, MARCH_BODY, LEVEL_SHADOW } from '../march.wgsl';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (see the comment in helpers.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';

describe('level shadows on bodies (perf round 2 task 7)', () => {
  // Bodies CAST via the spanned shadow hull but never RECEIVE: a zombie
  // behind a pillar is lit by the flashlight. The flashlight's own map is
  // poisoned for this — the body's inflated hull is IN it, so every flesh
  // point would shadow itself. The map sampled here comes from a TWIN
  // spotlight (dungeon-lighting.ts) that renders layer 0 (the level) only.
  it('applies the level shadow map to the key term only, and only when enabled', () => {
    expect(LEVEL_SHADOW).toContain('fn levelShadow(p: vec3<f32>, n: vec3<f32>, shadowTex: texture_depth_2d, shadowMat: mat4x4<f32>, cfg: vec4<f32>) -> f32');
    expect(LEVEL_SHADOW).toContain('if (cfg.x < 0.5) { return 1.0; }');
    expect(MARCH_BODY).toContain('let lvl = levelShadow(p, n, levelShadowTex, levelShadowMatrix, levelShadowCfg);');
    expect(MARCH_BODY).toContain('diff * wShadow * lvl * keyI * keyC');
  });
  it('darkens the key specular with the same factor; the signature ends with the three new slots', () => {
    expect(MARCH_BODY).toContain('shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss)');
    // Positional-binding tripwire (see the ORDER MATTERS note in
    // createMarchMaterial): the new slots sit at the very END, after
    // bodyHalf, in the exact order the JS object binds them.
    const tail = MARCH_BODY.slice(MARCH_BODY.indexOf('levelShadowTex: texture_depth_2d'));
    expect(tail.indexOf('levelShadowTex: texture_depth_2d')).toBeGreaterThan(-1);
    expect(tail.indexOf('levelShadowMatrix: mat4x4<f32>')).toBeGreaterThan(tail.indexOf('levelShadowTex: texture_depth_2d'));
    expect(tail.indexOf('levelShadowCfg: vec4<f32>')).toBeGreaterThan(tail.indexOf('levelShadowMatrix: mat4x4<f32>'));
  });
  it('is parse-checked as a helper and normal-biases the lookup position', () => {
    expect(HELPERS).toContain(LEVEL_SHADOW);
    // The bias step keeps the body's own surface off the shadow plane (acne);
    // it is cfg.y so the owner can raise it live.
    expect(LEVEL_SHADOW).toContain('shadowMat * vec4<f32>(p + n * cfg.y, 1.0)');
  });
  it('the real wgslFn parser sees the three slots as the last inputs — no comment phantoms', () => {
    // WGSLNodeFunction sweeps the WHOLE parameter list — comments included —
    // with /name\s*:\s*type/ to find inputs. Any `word: word` colon pattern
    // inside a signature comment becomes a PHANTOM input: the call site then
    // binds float(0) into that slot and every real binding after it shifts
    // by one (seen 2026-09-02 — a comment's "cfg gates it: at" inserted one
    // between bodyHalf and levelShadowTex and the pipeline died with
    // "cannot convert abstract-float to texture_depth_2d"). This test runs
    // the actual parser, not a string grep, so no comment can reintroduce it.
    const parsed = new WGSLNodeFunction(MARCH_BODY);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    // 66 on the perf round-2 chain; +8 from the wound-pass-r2 merge (counts2,
    // surfCfg3, fatColor, boneColor and the viscera/gut slots); +1 from the
    // melt task-6 meltCfg slot. BOTH sides of the 2026-09-04 merge added a
    // uniform named meltCfg independently — the zombie melt's progress slot
    // (kept) and the parked melt spike's amp/freq/time slot (removed) — so
    // this count is +1, not +2. That collision is exactly what this pin is
    // for. Re-pin when a slot is added ON PURPOSE — a silent change here is
    // the phantom-input bug. +1 windDrift, +1 bodyAnchor (shell warp), +1 woundBound
    // (wound-cull), +2 depth prepass (depthPreTex, depthPreCfg) - all appended after
    // the level-shadow tail, in that order. +1 opt-in faceGlowRedOnly mask.
    // +5 static probe grid (probeTex, probeMin, probeInvExtent, probeDims,
    // probeCfg) appended after normalGradientCfg — lighting P3 step 1.
    // +4 flashlight bounce spot (bounceSpotPos, bounceSpotNormal,
    // bounceSpotRadiance, bounceSpotCfg) after probeCfg — lighting P4 step 1.
    // +2 GPU probe gather dynamic layer (probeDyn storage, probeDynCfg).
    // +1 direct muzzle flash (bodyFlash).
    // +3 temporal reprojection start (lastTex, lastInvVp, temporalCfg) — plan 2026-09-10.
    // +1 meatCfg (soldier wound MEAT DETAIL, wound panel MEAT group, 2026-09-12), after surfCfg3.
    // crowd stage a: 13 per-instance params move into the record, +inst +instCfg.
    // crowd stage a task 5: +instCentre +instHalf (the instanced proxy box).
    // +5 burning body (burnCfg, burnNoiseScale, burnRiseSpeed, burnCharPatch,
    // burnFireGain) after instHalf — flame lab task 5, POSITIONALLY LAST to
    // match createMarchMaterial's binding tail.
    // +1 burnFireCoverage (fix pass) after burnFireGain, same positional rule.
    // +1 burnSkeleton (fix pass task 3) after burnFireCoverage — the skeleton
    // show-through strength, last so the tail keeps growing in commit order.
    // +1 skeletonDepth (flame-polish task 4) after burnSkeleton — the reveal
    // depth, same positional rule.
    expect(names.length).toBe(99);
    expect(names).toContain('faceGlowRedOnly');
    expect(names.slice(-29)).toEqual([
      'depthPreTex', 'depthPreCfg', 'normalGradientCfg',
      'probeTex', 'probeMin', 'probeInvExtent', 'probeDims', 'probeCfg',
      'bounceSpotPos', 'bounceSpotNormal', 'bounceSpotRadiance', 'bounceSpotCfg',
      'probeDyn', 'probeDynCfg',
      'lastTex', 'lastInvVp', 'temporalCfg', 'inst', 'instCfg', 'instCentre', 'instHalf',
      'burnCfg', 'burnNoiseScale', 'burnRiseSpeed', 'burnCharPatch', 'burnFireGain',
      'burnFireCoverage', 'burnSkeleton', 'burnSkeletonDepth',
    ]);
    // The temporal start folds in AFTER preStart, with bodyEntry as the
    // sixth lower-bound term (see the other pin above for the argument).
    expect(MARCH_BODY).toContain('var t = clamp(max(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), winFar), 0.0, tMax);');
    expect(MARCH_BODY).toContain('temporalStartFetch(lastTex, tempNdc, lastInvVp, camPos, rd, temporalCfg)');
    // Own-body gate + inside check: the reprojected point must sit in THIS
    // body's box and the start must be outside the field AND outside a
    // wound's near zone (mapBody.z — the field is not a bound beside a
    // crater; a start there banded the wounded closeup at a 0.05 m margin).
    // The shellAmp backoff keeps the start outside the DISPLACED silhouette
    // too, and the recovery probes rewind (2x penetration when inside,
    // 0.15 fixed when in-zone) instead of dropping the bound.
    expect(MARCH_BODY).toContain('temp.y >= bodyEntry - temporalCfg.y && temp.y <= tMax + temporalCfg.y');
    expect(MARCH_BODY).toContain('var s = temp.x - woundCfg2.z;');
    expect(MARCH_BODY).toContain('if (probe == 3 || (dres0.x > 0.0 && dres0.z < 0.5)) { break; }');
    expect(MARCH_BODY).toContain('let back = select(s + 2.0 * dres0.x, s - 0.15, dres0.z >= 0.5);');
    expect(MARCH_BODY).toContain('if (dres0.x > 0.0 && dres0.z < 0.5) {');
    // HULL-RELATIVE CAP: the accepted start tightens at most 6 cm past the
    // current frame's hull face — stale history cannot move the start deeper
    // than that, which is what bounds the swing-tip see-through holes.
    expect(MARCH_BODY).toContain('s = min(s, shellIn + 0.06);');
    expect(MARCH_BODY).toContain('tempStart = s;');
    // crowd stage a: the record pointer and its config are the two new
    // positional tails, in signature order (the JS binding object matches).
    // crowd stage a task 5: instCentre/instHalf follow them (the proxy box).
    // flame lab task 5: the burn tail (5 slots) follows THEM — burn is per-view,
    // so the per-instance params stay directly ahead of it.
    expect(names.indexOf('instCfg')).toBe(names.length - 11);
    expect(names.indexOf('inst')).toBe(names.length - 12);
    expect(names.indexOf('instCentre')).toBe(names.length - 10);
    expect(names.indexOf('instHalf')).toBe(names.length - 9);
    expect(names.indexOf('burnCfg')).toBe(names.length - 8);
    expect(names.indexOf('burnFireGain')).toBe(names.length - 4);
    expect(names.indexOf('burnFireCoverage')).toBe(names.length - 3);
    expect(names.indexOf('burnSkeleton')).toBe(names.length - 2);
    expect(names.indexOf('burnSkeletonDepth')).toBe(names.length - 1);
  });
});
