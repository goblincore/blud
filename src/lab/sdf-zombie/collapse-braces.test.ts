// src/lab/sdf-zombie/collapse-braces.test.ts
//
// CORPSE INTEGRITY braces (spec 2026-11-02 §4), pure: the set built from the
// zombie's joints, the integrity-0 no-op, and the pull back from a fold.
import { describe, expect, it } from 'vitest';
import { braceTolerance, collapseBraces, relaxBraces, type BraceLimit } from './collapse';
import { makeActorMotion } from './actor';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';
import { len, sub } from './vec';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const m = makeActorMotion(body, { seed: 1 })!;
const names = m.motionJoints!.names;
const rest = m.motionJoints!.base;
const idx = m.motionJoints!.index;
const braces = collapseBraces(names, rest);

const pts = (pos: readonly Vec3[]): RigPoint[] => pos.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
const dist = (p: readonly RigPoint[], a: number, b: number) => len(sub(p[a]!.pos, p[b]!.pos));

describe('collapseBraces', () => {
  it('braces the zombie trunk and head with rest distances', () => {
    const has = (a: number, b: number) => braces.some(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    expect(has(idx.head!, idx.pelvis!)).toBe(true);
    expect(has(idx.chest!, idx.pelvis!)).toBe(true);
    expect(has(idx.shoulderL!, idx.hipR!)).toBe(true);
    for (const b of braces) expect(b.rest).toBeCloseTo(len(sub(rest[b.a]!, rest[b.b]!)), 9);
    expect(braces.filter(b => b.group === 'head').length).toBe(4);
  });

  it('skips pairs a body lacks', () => {
    expect(collapseBraces(['pelvis', 'chest'], [[0, 1, 0], [0, 1.4, 0]])).toHaveLength(1);
  });
});

describe('relaxBraces', () => {
  /** The measured fold: the head dropped into the pelvis. */
  function folded(): RigPoint[] {
    const p = pts(rest);
    const pv = p[idx.pelvis!]!.pos;
    p[idx.head!] = { ...p[idx.head!]!, pos: [pv[0], pv[1] + 0.11, pv[2]] };
    return p;
  }

  it('integrity 0 returns its input untouched', () => {
    const p = folded();
    expect(relaxBraces(p, braces, 0)).toBe(p);
  });

  it('integrity 1 pushes a folded head back out to within tolerance', () => {
    const out = relaxBraces(folded(), braces, 1, 8);
    const hp = braces.find(b => b.a === idx.head && b.b === idx.pelvis)!;
    expect(dist(out, idx.head!, idx.pelvis!)).toBeGreaterThan(hp.rest * (1 - braceTolerance('head', 1)) - 0.02);
  });

  it('looser integrity leaves more fold', () => {
    const tight = dist(relaxBraces(folded(), braces, 1, 8), idx.head!, idx.pelvis!);
    const loose = dist(relaxBraces(folded(), braces, 0.3, 8), idx.head!, idx.pelvis!);
    expect(loose).toBeLessThan(tight);
  });

  it('never moves a pinned point', () => {
    const p = folded();
    p[idx.head!] = { ...p[idx.head!]!, pinned: true };
    const out = relaxBraces(p, braces, 1);
    expect(out[idx.head!]!.pos).toEqual(p[idx.head!]!.pos);
  });

  it('leaves an at-rest pose alone', () => {
    const p = pts(rest);
    const out = relaxBraces(p, braces, 1);
    out.forEach((q, i) => expect(len(sub(q.pos, p[i]!.pos))).toBeLessThan(1e-9));
  });

  it('keeps prev, so the correction reads as velocity', () => {
    const p = folded();
    const out = relaxBraces(p, braces as BraceLimit[], 1);
    expect(out[idx.head!]!.prev).toEqual(p[idx.head!]!.prev);
  });
});
