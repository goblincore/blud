// src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
//
// Packed-channel checks for the noise root shift (motion-polish). The anchor
// itself is guarded by tripwires in march.wgsl.test.ts; these pin the CPU side:
// WHICH channel carries it, what its default is, and who overwrites it.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  createZombieGpuView, createChunkGpuView, defaultUniforms, blankFaceTexture,
} from './zombie-gpu';
import { createFallbackHandVolumeTexture } from './hand-volume';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { ZOMBIE } from '../body';
import { makeChunk } from '../gib-chunks';
import * as THREE from 'three/webgpu';

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

describe('baked hand volume binding (X1.26 task B3)', () => {
  it('defaultUniforms carries the five volume uniforms, all primitive-mode', () => {
    const u = defaultUniforms(blankFaceTexture());
    expect(u.volumePose0.value.w).toBe(0); // enable flag OFF
    expect(u.volumePose1.value.equals(new THREE.Vector4(0, 0, 0, 1))).toBe(true);
    expect(u.volumeMin.value.lengthSq()).toBe(0);
    expect(u.volumeInvExtent.value.lengthSq()).toBe(0);
    expect(u.volumeWarp.value.lengthSq()).toBe(0);
  });

  it('body and chunk views default to primitive mode and bind the fallback volume', () => {
    // The call-site guarantee: every march material carries a 3D texture
    // binding. volumeTexture is part of each view interface, so a factory
    // that omitted it would not compile.
    const template = createZombieGpuView(body, {});
    expect(template.uniforms.volumePose0.value.w).toBe(0);
    expect(template.volumeTexture).toBeInstanceOf(THREE.Data3DTexture);
    expect(template.volumeTexture.type).toBe(THREE.HalfFloatType);

    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunk = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const view = createChunkGpuView(chunk, prims, template.uniforms);
    expect(view.uniforms.volumePose0.value.w).toBe(0);
    expect(view.volumeTexture).toBeInstanceOf(THREE.Data3DTexture);
    view.dispose();
    template.dispose();
  });

  it('a self-created fallback is disposed WITH the view; a shared one is not', () => {
    // Ownership: the lab renderer may share ONE fallback across every
    // non-volume view and dispose it once itself — a view disposing a shared
    // texture would pull the binding out from under its neighbours (the same
    // hazard setFaceTexture documents for face sheets).
    const ownView = createZombieGpuView(body, {});
    let ownDisposed = false;
    ownView.volumeTexture.addEventListener('dispose', () => { ownDisposed = true; });
    ownView.dispose();
    expect(ownDisposed).toBe(true);

    const shared = createFallbackHandVolumeTexture();
    let sharedDisposed = false;
    shared.addEventListener('dispose', () => { sharedDisposed = true; });
    const sharedView = createZombieGpuView(body, { volumeTex: shared });
    expect(sharedView.volumeTexture).toBe(shared);
    sharedView.dispose();
    expect(sharedDisposed).toBe(false); // caller still owns it
    shared.dispose();
    expect(sharedDisposed).toBe(true);
  });
});

describe('clip frame uniform (X1.27 task C3)', () => {
  it('defaultUniforms carries volumeClip with FALLBACK frame semantics [0,0,0,1]', () => {
    const u = defaultUniforms(blankFaceTexture());
    expect(u.volumeClip.value).toEqual(new THREE.Vector4(0, 0, 0, 1));
    // w=1 means the 1-cubed fallback slab; x=y=0, z=0 sample texel 0 of it.
  });

  it('forwards volumeClip beside volumeWarp in BOTH march call sites', () => {
    // Tripwire, not behaviour: the TSL call is named-arg matched against the
    // WGSL signature, so a missing entry is a silent uniform mismatch.
    const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');
    const marchCalls = src.match(/volumeWarp: u\.volumeWarp,/g) ?? [];
    expect(marchCalls.length).toBe(2); // createMarchMaterial + cone twin
    expect(src.match(/volumeWarp: u\.volumeWarp,\s*\n\s*volumeClip: u\.volumeClip,/g)?.length)
      .toBe(2);
  });
});
