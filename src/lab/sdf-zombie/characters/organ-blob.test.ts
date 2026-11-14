// organ.blob — a heavy quadruped whose back is a pipe organ: a pleated bellows barrel with human mouths down its
// flanks, on the gorehound's rig. What this pins: it builds and fuses, its feet stand on the floor, every rig point
// maps to a gait joint (so it walks at all), all four feet lift through the real motion pipeline, the barrel is the
// heavy mass it is meant to be, and the bellows HEAVE: the `swell` morph swells the folds and opens the mouths.
import { describe, it, expect } from 'vitest';
import src from './organ.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));

/** How far out (blob x) the torso's skin reaches along a ray from the centre line at (y, z). */
function reachX(y: number, z: number): number {
  const torso = { ...body, clusters: body.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) } as typeof body;
  let x = 0.6;
  for (let i = 0; i < 400 && x > 0; i++) { const s = sdBody([x, y, z], torso); if (s < 2e-4) break; x -= Math.max(s * 0.9, 2e-4); }
  return x;
}

describe('organ — a bellows on four legs with a pipe organ on its back', () => {
  it('builds clean, all four feet on the floor, no face sheet', () => {
    expect(body.errors).toEqual([]);
    for (const b of ['hand.l', 'hand.r', 'foot.l', 'foot.r']) expect(Math.abs(body.bones.get(b)!.tail[1]), b).toBeLessThan(0.03);
    expect(characterEntry('organ').profile.throws).toBe('wail');
  });

  it('is heavy: a barrel ~0.7 m across, its belly hanging below the knees', () => {
    // The widest fold (spine t 0.50: z 0.43) at the barrel's middle height.
    expect(reachX(0.90, 0.43)).toBeGreaterThan(0.33);
    // The belly: march up from the floor under the barrel's middle.
    const torso = { ...body, clusters: body.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) } as typeof body;
    let y = 0;
    for (let i = 0; i < 400; i++) { const s = sdBody([0, y, 0.43], torso); if (s < 2e-4) break; y += Math.max(s * 0.9, 2e-4); }
    expect(y, 'the belly hangs below the stifle (0.61)').toBeLessThan(0.61);
  });

  it('walks on four feet', () => {
    const m = makeActorMotion(body, { seed: 3 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('organ').profile;
    const rng = makeRng(3);
    const lifts: Record<string, number> = { handL: 0, handR: 0, footL: 0, footR: 0 };
    const low: Record<string, number> = {};
    for (let i = 0; i < 360; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 90) { for (const n of Object.keys(lifts)) low[n] = Math.min(low[n] ?? Infinity, P(J[n as 'handL']!)[1]); continue; }
      for (const n of Object.keys(lifts)) lifts[n] = Math.max(lifts[n]!, P(J[n as 'handL']!)[1] - low[n]!);
    }
    for (const [n, lift] of Object.entries(lifts)) expect(lift, `${n} lifts`).toBeGreaterThan(0.05);
  });

  it('the bellows heave: the swell morph fattens the folds and parts every mouth', () => {
    // morph=swell words: six folds and the belly swell, each mouth's lips part (upper up, lower down).
    const sw = (p: (typeof body.prims)[number]) => p.morphs?.find(m => m.channel === 'swell');
    const swelling = body.prims.filter(p => sw(p));
    expect(swelling.length).toBeGreaterThanOrEqual(5 + 1 + 6 * 3);
    // The lips move 2.2-2.6 cm; the folds (1.0-1.6 cm up) and the belly (2.0 cm down) move less.
    const lips = swelling.filter(p => Math.abs(sw(p)!.move?.[1] ?? 0) > 0.021);
    expect(lips.length, 'two lips on each of six mouths').toBe(12);
    expect(lips.filter(p => sw(p)!.move![1] > 0).length, 'half open upward').toBe(6);
    // The breath itself: the profile drives it (joystick.ts joystickSwell) with no stick throw.
    const joy = characterEntry('organ').profile.joystick!;
    expect(joy.swell?.period).toBeGreaterThan(1.5);
    expect(joy.amp).toBe(0);
  });

  it('wears no glow (pack.test.ts\'s allowlist stays as it is)', () => {
    expect(body.prims.filter(p => (p.glow ?? 0) > 0)).toEqual([]);
  });
});
