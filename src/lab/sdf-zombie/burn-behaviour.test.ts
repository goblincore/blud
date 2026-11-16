import { describe, it, expect } from 'vitest';
import { BURN_BEHAVIOUR, createBurnPanic, stepBurnPanic, setBurnBehaviourEnabled, burnBehaviourEnabled } from './burn-behaviour';
import { BURN_TIER_DEFAULT, type BurnTier } from './motion-profile';

const DT = 1 / 30;
const run = (secs: number, seed = 7, tier: BurnTier = BURN_TIER_DEFAULT) => {
  const s = createBurnPanic(seed, tier);
  const outs = [];
  for (let t = 0; t < secs; t += DT) {
    outs.push(stepBurnPanic(s, { self: [0, 0, 0], player: [5, 0, 0], forward: [0, 0, 1] }, DT));
  }
  return { s, outs };
};

describe('stepBurnPanic', () => {
  it('rolls a duration inside the tier range, different per seed', () => {
    const ds = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => createBurnPanic(seed, BURN_TIER_DEFAULT).durationSec);
    for (const d of ds) { expect(d).toBeGreaterThanOrEqual(3); expect(d).toBeLessThanOrEqual(6); }
    expect(new Set(ds.map(d => d.toFixed(3))).size).toBeGreaterThan(4);
  });
  it('runs AWAY from the player and never fires', () => {
    const { outs } = run(2);
    for (const o of outs) {
      expect(o.fire).toBe(false);
      expect(o.target[0]).toBeLessThan(0);   // the player is at +x
    }
  });
  it('with no player known it runs along its own forward', () => {
    const s = createBurnPanic(3, BURN_TIER_DEFAULT);
    const o = stepBurnPanic(s, { self: [0, 0, 0], player: null, forward: [0, 0, 1] }, DT);
    expect(o.target[2]).toBeGreaterThan(0);
  });
  it('goes panic, then falter, then done, and dies exactly once', () => {
    const { s, outs } = run(8);
    const phases = outs.map(o => o.phase);
    const firstFalter = phases.indexOf('falter'), firstDone = phases.indexOf('done');
    expect(phases[0]).toBe('panic');
    expect(firstFalter).toBeGreaterThan(0);
    expect(firstDone).toBeGreaterThan(firstFalter);
    expect(firstFalter * DT).toBeCloseTo(s.durationSec * BURN_BEHAVIOUR.falterAt, 0);
    expect(outs.filter(o => o.die).length).toBe(1);
    expect(outs[firstDone]!.die).toBe(true);
  });
  it('a tier that does not die never dies', () => {
    const { outs } = run(12, 7, { ...BURN_TIER_DEFAULT, dies: false });
    expect(outs.some(o => o.phase === 'done')).toBe(true);
    expect(outs.some(o => o.die)).toBe(false);
  });
  it('speed and flail hold through panic and ease down across falter', () => {
    const { outs } = run(8);
    const panic = outs.filter(o => o.phase === 'panic'), falter = outs.filter(o => o.phase === 'falter');
    for (const o of panic) { expect(o.cruiseScale).toBeCloseTo(BURN_TIER_DEFAULT.speed); expect(o.flail).toBe(1); expect(o.fold).toBe(0); }
    const last = falter[falter.length - 1]!;
    expect(last.cruiseScale).toBeLessThan(BURN_TIER_DEFAULT.speed * 0.6);
    expect(last.flail).toBeLessThan(0.5);
    expect(last.fold).toBeGreaterThan(0.8);
    for (let i = 1; i < falter.length; i++) expect(falter[i]!.cruiseScale).toBeLessThanOrEqual(falter[i - 1]!.cruiseScale + 1e-9);
  });
  it('the heading turns smoothly: no jump between steps', () => {
    const { outs } = run(8);
    const ang = outs.map(o => Math.atan2(o.target[2], o.target[0]));
    for (let i = 1; i < ang.length; i++) {
      let d = Math.abs(ang[i]! - ang[i - 1]!);
      if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d).toBeLessThan(0.25);   // rad per 1/30 s
    }
  });
  it('blocked turns the flee heading by at least a quarter turn, once per cooldown', () => {
    const s = createBurnPanic(7, BURN_TIER_DEFAULT);
    const inp = { self: [0, 0, 0] as [number, number, number], player: [5, 0, 0] as [number, number, number], forward: [0, 0, 1] as [number, number, number] };
    const ang = (o: { target: readonly number[] }) => Math.atan2(o.target[2]!, o.target[0]!);
    const turn = (x: number, y: number) => { let d = Math.abs(x - y); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
    const a0 = ang(stepBurnPanic(s, inp, DT));
    const a1 = ang(stepBurnPanic(s, { ...inp, blocked: true }, DT));
    expect(turn(a1, a0)).toBeGreaterThan(Math.PI / 2 - 0.3);
    // Still blocked on the next steps: no second turn until the cooldown is out.
    const a2 = ang(stepBurnPanic(s, { ...inp, blocked: true }, DT));
    expect(turn(a2, a1)).toBeLessThan(0.25);
    for (let t = 0; t < BURN_BEHAVIOUR.blockedCoolSec + 0.1; t += DT) stepBurnPanic(s, inp, DT);
    const b0 = ang(stepBurnPanic(s, inp, DT));
    const b1 = ang(stepBurnPanic(s, { ...inp, blocked: true }, DT));
    expect(turn(b1, b0)).toBeGreaterThan(Math.PI / 2 - 0.3);
  });
  it('blocked with a probe, it takes the first turn the body can walk', () => {
    // The player is along +x, so away is -x. Only +z is walkable.
    const s = createBurnPanic(7, BURN_TIER_DEFAULT);
    const asked: number[] = [];
    const o = stepBurnPanic(s, {
      self: [0, 0, 0], player: [5, 0, 0], forward: [0, 0, 1], blocked: true,
      clear: (p) => { asked.push(p[2]); return p[2] > 0.5; },
    }, DT);
    expect(asked.length).toBeGreaterThan(0);
    expect(o.target[2]).toBeGreaterThan(1);
    // Unblocked steps never ask.
    const n = asked.length;
    stepBurnPanic(s, { self: [0, 0, 0], player: [5, 0, 0], forward: [0, 0, 1], clear: () => { asked.push(0); return true; } }, DT);
    expect(asked.length).toBe(n);
  });
  it('however often it is blocked, it never heads back at the player', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createBurnPanic(seed, { ...BURN_TIER_DEFAULT, panicSec: [30, 30] });
      for (let k = 0; k < 400; k++) {
        const o = stepBurnPanic(s, { self: [0, 0, 0], player: [5, 0, 0], forward: [0, 0, 1], blocked: k % 20 === 0 }, DT);
        // The player is along +x: the heading stays out of the 30 degree cone toward him.
        expect(Math.atan2(Math.abs(o.target[2]), o.target[0])).toBeGreaterThan(Math.PI / 6);
      }
    }
  });
  it('is deterministic for a seed', () => {
    expect(run(5, 11).outs).toEqual(run(5, 11).outs);
  });
  it('keeps the cost-study switch', () => {
    setBurnBehaviourEnabled(false);
    expect(burnBehaviourEnabled()).toBe(false);
    setBurnBehaviourEnabled(true);
    expect(burnBehaviourEnabled()).toBe(true);
  });
});
