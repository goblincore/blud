import type { Vec3 } from './types';
import { add, len, lerp, sub } from './vec';
import { rotateYaw } from './gait';

type Side = 0 | 1;

export interface SoldierFootwork {
  root: Vec3;
  feet: [Vec3, Vec3];
  swing: { side: Side; from: Vec3; to: Vec3; age: number } | null;
  next: Side;
  /** Controller intent, independent of waiting for a supporting foot. */
  driveSpeed: number;
}

interface FootworkInput {
  fromRoot: Vec3;
  desiredRoot: Vec3;
  yaw: number;
  feet: [Vec3, Vec3];
  /** Body-local anchors, with absolute standing height in Y. */
  hips: [Vec3, Vec3];
  homes: [Vec3, Vec3];
  reach: [number, number];
  lift: [number, number];
  /** Per-side stride reach, used by persistent injury shuffles. */
  stepScale?: [number, number];
  groundY: number;
  dt: number;
}

const STEP = { duration: .18, trigger: .065, minLane: .065 } as const;

/** Alternating, distance-triggered walking and combat steps. A support is a fixed WORLD
 * contact. If the body outruns that contact it waits for the swing to finish;
 * moving the support to catch the body is precisely the old floor glide. */
export function stepSoldierFootwork(previous: SoldierFootwork | undefined, input: FootworkInput): SoldierFootwork {
  const { fromRoot, desiredRoot, yaw, groundY, dt } = input;
  const delta = sub(desiredRoot, fromRoot);
  const speed = dt > 0 ? Math.hypot(delta[0], delta[2]) / dt : 0;
  const ahead: Vec3 = dt > 0 ? [delta[0] * STEP.duration / dt, 0, delta[2] * STEP.duration / dt] : [0, 0, 0];
  const homes = input.homes.map(p => add(fromRoot, rotateYaw(p, yaw)));
  // Collision/crowd corrections may have translated the whole actor since
  // the last step. Rebase its contacts by exactly that external correction.
  const shift = previous ? sub(fromRoot, previous.root) : [0, 0, 0] as Vec3;
  const feet: [Vec3, Vec3] = previous
    ? [add(previous.feet[0], shift), add(previous.feet[1], shift)]
    : input.feet.map(p => [p[0], groundY, p[2]] as Vec3) as [Vec3, Vec3];
  let swing = previous?.swing
    ? { ...previous.swing, from: add(previous.swing.from, shift), to: add(previous.swing.to, shift) } : null;
  const localTravel = rotateYaw(delta, -yaw);
  let next: Side = previous?.next ?? (input.homes[0][0] * localTravel[0] > 0 ? 0 : 1);

  if (swing) {
    swing.age += Math.max(0, dt);
    const u = Math.min(1, swing.age / STEP.duration);
    // A definite lift, transfer and touchdown; no spring chasing a curve.
    const p = lerp(swing.from, swing.to, u * u * (3 - 2 * u));
    feet[swing.side] = [p[0], groundY + input.lift[swing.side] * Math.sin(Math.PI * u), p[2]];
    if (u === 1) {
      feet[swing.side] = swing.to;
      next = swing.side === 0 ? 1 : 0;
      swing = null;
    }
  }

  if (!swing) {
    const error = (side: Side) => len(sub(feet[side], add(homes[side]!, [ahead[0] * .5, 0, ahead[2] * .5])));
    if (speed < .04 && error(next) < STEP.trigger) next = next === 0 ? 1 : 0;
    if (error(next) > STEP.trigger) {
      const stepScale = input.stepScale?.[next] ?? 1;
      let target = add(homes[next]!, [ahead[0] * stepScale, 0, ahead[2] * stepScale]);
      const support = feet[next === 0 ? 1 : 0];
      const across = rotateYaw(sub(target, support), -yaw);
      const sign = Math.sign(input.homes[next][0]);
      const x = sign * Math.max(.14, sign * across[0]);
      const span = Math.hypot(x, across[2]);
      const scale = span > .64 ? .64 / span : 1;
      target = add(support, rotateYaw([x * scale, across[1], across[2] * scale], yaw));
      swing = { side: next, from: feet[next], to: [target[0], groundY, target[2]], age: 0 };
    }
  }

  const fits = (root: Vec3): boolean => {
    for (const side of [0, 1] as const) {
      if (swing?.side !== side) {
        const hip = add(root, rotateYaw(input.hips[side], yaw));
        if (len(sub(feet[side], hip)) > input.reach[side] + 1e-6) return false;
      }
      const sign = Math.sign(input.homes[side][0]);
      const oldLane = sign * rotateYaw(sub(feet[side], fromRoot), -yaw)[0];
      // A turning body may already be across a lane; let the next step
      // correct that. Ordinary lateral travel never drags a foot across it.
      if (oldLane >= STEP.minLane && sign * rotateYaw(sub(feet[side], root), -yaw)[0] < STEP.minLane) return false;
    }
    return true;
  };
  let root = desiredRoot;
  if (!fits(root)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (fits(lerp(fromRoot, desiredRoot, mid))) lo = mid; else hi = mid;
    }
    root = lerp(fromRoot, desiredRoot, lo);
  }
  return { root, feet, swing, next, driveSpeed: speed };
}
