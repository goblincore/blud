// src/lab/sdf-zombie/tracer-lights.test.ts
//
// Unit tests for the tracer → gather-light rule: the room gate, the
// nearest-first cap and the pellet/slug intensity split. Pure, so no renderer.

import { describe, it, expect } from 'vitest';
import type { Projectile } from './webgpu/game-weapon';
import { TRACER_LIGHT_COLOR, tracerGatherLights, type TracerGatherOpts } from './tracer-lights';

const ROOM = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
const EYE: [number, number, number] = [0, 1.6, 0];
const SLUG_RADIUS = 0.055;

function proj(x: number, y: number, z: number, radius = 0.05): Projectile {
  return { pos: [x, y, z], vel: [0, 0, -1], ageSec: 0.1, radius, kind: 'pellet' };
}

function opts(over: Partial<TracerGatherOpts> = {}): TracerGatherOpts {
  return { eye: EYE, room: ROOM, margin: 1.5, gain: 2, slugRadius: SLUG_RADIUS, cap: 8, ...over };
}

describe('tracerGatherLights', () => {
  it('empty in, empty out', () => {
    expect(tracerGatherLights([], opts())).toEqual([]);
  });

  it('gain 0 returns [] (the ?tracerlight=0 path), even with tracers', () => {
    expect(tracerGatherLights([proj(0, 1.6, -1)], opts({ gain: 0 }))).toEqual([]);
  });

  it('cap 0 returns [] (no slots left for tracers)', () => {
    expect(tracerGatherLights([proj(0, 1.6, -1)], opts({ cap: 0 }))).toEqual([]);
  });

  it('drops a tracer outside the room+margin and keeps one inside the margin', () => {
    const inside = proj(3.4, 1.6, 0);   // x = maxX + 1.4, inside (+1.5)
    const outside = proj(3.6, 1.6, 0);  // x = maxX + 1.6, outside
    const out = tracerGatherLights([inside, outside], opts());
    expect(out).toHaveLength(1);
    expect(out[0]!.pos).toEqual([3.4, 1.6, 0]);
  });

  it('drops a tracer outside the z margin too', () => {
    const out = tracerGatherLights([proj(0, 1.6, -3.6)], opts());
    expect(out).toEqual([]);
  });

  it('nearest-first ordering with cap 2 keeps the two closest', () => {
    const near = proj(0, 1.6, -1);   // d2 = 1
    const mid = proj(0, 1.6, -0.5);  // d2 = 0.25
    const far = proj(0, 1.6, -1.9);  // d2 = 3.61
    const out = tracerGatherLights([far, near, mid], opts({ cap: 2 }));
    expect(out).toHaveLength(2);
    expect(out[0]!.pos).toEqual([0, 1.6, -0.5]);
    expect(out[1]!.pos).toEqual([0, 1.6, -1]);
  });

  it('doubles the intensity of a slug (radius at/above slugRadius)', () => {
    const pellet = proj(0, 1.6, -1, 0.05);
    const slug = proj(0, 1.6, -0.5, SLUG_RADIUS);
    const out = tracerGatherLights([slug, pellet], opts({ gain: 2 }));
    // slug is nearest, so it is first.
    expect(out[0]!.intensity).toBe(4);
    expect(out[1]!.intensity).toBe(2);
  });

  it('packs a warm point light (no cone) with the ember hue', () => {
    const out = tracerGatherLights([proj(0, 1.6, -1)], opts());
    expect(out[0]!.color).toEqual(TRACER_LIGHT_COLOR);
    expect(out[0]!.axis).toBeUndefined();
    expect(out[0]!.cosInner).toBeUndefined();
    expect(out[0]!.cosOuter).toBeUndefined();
  });

  it('returns a copy of pos: mutating the projectile after the call does not change the light', () => {
    const p = proj(0, 1.6, -1);
    const out = tracerGatherLights([p], opts());
    (p.pos as unknown as number[])[0] = 99;
    expect(out[0]!.pos).toEqual([0, 1.6, -1]);
  });
});
