import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BOB, FREE_AIM, approachAngle, approachBob, bobPose, deadzonePush, moveAim,
  pivotOffset, recentre, turnFromAim, weaponAngles, weaponSlide,
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
  });
  it('clamps a tuning value pushed above 1, so setAimTuning cannot reopen the mismatch', () => {
    const full = Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg);
    FREE_AIM.weaponYawFrac = 3;
    expect(Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg)).toBeCloseTo(full, 6);
  });
  it('clamps a tuning value pushed below 0', () => {
    FREE_AIM.weaponYawFrac = -1;
    expect(weaponAngles({ x: 1, y: 0 }, F).yawDeg).toBeCloseTo(0, 9);
  });

  afterEach(() => {
    // Unconditional restore -- a bare trailing assignment never runs if the
    // preceding expect() throws, which leaks a mutated fraction into every
    // test that runs after this file (FREE_AIM is a shared, mutable module
    // singleton).
    FREE_AIM.weaponYawFrac = 1.0;
    FREE_AIM.weaponPitchFrac = 1.0;
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

  /**
   * Drives a REAL THREE.Object3D posed exactly as game-main.ts poses aimRig
   * (position = pivotOffset's result, rotation.set(pitch, yaw, roll)), then
   * reads back where the pivot point actually ended up in world space.
   *
   * This is deliberately not a hand-rolled matrix multiply: the previous
   * version of this test re-derived the rotation inline using the same
   * arithmetic as the implementation, which asserts
   * `pivot - f(pivot) + f(pivot) === pivot` for whatever `f` the
   * implementation happens to use -- a tautology that passes for ANY
   * rotation convention, including a wrong one. Driving Three.js's own
   * Euler/matrix code is the only way to pin the actual convention
   * (`'XYZ'` composes as R = Rx*Ry*Rz, i.e. roll first, then yaw, then pitch).
   */
  function drift(pitch: number, yaw: number, roll: number): { x: number; y: number; z: number } {
    const o = pivotOffset(GRIP, pitch, yaw, roll);
    const rig = new THREE.Object3D();
    rig.position.set(o.x, o.y, o.z);
    rig.rotation.set(pitch, yaw, roll); // exactly game-main.ts's aimRig.rotation.set(...)
    rig.updateMatrixWorld(true);
    const p = new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z).applyMatrix4(rig.matrixWorld);
    return { x: p.x - GRIP.x, y: p.y - GRIP.y, z: p.z - GRIP.z };
  }

  it('is nothing when the weapon is level', () => {
    const d = drift(0, 0, 0);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(0, 9);
    expect(d.z).toBeCloseTo(0, 9);
  });
  it('holds the grip still under pure yaw', () => {
    const d = drift(0, 47.5 * Math.PI / 180, 0);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(0, 9);
    expect(d.z).toBeCloseTo(0, 9);
  });
  it('holds the grip still under pure pitch', () => {
    const d = drift(20 * Math.PI / 180, 0, 0);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(0, 9);
    expect(d.z).toBeCloseTo(0, 9);
  });
  it('holds the grip still under pure roll (walk bob, reticle centred)', () => {
    const d = drift(0, 0, 1.4 * Math.PI / 180);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(0, 9);
    expect(d.z).toBeCloseTo(0, 9);
  });
  it('holds the grip still under COMBINED yaw+pitch(+roll) -- pure-axis cases cannot catch an Euler-order bug', () => {
    // Rx*Ry === Ry*Rx whenever one of the two angles is zero, so only a
    // combined pose can distinguish the correct order from its reverse.
    // These are the corner poses (plus a walking-with-recoil pose) that
    // measured real drift against the previous (Ry then Rx) implementation.
    const poses: Array<[number, number, number]> = [
      [20 * Math.PI / 180, 47.5 * Math.PI / 180, 0],
      [-30 * Math.PI / 180, -47.5 * Math.PI / 180, 0],
      [-37.5 * Math.PI / 180, -47.5 * Math.PI / 180, 0],
      [0.35, -0.83, 0.024],
    ];
    for (const [pitch, yaw, roll] of poses) {
      const d = drift(pitch, yaw, roll);
      expect(d.x).toBeCloseTo(0, 9);
      expect(d.y).toBeCloseTo(0, 9);
      expect(d.z).toBeCloseTo(0, 9);
    }
  });
});

// Captured from what SHIPS, not hardcoded. A literal restore here would
// overwrite the shipped default on the first afterEach and mask any change to
// it -- which is exactly what made the first draft of these tests decoration:
// zeroing weaponSlideX (the reported bug) passed all 38.
const SHIPPED_SLIDE_X = FREE_AIM.weaponSlideX;
const SHIPPED_SLIDE_Y = FREE_AIM.weaponSlideY;

describe('weaponSlide', () => {
  afterEach(() => { FREE_AIM.weaponSlideX = SHIPPED_SLIDE_X; FREE_AIM.weaponSlideY = SHIPPED_SLIDE_Y; });

  it('sits still with the reticle centred', () => {
    const s = weaponSlide({ x: 0, y: 0 });
    expect(s.x).toBeCloseTo(0, 9);
    expect(s.y).toBeCloseTo(0, 9);
  });
  it('carries the weapon TOWARD the reticle, not away from it', () => {
    expect(weaponSlide({ x: 1, y: 0 }).x).toBeGreaterThan(0);
    expect(weaponSlide({ x: -1, y: 0 }).x).toBeLessThan(0);
    expect(weaponSlide({ x: 0, y: 1 }).y).toBeGreaterThan(0);
  });
  it('is LINEAR in the reticle — half the deflection, half the travel', () => {
    const full = weaponSlide({ x: 1, y: 0 }).x;
    expect(weaponSlide({ x: 0.5, y: 0 }).x).toBeCloseTo(full * 0.5, 9);
    expect(weaponSlide({ x: 0.25, y: 0 }).x).toBeCloseTo(full * 0.25, 9);
  });
  it('travels less vertically than laterally — vertical reads as sinking', () => {
    expect(Math.abs(weaponSlide({ x: 0, y: 1 }).y))
      .toBeLessThan(Math.abs(weaponSlide({ x: 1, y: 0 }).x));
  });
  it('is driven by the knobs, so the feel stays tunable', () => {
    FREE_AIM.weaponSlideX = 0.25;
    expect(weaponSlide({ x: 1, y: 0 }).x).toBeCloseTo(0.25, 9);
    expect(0.25).not.toBeCloseTo(SHIPPED_SLIDE_X, 9);   // the knob really moved
  });
});

describe('the weapon actually crosses the frame (owner report)', () => {
  afterEach(() => { FREE_AIM.weaponSlideX = SHIPPED_SLIDE_X; FREE_AIM.weaponSlideY = SHIPPED_SLIDE_Y; });

  // GUN_REST.pos, and the frustum from the reported 790x555 capture.
  const GRIP = { x: 0.038, y: -0.115, z: -0.300 };
  const tanV = Math.tan(75 * Math.PI / 360);
  const F = { tanV, tanH: tanV * (790 / 555) };

  /** Where the grip lands on screen for a given reticle, as the rig poses it.
   *  -1..1 across the viewport. Drives a real Object3D so the composition of
   *  slide + pivot + rotation is checked, not just the slide in isolation. */
  function gripScreenX(aimX: number): number {
    const w = weaponAngles({ x: aimX, y: 0 }, F);
    const yaw = w.yawDeg * Math.PI / 180;
    const s = weaponSlide({ x: aimX, y: 0 });
    const o = pivotOffset(GRIP, 0, yaw, 0);
    const rig = new THREE.Object3D();
    rig.position.set(o.x + s.x, o.y + s.y, o.z);
    rig.rotation.set(0, yaw, 0);
    rig.updateMatrixWorld(true);
    const p = new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z).applyMatrix4(rig.matrixWorld);
    return p.x / (-p.z * F.tanH);
  }

  it('moves the grip a long way across the frame, not a nudge', () => {
    // THE REPORT: "the weapon always is center and then pivots". With rotation
    // alone the grip sits at ~0.12 at EVERY reticle position, because that is
    // exactly what pivoting about it means. This is the assertion that fails
    // if the slide is ever removed or zeroed.
    const centre = gripScreenX(0);
    const edge = gripScreenX(1);
    expect(Math.abs(edge - centre)).toBeGreaterThan(0.25);
  });
  it('carries the grip toward the side the reticle is on', () => {
    expect(gripScreenX(1)).toBeGreaterThan(gripScreenX(0));
    expect(gripScreenX(-1)).toBeLessThan(gripScreenX(0));
  });
  it('keeps the whole weapon inside the viewport at full deflection', () => {
    for (const x of [-1, -0.5, 0, 0.5, 1]) {
      expect(Math.abs(gripScreenX(x))).toBeLessThan(1);
    }
  });
});
