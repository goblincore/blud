// src/lab/sdf-zombie/webgpu/march/body/blocks/post/split-hit.wgsl.test.ts
//
// THE HEAD SPLIT after the hit (split-hit.wgsl.ts and its readers). Nothing here compiles a shader. The text pins
// hold WHERE each post-hit block reads the body (the un-warped point, the turned frame) and where it must not (the
// lighting, and every closed body: no rotation runs off a turned half). What the formulas COMPUTE is tested by value:
// a hand twin of the WGSL against head-split.ts unwarpPoint / unwarpDir / warpDir.

import { describe, it, expect } from 'vitest';
import {
  MARCH_BODY, REFINE_BODY, REFINE_LOOP, MARCH_TRACE_LOOP, MARCH_TRACE_POST, MARCH_BODY_SURFACE_PREP, MARCH_BODY_LIGHT,
  FACE_LAYER_WGSL, Q_ROT, Q_MUL, SPLIT_MOVE_BACK,
} from '../../../../march.wgsl';
import { MARCH_SURFACE } from '../../../../deferred-sdf';
import { SPLIT_HIT_BLOCK } from './split-hit.wgsl';
import { SHADING_NORMAL_BLOCK } from './shading-normal.wgsl';
import { WOUND_MASKS_BLOCK } from './wound-masks.wgsl';
import { TISSUE_BLOCK } from './tissue.wgsl';
import { BURN_BLOCK } from './burn.wgsl';
import { WET_BLOCK } from '../surface/wet.wgsl';
import {
  HEAD_SPLIT, SPLIT_SHADE, forcedSplit, headLocalPoint, splitWarpOf, unwarpDir, warpDir, warpPoint,
  type HeadFrame, type SplitWarp,
} from '../../../../../head-split';
import { NG_REASON_SPLIT } from '../../../../normal-gradient-reference';
import type { Vec3 } from '../../../../../types';
import { qFromAxisAngle, qRotate, type Quat } from '../../../../../vec';

const noComments = (s: string) => s.replace(/\/\/[^\n]*/g, '');
const LATER = noComments(`${MARCH_TRACE_POST}${MARCH_BODY_SURFACE_PREP}${MARCH_BODY_LIGHT}`);

describe('the hit keeps its own copy of the winning piece', () => {
  it('the walk copies gHitPiece / gHitSplitF at every sample, next to hitRefold, before anything can call mapBody again', () => {
    expect(MARCH_TRACE_LOOP).toContain('var hitPiece = 0;');
    expect(MARCH_TRACE_LOOP).toContain('var hitSplitF = 0.0;');
    const call = MARCH_TRACE_LOOP.indexOf('let dres = mapBody(');
    const refold = MARCH_TRACE_LOOP.indexOf('hitRefold = gRefoldWin;');
    const piece = MARCH_TRACE_LOOP.indexOf('hitPiece = gHitPiece;');
    const f = MARCH_TRACE_LOOP.indexOf('hitSplitF = gHitSplitF;');
    expect(refold).toBeGreaterThan(call);
    expect(piece).toBeGreaterThan(refold);
    expect(f).toBeGreaterThan(piece);
    expect(f).toBeLessThan(MARCH_TRACE_LOOP.indexOf('let shellAmp = woundCfg2.z;'));
  });
  it('the refine entry copies them from its own accepting sample', () => {
    expect(REFINE_LOOP).toContain('var hitPiece = 0;');
    expect(REFINE_LOOP).toContain('var hitSplitF = 0.0;');
    const last = REFINE_LOOP.lastIndexOf('dres = mapBody(');
    expect(REFINE_LOOP.indexOf('hitPiece = gHitPiece;')).toBeGreaterThan(last);
    expect(REFINE_LOOP.indexOf('hitSplitF = gHitSplitF;')).toBeGreaterThan(last);
  });
  it('the normal hint is the HIT piece\'s re-fold win for an open slot, and gRefoldWin as ever for a closed one', () => {
    const line = 'if (gInstSplitOpen && hitRefold != 0.0) { hitRefold = select(select(gRefoldBy.z, gRefoldBy.y, hitPiece == 1), gRefoldBy.x, hitPiece == 0); }';
    for (const src of [MARCH_TRACE_LOOP, REFINE_LOOP]) {
      expect(src).toContain(line);
      expect(src.indexOf(line)).toBeGreaterThan(src.indexOf('hitPiece = gHitPiece;'));
      expect(src.match(/hitRefold = /g)).toHaveLength(3);   // the declaration, the copy, the open slot's pick
    }
  });
  it('nothing after the walk reads the globals: calcNormal and the probes have overwritten them', () => {
    expect(LATER).not.toMatch(/gHitPiece|gHitSplitF|gRefoldBy|gRefoldWin/);
    expect(LATER).toMatch(/\bhitPiece\b/);
    expect(LATER).toMatch(/\bhitSplitF\b/);
  });
});

describe('the un-warped pair (split-hit.wgsl.ts)', () => {
  it('sits right after the world hit point, in every entry that shades', () => {
    expect(MARCH_TRACE_POST).toContain(`  let p = camPos + rd * t;\n${SPLIT_HIT_BLOCK}\n`);
    for (const src of [MARCH_BODY, REFINE_BODY, MARCH_SURFACE]) expect(src.split(SPLIT_HIT_BLOCK)).toHaveLength(2);
  });
  it('a hit off a turned half takes the world point and the identity turn: no rotation runs on a closed body or on piece 0', () => {
    const code = noComments(SPLIT_HIT_BLOCK);
    expect(code).toContain('var splitTheta = 0.0;');
    expect(code).toContain('if (gInstSplitOpen && hitPiece != 0) { splitTheta = select(gInstSplitA.w, gInstSplitN.w, hitPiece == 1); }');
    expect(code).toContain('var pS = p;');
    expect(code).toContain('var splitQ = vec4<f32>(0.0, 0.0, 0.0, 1.0);');
    expect(code).toContain('var faceCentre = gInstHeadCentre;');
    expect(code).toContain('var faceQuat = gInstHeadQuat;');
    // The one place a rotation is built, behind the angle.
    const turned = code.slice(code.indexOf('if (splitTheta != 0.0) {'), code.indexOf('let splitIn'));
    expect(turned).toContain('pS = splitMoveBack(p, gInstSplitH.xyz, gInstSplitA.xyz, splitTheta);');
    expect(turned).toContain('splitQ = vec4<f32>(gInstSplitA.xyz * sin(0.5 * splitTheta), cos(0.5 * splitTheta));');
    expect(turned).toContain('faceCentre = splitMoveBack(gInstHeadCentre, gInstSplitH.xyz, gInstSplitA.xyz, -splitTheta);');
    expect(turned).toContain('faceQuat = qMulQ(splitQ, gInstHeadQuat);');
    const rest = code.replace(turned, '');
    expect(rest).not.toMatch(/splitMoveBack|qMulQ|qRot|sin\(|cos\(/);
    // H, A and R are stale on a closed slot (loadInstance): every read sits behind the open flag or the angle.
    for (const line of rest.split('\n').filter(l => /gInstSplit[HAR]/.test(l))) expect(line, line).toMatch(/gInstSplitOpen &&/);
  });
  it('every later rotation is behind the angle too', () => {
    for (const line of LATER.split('\n').filter(l => /\bsplitQ\b/.test(l) && !/var splitQ|splitQ = vec4/.test(l)))
      expect(line, line).toMatch(/if \(splitTheta != 0\.0\) \{|faceQuat = qMulQ\(splitQ, gInstHeadQuat\);/);
  });
});

describe('who reads the body where', () => {
  it('the rest anchor, the wound and char masks and the bone taps read the un-warped point', () => {
    expect(SHADING_NORMAL_BLOCK).toContain('let anchor = restPoint(pS, data, hitBest, noiseLocal(pS, noiseShift), gBand);');
    expect(WOUND_MASKS_BLOCK).toContain('var nSmoothS = nSmooth;');
    expect(WOUND_MASKS_BLOCK).toContain('if (splitTheta != 0.0) { nSmoothS = qRot(vec4<f32>(-splitQ.xyz, splitQ.w), nSmooth); }');
    expect(WOUND_MASKS_BLOCK).toContain('woundMask(pS, nSmoothS, data, woundCfg, woundCfg2)');
    expect(WOUND_MASKS_BLOCK).toContain('charMask(pS, data, woundCfg)');
    const burn = noComments(BURN_BLOCK);
    expect(burn.match(/applyBones\(1e9, pS[,+ ]/g)).toHaveLength(5);
    expect(burn).not.toMatch(/applyBones\(1e9, p[,+ ]/);
    // The bone normal is the closed head's: turned with the piece before it meets the world normal.
    expect(burn).toContain('var boneN = boneG * inverseSqrt(boneG2);');
    expect(burn).toContain('if (splitTheta != 0.0) { boneN = qRot(splitQ, boneN); }');
    expect(burn.indexOf('boneN = qRot(splitQ, boneN);')).toBeLessThan(burn.indexOf('n = normalize(mix(n, boneN,'));
  });
  it('the face layer reads the head frame the caller hands it (turned with the piece), not the record', () => {
    expect(FACE_LAYER_WGSL).not.toMatch(/gInstHeadCentre|gInstHeadQuat/);
    expect(FACE_LAYER_WGSL).toContain('let hpv = p - faceCentre;');
    expect(FACE_LAYER_WGSL).toContain('let hql = -faceQuat.xyz;');
    expect(FACE_LAYER_WGSL).toContain('let hfr = hfw + 2.0 * cross(faceQuat.xyz, cross(faceQuat.xyz, hfw) + faceQuat.w * hfw);');
    expect(FACE_LAYER_WGSL).toContain('+ 2.0 * cross(faceQuat.xyz, cross(faceQuat.xyz, bumpL) + faceQuat.w * bumpL);');
  });
  it('the motion vector is the closed body\'s: previous rest position minus the un-warped point', () => {
    expect(MARCH_BODY_LIGHT).toContain('gMarchMotion = vec4<f32>(mvPrev.xyz - pS, 1.0);');
    expect(MARCH_BODY_LIGHT).toContain('(prev.xyz - pS) * 40.0');
  });
  it('the lighting, the normal\'s taps and the probes stay at the world point', () => {
    for (const world of ['calcNormal(p,', 'woundShadow(p, L,', 'levelShadow(p, n,', 'ambientAt(p, n,', 'mapBody(select(p + n * 0.06, p + L * 0.06, k == 0)',
      'let toLamp = spotPos - p;', 'bodyLights(p, n, -rd,'])
      expect(MARCH_BODY, world).toContain(world);
    // pS is read by the body-anchored blocks only.
    const light = noComments(MARCH_BODY_LIGHT).split('\n').filter(l => /\bpS\b/.test(l));
    expect(light).toHaveLength(2);
    for (const l of light) expect(l).toMatch(/prev\w*\.xyz - pS|mvPrev\.xyz - pS/);
  });
});

describe('finite-difference normals inside an open region', () => {
  it('the analytic gradient is skipped for any hit inside an open slot\'s region sphere, through the existing fallback', () => {
    expect(noComments(SPLIT_HIT_BLOCK)).toContain('let splitIn = gInstSplitOpen && length(p - gInstSplitH.xyz) <= gInstSplitR.x;');
    // Reason NG_REASON_SPLIT, and only where the analytic gradient was asked for: with the mode off the pixel reports
    // what it always did.
    expect(NG_REASON_SPLIT).toBe(8);
    expect(SHADING_NORMAL_BLOCK).toContain('if (normalGradientCfg.x > 0.5 && splitIn) { ngReason = 8; }');
    expect(SHADING_NORMAL_BLOCK).not.toContain('if (splitIn) { ngReason');
    expect(SHADING_NORMAL_BLOCK).toContain('if (normalGradientCfg.x > 0.5 && !splitIn) {');
    // ngValid stays false, so the one calcNormal call below it runs (it differentiates mapBody, the split field).
    const gate = SHADING_NORMAL_BLOCK.indexOf('if (normalGradientCfg.x > 0.5 && !splitIn) {');
    expect(SHADING_NORMAL_BLOCK.indexOf('if (normalGradientCfg.x > 0.5 && splitIn) { ngReason = 8; }')).toBeLessThan(gate);
    expect(SHADING_NORMAL_BLOCK.indexOf('if (!ngValid || debugNormal12) {')).toBeGreaterThan(gate);
    expect(noComments(SHADING_NORMAL_BLOCK).match(/ngBody\(/g)).toHaveLength(1);
    expect(SHADING_NORMAL_BLOCK.indexOf('ngBody(')).toBeGreaterThan(gate);
  });
});

describe('cut faces shade as wound interior', () => {
  const f = (v: number) => `${v}`;
  it('the gate: how far a piece cap holds the surface above the piece\'s own field, 0 on skin and on every closed body', () => {
    expect(SPLIT_SHADE.cutLo).toBeGreaterThan(0);
    expect(SPLIT_SHADE.cutHi).toBeGreaterThan(SPLIT_SHADE.cutLo);
    // Inside the first tissue stop and far inside the CPU's skin test for a hit.
    expect(SPLIT_SHADE.cutHi).toBeLessThan(HEAD_SPLIT.skinEps);
    const code = noComments(SPLIT_HIT_BLOCK);
    expect(code).toContain('var cutFace = 0.0;');
    expect(code).toContain(`if (gInstSplitOpen) { cutFace = smoothstep(${f(SPLIT_SHADE.cutLo)}, ${f(SPLIT_SHADE.cutHi)}, hitField.x - hitSplitF); }`);
  });
  it('raises the one wound mask and drops what the closed body\'s wounds and burns throw through the solid', () => {
    const code = noComments(WOUND_MASKS_BLOCK);
    // The mask vector is edited BEFORE it is destructured, so the three masks stay single-assignment and the cavity
    // share keeps its one sink (entrails-gates.test.ts counts every mention of it in the march).
    const cut = code.slice(code.indexOf('if (cutFace > 0.0) {'), code.indexOf('let wm = wmBoth.x;'));
    expect(code).toContain('var wmBoth = woundMask(pS, nSmoothS, data, woundCfg, woundCfg2);');
    expect(cut).toContain('wmBoth = vec3<f32>(max(wmBoth.xy, vec2<f32>(cutFace)), wmBoth.z * (1.0 - cutFace));');
    for (const dropped of ['cm', 'gWoundTear', 'gWoundWetOnly', 'gWoundHole', 'gClothMark', 'gClothStain'])
      expect(cut, dropped).toContain(`${dropped} = ${dropped} * (1.0 - cutFace);`);
    for (const one of ['let wm = wmBoth.x;', 'let wmRim = wmBoth.y;', 'let wmCav = wmBoth.z;']) expect(code).toContain(one);
    expect(code.indexOf('let wmCav = wmBoth.z;')).toBeLessThan(code.indexOf('let detailAmp'));
    expect(WOUND_MASKS_BLOCK.match(/wmCav/g)).toHaveLength(1);
    // No skin pores on a cut face, here or in the output-resolution detail pass the anchor is handed to.
    expect(code).toContain('if (detailAmp > 0.0 && cutFace < 0.5) {');
    expect(code).toContain('gMarchAnchor = vec4<f32>(anchor, select(detailAmp, 0.0, cutFace >= 0.5));');
  });
  it('the tissue ramp takes the depth inside the closed body there, and the whole face is wet', () => {
    expect(TISSUE_BLOCK).toContain('let tissueDepth = max(0.0, -select(hitField.w, hitSplitF, cutFace > 0.0)) * surfCfg3.x;');
    expect(WET_BLOCK).toContain('var lip = 1.0 - smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);');
    expect(WET_BLOCK).toContain('if (cutFace > 0.0) { lip = mix(lip, 1.0, cutFace); }');
    expect(WET_BLOCK.indexOf('if (cutFace > 0.0) { lip = mix(lip, 1.0, cutFace); }')).toBeLessThan(WET_BLOCK.indexOf('let wetWound = max(wm * lip, gore);'));
  });
  it('no face sheet, eye glow or head-skin gore protection on a cut face', () => {
    const gate = 'if (cutFace > 0.0) { facing = facing * (1.0 - cutFace); faceCover = faceCover * (1.0 - cutFace); }';
    expect(FACE_LAYER_WGSL).toContain(gate);
    // After the region mask and the cover are set, before the sheet is sampled.
    expect(FACE_LAYER_WGSL.indexOf(gate)).toBeGreaterThan(FACE_LAYER_WGSL.indexOf('faceCover = clamp(facing + faceRegion *'));
    expect(FACE_LAYER_WGSL.indexOf(gate)).toBeLessThan(FACE_LAYER_WGSL.indexOf('if (facing > 0.0 && uv.x > 0.0'));
  });
});

describe('the shell noise in the walk follows the piece', () => {
  const shell = noComments(MARCH_TRACE_LOOP.slice(MARCH_TRACE_LOOP.indexOf('let shellAmp = woundCfg2.z;'), MARCH_TRACE_LOOP.indexOf('let nearWound = dres.z > 0.5;')));
  it('reads the noise at this sample\'s own un-warped point, and fades it out where a cap holds the field', () => {
    const open = shell.slice(shell.indexOf('if (gInstSplitOpen) {'), shell.indexOf('d = d + fbm('));
    expect(open).toContain('if (gHitPiece != 0) { shellP = splitMoveBack(shellP, gInstSplitH.xyz, gInstSplitA.xyz, select(gInstSplitA.w, gInstSplitN.w, gHitPiece == 1)); }');
    expect(open).toContain(`shellK = shellAmp * (1.0 - smoothstep(${SPLIT_SHADE.cutLo}, ${SPLIT_SHADE.cutHi}, d - gHitSplitF));`);
    // A closed slot touches neither.
    expect(shell.replace(open, '')).not.toMatch(/gInstSplit[NHAR]|gHitPiece|gHitSplitF|splitMoveBack/);
  });
  it('a sample the noise does not reach is not a shell sample: no fbm, and the walk stays relaxed on a cut face', () => {
    // shellK is shellAmp (> 0 in this branch) for every closed body, so the guard changes nothing there.
    const tail = shell.slice(shell.indexOf('if (shellK > 0.0) {'));
    expect(tail).toMatch(/^if \(shellK > 0\.0\) \{\s*d = d \+ fbm\(restPoint\(shellP, [^\n]*\* shellK;\s*conservative = true;\s*\}/);
    expect(shell.match(/conservative = true;/g)).toHaveLength(1);
  });
});

// ---- by value: the WGSL's formulas, copied by hand, against head-split.ts ---------------------------------------
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
/** SPLIT_MOVE_BACK. */
const splitMoveBack = (p: Vec3, h: Vec3, a: Vec3, theta: number): Vec3 => {
  const v = sub(p, h), c = Math.cos(-theta), s = Math.sin(-theta);
  return add(add(h, mul(v, c)), add(mul(cross(a, v), s), mul(a, dot(a, v) * (1 - c))));
};
/** Q_ROT. */
const qRot = (q: Quat, v: Vec3): Vec3 => {
  const qv: Vec3 = [q[0], q[1], q[2]], t = mul(cross(qv, v), 2);
  return add(add(v, mul(t, q[3])), cross(qv, t));
};
/** Q_MUL. */
const qMulQ = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
/** split-hit.wgsl.ts for a hit on `piece` at world point p. */
function splitHit(w: SplitWarp, f: HeadFrame, piece: 0 | 1 | 2, p: Vec3) {
  let splitTheta = 0;
  if (piece !== 0) splitTheta = piece === 1 ? w.thetaP : w.thetaM;
  let pS = p, splitQ: Quat = [0, 0, 0, 1], faceCentre = f.centre, faceQuat = f.quat;
  if (splitTheta !== 0) {
    pS = splitMoveBack(p, w.h, w.a, splitTheta);
    const sh = Math.sin(0.5 * splitTheta);
    splitQ = [w.a[0] * sh, w.a[1] * sh, w.a[2] * sh, Math.cos(0.5 * splitTheta)];
    faceCentre = splitMoveBack(f.centre, w.h, w.a, -splitTheta);
    faceQuat = qMulQ(splitQ, f.quat);
  }
  return { pS, splitQ, faceCentre, faceQuat };
}
/** The face layer's head-space point: the conjugate rotation of p - faceCentre. */
const faceLocal = (centre: Vec3, q: Quat, p: Vec3): Vec3 => {
  const hql: Vec3 = [-q[0], -q[1], -q[2]], hpv = sub(p, centre);
  return add(hpv, mul(cross(hql, add(cross(hql, hpv), mul(hpv, q[3]))), 2));
};

describe('the un-warped pair by value (a hand twin of the WGSL against head-split.ts)', () => {
  // A tilted, turned head so no axis is special.
  const FRAME: HeadFrame = { centre: [0.3, 1.66, -0.2], quat: qFromAxisAngle([0.2, 0.9, 0.3873], 0.7), radius: 0.137 };
  const CASES: [string, SplitWarp][] = [
    ['middle both', splitWarpOf(forcedSplit('middle', 0, 0, 1)!, FRAME)!],
    ['middle one side', splitWarpOf(forcedSplit('middle', 1, 0.04, 1)!, FRAME)!],
    ['middle the other side', splitWarpOf(forcedSplit('middle', -1, -0.03, 0.6)!, FRAME)!],
    ['face', splitWarpOf(forcedSplit('face', 1, 0, 1)!, FRAME)!],
  ];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  it('the twin copies the helpers it calls', () => {
    expect(SPLIT_MOVE_BACK).toContain('return h + v * c + cross(a, v) * s + a * (dot(a, v) * (1.0 - c));');
    expect(Q_ROT).toContain('let t = 2.0 * cross(q.xyz, v);');
    expect(Q_ROT).toContain('return v + t * q.w + cross(q.xyz, t);');
    expect(Q_MUL).toContain('a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,');
    expect(Q_MUL).toContain('a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);');
  });

  for (const [name, w] of CASES) {
    it(`${name}: a point of the closed head, carried open, reads back as itself; the face frame and the turns agree`, () => {
      let moved = 0, worst = 0;
      for (let i = 0; i < 4000; i++) {
        // A point of the closed head, around the skull.
        const q: Vec3 = add(FRAME.centre, [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.34, (rnd() - 0.5) * 0.3]);
        const { p, piece } = warpPoint(w, q);
        const theta = piece === 1 ? w.thetaP : piece === 2 ? w.thetaM : 0;
        const hit = splitHit(w, FRAME, theta === 0 ? 0 : piece, p);
        if (theta === 0) {
          // The unmoved rest, and the still side of a one-sided split: the very same values, not a rotation by 0.
          expect(hit.pS).toBe(p);
          expect(hit.faceCentre).toBe(FRAME.centre);
          expect(hit.faceQuat).toBe(FRAME.quat);
          expect(hit.splitQ).toEqual([0, 0, 0, 1]);
          continue;
        }
        moved++;
        worst = Math.max(worst, len(sub(hit.pS, q)));
        // The face sheet's head-space point is the closed head's own.
        worst = Math.max(worst, len(sub(faceLocal(hit.faceCentre, hit.faceQuat, p), headLocalPoint(FRAME, q))));
        // A world direction into the piece's frame (the masks' normal) and a closed-head direction out to the world
        // (the bone normal; the face's forward and its bump, through faceQuat).
        const v: Vec3 = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
        worst = Math.max(worst, len(sub(qRot([-hit.splitQ[0], -hit.splitQ[1], -hit.splitQ[2], hit.splitQ[3]], v), unwarpDir(w, piece, v))));
        worst = Math.max(worst, len(sub(qRot(hit.splitQ, v), warpDir(w, piece, v))));
        worst = Math.max(worst, len(sub(qRot(hit.faceQuat, v), warpDir(w, piece, qRotate(FRAME.quat, v)))));
      }
      expect(moved).toBeGreaterThan(300);
      expect(worst).toBeLessThan(1e-12);
    });
  }
});
