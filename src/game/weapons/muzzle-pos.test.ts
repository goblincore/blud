import { describe, it, expect } from 'vitest';
import { muzzleWorldPosition, type CameraBasis } from './muzzle-pos';
import type { Vec3 } from '../gibs/particles';

/**
 * Regression tests for the flare-muzzle origin bug: the lateral/vertical
 * offsets must rotate with the camera (live in camera space), not be fixed
 * world vectors. The old `handPos` did `pos.x + 0.2` in world space, so the
 * muzzle detached from the gun sprite when strafing / turning.
 *
 * Eye height = 1.55 (player EYE_HEIGHT). With `vertical = -0.25` the muzzle
 * sits 0.25 m below the eye (~1.3 m above the body origin), matching the old
 * feel — but now correctly anchored to the camera basis.
 */
describe('muzzleWorldPosition', () => {
  const eye: Vec3 = { x: 0, y: 1.55, z: 0 };
  const LATERAL = 0.2;
  const VERTICAL = -0.25;
  const FORWARD = 0.5;

  it('facing -Z places the muzzle right, below eye, in front', () => {
    // Default FPS orientation: looking down world -Z.
    const basis: CameraBasis = {
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };
    const m = muzzleWorldPosition(eye, basis, LATERAL, VERTICAL, FORWARD);
    expect(m.x).toBeCloseTo(0.2); // lateral along world +X (right)
    expect(m.y).toBeCloseTo(1.3); // 1.55 - 0.25
    expect(m.z).toBeCloseTo(-0.5); // forward along -Z
  });

  it('facing +X rotates the lateral offset onto +Z, NOT world +X (the fix)', () => {
    // Yaw so forward = +X. Camera-right then = world +Z.
    const basis: CameraBasis = {
      right: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 1, y: 0, z: 0 },
    };
    const m = muzzleWorldPosition(eye, basis, LATERAL, VERTICAL, FORWARD);
    // forward offset goes along +X
    expect(m.x).toBeCloseTo(0.5);
    // still 0.25 below eye
    expect(m.y).toBeCloseTo(1.3);
    // lateral offset now lands on +Z (rotated with facing) — would be 0 under
    // the old world-space bug and x would be +0.2 instead.
    expect(m.z).toBeCloseTo(0.2);
  });

  it('facing -X mirrors the lateral offset onto -Z', () => {
    const basis: CameraBasis = {
      right: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: -1, y: 0, z: 0 },
    };
    const m = muzzleWorldPosition(eye, basis, LATERAL, VERTICAL, FORWARD);
    expect(m.x).toBeCloseTo(-0.5); // forward along -X
    expect(m.y).toBeCloseTo(1.3);
    expect(m.z).toBeCloseTo(-0.2); // lateral along -Z
  });

  it('adds the FPV view-bob in camera space so the muzzle tracks the gun sprite', () => {
    const basis: CameraBasis = {
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };
    const m = muzzleWorldPosition(eye, basis, LATERAL, VERTICAL, FORWARD, { x: 0.05, y: -0.02 });
    // lat = 0.2 + 0.05 = 0.25 ; vert = -0.25 + -0.02 = -0.27
    expect(m.x).toBeCloseTo(0.25);
    expect(m.y).toBeCloseTo(1.28); // 1.55 - 0.27
    expect(m.z).toBeCloseTo(-0.5); // bob has no forward component
  });

  it('defaults to zero bob when omitted', () => {
    const basis: CameraBasis = {
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };
    const a = muzzleWorldPosition(eye, basis, LATERAL, VERTICAL, FORWARD);
    const b = muzzleWorldPosition(eye, basis, LATERAL, VERTICAL, FORWARD, { x: 0, y: 0 });
    expect(a).toEqual(b);
  });

  it('puts the muzzle IN FRONT of the eye — the sdf-game sign regression', () => {
    // game-main's inline version used -forward*0.5, which spawned every
    // projectile half a metre BEHIND the player's head while the visible
    // muzzle sat 0.6 m in front of it.
    const fwd = { x: 0, y: 0, z: -1 };
    const m = muzzleWorldPosition(
      { x: 0, y: 1.6, z: 0 },
      { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: fwd },
      0.2, -0.12, 0.5,
    );
    const along = (m.x - 0) * fwd.x + (m.y - 1.6) * fwd.y + (m.z - 0) * fwd.z;
    expect(along).toBeGreaterThan(0);
    expect(along).toBeCloseTo(0.5, 6);
  });
});
