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
