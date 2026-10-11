// src/lab/sdf-zombie/webgpu/emergence-timeline.ts
//
// THE SCREEN EMERGENCE's cue curves (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, section 5): from a time
// `t` in seconds, the screen pass's eight parameters and which shot we are in. Authored keys with easing, no simulation, no renderer.
// The page's clock is the only source of `t`; everything here is a pure function of it, so a scrub and a playback show the same frame.

export type Ease = 'linear' | 'smooth';

/** Every parameter runs 0..1. `push`: how far the egg has pushed out through the glass. `thin`: how thin and translucent the sheet is.
 *  `lipBow`: the bezel's lip bowing outward (and staying slightly warped after the heal). `tear`: how far the tear has opened. `slump`: the egg
 *  leaving the sac and falling to the desk. `heal`: the sac sucking back into the frame. `ripple`: the travelling ripple on the glass.
 *  `glow`: the egg's light. */
export interface EmergenceParams { ripple: number; push: number; thin: number; lipBow: number; tear: number; slump: number; heal: number; glow: number }
export type ParamName = keyof EmergenceParams;

/** A key: the value at time `t`. `ease` shapes the segment ENDING at this key (default linear). */
export interface Key { t: number; v: number; ease?: Ease }
export type Curves = Readonly<Record<ParamName, readonly Key[]>>;

export type ShotId = 'glass-gives' | 'push' | 'crowning' | 'out' | 'settle';
export interface Shot { id: ShotId; start: number; end: number }

export const DURATION = 14.5;

/** The draft's shots 3 to 7 (spec section 5). Boundaries are where the camera presets cut. */
export const SHOTS: readonly Shot[] = [
  { id: 'glass-gives', start: 0, end: 2.5 },
  { id: 'push', start: 2.5, end: 6.5 },
  { id: 'crowning', start: 6.5, end: 9 },
  { id: 'out', start: 9, end: 11.5 },
  { id: 'settle', start: 11.5, end: DURATION },
];

/** First-round values; the look rounds tune these (they are the cheap knobs). */
export const CURVES: Curves = {
  ripple: [{ t: 0, v: 0 }, { t: 1.2, v: 1, ease: 'smooth' }, { t: 2.5, v: 0.6, ease: 'smooth' }, { t: 6.5, v: 0.25, ease: 'smooth' }, { t: 9, v: 0, ease: 'smooth' }, { t: DURATION, v: 0 }],
  push: [{ t: 0, v: 0 }, { t: 2.5, v: 0.12, ease: 'smooth' }, { t: 6.5, v: 1, ease: 'smooth' }, { t: DURATION, v: 1 }],
  thin: [{ t: 0, v: 0 }, { t: 2.5, v: 0 }, { t: 3.5, v: 0.15, ease: 'smooth' }, { t: 6.5, v: 1, ease: 'smooth' }, { t: 11.5, v: 1 }, { t: DURATION, v: 0.2, ease: 'smooth' }],
  lipBow: [{ t: 0, v: 0 }, { t: 2.5, v: 0 }, { t: 6.5, v: 1, ease: 'smooth' }, { t: 11.5, v: 1 }, { t: DURATION, v: 0.25, ease: 'smooth' }],
  tear: [{ t: 0, v: 0 }, { t: 6.5, v: 0 }, { t: 7, v: 0.15, ease: 'smooth' }, { t: 8, v: 0.6, ease: 'smooth' }, { t: 9, v: 1, ease: 'smooth' }, { t: 11.5, v: 1 }, { t: 13.5, v: 0, ease: 'smooth' }, { t: DURATION, v: 0 }],
  slump: [{ t: 0, v: 0 }, { t: 9, v: 0 }, { t: 11.5, v: 1, ease: 'smooth' }, { t: DURATION, v: 1 }],
  heal: [{ t: 0, v: 0 }, { t: 11.5, v: 0 }, { t: DURATION, v: 1, ease: 'smooth' }],
  glow: [{ t: 0, v: 0.2 }, { t: 2.5, v: 0.3, ease: 'smooth' }, { t: 6.5, v: 1, ease: 'smooth' }, { t: DURATION, v: 1 }],
};

const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** The curve's value at `t`: its first key before the start, its last after the end, eased between. */
export function evalCurve(keys: readonly Key[], t: number): number {
  if (t <= keys[0]!.t) return keys[0]!.v;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v;
  let i = 1;
  while (keys[i]!.t < t) i++;
  const a = keys[i - 1]!, b = keys[i]!;
  const u = (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * (b.ease === 'smooth' ? smoothstep(u) : u);
}

export function paramsAt(t: number, curves: Curves = CURVES): EmergenceParams {
  const out = {} as EmergenceParams;
  for (const n of Object.keys(curves) as ParamName[]) out[n] = evalCurve(curves[n], t);
  return out;
}

/** The shot `t` falls in (the first before 0, the last after the end). */
export function shotAt(t: number): Shot {
  for (const s of SHOTS) if (t < s.end) return s;
  return SHOTS[SHOTS.length - 1]!;
}
