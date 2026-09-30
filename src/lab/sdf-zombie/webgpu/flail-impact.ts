// src/lab/sdf-zombie/webgpu/flail-impact.ts
//
// THE FLAIL'S IMPACT FEEL (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §14.1, v1.5a).
// Pure and renderer-free: plain data and in-place steps, no allocation per frame.
//
// A landed strike (game-flail.ts) calls `contact(state, impactKick(side, head), …)`. From then on:
//   * the TIME channel (`timeScale`) is the game's single dt multiplier (game-main.ts `dt *= …`):
//     a hit-stop at FLAIL_IMPACT_FEEL.hitStopScale, then a step to the swing's slow scale easing back to
//     exactly 1 (smoothstep) over its slow time. It advances on the UNSCALED dt it is given;
//   * the VIEW channels (`stepImpact`, also on unscaled dt, so the player's own recoil does not freeze
//     with the world) are damped springs — the camera pitch kick with a small overshoot, a three-axis
//     judder (eye x/y in view metres, roll in radians) and the view-model rig kick — plus the FOV pinch,
//     an explicit attack/hold/release envelope so it lands on its base value exactly;
//   * `chainRelax` lets the chain's guide go for a moment of SIM time after the contact so it whips.
// A contact only changes spring VELOCITIES and restarts the FOV envelope from its current value, so a
// second hit during a recovery never pops a value.
export type ImpactSide = 'R' | 'L' | 'H';
type V3 = [number, number, number];

const DEG = Math.PI / 180;

export const FLAIL_IMPACT_FEEL = {
  /** Every effect scales by swing (spec §14.1): R and L 1.0, H 1.4; a head-region hit adds 20%. */
  sideScale: { R: 1, L: 1, H: 1.4 } as Record<ImpactSide, number>,
  headScale: 1.2,
  /** dt multiplier while a hit-stop runs: near-frozen, never 0. */
  hitStopScale: 0.08,
  /** The hit-stop (s): R/L 70 ms, H 100 ms (were 50/70). Head hits × headScale. */
  hitStopSec: { R: 0.07, L: 0.07, H: 0.10 } as Record<ImpactSide, number>,
  /** The slow tail after the hit-stop: the scale steps to `scale` and eases back to 1 over `sec`. */
  slow: { R: { scale: 0.4, sec: 0.3 }, L: { scale: 0.4, sec: 0.3 }, H: { scale: 0.35, sec: 0.4 } } as Record<ImpactSide, { scale: number; sec: number }>,
  /** Camera pitch kick (rad, peak) on a spring: ζ 0.55 overshoots ~12% and settles in ~0.4 s. */
  pitch: { kickRad: 0.045, hz: 4, zeta: 0.55, settleSec: 0.42 },
  /** The judder: eye offset (view metres, peak) and roll (rad, peak). Each axis a lightly damped spring
   *  (23 Hz like player-hit-feedback's shake; y and roll detuned so the axes decorrelate), all decaying at
   *  `decayRate` 1/s — below 10% by 0.35 s, below 1% by `settleSec`. */
  shake: { amp: 0.012, rollRad: 0.012, hz: [23, 19, 17] as const, decayRate: 17, settleSec: 0.3 },
  /** The kick's direction per swing: [eye x, eye y] a unit vector (so `amp` is the offset's size), then the roll's sign. */
  shakeDir: { R: [-0.857, 0.514, 1], L: [0.857, 0.514, -1], H: [0.287, -0.958, 1] } as Record<ImpactSide, V3>,
  /** FOV pinch (deg, peak): in over attackSec, held holdSec, back over releaseSec — exactly 0 after. */
  fov: { punchDeg: 3, attackSec: 0.05, holdSec: 0.02, releaseSec: 0.2 },
  /** The flail rig's kick (view space, peak at scale 1): back (+Z), up, pitched up, rolled. ζ 0.45 at 7 Hz:
   *  two overshoots (21%, then 4%), below 1% of the peak by settleSec. */
  rig: { back: 0.10, up: 0.04, pitchDeg: 12, rollDeg: 5, hz: 7, zeta: 0.45, settleSec: 0.3 },
  /** The rig roll's sign per swing. */
  rigRoll: { R: 1, L: -1, H: 1 } as Record<ImpactSide, number>,
  /** The chain's guide after a contact: this multiplier for chainRelaxSec of SIM time (it snaps taut and whips). */
  chainRelaxSec: 0.05,
  chainRelaxGuide: 0,
  /** The zombie takes it (game-flail.ts): the blast reaction's gain × this (the shove is unit-normalised by
   *  blast(), so its size is the reaction gain), and a head hit's rig kick at the head (m, rig-bind impulseAt
   *  is a displacement of one Verlet point — IMPULSE.blast is 0.18). */
  zombie: { reactionGain: 1.3, headSnapM: 0.1 },
} as const;
const F = FLAIL_IMPACT_FEEL;

export interface ImpactKick {
  side: ImpactSide;
  /** sideScale × (head ? headScale : 1). */
  scale: number;
  hitStopSec: number;
  slowScale: number;
  slowSec: number;
  pitchKick: number;
  shakeAmp: number;
  rollAmp: number;
  fovPunchDeg: number;
  /** The rig kick's multiplier on FLAIL_IMPACT_FEEL.rig (1 = 0.10 m back …). */
  rigKick: number;
}

/** What one contact does, for a swing side and a head-region flag. */
export function impactKick(side: ImpactSide, head: boolean): ImpactKick {
  const scale = F.sideScale[side] * (head ? F.headScale : 1);
  const tScale = head ? F.headScale : 1;
  return {
    side, scale,
    hitStopSec: F.hitStopSec[side] * tScale,
    slowScale: F.slow[side].scale,
    slowSec: F.slow[side].sec,
    pitchKick: F.pitch.kickRad * scale,
    shakeAmp: F.shake.amp * scale,
    rollAmp: F.shake.rollRad * scale,
    fovPunchDeg: F.fov.punchDeg * scale,
    rigKick: scale,
  };
}

export interface Spring { x: number; v: number }
export const makeSpring = (): Spring => ({ x: 0, v: 0 });

/** Advance a damped spring toward `target` by dt. In place. Underdamped (ζ < 1, every spring here) takes
 *  the EXACT closed-form step — stable and accurate at any dt, so a 0.1 s hitch or a 60 Hz frame land on
 *  the same curve (a sub-stepped semi-implicit Euler at ~45 steps a cycle read the pitch peak 13% low).
 *  ζ ≥ 1 falls back to sub-stepped semi-implicit Euler (≥ 40 steps per cycle, at most 256). */
export function spring(s: Spring, target: number, hz: number, zeta: number, dt: number): void {
  if (!(dt > 0)) return;
  const w = 2 * Math.PI * hz;
  let y = s.x - target, v = s.v;
  if (zeta < 1) {
    const wd = w * Math.sqrt(1 - zeta * zeta), e = Math.exp(-zeta * w * dt);
    const c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
    const y1 = e * (y * c + ((v + zeta * w * y) / wd) * sn);
    const v1 = e * (v * c - ((zeta * w * v + w * w * y) / wd) * sn);
    y = y1; v = v1;
  } else {
    const n = Math.min(256, Math.max(1, Math.ceil(dt * hz * 40)));
    const h = dt / n;
    for (let i = 0; i < n; i++) { v += (-w * w * y - 2 * zeta * w * v) * h; y += v * h; }
  }
  // Snap a spent spring to rest exactly, so "back at rest" is a value, not a limit.
  if (Math.abs(y) < 1e-7 && Math.abs(v) < 1e-6) { y = 0; v = 0; }
  s.x = target + y; s.v = v;
}

/** The peak displacement per unit launch velocity of an underdamped spring at rest (continuous time). */
function impulsePeak(hz: number, zeta: number): number {
  const w = 2 * Math.PI * hz, wd = w * Math.sqrt(1 - zeta * zeta);
  const tp = Math.atan2(wd, zeta * w) / wd;
  return Math.exp(-zeta * w * tp) * Math.sin(wd * tp) / wd;
}
const shakeZeta = (hz: number) => F.shake.decayRate / (2 * Math.PI * hz);
const PITCH_PEAK = impulsePeak(F.pitch.hz, F.pitch.zeta);
const RIG_PEAK = impulsePeak(F.rig.hz, F.rig.zeta);
const SHAKE_PEAK = F.shake.hz.map(hz => impulsePeak(hz, shakeZeta(hz)));

export interface ImpactState {
  // time channel
  stopLeft: number;
  slowOn: boolean;
  slowT: number;
  slowScale: number;
  slowSec: number;
  // view channels
  pitch: Spring;
  shake: [Spring, Spring, Spring];
  rig: Spring;
  rigRoll: Spring;
  fovOn: boolean;
  fovT: number;
  fovFrom: number;
  fovPeak: number;
  fovNow: number;
  // chain
  relaxLeft: number;
}

export function makeImpactState(): ImpactState {
  return {
    stopLeft: 0, slowOn: false, slowT: 0, slowScale: 1, slowSec: 0,
    pitch: makeSpring(), shake: [makeSpring(), makeSpring(), makeSpring()], rig: makeSpring(), rigRoll: makeSpring(),
    fovOn: false, fovT: 0, fovFrom: 0, fovPeak: 0, fovNow: 0,
    relaxLeft: 0,
  };
}

/** A landed strike. `time` arms the hit-stop and slow tail (gates turn it off for deterministic frame
 *  counts); `view` kicks the camera, judder, FOV, rig and chain (gates that measure pixels turn it off). */
export function contact(s: ImpactState, k: ImpactKick, on: { time: boolean; view: boolean }): void {
  if (on.time) {
    s.stopLeft = k.hitStopSec;
    s.slowOn = true; s.slowT = 0; s.slowScale = k.slowScale; s.slowSec = k.slowSec;
  }
  if (!on.view) return;
  s.pitch.v = k.pitchKick / PITCH_PEAK;
  const d = F.shakeDir[k.side];
  s.shake[0].v = d[0] * k.shakeAmp / SHAKE_PEAK[0]!;
  s.shake[1].v = d[1] * k.shakeAmp / SHAKE_PEAK[1]!;
  s.shake[2].v = d[2] * k.rollAmp / SHAKE_PEAK[2]!;
  s.rig.v = k.rigKick / RIG_PEAK;
  s.rigRoll.v = F.rigRoll[k.side] * k.rigKick / RIG_PEAK;
  s.fovOn = true; s.fovT = 0; s.fovFrom = s.fovNow; s.fovPeak = -k.fovPunchDeg;
  s.relaxLeft = F.chainRelaxSec;
}

const smooth = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };

/** This frame's dt multiplier; advances the time channel on the UNSCALED dt. Never below hitStopScale. */
export function timeScale(s: ImpactState, dt: number): number {
  const d = Math.max(0, dt);
  if (s.stopLeft > 1e-9) { s.stopLeft -= d; return F.hitStopScale; }
  s.stopLeft = 0;
  if (!s.slowOn) return 1;
  if (s.slowT >= s.slowSec - 1e-9) { s.slowOn = false; return 1; }
  const v = s.slowScale + (1 - s.slowScale) * smooth(s.slowT / s.slowSec);
  s.slowT += d;
  return Math.max(F.hitStopScale, v);
}

function fovAt(s: ImpactState): number {
  const { attackSec: a, holdSec: h, releaseSec: r } = F.fov;
  const t = s.fovT;
  if (t < a) return s.fovFrom + (s.fovPeak - s.fovFrom) * smooth(t / a);
  if (t < a + h) return s.fovPeak;
  if (t < a + h + r) return s.fovPeak * (1 - smooth((t - a - h) / r));
  return 0;
}

/** Advance the view channels by the UNSCALED dt. */
export function stepImpact(s: ImpactState, dt: number): void {
  const d = Math.max(0, dt);
  spring(s.pitch, 0, F.pitch.hz, F.pitch.zeta, d);
  for (let i = 0; i < 3; i++) spring(s.shake[i]!, 0, F.shake.hz[i]!, shakeZeta(F.shake.hz[i]!), d);
  spring(s.rig, 0, F.rig.hz, F.rig.zeta, d);
  spring(s.rigRoll, 0, F.rig.hz, F.rig.zeta, d);
  if (s.fovOn) {
    s.fovT += d;
    s.fovNow = fovAt(s);
    if (s.fovNow === 0 && s.fovT >= F.fov.attackSec) s.fovOn = false;
  }
}

export interface ImpactOutputs {
  /** Added to the camera's pitch (rad, up). */
  cameraPitch: number;
  /** [eye x (view right, m), eye y (up, m), roll (rad)]. */
  shake: V3;
  /** Added to the FOV (deg; negative = pinch). */
  fovDeg: number;
  /** Composed onto the flail rig (view space): position (m) and Euler XYZ (rad). */
  rig: { pos: V3; rot: V3 };
}

export function impactOutputs(s: ImpactState): ImpactOutputs {
  const r = s.rig.x, rr = s.rigRoll.x;
  return {
    cameraPitch: s.pitch.x,
    shake: [s.shake[0].x, s.shake[1].x, s.shake[2].x],
    fovDeg: s.fovNow,
    rig: { pos: [0, F.rig.up * r, F.rig.back * r], rot: [F.rig.pitchDeg * DEG * r, 0, F.rig.rollDeg * DEG * rr] },
  };
}

/** The chain guide's multiplier this frame; counts down on the chain's own (SIM) dt. */
export function chainRelax(s: ImpactState, simDt: number): number {
  if (s.relaxLeft > 1e-9) { s.relaxLeft -= Math.max(0, simDt); return F.chainRelaxGuide; }
  s.relaxLeft = 0;
  return 1;
}

/** Zero every view channel at once (setImpactFx(false)). */
export function clearView(s: ImpactState): void {
  for (const sp of [s.pitch, ...s.shake, s.rig, s.rigRoll]) { sp.x = 0; sp.v = 0; }
  s.fovOn = false; s.fovT = 0; s.fovFrom = 0; s.fovPeak = 0; s.fovNow = 0;
  s.relaxLeft = 0;
}

/** Zero the time channel (setHitStop(false)). */
export function clearTime(s: ImpactState): void {
  s.stopLeft = 0; s.slowOn = false; s.slowT = 0;
}
