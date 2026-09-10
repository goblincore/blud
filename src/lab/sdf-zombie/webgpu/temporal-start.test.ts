import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
// @ts-expect-error — deep three source import for the real wgslFn parser (same
// pattern as probe-grid.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { TEMPORAL_START_DEFAULTS, TEMPORAL_START_WGSL, temporalStart, type TemporalCfg } from './temporal-start';

/** A camera at `pos` looking down -Z, 60° vertical fov, 4:3, near 0.1 far 100. */
function cam(pos: [number, number, number]): { vp: THREE.Matrix4; invVp: THREE.Matrix4; near: number; far: number } {
  const c = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
  c.position.set(...pos); c.updateMatrixWorld(true); c.updateProjectionMatrix();
  const vp = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  return { vp, invVp: vp.clone().invert(), near: 0.1, far: 100 };
}
/** NDC depth of world point `w` under `vp`, plus its ndc xy. */
function project(vp: THREE.Matrix4, w: [number, number, number]): { nx: number; ny: number; d: number } {
  const v = new THREE.Vector4(w[0], w[1], w[2], 1).applyMatrix4(vp);
  return { nx: v.x / v.w, ny: v.y / v.w, d: v.z / v.w };
}
const on: TemporalCfg = { enabled: 1, margin: 0.25, slope: 0.02, maxStart: 50 };

describe('temporalStart — the start bound', () => {
  it('is 0 when disabled or when last frame had nothing at this pixel', () => {
    const c = cam([0, 0, 0]);
    expect(temporalStart(0.5, c.invVp, [0, 0], [0, 0, 0], [0, 0, -1], { ...on, enabled: 0 })).toBe(0);
    expect(temporalStart(1.0, c.invVp, [0, 0], [0, 0, 0], [0, 0, -1], on)).toBe(0);
  });

  it('with a static camera returns the reprojected distance minus the margins', () => {
    const c = cam([0, 0, 0]);
    const w: [number, number, number] = [0, 0, -4];
    const { nx, ny, d } = project(c.vp, w);
    const t = temporalStart(d, c.invVp, [nx, ny], [0, 0, 0], [0, 0, -1], on);
    expect(t).toBeCloseTo(4 - 0.25 - 4 * 0.02, 5);
  });

  it('follows the camera: after moving 1 m toward the surface the start is 1 m nearer', () => {
    const last = cam([0, 0, 0]);
    const w: [number, number, number] = [0, 0, -4];
    const { nx, ny, d } = project(last.vp, w);
    // Same screen pixel (centre), camera now at z = -1 looking the same way.
    const t = temporalStart(d, last.invVp, [nx, ny], [0, 0, -1], [0, 0, -1], on);
    expect(t).toBeCloseTo(3 - 0.25 - 3 * 0.02, 5);
  });

  it('is 0 when the reprojected point is behind the camera', () => {
    const last = cam([0, 0, 0]);
    const { nx, ny, d } = project(last.vp, [0, 0, -4]);
    // Camera moved past the point.
    expect(temporalStart(d, last.invVp, [nx, ny], [0, 0, -6], [0, 0, -1], on)).toBe(0);
  });

  it('never goes negative (a surface nearer than the margin) and never above maxStart', () => {
    const c = cam([0, 0, 0]);
    const near = project(c.vp, [0, 0, -0.2]);
    expect(temporalStart(near.d, c.invVp, [near.nx, near.ny], [0, 0, 0], [0, 0, -1], on)).toBe(0);
    const far = project(c.vp, [0, 0, -80]);
    expect(temporalStart(far.d, c.invVp, [far.nx, far.ny], [0, 0, 0], [0, 0, -1], { ...on, maxStart: 10 })).toBe(10);
  });

  it('an off-centre pixel measures along ITS ray, not the view axis', () => {
    const c = cam([0, 0, 0]);
    const w: [number, number, number] = [1, 0.5, -4];
    const { nx, ny, d } = project(c.vp, w);
    const len = Math.hypot(1, 0.5, 4);
    const dir: [number, number, number] = [1 / len, 0.5 / len, -4 / len];
    const t = temporalStart(d, c.invVp, [nx, ny], [0, 0, 0], dir, { ...on, margin: 0, slope: 0 });
    expect(t).toBeCloseTo(len, 5);
  });

  it('ships the defaults the plan names', () => {
    expect(TEMPORAL_START_DEFAULTS).toEqual({ enabled: 1, margin: 0.25, slope: 0.02, maxStart: 50 });
  });
});

describe('TEMPORAL_START_WGSL — parse and shape contract', () => {
  it('starts with fn temporalStartFetch, per the wgslFn parse contract', () => {
    expect(TEMPORAL_START_WGSL.startsWith('fn temporalStartFetch(')).toBe(true);
  });
  it('the real wgslFn parser sees exactly the six declared inputs, in order', () => {
    const parsed = new WGSLNodeFunction(TEMPORAL_START_WGSL);
    expect(parsed.inputs.map((i: { name: string }) => i.name))
      .toEqual(['lastTex', 'ndc', 'lastInvVp', 'camPos', 'rayDir', 'cfg']);
  });
  it('loads, never samples, and returns the identity (0) on the off paths', () => {
    expect(TEMPORAL_START_WGSL).toContain('textureLoad(');
    expect(TEMPORAL_START_WGSL).not.toContain('textureSample');
    expect(TEMPORAL_START_WGSL).toContain('if (cfg.x < 0.5) { return 0.0; }');
    expect(TEMPORAL_START_WGSL).toContain('if (d >= 1.0) { return 0.0; }');
  });
  it('shares the margin formula with the CPU twin', () => {
    expect(TEMPORAL_START_WGSL).toContain('t - cfg.y - t * cfg.z');
  });
});
