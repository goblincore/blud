// src/lab/sdf-zombie/expression.ts
//
// THE EXPRESSION LAYER's pure half (spec docs/superpowers/specs/2026-10-13-goblin-expressions-design.md, plan
// docs/superpowers/plans/2026-10-13-goblin-expressions.md): keyed clips of named face CHANNELS, and the one function that turns
// channels into what a mechanism needs.
//
// THREE OUTPUTS (Task 12 added the third): a jaw gape (rad), overrides on the authored face sheet, and the per-prim MORPH weights
// (morph.ts): the channels themselves, clamped, which rig-bind's applyRig uses to move every prim that declares a `morph=`.
//
// A CHANNEL describes the face, never the mechanism: `gape` is how open the mouth is, `smile` is how far the corners are pulled up,
// and so on. `actuate` is where a channel becomes a jaw angle, a sheet parameter or a morph weight, so a mechanism is one more
// output of that function and clips never change (the per-prim morphs, approach C, arrived exactly that way).
//
// A CLIP has the same shape as pose.ts's PoseClip: timed keys, a channel a key does not mention takes its rest value (0), one key
// holds, `ease: 'smooth'` eases INTO a key from the previous one. Time is passed in; nothing here reads a clock (determinism, and
// the Rust port).
//
// Pure: plain data in, plain data out, no renderer. Sheet sign convention (measured, see the warning in blob-face-sheet.ts): a
// POSITIVE mouthCurve puts the mouth's centre higher than its corners, a frown; NEGATIVE is a smile. `smile` here is
// the face's own sense (positive smiles), so `actuate` SUBTRACTS it from mouthCurve.
import type { FaceSheetParams } from './blob-face-sheet';

export const CHANNEL_NAMES = ['gape', 'smile', 'browDown', 'lipCurl', 'lid'] as const;
export type ChannelName = typeof CHANNEL_NAMES[number];

/** Every channel, resolved. Ranges: gape 0..1; smile -1..1 (negative frowns); browDown -1..1 (negative raises); lipCurl 0..1;
 *  lid 0..1 (1 is shut). */
export type Channels = Record<ChannelName, number>;

export const REST_CHANNELS: Readonly<Channels> = { gape: 0, smile: 0, browDown: 0, lipCurl: 0, lid: 0 };

export interface ExpressionKey {
  /** Seconds from the clip's start. */
  t: number;
  /** Channels this key sets; any it omits take their rest value 0. */
  channels: Partial<Channels>;
  /** Easing INTO this key from the previous one. Default 'linear'. */
  ease?: 'linear' | 'smooth';
}

export interface ExpressionClip { name: string; keys: ExpressionKey[] }

/** How channels map onto the two outputs. All data: the goblin's numbers live in characters/goblin-expressions.ts. */
export interface ExpressionTuning {
  /** Jaw gape in radians at gape = 1 (jaw.ts clamps at JAW_MAX_GAPE). */
  maxGape: number;
  /** mouthCurve change per unit smile (the sign is applied inside actuate: a positive smile lowers mouthCurve). */
  smileCurve: number;
  /** Fraction of mouthWidth added at smile = 1 (smiles widen; frowns do not narrow, lipCurl does that). */
  smileWiden: number;
  /** mouthCurve change per unit lipCurl (positive = frown arc). */
  curlCurve: number;
  /** Fraction of mouthWidth removed at lipCurl = 1. */
  curlNarrow: number;
  /** Degrees added to browAngle per unit browDown (positive angles the inner ends down, a scowl). */
  browAngle: number;
  /** Added to browHeavy per unit browDown. */
  browHeavy: number;
  /** mouthOpen (the painted mouth's thickness) added per unit gape. Negative thins the painted mouth as the real gap opens. */
  gapeMouthOpen: number;
  /** mouthOpen added per unit of positive smile. */
  smileMouthOpen: number;
}

export interface Actuation {
  /** Jaw gape in radians, for rig.jawGape / MotionConfig.jawGape. */
  jawGape: number;
  /** The authored sheet with this frame's overrides. Never mutates its input. */
  sheet: FaceSheetParams;
  /** Per-prim morph weights (morph.ts), for rig.morphs: every channel, clamped to its range. All 0 at rest, which moves nothing. */
  morphs: Channels;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

function bracket(clip: ExpressionClip, t: number): { a: ExpressionKey; b: ExpressionKey; f: number } {
  const keys = clip.keys;
  if (keys.length === 0) throw new Error(`expression clip "${clip.name}" has no keys`);
  if (t <= keys[0]!.t) return { a: keys[0]!, b: keys[0]!, f: 0 };
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return { a: last, b: last, f: 0 };
  let i = 0;
  while (keys[i + 1]!.t <= t) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const raw = (t - a.t) / (b.t - a.t);
  return { a, b, f: b.ease === 'smooth' ? smooth01(raw) : raw };
}

/** The channel set of a clip at time t (seconds). One key, or t outside the clip, holds an end. */
export function expressionAt(clip: ExpressionClip, t: number): Channels {
  const { a, b, f } = bracket(clip, t);
  const out = { ...REST_CHANNELS };
  for (const name of CHANNEL_NAMES) out[name] = lerp(a.channels[name] ?? 0, b.channels[name] ?? 0, f);
  return out;
}

/** A blink's lid value at time t: 0 outside [start, start + dur], shut at 40% of the way through, open again by the end. */
export function blinkLid(t: number, start: number, dur = 0.16): number {
  const u = (t - start) / dur;
  if (u <= 0 || u >= 1) return 0;
  return u < 0.4 ? u / 0.4 : (1 - u) / 0.6;
}

/** Overlay a blink on any expression: the lid is the larger of the two, everything else is untouched. */
export function withBlink(base: Channels, blink: number): Channels {
  return { ...base, lid: Math.max(base.lid, blink) };
}

/** Channels to a jaw gape and a sheet. Channels are clamped to their ranges first, so a bad clip cannot drive the face off its rig. */
export function actuate(channels: Channels, base: FaceSheetParams, tuning: ExpressionTuning): Actuation {
  const gape = clamp(channels.gape, 0, 1);
  const smile = clamp(channels.smile, -1, 1);
  const browDown = clamp(channels.browDown, -1, 1);
  const lipCurl = clamp(channels.lipCurl, 0, 1);
  const lid = clamp(channels.lid, 0, 1);
  const grin = Math.max(smile, 0);
  return {
    jawGape: gape * tuning.maxGape,
    morphs: { gape, smile, browDown, lipCurl, lid },
    sheet: {
      ...base,
      mouthCurve: base.mouthCurve - smile * tuning.smileCurve + lipCurl * tuning.curlCurve,
      mouthWidth: base.mouthWidth * (1 + grin * tuning.smileWiden) * (1 - lipCurl * tuning.curlNarrow),
      mouthOpen: Math.max(0, base.mouthOpen + gape * tuning.gapeMouthOpen + grin * tuning.smileMouthOpen),
      browAngle: base.browAngle + browDown * tuning.browAngle,
      browHeavy: clamp(base.browHeavy + browDown * tuning.browHeavy, 0, 1.2),
      eyeLid: Math.max(base.eyeLid, lid),
    },
  };
}

/** A string that changes when (and only when) a sheet param this layer animates moves by more than 0.005: the lab regenerates the
 *  texture only when it does. */
export function sheetKey(s: FaceSheetParams): string {
  const q = (v: number) => Math.round(v * 200);
  return [s.mouthCurve, s.mouthWidth, s.mouthOpen, s.browAngle, s.browHeavy, s.eyeLid].map(q).join(',');
}
