import { describe, expect, it } from 'vitest';
import { DISCO, discoDirections, discoFade, discoHits, discoLight, type BeaconView, type Box, type Vec3 } from './disco-stars';

// The Boiler Room (night-train.level.json room 5) and its ball, roughly.
const ROOM: Box = { min: [-2.1, 0, -110], max: [2.1, 3.4, -90] };
const BALL: Vec3 = [0, 2.54, -100];

describe('discoDirections', () => {
  it('gives n unit directions', () => {
    const d = discoDirections();
    expect(d.length).toBe(DISCO.count * 3);
    for (let i = 0; i < DISCO.count; i++) expect(Math.hypot(d[i * 3]!, d[i * 3 + 1]!, d[i * 3 + 2]!)).toBeCloseTo(1, 5);
  });
  it('spreads them over the sphere (the mean is near zero)', () => {
    const d = discoDirections();
    const m = [0, 0, 0];
    for (let i = 0; i < DISCO.count; i++) for (let k = 0; k < 3; k++) m[k]! += d[i * 3 + k]! / DISCO.count;
    expect(Math.hypot(m[0]!, m[1]!, m[2]!)).toBeLessThan(0.08);
  });
  it('is seeded: the same seed gives the same directions, another seed others', () => {
    expect(discoDirections(32, 7)).toEqual(discoDirections(32, 7));
    expect(discoDirections(32, 7)).not.toEqual(discoDirections(32, 8));
  });
});

describe('discoHits', () => {
  const dirs = discoDirections();
  it('lands every star on a face of the box, with an inward normal and the right distance', () => {
    const out = new Float32Array(DISCO.count * 7);
    expect(discoHits(dirs, 0.4, BALL, ROOM, out)).toBe(DISCO.count);
    for (let i = 0; i < DISCO.count; i++) {
      const o = i * 7;
      const h = [out[o]!, out[o + 1]!, out[o + 2]!], n = [out[o + 3]!, out[o + 4]!, out[o + 5]!], dist = out[o + 6]!;
      // On a face: inside the box and on at least one of its planes.
      let onFace = false;
      for (let k = 0; k < 3; k++) {
        expect(h[k]!).toBeGreaterThanOrEqual(ROOM.min[k]! - 1e-3);
        expect(h[k]!).toBeLessThanOrEqual(ROOM.max[k]! + 1e-3);
        if (Math.abs(h[k]! - ROOM.min[k]!) < 1e-3 || Math.abs(h[k]! - ROOM.max[k]!) < 1e-3) onFace = true;
      }
      expect(onFace).toBe(true);
      // The normal is an axis, pointing back into the room (toward the ball).
      expect(Math.abs(n[0]!) + Math.abs(n[1]!) + Math.abs(n[2]!)).toBeCloseTo(1, 6);
      expect(n[0]! * (BALL[0] - h[0]!) + n[1]! * (BALL[1] - h[1]!) + n[2]! * (BALL[2] - h[2]!)).toBeGreaterThan(0);
      expect(Math.hypot(h[0]! - BALL[0], h[1]! - BALL[1], h[2]! - BALL[2])).toBeCloseTo(dist, 3);
    }
  });
  it('turning a whole revolution gives the same hits', () => {
    const a = new Float32Array(DISCO.count * 7), b = new Float32Array(DISCO.count * 7);
    discoHits(dirs, 1.1, BALL, ROOM, a);
    discoHits(dirs, 1.1 + Math.PI * 2, BALL, ROOM, b);
    for (let i = 0; i < a.length; i++) expect(b[i]!).toBeCloseTo(a[i]!, 3);
  });
  it('the spin moves the stars', () => {
    const a = new Float32Array(DISCO.count * 7), b = new Float32Array(DISCO.count * 7);
    discoHits(dirs, 0, BALL, ROOM, a);
    discoHits(dirs, 0.3, BALL, ROOM, b);
    let moved = 0;
    for (let i = 0; i < DISCO.count; i++) if (Math.abs(a[i * 7]! - b[i * 7]!) + Math.abs(a[i * 7 + 2]! - b[i * 7 + 2]!) > 0.05) moved++;
    expect(moved).toBeGreaterThan(DISCO.count / 2);
  });
  it('writes nothing from outside the box', () => {
    const out = new Float32Array(DISCO.count * 7);
    expect(discoHits(dirs, 0, [5, 1, -100], ROOM, out)).toBe(0);
  });
});

describe('discoFade', () => {
  it('is 1-ish near and head-on, falls with distance and at grazing angles', () => {
    expect(discoFade(1, 1)).toBeGreaterThan(0.8);
    expect(discoFade(8, 1)).toBeLessThan(discoFade(2, 1));
    expect(discoFade(2, 0.1)).toBeLessThan(discoFade(2, 1));
    expect(discoFade(DISCO.fadeDist + 1, 1)).toBe(0);
  });
});

describe('discoLight', () => {
  const RED: Vec3 = [1, 0.08, 0.05];
  const beacon = (axis: Vec3, level = 1): BeaconView => ({ pos: [0, 2.95, -94], axis, cosOuter: Math.cos(0.32), cosInner: Math.cos(0.32 * 0.65), level, color: RED });
  const toBall = (() => { const d = [BALL[0] - 0, BALL[1] - 2.95, BALL[2] + 94], l = Math.hypot(d[0]!, d[1]!, d[2]!); return [d[0]! / l, d[1]! / l, d[2]! / l] as Vec3; })();
  const out = { rgb: [0, 0, 0] as Vec3, intensity: 0 };

  it('party: lamp level 1, no beacons, is party white at intensity 1', () => {
    discoLight(1, [], BALL, out);
    expect(out.rgb).toEqual([...DISCO.party]);
    expect(out.intensity).toBeCloseTo(1, 6);
  });
  it('after the strobe: a beacon pointing at the ball gives red, intensity > 0.9', () => {
    discoLight(0, [beacon(toBall)], BALL, out);
    expect(out.intensity).toBeGreaterThan(0.9);
    expect(out.rgb[0]).toBeCloseTo(RED[0], 3);
    expect(out.rgb[1]).toBeCloseTo(RED[1], 3);
  });
  it('the beam sweeping past the ball at its tilt still catches it (the heading, not the elevation)', () => {
    // The real beacons point 35 deg down; the ball hangs level with them. As the heading passes
    // the ball the ball catches the beam's edge (spec §3 deviation, see the module note).
    const c = Math.cos(0.61), h = Math.hypot(toBall[0], toBall[2]);
    discoLight(0, [beacon([toBall[0] / h * c, -Math.sin(0.61), toBall[2] / h * c])], BALL, out);
    expect(out.intensity).toBeGreaterThan(0.9);
  });
  it('after the strobe: the beacon pointing away gives about 0', () => {
    discoLight(0, [beacon([-toBall[0], toBall[1], -toBall[2]])], BALL, out);
    expect(out.intensity).toBeLessThan(0.01);
  });
  it('a dark beacon lights nothing', () => {
    discoLight(0, [beacon(toBall, 0)], BALL, out);
    expect(out.intensity).toBeLessThan(0.01);
  });
  it('the strobe passes through (a flash), capped', () => {
    discoLight(1.3, [], BALL, out);
    expect(out.intensity).toBeCloseTo(1.3, 6);
    discoLight(2.2, [], BALL, out);   // the surge
    expect(out.intensity).toBeCloseTo(DISCO.cap, 6);
    discoLight(0, [], BALL, out);     // a strobe gap
    expect(out.intensity).toBe(0);
  });
});
