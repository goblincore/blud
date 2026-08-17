// src/lab/sdf-zombie/webgpu/fpv-view.test.ts
//
// X1.26 task B4 — the volume-capable hands view. The A/B contract under test:
//   - volume mode: counts zeroed (the fold is dead), volume uniforms copied
//     from the manifest, conservative march settings, wounds STILL uploaded;
//   - primitive mode: byte-for-byte the previous behaviour (counts packed,
//     template march settings, fallback texture bound);
//   - the proxy box comes from the TRANSFORMED manifest AABB in volume mode,
//     never from prim bounds;
//   - clay saves/restores exactly what it touched;
//   - disposal owns the fallback, never a caller's loaded volume.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createHandsGpuView } from './fpv-view';
import { defaultUniforms, blankFaceTexture } from './zombie-gpu';
import {
  createFallbackHandVolumeTexture, validateHandVolumeManifest,
  type HandVolume,
} from './hand-volume';
import type { Primitive, Vec3 } from '../types';
import type { Wound } from '../damage';

/** A template uniform set as lab-main passes it (the hero's live look). */
function templateUniforms() {
  return defaultUniforms(blankFaceTexture());
}

/** Manifest + stand-in texture; the validator proves the fixture is honest. */
function makeVolume(over: Partial<Record<'min' | 'max', Vec3>> = {}): HandVolume {
  const min = over.min ?? [-0.05, -0.05, -0.02];
  const max = over.max ?? [0.05, 0.08, 0.02];
  const voxel = [
    max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!,
  ] as [number, number, number]; // dims 2 => pitch == extent
  const manifest = validateHandVolumeManifest({
    version: 1,
    binary: 'hand.r16f',
    encoding: 'r16f-le',
    order: 'x-fastest-y-z',
    axes: { x: 'thumbward', y: 'distal', z: 'dorsal' },
    dimensions: [2, 2, 2],
    boundsMin: min,
    boundsMax: max,
    voxelSize: voxel,
    isoValue: 0,
    byteLength: 16,
    sha256: { binary: 'a'.repeat(64), source: 'b'.repeat(64) },
    attribution: 'CC-BY-4.0 DavidFischer derived volume',
  });
  return {
    manifest,
    texture: createFallbackHandVolumeTexture(), // stand-in for the loaded GPU texture
    maxVoxelPitch: Math.max(...voxel),
    dispose() { /* caller-owned fixture */ },
  };
}

const PRIMS: Primitive[] = [{
  a: [5, 5, 5], b: [5.2, 5, 5], radius: 0.02,
  scale: [1, 1, 1], blendK: 0.01, limb: 'armR', cluster: 0,
}];

const WOUNDS: Wound[] = [{
  primIdx: 0, local: [0, 0, 0.02], radius: 0.03, type: 'pellet', ageSec: 0.5,
}];

describe('HandsGpuView field switching (X1.26 task B4)', () => {
  it('defaults to primitive mode with the fallback volume bound', () => {
    const view = createHandsGpuView(templateUniforms(), 'armR');
    expect(view.uniforms.volumePose0.value.w).toBe(0);
    expect(view.volumeTexture).toBeInstanceOf(THREE.Data3DTexture);
    view.update(PRIMS, []);
    expect(view.uniforms.counts.value.x).toBe(PRIMS.length); // fold alive
    view.dispose();
  });

  it('setField(volume) needs a loaded volume and refuses without one', () => {
    const view = createHandsGpuView(templateUniforms(), 'armR');
    expect(() => view.setField('volume')).toThrow(/volume/i);
    expect(view.uniforms.volumePose0.value.w).toBe(0); // unchanged
    view.dispose();
  });

  it('volume mode: counts zeroed, manifest bounds copied, conservative march', () => {
    const view = createHandsGpuView(templateUniforms(), 'armR');
    const vol = makeVolume();
    view.setField('volume', vol);
    expect(view.uniforms.volumePose0.value.w).toBe(1);
    expect(view.volumeTexture).toBe(vol.texture);
    expect(view.uniforms.volumeMin.value.toArray()).toEqual(vol.manifest.boundsMin);
    const [nx, ny, nz] = vol.manifest.boundsMax.map(
      (v, i) => v - vol.manifest.boundsMin[i]!);
    expect(view.uniforms.volumeInvExtent.value.toArray())
      .toEqual([1 / nx!, 1 / ny!, 1 / nz!]);
    // Conservative stepping for a non-exact trilinear field: relaxation 1.0,
    // step multiplier 0.75, >= 128 steps, hit eps >= half the largest pitch.
    expect(view.uniforms.marchCfg.value.x).toBeGreaterThanOrEqual(128);
    expect(view.uniforms.marchCfg.value.y).toBeCloseTo(0.75, 6);
    expect(view.uniforms.woundCfg2.value.y).toBeCloseTo(1.0, 6);
    expect(view.uniforms.woundCfg2.value.w).toBeGreaterThanOrEqual(vol.maxVoxelPitch / 2);

    // Counts zeroed but wound rows STILL uploaded.
    view.update(PRIMS, WOUNDS);
    expect(view.uniforms.counts.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(view.uniforms.woundCfg.value.x).toBe(WOUNDS.length);
    view.dispose();
  });

  it('switching back to prims restores every march setting and the fallback', () => {
    const view = createHandsGpuView(templateUniforms(), 'armR');
    const vol = makeVolume();
    view.setField('volume', vol);
    view.setField('prims');
    expect(view.uniforms.volumePose0.value.w).toBe(0);
    expect(view.volumeTexture).not.toBe(vol.texture); // fallback re-bound
    expect(view.uniforms.marchCfg.value.x).toBe(96);
    expect(view.uniforms.marchCfg.value.y).toBeCloseTo(0.6, 6);
    expect(view.uniforms.woundCfg2.value.y).toBeCloseTo(1.4, 6);
    expect(view.uniforms.woundCfg2.value.w).toBe(0);
    // And the fold comes back.
    view.update(PRIMS, []);
    expect(view.uniforms.counts.value.x).toBe(PRIMS.length);
    view.dispose();
  });
});

describe('HandsGpuView volume pose and proxy (X1.26 task B4)', () => {
  // 90-degree roll about Z: local +Y (distal) maps onto world -X... using the
  // LOCAL-TO-WORLD quaternion, local (x,y) -> (-y, x) in world.
  const QZ90: [number, number, number, number] =
    [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const CENTRE: Vec3 = [1, 2, 3];

  it('setVolumePose writes pose + clamped warp, and sizes the proxy from the TRANSFORMED manifest AABB', () => {
    const view = createHandsGpuView(templateUniforms(), 'armR');
    const vol = makeVolume(); // local AABB x[-0.05,0.05] y[-0.05,0.08] z[-0.02,0.02]
    view.setField('volume', vol);
    view.setVolumePose({
      centre: CENTRE, quaternion: QZ90,
      warpLocal: [0.05, 0, 0], warpEnabled: true,
    });
    // Pose written verbatim; enable flag untouched by setVolumePose.
    expect(view.uniforms.volumePose0.value.toArray())
      .toEqual([1, 2, 3, 1]);
    expect(view.uniforms.volumePose1.value.toArray()).toEqual(QZ90);
    // Warp CLAMPED to 12 mm in local metres.
    expect(view.uniforms.volumeWarp.value.length()).toBeCloseTo(0.012, 6);

    // Rotated corners: (x,y)->(-y,x). World x spans [-0.08,0.05]+1,
    // y spans [-0.05,0.05]+2, z spans [-0.02,0.02]+3. Pad = max pitch
    // (0.13) + wound margin (0.05) + warp margin (0.012) = 0.192 per side.
    const mesh = view.object as THREE.Mesh;
    expect(mesh.position.x).toBeCloseTo((0.92 + 1.05) / 2, 3);
    expect(mesh.position.y).toBeCloseTo((1.95 + 2.05) / 2, 3);
    expect(mesh.position.z).toBeCloseTo((2.98 + 3.02) / 2, 3);
    expect(mesh.scale.x).toBeCloseTo(0.13 + 2 * 0.192, 3);
    expect(mesh.scale.y).toBeCloseTo(0.10 + 2 * 0.192, 3);
    expect(mesh.scale.z).toBeCloseTo(0.04 + 2 * 0.192, 3);

    // Prim bounds must NOT leak into the volume proxy: the prims sit at
    // (5,5,5), forty times the hand away, and the box stayed put.
    view.update(PRIMS, []);
    expect((view.object as THREE.Mesh).position.x).toBeCloseTo((0.92 + 1.05) / 2, 3);
    view.dispose();
  });

  it('warp disabled zeroes the offset; small warps pass through unclamped', () => {
    const view = createHandsGpuView(templateUniforms(), 'armR');
    view.setField('volume', makeVolume());
    view.setVolumePose({
      centre: [0, 0, 0], quaternion: [0, 0, 0, 1],
      warpLocal: [0.004, 0.001, 0], warpEnabled: false,
    });
    expect(view.uniforms.volumeWarp.value.lengthSq()).toBe(0);
    view.setVolumePose({
      centre: [0, 0, 0], quaternion: [0, 0, 0, 1],
      warpLocal: [0.004, 0.001, 0], warpEnabled: true,
    });
    expect(view.uniforms.volumeWarp.value.x).toBeCloseTo(0.004, 6);
    expect(view.uniforms.volumeWarp.value.y).toBeCloseTo(0.001, 6);
    expect(view.uniforms.volumeWarp.value.z).toBe(0);
    view.dispose();
  });
});

describe('HandsGpuView clay mode (X1.26 task B4)', () => {
  it('saves and restores exactly the flesh settings it touched', () => {
    const template = templateUniforms();
    template.baseColor.value.setRGB(0.7, 0.3, 0.3);
    template.surfCfg.value.set(0.9, 0.12, 0.8, 0.45);
    const view = createHandsGpuView(template, 'armR');

    view.setClay(true);
    // Neutral clay: raw display channels (the legacy-gamma path shows linear
    // values raw, same convention as every flesh preset).
    expect(view.uniforms.baseColor.value.r).toBeCloseTo(0x9a / 255, 5);
    expect(view.uniforms.baseColor.value.g).toBeCloseTo(0x81 / 255, 5);
    expect(view.uniforms.baseColor.value.b).toBeCloseTo(0x77 / 255, 5);
    expect(view.uniforms.surfCfg.value.x).toBeCloseTo(0.15, 6); // specular
    expect(view.uniforms.surfCfg.value.y).toBeCloseTo(0.7, 6);  // roughness
    // Untouched neighbours stay put (fresnel, translucency).
    expect(view.uniforms.surfCfg.value.z).toBeCloseTo(0.8, 6);
    expect(view.uniforms.surfCfg.value.w).toBeCloseTo(0.45, 6);

    view.setClay(false);
    expect(view.uniforms.baseColor.value.r).toBeCloseTo(0.7, 6);
    expect(view.uniforms.surfCfg.value.x).toBeCloseTo(0.9, 6);
    expect(view.uniforms.surfCfg.value.y).toBeCloseTo(0.12, 6);
    // Idempotent toggles.
    view.setClay(true); view.setClay(true); view.setClay(false);
    expect(view.uniforms.baseColor.value.r).toBeCloseTo(0.7, 6);
    view.dispose();
  });
});

describe('HandsGpuView disposal ownership (X1.26 task B4)', () => {
  it('disposes its own fallback but never a loaded volume', () => {
    const view = createHandsGpuView(templateUniforms(), 'armR');
    const vol = makeVolume();
    let volDisposed = false;
    vol.texture.addEventListener('dispose', () => { volDisposed = true; });
    view.setField('volume', vol);
    view.dispose();
    expect(volDisposed).toBe(false); // caller (lab-main) owns the loaded volume
    // The fallback IS the view's own: binding it again must still be safe...
    const view2 = createHandsGpuView(templateUniforms(), 'armR');
    let fallbackDisposed = false;
    view2.volumeTexture.addEventListener('dispose', () => { fallbackDisposed = true; });
    view2.dispose();
    expect(fallbackDisposed).toBe(true);
    vol.dispose();
  });
});
