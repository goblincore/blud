import { describe, expect, it } from 'vitest';
import {
  BOB, FREE_AIM, approachAngle, approachBob, bobPose, deadzonePush, moveAim,
  pivotOffset, recentre, turnFromAim, weaponAngles,
} from './free-aim';

describe('moveAim', () => {
  it('moves the reticle with the mouse, inverting y for screen coords', () => {
    const a = moveAim({ x: 0, y: 0 }, 100, 100);
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(0);
  });
  it('never leaves the viewport', () => {
    const a = moveAim({ x: 0, y: 0 }, 99999, -99999);
    expect(a.x).toBe(1);
    expect(a.y).toBe(1);
    const b = moveAim({ x: 0, y: 0 }, -99999, 99999);
    expect(b.x).toBe(-1);
    expect(b.y).toBe(-1);
  });
});

describe('deadzonePush', () => {
  it('is completely flat inside the dead zone — the whole point of the scheme', () => {
    for (const x of [0, 0.2, 0.4, FREE_AIM.deadzoneX]) {
      expect(deadzonePush({ x, y: 0 }).x).toBe(0);
      expect(deadzonePush({ x: -x, y: 0 }).x).toBe(0);
    }
    expect(deadzonePush({ x: 0, y: FREE_AIM.deadzoneY }).y).toBe(0);
  });
  it('ramps to full push at the viewport edge', () => {
    expect(deadzonePush({ x: 1, y: 0 }).x).toBeCloseTo(1, 6);
    expect(deadzonePush({ x: -1, y: 0 }).x).toBeCloseTo(-1, 6);
  });
  it('grows monotonically past the dead zone', () => {
    let prev = -1;
    for (let x = FREE_AIM.deadzoneX; x <= 1; x += 0.02) {
      const v = deadzonePush({ x, y: 0 }).x;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('turnFromAim', () => {
  it('does not turn the camera while the reticle is in the dead zone', () => {
    const t = turnFromAim({ x: FREE_AIM.deadzoneX * 0.99, y: FREE_AIM.deadzoneY * 0.99 }, 1 / 60);
    expect(t.yaw).toBe(0);
    expect(t.pitch).toBe(0);
  });
  it('turns toward the side the reticle is pushed', () => {
    expect(turnFromAim({ x: 1, y: 0 }, 1 / 60).yaw).toBeGreaterThan(0);
    expect(turnFromAim({ x: -1, y: 0 }, 1 / 60).yaw).toBeLessThan(0);
  });
  it('scales with dt so the turn is framerate-independent', () => {
    const a = turnFromAim({ x: 1, y: 0 }, 1 / 60).yaw;
    const b = turnFromAim({ x: 1, y: 0 }, 2 / 60).yaw;
    expect(b).toBeCloseTo(a * 2, 9);
  });
  it('eases in — just past the edge is a drift, not a snap', () => {
    const nearEdge = Math.abs(turnFromAim({ x: FREE_AIM.deadzoneX + 0.02, y: 0 }, 1 / 60).yaw);
    const atMax = Math.abs(turnFromAim({ x: 1, y: 0 }, 1 / 60).yaw);
    expect(nearEdge).toBeLessThan(atMax * 0.05);
  });
});

describe('weaponAngles', () => {
  // 790x555 canvas at a 75 deg VERTICAL fov -- the capture in fpvbugs.mov.
  const F = { tanV: Math.tan(75 * Math.PI / 360), tanH: Math.tan(75 * Math.PI / 360) * (790 / 555) };

  it('leans away from the reticle side, so the gun swings toward it', () => {
    expect(weaponAngles({ x: 1, y: 0 }, F).yawDeg).toBeLessThan(0);
    expect(weaponAngles({ x: -1, y: 0 }, F).yawDeg).toBeGreaterThan(0);
    expect(weaponAngles({ x: 0, y: 1 }, F).pitchDeg).toBeGreaterThan(0);
  });
  it('is level with the reticle centred', () => {
    const w = weaponAngles({ x: 0, y: 0 }, F);
    expect(w.yawDeg).toBeCloseTo(0, 9);
    expect(w.pitchDeg).toBeCloseTo(0, 9);
  });
  it('POINTS AT the reticle at the edge -- 47.5 deg, not the old 15 deg cap', () => {
    const yaw = Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg);
    expect(yaw).toBeCloseTo(Math.atan(F.tanH) * 180 / Math.PI, 4);
    expect(yaw).toBeGreaterThan(45);
  });
  it('tracks the reticle exactly at every position, not just the edge', () => {
    for (const x of [0.2, 0.5, 0.8, 1.0]) {
      const want = Math.atan(x * F.tanH) * 180 / Math.PI;
      expect(Math.abs(weaponAngles({ x, y: 0 }, F).yawDeg)).toBeCloseTo(want, 6);
    }
  });
  it('scales by the tuning fraction, which cannot exceed pointing exactly', () => {
    const full = Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg);
    FREE_AIM.weaponYawFrac = 0.5;
    expect(Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg)).toBeCloseTo(full * 0.5, 6);
    FREE_AIM.weaponYawFrac = 1.0;
  });
});

describe('approachAngle', () => {
  it('closes on the target without overshooting', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = approachAngle(v, 10, 1 / 60);
    expect(v).toBeGreaterThan(9.9);
    expect(v).toBeLessThanOrEqual(10 + 1e-9);
  });
  it('lags — one frame does not arrive', () => {
    expect(approachAngle(0, 10, 1 / 60)).toBeLessThan(10);
  });
});

describe('recentre', () => {
  it('leaves the reticle alone at the reference default', () => {
    expect(FREE_AIM.recentreRate).toBe(0);
    expect(recentre({ x: 0.7, y: -0.3 }, 1 / 60)).toEqual({ x: 0.7, y: -0.3 });
  });
});

describe('bobPose', () => {
  it('is still when the player is still', () => {
    const p = bobPose(12.34, 0);
    expect(p.x).toBe(0);
    expect(p.y).toBe(-0);
    expect(p.rollDeg).toBe(0);
  });
  it('is driven by DISTANCE, so it cannot slide out of phase with the stride', () => {
    // Same distance, wildly different elapsed time -> identical pose.
    expect(bobPose(3.0, 1)).toEqual(bobPose(3.0, 1));
    expect(bobPose(3.0, 1)).not.toEqual(bobPose(3.2, 1));
  });
  it('dips on every footfall — y is never positive', () => {
    for (let d = 0; d < 4; d += 0.017) expect(bobPose(d, 1).y).toBeLessThanOrEqual(0);
  });
  it('dips twice per lateral cycle — footfalls, not a sway', () => {
    // Count MINIMA of y over one lateral period. Counting zero-crossings with a
    // fixed epsilon does not work here: amountY is 0.011, so the samples either
    // side of a crossing sit around 1e-5, never inside a 1e-6 window.
    const period = 1 / BOB.cyclesPerMetre;
    const N = 600;
    const ys: number[] = [];
    for (let i = 0; i <= N; i++) ys.push(bobPose((i / N) * period, 1).y);
    let minima = 0;
    for (let i = 1; i < ys.length - 1; i++) {
      if (ys[i]! < ys[i - 1]! && ys[i]! <= ys[i + 1]!) minima++;
    }
    expect(minima).toBe(2);
    // and the lateral swing completes exactly one cycle over the same distance
    expect(bobPose(0, 1).x).toBeCloseTo(bobPose(period, 1).x, 6);
  });

  it('scales with the speed envelope', () => {
    expect(Math.abs(bobPose(0.3, 0.5).x)).toBeLessThan(Math.abs(bobPose(0.3, 1).x));
  });
});

describe('approachBob', () => {
  it('ramps in and out rather than snapping', () => {
    expect(approachBob(0, 1, 1 / 60)).toBeGreaterThan(0);
    expect(approachBob(0, 1, 1 / 60)).toBeLessThan(1);
    let v = 1;
    for (let i = 0; i < 120; i++) v = approachBob(v, 0, 1 / 60);
    expect(v).toBeLessThan(0.01);
  });
});

describe('pivotOffset', () => {
  const GRIP = { x: 0.038, y: -0.115, z: -0.300 };

  it('is nothing when the weapon is level', () => {
    const o = pivotOffset(GRIP, 0, 0);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(0, 9);
    expect(o.z).toBeCloseTo(0, 9);
  });
  it('holds the pivot point still under yaw — that is its entire job', () => {
    const yaw = 47.5 * Math.PI / 180;
    const o = pivotOffset(GRIP, yaw, 0);
    // Rotate the grip about the origin, then add the offset: back where it was.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rx = GRIP.x * c + GRIP.z * s;
    const rz = -GRIP.x * s + GRIP.z * c;
    expect(rx + o.x).toBeCloseTo(GRIP.x, 9);
    expect(rz + o.z).toBeCloseTo(GRIP.z, 9);
  });
  it('holds it still under pitch too', () => {
    const pitch = 20 * Math.PI / 180;
    const o = pivotOffset(GRIP, 0, pitch);
    const c = Math.cos(pitch), s = Math.sin(pitch);
    const ry = GRIP.y * c - GRIP.z * s;
    const rz = GRIP.y * s + GRIP.z * c;
    expect(ry + o.y).toBeCloseTo(GRIP.y, 9);
    expect(rz + o.z).toBeCloseTo(GRIP.z, 9);
  });
});
