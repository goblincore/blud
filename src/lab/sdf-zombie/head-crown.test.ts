// src/lab/sdf-zombie/head-crown.test.ts
//
import { describe, expect, it } from 'vitest';
import { headDeath, headHit, makeHeadDamage, type HeadEvent } from './head-damage';
import { BRAIN_MESH, brainLaunch, brainLumps } from './head-crown';
import { GORE_COLORS } from './head-pop';
import type { Vec3 } from './types';

const kinds = (ev: HeadEvent[]) => ev.map(e => e.kind);
const HIT_L = { eyeSide: 'L' as const };
const HIT_R = { eyeSide: 'R' as const };

describe('head damage ladder', () => {
  it('runs eye → cave (+snap) → scalp → brain (+kill)', () => {
    let s = makeHeadDamage();
    let r = headHit(s, HIT_R); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'eye-pop']);
    expect(r.events.find(e => e.kind === 'eye-pop')).toMatchObject({ side: 'R' });
    expect(s.eye).toEqual({ side: 'R', state: 'dangling' });
    r = headHit(s, HIT_L); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'dent', 'face-crater', 'eye-snap']);
    expect(s.eye).toEqual({ side: 'R', state: 'gone' });
    r = headHit(s, HIT_L); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'scalp']);
    r = headHit(s, HIT_L); s = r.state;
    expect(kinds(r.events)).toEqual(['wobble', 'brain', 'kill']);
    expect(s.dead).toBe(true);
  });
  it('hits past the 4th only wobble, dent and crater the face', () => {
    let s = makeHeadDamage();
    for (let i = 0; i < 4; i++) s = headHit(s, HIT_L).state;
    const r = headHit(s, HIT_R);
    expect(kinds(r.events)).toEqual(['wobble', 'dent', 'face-crater']);
    expect(r.state.hits).toBe(5);
  });
  it('the eye that pops is the one on the hit side', () => {
    const r = headHit(makeHeadDamage(), HIT_L);
    expect(r.events.find(e => e.kind === 'eye-pop')).toMatchObject({ side: 'L' });
  });
  it('a dangling eye snaps when the zombie dies another way', () => {
    let s = headHit(makeHeadDamage(), HIT_L).state;
    const r = headDeath(s);
    expect(kinds(r.events)).toEqual(['eye-snap']);
    expect(r.state.eye?.state).toBe('gone');
    expect(kinds(headDeath(r.state).events)).toEqual([]);
  });
});

describe('the brain mesh gib (spec §14 decision 3)', () => {
  const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };
  it('launches up and along the blow at BRAIN_MESH.launch, with a spin, above the crown', () => {
    const crown: Vec3 = [1, 1.7, -2];
    const l = brainLaunch(crown, [1, -0.2, 0], seq([0.5]));
    expect(Math.hypot(...l.vel)).toBeCloseTo(BRAIN_MESH.launch, 6);
    expect(l.vel[1]).toBeGreaterThan(0.8 * BRAIN_MESH.launch);   // mostly up, so it hangs in view
    expect(l.vel[0]).toBeGreaterThan(0.2);                        // and along the blow
    expect(l.vel[2]).toBeCloseTo(0, 6);
    expect(l.pos[1]).toBeGreaterThan(crown[1]);
    const spun = brainLaunch(crown, [1, 0, 0], seq([0.9, 0.1, 0.8, 0.2, 0.95, 0.05]));
    expect(Math.hypot(...spun.angVel)).toBeGreaterThan(2);
  });
  it('rests on its lowest support whatever its roll: the support covers the model bounds', () => {
    // The GLB's bbox (brain.glb POSITION min/max): ±0.0525, ±0.061, ±0.069. The support may not poke out of
    // it by more than 5 mm, and must reach within 1 cm of the bottom and of both poles.
    const S = BRAIN_MESH.support;
    const ext = (axis: 0 | 1 | 2, sign: 1 | -1) => Math.max(...S.map(s => sign * s.c[axis] + s.r));
    expect(ext(0, 1)).toBeLessThan(0.0525 + 0.005);
    expect(ext(1, 1)).toBeLessThan(0.061 + 0.005);
    expect(ext(1, -1)).toBeGreaterThan(0.061 - 0.01);
    expect(ext(2, 1)).toBeGreaterThan(0.069 - 0.01);
    expect(ext(2, -1)).toBeGreaterThan(0.069 - 0.01);
    expect(BRAIN_MESH.radius).toBeGreaterThanOrEqual(0.069);
  });
  it('throws three brain lumps up and outward in the brain colour', () => {
    const lumps = brainLumps([0, 1.7, 0], [0, 0, 1], seq([0.3, 0.7, 0.5, 0.2]));
    expect(lumps).toHaveLength(3);
    for (const p of lumps) {
      expect(p.kind).toBe('gob');
      expect(p.prims[0]!.color).toEqual(GORE_COLORS.brain);
      expect(p.vel![1]).toBeGreaterThan(1);
    }
  });
});
