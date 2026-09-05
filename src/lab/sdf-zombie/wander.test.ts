// src/lab/sdf-zombie/wander.test.ts
import { describe, it, expect } from 'vitest';
import {
  WANDER_TUNING,
  headingDir,
  makeRng,
  stepWander,
  wrapPi,
  type WanderBounds,
  type WanderState,
} from './wander';
import type { Vec3 } from './types';

const BOUNDS: WanderBounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
const INIT: WanderState = { pos: [0, 0, 0], heading: 0, speed: 0, target: null, idle: 0 };

function run(seed: number, steps: number, dt = 1 / 60, bounds: WanderBounds = BOUNDS, init: WanderState = INIT) {
  const rng = makeRng(seed);
  const states: WanderState[] = [];
  let st = init;
  for (let i = 0; i < steps; i++) {
    st = stepWander(st, rng, dt, bounds);
    states.push(st);
  }
  return { states, rng };
}

const json = (states: WanderState[]) => JSON.stringify(states);

describe('stepWander — bounds and motion', () => {
  it('stays inside the injected bounds for a long run', () => {
    const { states } = run(5, 60 * 60); // 60 s
    for (const s of states) {
      expect(s.pos[0]).toBeGreaterThanOrEqual(BOUNDS.minX - 1e-9);
      expect(s.pos[0]).toBeLessThanOrEqual(BOUNDS.maxX + 1e-9);
      expect(s.pos[2]).toBeGreaterThanOrEqual(BOUNDS.minZ - 1e-9);
      expect(s.pos[2]).toBeLessThanOrEqual(BOUNDS.maxZ + 1e-9);
    }
  });

  it('never exceeds cruise speed', () => {
    const { states } = run(5, 60 * 30);
    for (const s of states) {
      expect(s.speed).toBeGreaterThanOrEqual(0);
      expect(s.speed).toBeLessThanOrEqual(WANDER_TUNING.speed + 1e-9);
    }
  });

  it('bounds the turn rate: |Δheading| ≤ turnRate·dt every step', () => {
    const dt = 1 / 60;
    const { states } = run(5, 60 * 30, dt);
    const maxTurn = WANDER_TUNING.turnRate * dt + 1e-9;
    let prev = INIT.heading;
    for (const s of states) {
      expect(Math.abs(wrapPi(s.heading - prev))).toBeLessThanOrEqual(maxTurn);
      prev = s.heading;
    }
  });

  it('pauses idle beats and recovers to cruise afterwards', () => {
    const { states } = run(8, 60 * 60);
    expect(states.some(s => s.idle > 0)).toBe(true);
    expect(states.some(s => s.idle === 0 && s.speed > WANDER_TUNING.speed * 0.6)).toBe(true);
  });

  it('picks targets inside the bounds (minus the margin)', () => {
    const { states } = run(3, 600);
    const targets = states.filter(s => s.target !== null).map(s => s.target!);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      const m = WANDER_TUNING.margin - 1e-6;
      expect(t[0]).toBeGreaterThanOrEqual(BOUNDS.minX + m);
      expect(t[0]).toBeLessThanOrEqual(BOUNDS.maxX - m);
      expect(t[2]).toBeGreaterThanOrEqual(BOUNDS.minZ + m);
      expect(t[2]).toBeLessThanOrEqual(BOUNDS.maxZ - m);
    }
  });

  it('arrives at a target ahead and then idles', () => {
    // Straight ahead (+z, matching heading 0): no turning needed.
    const init: WanderState = { pos: [0, 0, 0], heading: 0, speed: 0, target: [0, 0, 3], idle: 0 };
    const { states } = run(1, 60 * 8, 1 / 60, BOUNDS, init);
    const arrived = states.find(s => s.idle > 0);
    expect(arrived).toBeDefined();
    expect(arrived!.idle).toBeGreaterThan(0);
  });

  it('turns toward an off-axis target and eventually arrives', () => {
    const init: WanderState = { pos: [0, 0, 0], heading: 0, speed: 0, target: [3, 0, 3], idle: 0 };
    const { states } = run(2, 60 * 10, 1 / 60, BOUNDS, init);
    const arrived = states.find(s => s.idle > 0);
    expect(arrived).toBeDefined();
  });
});

describe('stepWander — determinism', () => {
  it('same seed ⇒ identical trajectory; different seed ⇒ different', () => {
    const a = run(17, 60 * 20);
    const b = run(17, 60 * 20);
    expect(json(a.states)).toBe(json(b.states));
    const c = run(18, 60 * 20);
    expect(json(c.states)).not.toBe(json(a.states));
  });

  it('makeRng is deterministic per seed', () => {
    const a = makeRng(99);
    const b = makeRng(99);
    const c = makeRng(100);
    const seq = (rng: () => number) => Array.from({ length: 5 }, () => rng());
    expect(seq(a)).toEqual(seq(b));
    expect(seq(c)).not.toEqual(seq(a));
  });
});

describe('helpers', () => {
  it('headingDir: +z at 0, +x at π/2, unit length', () => {
    const z = headingDir(0);
    expect(z[0]).toBeCloseTo(0, 10);
    expect(z[2]).toBeCloseTo(1, 10);
    const x = headingDir(Math.PI / 2);
    expect(x[0]).toBeCloseTo(1, 10);
    expect(x[2]).toBeCloseTo(0, 10);
    const h = headingDir(1.234);
    expect(Math.hypot(h[0], h[2])).toBeCloseTo(1, 10);
  });

  it('wrapPi wraps to (-π, π]', () => {
    expect(wrapPi(0)).toBe(0);
    expect(wrapPi(Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(wrapPi(-Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(wrapPi(3 * Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(wrapPi(4 * Math.PI)).toBeCloseTo(0, 10);
    expect(wrapPi(-1.5)).toBeCloseTo(-1.5, 10);
  });
});

describe('stepWander cruise override', () => {
  it('a higher cruise reaches a higher speed on a long leg', () => {
    const bounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
    const go = (cruise?: number) => {
      let st: WanderState = { pos: [-7, 0, -7] as Vec3, heading: 0, speed: 0, target: [7, 0, 7] as Vec3, idle: 0 };
      let top = 0;
      for (let i = 0; i < 120; i++) { st = stepWander(st, makeRng(1), 1 / 60, bounds, cruise); top = Math.max(top, st.speed); }
      return top;
    };
    expect(go()).toBeCloseTo(go(WANDER_TUNING.speed), 12);
    expect(go(3.4)).toBeGreaterThan(go() * 2);
  });
});
