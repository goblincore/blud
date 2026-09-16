import { describe, expect, it } from 'vitest';
import { blankFaceTexture, createChunkGpuView, defaultUniforms } from './zombie-gpu';
import { bakeChunkGeometry } from './chunk-bake-geometry';
import { packChunkBake, unpackChunkBake, chunkBakeTransfers } from './chunk-bake-buffers';
import { chunkBakeField } from '../chunk-bake-field';
import { makeChunk } from '../gib-chunks';
import { qRotate, qMul } from '../vec';
import type { Primitive } from '../types';

describe('settled flesh look through the worker boundary', () => {
  it('preserves the subtractive blast cap instead of filling it back in', () => {
    const face = blankFaceTexture();
    const u = defaultUniforms(face);
    const flesh: Primitive = { limb: 'armL', cluster: 0, op: 'add', a: [0, 0, 0], b: [0, 0, 0], radius: .1, scale: [1, 1, 1], blendK: 0 };
    const cut: Primitive = { ...flesh, op: 'sub', a: [.3, 0, 0], b: [.3, 0, 0], radius: .3, blendK: .003 };
    const view = createChunkGpuView(makeChunk('armL', [0, 0, 0], [0, 0, 0], .11, [0, 1, 0]), [flesh, cut], u);
    const data = view.bakeData();
    expect(data.flesh.map(p => p.op)).toEqual(['add', 'sub']);
    expect(data.torn).toEqual([]);
    const field = chunkBakeField(data).field;
    expect(field([.05, 0, 0])).toBeGreaterThan(.04);
    expect(field([-.05, 0, 0])).toBeLessThan(-.04);
    const baked = bakeChunkGeometry(data);
    const pos = baked.geometry.getAttribute('position');
    let maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i));
    expect(maxX).toBeLessThan(.025);
    baked.geometry.dispose(); view.dispose(); face.dispose();
  });

  it.each([0, 1])('retains source display mode %s, wetness, roughness and displacement', legacy => {
    const face = blankFaceTexture();
    const u = defaultUniforms(face);
    u.lodCfg.value.y = legacy;
    u.surfCfg.value.set(.95, .12, .85, .45);
    u.surfCfg2.value.x = .8;
    u.marchCfg.value.z = .016;
    const prim: Primitive = { limb: 'armL', cluster: 0, op: 'add', a: [1, .2, 2], b: [1, .2, 2], radius: .07, scale: [1, 1, 1], blendK: 0 };
    const chunk = makeChunk('armL', [1, .2, 2], [0, 0, 0], .08, [0, 1, 0]);
    const view = createChunkGpuView(chunk, [prim], u);
    const data = view.bakeData();
    expect(data.surface).toEqual({ legacyGamma: legacy, wetness: .8, roughness: .12, specIntensity: .95, noiseAmp: .016, fresnel: .85 });
    const baked = bakeChunkGeometry(data);
    const packed = packChunkBake(baked);
    const result = unpackChunkBake(structuredClone(packed, { transfer: chunkBakeTransfers(packed) }));
    const response = result.geometry.getAttribute('bakeResponse');
    const anchor = result.geometry.getAttribute('bakeAnchor');
    expect(response.count).toBeGreaterThan(100);
    expect(anchor.count).toBe(response.count);
    for (let i = 0; i < response.count; i++) {
      expect(response.getX(i)).toBe(1 + legacy);
      expect(response.getY(i)).toBeGreaterThanOrEqual(.8);
      expect(response.getY(i)).toBeLessThanOrEqual(1.28);
      expect(response.getZ(i)).toBeCloseTo(113.12, 4);
      expect(response.getW(i)).toBeCloseTo(.95, 6);
      expect(anchor.getW(i)).toBeCloseTo(.016, 6);
      expect(result.geometry.getAttribute('bakeFresnel').getX(i)).toBeCloseTo(.85, 6);
      // The anchor is local to the chunk, not its world-space position.
      expect(Math.hypot(anchor.getX(i), anchor.getY(i), anchor.getZ(i))).toBeLessThan(.09);
    }
    result.geometry.dispose(); baked.geometry.dispose(); view.dispose(); face.dispose();
  });
});


describe('detached head face frame', () => {
  it('keeps the authored mode, centre, axes and rotates the face with the head', () => {
    const tex = blankFaceTexture();
    const u = defaultUniforms(tex);
    u.faceCfg.value.x = 2; // replacement decals must not become multiply sheets
    u.headCentre.value.set(1, .25, 2);
    u.headAxes.value.set(.08, .12, .09);
    u.headQuat.value.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    const c = makeChunk('head', [1, .2, 2], [0, 0, 0], .15, [0, 1, 0]);
    const prim: Primitive = { limb: 'head', cluster: 0, op: 'add', a: [1, .2, 2], b: [1, .2, 2], radius: .1, scale: [1, 1, 1], blendK: 0 };
    const v = createChunkGpuView(c, [prim], u);
    expect(v.uniforms.faceCfg.value.x).toBe(2);
    expect(v.uniforms.headCentre.value.toArray()).toEqual([1, .25, 2]);
    expect(v.uniforms.headAxes.value.toArray()).toEqual([.08, .12, .09]);
    c.pos = [3, .5, 4]; c.quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    v.update(c);
    const offset = qRotate(c.quat, [0, .05, 0]);
    v.uniforms.headCentre.value.toArray().forEach((x, i) => expect(x).toBeCloseTo(c.pos[i]! + offset[i]!));
    const q = qMul(c.quat, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    v.uniforms.headQuat.value.toArray().forEach((x, i) => expect(x).toBeCloseTo(q[i]!));
    // Recycled heads must use their new actor's atlas/mode, not the first
    // occupant captured by createChunkGpuView's closure.
    const otherTex = blankFaceTexture(); const other = defaultUniforms(otherTex);
    other.faceCfg.value.x = 3;
    v.reset(c, [prim], undefined, undefined, other);
    expect(v.uniforms.faceTex.value).toBe(otherTex);
    expect(v.uniforms.faceCfg.value.x).toBe(3);
    c.limb = 'armL'; v.reset(c, [prim]);
    expect(v.uniforms.faceCfg.value.x).toBe(0);
    v.dispose(); tex.dispose(); otherTex.dispose();
  });
});
