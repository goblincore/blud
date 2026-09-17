// Pure-CPU pins for the crowd quad's conservative screen rectangle (stage
// a-2 (3)). The rect is a rasterisation bound, so the properties that matter
// are geometric: it contains the projection of every inflated box, it refuses
// to bind when a corner is behind the eye or nothing is visible, and its
// margin is exact.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { crowdScreenRect } from './crowd-rect';

/** A camera at the origin looking down -z, matching the game's quad boot. */
function viewProj(): THREE.Matrix4 {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

const MARGIN: [number, number] = [0.05, 0.05];

describe('crowdScreenRect', () => {
  it('bounds an instance straight ahead inside the screen, containing its centre', () => {
    const r = crowdScreenRect([{ centre: [0, 0, -4], half: [0.5, 1, 0.5] }], viewProj(), 0.1, MARGIN);
    expect(r).not.toBeNull();
    expect(r![0]).toBeGreaterThan(-1);
    expect(r![1]).toBeGreaterThan(-1);
    expect(r![2]).toBeLessThan(1);
    expect(r![3]).toBeLessThan(1);
    // The projected centre is NDC (0, 0) — straight ahead.
    expect(r![0]).toBeLessThan(0);
    expect(r![2]).toBeGreaterThan(0);
    expect(r![1]).toBeLessThan(0);
    expect(r![3]).toBeGreaterThan(0);
  });

  it('returns null for a box entirely behind the camera', () => {
    const r = crowdScreenRect([{ centre: [0, 0, 4], half: [0.5, 0.5, 0.5] }], viewProj(), 0.1, MARGIN);
    expect(r).toBeNull();
  });

  it('clips a box straddling the near plane ahead of the camera to a bounded on-screen rect', () => {
    // Centre 0.3 m ahead, half-depth 0.5: the back face is behind the eye.
    const r = crowdScreenRect([{ centre: [0, 0, -0.3], half: [0.2, 0.2, 0.5] }], viewProj(), 0.0, MARGIN);
    expect(r).not.toBeNull();
    expect(r![0]).toBeLessThan(0);
    expect(r![2]).toBeGreaterThan(0);
  });

  it('returns null for a box straddling the near plane but beside the camera (the cleared-room case)', () => {
    // 1.3 m to the right of a camera looking down -z, box reaching from
    // z = -1.1 to z = +1.1: crosses the eye plane, never enters the view.
    const r = crowdScreenRect([{ centre: [3, 0, 0], half: [0.4, 1, 0.4] }], viewProj(), 0.7, MARGIN);
    expect(r).toBeNull();
  });

  it('accepts WebGPU [0,1] depth and gives the same answer', () => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const gl = crowdScreenRect([{ centre: [0, 0, -0.3], half: [0.2, 0.2, 0.5] }], viewProj(), 0.0, MARGIN);
    const gpu = crowdScreenRect([{ centre: [0, 0, -0.3], half: [0.2, 0.2, 0.5] }], vp, 0.0, MARGIN, true);
    expect(gpu).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(gpu![i]).toBeCloseTo(gl![i]!, 3);
    expect(crowdScreenRect([{ centre: [3, 0, 0], half: [0.4, 1, 0.4] }], vp, 0.7, MARGIN, true)).toBeNull();
  });

  it('returns null for an instance entirely off-screen', () => {
    const r = crowdScreenRect([{ centre: [100, 0, -4], half: [0.5, 1, 0.5] }], viewProj(), 0.1, MARGIN);
    expect(r).toBeNull();
  });

  it('unions two instances into the element-wise min/max rect', () => {
    const vp = viewProj();
    const a = { centre: [-0.5, 0, -4], half: [0.2, 0.5, 0.2] };
    const b = { centre: [0.5, 0, -4], half: [0.2, 0.5, 0.2] };
    const ra = crowdScreenRect([a], vp, 0.05, MARGIN)!;
    const rb = crowdScreenRect([b], vp, 0.05, MARGIN)!;
    const ru = crowdScreenRect([a, b], vp, 0.05, MARGIN)!;
    expect(ru[0]).toBeCloseTo(Math.min(ra[0], rb[0]), 6);
    expect(ru[1]).toBeCloseTo(Math.min(ra[1], rb[1]), 6);
    expect(ru[2]).toBeCloseTo(Math.max(ra[2], rb[2]), 6);
    expect(ru[3]).toBeCloseTo(Math.max(ra[3], rb[3]), 6);
  });

  it('returns null for an empty list', () => {
    expect(crowdScreenRect([], viewProj(), 0.1, MARGIN)).toBeNull();
  });

  it('widens the unclamped rect by exactly the margin on each side', () => {
    const inst = { centre: [0, 0, -4], half: [0.5, 0.5, 0.5] };
    const vp = viewProj();
    const r0 = crowdScreenRect([inst], vp, 0.1, [0, 0])!;
    const rm = crowdScreenRect([inst], vp, 0.1, [0.1, 0.2])!;
    expect(rm[0]).toBeCloseTo(r0[0] - 0.1, 6);
    expect(rm[1]).toBeCloseTo(r0[1] - 0.2, 6);
    expect(rm[2]).toBeCloseTo(r0[2] + 0.1, 6);
    expect(rm[3]).toBeCloseTo(r0[3] + 0.2, 6);
  });
});
