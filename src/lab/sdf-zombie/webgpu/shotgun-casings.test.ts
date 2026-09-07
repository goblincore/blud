import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createShotgunCasings, createEjectionCycle } from './shotgun-casings';

describe('shotgun ejection cycle', () => {
  it('ejects once at the pump beat, then rearms for the next shot', () => {
    const cycle = createEjectionCycle();
    expect(cycle.update(Infinity, true)).toBe(false);
    expect(cycle.update(0, true)).toBe(false);
    expect(cycle.update(.12, true)).toBe(false);
    expect(cycle.update(.20, true)).toBe(true);
    expect(cycle.update(.20, true)).toBe(false);
    expect(cycle.update(.5, true)).toBe(false);
    expect(cycle.update(0, true)).toBe(false);
    expect(cycle.update(.3, true)).toBe(true);
  });
  it('does not eject from a missing/released gun or replay stale history after reset', () => {
    const cycle = createEjectionCycle();
    cycle.update(0, true);
    expect(cycle.update(.2, false)).toBe(false);
    expect(cycle.update(.3, true)).toBe(false);
    cycle.reset();
    expect(cycle.update(4, true)).toBe(false);
    cycle.update(0, true);
    cycle.update(Infinity, true);
    expect(cycle.update(.2, true)).toBe(false);
  });
});

describe('spent shell debris', () => {
  it('tumbles, bounces and stays still on the floor without raycast interactions', () => {
    const cases = createShotgunCasings(4);
    cases.eject([2, 1.4, 3], [1, 0, 0]);
    const mesh = cases.object.children[0] as THREE.InstancedMesh;
    const initial = new THREE.Matrix4(); mesh.getMatrixAt(0, initial);
    cases.step(.1);
    const flying = new THREE.Matrix4(); mesh.getMatrixAt(0, flying);
    expect(flying.elements).not.toEqual(initial.elements);
    let previousY = flying.elements[13]!;
    let touchedFloor = false, bounced = false;
    for (let i = 0; i < 240; i++) {
      cases.step(1 / 60);
      const sample = new THREE.Matrix4(); mesh.getMatrixAt(0, sample);
      const y = sample.elements[13]!;
      if (y < .04) touchedFloor = true;
      if (touchedFloor && y > previousY + .001) bounced = true;
      previousY = y;
    }
    expect(bounced).toBe(true);
    const resting = new THREE.Matrix4(); mesh.getMatrixAt(0, resting);
    expect(resting.elements[13]).toBeCloseTo(.012, 5);
    for (let i = 0; i < 120; i++) cases.step(1 / 60);
    const later = new THREE.Matrix4(); mesh.getMatrixAt(0, later);
    expect(later.elements).toEqual(resting.elements);
    const ray = new THREE.Raycaster(new THREE.Vector3(resting.elements[12]!, 2, resting.elements[14]!), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(cases.object, true)).toEqual([]);
    cases.dispose();
  });
  it('recycles the oldest shell within a fixed capacity and disposes scene objects', () => {
    const cases = createShotgunCasings(4);
    const scene = new THREE.Scene(); scene.add(cases.object);
    for (let i = 0; i < 30; i++) cases.eject([i, 1, 0], [1, 0, 0]);
    for (const child of cases.object.children) expect((child as THREE.InstancedMesh).count).toBe(4);
    cases.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
