// src/lab/sdf-zombie/head-damage.test.ts
//
import { describe, expect, it } from 'vitest';
import { HEAD_REGIONS, REGION_TUNING, headDeath, headHit, makeHeadDamage, nearestRegion, type HeadEvent } from './head-damage';

const k = (ev: HeadEvent[]) => ev.map(e => e.kind);
const at = (r: keyof typeof HEAD_REGIONS) => HEAD_REGIONS[r];   // a hit exactly on a region centre (hs)
const noJitter = () => 0.5;                                    // rand → jitter factor 1
// v1.5b bigger bites (owner: "too gradual"): the R/L strip, and the kill windows — a single region in 4–6 hits with
// no jitter, the jitter extremes (rand 0 and 0.999: ×0.8 and ×1.2) inside 4–7. (v1.4: strip 0.20, 7–10 / 6–11.)
const STRIP = 0.4, STRIP_H = 0.55;
const KILL = [4, 6] as const, KILL_JITTER = [4, 7] as const;
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
    expect(r.events).toContainEqual({ kind: 'eye-snap', side: 'L' });   // both went together (v1.5a)
    let d = makeHeadDamage();
    for (let i = 0; i < 4; i++) d = headHit(d, { hs: at('orbitR'), strip: 0.25 }, noJitter).state;
    // Both eyes dangle since the pop (v1.5a): death snaps both.
    expect(headDeath(d).events).toEqual([{ kind: 'eye-snap', side: 'L' }, { kind: 'eye-snap', side: 'R' }]);
    expect(headDeath(d).state.eyes).toEqual({ L: 'gone', R: 'gone' });
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
  it('the craters are big bites (v1.5b): the first one already 4 cm, the full-grown ones ~40% up on v1.4', () => {
    const one = headHit(makeHeadDamage(), { hs: at('brow'), strip: STRIP }, () => 0).state;   // the smallest first bite
    expect(REGION_TUNING.craterR('brow', one.flesh.brow)).toBeGreaterThanOrEqual(0.04);
    const full = { orbitL: 0.05, orbitR: 0.05, brow: 0.07, crown: 0.075, cheekL: 0.065, cheekR: 0.065 } as const;
    for (const [r, v] of Object.entries(full)) expect(REGION_TUNING.craterR(r as keyof typeof full, 0)).toBeCloseTo(v, 6);
  });
  it('the eyes go fast (v1.5b): orbit exposed on hit 1–3, both eyes pop on the next orbit hit, snap on the one after', () => {
    for (const [v, strip, exposed] of [[0, STRIP, 3], [0.5, STRIP, 2], [0.999, STRIP, 2], [0, STRIP_H, 2], [0.999, STRIP_H, 1]] as const) {
      let s = makeHeadDamage(); let n = 0;
      while (s.eyes.L === 'painted' && n < 20) { s = headHit(s, { hs: at('orbitL'), strip }, () => v).state; n++; }
      expect(n).toBe(exposed);
      s = headHit(s, { hs: at('orbitL'), strip }, () => v).state;
      expect(s.eyes).toEqual({ L: 'dangling', R: 'dangling' });   // hit exposed + 1: 2–4
      s = headHit(s, { hs: at('brow'), strip }, () => v).state;
      expect(s.eyes).toEqual({ L: 'gone', R: 'gone' });
    }
  });
  it('the head gate\'s sequence (orbit until exposed, the pop, then the brow) kills in 5–9 head hits across the jitter', () => {
    for (const strip of [STRIP, STRIP_H]) for (const v of [0, 0.5, 0.999]) {
      let s = makeHeadDamage(); let n = 0;
      const push = (hs: readonly [number, number, number]) => { s = headHit(s, { hs, strip }, () => v).state; n++; };
      while (s.eyes.L === 'painted' && n < 20) push(at('orbitL'));
      push(at('orbitL'));
      while (!s.dead && n < 40) push(at('brow'));
      inWindow(n, [5, 9]);
    }
  });

  // Beyond the plan's list: the edges the rules name.
  it('brow hits kill in 4–7 at both jitter extremes', () => {
    for (const v of [0, 0.999]) {
      let s = makeHeadDamage(); let n = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at('brow'), strip: STRIP }, () => v).state; n++; }
      inWindow(n, KILL_JITTER);
    }
  });
  it('the H swing\'s strip (0.55) still takes several hits: brow kill in 4–7 across the jitter, skull bare on hit 2–3', () => {
    for (const v of [0, 0.5, 0.999]) {
      let s = makeHeadDamage(); let n = 0; let bare = 0;
      while (!s.dead && n < 20) { s = headHit(s, { hs: at('brow'), strip: STRIP_H }, () => v).state; n++; if (!bare && s.flesh.brow < REGION_TUNING.skullExposed) bare = n; }
      inWindow(n, KILL_JITTER);
      inWindow(bare, [2, 3]);
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
  it('the side of the head (cheekL) exposes skull and cracks: the brain comes out of the cheek and kills in 4–6 (4–7 at the jitter extremes)', () => {
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
  it('hits concentrated on the crown or a cheek kill in 4–6 (4–7 at the jitter extremes); orbit hits never crack', () => {
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

  // v1.5a (flail spec §14.1 item 8): both eyes pop out of their sockets at once.
  describe('both eyes pop at once', () => {
    const popOnL = () => {   // three hits expose the left orbit; the fourth pops it
      let s = makeHeadDamage();
      for (let i = 0; i < 3; i++) s = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter).state;
      expect(s.eyes).toEqual({ L: 'in-orbit', R: 'painted' });
      return s;
    };
    it('one orbit stripped: its pop also pops the painted other eye in the same hit (orbit-exposed first)', () => {
      const s = popOnL();
      const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter);
      expect(r.state.eyes).toEqual({ L: 'dangling', R: 'dangling' });
      const ev = r.events.filter(e => e.kind === 'eye-pop' || e.kind === 'orbit-exposed');
      expect(ev).toEqual([{ kind: 'eye-pop', side: 'L' }, { kind: 'orbit-exposed', side: 'R' }, { kind: 'eye-pop', side: 'R' }]);
      expect(r.state.flesh.orbitR).toBeLessThanOrEqual(REGION_TUNING.orbitExposed);
    });
    it('an other eye already in its orbit pops without a second orbit-exposed', () => {
      let s = popOnL();
      s = { ...s, eyes: { ...s.eyes, R: 'in-orbit' }, flesh: { ...s.flesh, orbitR: 0.3 } };
      const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter);
      expect(r.state.eyes).toEqual({ L: 'dangling', R: 'dangling' });
      expect(k(r.events).filter(x => x === 'orbit-exposed')).toEqual([]);
      expect(r.events.filter(e => e.kind === 'eye-pop')).toEqual([{ kind: 'eye-pop', side: 'L' }, { kind: 'eye-pop', side: 'R' }]);
      expect(r.state.flesh.orbitR).toBeLessThanOrEqual(0.3);   // "at most": never raised
    });
    it('both snap on the next head hit (one eye-snap each), wherever it lands', () => {
      const s = headHit(popOnL(), { hs: at('orbitL'), strip: 0.25 }, noJitter).state;
      const r = headHit(s, { hs: at('crown'), strip: 0.25 }, noJitter);
      expect(r.events.filter(e => e.kind === 'eye-snap')).toEqual([{ kind: 'eye-snap', side: 'L' }, { kind: 'eye-snap', side: 'R' }]);
      expect(r.state.eyes).toEqual({ L: 'gone', R: 'gone' });
      // Nothing pops again.
      const r2 = headHit(r.state, { hs: at('orbitR'), strip: 0.25 }, noJitter);
      expect(k(r2.events)).not.toContain('eye-pop');
      expect(k(r2.events)).not.toContain('orbit-exposed');
    });
    it('a side already gone is left alone', () => {
      let s = popOnL();
      s = { ...s, eyes: { ...s.eyes, R: 'gone' } };
      const r = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter);
      expect(r.state.eyes).toEqual({ L: 'dangling', R: 'gone' });
      expect(r.events.filter(e => e.kind === 'eye-pop')).toEqual([{ kind: 'eye-pop', side: 'L' }]);
      expect(k(r.events)).not.toContain('orbit-exposed');
    });
    it('the strip and threshold rules elsewhere are unchanged: no pop, no other-eye change', () => {
      let s = makeHeadDamage();
      for (let i = 0; i < 3; i++) s = headHit(s, { hs: at('orbitL'), strip: 0.25 }, noJitter).state;
      const before = s.flesh.orbitR;
      const r = headHit(s, { hs: at('cheekR'), strip: 0.25 }, noJitter);   // neither an orbit nor the brow: no pop
      expect(r.state.eyes.R).toBe('painted');
      expect(r.state.flesh.orbitR).toBeLessThan(before);
      expect(r.state.flesh.orbitR).toBeGreaterThan(REGION_TUNING.orbitExposed);
    });
    it('jitter extremes still finish the ladder: exposed → pop (both) → snap (both) → a kill', () => {
      for (const v of [0, 0.999]) {
        let s = makeHeadDamage(); const all: HeadEvent[] = []; let n = 0;
        const push = (hs: readonly [number, number, number]) => { const r = headHit(s, { hs, strip: STRIP }, () => v); s = r.state; all.push(...r.events); n++; };
        while (s.eyes.L !== 'dangling' && n < 20) push(at('orbitL'));
        expect(s.eyes).toEqual({ L: 'dangling', R: 'dangling' });
        push(at('brow'));
        expect(s.eyes).toEqual({ L: 'gone', R: 'gone' });
        while (!s.dead && n < 40) push(at('brow'));
        expect(s.dead).toBe(true);
        expect(all.filter(e => e.kind === 'eye-snap').length).toBe(2);
        expect(all.filter(e => e.kind === 'eye-pop').length).toBe(2);
      }
    });
  });
  it('a hit at the middle of the face (nearest the brow) pops an exposed eye too', () => {
    let s = makeHeadDamage();
    for (let i = 0; i < 4 && s.eyes.L !== 'in-orbit'; i++) s = headHit(s, { hs: at('orbitL'), strip: 0.4 }, noJitter).state;
    expect(s.eyes.L).toBe('in-orbit');
    const r = headHit(s, { hs: at('brow'), strip: 0.4 }, noJitter);
    expect(r.events).toContainEqual({ kind: 'eye-pop', side: 'L' });
    expect(r.state.eyes.L).toBe('dangling');
    expect(r.state.eyes.R).toBe('dangling');   // both at once
    // and that brow hit still strips the brow normally
    expect(r.state.flesh.brow).toBeLessThan(s.flesh.brow);
  });
});
