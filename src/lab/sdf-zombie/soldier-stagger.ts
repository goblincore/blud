import type { Vec3 } from './types';

export const SOLDIER_STAGGER = {
  recoverySec: 1.20,
  aimSafeSec: 1.20,
  duration: [.42, .78, 1.20],
  driveSec: [.28, .46, .62],
  travel: [.08, .22, .38],
} as const;
export type SoldierStaggerLevel = 'small' | 'medium' | 'heavy';
export const soldierStaggerDuration = (level: SoldierStaggerLevel, fullStagger = false) =>
  fullStagger ? 1.35 : SOLDIER_STAGGER.duration[level === 'small' ? 0 : level === 'medium' ? 1 : 2];
const LEVEL_RANK: Record<SoldierStaggerLevel, number> = { small: 0, medium: 1, heavy: 2 };

export interface SoldierStaggerState {
  active: boolean;
  age: number;
  variant: 0 | 1 | 2;
  previous: 0 | 1 | 2;
  serial: number;
  dirWorld: Vec3;
  level: SoldierStaggerLevel;
  torso: boolean;
  fullOpen: boolean;
}

export interface SoldierStaggerStep {
  state: SoldierStaggerState;
  travelDelta: Vec3;
  armWeight: number;
  variant: 0 | 1 | 2;
  active: boolean;
  hunchWeight: number;
}

export function makeSoldierStaggerState(seed: number): SoldierStaggerState {
  const v = (Math.abs(seed | 0) % 3) as 0 | 1 | 2;
  return { active: false, age: 0, variant: v, previous: v, serial: 0, dirWorld: [0, 0, -1], level: 'small', torso: false, fullOpen: false };
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export function stepSoldierStagger(
  previous: SoldierStaggerState | undefined,
  hit: { dirWorld: Vec3; level: SoldierStaggerLevel; torso?: boolean; fullStagger?: boolean } | null,
  dt: number,
  seed: number,
  cancelled = false,
): SoldierStaggerStep {
  let state = previous ?? makeSoldierStaggerState(seed);
  if (cancelled) state = { ...state, active: false, age: 0 };
  if (hit && !cancelled && (!state.active || LEVEL_RANK[hit.level] > LEVEL_RANK[state.level]
    || (!!hit.fullStagger && !state.fullOpen))) {
    const side = hit.dirWorld[0] < -.15 ? 0 : hit.dirWorld[0] > .15 ? 2 : 1;
    let variant = (((seed + state.serial + side) % 3 + 3) % 3) as 0 | 1 | 2;
    if (variant === state.previous) variant = ((variant + 1) % 3) as 0 | 1 | 2;
    state = { active: true, age: 0, variant, previous: variant,
      serial: state.serial + 1, dirWorld: [...hit.dirWorld] as Vec3, level: hit.level,
      torso: !!hit.torso, fullOpen: !!hit.fullStagger };
  }
  if (!state.active) return { state, travelDelta: [0, 0, 0], armWeight: 0, hunchWeight: 0, variant: state.variant, active: false };
  const age0 = state.age;
  const age = age0 + Math.max(0, dt);
  const mag = Math.hypot(state.dirWorld[0], state.dirWorld[2]) || 1;
  const levelIndex = state.level === 'small' ? 0 : state.level === 'medium' ? 1 : 2;
  const distance = SOLDIER_STAGGER.travel[levelIndex];
  const driveSec = SOLDIER_STAGGER.driveSec[levelIndex];
  const duration = soldierStaggerDuration(state.level, state.fullOpen);
  const u0 = Math.min(age0 / driveSec, 1);
  const u1 = Math.min(age / driveSec, 1);
  const delta = distance * (smooth(u1) - smooth(u0));
  const lateral = (state.variant - 1) * .18;
  const dx = state.dirWorld[0] / mag, dz = state.dirWorld[2] / mag;
  const travelDelta: Vec3 = [(dx - dz * lateral) * delta, 0, (dz + dx * lateral) * delta];
  const rise = smooth(age / (state.fullOpen ? .25 : Math.min(.14, duration * .28)));
  const fall = 1 - smooth((age - duration * .42) / (duration * .58));
  const armWeight = rise * fall * ([.28, .62, 1][levelIndex] ?? 1);
  const active = age < duration;
  state = { ...state, age: active ? age : duration, active };
  const hunchWeight = !state.fullOpen && state.level === 'heavy' && state.torso && state.variant === 2 ? rise * fall : 0;
  return { state, travelDelta, armWeight: active ? armWeight : 0,
    hunchWeight: active ? hunchWeight : 0, variant: state.variant, active };
}
