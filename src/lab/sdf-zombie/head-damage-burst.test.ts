// src/lab/sdf-zombie/head-damage-burst.test.ts
import { describe, expect, it } from 'vitest';
import { HEAD_REGIONS, REGION_TUNING, burstHit, headHit, makeHeadDamage, nearestSkullRegion } from './head-damage';

const crownHs = [0, 0.95, 0] as const;
const mid = () => 0.5;   // jitter 1

describe('nearestSkullRegion', () => {
  it('never returns an orbit', () => {
    expect(nearestSkullRegion([...HEAD_REGIONS.orbitL] as [number, number, number])).toBe('cheekL');
    expect(nearestSkullRegion([0, 0.95, 0])).toBe('crown');
  });
});

describe('burstHit', () => {
  it('lethal: the region is bare and fully cracked, the head is dead, brain and kill follow', () => {
    const { state, events } = burstHit(makeHeadDamage(), { hs: crownHs, lethal: true });
    expect(state.dead).toBe(true);
    expect(state.flesh.crown).toBe(0);
    expect(state.skull.crown).toBe(1);
    expect(state.anchor.crown).toEqual([0, 0.95, 0]);
    expect(events).toContainEqual({ kind: 'burst', lethal: true, region: 'crown' });
    expect(events.some(e => e.kind === 'kill')).toBe(true);
  });
  it('glancing: bare + cracked to glanceSkull, brainLeak, alive, no kill', () => {
    const { state, events } = burstHit(makeHeadDamage(), { hs: crownHs, lethal: false });
    expect(state.dead).toBe(false);
    expect(state.brainLeak).toBe(true);
    expect(state.flesh.crown).toBeLessThan(REGION_TUNING.skullExposed);
    expect(state.skull.crown).toBeCloseTo(REGION_TUNING.glanceSkull, 9);
    expect(events).toContainEqual({ kind: 'burst', lethal: false, region: 'crown' });
    expect(events.some(e => e.kind === 'kill')).toBe(false);
  });
  it('glancing then ONE ordinary hit on the same region kills (0.8 + 0.32 ≥ 1)', () => {
    const a = burstHit(makeHeadDamage(), { hs: crownHs, lethal: false }).state;
    const b = headHit(a, { hs: [...crownHs], strip: 0.55 }, mid);
    expect(b.events.some(e => e.kind === 'kill')).toBe(true);
    expect(b.state.dead).toBe(true);
  });
  it('headHit keeps brainLeak (state is spread, not rebuilt)', () => {
    const a = burstHit(makeHeadDamage(), { hs: crownHs, lethal: false }).state;
    const b = headHit(a, { hs: [...HEAD_REGIONS.cheekR], strip: 0.4 }, mid);
    expect(b.state.brainLeak).toBe(true);
  });
  it('a dangling eye snaps (both outcomes)', () => {
    const s = { ...makeHeadDamage(), eyes: { L: 'dangling', R: 'painted' } as const };
    const { state, events } = burstHit(s, { hs: crownHs, lethal: false });
    expect(state.eyes.L).toBe('gone');
    expect(events).toContainEqual({ kind: 'eye-snap', side: 'L' });
  });
  it('an already-dead head: state untouched, burst still reported (the corpse still ruptures)', () => {
    const dead = burstHit(makeHeadDamage(), { hs: crownHs, lethal: true }).state;
    const r = burstHit(dead, { hs: crownHs, lethal: true });
    expect(r.state).toBe(dead);
    expect(r.events).toEqual([{ kind: 'burst', lethal: true, region: 'crown' }]);
  });
  it('the input state is never mutated', () => {
    const s = makeHeadDamage();
    burstHit(s, { hs: crownHs, lethal: true });
    expect(s.dead).toBe(false);
    expect(s.skull.crown).toBe(0);
  });
});
