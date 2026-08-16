import { describe, it, expect } from 'vitest';
import { cutChains, cutLimbs } from './connectivity';
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

// --- cutChains: mid-limb severing ------------------------------------------

/** legL's chain: thigh (topmost midpoint), foot (degenerate ball), shin (the
 *  rest), and the knee joint — the closest endpoint pair across thigh/shin. */
function legChain() {
  const leg = body.clusters.find(c => c.limb === 'legL')!;
  const prims = body.prims.slice(leg.start, leg.start + leg.count)
    .filter(p => p.op !== 'sub');
  const midY = (p: (typeof prims)[number]) => (p.a[1] + p.b[1]) / 2;
  const thigh = prims.reduce((m, p) => (midY(p) > midY(m) ? p : m));
  const foot = prims.find(p =>
    Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]) < 1e-6)!;
  const shin = prims.find(p => p !== thigh && p !== foot)!;
  let knee: Vec3 = thigh.b; let best = Infinity;
  for (const e of [thigh.a, thigh.b]) for (const f of [shin.a, shin.b]) {
    const d = Math.hypot(e[0] - f[0], e[1] - f[1], e[2] - f[2]);
    if (d < best) {
      best = d;
      knee = [(e[0] + f[0]) / 2, (e[1] + f[1]) / 2, (e[2] + f[2]) / 2];
    }
  }
  return { prims, thigh, shin, foot, knee };
}

describe('cutChains', () => {
  const { thigh, shin, knee } = legChain();

  it('cuts a limb whose knee joint a blast engulfs — fromPrim is the shin', () => {
    const cuts = cutChains(body, [woundAt(knee, 0.16)]);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.limb).toBe('legL');
    expect(cuts[0]!.fromPrim).toBe(body.prims.indexOf(shin));
    // sanity of the fixture itself: the cut really is mid-limb
    expect(body.prims.indexOf(thigh)).toBeGreaterThanOrEqual(0);
  });

  it('does not cut on a nick of the joint', () => {
    const nick: Vec3 = [knee[0] + 0.05, knee[1], knee[2]];
    expect(cutChains(body, [woundAt(nick, 0.055)])).toHaveLength(0);
  });

  it('never cuts from burns', () => {
    expect(cutChains(body, [woundAt(knee, 0.2, 'burn')])).toHaveLength(0);
  });

  it('ignores the head — the head stays whole', () => {
    // A blast big enough to engulf any head joint still reports no head cut;
    // the head's face carves and bouncing-whole head are Blood signatures.
    const head = body.clusters.find(c => c.limb === 'head')!;
    const cuts = cutChains(body, [woundAt(head.center, 0.3)]);
    expect(cuts.every(c => c.limb !== 'head')).toBe(true);
  });

  it('ignores clusters already severed', () => {
    const dead = {
      ...body,
      clusters: body.clusters.map(c => c.limb === 'legL' ? { ...c, alive: false } : c),
    };
    expect(cutChains(dead, [woundAt(knee, 0.16)])).toHaveLength(0);
  });
});
