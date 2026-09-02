import { describe, expect, it } from 'vitest';
import { makeGutChain, stepGutChain, pinGutChain, detachGutChain, GUT_TUNING } from './entrails';

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
    // Constraints converge to the rest length, not past it.
    expect(span).toBeLessThan(GUT_TUNING.restLength * 1.15);
    expect(span).toBeGreaterThan(GUT_TUNING.restLength * 0.7);
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
