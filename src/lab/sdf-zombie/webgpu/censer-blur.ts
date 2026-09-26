// src/lab/sdf-zombie/webgpu/censer-blur.ts
//
// CENSER SWING MOTION BLUR — THE PURE HALF (censer plan Task 8b, 2026-09-26).
//
// The censer is smeared by the SAME layer that smears flying gibs
// (gib-shutter-layer.ts): selected meshes leave the clean base pass, are drawn
// alone, and a rotation-aware motion seed (gib-motion-blur.ts) is resolved over
// the frame. That layer reads a gib's physics `Chunk` — and of it only
// pos/vel/quat/angVel/radius/squash/support (plus chunkSettled's use of the
// same fields). The censer has no Chunk: its parts are drawn from poses. This
// module turns two consecutive drawn poses into a Chunk-shaped motion state:
//
//   vel    = (pos − prevPos) / dt
//   angVel = world-frame axis·angle / dt (the convention gibPriorState
//            integrates backwards). For a RIGID pose (the haft) it is the
//            shortest-arc quaternion delta. For a part drawn by pointing an
//            axis (the head hangs along its chain, the chain is a rod) it is
//            SWING-ONLY — cross(axisPrev, axisCur) — because the drawn quat's
//            twist about that axis is arbitrary: setFromUnitVectors(Y, d) is
//            singular at d = −Y, exactly how the chain hangs, and a 2 mm drift
//            there read as a ~30–190 rad/s twist that selected every sample.
//
// and splits the chain (ONE InstancedMesh) into a few rod samples, each with
// its own velocity, because a chain's knot end moves at hand speed and its ring
// end at head speed: a single state for the whole mesh would either under-streak
// the head end or over-streak the knot end, and the probes of one small state
// would leave most of the chain's pixels without a seed (drawn sharp).
//
// No three import. Plain data in, plain data out.

import type { Chunk, SupportSphere } from '../gib-chunks';
import type { Vec3 } from '../types';
import type { Quat } from '../vec';

/** The haft and hand ride the camera ~0.4 m from the eye, so the hand's real
 *  ~8 m/s sweeps as many pixels as the head's 20 m/s a metre further out: at
 *  full motion the thin brass haft smeared to near-invisibility and the
 *  forearm became a long ghost band (measured headless, heavy stroke). A
 *  view-model reads better held steadier than physics — the eye tracks the
 *  weapon in hand — so its motion is scaled for the blur only. The owner's first
 *  look still found the thin haft nearly gone mid-stroke at 0.35. */
export const CENSER_HAFT_BLUR_GAIN = 0.2;
/** The same for the CHAIN's ring end (its knot end rides the haft's gain): at the
 *  head's full speed the 1.5 cm links smeared into a faint band — 6% of their
 *  contrast left mid-recover (scripts/censer-look.mjs, heavy f22). At 0.12 about
 *  two-thirds survives; the head itself keeps its full streak. (Task 9 look pass:
 *  haft 0.35 → 0.2, chain 1 → 0.12.) */
export const CENSER_CHAIN_BLUR_GAIN = 0.12;

/** Stream ids for censer subjects: far above any gib/sprite id. */
export const CENSER_BLUR_ID_BASE = 1_000_000;
export const CENSER_BLUR_IDS = {
  head: CENSER_BLUR_ID_BASE,
  haft: CENSER_BLUR_ID_BASE + 1,
  /** + sample index (0..CENSER_CHAIN_SAMPLES-1). */
  chain: CENSER_BLUR_ID_BASE + 16,
} as const;
/** Probe radius of the haft's state (its thickness, not its length — the
 *  length is carried by support spheres along it). */
export const CENSER_HAFT_BLUR_RADIUS = 0.03;
/** Rod samples the chain is split into. Each is one subject on the same
 *  InstancedMesh (layers are per object; one mesh passed N times is fine). */
export const CENSER_CHAIN_SAMPLES = 6;
/** A chain sample's probe radius never drops below a link's size. */
export const CENSER_CHAIN_MIN_RADIUS = 0.01;

export interface Pose { pos: Vec3; quat: Quat }

/** Blur only while the censer is actually being swung: a resting censer (idle,
 *  pending, a reeled-in dangle) never pays for the layer. */
export function censerBlurActive(phase: string): boolean {
  return phase === 'windup' || phase === 'stroke' || phase === 'recover';
}

function qConj(q: Quat): Quat { return [-q[0], -q[1], -q[2], q[3]]; }
function qMulRaw(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** World-frame angular velocity taking `prev` to `cur` over `dt`, shortest arc. */
export function angularVelocity(prev: Quat, cur: Quat, dt: number): Vec3 {
  if (!(dt > 0) || !Number.isFinite(dt)) return [0, 0, 0];
  let d = qMulRaw(cur, qConj(prev));
  // Shortest arc: q and −q are the same rotation; the negative-w one is the long way.
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const s = Math.hypot(d[0], d[1], d[2]);
  if (!(s > 1e-9)) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, d[3]);
  const k = angle / (s * dt);
  return [d[0] * k, d[1] * k, d[2] * k];
}

/**
 * SWING-ONLY angular velocity of an axis turning from `a` to `b` over `dt`:
 * normalize(a × b) · angle(a, b) / dt. No twist about the axis — for a part
 * whose drawn frame is only defined up to a twist (a rod, a hanging head).
 * Parallel axes (or dt <= 0) give zero; an exact reversal picks a stable
 * perpendicular.
 */
export function swingAngularVelocity(a: Vec3, b: Vec3, dt: number): Vec3 {
  if (!(dt > 0) || !Number.isFinite(dt)) return [0, 0, 0];
  const na = Math.hypot(a[0], a[1], a[2]), nb = Math.hypot(b[0], b[1], b[2]);
  if (!(na > 1e-12) || !(nb > 1e-12)) return [0, 0, 0];
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const sinN = Math.hypot(cx, cy, cz);            // |a||b| sin θ
  const cosN = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const angle = Math.atan2(sinN, cosN);
  if (!(angle > 1e-12)) return [0, 0, 0];
  if (sinN > 1e-12 * na * nb) {
    const k = angle / (sinN * dt);
    return [cx * k, cy * k, cz * k];
  }
  // Reversal: any perpendicular is as good as another; keep it stable.
  const p = axisPerp([a[0] / na, a[1] / na, a[2] / na]);
  return [p[0] * angle / dt, p[1] * angle / dt, p[2] * angle / dt];
}

function axisPerp(y: Vec3): Vec3 {
  // A reference that is never near-parallel to y: world Z unless y is close to it.
  const ref: Vec3 = Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x: Vec3 = [y[1] * ref[2] - y[2] * ref[1], y[2] * ref[0] - y[0] * ref[2], y[0] * ref[1] - y[1] * ref[0]];
  const n = Math.hypot(x[0], x[1], x[2]) || 1;
  return [x[0] / n, x[1] / n, x[2] / n];
}

/**
 * A STABLE frame whose local +Y is `axis` (the probes only need the rod axis on
 * +Y). Built from a fixed world reference rather than a shortest arc from +Y,
 * so it is smooth through straight down, where the chain hangs.
 */
export function axisQuat(axis: Vec3): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(n > 1e-12)) return [0, 0, 0, 1];
  const y: Vec3 = [axis[0] / n, axis[1] / n, axis[2] / n];
  const x = axisPerp(y);
  const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  // Rotation matrix with columns x, y, z → quaternion.
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const qn = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / qn, q[1] / qn, q[2] / qn, q[3] / qn];
}

/** A zeroed, poolable Chunk-shaped state (fields the blur never reads are neutral). */
export function makeMotionState(): Chunk {
  return {
    limb: 'torso', kind: 'gob',
    pos: [0, 0, 0], vel: [0, 0, 0], radius: 0, squash: 0,
    quat: [0, 0, 0, 1], angVel: [0, 0, 0], longAxis: [0, 1, 0],
    support: [{ c: [0, 0, 0], r: 0 }],
  };
}

/**
 * Write a motion state IN PLACE (pooled — no per-frame allocation beyond a
 * support array whose length changes): position `cur`, velocity from the
 * position delta, the given orientation and angular velocity. `support`
 * defaults to one origin sphere of `radius` (the gib default); a long part
 * passes spheres along its length so the seed's probes reach its far end.
 */
export function setMotionState(
  out: Chunk, prevPos: Vec3, curPos: Vec3, quat: Quat, angVel: Vec3, dt: number, radius: number,
  support?: readonly SupportSphere[],
): Chunk {
  const ok = dt > 0 && Number.isFinite(dt);
  // Chunk's tuples are readonly in the type; the pooled arrays are ours to write.
  const p = out.pos as unknown as number[], v = out.vel as unknown as number[];
  const q = out.quat as unknown as number[], w = out.angVel as unknown as number[];
  p[0] = curPos[0]; p[1] = curPos[1]; p[2] = curPos[2];
  v[0] = ok ? (curPos[0] - prevPos[0]) / dt : 0;
  v[1] = ok ? (curPos[1] - prevPos[1]) / dt : 0;
  v[2] = ok ? (curPos[2] - prevPos[2]) / dt : 0;
  q[0] = quat[0]; q[1] = quat[1]; q[2] = quat[2]; q[3] = quat[3];
  w[0] = ok ? angVel[0] : 0; w[1] = ok ? angVel[1] : 0; w[2] = ok ? angVel[2] : 0;
  out.radius = radius;
  out.squash = 0;
  if (support) {
    out.support = support;
  } else {
    const s0 = out.support.length === 1 ? out.support[0] as SupportSphere : undefined;
    if (s0 && s0.c[0] === 0 && s0.c[1] === 0 && s0.c[2] === 0) (s0 as { r: number }).r = radius;
    else out.support = [{ c: [0, 0, 0], r: radius }];
  }
  return out;
}

/**
 * A `Chunk`-shaped motion state for a RIGID part between two consecutive
 * poses (angular velocity from the shortest-arc quaternion delta).
 */
export function censerMotionState(
  prev: Pose, cur: Pose, dt: number, radius: number,
  support?: readonly SupportSphere[], out: Chunk = makeMotionState(),
): Chunk {
  return setMotionState(out, prev.pos, cur.pos, cur.quat, angularVelocity(prev.quat, cur.quat, dt), dt, radius, support);
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * The chain as a taut rod from the knot `a` to the head's ring `b`, split into
 * `n` equal samples. Sample i sits at the SAME fraction of the rod in both
 * frames, so its velocity interpolates linearly from the knot's to the ring's —
 * a rigid rod's velocity field. Angular velocity is SWING-ONLY (the rod has no
 * meaningful twist), and the frame is `axisQuat` (smooth through straight
 * down). Each sample's radius is half its length, so the rotating probe set
 * (±radius on the local axes, local +Y along the rod) tiles the rod end to end.
 * Pass `pool` (n states from makeMotionState) to write in place.
 */
export function chainRodStates(
  prevA: Vec3, prevB: Vec3, curA: Vec3, curB: Vec3, dt: number, n = CENSER_CHAIN_SAMPLES,
  pool?: Chunk[],
): Chunk[] {
  const count = Math.max(1, Math.floor(n));
  const dirPrev: Vec3 = [prevB[0] - prevA[0], prevB[1] - prevA[1], prevB[2] - prevA[2]];
  const dirCur: Vec3 = [curB[0] - curA[0], curB[1] - curA[1], curB[2] - curA[2]];
  const span = Math.hypot(dirCur[0], dirCur[1], dirCur[2]);
  const q = axisQuat(dirCur);
  const w = swingAngularVelocity(dirPrev, dirCur, dt);
  const radius = Math.max(CENSER_CHAIN_MIN_RADIUS, span / count / 2);
  const out: Chunk[] = pool ?? [];
  out.length = Math.max(out.length, count);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const st = out[i] ?? (out[i] = makeMotionState());
    const sup = st.support.length === 2 ? st.support as SupportSphere[] : [
      { c: [0, 0, 0] as Vec3, r: CENSER_CHAIN_MIN_RADIUS }, { c: [0, 0, 0] as Vec3, r: CENSER_CHAIN_MIN_RADIUS },
    ];
    (sup[0]!.c as unknown as number[])[1] = -radius;
    (sup[1]!.c as unknown as number[])[1] = radius;
    setMotionState(st, lerp3(prevA, prevB, t), lerp3(curA, curB, t), q, w, dt, radius, sup);
  }
  out.length = count;
  return out;
}

/** A motion state with its velocities scaled by `k` (the view-model gain), in place. */
export function scaleMotion(state: Chunk, k: number): Chunk {
  const g = Number.isFinite(k) ? Math.max(0, k) : 0;
  const v = state.vel as unknown as number[], w = state.angVel as unknown as number[];
  v[0]! *= g; v[1]! *= g; v[2]! *= g;
  w[0]! *= g; w[1]! *= g; w[2]! *= g;
  return state;
}

/** A prior position pulled toward `cur` so the implied motion is `k` × the real one. */
export function scaledPrior(prev: Vec3, cur: Vec3, k: number): Vec3 {
  const g = Number.isFinite(k) ? Math.max(0, k) : 0;
  return [cur[0] + (prev[0] - cur[0]) * g, cur[1] + (prev[1] - cur[1]) * g, cur[2] + (prev[2] - cur[2]) * g];
}
