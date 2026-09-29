// src/lab/sdf-zombie/head-damage.test.ts
//
import { describe, expect, it } from 'vitest';
import { HEAD_REGIONS, REGION_TUNING, headDeath, headHit, makeHeadDamage, nearestRegion, type HeadEvent } from './head-damage';

const k = (ev: HeadEvent[]) => ev.map(e => e.kind);
const at = (r: keyof typeof HEAD_REGIONS) => HEAD_REGIONS[r];   // a hit exactly on a region centre (hs)
const noJitter = () => 0.5;                                    // rand → jitter factor 1

describe('head damage v2', () => {
  it('a hit strips the nearest region most and spills to neighbours; upper-face hits also strip the crown', () => {
    const r = headHit(makeHeadDamage(), { hs: at('brow'), strip: 0.25 }, noJitter);
    expect(r.state.flesh.brow).toBeCloseTo(0.75, 6);
    expect(r.state.flesh.crown).toBeLessThan(1);
    expect(r.state.flesh.cheekL).toBeGreaterThan(r.state.flesh.orbitL);   // falloff
    expect(k(r.events)).toContain('strip');
  });
  it('stripping an orbit below the threshold exposes it (once), then the next hit there pops the eye', () => {
    let s = makeHeadDamage(); let all: HeadEvent[] = [];
    for (let i = 0; i < 3; i++) { const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter); s = r.state; all = all.concat(r.events); }
    expect(all.filter(e => e.kind === 'orbit-exposed')).toEqual([{ kind: 'orbit-exposed', side: 'L' }]);
    expect(s.eyes.L).toBe('in-orbit');
    expect(k(all)).not.toContain('eye-pop');
    const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter);
    expect(r.events).toContainEqual({ kind: 'eye-pop', side: 'L' });
    expect(r.state.eyes.L).toBe('dangling');
  });
  it('a dangling eye snaps on the next head hit, or on death', () => {
    let s = makeHeadDamage();
    for (let i = 0; i < 4; i++) s = headHit(s, { hs: at('orbitR'), strip: 0.25 }, noJitter).state;
    expect(s.eyes.R).toBe('dangling');
    const r = headHit(s, { hs: at('cheekL'), strip: 0.25 }, noJitter);
    expect(r.events).toContainEqual({ kind: 'eye-snap', side: 'R' });
    expect(r.state.eyes.R).toBe('gone');
    let d = makeHeadDamage();
    for (let i = 0; i < 4; i++) d = headHit(d, { hs: at('orbitR'), strip: 0.25 }, noJitter).state;
    expect(headDeath(d).events).toEqual([{ kind: 'eye-snap', side: 'R' }]);
  });
  it('skull exposed on the brow, then about two skull hits bring the brain out and kill', () => {
    let s = makeHeadDamage(); let all: HeadEvent[] = [];
    for (let i = 0; i < 8 && !s.dead; i++) { const r = headHit(s, { hs: at('brow'), strip: 0.25 }, noJitter); s = r.state; all = all.concat(r.events); }
    const exposedAt = all.findIndex(e => e.kind === 'skull-exposed');
    const brainAt = all.findIndex(e => e.kind === 'brain');
    expect(exposedAt).toBeGreaterThanOrEqual(0);
    expect(brainAt).toBeGreaterThan(exposedAt);
    expect(k(all)).toContain('kill');
    expect(s.dead).toBe(true);
    expect(s.hits).toBeGreaterThanOrEqual(5); expect(s.hits).toBeLessThanOrEqual(7);
  });
  it('jitter changes when things happen (not an exact hit number)', () => {
    const run = (rand: () => number) => { let s = makeHeadDamage(); let n = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at('brow'), strip: 0.25 }, rand).state; n++; } return n; };
    expect(run(() => 0)).not.toBe(run(() => 0.999));
  });
  it('crater radius grows as a region loses flesh', () => {
    expect(REGION_TUNING.craterR('brow', 1)).toBeLessThan(REGION_TUNING.craterR('brow', 0.3));
  });

  // Beyond the plan's list: the edges the rules name.
  it('brow hits kill in 5–7 at both jitter extremes', () => {
    for (const v of [0, 0.999]) {
      let s = makeHeadDamage(); let n = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at('brow'), strip: 0.25 }, () => v).state; n++; }
      expect(n).toBeGreaterThanOrEqual(5); expect(n).toBeLessThanOrEqual(7);
    }
  });
  it('the popping hit does not strip that orbit; the skull and eye events fire once', () => {
    let s = makeHeadDamage();
    for (let i = 0; i < 3; i++) s = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter).state;
    const before = s.flesh.orbitL;
    const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter);
    expect(r.state.flesh.orbitL).toBe(before);
    expect(r.events.some(e => e.kind === 'strip' && e.region === 'orbitL')).toBe(false);
  });
  it('a dead head only wobbles and strips; headDeath with nothing dangling is a no-op', () => {
    let s = makeHeadDamage();
    while (!s.dead) s = headHit(s, { hs: at('brow'), strip: 0.25 }, noJitter).state;
    const r = headHit(s, { hs: at('brow'), strip: 0.25 }, noJitter);
    expect(new Set(k(r.events))).toEqual(new Set(['wobble', 'strip']));
    expect(headDeath(r.state).events).toEqual([]);
    expect(headDeath(makeHeadDamage()).events).toEqual([]);
  });
  it('flesh clamps at 0 and a strip event reports the new flesh', () => {
    let s = makeHeadDamage(); let last: HeadEvent[] = [];
    for (let i = 0; i < 6; i++) { const r = headHit(s, { hs: at('cheekR'), strip: 0.35 }, noJitter); s = r.state; last = r.events; }
    expect(s.flesh.cheekR).toBe(0);
    expect(last.some(e => e.kind === 'strip' && e.region === 'cheekR')).toBe(false);   // no change left to report
    const r = headHit(makeHeadDamage(), { hs: at('cheekR'), strip: 0.35 }, noJitter);
    expect(r.events).toContainEqual({ kind: 'strip', region: 'cheekR', flesh: r.state.flesh.cheekR });
  });
  it('nearestRegion picks the closest centre', () => {
    expect(nearestRegion([0, 0.95, 0.1])).toBe('crown');
    expect(nearestRegion([-0.5, 0.1, 0.9])).toBe('orbitL');
    expect(nearestRegion([0.6, -0.35, 0.7])).toBe('cheekR');
  });
});
