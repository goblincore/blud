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
//   angVel = shortest-arc (cur · prev⁻¹) as axis·angle / dt   (world frame —
//            the same convention gibPriorState integrates backwards)
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
import { qFromTo, type Quat } from '../vec';

/** The haft and hand ride the camera ~0.4 m from the eye, so the hand's real
 *  ~8 m/s sweeps as many pixels as the head's 20 m/s a metre further out: at
 *  full motion the thin brass haft smeared to near-invisibility and the
 *  forearm became a long ghost band (measured headless, heavy stroke). A
 *  view-model reads better held steadier than physics — the eye tracks the
 *  weapon in hand — so its motion is scaled for the blur only. */
export const CENSER_HAFT_BLUR_GAIN = 0.35;

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
 * A `Chunk`-shaped motion state for one drawn part between two consecutive
 * poses. `support` defaults to one origin sphere of `radius` (the gib
 * default); a long part passes spheres along its length so the seed's probes
 * reach its far end. Fields the blur never reads are neutral.
 */
export function censerMotionState(
  prev: Pose, cur: Pose, dt: number, radius: number,
  support?: readonly SupportSphere[],
): Chunk {
  const ok = dt > 0 && Number.isFinite(dt);
  const vel: Vec3 = ok
    ? [(cur.pos[0] - prev.pos[0]) / dt, (cur.pos[1] - prev.pos[1]) / dt, (cur.pos[2] - prev.pos[2]) / dt]
    : [0, 0, 0];
  return {
    limb: 'torso',
    kind: 'gob',
    pos: [cur.pos[0], cur.pos[1], cur.pos[2]],
    vel,
    radius,
    squash: 0,
    quat: [cur.quat[0], cur.quat[1], cur.quat[2], cur.quat[3]],
    angVel: angularVelocity(prev.quat, cur.quat, dt),
    longAxis: [0, 1, 0],
    support: support ?? [{ c: [0, 0, 0], r: radius }],
  };
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * The chain as a taut rod from the knot `a` to the head's ring `b`, split into
 * `n` equal samples. Sample i sits at the SAME fraction of the rod in both
 * frames, so its velocity interpolates linearly from the knot's to the ring's —
 * exactly a rigid rod's velocity field. Each sample's radius is half its
 * length, so the rotating probe set (±radius on the local axes, local +Y along
 * the rod) tiles the rod end to end.
 */
export function chainRodStates(
  prevA: Vec3, prevB: Vec3, curA: Vec3, curB: Vec3, dt: number, n = CENSER_CHAIN_SAMPLES,
): Chunk[] {
  const count = Math.max(1, Math.floor(n));
  const Y: Vec3 = [0, 1, 0];
  const dirPrev: Vec3 = [prevB[0] - prevA[0], prevB[1] - prevA[1], prevB[2] - prevA[2]];
  const dirCur: Vec3 = [curB[0] - curA[0], curB[1] - curA[1], curB[2] - curA[2]];
  const span = Math.hypot(dirCur[0], dirCur[1], dirCur[2]);
  const qPrev = Math.hypot(...dirPrev) > 1e-6 ? qFromTo(Y, dirPrev) : [0, 0, 0, 1] as Quat;
  const qCur = span > 1e-6 ? qFromTo(Y, dirCur) : [0, 0, 0, 1] as Quat;
  const radius = Math.max(CENSER_CHAIN_MIN_RADIUS, span / count / 2);
  const out: Chunk[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    out.push(censerMotionState(
      { pos: lerp3(prevA, prevB, t), quat: qPrev },
      { pos: lerp3(curA, curB, t), quat: qCur },
      dt, radius,
      [{ c: [0, -radius, 0], r: CENSER_CHAIN_MIN_RADIUS }, { c: [0, radius, 0], r: CENSER_CHAIN_MIN_RADIUS }],
    ));
  }
  return out;
}

/** A motion state with its velocities scaled by `k` (the view-model gain). */
export function scaleMotion(state: Chunk, k: number): Chunk {
  const g = Number.isFinite(k) ? Math.max(0, k) : 0;
  return {
    ...state,
    vel: [state.vel[0] * g, state.vel[1] * g, state.vel[2] * g],
    angVel: [state.angVel[0] * g, state.angVel[1] * g, state.angVel[2] * g],
  };
}

/** A prior position pulled toward `cur` so the implied motion is `k` × the real one. */
export function scaledPrior(prev: Vec3, cur: Vec3, k: number): Vec3 {
  const g = Number.isFinite(k) ? Math.max(0, k) : 0;
  return [cur[0] + (prev[0] - cur[0]) * g, cur[1] + (prev[1] - cur[1]) * g, cur[2] + (prev[2] - cur[2]) * g];
}
