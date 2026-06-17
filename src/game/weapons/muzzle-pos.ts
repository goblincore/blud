import type { Vec3 } from '../gibs/particles';

/** Orthonormal camera basis in world space (each axis normalized). */
export interface CameraBasis {
  /** Camera local +X in world space (screen-right). */
  right: Vec3;
  /** Camera local +Y in world space (screen-up). */
  up: Vec3;
  /** Camera look direction in world space (local -Z). */
  forward: Vec3;
}

/**
 * World-space muzzle/hand position derived from a camera basis + eye position.
 *
 * The offsets are all in *camera* space so the muzzle stays anchored to the
 * visible first-person gun sprite regardless of where the player is looking
 * (yaw/pitch) or strafing:
 *   - `lateral`  along screen-right  (+ right)
 *   - `vertical` along screen-up     (+ up; use a negative value for below-eye)
 *   - `forward`  along the look dir  (+ forward, toward the gun muzzle)
 *
 * `bob` is the FPV view-bob offset in the same camera space (x=right, y=up)
 * so the spawn origin tracks the swaying gun sprite while walking/strafing.
 *
 * Extracted as a pure function so the basis/offset/sign math is unit-testable
 * in isolation (the camera-basis extraction itself lives in the adapter and
 * relies on Three.js, so it stays there).
 */
export function muzzleWorldPosition(
  eye: Vec3,
  basis: CameraBasis,
  lateral: number,
  vertical: number,
  forward: number,
  bob: { x: number; y: number } = { x: 0, y: 0 },
): Vec3 {
  const lat = lateral + bob.x;
  const vert = vertical + bob.y;
  return {
    x: eye.x + basis.right.x * lat + basis.up.x * vert + basis.forward.x * forward,
    y: eye.y + basis.right.y * lat + basis.up.y * vert + basis.forward.y * forward,
    z: eye.z + basis.right.z * lat + basis.up.z * vert + basis.forward.z * forward,
  };
}
