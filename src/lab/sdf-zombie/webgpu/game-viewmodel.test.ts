// src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts
import { describe, expect, it } from 'vitest';
import {
  CHAMBER_DEPTH_M, LOAD_STAGE_GAP_M, RECOIL, RELOAD, SHELL_LEN_M, ejectedShell,
  extractStage, extractorOffset, fireRecoil, flashEnvelope, hingeOpenFraction,
  insertStage, loadCarry, loadHold, magazineAfterFire, reloadPhaseAt, reloadPose,
  stagedShellCenter, supportHandPose, topLeverAngle,
  VIEWMODEL_REFERENCE_FOV_DEG, viewmodelFovScale,
} from './game-viewmodel';
import { FISHEYE_DEFAULTS } from './fisheye';

/** A bore frame for the eject tests: the breech faces the camera (+Z) and the
 *  chambers sit side by side along +X. Simpler than the real open gun's, and
 *  every assertion below is about the SHAPE of the arc, not its exact tilt. */
const FRAME = { out: [0, 0, 1] as const, side: [1, 0, 0] as const };

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
    expect(atPresentEnd.roll).toBeLessThan(-8);
    // the deepest roll must NOT be at mid-reload
    expect(reloadPose(0.475).roll).toBeGreaterThan(peak - 1e-6);
  });

  it('keeps the open action LOW in the frame, not centred', () => {
    // Owner: the raised present (dy 0.115, roll -30) blocked the view. A
    // true drop puts the reload off the bottom edge (the breech rests there),
    // so the bound is a small lift and a shallow roll at every open beat.
    for (const t of [RELOAD.breakEndSec, RELOAD.ejectEndSec, RELOAD.loadStageSec, RELOAD.loadSeatSec]) {
      expect(reloadPose(t).dy).toBeLessThan(0.06);
      expect(reloadPose(t).roll).toBeGreaterThan(-20);
    }
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
    expect(ejectedShell(0, 0, FRAME)).toBeNull();
    expect(ejectedShell(RELOAD.ejectAtSec - 0.01, 0, FRAME)).toBeNull();
  });
  it('starts EXACTLY at the hand-off origin, whatever the seed', () => {
    // The shorty gate pins lastEjectOrigin against the live breech at this
    // beat; the seed may bend the arc but must never move where it begins.
    for (const seed of [0, 1, 7, 12345]) {
      const s = ejectedShell(RELOAD.ejectAtSec, 0, FRAME, seed)!;
      expect(Math.hypot(s.x, s.y, s.z)).toBeLessThan(1e-9);
      expect(s.spin).toBeCloseTo(0, 9);
    }
  });
  it('leaves the breech going UP and out along the bore', () => {
    const s = ejectedShell(RELOAD.ejectAtSec + 0.05, 0, FRAME)!;
    expect(s.y).toBeGreaterThan(0);
    expect(s.z).toBeGreaterThan(0);          // FRAME.out is +Z
  });
  it('keeps moving OUT of the bore for the first tenth of a second, so a case cannot fall back into the tube', () => {
    let prev = 0;
    for (let d = 0.01; d <= 0.10; d += 0.01) {
      const s = ejectedShell(RELOAD.ejectAtSec + d, 1, FRAME, 3)!;
      expect(s.z).toBeGreaterThan(prev);
      prev = s.z;
    }
  });
  it('climbs well clear of the frame before it is dropped', () => {
    let peak = 0;
    for (let d = 0; d <= 1; d += 0.01) {
      const s = ejectedShell(RELOAD.ejectAtSec + d, 0, FRAME);
      if (s) peak = Math.max(peak, s.y);
    }
    // Doom's cases go over the shoulder and never come back. 16 cm was the old
    // apex, which put them barely past the top edge and then falling back in.
    expect(peak).toBeGreaterThan(0.25);
  });
  it('is never drawn falling back through the frame', () => {
    // Once past the apex and back near breech height it must be gone: at this
    // range a 7 cm case dropping past the camera fills a quarter of the screen.
    let peak = -1, past = false;
    for (let d = 0; d <= 1.5; d += 0.005) {
      const s = ejectedShell(RELOAD.ejectAtSec + d, 0, FRAME);
      if (!s) continue;
      if (s.y < peak) past = true;
      peak = Math.max(peak, s.y);
      if (past) expect(s.y).toBeGreaterThan(0.08);
    }
    expect(past).toBe(true);   // it was drawn on the way down at all
    expect(ejectedShell(RELOAD.ejectAtSec + 1.2, 0, FRAME)).toBeNull();
  });
  it('throws the two cases apart, not on top of each other', () => {
    const a = ejectedShell(RELOAD.ejectAtSec + 0.1, 0, FRAME)!;
    const b = ejectedShell(RELOAD.ejectAtSec + 0.1, 1, FRAME)!;
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.02);
    expect(a.spin).not.toBeCloseTo(b.spin, 3);
  });
  it('varies with the seed, and seed 0 is the reference arc', () => {
    const t = RELOAD.ejectAtSec + 0.15;
    const ref = ejectedShell(t, 0, FRAME)!;
    expect(ejectedShell(t, 0, FRAME, 0)).toEqual(ref);
    const a = ejectedShell(t, 0, FRAME, 11)!;
    const b = ejectedShell(t, 0, FRAME, 12)!;
    expect(Math.hypot(a.x - ref.x, a.y - ref.y, a.z - ref.z)).toBeGreaterThan(0.005);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.002);
    // Bounded: a seed may bend the arc, never send a case at the camera.
    for (let seed = 1; seed < 200; seed++) {
      const s = ejectedShell(t, 1, FRAME, seed)!;
      expect(s.y).toBeGreaterThan(ref.y * 0.6);
      expect(s.z).toBeLessThan(ref.z * 1.6 + 0.01);
    }
  });
  it('is the same arc for the same seed', () => {
    const t = RELOAD.ejectAtSec + 0.2;
    expect(ejectedShell(t, 1, FRAME, 42)).toEqual(ejectedShell(t, 1, FRAME, 42));
  });
});

describe('the load beat', () => {
  it('orders carry before insert before the snap', () => {
    expect(RELOAD.loadStartSec).toBeLessThan(RELOAD.loadStageSec);
    expect(RELOAD.loadStageSec).toBeLessThan(RELOAD.loadSeatSec);
    expect(RELOAD.loadSeatSec).toBeLessThan(RELOAD.snapEndSec);
  });
  it('carry is absent outside its window and runs 0 -> 1 monotonically', () => {
    expect(loadCarry(0)).toBeNull();
    expect(loadCarry(RELOAD.loadStartSec - 0.01)).toBeNull();
    expect(loadCarry(RELOAD.loadStageSec + 0.01)).toBeNull();
    expect(loadCarry(RELOAD.loadStartSec)).toBeCloseTo(0, 6);
    expect(loadCarry(RELOAD.loadStageSec)).toBeCloseTo(1, 6);
    let prev = -1;
    for (let t = RELOAD.loadStartSec; t <= RELOAD.loadStageSec; t += 0.005) {
      const v = loadCarry(t)!;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it('insert takes over the instant the carry ends, and seats before the snap', () => {
    expect(insertStage(RELOAD.loadStageSec - 0.01)).toBeNull();
    expect(insertStage(RELOAD.loadStageSec)).toBeCloseTo(0, 6);
    expect(insertStage(RELOAD.loadSeatSec)).toBeCloseTo(1, 6);
    expect(insertStage(RELOAD.loadSeatSec + 0.01)).toBeNull();
    let prev = -1;
    for (let t = RELOAD.loadStageSec; t <= RELOAD.loadSeatSec; t += 0.005) {
      const v = insertStage(t)!;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it('stages a case with its tip a small gap BEHIND the mouth, on the bore axis', () => {
    const c = stagedShellCenter([1, 2, 3], [0, 0, 1]);
    expect(c[0]).toBeCloseTo(1, 9);
    expect(c[1]).toBeCloseTo(2, 9);
    expect(c[2]).toBeCloseTo(3 + SHELL_LEN_M / 2 + LOAD_STAGE_GAP_M, 9);
    expect(LOAD_STAGE_GAP_M).toBeGreaterThan(0);
    expect(SHELL_LEN_M).toBe(CHAMBER_DEPTH_M);
  });
  it('holds the cases in a fist behind their heads and lets it follow them in, stopping short of the mouth', () => {
    const r = 0.046;
    const mouth: [number, number, number] = [0, 0, 0];
    const h = loadHold(mouth, [0, 0, 1], [1, 0, 0], r);
    const staged = stagedShellCenter(mouth, [0, 0, 1]);
    // stage: centred on the pair (no side offset), just behind the heads
    expect(h.stage[0]).toBeCloseTo(0, 9);
    expect(h.stage[1]).toBeCloseTo(0, 9);
    expect(h.stage[2]).toBeGreaterThan(staged[2] + SHELL_LEN_M / 2);
    expect(h.stage[2]).toBeLessThan(staged[2] + SHELL_LEN_M / 2 + r);
    // seat: closer to the mouth than stage, but the orb never enters the mouth
    expect(h.seat[2]).toBeLessThan(h.stage[2]);
    expect(h.seat[2]).toBeGreaterThan(r * 0.9);
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
  it('lands EXACTLY on the live hold points when given them', () => {
    // The 1110 ms capture showed the authored key stopping at the bottom of
    // the frame while the cases seated on their own. The hold is derived from
    // the breech each frame, so the hand has to hit it, not approximate it.
    const hold = { stage: { dx: 0.11, dy: 0.13, dz: 0.17 }, seat: { dx: 0.09, dy: 0.10, dz: 0.12 } };
    const s = supportHandPose(RELOAD.loadStageSec, hold);
    expect([s.dx, s.dy, s.dz]).toEqual([0.11, 0.13, 0.17]);
    const e = supportHandPose(RELOAD.loadSeatSec, hold);
    expect([e.dx, e.dy, e.dz]).toEqual([0.09, 0.10, 0.12]);
  });
  it('moves continuously from the hold into the withdraw', () => {
    const hold = { stage: { dx: 0.11, dy: 0.13, dz: 0.17 }, seat: { dx: 0.09, dy: 0.10, dz: 0.12 } };
    let prev = supportHandPose(RELOAD.loadStartSec, hold);
    for (let t = RELOAD.loadStartSec + 0.004; t <= RELOAD.totalSec; t += 0.004) {
      const p = supportHandPose(t, hold);
      const step = Math.hypot(p.dx - prev.dx, p.dy - prev.dy, p.dz - prev.dz);
      // A teleport is a 15-20 cm step; the 50 ms snap-away peaks near 5 m/s.
      expect(step).toBeLessThan(0.03);
      prev = p;
    }
  });
  it('is unchanged everywhere outside the load beat when a hold is given', () => {
    const hold = { stage: { dx: 0.11, dy: 0.13, dz: 0.17 }, seat: { dx: 0.09, dy: 0.10, dz: 0.12 } };
    for (const t of [0, 0.1, 0.3, RELOAD.breakEndSec, RELOAD.loadStartSec, RELOAD.snapEndSec, RELOAD.totalSec]) {
      expect(supportHandPose(t, hold)).toEqual(supportHandPose(t));
    }
  });
});

describe('topLeverAngle', () => {
  it('is home at rest and home again at the end', () => {
    expect(topLeverAngle(0)).toBeCloseTo(0, 6);
    expect(topLeverAngle(RELOAD.totalSec)).toBeCloseTo(0, 6);
  });
  it('LEADS the break — fully thrown while the hinge is still shut', () => {
    const t = RELOAD.presentSec * 0.9;
    expect(topLeverAngle(t)).toBeGreaterThan(0.6);
    expect(hingeOpenFraction(t)).toBeCloseTo(0, 6);
  });
  it('reaches the reference throw of 40 degrees', () => {
    const peak = Math.max(...Array.from({ length: 131 }, (_, k) => topLeverAngle(k / 100)));
    expect(peak).toBeCloseTo(Math.PI * 40 / 180, 2);
  });
});

describe('extractStage', () => {
  it('is absent before the extract beat and after the hand-off', () => {
    expect(extractStage(0)).toBeNull();
    expect(extractStage(RELOAD.extractAtSec - 0.01)).toBeNull();
    expect(extractStage(RELOAD.ejectAtSec + 0.01)).toBeNull();
  });
  it('runs 0 -> 1 monotonically across the extract window', () => {
    expect(extractStage(RELOAD.extractAtSec)).toBeCloseTo(0, 5);
    let prev = -1;
    for (let t = RELOAD.extractAtSec; t <= RELOAD.ejectAtSec; t += 0.005) {
      const v = extractStage(t)!;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(prev).toBeCloseTo(1, 5);
  });
  it('has fully cleared the chamber by the hand-off, or the case would be reparented mid-steel', () => {
    expect(extractStage(RELOAD.ejectAtSec)! * CHAMBER_DEPTH_M)
      .toBeGreaterThanOrEqual(CHAMBER_DEPTH_M - 1e-6);
  });
});

describe('extractorOffset', () => {
  it('is home at rest and home once the fresh cases are seated', () => {
    expect(extractorOffset(0)).toBeCloseTo(0, 6);
    expect(extractorOffset(RELOAD.totalSec)).toBeCloseTo(0, 6);
  });
  it('is thrown out while the breech is empty', () => {
    expect(extractorOffset(RELOAD.ejectAtSec)).toBeGreaterThan(0.005);
    expect(extractorOffset(RELOAD.loadStartSec)).toBeGreaterThan(0.005);
  });
  it('retracts as the fresh cases seat, not after', () => {
    expect(extractorOffset(RELOAD.loadSeatSec)).toBeCloseTo(0, 4);
  });
});


describe('viewmodelFovScale', () => {
  const ndcX = (x: number, z: number, fovDeg: number, aspect: number) =>
    (x / -z) / (Math.tan((fovDeg * Math.PI) / 360) * aspect);
  const ndcY = (y: number, z: number, fovDeg: number) =>
    (y / -z) / Math.tan((fovDeg * Math.PI) / 360);

  it('is EXACTLY 1 at the reference FOV, not a rounding of 1', () => {
    // The reference lens has to be an untouched identity: the poses were
    // authored through it, so any scale at all there is a silent retune.
    expect(viewmodelFovScale(VIEWMODEL_REFERENCE_FOV_DEG)).toBe(1);
    expect(viewmodelFovScale(37, 37)).toBe(1);
  });

  it('shrinks the weapon as the world FOV narrows, and grows it as it widens', () => {
    expect(viewmodelFovScale(46)).toBeLessThan(1);
    expect(viewmodelFovScale(46)).toBeCloseTo(0.7352, 4);
    expect(viewmodelFovScale(90)).toBeGreaterThan(1);
  });

  it('is monotonic in the world FOV', () => {
    let prev = -Infinity;
    for (let deg = 20; deg <= 140; deg += 5) {
      const s = viewmodelFovScale(deg);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  /**
   * THE PROPERTY THE WHOLE APPROACH RESTS ON, and the reason no weapon was
   * retuned by hand: a camera-parented point scaled by (r, r, 1) and drawn
   * through the NEW FOV lands on exactly the NDC it had under the OLD one.
   * If this ever stops holding, the weapons are no longer framed as the
   * owner approved them and the per-weapon offsets have to move after all.
   */
  it('reproduces the reference framing exactly, for every point and aspect', () => {
    const world = FISHEYE_DEFAULTS.centerFovDeg;
    const r = viewmodelFovScale(world);
    const points: readonly (readonly [number, number, number])[] = [
      [0.10, -0.12, -0.33],   // the shorty's rest, roughly
      [0.235, -0.295, -0.42], // the dynamite bundle's hold
      [0, 0, -1],             // dead centre, far
      [-0.4, 0.3, -0.08],     // extreme, very near the eye
    ];
    for (const aspect of [16 / 9, 4 / 3, 1, 21 / 9]) {
      for (const [x, y, z] of points) {
        expect(ndcX(x * r, z, world, aspect))
          .toBeCloseTo(ndcX(x, z, VIEWMODEL_REFERENCE_FOV_DEG, aspect), 12);
        expect(ndcY(y * r, z, world))
          .toBeCloseTo(ndcY(y, z, VIEWMODEL_REFERENCE_FOV_DEG), 12);
      }
    }
  });

  it('leaves depth alone, so occlusion against the world is untouched', () => {
    // Not an assertion about this function (it returns one number) but about
    // its CONTRACT: the caller applies it to x and y only. Pinned here
    // because the tempting "just scale the rig" is the bug it prevents —
    // a uniform scale about the eye is an exact no-op in perspective, so a
    // caller who reaches for .setScalar() gets no framing change at all and
    // a changed depth.
    const r = viewmodelFovScale(46);
    const z = -0.42;
    expect(ndcX(0.2 * r, z, 46, 16 / 9)).not.toBeCloseTo(ndcX(0.2 * r, z * r, 46, 16 / 9), 6);
  });

  it('refuses to hide the weapon on nonsense input', () => {
    // A NaN or zero scale is a weapon that vanishes or collapses to a point,
    // which is worse than an unscaled one — so every degenerate input is 1.
    for (const bad of [NaN, Infinity, -Infinity, 0, -30]) {
      expect(viewmodelFovScale(bad)).toBe(1);
      expect(viewmodelFovScale(46, bad)).toBe(1);
    }
  });
});
