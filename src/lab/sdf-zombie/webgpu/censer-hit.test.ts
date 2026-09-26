// src/lab/sdf-zombie/webgpu/censer-hit.test.ts
//
import { describe, expect, it } from 'vitest';
import {
  CENSER_HIT, makeStrokeHits, sweepHead, type ActorProbe, type HitEvent, type StrokeHits,
} from './censer-hit';
import type { Vec3 } from '../types';

const R = 0.07;   // CENSER_HEAD.radius
const ball = (id: number, c: Vec3, r = 0.3): ActorProbe => ({
  id, centre: c, field: p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r,
});
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Walk the head from → to in 1 cm substeps, as censer-head's hook would, applying velScale. */
function drag(hits: StrokeHits, from: Vec3, to: Vec3, vel: Vec3, actors: ActorProbe[]) {
  const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / 0.01);
  const events: HitEvent[] = [];
  let scale = 1, p = from;
  for (let i = 1; i <= n; i++) {
    const q = lerp3(from, to, i / n);
    const r = sweepHead(hits, p, q, [vel[0] * scale, vel[1] * scale, vel[2] * scale], R, actors);
    events.push(...r.events);
    scale *= r.velScale;
    p = q;
  }
  return { events, scale, spheres: events.flatMap(e => e.spheres) };
}

describe('sweepHead', () => {
  it('misses cleanly', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 2], [0, 0, 1.5], [0, 0, -9], R, [ball(1, [0, 0, 0])]);
    expect(r.events).toHaveLength(0);
    expect(r.velScale).toBe(1);
  });

  it('first contact stamps one crater on the body surface', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -9], R, [ball(1, [0, 0, 0])]);
    expect(r.events).toHaveLength(1);
    const s = r.events[0]!.spheres;
    expect(s).toHaveLength(1);
    expect(s[0]!.kind).toBe('crater');
    expect(Math.hypot(s[0]!.at[0], s[0]!.at[1], s[0]!.at[2] - 0.3)).toBeLessThan(0.012);
    expect(s[0]!.radius).toBeCloseTo(CENSER_HIT.tap.craterR, 3);
    expect(s[0]!.severRadius).toBeCloseTo(CENSER_HIT.tap.craterR * CENSER_HIT.severMul, 3);
    expect(s[0]!.meterCredit).toBeCloseTo(CENSER_HIT.tap.meter, 3);
    expect(r.velScale).toBeCloseTo(1 - CENSER_HIT.absorbCrater, 6);
  });

  it('sizes the crater by the speed into the surface; a graze stamps nothing', () => {
    const radiusAt = (speed: number) => {
      const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -speed], R, [ball(1, [0, 0, 0])]);
      return r.events[0]?.spheres[0]?.radius ?? null;
    };
    expect(radiusAt(4.5)).toBeCloseTo(CENSER_HIT.tap.craterR * 0.5, 3);
    expect(radiusAt(2)).toBeCloseTo(CENSER_HIT.tap.craterR * CENSER_HIT.minSpeedFrac, 3);
    expect(radiusAt(1)).toBeNull();
  });

  it('a full-charge strike is the big crater', () => {
    const r = sweepHead(makeStrokeHits(1, 1), [0, 0, 1], [0, 0, 0.3], [0, 0, -16], R, [ball(1, [0, 0, 0])]);
    expect(r.events[0]!.spheres[0]!.radius).toBeCloseTo(CENSER_HIT.heavy.craterR, 3);
  });

  it('the gouge trails the crater along the travel, shrinking', () => {
    const { spheres } = drag(makeStrokeHits(1, 0), [-0.45, 0, 0.33], [0.45, 0, 0.33], [9, 0, -1], [ball(1, [0, 0, 0])]);
    expect(spheres[0]!.kind).toBe('crater');
    const gouge = spheres.slice(1);
    expect(gouge.length).toBeGreaterThanOrEqual(1);
    expect(gouge.length).toBeLessThanOrEqual(CENSER_HIT.tap.gougeMax);
    for (const g of gouge) expect(g.kind).toBe('gouge');
    for (let i = 1; i < spheres.length; i++) {
      expect(spheres[i]!.at[0]).toBeGreaterThan(spheres[i - 1]!.at[0]);
      expect(spheres[i]!.radius).toBeCloseTo(spheres[i - 1]!.radius * CENSER_HIT.gougeShrink, 6);
      expect(spheres[i]!.meterCredit).toBeCloseTo(spheres[0]!.meterCredit * CENSER_HIT.gougeMeterFrac, 6);
    }
  });

  it('hits each body once per stroke; a new stroke hits again', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    expect(drag(hits, [-0.45, 0, 0.33], [0.45, 0, 0.33], [9, 0, -1], body).spheres.length).toBeGreaterThan(0);
    expect(drag(hits, [0.45, 0, 0.33], [-0.45, 0, 0.33], [-9, 0, -1], body).spheres).toHaveLength(0);
    expect(drag(makeStrokeHits(2, 0), [0.45, 0, 0.33], [-0.45, 0, 0.33], [-9, 0, -1], body).spheres.length).toBeGreaterThan(0);
  });

  it('a stroke that starts inside the body waits until the head has left it', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    expect(sweepHead(hits, [0, 0, 0.2], [0, 0, 0.25], [0, 0, 9], R, body).events).toHaveLength(0);
    expect(drag(hits, [0, 0, 0.25], [0, 0, 0.6], [0, 0, 9], body).spheres).toHaveLength(0);
    const back = drag(hits, [0, 0, 0.6], [0, 0, 0.3], [0, 0, -9], body);
    expect(back.spheres[0]?.kind).toBe('crater');
  });

  it('the gouge ends when the head stalls in the flesh', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    const hit = sweepHead(hits, [-0.45, 0, 0.33], [-0.12, 0, 0.33], [9, 0, -1], R, body);
    expect(hit.events[0]!.spheres[0]!.kind).toBe('crater');
    expect(drag(hits, [-0.12, 0, 0.33], [0.12, 0, 0.33], [0.5, 0, 0], body).spheres).toHaveLength(0);
    expect(drag(hits, [0.12, 0, 0.33], [0.45, 0, 0.33], [9, 0, 0], body).spheres).toHaveLength(0);
  });

  it('two bodies in one sweep: both are hit, the second with the speed left over', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -9], R,
      [ball(1, [0, 0, 0]), ball(2, [0, 0, 0.01])]);
    expect(r.events.map(e => e.actorId)).toEqual([1, 2]);
    expect(r.events[1]!.spheres[0]!.radius).toBeLessThan(r.events[0]!.spheres[0]!.radius);
    expect(r.velScale).toBeCloseTo((1 - CENSER_HIT.absorbCrater) ** 2, 6);
  });
});
