// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/hull-bounds.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `hull-bounds`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from '../../../../march.wgsl';

describe('ported features reach the entry point', () => {

  it('does NOT bound tMax by the occluder — the bound under-reports at range', () => {
    // 2026-09-01, the owner's "zombies are full of holes until you get fairly
    // close". The inner hull is sound GEOMETRY (every emitted sphere sits at
    // least its own radius inside the posed flesh — __sdfGame.hullInsideness
    // reports 0 of 300 outside), but the DISTANCE the pre-pass rasterises for
    // it is accurate only in the near field. Measured with one synthetic
    // sphere of known centre and radius, and the error tracks distance alone,
    // not the sphere's radius or its screen size:
    //
    //   true 2.4 -> 2.405 (exact)    true 4.9 -> 4.252
    //   true 7.9 -> 3.782            true 11.9 -> 0.367
    //
    // An under-reported occT puts tMax IN FRONT of the surface, so the ray
    // gives up before reaching skin and the fragment discards — per pixel,
    // wherever the hull covers, and worse the further away the body is. On a
    // single isolated zombie at 4.9 m that destroyed 1369 of 1375 lost
    // pixels, worst case 0.68 m short.
    //
    // Re-adding the term reintroduces the bug, so this test pins its absence
    // rather than its shape. Revive it only once the pre-pass writes a
    // distance that survives syntheticSphereCheck at range; the full
    // measurement is in march.wgsl.ts above tMax.
    // tMaxBox is the raw proxy-box far plane; the hull-exit fold (perfCfg.x)
    // never references occT, so an occluder bound cannot sneak back in here.
    expect(MARCH_BODY).toContain('let tMaxBox = length(worldPos - camPos);');
    expect(MARCH_BODY).not.toContain('occT + woundCfg2.z');
    // occT stays PLUMBED — debug mode 3 heats it, and reviving the bound
    // should not need the parameter threaded back through.
    expect(MARCH_BODY).toContain('occT: f32');
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
    // The prepass inputs ride POSITIONALLY LAST (after windDrift), and the
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
