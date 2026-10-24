// gutcrawler.blob — a giant naked grub with a man's chest, arms and staring head on the front, hauling itself on
// its arms. What this pins: it builds and fuses; it has no legs and is NOT collapsed for it (the lab and the game
// reported a limb with no cluster as missing, and collapse.ts dropped the legless body flat every frame, until both
// read collapse.ts limbsMissing); every rig point maps to a gait joint, the tail chain included; the
// drag through the real motion pipeline lifts each arm, hauls the body forward and writhes the rear (the body wave
// down hem -> hem2 -> hem3); and the slam rears the front half up off the floor.
import { describe, it, expect } from 'vitest';
import src from './gutcrawler.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals, type ActorSignals } from '../actor';
import { limbsMissing } from '../collapse';
import { severLimb } from '../sever';
import { makeRng } from '../wander';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const profile = characterEntry('gutcrawler').profile;
const BOUNDS = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

/** The signals the lab and the game send this body (their missingLimbs read limbsMissing). */
function asTheGameSees(): ActorSignals {
  return { ...emptyActorSignals(), missing: limbsMissing(body) };
}

describe('gutcrawler — a grub with a man on the front', () => {
  it('builds clean, legless, its fists and belly on the floor', () => {
    expect(body.errors).toEqual([]);
    expect(body.clusters.some(c => c.limb === 'legL' || c.limb === 'legR')).toBe(false);
    expect(body.bones.get('hand.l')!.tail[1]).toBeLessThan(0.03);
    // the tail tip stays above the fists: bindRig pins the LOWEST rig point
    expect(body.bones.get('hem3')!.tail[1]).toBeGreaterThan(body.bones.get('hand.l')!.tail[1]);
  });

  it('has no legs to lose: a limb it never had is not missing, a severed one is', () => {
    expect(limbsMissing(body)).toEqual({ legL: false, legR: false, armL: false, armR: false });
    expect(limbsMissing(severLimb(body, 'armL').body).armL).toBe(true);
  });

  it('drags itself along on its arms, writhing, without collapsing for want of legs', () => {
    const m = makeActorMotion(body, { seed: 3 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    expect(J.hem2, 'the tail chain is wired').toBeDefined();
    expect(J.hem3).toBeDefined();
    const rng = makeRng(3);
    const low: Record<string, number> = {}, lift: Record<string, number> = { handL: 0, handR: 0 };
    let latMin = Infinity, latMax = -Infinity, start: Vec3 | null = null, collapsed = false;
    for (let i = 0; i < 360; i++) {
      const f = stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: BOUNDS, rng, signals: asTheGameSees(), profile, forceSpeed: profile.cruise,
      });
      if (f?.collapsed) collapsed = true;
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 90) { for (const n of Object.keys(lift)) low[n] = Math.min(low[n] ?? Infinity, P(J[n as 'handL']!)[1]); continue; }
      start ??= [...P(J.hips!)] as Vec3;
      for (const n of Object.keys(lift)) lift[n] = Math.max(lift[n]!, P(J[n as 'handL']!)[1] - low[n]!);
      // the tail tip's sideways swing about the body's own axis (hips -> chest)
      const h = P(J.hips!), c = P(J.chest!), t = P(J.hem3!);
      const fl = Math.hypot(c[0] - h[0], c[2] - h[2]);
      const lat = ((t[0] - h[0]) * (c[2] - h[2]) - (t[2] - h[2]) * (c[0] - h[0])) / fl;
      latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
    }
    expect(collapsed, 'a legless body is not a body that lost its legs').toBe(false);
    for (const [n, l] of Object.entries(lift)) expect(l, `${n} lifts`).toBeGreaterThan(0.08);
    const end = m.bound.rig.points[J.hips!]!.pos;
    expect(Math.hypot(end[0] - start![0], end[2] - start![2]), 'it travels').toBeGreaterThan(1.5);
    expect(latMax - latMin, 'the tail writhes side to side').toBeGreaterThan(0.25);
  });

  it('rears its front half off the floor before the slam, then throws it forward', () => {
    const at = (phase: number) => {
      const m = makeActorMotion(body, { seed: 7 }); const rng = makeRng(7); const J = m.motionJoints!.index;
      for (let i = 0; i < 70; i++) stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: false, armStyle: undefined, headingFollow: 1, gazeFollow: 1, bounds: BOUNDS,
        rng, signals: asTheGameSees(), profile, forceSpeed: 0,
        ...(i >= 40 && phase > 0 ? { attack: { phase, side: 'R' as const, variant: 'slam' as const } } : {}),
      });
      const P = (n: string) => m.bound.rig.points[(J as Record<string, number>)[n]!]!.pos;
      return { head: P('head'), handL: P('handL') };
    };
    const rest = at(0), reared = at(0.45), slammed = at(0.6);
    expect(reared.head[1] - rest.head[1], 'the head rears up').toBeGreaterThan(0.35);
    expect(reared.handL[1] - rest.handL[1], 'both fists come up off the floor').toBeGreaterThan(0.4);
    expect(slammed.head[2] - rest.head[2], 'the slam throws the snout forward').toBeGreaterThan(0.25);
    expect(slammed.handL[1], 'the fists come down on the floor').toBeLessThan(0.1);
  });
});
