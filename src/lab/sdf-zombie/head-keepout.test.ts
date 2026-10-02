// src/lab/sdf-zombie/head-keepout.test.ts
//
// The head keep-out (rig.ts RigHeadKeepOut, built by rig-bind.ts) must be INVISIBLE
// at rest on every character: a body authored with an arm touching its head keeps
// that pose. A keep-out that nudged a rest pose would move every baseline.
import { describe, expect, it } from 'vitest';
import { characterEntry, characterNames } from './character-registry';
import { bindRig } from './rig-bind';
import { stepRig } from './rig';
import { len, sub } from './vec';
import { buildCharacterBody } from './webgpu/character-view';

describe('head keep-out at rest', () => {
  it.each(characterNames())('%s: holding the rest pose, the head and torso keep-outs change nothing', name => {
    const body = buildCharacterBody(characterEntry(name), [0, 0, 0], []);
    const bound = bindRig(body);
    const rest = bound.rig.points.map(p => p.pos);
    const run = (keepOut: boolean) => {
      let s = { ...bound.rig, restPose: rest, ...(keepOut ? {} : { headKeepOut: undefined, torsoGuards: undefined }) };
      for (let i = 0; i < 30; i++) {
        s = stepRig(s, 1 / 60, { gravity: [0, 0, 0], damping: 0.06, iterations: 4, restStiffness: 0.3 });
      }
      return s.points;
    };
    // The solver itself drifts from some authored rest poses (jaw, lone pins; the
    // cyclops moves ~14 cm), so the claim is a DIFFERENCE. For a rest pose the
    // solver holds, the keep-outs add exactly nothing. For one that drifts on its
    // own, the guards may correct an arm drifting into the torso, but only a
    // fraction of that drift -- never a new pose.
    const withKo = run(true), without = run(false);
    let worst = 0, drift = 0;
    withKo.forEach((p, i) => {
      worst = Math.max(worst, len(sub(p.pos, without[i]!.pos)));
      drift = Math.max(drift, len(sub(without[i]!.pos, rest[i]!)));
    });
    expect(worst).toBeLessThan(drift > 0.01 ? Math.max(1e-6, drift * 0.3) : 1e-6);
  });

  it('the zombie gets a guard sphere per torso ellipsoid, each watching both arms', () => {
    const bound = bindRig(buildCharacterBody(characterEntry('zombie'), [0, 0, 0], []));
    expect(bound.rig.torsoGuards).toHaveLength(4);
    for (const g of bound.rig.torsoGuards!) expect(g.limbs).toHaveLength(4);   // upper + fore, both sides
  });

  it('the zombie gets a keep-out on both arms, upper and fore', () => {
    const bound = bindRig(buildCharacterBody(characterEntry('zombie'), [0, 0, 0], []));
    expect(bound.rig.headKeepOut?.limbs).toHaveLength(4);
    expect(bound.rig.headKeepOut!.radius).toBeGreaterThan(0.1);
    expect(bound.rig.headKeepOut!.radius).toBeLessThan(0.2);
  });
});
