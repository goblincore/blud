// src/lab/sdf-zombie/head-crown.test.ts
//
import { describe, expect, it } from 'vitest';
import { headDeath, headHit, makeHeadDamage, type HeadEvent } from './head-damage';

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
