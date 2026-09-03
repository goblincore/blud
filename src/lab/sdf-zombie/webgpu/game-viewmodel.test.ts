// src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts
import { describe, expect, it } from 'vitest';
import {
  RECOIL, RELOAD, ejectedShell, fireRecoil, flashEnvelope, hingeOpenFraction,
  loadShellTravel, magazineAfterFire, reloadPhaseAt, reloadPose, supportHandPose,
} from './game-viewmodel';

describe('flashEnvelope', () => {
  it('is zero before the shot and after the window', () => {
    expect(flashEnvelope(-0.01)).toBe(0);
    expect(flashEnvelope(0.071)).toBe(0);
  });
  it('peaks at 1 immediately at the shot', () => {
    expect(flashEnvelope(0)).toBeCloseTo(1, 5);
  });
  it('decays monotonically across the window', () => {
    let prev = Infinity;
    for (let t = 0; t <= 0.07; t += 0.005) {
      const v = flashEnvelope(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe('magazineAfterFire', () => {
  it('spends one shell per barrel fired', () => {
    expect(magazineAfterFire(2, 1)).toBe(1);
    expect(magazineAfterFire(2, 2)).toBe(0);
  });
  it('never goes negative when both barrels are pulled on one shell', () => {
    expect(magazineAfterFire(1, 2)).toBe(0);
  });
  it('refuses to fire an empty gun', () => {
    expect(magazineAfterFire(0, 1)).toBe(0);
  });
});

describe('reloadPhaseAt', () => {
  it('walks the six beats in order', () => {
    expect(reloadPhaseAt(0.00)).toBe('present');
    expect(reloadPhaseAt(0.40)).toBe('break');
    expect(reloadPhaseAt(0.60)).toBe('eject');
    expect(reloadPhaseAt(0.90)).toBe('load');
    expect(reloadPhaseAt(1.13)).toBe('snap');
    expect(reloadPhaseAt(1.25)).toBe('settle');
  });
  it('is done past the total', () => {
    expect(reloadPhaseAt(RELOAD.totalSec + 0.01)).toBe('done');
  });
});

describe('hingeOpenFraction', () => {
  it('is shut at rest and shut again when the reload ends', () => {
    expect(hingeOpenFraction(0)).toBeCloseTo(0, 6);
    expect(hingeOpenFraction(RELOAD.totalSec)).toBeCloseTo(0, 6);
  });
  it('is fully open across eject and load', () => {
    expect(hingeOpenFraction(0.60)).toBeCloseTo(1, 6);
    expect(hingeOpenFraction(0.90)).toBeCloseTo(1, 6);
  });
  it('opens monotonically through the break beat', () => {
    let prev = -Infinity;
    for (let t = RELOAD.presentSec; t <= RELOAD.breakEndSec; t += 0.01) {
      const v = hingeOpenFraction(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it('never leaves the unit range', () => {
    for (let t = -0.1; t < RELOAD.totalSec + 0.1; t += 0.005) {
      const v = hingeOpenFraction(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});


describe('reloadPose', () => {
  it('is at rest at both ends, so the reload cannot leave the gun crooked', () => {
    for (const t of [0, RELOAD.totalSec, RELOAD.totalSec + 0.5]) {
      const p = reloadPose(t);
      expect(p.roll).toBeCloseTo(0, 6);
      expect(p.pitch).toBeCloseTo(0, 6);
      expect(p.dy).toBeCloseTo(0, 6);
      expect(p.hinge).toBeCloseTo(0, 6);
    }
  });

  it('presents DURING the present beat, not across the whole reload', () => {
    // The bug this replaced drove the roll with sin(PI*t/total), peaking at
    // 0.475 s -- the middle. The presentation must be essentially complete by
    // the time the hinge starts opening.
    const atPresentEnd = reloadPose(RELOAD.presentSec);
    const peak = Math.min(...[0, 0.05, 0.1, 0.14, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]
      .map((t) => reloadPose(t).roll));
    expect(atPresentEnd.roll).toBeLessThan(-10);
    // the deepest roll must NOT be at mid-reload
    expect(reloadPose(0.475).roll).toBeGreaterThan(peak - 1e-6);
  });

  it('holds the hinge fully open across eject and load', () => {
    // Tied to RELOAD.* rather than hardcoded absolute times: this test held
    // stale 1.05s-timeline numbers (0.34/0.44/0.55/0.70) straight through the
    // Task 4 retime and went quietly wrong -- at the new tempo 0.34s lands
    // mid-break (hinge ~0.48), not fully open. Anchoring to the beat sheet is
    // what keeps this from happening again.
    for (const t of [
      RELOAD.breakEndSec + 0.04, RELOAD.ejectEndSec,
      (RELOAD.ejectEndSec + RELOAD.loadEndSec) / 2, RELOAD.loadSeatSec,
    ]) {
      expect(reloadPose(t).hinge).toBeGreaterThan(0.97);
    }
  });

  it('shuts faster than it opens — the snap', () => {
    const openSpan = RELOAD.breakEndSec - RELOAD.presentSec;
    const shutSpan = RELOAD.snapEndSec - RELOAD.loadEndSec;
    expect(shutSpan).toBeLessThan(openSpan);
  });

  it('never leaves the hinge outside the unit range', () => {
    for (let t = -0.2; t < RELOAD.totalSec + 0.3; t += 0.005) {
      const h = reloadPose(t).hinge;
      expect(h).toBeGreaterThanOrEqual(-1e-9);
      expect(h).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('ejectedShell', () => {
  it('throws nothing before the eject beat — a shut gun cannot eject', () => {
    expect(ejectedShell(0, 0)).toBeNull();
    expect(ejectedShell(RELOAD.ejectAtSec - 0.01, 0)).toBeNull();
  });
  it('leaves the breech going UP and toward the camera', () => {
    const s = ejectedShell(RELOAD.ejectAtSec + 0.05, 0);
    expect(s).not.toBeNull();
    expect(s!.y).toBeGreaterThan(0);
    expect(s!.z).toBeGreaterThan(0);
  });
  it('arcs — rises then falls back below the breech', () => {
    const ys = [0.05, 0.15, 0.25, 0.45, 0.7].map((d) => ejectedShell(RELOAD.ejectAtSec + d, 0)!.y);
    expect(Math.max(...ys)).toBeGreaterThan(ys[0]!);
    expect(ys[ys.length - 1]!).toBeLessThan(Math.max(...ys));
  });
  it('throws the two cases apart, not on top of each other', () => {
    const a = ejectedShell(RELOAD.ejectAtSec + 0.1, 0)!;
    const b = ejectedShell(RELOAD.ejectAtSec + 0.1, 1)!;
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.02);
    expect(a.spin).not.toBeCloseTo(b.spin, 3);
  });
  it('stops being drawn eventually', () => {
    expect(ejectedShell(RELOAD.ejectAtSec + 1.2, 0)).toBeNull();
  });
});

describe('loadShellTravel', () => {
  it('is absent outside the load window', () => {
    expect(loadShellTravel(0)).toBeNull();
    expect(loadShellTravel(RELOAD.loadStartSec - 0.01)).toBeNull();
    expect(loadShellTravel(RELOAD.totalSec)).toBeNull();
  });
  it('runs 0 -> 1 and is seated before the gun snaps shut', () => {
    expect(loadShellTravel(RELOAD.loadStartSec)).toBeCloseTo(0, 5);
    expect(loadShellTravel(RELOAD.loadSeatSec)).toBe(1);
    // seated strictly before the snap finishes, or the gun closes on a case
    // that is still visibly outside it
    expect(RELOAD.loadSeatSec).toBeLessThan(RELOAD.snapEndSec);
  });
  it('advances monotonically', () => {
    let prev = -1;
    for (let t = RELOAD.loadStartSec; t <= RELOAD.loadSeatSec; t += 0.01) {
      const v = loadShellTravel(t)!;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('fireRecoil', () => {
  it('is nothing before the shot and nothing once it has settled', () => {
    expect(fireRecoil(-0.01).dz).toBe(0);
    expect(fireRecoil(RECOIL.durationSec).dz).toBe(0);
  });
  it('kicks back and up, muzzle rising', () => {
    const r = fireRecoil(0.02);
    expect(r.dz).toBeGreaterThan(0);
    expect(r.dy).toBeGreaterThan(0);
    expect(r.pitch).toBeLessThan(0);
  });
  it('hits both barrels harder than one', () => {
    expect(Math.abs(fireRecoil(0.03, 2).dz)).toBeGreaterThan(Math.abs(fireRecoil(0.03, 1).dz));
  });
  it('undershoots past rest before settling — it is a mechanism, not a lerp', () => {
    let sawNegative = false;
    for (let t = 0; t < RECOIL.durationSec; t += 0.005) {
      if (fireRecoil(t).dz < -1e-4) { sawNegative = true; break; }
    }
    expect(sawNegative).toBe(true);
  });
});

describe('the retimed beat sheet', () => {
  it('runs 1.30 s, the reference tempo', () => {
    expect(RELOAD.totalSec).toBeCloseTo(1.30, 3);
  });
  it('orders every beat', () => {
    const beats = [
      RELOAD.presentSec, RELOAD.extractAtSec, RELOAD.breakEndSec,
      RELOAD.ejectEndSec, RELOAD.loadStartSec, RELOAD.loadSeatSec,
      RELOAD.snapEndSec, RELOAD.totalSec,
    ];
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]!).toBeGreaterThan(beats[i - 1]!);
    }
  });
  it('opens to 45 degrees', () => {
    expect(RELOAD.openRad).toBeCloseTo(Math.PI / 4, 3);
  });
  it('shuts harder than it opens — the asymmetry IS the clack', () => {
    const open = RELOAD.breakEndSec - RELOAD.presentSec;
    const shut = RELOAD.totalSec - RELOAD.snapEndSec;
    expect(shut).toBeLessThan(open);
    expect(open / shut).toBeGreaterThan(1.8);
  });
});

describe('supportHandPose', () => {
  it('rests on the fore-end at both ends of the reload', () => {
    for (const t of [0, RELOAD.totalSec, RELOAD.totalSec + 1]) {
      const p = supportHandPose(t);
      expect(p.dx).toBeCloseTo(0, 6);
      expect(p.dy).toBeCloseTo(0, 6);
      expect(p.carrying).toBe(false);
    }
  });
  it('leaves the frame low and left before it comes back with the cases', () => {
    const away = supportHandPose(RELOAD.breakEndSec);
    expect(away.dy).toBeLessThan(-0.12);
    expect(away.dx).toBeLessThan(0);
  });
  it('carries only between first appearing and seating', () => {
    expect(supportHandPose(RELOAD.loadStartSec + 0.01).carrying).toBe(true);
    expect(supportHandPose(RELOAD.loadSeatSec + 0.01).carrying).toBe(false);
    expect(supportHandPose(0.2).carrying).toBe(false);
  });
  it('arrives at the breech by the time the cases seat', () => {
    const seat = supportHandPose(RELOAD.loadSeatSec);
    expect(seat.dy).toBeGreaterThan(-0.02);
  });
});
