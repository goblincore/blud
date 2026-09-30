// Single-shot launcher timing. Metres/degrees/seconds; no renderer dependency.
export const LAUNCHER = {
  fireLeadSec: 0.34,
  reloadSec: 1.85,
  unlockSec: 0.18,
  openSec: 0.48,
  extractSec: 0.50,
  ejectSec: 0.61,
  carrySec: 0.86,
  stageSec: 1.22,
  seatSec: 1.43,
  closeStartSec: 1.53,
  closeSec: 1.65,
  openRad: 55 * Math.PI / 180,
  roundLengthM: 0.094,
  caseLengthM: 0.072,
  stageGapM: 0.012,
} as const;

export interface LauncherState {
  loaded: boolean;
  spent: boolean;
  fireAge: number;
  reloadAge: number;
  shots: number;
}
export function makeLauncherState(): LauncherState {
  return { loaded: true, spent: false, fireAge: Infinity, reloadAge: Infinity, shots: 0 };
}
export function launcherReady(s: LauncherState): boolean {
  return s.loaded && s.reloadAge === Infinity && s.fireAge >= LAUNCHER.fireLeadSec;
}
/** Identity on refusal lets callers emit shot effects only for accepted input. */
export function fireLauncher(s: LauncherState): LauncherState {
  return launcherReady(s)
    ? { ...s, loaded: false, spent: true, fireAge: 0, shots: s.shots + 1 }
    : s;
}
export function reloadLauncher(s: LauncherState): LauncherState {
  if (s.reloadAge !== Infinity || s.fireAge < LAUNCHER.fireLeadSec) return s;
  return { ...s, loaded: false, reloadAge: 0 };
}
/** Spend the remainder across fire -> reload -> ready, including a slow frame. */
export function stepLauncher(s: LauncherState, dt: number): LauncherState {
  if (!(dt > 0) || !Number.isFinite(dt)) return s;
  const fireAge = s.fireAge + dt;
  let reloadAge = s.reloadAge;
  if (reloadAge !== Infinity) reloadAge += dt;
  else if (!s.loaded && fireAge >= LAUNCHER.fireLeadSec) {
    reloadAge = fireAge - LAUNCHER.fireLeadSec;
  }
  if (reloadAge >= LAUNCHER.reloadSec && reloadAge !== Infinity) {
    return { ...s, fireAge, reloadAge: Infinity, loaded: true, spent: false };
  }
  return { ...s, fireAge, reloadAge };
}

export type LauncherBeat = 'ready' | 'fire' | 'unlock' | 'break' | 'extract' | 'eject' | 'fetch' | 'carry' | 'insert' | 'close' | 'settle';
export function launcherBeat(s: LauncherState): LauncherBeat {
  const t = s.reloadAge;
  if (t === Infinity) return s.loaded ? 'ready' : 'fire';
  if (t < LAUNCHER.unlockSec) return 'unlock';
  if (t < LAUNCHER.openSec) return 'break';
  if (t < LAUNCHER.ejectSec) return 'extract';
  if (t < 0.72) return 'eject';
  if (t < LAUNCHER.carrySec) return 'fetch';
  if (t < LAUNCHER.stageSec) return 'carry';
  if (t < LAUNCHER.seatSec) return 'insert';
  if (t < LAUNCHER.closeSec) return 'close';
  return 'settle';
}
export function launcherSmooth(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}
export interface LauncherPose { pitch: number; yaw: number; roll: number; dx: number; dy: number; dz: number; hinge: number }
const REST: LauncherPose = { pitch: 0, yaw: 0, roll: 0, dx: 0, dy: 0, dz: 0, hinge: 0 };
// The model is yawed PI: positive root X lifts its muzzle. Present sideways
// and pitch up BEFORE opening so the moving barrel stays in frame, and its
// rear mouth separates visibly from the standing breech.
const KEYS = [
  { t: 0, ...REST },
  { t: LAUNCHER.unlockSec, pitch: 8, yaw: 10, roll: -12, dx: .015, dy: -.012, dz: -.020, hinge: 0 },
  { t: LAUNCHER.openSec, pitch: 15, yaw: 40, roll: -25, dx: .040, dy: -.030, dz: -.055, hinge: 1 },
  { t: LAUNCHER.seatSec, pitch: 15, yaw: 40, roll: -25, dx: .040, dy: -.030, dz: -.055, hinge: 1 },
  { t: LAUNCHER.closeStartSec, pitch: 14, yaw: 38, roll: -23, dx: .037, dy: -.028, dz: -.050, hinge: 1 },
  { t: LAUNCHER.closeSec, pitch: 2, yaw: 3, roll: -2, dx: .004, dy: 0.007, dz: -0.005, hinge: 0 },
  { t: LAUNCHER.reloadSec, ...REST },
] as const;
export function launcherReloadPose(t: number): LauncherPose {
  if (!Number.isFinite(t) || t <= 0) return { ...REST };
  for (let i = 1; i < KEYS.length; i++) {
    const a = KEYS[i - 1]!, b = KEYS[i]!;
    if (t <= b.t) {
      const u = launcherSmooth(a.t, b.t, t);
      const mix = (x: number, y: number) => x + (y - x) * u;
      return { pitch: mix(a.pitch, b.pitch), yaw: mix(a.yaw, b.yaw), roll: mix(a.roll, b.roll), dx: mix(a.dx, b.dx), dy: mix(a.dy, b.dy), dz: mix(a.dz, b.dz), hinge: mix(a.hinge, b.hinge) };
    }
  }
  return { ...REST };
}
/** Sharp rearward impulse, short counter-settle; fully zero after 340 ms. */
export function launcherRecoil(t: number): LauncherPose {
  if (!Number.isFinite(t) || t < 0 || t >= LAUNCHER.fireLeadSec) return { ...REST };
  const rise = launcherSmooth(0, 0.045, t);
  const fall = 1 - launcherSmooth(0.045, LAUNCHER.fireLeadSec, t);
  const k = rise * fall;
  return { pitch: 9 * k, yaw: 0, roll: 1.8 * k, dx: 0, dy: -0.010 * k, dz: 0.067 * k, hinge: 0 };
}

export interface LauncherCartridge {
  seated: boolean;
  /** Offset toward the rear along the live bore from the seated centre. */
  extractM: number;
  carry: number | null;
  insert: number | null;
  /** Displacement from fully extracted centre, in bore-out/side/up basis. */
  eject: { out: number; side: number; up: number; spin: number } | null;
}
export function launcherCartridge(t: number, spent: boolean): LauncherCartridge {
  const length = spent ? LAUNCHER.caseLengthM : LAUNCHER.roundLengthM;
  const extractM = launcherSmooth(LAUNCHER.extractSec, LAUNCHER.ejectSec, t) * length;
  const dt = t - LAUNCHER.ejectSec;
  return {
    seated: t < LAUNCHER.ejectSec || t >= LAUNCHER.seatSec,
    extractM,
    carry: t >= LAUNCHER.carrySec && t < LAUNCHER.stageSec ? launcherSmooth(LAUNCHER.carrySec, LAUNCHER.stageSec, t) : null,
    insert: t >= LAUNCHER.stageSec && t < LAUNCHER.seatSec ? launcherSmooth(LAUNCHER.stageSec, LAUNCHER.seatSec, t) : null,
    eject: dt >= 0 && dt < 0.52 ? { out: dt * 0.85, side: dt * 0.48, up: dt * 1.55 - 3.2 * dt * dt, spin: dt * 9 } : null,
  };
}
export type LauncherV3 = readonly [number, number, number];
export function launcherMix(a: LauncherV3, b: LauncherV3, u: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
/** Keys use live locator positions, so the hand stays attached when pose/FOV changes. */
export function launcherSupportHand(t: number, fore: LauncherV3, stage: LauncherV3, seat: LauncherV3): LauncherV3 {
  const fetch: LauncherV3 = [fore[0] - 0.10, fore[1] - 0.19, fore[2] + 0.15];
  const keys = [
    // Keep the support grip on the moving forestock through break/extraction.
    { t: 0, p: fore }, { t: LAUNCHER.ejectSec, p: fore },
    { t: LAUNCHER.carrySec, p: fetch },
    { t: LAUNCHER.stageSec, p: stage }, { t: LAUNCHER.seatSec, p: seat },
    { t: LAUNCHER.closeStartSec, p: fore }, { t: LAUNCHER.reloadSec, p: fore },
  ];
  if (!Number.isFinite(t) || t <= 0) return fore;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!;
    if (t <= b.t) return launcherMix(a.p, b.p, launcherSmooth(a.t, b.t, t));
  }
  return fore;
}
