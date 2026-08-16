// src/lab/sdf-zombie/damage.test.ts
import { describe, it, expect } from 'vitest';
import { worldHitToWound, woundWorldPos, pushWound, MAX_WOUNDS, WOUND_PROFILES } from './damage';
import type { Primitive } from './types';
import { add, len, sub } from './vec';

const capsule = (a: [number, number, number], b: [number, number, number]): Primitive =>
  ({ a, b, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'armL', cluster: 2 });

describe('worldHitToWound / woundWorldPos', () => {
  const prims = [capsule([0, 1, 0], [0, 1.4, 0]), capsule([1, 1, 0], [1, 1.4, 0])];

  it('binds the wound to the nearest primitive', () => {
    expect(worldHitToWound(prims, [0.95, 1.2, 0], 0.06, 'pellet').primIdx).toBe(1);
    expect(worldHitToWound(prims, [0.05, 1.2, 0], 0.06, 'pellet').primIdx).toBe(0);
  });

  it('round-trips the hit point back to the same world position', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const back = woundWorldPos(prims, w);
    expect(len(sub(back, hit))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the body moves — the crater stays on the flesh', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const offset: [number, number, number] = [0.5, -0.3, 0.2];
    const moved = [{ ...prims[0]!, a: add(prims[0]!.a, offset), b: add(prims[0]!.b, offset) }, prims[1]!];
    const back = woundWorldPos(moved, w);
    expect(len(sub(back, add(hit, offset)))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the limb rotates', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.0];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    // Rotate the capsule 90° about its own head, from +Y to +X.
    const rotated = [{ ...prims[0]!, b: [0.4, 1, 0] as const }, prims[1]!];
    const back = woundWorldPos(rotated as Primitive[], w);
    // Still the same distance from the capsule axis head.
    expect(len(sub(back, rotated[0]!.a))).toBeCloseTo(len(sub(hit, prims[0]!.a)), 6);
  });

  it('records the wound type and radius', () => {
    const w = worldHitToWound(prims, [0.09, 1.2, 0], 0.09, 'burn');
    expect(w.type).toBe('burn');
    expect(w.radius).toBe(0.09);
    expect(w.ageSec).toBe(0);
  });
});

describe('WOUND_PROFILES — per-type "weapon calibre" knobs', () => {
  it('covers all three wound types', () => {
    expect(Object.keys(WOUND_PROFILES).sort()).toEqual(['blast', 'burn', 'pellet']);
  });

  it('radii match the previous local RADIUS tables exactly', () => {
    // The lab-mains used to carry `const RADIUS = { pellet: 0.055, blast: 0.13,
    // burn: 0.08 }`. Drifting these silently retunes every wound pipeline term.
    expect(WOUND_PROFILES.pellet.radius).toBe(0.055);
    expect(WOUND_PROFILES.blast.radius).toBe(0.13);
    expect(WOUND_PROFILES.burn.radius).toBe(0.08);
  });

  it('tames the blast lip — the default splay welded the arm to the torso', () => {
    // Playtest 2026-08-16: at splay 1 the blast rim bridged the armpit gap.
    expect(WOUND_PROFILES.blast.rimSplayScale).toBeLessThan(1);
    expect(WOUND_PROFILES.blast.rimOffsetScale).toBeLessThanOrEqual(1);
  });

  it('scales are positive so the rim never inverts', () => {
    for (const p of Object.values(WOUND_PROFILES)) {
      expect(p.rimSplayScale).toBeGreaterThan(0);
      expect(p.rimOffsetScale).toBeGreaterThan(0);
    }
  });
});

describe('pushWound', () => {
  const w = (r: number) => worldHitToWound([capsule([0, 1, 0], [0, 1.4, 0])], [0.09, 1.2, 0], r, 'pellet');

  it('appends below capacity', () => {
    expect(pushWound([w(0.01), w(0.02)], w(0.03), MAX_WOUNDS)).toHaveLength(3);
  });

  it('evicts the oldest at capacity and keeps length fixed', () => {
    const full = Array.from({ length: MAX_WOUNDS }, (_, i) => w(i / 1000));
    const out = pushWound(full, w(0.99), MAX_WOUNDS);
    expect(out).toHaveLength(MAX_WOUNDS);
    expect(out[out.length - 1]!.radius).toBe(0.99);
    expect(out[0]!.radius).toBe(1 / 1000); // index 0 evicted
  });
});

it('never binds a wound to a carve', () => {
  const solid: Primitive = {
    a: [0, 0, 0], b: [0, 0, 0], radius: 0.2,
    scale: [1, 1, 1], blendK: 0.01, limb: 'head', cluster: 0,
  };
  // The carve is nearer the hit, so a naive nearest-primitive search picks it.
  const carve: Primitive = { ...solid, a: [0.5, 0, 0], b: [0.5, 0, 0], op: 'sub' };
  expect(worldHitToWound([solid, carve], [0.49, 0, 0], 0.05, 'pellet').primIdx).toBe(0);
});
