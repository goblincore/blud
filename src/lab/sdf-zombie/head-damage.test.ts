// src/lab/sdf-zombie/head-damage.test.ts
//
import { describe, expect, it } from 'vitest';
import { HEAD_REGIONS, REGION_TUNING, headDeath, headHit, makeHeadDamage, nearestRegion, type HeadEvent } from './head-damage';

const k = (ev: HeadEvent[]) => ev.map(e => e.kind);
const at = (r: keyof typeof HEAD_REGIONS) => HEAD_REGIONS[r];   // a hit exactly on a region centre (hs)
const noJitter = () => 0.5;                                    // rand → jitter factor 1
// v1.4 toughness (flail spec §13.2): the R/L strip, and the kill windows — a single region in 7–10 hits with no
// jitter, the jitter extremes (rand 0 and 0.999: ×0.8 and ×1.2) inside 6–11.
const STRIP = 0.2;
const KILL = [7, 10] as const, KILL_JITTER = [6, 11] as const;
const inWindow = (n: number, w: readonly [number, number]) => { expect(n).toBeGreaterThanOrEqual(w[0]); expect(n).toBeLessThanOrEqual(w[1]); };

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
  it('skull exposed on the brow, then a few skull hits bring the brain out and kill', () => {
    let s = makeHeadDamage(); let all: HeadEvent[] = [];
    for (let i = 0; i < 12 && !s.dead; i++) { const r = headHit(s, { hs: at('brow'), strip: STRIP }, noJitter); s = r.state; all = all.concat(r.events); }
    const exposedAt = all.findIndex(e => e.kind === 'skull-exposed');
    const brainAt = all.findIndex(e => e.kind === 'brain');
    expect(exposedAt).toBeGreaterThanOrEqual(0);
    expect(brainAt).toBeGreaterThan(exposedAt);
    expect(k(all)).toContain('kill');
    expect(s.dead).toBe(true);
    inWindow(s.hits, KILL);
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
  it('brow hits kill in 6–11 at both jitter extremes', () => {
    for (const v of [0, 0.999]) {
      let s = makeHeadDamage(); let n = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at('brow'), strip: STRIP }, () => v).state; n++; }
      inWindow(n, KILL_JITTER);
    }
  });
  it('the H swing\'s strip (0.28) still takes several hits: brow kill in 5–9 across the jitter', () => {
    for (const v of [0, 0.5, 0.999]) {
      let s = makeHeadDamage(); let n = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at('brow'), strip: 0.28 }, () => v).state; n++; }
      inWindow(n, [5, 9]);
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
  // Head damage v2, as built (spec §15): the skull is per region, and a region's crater is anchored where it was struck.
  it('the side of the head (cheekL) exposes skull and cracks: the brain comes out of the cheek and kills in 7–10', () => {
    const side: [number, number, number] = [-0.96, -0.23, -0.19];   // the flail gate's side stand (nearest cheekL)
    expect(nearestRegion(side)).toBe('cheekL');
    for (const v of [0, 0.5, 0.999]) {
      let s = makeHeadDamage(); let all: HeadEvent[] = []; let n = 0;
      while (!s.dead && n < 20) { const r = headHit(s, { hs: side, strip: STRIP }, () => v); s = r.state; all = all.concat(r.events); n++; }
      inWindow(n, v === 0.5 ? KILL : KILL_JITTER);
      expect(all).toContainEqual({ kind: 'skull-exposed', region: 'cheekL' });
      expect(all).toContainEqual({ kind: 'brain', region: 'cheekL' });
      expect(all.findIndex(e => e.kind === 'skull-exposed')).toBeLessThan(all.findIndex(e => e.kind === 'brain'));
    }
  });
  it('hits concentrated on the crown or a cheek kill in 7–10 (6–11 at the jitter extremes); orbit hits never crack', () => {
    for (const reg of ['crown', 'cheekR'] as const) for (const v of [0, 0.5, 0.999]) {
      let s = makeHeadDamage(); let n = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at(reg), strip: STRIP }, () => v).state; n++; }
      inWindow(n, v === 0.5 ? KILL : KILL_JITTER);
    }
    let s = makeHeadDamage();
    for (let i = 0; i < 12; i++) s = headHit(s, { hs: at('orbitL'), strip: 0.35 }, noJitter).state;
    expect('orbitL' in s.skull).toBe(false);                  // an orbit has no skull of its own
    expect(s.skull.cheekL).toBe(0);
    expect(s.dead).toBe(false);
  });
  it('a region crater is anchored where the first blow that struck it landed; orbits and spill-only regions have no anchor', () => {
    const first: [number, number, number] = [-0.96, -0.23, -0.19];
    let s = headHit(makeHeadDamage(), { hs: first, strip: 0.25 }, noJitter).state;
    expect(s.anchor.cheekL).toEqual(first);
    expect('orbitL' in s.anchor).toBe(false);                 // spilled on, never struck
    s = headHit(s, { hs: [-0.7, -0.3, 0.2], strip: 0.25 }, noJitter).state;
    expect(s.anchor.cheekL).toEqual(first);                    // later strips grow it there
    for (let i = 0; i < 3; i++) s = headHit(s, { hs: at('orbitR'), strip: 0.25 }, noJitter).state;
    expect('orbitR' in s.anchor).toBe(false);                 // the eye lives at the orbit
  });
  it('a hit on the back of the head strips its nearest region in full (the crown), not nothing', () => {
    const r = headHit(makeHeadDamage(), { hs: [0, 0.2, -1], strip: 0.25 }, noJitter);
    expect(nearestRegion([0, 0.2, -1])).toBe('crown');
    expect(r.state.flesh.crown).toBeCloseTo(0.75, 6);
    expect(r.events).toContainEqual({ kind: 'strip', region: 'crown', flesh: r.state.flesh.crown });
  });
});
