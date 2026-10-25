import { describe, expect, it } from 'vitest';
import { makeGutChain, stepGutChain, pinGutChain, detachGutChain, seatGutChain, GUT_TUNING, type GutChain } from './entrails';
import type { Vec3 } from './types';
import type { DebrisGround } from './debris-ground';

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

describe('gut chain', () => {
  it('starts with every node at the anchor', () => {
    const c = makeGutChain([0, 1.2, 0]);
    expect(c.nodes).toHaveLength(GUT_TUNING.nodes);
    for (const n of c.nodes) expect(n.pos).toEqual([0, 1.2, 0]);
  });

  it('settles to roughly the rest length when hung', () => {
    let c = makeGutChain([0, 2.5, 0]);
    for (let i = 0; i < 600; i++) c = stepGutChain(c, 1 / 60);
    const head = c.nodes[0]!.pos, tail = c.nodes[c.nodes.length - 1]!.pos;
    const span = Math.hypot(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]);
    // Two failure modes, and the SPRING sits between them. Upper: segments
    // must never stretch past the contour length. Lower: the chain must not
    // collapse to coincident nodes (the accordion lock, span ~0).
    //
    // The old lower bound was 0.5x rest, written before the spring existed —
    // it asserted a hung chain stays EXTENDED, which is exactly the behaviour
    // the coil deliberately removes. It was pinning the absence of the
    // feature, so it is relaxed here rather than the feature being weakened.
    expect(span).toBeLessThan(GUT_TUNING.restLength * 1.15);
    expect(span).toBeGreaterThan(c.seg * 1.5);
  });

  it('keeps node 0 exactly at the pin while attached', () => {
    let c = makeGutChain([0, 2, 0]);
    for (let i = 0; i < 120; i++) {
      c = pinGutChain(c, [0.5, 1.8, -0.3]);
      c = stepGutChain(c, 1 / 60);
    }
    expect(near(c.nodes[0]!.pos[0], 0.5)).toBe(true);
    expect(near(c.nodes[0]!.pos[1], 1.8)).toBe(true);
    expect(near(c.nodes[0]!.pos[2], -0.3)).toBe(true);
  });

  it('comes to rest on the floor and never sinks through it', () => {
    let c = detachGutChain(makeGutChain([0, 2, 0]));
    for (let i = 0; i < 900; i++) c = stepGutChain(c, 1 / 60);
    for (const n of c.nodes) expect(n.pos[1]).toBeGreaterThanOrEqual(-1e-6);
    expect(c.settled).toBe(true);
  });

  it('a settled chain stops moving entirely', () => {
    // Freezing is what makes a room full of spilled guts free.
    let c = detachGutChain(makeGutChain([0, 2, 0]));
    for (let i = 0; i < 900; i++) c = stepGutChain(c, 1 / 60);
    const before = c.nodes.map(n => [...n.pos]);
    c = stepGutChain(c, 1 / 60);
    expect(c.nodes.map(n => [...n.pos])).toEqual(before);
  });

  it('detaching preserves momentum rather than dropping the chain dead', () => {
    let c = makeGutChain([0, 2, 0]);
    c = pinGutChain(c, [0, 2, 0]);
    for (let i = 0; i < 30; i++) { c = pinGutChain(c, [i * 0.02, 2, 0]); c = stepGutChain(c, 1 / 60); }
    const moving = detachGutChain(c);
    const p0 = moving.nodes[0]!.pos[0];
    const after = stepGutChain(moving, 1 / 60);
    expect(after.nodes[0]!.pos[0]).toBeGreaterThan(p0);
  });

  it('a chain torn from REST falls — detaching a hanging rope must not freeze it mid-air', () => {
    // The game's actual death case: the rope hangs at rest, then the body
    // collapses and the rope is detached. This used to freeze on the spot:
    // the settle metric counted only the CARRIED velocity (pos - prev), which
    // is ~zero for a hanging-at-rest chain, so the first post-detach step saw
    // moved < settleEps and set settled before gravity ever moved a node.
    // Found by the task-8 capture: torn guts floated 0.47 m up for 4 s.
    let c = makeGutChain([0, 2, 0]);
    for (let i = 0; i < 240; i++) c = stepGutChain(pinGutChain(c, [0, 2, 0]), 1 / 60);
    const torn = detachGutChain(c);
    expect(stepGutChain(torn, 1 / 60).settled).toBe(false);
    let fell = torn;
    for (let i = 0; i < 240; i++) fell = stepGutChain(fell, 1 / 60);
    const tail = fell.nodes[fell.nodes.length - 1]!.pos;
    expect(tail[1]).toBeLessThan(0.2);   // actually reached the floor
    expect(fell.settled).toBe(true);     // and then came to rest
  });
});

describe('the gut chain is a SPRING (organs r3)', () => {
  it('a chain released straight pulls itself into a coil', () => {
    // The owner's report was "a rigid dark T shape". A chain with only
    // distance constraints has nothing that resists a straight line; the
    // skip-one constraint is what makes a coil the REST shape.
    let c = makeGutChain([0, 2, 0]);
    c = detachGutChain(c);
    for (let i = 0; i < 400; i++) c = stepGutChain(c, 1 / 60);
    const head = c.nodes[0]!.pos, tail = c.nodes[c.nodes.length - 1]!.pos;
    const span = Math.hypot(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]);
    // A coil is markedly SHORTER end-to-end than its own contour length.
    expect(span).toBeLessThan(GUT_TUNING.restLength * 0.7);
  });

  it('coilTightness 0 degrades to a plain hanging rope', () => {
    // The graceful-failure lever: if the spring reads comedic, this is the
    // way back to the old behaviour without a revert.
    let c = makeGutChain([0, 2, 0], { coilTightness: 0 });
    c = detachGutChain(c);
    for (let i = 0; i < 400; i++) c = stepGutChain(c, 1 / 60);
    const head = c.nodes[0]!.pos, tail = c.nodes[c.nodes.length - 1]!.pos;
    const span = Math.hypot(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]);
    expect(span).toBeGreaterThan(GUT_TUNING.restLength * 0.7);
  });

  it('stays finite and bounded — the two constraint families must not fight', () => {
    // Skip-one pulls nodes together while segments push them apart. Weighted
    // wrongly they oscillate and blow up.
    let c = makeGutChain([0, 2, 0]);
    for (let i = 0; i < 2000; i++) {
      c = pinGutChain(c, [Math.sin(i / 20) * 0.3, 2, 0]);
      c = stepGutChain(c, 1 / 60);
    }
    for (const n of c.nodes) {
      for (const v of n.pos) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(50);
      }
    }
  });

  it('still freezes once settled', () => {
    let c = detachGutChain(makeGutChain([0, 2, 0]));
    for (let i = 0; i < 1200; i++) c = stepGutChain(c, 1 / 60);
    expect(c.settled).toBe(true);
    const before = c.nodes.map(n => [...n.pos]);
    c = stepGutChain(c, 1 / 60);
    expect(c.nodes.map(n => [...n.pos])).toEqual(before);
  });
});

describe('an ATTACHED chain coils too (organs r3 fix)', () => {
  it('a hanging rope is visibly coiled, not nearly straight', () => {
    // The original spring test only ever measured a DETACHED chain, which
    // coils easily at any setting — so a hanging rope stayed ~0.8x rest span
    // (essentially the "rigid T" the owner kept reporting) while the test was
    // green. An attached chain fights gravity along its whole length, so it
    // is the harder case and the one the game actually shows most of the time.
    let c = makeGutChain([0, 1.2, 0]);
    for (let i = 0; i < 600; i++) { c = pinGutChain(c, [0, 1.2, 0]); c = stepGutChain(c, 1 / 60); }
    const a = c.nodes[0]!.pos, b = c.nodes[c.nodes.length - 1]!.pos;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    expect(span).toBeLessThan(GUT_TUNING.restLength * 0.55);
  });
});

describe('stepGutChain on a debris ground (plan 3b Task 4)', () => {
  // A 1 m ledge at x < 0. Its riser is a wall to a node below the ledge top (as a sector riser is to `bounce`), so a
  // node down there cannot be popped up onto the ledge by the floor clamp.
  const ledge: DebrisGround = {
    floorAt: (x) => (x < 0 ? 1 : 0),
    bounce: (prev, next, vel, restitution, friction, radius = 0) => (prev[0] >= 0 && prev[1] < 1 && next[0] - radius < 0
      ? { pos: [Math.max(radius, 0.01), next[1], next[2]], vel: [vel[0] < 0 ? -vel[0] * restitution : vel[0], vel[1], vel[2] * friction],
        normal: [1, 0, 0] }
      : null),
  };
  const flung = (x0: number, vx: number): GutChain => {
    const c = detachGutChain(makeGutChain([x0, 1.3, 0]));
    return { ...c, nodes: c.nodes.map((n) => ({ pos: n.pos, prev: [n.prev[0] - vx, n.prev[1], n.prev[2]] as Vec3 })) };
  };
  it('a detached rope lies on the floor under each node: one dropped on the ledge stays on it', () => {
    let c = flung(-0.1, 0.005);
    for (let i = 0; i < 600 && !c.settled; i++) {
      c = stepGutChain(c, 1 / 60, ledge, 0.05);
      for (const n of c.nodes) expect(n.pos[1]).toBeGreaterThanOrEqual(ledge.floorAt(n.pos[0], n.pos[2]) - 1e-9);
    }
    expect(c.settled).toBe(true);
    for (const n of c.nodes) expect(n.pos[1]).toBeCloseTo(1, 6);
  });
  it('one thrown over the edge falls to the lower floor and settles there (no hovering, no jitter at the riser)', () => {
    let c = flung(-0.1, 0.02);
    for (let i = 0; i < 600 && !c.settled; i++) {
      c = stepGutChain(c, 1 / 60, ledge, 0.05);
      for (const n of c.nodes) expect(n.pos[1]).toBeGreaterThanOrEqual(ledge.floorAt(n.pos[0], n.pos[2]) - 1e-9);
    }
    expect(c.settled).toBe(true);
    for (const n of c.nodes) { expect(n.pos[0]).toBeGreaterThan(0); expect(n.pos[1]).toBeCloseTo(0, 6); }
  });
  it('without a ground the floor is y = 0 as before', () => {
    let a = detachGutChain(makeGutChain([0, 0.5, 0])), b = a;
    for (let i = 0; i < 120; i++) { a = stepGutChain(a, 1 / 60); b = stepGutChain(b, 1 / 60, undefined); }
    expect(b).toEqual(a);
    expect(a.nodes.every((n) => !('floorY' in n))).toBe(true);
  });
  it('a node never passes a sector wall: a rope flung at it piles up on the near side', () => {
    const WALL_X = 0.3, R = 0.05;
    const crossings: number[] = [];
    const wall: DebrisGround = {
      floorAt: () => 0,
      bounce: (prev, next, vel, restitution, friction, radius = 0) => {
        if (!(prev[0] < WALL_X && next[0] + radius > WALL_X - 1e-12)) return null;
        crossings.push(radius);
        const vn = vel[0];
        return { pos: [WALL_X - Math.max(radius, 0.01), next[1], next[2]],
          vel: [vn > 0 ? -vn * restitution : vn, vel[1], vel[2] * friction], normal: [-1, 0, 0] };
      },
    };
    let c: GutChain = detachGutChain(makeGutChain([0, 1.0, 0]));
    // Fling it hard at the wall: every node carries +x velocity (verlet: pos - prev).
    c = { ...c, nodes: c.nodes.map((n) => ({ pos: n.pos, prev: [n.prev[0] - 0.12, n.prev[1], n.prev[2]] as Vec3 })) };
    let maxX = -Infinity;
    for (let i = 0; i < 600 && !c.settled; i++) {
      c = stepGutChain(c, 1 / 60, wall, R);
      for (const n of c.nodes) maxX = Math.max(maxX, n.pos[0]);
    }
    expect(crossings.length).toBeGreaterThan(0);                 // it did reach the wall
    expect(crossings.every((r) => r === R)).toBe(true);          // probed with the node's thickness
    expect(maxX).toBeLessThanOrEqual(WALL_X - R + 1e-9);         // and no node centre got past it
    for (const n of c.nodes) expect(n.pos[1]).toBeGreaterThanOrEqual(-1e-9);
  });
  it('off the map a node keeps its last floor (spawned with the body floor as floorY)', () => {
    const hole: DebrisGround = { floorAt: () => NaN, bounce: () => null };
    let c = detachGutChain(makeGutChain([0, 1.5, 0], { floorY: 0.5 }));
    expect(c.nodes.every((n) => n.floorY === 0.5)).toBe(true);
    for (let i = 0; i < 600 && !c.settled; i++) c = stepGutChain(c, 1 / 60, hole);
    for (const n of c.nodes) expect(n.pos[1]).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(Math.min(...c.nodes.map((n) => n.pos[1]))).toBeCloseTo(0.5, 6);
  });
  it('a ground that matches y = 0 everywhere lands the rope where the room path does', () => {
    const flat: DebrisGround = { floorAt: () => 0, bounce: () => null };
    let a = detachGutChain(makeGutChain([0, 0.8, 0])), b = a;
    for (let i = 0; i < 300; i++) { a = stepGutChain(a, 1 / 60); b = stepGutChain(b, 1 / 60, flat); }
    expect(b.nodes.map((n) => n.pos)).toEqual(a.nodes.map((n) => n.pos));
  });
});

describe('seatGutChain (the sector spawn seat, plan 3b)', () => {
  it('moves the whole chain with its motion and gives every node the body floor', () => {
    const c = makeGutChain([1, 1.2, 0]);
    const s = seatGutChain(c, [0.8, 1.1, 0.1], 0.25);
    for (let i = 0; i < c.nodes.length; i++) {
      const a = c.nodes[i]!, b = s.nodes[i]!;
      expect(b.pos[0] - a.pos[0]).toBeCloseTo(-0.2, 12);
      expect(b.pos[1] - a.pos[1]).toBeCloseTo(-0.1, 12);
      expect(b.pos[2] - a.pos[2]).toBeCloseTo(0.1, 12);
      expect(b.pos[1] - b.prev[1]).toBeCloseTo(a.pos[1] - a.prev[1], 12);   // the unspool velocity is kept
      expect(b.floorY).toBe(0.25);
    }
    expect(c.nodes[0]!.floorY).toBeUndefined();                            // the input is untouched
  });
});
