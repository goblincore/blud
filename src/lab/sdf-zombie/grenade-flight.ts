// Game-scale grenade physics. Pure, fixed 120 Hz; collision comes in as data.
import type { Vec3 } from './types';
import { add, sub, scale, dot, len, normalize } from './vec';

export const GRENADE = {
  speedMps: 16, liftMps: 2.0, gravityMps2: 14, radiusM: .035,
  fuseSec: 1.6, restitution: .48, friction: .78, restMps: .55,
  stepSec: 1 / 120, embedDepthM: .022, blastRadiusScale: .75,
  fragments: 32, fragmentSpeedMps: 38, fragmentRangeM: 7,
} as const;
export interface GrenadeContact {
  t: number; center: Vec3; point: Vec3; normal: Vec3;
  actorId?: number; flesh?: boolean;
}
export interface GrenadeWorld {
  sweep(from: Vec3, to: Vec3, radius: number): GrenadeContact | null;
  /** Null releases an attachment whose actor/limb no longer exists. */
  attached?(actorId: number, pos: Vec3, direction: Vec3): { pos: Vec3; direction: Vec3 } | null;
}
export interface GrenadeState {
  pos: Vec3; vel: Vec3; direction: Vec3; age: number; fuse: number;
  remainder: number; spin: number; bounces: number;
  embedded: number | null; detonated: boolean;
}
export function grenadeVelocity(aim: Vec3): Vec3 {
  return add(scale(normalize(aim), GRENADE.speedMps), [0, GRENADE.liftMps, 0]);
}
export function makeGrenade(pos: Vec3, vel: Vec3, fuse = GRENADE.fuseSec): GrenadeState {
  return { pos: [...pos], vel: [...vel], direction: normalize(vel), age: 0, fuse,
    remainder: 0, spin: 0, bounces: 0, embedded: null, detonated: false };
}
function step(s: GrenadeState, dt: number, w: GrenadeWorld): GrenadeState {
  let next = { ...s, age: s.age + dt, fuse: Math.max(0, s.fuse - dt) };
  if (s.embedded !== null) {
    const anchor = w.attached ? w.attached(s.embedded, s.pos, s.direction) : { pos: s.pos, direction: s.direction };
    if (anchor) return { ...next, ...anchor, detonated: next.fuse <= 1e-9 };
    next = { ...next, embedded: null, vel: [0, 0, 0] };
  }
  let vel = add(next.vel, [0, -GRENADE.gravityMps2 * dt, 0]);
  let pos = next.pos, remaining = dt, bounces = next.bounces;
  for (let i = 0; i < 4 && remaining > 1e-9; i++) {
    const target = add(pos, scale(vel, remaining));
    const hit = w.sweep(pos, target, GRENADE.radiusM);
    if (!hit) { pos = target; break; }
    const direction = normalize(vel);
    if (hit.flesh && hit.actorId !== undefined) {
      pos = add(hit.point, scale(direction, GRENADE.embedDepthM));
      return { ...next, pos, vel: [0, 0, 0], direction, embedded: hit.actorId,
        detonated: next.fuse <= 1e-9 };
    }
    // Clear the SDF hit epsilon so the reflected path does not hit again at t=0.
    pos = add(hit.center, scale(hit.normal, .001));
    const vn = dot(vel, hit.normal);
    const tangent = scale(sub(vel, scale(hit.normal, vn)), GRENADE.friction);
    const reflected = -Math.min(0, vn) * GRENADE.restitution;
    vel = add(tangent, scale(hit.normal, reflected < GRENADE.restMps ? 0 : reflected));
    // Tiny floor contacts are resting, not a new visual bounce every tick.
    if (-vn > GRENADE.restMps) bounces++;
    remaining *= 1 - Math.max(0, Math.min(1, hit.t));
  }
  return { ...next, pos, vel, bounces, direction: len(vel) > .1 ? normalize(vel) : next.direction,
    spin: next.spin + len(vel) * dt * 1.4, detonated: next.fuse <= 1e-9 };
}
export function stepGrenade(s: GrenadeState, dt: number, w: GrenadeWorld): GrenadeState {
  if (!(dt > 0) || !Number.isFinite(dt) || s.detonated) return s;
  let next = s, accumulator = s.remainder + Math.min(dt, .25);
  while (accumulator >= GRENADE.stepSec - 1e-9 && !next.detonated) {
    next = step(next, GRENADE.stepSec, w);
    accumulator -= GRENADE.stepSec;
  }
  return { ...next, remainder: Math.max(0, accumulator) };
}
/** Even sphere coverage, rotated deterministically per round. No RNG stream. */
export function grenadeFragments(shot: number): Vec3[] {
  return Array.from({ length: GRENADE.fragments }, (_, i) => {
    const y = 1 - 2 * (i + .5) / GRENADE.fragments;
    const r = Math.sqrt(1 - y * y), a = i * 2.399963229728653 + shot * .73;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
}

export interface GrenadeFragmentState { pos: Vec3; vel: Vec3; age: number }
export function stepGrenadeFragment(s: GrenadeFragmentState, dt: number, w: Pick<GrenadeWorld, 'sweep'>): {
  state: GrenadeFragmentState; hit: GrenadeContact | null; expired: boolean;
} {
  const life = GRENADE.fragmentRangeM / GRENADE.fragmentSpeedMps;
  const seconds = Number.isFinite(dt) ? Math.max(0, Math.min(dt, life - s.age)) : 0;
  if (seconds <= 0) return { state: s, hit: null, expired: s.age >= life };
  const next = add(s.pos, scale(s.vel, seconds));
  const hit = w.sweep(s.pos, next, .003);
  const age = s.age + seconds;
  return { state: { ...s, pos: hit?.center ?? next, age }, hit, expired: !!hit || age >= life - 1e-9 };
}
