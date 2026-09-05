// src/lab/sdf-zombie/webgpu/game-arms.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { drawWatchFace, makeSkinMaterial, aimArm, WATCH_SCREEN_SIZE } from './game-arms';
import { FORE_LEN_M, UPPER_LEN_M } from './game-arms-math';
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
  it('takes only a share of the gun\'s environment, with the goblin\'s wet finish', () => {
    // Owner's two looks: at the gun's full env the skin went pale and washed;
    // a matte darkening read as olive rubber. The character is wet-shiny
    // and saturated, so: a fraction of the env, roughness near the blob's.
    expect(m.envMap).toBe(env);
    expect(m.envMapIntensity).toBeCloseTo(1.1 * GOBLIN_SKIN.fpvEnvShare, 9);
    expect(m.envMapIntensity).toBeLessThan(1.1);
    expect(m.roughness).toBeCloseTo(GOBLIN_SKIN.fpvRoughness, 6);
    expect(Math.abs(m.roughness - GOBLIN_SKIN.roughness)).toBeLessThan(0.1);
    expect(m.normalScale.x).toBeGreaterThanOrEqual(1.5);
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
  function rig() {
    const arm = new THREE.Group();
    arm.position.set(-0.05, -0.18, -0.45);
    const upper = new THREE.Group(); upper.name = 'Upper_L';
    upper.position.set(0, FORE_LEN_M, 0);           // the elbow, in the root's frame
    arm.add(upper);
    return { arm, upper };
  }
  const shoulder = new THREE.Vector3(-0.22, -0.30, 0.10);
  const bend = new THREE.Vector3(-1, -0.6, 0);

  it('keeps the hand where it is and puts the elbow one forearm away', () => {
    const { arm, upper } = rig();
    aimArm(arm, shoulder, bend);
    expect(arm.position.x).toBeCloseTo(-0.05, 9);
    const elbow = upper.getWorldPosition(new THREE.Vector3());
    expect(elbow.distanceTo(arm.position)).toBeCloseTo(FORE_LEN_M, 6);
  });
  it('points the forearm at the elbow with the watch side toward the camera', () => {
    const { arm, upper } = rig();
    aimArm(arm, shoulder, bend);
    const elbow = upper.getWorldPosition(new THREE.Vector3());
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(arm.quaternion);
    expect(y.dot(elbow.clone().sub(arm.position).normalize())).toBeCloseTo(1, 6);
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(arm.quaternion);
    expect(z.z).toBeGreaterThan(0);
  });
  it('points the upper arm from the elbow at the shoulder', () => {
    const { arm, upper } = rig();
    aimArm(arm, shoulder, bend);
    const elbow = upper.getWorldPosition(new THREE.Vector3());
    const q = upper.getWorldQuaternion(new THREE.Quaternion());
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(y.dot(shoulder.clone().sub(elbow).normalize())).toBeCloseTo(1, 6);
  });
  it('bends the elbow down-and-out when the hand comes in close (the reload)', () => {
    const { arm, upper } = rig();
    arm.position.set(-0.05, -0.05, -0.18);
    aimArm(arm, shoulder, bend);
    const elbow = upper.getWorldPosition(new THREE.Vector3());
    // in reach: the upper arm meets the shoulder exactly
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER_LEN_M, 6);
    // and the elbow is on the hint's side of the hand-shoulder line
    const line = shoulder.clone().sub(arm.position).normalize();
    const eh = elbow.clone().sub(arm.position);
    const perp = eh.clone().sub(line.clone().multiplyScalar(eh.dot(line)));
    expect(perp.dot(bend)).toBeGreaterThan(0);
  });
});
