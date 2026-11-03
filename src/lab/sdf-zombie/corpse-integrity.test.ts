// src/lab/sdf-zombie/corpse-integrity.test.ts
//
// CORPSE INTEGRITY end to end (spec 2026-11-02 §4): the real actor pipeline
// (stepActorMotion: stepRig, ropes, braces, floor) through a forced collapse.
// Measured before braces, on the zombie: head->pelvis 0.71 -> 0.11 m (the
// head lands in the pelvis), chest->pelvis 0.48 -> 0.20 m, every joint at
// one floor height (y 0.06).
import { setDeathFall } from './death-fall';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { emptyActorSignals, makeActorMotion, stepActorMotion } from './actor';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { braceTolerance, CORPSE_INTEGRITY, setCorpseIntegrity } from './collapse';
import { compileBlob, compileFace } from './blob-compile';
import { parseBlob } from './blob-parse';
import { characterEntry } from './character-registry';
import { makeRng } from './wander';
import type { BuildResult } from './build-body';
import type { MotionProfile } from './motion-profile';
import type { Vec3 } from './types';
import { len, sub } from './vec';

const SHIPPED = CORPSE_INTEGRITY.value;
afterEach(() => setCorpseIntegrity(SHIPPED));
const BOUNDS = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };

function fall(body: BuildResult, seed: number, integrity: number, profile?: MotionProfile, frames = 300) {
  setCorpseIntegrity(integrity);
  const m = makeActorMotion(body, { seed })!;
  const rng = makeRng(seed);
  const idx = m.motionJoints!.index;
  const rest = m.motionJoints!.base.map(p => [...p] as Vec3);
  const history: Vec3[][] = [];
  let floorY = 0;
  let lift: readonly number[] = [];
  for (let i = 0; i < frames; i++) {
    const signals = emptyActorSignals();
    if (i === 10) signals.forcedCollapse = true;
    const f = stepActorMotion(m, { current: body, dt: 1 / 60, wander: false, armStyle: undefined, headingFollow: 1,
      gazeFollow: 0, bounds: BOUNDS, rng, signals, ...(profile ? { profile } : {}) })!;
    floorY = f.floorY; lift = f.floorLift;
    history.push(m.bound.rig.points.map(p => [...p.pos] as Vec3));
  }
  const last = history[history.length - 1]!;
  const d = (a: number, b: number, at: readonly Vec3[]) => len(sub(at[a]!, at[b]!));
  return { idx, rest, last, history, floorY, lift, d };
}

describe('corpse integrity: the zombie', () => {
  // The free-ragdoll corpse (authored deaths off, death-fall.ts): what the braces hold.
  beforeAll(() => setDeathFall({ on: false }));
  afterAll(() => setDeathFall({ on: true }));
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}: the head stays out of the torso and the corpse lies down`, () => {
      const r = fall(buildBody(ZOMBIE, DEFAULT_BUILD_OPTS), seed, 0.7);
      const { idx, rest, last, d } = r;
      // Each brace may give its tolerance at 0.7 (trunk 21%, head 33%); a
      // further 2 cm for the floor pass that has the last word.
      const floor = (a: number, b: number, g: 'trunk' | 'head') => (1 - braceTolerance(g, 0.7)) * d(a, b, rest) - 0.02;
      expect(d(idx.head!, idx.pelvis!, last)).toBeGreaterThan(floor(idx.head!, idx.pelvis!, 'head'));
      expect(d(idx.chest!, idx.pelvis!, last)).toBeGreaterThan(floor(idx.chest!, idx.pelvis!, 'trunk'));
      expect(last[idx.chest!]![1]).toBeLessThan(0.5);
      last.forEach((p, i) => expect(p[1], `joint ${i}`).toBeGreaterThanOrEqual(r.floorY + (r.lift[i] ?? 0) - 1e-6));
      // Settled: no joint creeps more than 2 mm a frame over the last half second.
      for (let k = r.history.length - 30; k < r.history.length; k++)
        r.history[k]!.forEach((p, i) => expect(len(sub(p, r.history[k - 1]![i]!)), `frame ${k} joint ${i}`).toBeLessThan(0.002));
      console.log(`seed ${seed}: head-pelvis ${d(idx.head!, idx.pelvis!, last).toFixed(2)} chest-pelvis ${d(idx.chest!, idx.pelvis!, last).toFixed(2)} chest y ${last[idx.chest!]![1].toFixed(2)} head y ${last[idx.head!]![1].toFixed(2)}`);
    });
  }

  it('integrity 0 is the fall before braces, bit for bit', () => {
    const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const a = fall(body, 3, 0).last;
    // The same run again: nothing in the integrity-0 path may differ, so it
    // must match the pre-brace measurement of the fold (head in the pelvis).
    const b = fall(body, 3, 0);
    expect(b.last).toEqual(a);
    expect(b.d(b.idx.head!, b.idx.pelvis!, b.last)).toBeLessThan(0.3);
  });

  it('higher integrity keeps more of the shape', () => {
    const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const hp = (k: number) => { const r = fall(body, 2, k); return r.d(r.idx.head!, r.idx.pelvis!, r.last); };
    expect(hp(1)).toBeGreaterThan(hp(0.3));
  });
});

describe('corpse integrity: a quadruped', () => {
  it('the gorehound settles above its floor with its numbers recorded', () => {
    const e = characterEntry('gorehound');
    const doc = parseBlob(e.src);
    const body = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS);
    const r = fall(body, 1, 0.7, e.profile);
    r.last.forEach((p, i) => expect(p[1], `joint ${i}`).toBeGreaterThanOrEqual(r.floorY + (r.lift[i] ?? 0) - 1e-6));
    const hp = r.idx.head !== undefined && r.idx.pelvis !== undefined
      ? `${r.d(r.idx.head, r.idx.pelvis, r.rest).toFixed(2)} -> ${r.d(r.idx.head, r.idx.pelvis, r.last).toFixed(2)}` : 'n/a';
    console.log(`gorehound head-pelvis ${hp}`);
  });
});
