// src/lab/sdf-zombie/fpv.test.ts
import { describe, it, expect } from 'vitest';
import {
  EMPTY_FPV_INPUT,
  FPV_TUNING,
  chargeFraction,
  cookCharge,
  eyePos,
  lookFromDelta,
  makeFpv,
  releaseVelocity,
  stepCook,
  stepFpv,
  throwDirection,
  throwOrigin,
  throwSpeedMps,
  wrapPi,
  type FpvBounds,
  type FpvInput,
  type FpvState,
} from './fpv';
import { BALLISTIC_BOUNDS, DYNAMITE_COOK } from '../../game/gibs/tuning';

const BOUNDS: FpvBounds = BALLISTIC_BOUNDS;

const IDLE: FpvState = makeFpv([0, 0, 0], 0, 0);
/** Cooking state with cookStart at clock 0 (charge = now). */
const COOKING: FpvState = {
  ...makeFpv([0, 0, 0], 0, 0),
  cook: { phase: 'cooking', phaseAt: 0, cookStart: 0 },
};

/** Walks `steps` frames of `input` from `init`, returning the final state. */
function walk(
  input: FpvInput,
  steps = 60,
  init: FpvState = IDLE,
  dt = 1 / 60,
  now0 = 0,
  bounds: FpvBounds = BOUNDS,
): FpvState {
  let s = init;
  for (let i = 0; i < steps; i++) {
    s = stepFpv(s, input, dt, now0 + i * dt, bounds).state;
  }
  return s;
}

describe('charge → velocity mapping (vs the game constants)', () => {
  it('chargeFraction ramps 0..1 over DYNAMITE_COOK.maxChargeSec and clamps', () => {
    expect(chargeFraction(0)).toBe(0);
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec / 2)).toBeCloseTo(0.5, 9);
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec)).toBe(1);
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec + 1)).toBe(1);
    expect(chargeFraction(-1)).toBe(0);
  });

  it('throwSpeedMps lerps the game band min → max (endpoints + midpoint)', () => {
    expect(throwSpeedMps(0)).toBeCloseTo(DYNAMITE_COOK.minVelocityMps, 9);
    expect(throwSpeedMps(1)).toBeCloseTo(DYNAMITE_COOK.maxVelocityMps, 9);
    const mid = (DYNAMITE_COOK.minVelocityMps + DYNAMITE_COOK.maxVelocityMps) / 2;
    expect(throwSpeedMps(0.5)).toBeCloseTo(mid, 9);
    expect(throwSpeedMps(1.5)).toBeCloseTo(DYNAMITE_COOK.maxVelocityMps, 9);
  });

  it('releaseVelocity = throwDirection × throwSpeedMps, exactly the game mapping', () => {
    const full = releaseVelocity(COOKING, DYNAMITE_COOK.maxChargeSec);
    expect(Math.hypot(...full)).toBeCloseTo(DYNAMITE_COOK.maxVelocityMps, 6);
    const half = releaseVelocity(COOKING, DYNAMITE_COOK.maxChargeSec / 2);
    expect(Math.hypot(...half)).toBeCloseTo(
      (DYNAMITE_COOK.minVelocityMps + DYNAMITE_COOK.maxVelocityMps) / 2, 6,
    );
    // Direction matches throwDirection at the same aim.
    const d = throwDirection(0, 0);
    expect(full[1] / DYNAMITE_COOK.maxVelocityMps).toBeCloseTo(d[1], 9);
    expect(full[2] / DYNAMITE_COOK.maxVelocityMps).toBeCloseTo(d[2], 9);
  });
});

describe('throwDirection — aim-relative + the game upward lob', () => {
  it('level aim at yaw 0 → forward (-Z) + the lob, unit length', () => {
    const d = throwDirection(0, 0);
    expect(d[0]).toBeCloseTo(0, 9);
    expect(d[2]).toBeLessThan(0);
    expect(d[1]).toBeCloseTo(Math.sin((DYNAMITE_COOK.pitchLobDeg * Math.PI) / 180), 9);
    expect(Math.hypot(...d)).toBeCloseTo(1, 9);
  });

  it('yaw quarter turns the throw into the X axis (mirrors sim throwVelocity)', () => {
    const d = throwDirection(Math.PI / 2, 0);
    expect(d[0]).toBeGreaterThan(0);
    expect(Math.abs(d[0])).toBeGreaterThan(Math.abs(d[2]));
    expect(d[2]).toBeCloseTo(0, 9);
  });

  it('aiming up increases the vertical component', () => {
    const level = throwDirection(0, 0);
    const up = throwDirection(0, Math.PI / 6);
    expect(up[1]).toBeGreaterThan(level[1]);
  });
});

describe('stepFpv — look', () => {
  it('mouse right increases yaw (look right = turn toward +X), wrapped to (-π, π]', () => {
    const r = stepFpv(IDLE, { ...EMPTY_FPV_INPUT, dx: 100 }, 1 / 60, 1, BOUNDS);
    expect(r.state.yaw).toBeCloseTo(100 * FPV_TUNING.mouseSensRadPerCount, 9);
    // Sweep enough deltas to wrap past π: always lands inside (-π, π].
    let yaw = 0;
    for (let i = 0; i < 20000; i++) yaw = lookFromDelta(yaw, 0, 1, 0).yaw;
    expect(yaw).toBeGreaterThan(-Math.PI - 1e-9);
    expect(yaw).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(wrapPi(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 9);
  });

  it('pitch clamps to the game limit (±π/2 − 0.05), mouse down = pitch down', () => {
    const down = stepFpv(IDLE, { ...EMPTY_FPV_INPUT, dy: 1e6 }, 1 / 60, 1, BOUNDS);
    expect(down.state.pitch).toBeCloseTo(-FPV_TUNING.pitchClampRad, 9);
    const up = stepFpv(IDLE, { ...EMPTY_FPV_INPUT, dy: -1e6 }, 1 / 60, 1, BOUNDS);
    expect(up.state.pitch).toBeCloseTo(FPV_TUNING.pitchClampRad, 9);
    expect(FPV_TUNING.pitchClampRad).toBeCloseTo(Math.PI / 2 - 0.05, 9);
  });
});

describe('stepFpv — WASD movement', () => {
  it('W walks along the look direction at walk speed (yaw 0 → -Z)', () => {
    const s = walk({ ...EMPTY_FPV_INPUT, forward: true });
    expect(s.pos[2]).toBeCloseTo(-FPV_TUNING.walkSpeedMps, 6);
    expect(s.pos[0]).toBe(0);
  });

  it('strafe right walks +X; look rotation turns the movement axes', () => {
    const s = walk({ ...EMPTY_FPV_INPUT, right: true });
    expect(s.pos[0]).toBeCloseTo(FPV_TUNING.walkSpeedMps, 6);
    expect(s.pos[2]).toBe(0);

    // Facing 90° (yaw π/2): forward walks +X, strafe right walks +Z.
    const fwd = walk({ ...EMPTY_FPV_INPUT, forward: true }, 60, makeFpv([0, 0, 0], Math.PI / 2, 0));
    expect(fwd.pos[0]).toBeCloseTo(FPV_TUNING.walkSpeedMps, 6);
    expect(fwd.pos[2]).toBeCloseTo(0, 6);
    const right = walk({ ...EMPTY_FPV_INPUT, right: true }, 60, makeFpv([0, 0, 0], Math.PI / 2, 0));
    expect(right.pos[2]).toBeCloseTo(FPV_TUNING.walkSpeedMps, 6);
    expect(right.pos[0]).toBeCloseTo(0, 6);

    // Facing 45°, forward+right sums to pure +X (the diagonals cancel the Z)
    // — a sanity check that the movement basis is orthonormal.
    const diag = walk({ ...EMPTY_FPV_INPUT, forward: true, right: true }, 60, makeFpv([0, 0, 0], Math.PI / 4, 0));
    expect(diag.pos[0]).toBeCloseTo(FPV_TUNING.walkSpeedMps, 6);
    expect(diag.pos[2]).toBeCloseTo(0, 6);
  });

  it('diagonals are normalized — no speed boost', () => {
    const s = walk({ ...EMPTY_FPV_INPUT, forward: true, right: true });
    expect(Math.hypot(s.pos[0], s.pos[2])).toBeCloseTo(FPV_TUNING.walkSpeedMps, 6);
  });

  it('movement direction matches throwDirection across the circle (no mirrored-X bug)', () => {
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3, 5.2]) {
      const s = walk({ ...EMPTY_FPV_INPUT, forward: true }, 60, makeFpv([0, 0, 0], yaw, 0));
      const d = throwDirection(yaw, 0);
      const horiz = Math.hypot(d[0], d[2]);
      expect(s.pos[0] / (FPV_TUNING.walkSpeedMps * 1)).toBeCloseTo(d[0] / horiz, 3);
      expect(s.pos[2] / (FPV_TUNING.walkSpeedMps * 1)).toBeCloseTo(d[2] / horiz, 3);
    }
  });

  it('clamps the player inside the injected bounds (reversed bounds normalize too)', () => {
    const small: FpvBounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
    const s = walk({ ...EMPTY_FPV_INPUT, forward: true, right: true }, 60 * 30, IDLE, 1 / 60, 0, small);
    for (const v of [s.pos[0], s.pos[2]]) {
      expect(v).toBeGreaterThanOrEqual(-2 - 1e-9);
      expect(v).toBeLessThanOrEqual(2 + 1e-9);
    }
    // Reversed (min > max) bounds must not break the clamp.
    const rev: FpvBounds = { minX: 2, maxX: -2, minZ: 2, maxZ: -2 };
    const r = walk({ ...EMPTY_FPV_INPUT, forward: true }, 60, IDLE, 1 / 60, 0, rev);
    expect(Math.abs(r.pos[0])).toBeLessThanOrEqual(2 + 1e-9);
    expect(Math.abs(r.pos[2])).toBeLessThanOrEqual(2 + 1e-9);
  });
});

describe('COOK state machine', () => {
  it('idle → cooking on press; charge ramps 0..1 over the cook window', () => {
    const press = stepCook(IDLE.cook, { press: true, release: false }, 0);
    expect(press.state.phase).toBe('cooking');
    expect(press.signal).toBeNull();

    const half: FpvState = { ...IDLE, cook: press.state };
    expect(cookCharge(half, DYNAMITE_COOK.maxChargeSec / 2)).toBeCloseTo(0.5, 9);
    expect(cookCharge(half, 0)).toBeCloseTo(0, 9);
  });

  it('cookCharge is 0 outside cooking', () => {
    expect(cookCharge(IDLE, 100)).toBe(0);
  });

  it('release throws: signal carries charge + band-mapped speed, phase → cooldown', () => {
    const r = stepCook(COOKING.cook, { press: false, release: true }, DYNAMITE_COOK.maxChargeSec / 2);
    expect(r.signal).toEqual({
      kind: 'throw',
      chargeFrac: 0.5,
      speedMps: (DYNAMITE_COOK.minVelocityMps + DYNAMITE_COOK.maxVelocityMps) / 2,
    });
    expect(r.state.phase).toBe('cooldown');
  });

  it('cooldown locks out re-cook until throwRecoverSec, then idle accepts press', () => {
    const r = stepCook(COOKING.cook, { press: false, release: true }, 0.5);
    const locked = stepCook(r.state, { press: true, release: false }, 0.51);
    expect(locked.state.phase).toBe('cooldown');
    expect(locked.signal).toBeNull();
    const t = 0.5 + FPV_TUNING.throwRecoverSec + 0.01;
    const again = stepCook(locked.state, { press: true, release: false }, t);
    expect(again.state.phase).toBe('cooking');
    expect(again.signal).toBeNull();
  });

  it('cooking past max charge self-detonates in hand: overcook signal, back to idle', () => {
    const r = stepCook(COOKING.cook, { press: false, release: false }, DYNAMITE_COOK.fuseMaxSec + 0.01);
    expect(r.signal).toEqual({ kind: 'overcook' });
    expect(r.state.phase).toBe('idle');
    // Can immediately re-cook after blowing up (game: explosion → idle).
    const again = stepCook(r.state, { press: true, release: false }, DYNAMITE_COOK.fuseMaxSec + 0.02);
    expect(again.state.phase).toBe('cooking');
  });

  it('release from idle is a no-op; overcook wins over a same-step release', () => {
    const idle = stepCook(IDLE.cook, { press: false, release: true }, 0);
    expect(idle.state.phase).toBe('idle');
    expect(idle.signal).toBeNull();
    const r = stepCook(COOKING.cook, { press: false, release: true }, DYNAMITE_COOK.fuseMaxSec + 0.01);
    expect(r.signal).toEqual({ kind: 'overcook' });
  });
});

describe('eye / throw origin', () => {
  it('eyePos = feet + eye height', () => {
    const st = makeFpv([3, 0, -4], 0, 0);
    expect(eyePos(st)).toEqual([3, FPV_TUNING.eyeHeightM, -4]);
  });

  it('throwOrigin = eye + camera-space hand offset (lateral/vertical/forward)', () => {
    const st = makeFpv([1, 0, 2], 0, 0);
    const o = throwOrigin(st);
    expect(o[0]).toBeCloseTo(1 + FPV_TUNING.handOffsetM.lateral, 9);
    expect(o[1]).toBeCloseTo(FPV_TUNING.eyeHeightM + FPV_TUNING.handOffsetM.vertical, 9);
    expect(o[2]).toBeCloseTo(2 - FPV_TUNING.handOffsetM.forward, 9);
  });
});

describe('determinism', () => {
  it('identical (state, input, dt, now, bounds) sequences → identical results', () => {
    const run = (): string => {
      let s = makeFpv([0, 0, 0], 0.3, -0.2);
      const sigs: unknown[] = [];
      for (let i = 0; i < 300; i++) {
        const input: FpvInput = {
          dx: Math.sin(i),
          dy: Math.cos(i),
          forward: i % 3 === 0,
          back: i % 5 === 0,
          left: i % 7 === 0,
          right: i % 11 === 0,
          press: i % 13 === 0,
          release: i % 17 === 0,
        };
        const r = stepFpv(s, input, 1 / 60, i / 60, BOUNDS);
        s = r.state;
        if (r.signal) sigs.push(r.signal);
      }
      return JSON.stringify({ s, sigs });
    };
    expect(run()).toBe(run());
  });
});
