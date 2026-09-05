// src/lab/sdf-zombie/webgpu/game-arms-math.ts
//
// The FPV arms' pure half: the node contract, the material-name mapping, and
// the basis that aims an arm. No Three import, so it is tested as numbers --
// the same split game-viewmodel.ts uses for the reload.

export type V3 = readonly [number, number, number];

/** Every node game-arms.ts requires in goblin-arm.glb. A missing one throws
 *  at load, like the gun: a silently absent locator is an arm that aims at
 *  nothing and reads as a bug three tasks later. */
export const ARM_NODES = [
  'Arm_L', 'Arm_R', 'Hand_L', 'Hand_R', 'Wrist_L', 'Wrist_R',
  'Elbow_L', 'Elbow_R', 'Watch_Screen',
] as const;
export type ArmNode = typeof ARM_NODES[number];

export type ArmMaterialKind =
  | 'skin' | 'leather' | 'steel' | 'brass' | 'band' | 'watchBody' | 'screen';

const KINDS: Record<string, ArmMaterialKind> = {
  Skin: 'skin', Leather: 'leather', Steel: 'steel', Brass: 'brass',
  Band: 'band', WatchBody: 'watchBody', Screen: 'screen',
};

/** GLB material name -> runtime treatment. Blender appends `.001` when a
 *  name collides on import/export; the exporter can carry that through. */
export function armMaterialKind(name: string): ArmMaterialKind | null {
  const base = name.split('.')[0] ?? '';
  return KINDS[base] ?? null;
}

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * An orthonormal right-handed basis for an arm whose origin is the hand:
 * `y` runs along `dir` (hand -> elbow), `z` is `dorsalHint` with its
 * along-arm component removed (so the back of the hand -- the watch -- faces
 * the hint, normally the camera at rig +Z), `x = y cross z`.
 *
 * A hint parallel to the arm has no perpendicular part; fall back to rig +X
 * so the basis stays orthonormal instead of collapsing.
 */
export function armBasis(dir: V3, dorsalHint: V3): { x: V3; y: V3; z: V3 } {
  const y = norm(dir);
  const along = dorsalHint[0] * y[0] + dorsalHint[1] * y[1] + dorsalHint[2] * y[2];
  let z: V3 = [dorsalHint[0] - y[0] * along, dorsalHint[1] - y[1] * along, dorsalHint[2] - y[2] * along];
  if (Math.hypot(z[0], z[1], z[2]) < 1e-6) {
    const alt: V3 = [1, 0, 0];
    const a2 = alt[0] * y[0] + alt[1] * y[1] + alt[2] * y[2];
    z = [alt[0] - y[0] * a2, alt[1] - y[1] * a2, alt[2] - y[2] * a2];
  }
  z = norm(z);
  const x = cross(y, z);
  return { x, y, z };
}
