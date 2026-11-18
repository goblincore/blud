// src/lab/sdf-zombie/zap.test.ts
import { describe, expect, it } from 'vitest';
import { createZap, stepZap, ZAP } from './zap';
import { ZAP_TIER_DEFAULT, resolveZapTier, type ZapTier } from './motion-profile';

const DT = 1 / 60;
const run = (s: ReturnType<typeof createZap>, sec: number, arc: boolean) => {
  let o = stepZap(s, DT, arc);
  for (let i = 1; i < Math.round(sec / DT); i++) o = stepZap(s, DT, arc);
  return o;
};

describe('the zap clock', () => {
  it('rolls cookSec inside the tier range, the same for the same seed', () => {
    const a = createZap(7, ZAP_TIER_DEFAULT), b = createZap(7, ZAP_TIER_DEFAULT), c = createZap(8, ZAP_TIER_DEFAULT);
    expect(a.cookSec).toBeGreaterThanOrEqual(1.6);
    expect(a.cookSec).toBeLessThanOrEqual(2.2);
    expect(b.cookSec).toBe(a.cookSec);
    expect(c.cookSec).not.toBe(a.cookSec);
  });

  it('cooks at 1 / cookSec under the arc and cools at coolRate off it', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    run(s, 0.5, true);
    expect(s.cook).toBeCloseTo(0.5 / s.cookSec, 3);
    const before = s.cook;
    run(s, 0.2, false);
    expect(s.cook).toBeCloseTo(before - ZAP.coolRate * 0.2, 3);
    expect(s.phase).toBe('recovering');
  });

  it('snaps the glow on, flickers inside its band, and fades it over recoverSec', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    const o = run(s, 0.1, true);
    expect(o.glow).toBeGreaterThanOrEqual(ZAP.flickerLo - 1e-6);
    expect(o.glow).toBeLessThanOrEqual(1);
    expect(o.pose).toBe(1);
    const half = run(s, ZAP_TIER_DEFAULT.recoverSec / 2, false);
    expect(half.pose).toBeCloseTo(0.5, 1);
    expect(half.done).toBe(false);
    const end = run(s, ZAP_TIER_DEFAULT.recoverSec, false);
    expect(end.glow).toBe(0);
    expect(end.done).toBe(true);
  });

  it('resumes from where the cook fell to when the arc returns mid-recovery', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    run(s, 1.0, true);
    run(s, 0.2, false);
    const fell = s.cook;
    const o = stepZap(s, DT, true);
    expect(s.phase).toBe('zapped');
    expect(s.cook).toBeGreaterThan(fell);
    expect(o.done).toBe(false);
  });

  it('chars only in the last stretch, and never un-chars', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    const early = run(s, s.cookSec * 0.5, true);
    expect(early.char).toBe(0);
    const late = run(s, s.cookSec * 0.4, true);
    expect(late.char).toBeGreaterThan(0.3);
    const after = run(s, 0.5, false);
    expect(after.char).toBe(late.char);
  });

  it('dies once, on a dying tier, then holds as a statue for statueSec', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    let deaths = 0, o = stepZap(s, DT, true);
    for (let i = 0; i < 4 * 60 && !o.statueDone; i++) { o = stepZap(s, DT, true); if (o.die) deaths++; }
    expect(deaths).toBe(1);
    expect(s.phase).toBe('statue');
    expect(o.statueDone).toBe(true);
    expect(o.glow).toBe(0);
    expect(o.char).toBe(1);
    expect(o.tremor).toBe(0);
    expect(s.t).toBeGreaterThanOrEqual(s.cookSec + ZAP.statueSec - 2 * DT);
  });

  it('holds at a full cook on a tier that does not die, and recovers on release', () => {
    const tier: ZapTier = { ...ZAP_TIER_DEFAULT, dies: false };
    const s = createZap(1, tier);
    const o = run(s, 4, true);
    expect(o.die).toBe(false);
    expect(s.cook).toBe(1);
    expect(s.phase).toBe('zapped');
    expect(run(s, tier.recoverSec + 0.1, false).done).toBe(true);
  });

  it('jolts at seeded irregular gaps, each one a new variant, inverted for its length', () => {
    const times = (seed: number) => {
      const s = createZap(seed, { ...ZAP_TIER_DEFAULT, dies: false });
      const at: number[] = []; let was = 0, lastVariant = -1;
      for (let i = 0; i < 3 * 60; i++) {
        const o = stepZap(s, DT, true);
        if (o.jolt > 0 && was === 0) { at.push(i); expect(o.variant).not.toBe(lastVariant); lastVariant = o.variant; }
        expect(o.invert).toBe(o.jolt > 0);
        expect(o.variant).toBeGreaterThanOrEqual(0);
        expect(o.variant).toBeLessThanOrEqual(2);
        was = o.jolt;
      }
      return at;
    };
    const a = times(3);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(times(3)).toEqual(a);
    expect(times(4)).not.toEqual(a);
    for (let i = 1; i < a.length; i++) {
      const gap = (a[i]! - a[i - 1]!) * DT;
      expect(gap).toBeGreaterThanOrEqual(ZAP.joltGapSec[0] - 2 * DT);
      expect(gap).toBeLessThanOrEqual(ZAP.joltGapSec[1] + ZAP.joltSec + 2 * DT);
    }
  });

  it('a statue ignores the arc', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    let o = stepZap(s, DT, true);
    for (let i = 0; i < 4 * 60 && !o.die; i++) o = stepZap(s, DT, true);
    expect(o.die).toBe(true);
    for (let i = 0; i < 20; i++) {
      o = stepZap(s, DT, i >= 10);
      expect(s.phase).toBe('statue');
      expect(o.done).toBe(false);
      expect(o.die).toBe(false);
      expect(o.glow).toBe(0);
    }
  });

  it('done never fires while the arc is on, even when it toggles every frame', () => {
    const tier: ZapTier = { ...ZAP_TIER_DEFAULT, dies: false };
    for (let seed = 1; seed <= 20; seed++) {
      const s = createZap(seed, tier);
      let char = 0;
      for (let i = 0; i < 600; i++) {
        const arcOn = i % 2 === 0;
        const o = stepZap(s, DT, arcOn);
        if (arcOn) expect(o.done).toBe(false);
        expect(o.char).toBeGreaterThanOrEqual(char);
        char = o.char;
      }
    }
  });

  it('resolves a profile tier over the default', () => {
    expect(resolveZapTier(null)).toEqual(ZAP_TIER_DEFAULT);
    expect(resolveZapTier({ zap: { star: false } }).star).toBe(false);
    expect(resolveZapTier({ zap: { star: false } }).dies).toBe(true);
  });
});
