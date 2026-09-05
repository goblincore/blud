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
  'Elbow_L', 'Elbow_R', 'Upper_L', 'Upper_R', 'Shoulder_L', 'Shoulder_R',
  'Watch_Screen',
] as const;

/** Forearm (hand -> elbow) and upper arm (elbow -> shoulder) lengths the IK
 *  uses, metres. The forearm is the asset's ELBOW_Z; the upper arm is the
 *  asset's UPPER_IK_LEN (its mesh overshoots so the far end stays behind the
 *  camera whether the arm is straight or bent). */
export const FORE_LEN_M = 0.235;
export const UPPER_LEN_M = 0.30;
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

/**
 * Two-bone IK: where the elbow is for a hand at `hand` and a shoulder at
 * `shoulder`, given the two bone lengths and a direction the elbow should
 * bend toward (outward, away from the gun). Rig space.
 *
 * The elbow always sits `lenFore` from the hand, at an angle `phi` off the
 * hand-shoulder line on the hint's side. In reach, phi comes from the law of
 * cosines so the upper arm meets the shoulder exactly; but phi is never less
 * than `minBend`. That floor is the point: with the shoulder fixed behind
 * the camera and the hand riding the gun under free aim, the straight
 * hand-shoulder line can pass THROUGH the receiver (owner's screenshots at a
 * hard look up). A guaranteed bend sends the forearm out past the gun first;
 * the upper arm then aims at the shoulder and may fall short of it, which
 * nobody sees -- the shoulder is behind the eye.
 */
export function armIk(
  hand: V3, shoulder: V3, lenFore: number, lenUpper: number, bendHint: V3, minBend = 0,
): V3 {
  const dx = shoulder[0] - hand[0], dy = shoulder[1] - hand[1], dz = shoulder[2] - hand[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return [hand[0] + bendHint[0] * lenFore, hand[1] + bendHint[1] * lenFore, hand[2] + bendHint[2] * lenFore];
  const ux = dx / d, uy = dy / d, uz = dz / d;
  // Perpendicular part of the hint, so the bend plane contains the hint.
  const along = bendHint[0] * ux + bendHint[1] * uy + bendHint[2] * uz;
  let px = bendHint[0] - ux * along, py = bendHint[1] - uy * along, pz = bendHint[2] - uz * along;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // Hint parallel to the arm: pick any perpendicular.
    px = -uy; py = ux; pz = 0; pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) { px = 0; py = -uz; pz = uy; pl = Math.hypot(px, py, pz); }
  }
  px /= pl; py /= pl; pz /= pl;
  let phi = 0;
  if (d < lenFore + lenUpper) {
    // Law of cosines: the elbow's foot on the line is `a` from the hand.
    let a = (lenFore * lenFore - lenUpper * lenUpper + d * d) / (2 * d);
    a = Math.max(-lenFore, Math.min(lenFore, a));
    phi = Math.acos(a / lenFore);
  }
  phi = Math.max(phi, minBend);
  const c = Math.cos(phi) * lenFore, h = Math.sin(phi) * lenFore;
  return [
    hand[0] + ux * c + px * h,
    hand[1] + uy * c + py * h,
    hand[2] + uz * c + pz * h,
  ];
}
