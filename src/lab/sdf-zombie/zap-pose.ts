// src/lab/sdf-zombie/zap-pose.ts
//
// THE ZAP POSE, as a pure pose (spec 2026-11-17-tesla-arc-design.md): the electrocuted star. Arms flung
// out, back arched, head thrown back, jaw open, the whole trunk shaking. It returns the same shape the
// burning flail does (burn-flail.ts) and motion.ts places it by the same arm solve, so no segment
// stretches.
//
// Hand targets are in SHOULDER coordinates, in units of the arm's full length:
//   [out, up, forward]   out = away from the body's midline (the same sign for both arms).
// Pure: no clock, no randomness beyond the seed.
import type { Vec3 } from './types';
import { FLAIL_REST } from './burn-flail';
import { ZAP } from './zap';

export const ZAP_POSE = Object.freeze({
  /** The furthest a hand target sits from the shoulder (arm lengths). */
  reach: 0.97,
  /** Hip to chest (m): turns the tremor's metres into the trunk's radians. */
  chestM: 0.5,
  /** Trunk pitch (rad, + forward): the arched back. */
  arch: -0.18,
  /** Head toss (rad, + forward): thrown back. */
  head: -0.35,
  /** Jaw gape (rad). */
  jaw: 0.5,
  /** Hand jitter under the tremor (arm lengths). */
  handShake: 0.02,
});

/** [left, right] hand targets per variant. 0 the star, 1 arms higher, 2 one up and one out. */
const VARIANTS: readonly (readonly [Vec3, Vec3])[] = [
  [[0.78, 0.5, 0.1], [0.78, 0.5, 0.1]],
  [[0.5, 0.8, 0.05], [0.5, 0.8, 0.05]],
  [[0.3, 0.88, 0.08], [0.93, 0.08, 0.12]],
];

export interface ZapPoseIn {
  /** Seconds since the zap began. */
  t: number;
  seed: number;
  /** 0..1 how far into the pose (ZapOut.pose). */
  amp: number;
  /** 0..2 (ZapOut.variant). */
  variant: number;
  /** 0..1 (ZapOut.tremor). */
  tremor: number;
  /** ZapTier.star. */
  star: boolean;
}

/** The burn flail's pose shape, with the arms optional and a jaw. */
export interface ZapPose {
  handL: Vec3 | null; handR: Vec3 | null;
  pitch: number; sway: number; headToss: number;
  /** Jaw gape (rad). */
  jaw: number;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
const mix = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const capped = (h: Vec3): Vec3 => {
  const l = Math.hypot(h[0], h[1], h[2]);
  return l > ZAP_POSE.reach ? [h[0] * ZAP_POSE.reach / l, h[1] * ZAP_POSE.reach / l, h[2] * ZAP_POSE.reach / l] : h;
};

export function zapPose(i: ZapPoseIn): ZapPose {
  const a = clamp01(i.amp), k = clamp01(i.tremor) * a;
  const ph = ((i.seed | 0) % 97) / 97 * TAU;
  const w = i.t * ZAP.tremorHz * TAU + ph;
  // The trunk's shake: the chest moves tremorM, split between a side sway and a pitch a quarter turn apart.
  const shake = (ZAP.tremorM / ZAP_POSE.chestM) * k;
  const sway = shake * Math.sin(w), nod = shake * 0.6 * Math.cos(w);
  if (!i.star) return { handL: null, handR: null, pitch: nod, sway, headToss: 0, jaw: 0 };
  const v = VARIANTS[Math.min(2, Math.max(0, i.variant | 0))]!;
  const hand = (target: Vec3, lane: number): Vec3 => {
    const j = ZAP_POSE.handShake * k;
    const shaken: Vec3 = [target[0] + j * Math.sin(w * 1.31 + lane), target[1] + j * Math.cos(w * 1.17 + lane * 2), target[2] + j * Math.sin(w * 0.93 + lane * 3)];
    return a === 0 ? FLAIL_REST : capped(mix(FLAIL_REST, shaken, a));
  };
  return {
    handL: hand(v[0], 0), handR: hand(v[1], 1),
    pitch: ZAP_POSE.arch * a + nod, sway,
    headToss: ZAP_POSE.head * a, jaw: ZAP_POSE.jaw * a,
  };
}
