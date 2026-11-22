// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/hull-bounds.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `hull-bounds`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from '../../../../march.wgsl';

describe('ported features reach the entry point', () => {

  it('bounds tMax by the occluder target on the un-relaxed path only (kit occlusion, 2026-10-26)', () => {
    // Removed 2026-09-01 because the pre-pass distance under-reported at range
    // ("bodies full of holes until you get fairly close"). That decay was SCENE
    // FOG mixed into the written distance (root-caused 2026-09-04; fog = false on
    // every distance material), so the bound is exact again. It came back for
    // opaque kit cloth: flesh behind cloth loses the depth test to the cloth, so
    // the ray may stop there. Relaxed path excluded: its clamped final sample at
    // tMax would sit ON the cloth and the AA epsilon could accept it as a hit.
    expect(MARCH_BODY).toContain('let tMaxBox = length(worldPos - camPos);');
    expect(MARCH_BODY).toContain('let tMaxOcc = select(tMaxSel, min(tMaxSel, occT + woundCfg2.z), !relax);');
    expect(MARCH_BODY.indexOf('let tMaxOcc =')).toBeLessThan(MARCH_BODY.indexOf('let tMax = min('));
  });

  it('bounds the march by the outer hull, and is an identity when it is off', () => {
    // shellOut <= 0 means no hull covers the pixel, so no surface can be
    // there. The RETURN matters as much as the discard: WGSL discard demotes
    // the invocation but does not stop it, so without the return the pixel
    // still walks its whole budget before being thrown away.
    expect(MARCH_BODY).toContain('if (shellOut <= 0.0) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }');
    // The ray may start at the hull's near face; max() with startT so the cone
    // pre-pass is not thrown away when it reaches further. Close-up task 3
    // adds a THIRD lower bound — the quarter-res depth prepass — nested as
    // max(max(startT, shellIn), preStart): the max of lower bounds is the
    // tightest of them and still a lower bound. preStart collapses to 0 when
    // the pass is off, which is the identity inside the max.
    // tempStart (plan 2026-09-10) is the fifth max term; 0 is its identity
    // too. bodyEntry is the sixth: the proxy box contains the hull contains
    // the flesh, so the ray-box entry is a lower bound like the others — and
    // it catches the pixels whose temporal gate failed, which used to
    // restart from the shared shellIn and walk their own empty proxy space.
    expect(MARCH_BODY).toContain('var t = clamp(max(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), winFar), 0.0, tMax);');
    // The prepass inputs ride at the signature tail (appended after
    // windDrift), and the
    // disabled identity is the fetch's 0 — never a missing binding (the
    // meltCfg rule: a declared input without a binding shades as zero and
    // only logs).
    expect(MARCH_BODY.indexOf('depthPreTex: texture_2d<f32>')).toBeGreaterThan(-1);
    expect(MARCH_BODY.indexOf('depthPreCfg: vec4<f32>')).toBeGreaterThan(MARCH_BODY.indexOf('depthPreTex: texture_2d<f32>'));
    expect(MARCH_BODY.indexOf('inst: ptr<storage, array<vec4<f32>>, read>')).toBeGreaterThan(MARCH_BODY.indexOf('depthPreCfg: vec4<f32>'));
    expect(MARCH_BODY).toContain('let preStart = select(0.0, max(preT - (preT * depthPreCfg.y + 0.0012 + woundCfg2.z), 0.0), preT > 0.0);');
    // Both parameters exist, so a material built without a shell source still
    // type-checks and takes the 0 / 1e9 identities.
    expect(MARCH_BODY).toContain('shellIn: f32');
    expect(MARCH_BODY).toContain('shellOut: f32');
    // The hull exit bounds tMax ONLY on the un-relaxed path and only behind
    // perfCfg.x. The relaxed tracer takes a clamped final sample at tMax;
    // clamping to the hull put that sample on the hull and rendered a halo
    // (2026-08-31 visual gate), so above omega 1.0 the proxy-box far plane
    // stays the bound regardless of the seam.
    expect(MARCH_BODY).toContain('perfCfg: vec4<f32>');
    expect(MARCH_BODY.indexOf('shellOut: f32')).toBeLessThan(MARCH_BODY.indexOf('perfCfg: vec4<f32>'));
    expect(MARCH_BODY).toContain('let tMaxSel = select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax);');
    expect(MARCH_BODY.indexOf('let relax = woundCfg2.y > 1.0;'))
      .toBeLessThan(MARCH_BODY.indexOf('let tMaxSel = select('));
  });
});
