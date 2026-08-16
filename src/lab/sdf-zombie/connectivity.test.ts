import { describe, it, expect } from 'vitest';
import { cutLimbs } from './connectivity';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { worldHitToWound, woundWorldPos } from './damage';
import type { Wound } from './damage';
import type { Vec3 } from './types';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const torso = body.clusters.find(c => c.limb === 'torso')!;

/** The armL attachment endpoint: nearest armL endpoint to the torso centre. */
function armRoot(): Vec3 {
  const arm = body.clusters.find(c => c.limb === 'armL')!;
  const prims = body.prims.slice(arm.start, arm.start + arm.count);
  let best: Vec3 = prims[0]!.a; let bd = Infinity;
  for (const p of prims) for (const e of [p.a, p.b]) {
    const d = Math.hypot(e[0] - torso.center[0], e[1] - torso.center[1], e[2] - torso.center[2]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function woundAt(at: Vec3, radius: number, type: 'blast' | 'burn' = 'blast'): Wound {
  return worldHitToWound(body.prims, at, radius, type);
}

describe('cutLimbs', () => {
  it('detaches a limb whose neck a big blast engulfs', () => {
    const root = armRoot();
    // Radius comfortably above neck girth (~0.06) plus the sample offset.
    const wounds = [woundAt(root, 0.16)];
    expect(cutLimbs(body, wounds, torso.center)).toContain('armL');
  });

  it('does not detach on a nick (small wound near the neck)', () => {
    const root = armRoot();
    const wounds = [woundAt([root[0] + 0.05, root[1], root[2]], 0.055)];
    expect(cutLimbs(body, wounds, torso.center)).not.toContain('armL');
  });

  it('never detaches from burns', () => {
    const root = armRoot();
    const wounds = [woundAt(root, 0.2, 'burn')];
    expect(cutLimbs(body, wounds, torso.center)).toHaveLength(0);
  });

  it('ignores dead clusters and the torso', () => {
    const dead = {
      ...body,
      clusters: body.clusters.map(c => c.limb === 'armL' ? { ...c, alive: false } : c),
    };
    const wounds = [woundAt(armRoot(), 0.2)];
    expect(cutLimbs(dead, wounds, torso.center)).not.toContain('armL');
    expect(cutLimbs(dead, wounds, torso.center)).not.toContain('torso');
  });

  it('wound placement resolves through woundWorldPos (sanity)', () => {
    const root = armRoot();
    const w = woundAt(root, 0.16);
    const back = woundWorldPos(body.prims, w);
    expect(Math.hypot(back[0] - root[0], back[1] - root[1], back[2] - root[2]))
      .toBeLessThan(0.05);
  });
});
