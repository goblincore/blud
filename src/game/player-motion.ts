export interface MovementInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface Vec3 { x: number; y: number; z: number; }

export function movementDirection(input: MovementInput, yawRad: number): Vec3 {
  const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (fwd === 0 && strafe === 0) return { x: 0, y: 0, z: 0 };

  // local-space: +X right, -Z forward (Three.js convention for default camera)
  const lx = strafe;
  const lz = -fwd;
  const len = Math.hypot(lx, lz);
  const nx = lx / len;
  const nz = lz / len;

  // rotate around Y by yawRad. yaw=0 keeps local axes; yaw=π/2 rotates the
  // local forward (-Z) to world -X.
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  return {
    x: nx * cos + nz * sin,
    y: 0,
    z: -nx * sin + nz * cos,
  };
}
