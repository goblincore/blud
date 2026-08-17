// src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
//
// Packed-channel checks for the noise root shift (motion-polish). The anchor
// itself is guarded by tripwires in march.wgsl.test.ts; these pin the CPU side:
// WHICH channel carries it, what its default is, and who overwrites it.
import { describe, it, expect } from 'vitest';
import { createZombieGpuView, createChunkGpuView } from './zombie-gpu';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { ZOMBIE } from '../body';
import { makeChunk } from '../gib-chunks';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

describe('noise root shift — packed channel (faceCfg3.zw)', () => {
  it('defaults to zero: a statue body keeps world-anchored noise, as before', () => {
    const view = createZombieGpuView(body, {});
    expect(view.uniforms.faceCfg3.value.z).toBe(0);
    expect(view.uniforms.faceCfg3.value.w).toBe(0);
    view.dispose();
  });

  it('setRootShift writes ground-plane xz without touching flicker or time', () => {
    const view = createZombieGpuView(body, {});
    view.setTime(12.5);
    view.setRootShift(1.25, -0.75);
    const v = view.uniforms.faceCfg3.value;
    expect(v.x).toBeCloseTo(0.45, 6); // glowFlicker slot untouched
    expect(v.y).toBeCloseTo(12.5, 6); // time slot untouched
    expect(v.z).toBeCloseTo(1.25, 6);
    expect(v.w).toBeCloseTo(-0.75, 6);
    view.dispose();
  });

  it('a chunk view re-anchors the channel to its own position on every update', () => {
    // The chunk's gore mottle must ride the CHUNK, not the body it left (and
    // not the world). The template's root shift is copied at spawn and then
    // overwritten per update — the sequence below exercises exactly that.
    const template = createZombieGpuView(body, {});
    template.setRootShift(2, 3); // stale body shift, must not stick
    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunk = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const view = createChunkGpuView(chunk, prims, template.uniforms);
    expect(view.uniforms.faceCfg3.value.z).toBeCloseTo(0.4, 6);
    expect(view.uniforms.faceCfg3.value.w).toBeCloseTo(-0.2, 6);
    view.update({ ...chunk, pos: [1.5, 0.3, 2.5] });
    expect(view.uniforms.faceCfg3.value.z).toBeCloseTo(1.5, 6);
    expect(view.uniforms.faceCfg3.value.w).toBeCloseTo(2.5, 6);
    view.dispose();
    template.dispose();
  });
});
