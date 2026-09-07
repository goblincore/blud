import type { Vec3 } from './types';
import type { GaitJointName } from './gait';
import { rotateYaw } from './gait';
import { add, sub, qFromAxisAngle, qRotate, lerp, normalize, scale } from './vec';

/** Articulated fall targets: bones retain their lengths and the torso stays a
 * coherent mass. The existing rig follows these targets and still takes hits. */
export function soldierFallPose(base: readonly Vec3[], names: readonly GaitJointName[],
  start: readonly Vec3[], pivot: Vec3, shift: Vec3, yaw: number, age: number,
  floor: number, hurtLeft: boolean, alive: boolean, impact: Vec3 = [0,0,-1], strength = .8, braceRight = false): Vec3[] {
  const horizontal: Vec3 = Math.hypot(impact[0], impact[2]) > .001 ? normalize([impact[0],0,impact[2]]) : rotateYaw([0,0,-1], yaw);
  const localImpact = rotateYaw(horizontal, -yaw);
  // Tuck the arms in a side tumble: an outstretched lower arm must not
  // become a rigid strut holding the entire corpse above the floor.
  const armSpread = 1 - Math.abs(localImpact[0]) * .95;
  const pose = base.map(p => [...p] as Vec3);
  const index = (name: GaitJointName) => names.indexOf(name);
  const turnChain = (chain: GaitJointName[], angles: number[], splay: number) => {
    const root = index(chain[0]!);
    const side = Math.sign(base[root]![0] - pivot[0]) * splay;
    for (let n = 1; n < chain.length; n++) {
      const a = index(chain[n - 1]!), b = index(chain[n]!);
      if (a < 0 || b < 0) continue;
      const v = sub(base[b]!, base[a]!);
      const pitch = qRotate(qFromAxisAngle([1, 0, 0], angles[n - 1] ?? 0), v);
      pose[b] = add(pose[a]!, qRotate(qFromAxisAngle([0, 0, 1], side), pitch));
    }
  };
  // One knee folds, the other leg stretches out; arms fall clear of the ribs.
  turnChain(['hipL','kneeL','footL','toeL'], hurtLeft ? [-.5,.5,.5] : [-.12,.12,.12], .14);
  turnChain(['hipR','kneeR','footR','toeR'], hurtLeft ? [-.12,.12,.12] : [-.5,.5,.5], .14);
  const brace = alive ? .12 * Math.sin(age * 2.6) * Math.min(1, age / 1.5) : 0;
  turnChain(['shoulderL','elbowL','handL','handTipL'], alive && !braceRight ? [-.15,-.65 + brace,-.65 + brace] : [0,.15,.15], .65 * armSpread);
  turnChain(['shoulderR','elbowR','handR','handTipR'], alive && braceRight ? [-.15,-.65 + brace,-.65 + brace] : [0,.12,.12], .58 * armSpread);
  if (alive) {
    const neck = index('neck'), head = index('head');
    if (neck >= 0 && head >= 0) pose[head] = add(pose[neck]!,
      qRotate(qFromAxisAngle([1,0,0], .06 * Math.sin(age * 2)), sub(base[head]!, base[neck]!)));
  }
  const roll = hurtLeft ? -.15 : .15;
  const topple = qFromAxisAngle([localImpact[2],0,-localImpact[0]], 1.48);
  const settled = pose.map(p => {
    const v = qRotate(qFromAxisAngle([0, 0, 1], roll),
      qRotate(topple, sub(p, pivot)));
    return rotateYaw(v, yaw);
  });
  // Ground the load-bearing body, not a dangling (or severed) hand/foot.
  // Approximate torso contact radii include the chest shell. Limb floor
  // constraints can fold the extremities without lifting the entire body.
  const supports: [GaitJointName, number][] = [
    ['pelvis', .11], ['chest', .15], ['shoulderL', .115], ['shoulderR', .115],
  ];
  const low = Math.min(...supports.map(([name, radius]) => settled[index(name)]![1] - radius));
  const t = Math.min(1, Math.max(0, age / (alive ? .48 : .30)));
  const blend = t * t * (3 - 2 * t);
  const throwDistance = alive ? .12 : .35 + strength * .55;
  const shove = scale(horizontal, throwDistance * Math.min(1, age / .55));
  const airborne = alive ? 0 : Math.sin(Math.PI * t) * (.12 + .16 * strength);
  return settled.map((p, i) => add(lerp(start[i]!,
    [p[0] + pivot[0] + shift[0], p[1] - low + floor,
      p[2] + pivot[2] + shift[2]], blend), [shove[0], airborne, shove[2]]));
}
