// src/lab/sdf-zombie/webgpu/march/fields/wounds.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `wounds`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import {
  HELPERS,
  MARCH_BODY,
  CONE_MARCH,
  MAP_BODY,
  APPLY_WOUNDS,
  ROW_WOUND,
  ROW_WOUND_META,
  WOUND_MASK,
  WOUND_SHADOW,
  ROW_WOUND_CAP,
  ROW_WOUND_CUT,
  CALC_NORMAL,
} from '../../march.wgsl';
import { CUT_SHADE } from '../../../cut-wound';
import { declaredName } from '../../march-test-support';
import { WOUND_MASKS_BLOCK } from '../body/blocks/post/wound-masks.wgsl';
import { SKIN_NORMAL } from '../body/blocks/light/skin-detail-proto';
import { MAX_WOUNDS } from '../../../damage';

describe('ported features reach the entry point', () => {

  it('gates the everted rim on surface locality (no limb welding)', () => {
    const applyWounds = HELPERS.find(h => declaredName(h) === 'applyWounds')!;
    expect(applyWounds).toContain('rimLocal');
    expect(applyWounds).toMatch(/smoothstep\([^)]*dIn\)/);
    // Per-wound rim scales ride the spare ROW_WOUND_META channels: z multiplies
    // the splay (amplitude), w the offset (ring radius) — the "weapon calibre"
    // knobs that let a blast wear a tamer lip than a pellet.
    expect(applyWounds).toContain('wMeta.z');
    expect(applyWounds).toContain('wMeta.w');
    // The ramp is FULL amp wide (a 0.35-amp ramp had ~4x a distance field's
    // gradient and drew as bands — rim banding, 2026-08-22), and it reaches
    // -0.3..0.7: mostly OUTWARD, the proud everted lip of the owner-preferred
    // 2026-08-22 build. The 2026-08-23 flip to -0.65..0.35 kept the width but
    // pushed the ring's material INSIDE the cavity, where it drew as a pale
    // shelf/ball sitting in the hole (owner bisect, 2026-08-24). The floating
    // rims on thin features that motivated the flip are handled by the
    // per-wound rimScale (flesh-behind-the-hit) instead.
    expect(applyWounds).toMatch(/smoothstep\(-amp \* 0\.3, amp \* 0\.7, dIn\)/);
  });

  it('skips a wound before loading its meta/cap rows when the sample is out of reach (perf round 2 task 3)', () => {
    const iPos = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND} + band)`);
    const iReach = APPLY_WOUNDS.indexOf('if (perfCfg.y > 0.5 && r > reach) { continue; }');
    const iMeta = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND_META} + band)`);
    const iCap = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND_CAP} + band)`);
    expect(iPos).toBeGreaterThan(-1);
    expect(iReach).toBeGreaterThan(iPos);
    expect(iMeta).toBeGreaterThan(iReach);
    expect(iCap).toBeGreaterThan(iReach);
    // Reach covers the crater (2 depth, the nearWound radius), the smax
    // fillet (exact min beyond 4k, plus 0.25 m for how deep inside a limb
    // the running field can be) and three rim widths past the rim offset.
    expect(APPLY_WOUNDS).toContain(
      'let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + slack;');
    // Ship keeps the 0.25; the exact-fix switch narrows it to the running -d.
    expect(APPLY_WOUNDS).toContain('let slack = select(0.25, max(0.0, -d), gWoundExact > 0.5);');
  });

  it('tests the union-reach bound BEFORE the wound loop (close-up wound-cull task)', () => {
    // The whole economics argument: a sample outside every wound's reach
    // sphere must return (dIn, 0) — bit-identical to a loop whose every
    // iteration would `continue` past the reach early-out — WITHOUT paying a
    // single wound-row textureLoad. The bound is the CPU-computed bounding
    // sphere of the per-wound reach spheres (zombie-gpu.ts woundReachBound);
    // w = 1e9 is the no-cull identity (chunk torn ends, hands view).
    expect(APPLY_WOUNDS).toContain('woundBound: vec4<f32>');
    const iBound = APPLY_WOUNDS.indexOf('if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }');
    const iLoop = APPLY_WOUNDS.indexOf(`for (var k = 0; k < ${MAX_WOUNDS}; k = k + 1)`);
    const iFirstLoad = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND} + band)`);
    expect(iBound).toBeGreaterThan(-1);
    expect(iLoop).toBeGreaterThan(iBound);
    expect(iFirstLoad).toBeGreaterThan(iLoop);
    // Threading: mapBody hands it to applyWounds, and every entry point
    // that can reach a wounded field declares and forwards it.
    expect(MAP_BODY).toContain('applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band)');
    // crowd stage a: woundBound moves to the instance record; every mapBody
    // caller forwards the record pointer instead of per-instance uniforms.
    expect(MAP_BODY).toContain('let woundBound = gInstWoundBound;');
    for (const src of [MAP_BODY, CALC_NORMAL, CONE_MARCH, WOUND_SHADOW, MARCH_BODY]) {
      expect(src).toContain('inst: ptr<storage, array<vec4<f32>>, read>');
    }
    expect(MARCH_BODY).toContain('woundShadow(p, L, wsK, data, wsCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg, wsReach, wsSteps)');
    // inst and instCfg are bound POSITIONALLY LAST (the parser-count test
    // above pins the full order).
    const tail = MARCH_BODY.slice(MARCH_BODY.indexOf('levelShadowCfg: vec4<f32>'));
    expect(tail.indexOf('inst: ptr<storage, array<vec4<f32>>, read>')).toBeGreaterThan(tail.indexOf('levelShadowCfg: vec4<f32>'));
  });
});

describe('wound soft shadow (iq rsmshadows, wound-zone gated)', () => {
  // A crater reads as a BALL from many angles because its concave dish casts
  // no shadow — the missing cue is occlusion from the crater's own wall
  // (owner decision "cast shadow vs darker floor", 2026-08-24). iq's
  // sphere-traced soft shadow, fired ONLY near wounds.
  it('declares WOUND_SHADOW after MAP_BODY, which it calls', () => {
    expect(HELPERS.indexOf(WOUND_SHADOW)).toBeGreaterThan(HELPERS.indexOf(MAP_BODY));
    expect(WOUND_SHADOW).toContain('fn woundShadow(');
    expect(WOUND_SHADOW).toContain('mapBody(p + L * t');
  });
  it('WOUND_SHADOW takes reach and steps, so one call site serves the wound and self shadow', () => {
    expect(WOUND_SHADOW).toContain('reach: f32,');
    expect(WOUND_SHADOW).toContain('if (i >= steps || res < 0.02 || t > reach) { break; }');
  });
  it('fires only in the wound zone, and skips outright at strength 0', () => {
    // The gate is mapBody's nearWound zone (z component), captured from the
    // ACCEPTED hit sample in the march loop — NOT a radial distance-to-centre
    // mask (that shape of fade was itself the sweeping halo; see the pin on
    // woundMask m.y). Cost then scales with crater screen area, not screensize.
    expect(MARCH_BODY).toContain('var hitNearWound = false;');
    expect(MARCH_BODY).toContain('hitNearWound = nearWound;');
    expect(MARCH_BODY).toContain('if (wsOn || ssOn) {');
  });
  it('keeps the secondary-ray budget: 14 steps, clamped steps, tMax 0.4', () => {
    // Fill-bound renderer: 12-16 steps max, start t=0.02 (the field right at
    // the everted lip is not a clean distance bound), cap tMax ~0.4 m — this
    // is LOCAL crater self-shadowing, not global occlusion. Early-out once
    // fully shadowed.
    expect(WOUND_SHADOW).toContain('var t = 0.02;');
    expect(WOUND_SHADOW).toContain('for (var i = 0; i < 14; i = i + 1) {');
    // Triangulated coverage (iq's improved estimator, Claybook slide 39):
    // the closest point between the last two samples, not the sample itself.
    // Same budget — the estimator changes the per-sample maths, not the count.
    expect(WOUND_SHADOW).toContain('let y = h * h / (2.0 * ph);');
    expect(WOUND_SHADOW).toContain('res = min(res, k * dd / max(t - y, 1e-4));');
    expect(WOUND_SHADOW).toContain('if (i >= steps || res < 0.02 || t > reach) { break; }');
    expect(WOUND_SHADOW).toContain('t = t + clamp(h, 0.01, 0.06);');
    // Smooth field: no fbm in the shadow march (noiseAmp 0, like the cone).
    expect(WOUND_SHADOW).toContain('data, vec4<f32>(0.0), woundCfg, woundCfg2');
  });
  it('darkens ONLY the key diffuse + specular; fill/ambient/scatter stay lit', () => {
    // Multiply the whole lit sum and craters go pitch black — the fill and
    // the fake scatter are what keep the cavity readable from the dark side.
    // (keyI/keyC are the analytic-flashlight blend; with the beam off they
    // reduce to lightCfg.x/keyColor exactly — see the task-7 block below.)
    expect(MARCH_BODY).toContain(
      'albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao');
    expect(MARCH_BODY).toContain('shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss)');
    // The fill term must NOT carry the shadow...
    expect(MARCH_BODY).not.toContain('lightCfg.y * wShadow');
    // ...and strength mixes TOWARD 1 so the slider scales, never inverts.
    expect(MARCH_BODY).toContain(
      'woundShadow(p, L, wsK, data, wsCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg, wsReach, wsSteps)');
  });
});

describe('wound halo — ONE unified wound mask, no split shading overlays', () => {
  it('keeps the single 1.6x mask both channels agree on', () => {
    // Owner bisect verdict (2026-08-24): the halo was never the radial mask
    // itself — it was the MISMATCH between split mask edges. The 2026-08-23
    // crater pass split colouring (1.25x + facing gate), fresnel fade
    // (1.3x/2x, later carve-membership) and an AO darkening onto different
    // footprints, and every disagreement annulus drew as a grey ring or a
    // white crescent sweeping with the camera. The unified 1.6x mask's fade
    // edge coincides with its colour gradient, so it reads as wounded flesh,
    // not a ring. The far-side sheets those gates chased were the tracer
    // overshoot bug, fixed for real at the retract guard.
    expect(WOUND_MASK).toContain('1.0 - smoothstep(0.0, w.w * 1.6, rM)'); // rM = length(p - w.xyz) unless ragged
    // Entrails (2026-09-02) retargeted the return pin from
    // vec2<f32>(m, m): the mask now carries cavity-ness in .z, accumulated
    // over the SAME per-wound footprint — the contribution expression above
    // is computed once and maxed into both channels. Still one footprint,
    // still no split overlays.
    expect(WOUND_MASK).toContain('return vec3<f32>(m, m, cav);');
    expect(WOUND_MASK).not.toContain('smoothstep(-0.25, 0.15, face)');
    expect(WOUND_MASK).not.toContain('collar');
  });

  it('keeps the lighting free of wound-keyed gates and darkenings', () => {
    expect(MARCH_BODY).not.toContain('keyGate');
    expect(MARCH_BODY).not.toContain('shineOcc');
    expect(MARCH_BODY).not.toContain('ao * (1.0 - 0.55 * smoothstep(0.35, 1.0, wm))');
    expect(MARCH_BODY).toContain('albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao');
  });

  it('routes ambient through ambientAt, and pays for it once', () => {
    // The seam from the lighting spec. One call, before the two sites that
    // consume it — recomputing per-site would double an already-unrolled
    // six-wall accumulation for no gain.
    expect(MARCH_BODY.match(/ambientAt\(/g) ?? []).toHaveLength(1);
    // The key path keeps keyColor; the ambient path must NOT be tinted by
    // the lamp any more. That tint is exactly what ambientAt now decides.
    expect(MARCH_BODY).not.toContain('(lightCfg.y + diff');
  });
});

describe('cut wounds in the march', () => {
  it('applyWounds has a cut branch (flag 32) before the preset branch, reading ROW_WOUND_CUT', () => {
    const iCut = APPLY_WOUNDS.indexOf('(i32(wFlags.x) & 32) != 0');
    const iPreset = APPLY_WOUNDS.indexOf('if (wMeta.x < -0.5)');
    expect(iCut).toBeGreaterThan(0);
    expect(iCut).toBeLessThan(iPreset);
    expect(APPLY_WOUNDS).toContain(`${ROW_WOUND_CUT} + band`);
  });
  it('woundMask paints a cut footprint and skips the radial one for it', () => {
    expect(WOUND_MASK).toContain('(fBits & 32) != 0');
    expect(WOUND_MASK).toContain(`${ROW_WOUND_CUT} + gBand`);
  });
  // cut-wound.ts cutCarve is the CPU mirror: the slot's terms must be the same ones, in the same form.
  it('the cut branch mirrors cutCarve term for term (depth coordinate, depth clamp, taper, jag, kerf taper, carve)', () => {
    const iCut = APPLY_WOUNDS.indexOf('(i32(wFlags.x) & 32) != 0');
    const branch = APPLY_WOUNDS.slice(iCut, APPLY_WOUNDS.indexOf('if (wMeta.x < -0.5)'));
    const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
    expect(branch).toContain('let side = cross(calong, cin);');
    expect(branch).toContain('let cs = max(-dIn, dot(rel, cin) - wMeta.w);');
    expect(branch).toContain('let tN = clamp(ca / max(w.w, 1e-4), -1.0, 1.0);');
    expect(branch).toContain('let prof = 1.0 - tN * tN;');
    // cutTaper: the lens squared, for depth and kerf alike (no one-kerf depth floor any more).
    expect(branch).toContain('let taper = prof * prof;');
    expect(branch).toContain(`let dEff = min(wCap.w, ${f(CUT_SHADE.maxDepthPerHalfLen)} * w.w);`);
    expect(branch).toContain('let depthT = max(dEff * taper, 1e-4);');
    // The jag the CPU mirror takes as `jag` (cut-wound.test.ts ports this noise): fine wall jag at jagCycles per kerf,
    // plus the pinch, 1-D value noise along the slot at pinchCycles per half-length, pinchAmp + pinchTip x tN^2.
    expect(branch).toContain(`let jq = ${f(CUT_SHADE.jagCycles)} / max(wCut.w, 1e-4);`);
    expect(branch).toContain(`let jagFine = noise3(vec3<f32>(ca, cu, dot(rel, cin)) * jq + vec3<f32>(w.w * 311.0, wCut.w * 977.0, 17.0)) * ${f(CUT_SHADE.jagAmp)};`);
    expect(branch).toContain(`let cPx = ca / max(w.w, 1e-4) * ${f(CUT_SHADE.pinchCycles)} + wCut.w * 1531.0;`);
    expect(branch).toContain('let cPn = mix(hash13(vec3<f32>(cPi, w.w * 311.0, 5.0)), hash13(vec3<f32>(cPi + 1.0, w.w * 311.0, 5.0)), cPf * cPf * (3.0 - 2.0 * cPf)) * 2.0 - 1.0;');
    expect(branch).toContain(`let jag = jagFine + cPn * (${f(CUT_SHADE.pinchAmp)} + ${f(CUT_SHADE.pinchTip)} * tN * tN);`);
    expect(branch).toContain('let kerfT = wCut.w * max(1.0 + jag, 0.0) * taper;');
    expect(branch).toContain('let vWall = kerfT * (1.0 - clamp(cs, 0.0, depthT) / depthT) - abs(cu);');
    // The fillet's kerf is capped at blendDepthFrac x dEff (cut-wound.ts cutBlendK).
    expect(branch).toContain(`d = smax(d, carve, woundCfg.y * clamp(min(wCut.w, ${f(CUT_SHADE.blendDepthFrac)} * dEff) / 0.05, 0.1, 1.0));`);
    // The lid on the RAW plane (dot(rel, cin) + kerf + lidSlack x halfLen): cutCarve's fourth min() term.
    expect(branch).toContain(`let carve = min(min(min(vWall, depthT - cs), w.w - abs(ca)), dot(rel, cin) + wCut.w + ${f(CUT_SHADE.lidSlack)} * w.w) * ${f(CUT_SHADE.carveK)};`);
    // A row with no inward axis carves nothing (first statement of the branch).
    expect(branch).toMatch(/^\(i32\(wFlags\.x\) & 32\) != 0\) \{\s*(\/\/[^\n]*\n\s*)*if \(length\(wCap\.xyz\) < 0\.5\) \{ continue; \}/);
    // The running d is the carve target; dIn (pre-wound) is the depth reading. A cut never reaches the crater rim
    // code, which reads META.w as an offset scale (for a cut it is the sag).
    expect(branch).not.toMatch(/max\(-d,/);
    expect(branch).toMatch(/continue;\s*}\s*(\/\/[^\n]*\n\s*)*$/);
  });
  // cut-wound.ts cutLip is the CPU mirror of the lip: amp x exp(-lx^2) x rim x offKerf x nearSkin.
  it('the cut lip mirrors cutLip term for term (bounded to the near skin, kept off the kerf)', () => {
    const iCut = APPLY_WOUNDS.indexOf('(i32(wFlags.x) & 32) != 0');
    const branch = APPLY_WOUNDS.slice(iCut, APPLY_WOUNDS.indexOf('if (wMeta.x < -0.5)'));
    const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
    expect(branch).toContain(`let lipW = max(wCut.w * ${f(CUT_SHADE.lipWidth)}, 1e-4);`);
    expect(branch).toContain(`let lx = (abs(cu) - wCut.w * ${f(CUT_SHADE.lipOffset)}) / lipW;`);
    expect(branch).toContain(`let cutAmp0 = wCut.w * ${f(CUT_SHADE.lipHeight)} * min(wMeta.z, ${f(CUT_SHADE.maxLipScale)});`);
    expect(branch).toContain('let cutAmp = cutAmp0 * taper;');
    expect(branch).toContain(`let cutRimB = ${f(CUT_SHADE.rimSpan)} * max(cutAmp0, lipW);`);
    expect(branch).toContain('let cutRim = 1.0 - smoothstep(-0.3 * cutRimB, 0.7 * cutRimB, dIn);');
    // The lip is kept off the SMOOTH kerf, not the jagged one (the jag's slope stays out of the lip).
    expect(branch).toContain('let kerfS = wCut.w * taper;');
    expect(branch).toContain('let offKerf = smoothstep(kerfS, kerfS + lipW, abs(cu));');
    expect(branch).toContain('let nearSkin = 1.0 - smoothstep(0.0, max(min(2.0 * lipW, dEff), 1e-4), cs);');
    expect(branch).toContain('d = d - cutAmp * exp(-lx * lx) * cutRim * offKerf * nearSkin;');
    // taper is 0 past the tips, so the old step(abs(ca), w.w) gate was redundant.
    expect(branch).not.toContain('step(abs(ca)');
  });
  // cut-wound.ts cutMask is the CPU mirror of the footprint: band x ends x far x back, far measured from the chord plane -
  // sag; the band narrows to nothing at maskEnd x halfLen, its width ragged by noise (cutMask's `jag`, |jag| <= maskJag).
  it('the cut mask mirrors cutMask term for term (no infinite slab along the inward axis)', () => {
    const iCut = WOUND_MASK.indexOf('(fBits & 32) != 0');
    const branch = WOUND_MASK.slice(iCut, WOUND_MASK.indexOf('var rM = length(p - w.xyz);'));
    const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
    expect(branch).toContain(`let cSag = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META} + gBand), 0).w;`);
    expect(branch).toContain('let cPlane = dot(crel, cIn) - cSag;');
    expect(branch).toContain('let cKerf = max(cCut.w, 1e-4);');
    expect(branch).toContain(`let cDEff = min(cCap.w, ${f(CUT_SHADE.maxDepthPerHalfLen)} * w.w);`);
    expect(branch).toContain(`let cEnd = ${f(CUT_SHADE.maskEnd)} * max(w.w, 1e-4);`);
    expect(branch).toContain(`let cJag = noise3(vec3<f32>(cAs, cUs, 0.0) * (${f(CUT_SHADE.maskCycles)} / cKerf) + vec3<f32>(w.w * 173.0, cKerf * 619.0, 41.0)) * ${f(CUT_SHADE.maskJag)};`);
    expect(branch).toContain('let cMw = sqrt(clamp(1.0 - (cA / cEnd) * (cA / cEnd), 0.0, 1.0)) * max(1.0 + cJag, 0.0);');
    expect(branch).toContain(`let cBand = 1.0 - smoothstep(cKerf * cMw, cKerf * ${f(CUT_SHADE.maskWidth)} * cMw + 1e-4, cU);`);
    expect(branch).toContain('let cEnds = 1.0 - smoothstep(0.9 * cEnd, cEnd, cA);');
    expect(branch).toContain('let cFar = 1.0 - smoothstep(cDEff + cKerf, cDEff + 2.0 * cKerf, cPlane);');
    expect(branch).toContain('let cNi = dot(nrm, cIn);');
    expect(branch).toContain('let cBack = 1.0 - smoothstep(0.25, 0.6, cNi);');
    // The skin band beyond the jagged walls' reach keeps to skin facing out of the cut's mouth (cutMask's face gate).
    expect(branch).toContain(`let cWall = cKerf * ${f(1 + CUT_SHADE.jagAmp)};`);
    expect(branch).toContain('let cInner = 1.0 - smoothstep(cWall, 1.3 * cWall, cU);');
    expect(branch).toContain(`let cFace = 1.0 - smoothstep(${f(CUT_SHADE.maskFace[0])}, ${f(CUT_SHADE.maskFace[1])}, cNi);`);
    expect(branch).toContain('let cC = cBand * cEnds * cFar * min(cBack, max(cInner, cFace));');
    // A row with no inward axis paints nothing: the guard comes right after the CAP load, before any frame math.
    expect(branch).toMatch(/let cCap = textureLoad\([^\n]*\n\s*(\/\/[^\n]*\n\s*)*if \(length\(cCap\.xyz\) < 0\.5\) \{ continue; \}/);
    expect(branch).toMatch(/continue;\s*}\s*$/);
  });
  // nrm is read by exactly one thing in woundMask: the cut branch's back-facing gate. The call site hands it the smooth
  // normal (analytic gradient, no pore noise), which SKIN_NORMAL defines upstream of the mask block.
  it('woundMask reads nrm only in the cut back gate, and the call passes the smooth normal', () => {
    expect(WOUND_MASK.match(/\bnrm\b/g)).toHaveLength(2); // the parameter and the cNi dot (the back and face gates)
    expect(WOUND_MASK).toContain('fn woundMask(p: vec3<f32>, nrm: vec3<f32>,');
    // (The head split: at the hit piece's un-warped point pS, with that normal turned into the piece's frame,
    // nSmoothS. Both are p and nSmooth themselves off a turned half.)
    expect(WOUND_MASKS_BLOCK).toContain('var nSmoothS = nSmooth;');
    expect(WOUND_MASKS_BLOCK).toContain('woundMask(pS, nSmoothS, data, woundCfg, woundCfg2)');
    expect(WOUND_MASKS_BLOCK).not.toMatch(/woundMask\(p,|woundMask\(pS, n,/);
    expect(SKIN_NORMAL).toContain('var nSmooth = n;');
  });
});
