// src/lab/sdf-zombie/webgpu/game-arms.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { drawWatchFace, makeSkinMaterial, aimArm, WATCH_SCREEN_SIZE } from './game-arms';
import { GOBLIN_SKIN } from './goblin-skin';

describe('makeSkinMaterial', () => {
  const env = new THREE.Texture();
  const m = makeSkinMaterial(env, 1.1);
  it('has NO emissive — the glow was what flattened the hands', () => {
    expect(m.emissiveIntensity).toBe(0);
  });
  it('carries a colour map AND a normal map, both tiling', () => {
    expect(m.map).not.toBeNull();
    expect(m.normalMap).not.toBeNull();
    expect(m.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(m.normalMap!.wrapT).toBe(THREE.RepeatWrapping);
    expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
  });
  it('is lit by the gun\'s environment at the gun\'s intensity, with the blob\'s roughness', () => {
    expect(m.envMap).toBe(env);
    expect(m.envMapIntensity).toBe(1.1);
    expect(m.roughness).toBeCloseTo(GOBLIN_SKIN.roughness, 6);
  });
});

describe('drawWatchFace', () => {
  it('draws a dark face with a ring and glyphs — records the calls it makes', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, k: string) => (..._a: unknown[]) => { calls.push(k); },
      set: () => true,
    });
    drawWatchFace(ctx, WATCH_SCREEN_SIZE.w, WATCH_SCREEN_SIZE.h);
    expect(calls).toContain('fillRect');   // background
    expect(calls).toContain('arc');        // the ring
    expect(calls.filter((c) => c === 'fillRect').length).toBeGreaterThan(3);  // glyph bars
  });
});

describe('aimArm', () => {
  it('points the arm\'s local +Y at the elbow and its +Z (the watch) toward rig +Z', () => {
    const arm = new THREE.Group();
    arm.position.set(-0.05, -0.18, -0.45);
    const elbow = new THREE.Vector3(-0.45, -0.60, 0.05);
    aimArm(arm, elbow);
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(arm.quaternion);
    const want = elbow.clone().sub(arm.position).normalize();
    expect(y.dot(want)).toBeCloseTo(1, 6);
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(arm.quaternion);
    expect(z.z).toBeGreaterThan(0);
    expect(Math.abs(z.dot(want))).toBeLessThan(1e-6);
  });
});
