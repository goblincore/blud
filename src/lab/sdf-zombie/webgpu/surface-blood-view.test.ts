// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createBloodSim } from '../blood-sim';
import { createSurfaceBloodView } from './surface-blood-view';

describe('surface blood receiver bridge', () => {
  function fixture() {
    const scene = new THREE.Scene(), level = new THREE.Group(), sim = createBloodSim();
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial());
    wall.position.set(0, 1, -2); level.add(wall); scene.add(level);
    const view = createSurfaceBloodView({ scene, level, sim, renderer: {} as THREE.WebGPURenderer,
      roomFor: () => 1, lightsFor: () => null });
    return { view, wall, sim };
  }
  it('is lazy when off and excludes transparent glass', () => {
    const { view, wall } = fixture();
    expect(view.stats().receivers).toBe(0); expect(view.enabled).toBe(false);
    (wall.material as THREE.MeshStandardMaterial).transparent = true;
    view.setEnabled(true); expect(view.stats().receivers).toBe(0); view.dispose();
  });
  it('queries world coordinates, deposits locally, batches and follows receiver motion', () => {
    const { view, wall } = fixture(); view.setEnabled(true); view.advance(0);
    const hit = view.sweep([0, 1, 0], [0, 1, -3])!;
    expect(hit.pos).toEqual([0, 1, -2]); expect(hit.normal).toEqual([0, 0, 1]);
    view.deposit(hit, { vel: [0, 0, -3], size: 0.05 }); view.sync();
    expect(view.stats().stains).toBe(1); expect(view.stats().vertices).toBeGreaterThan(0);
    const mesh = view.group.children[0] as THREE.Mesh;
    const before = mesh.geometry;
    wall.position.x = 3; view.advance(1); view.sync();
    expect(mesh.matrix.elements[12]).toBe(3); expect(mesh.geometry).toBe(before);
    expect(view.sweep([0, 1, 0], [0, 1, -3])).toBeNull();
    expect(view.sweep([3, 1, 0], [3, 1, -3])).not.toBeNull();
    view.setEnabled(false); expect(view.stats().stains).toBe(1);
    view.setEnabled(true); expect(view.stats().stains).toBe(1);
    view.clear(); expect(view.stats().vertices).toBe(0); view.dispose();
  });
  it('keeps preview emission bounded and requires a real surface', () => {
    const { view, sim } = fixture(); view.setEnabled(true);
    expect(view.burst([10, 0, 0], [10, 0, -3])).toBe(false);
    for (let i = 0; i < 20; i++) expect(view.burst([0, 1, 0], [0, 1, -3], 80)).toBe(true);
    expect(sim.droplets).toHaveLength(600); view.dispose();
  });
  it('lands on a rotated, raised receiver instead of world height zero', () => {
    const { view, wall } = fixture(); wall.rotation.x = -Math.PI / 2; wall.position.set(0, 3, 0);
    view.setEnabled(true); view.advance(0);
    const hit = view.sweep([0, 4, 0], [0, 2, 0])!;
    expect(hit.pos[1]).toBeCloseTo(3); expect(hit.normal[1]).toBeCloseTo(1);
    view.deposit(hit, { vel: [0, -3, 0], size: 0.05 }); view.sync();
    expect(view.snapshot()[0]!.pos[1]).toBeCloseTo(3); view.dispose();
  });
});
