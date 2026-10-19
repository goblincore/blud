// src/lab/sdf-zombie/expression.ts
//
// THE EXPRESSION LAYER's pure half (spec docs/superpowers/specs/2026-10-13-goblin-expressions-design.md, plan
// docs/superpowers/plans/2026-10-13-goblin-expressions.md): keyed clips of named face CHANNELS, and the one function that turns
// channels into what a mechanism needs.
//
// THREE OUTPUTS (Task 12 added the third): a jaw gape (rad), overrides on the authored face sheet, and the per-prim MORPH weights
// (morph.ts): the channels themselves, clamped, which rig-bind's applyRig uses to move every prim that declares a `morph=`. The
// `squash` weight (Task 18) rides the same record: applyRig squashes the whole rigid head by it (squash.ts).
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

export const CHANNEL_NAMES = ['gape', 'smile', 'browDown', 'lipCurl', 'lid', 'squint', 'squash', 'furrow', 'sneer'] as const;
export type ChannelName = typeof CHANNEL_NAMES[number];

/** Every channel, resolved. Ranges: gape 0..1; smile -1..1 (negative frowns); browDown -1..1 (negative raises); lipCurl 0..1;
 *  lid 0..1 (1 is shut: the BLINK); squint 0..1 (Task 15: the cheeks rise into the lower lids and the eyes narrow, what makes a
 *  smile a smile and not an open mouth); squash -1..1 (Task 18: the WHOLE head wider and shorter on +, narrower and taller on -,
 *  the cartoon's squash and stretch; squash.ts, applied by rig-bind's applyRig through the morph weights); furrow 0..1 (Task 19:
 *  the brows knit inward into a furrow, painted creases between them and the inner-brow bulges, the evil grin's and scowl's);
 *  sneer 0..1 (Task 20: the evil grin's mouth on top of a smile, the upper lip curled off the fangs and the corners hiked, lopsided;
 *  geometry only, the character's `morph=sneer:` words, never the sheet). */
export type Channels = Record<ChannelName, number>;

export const REST_CHANNELS: Readonly<Channels> = {
  gape: 0, smile: 0, browDown: 0, lipCurl: 0, lid: 0, squint: 0, squash: 0, furrow: 0, sneer: 0,
};

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
  // THE EYES (Task 15; owner: "smiling involves also movement of the eye area where the eyes would have to get smaller with the
  // cheeks and eyelids closing more"). All optional: a tuning without them leaves the eyes and the brow's height alone.
  /** eyeLid (both lids, evenly) per unit squint. The blink's `lid` still wins when it is larger. */
  squintLid?: number;
  /** eyeCheek (the lower lid pushed up into an arch) per unit squint. */
  squintCheek?: number;
  /** Fraction of eyeSize removed per unit squint. */
  squintEyeSize?: number;
  /** browDrop (sheet uv, down) per unit squint: the squint pulls the brow toward the eye. */
  squintBrow?: number;
  /** Degrees added to eyeTilt per unit squint (positive lifts the outer corners). */
  squintTilt?: number;
  /** browDrop (sheet uv) per unit browDown, both signs: positive browDown slides the brow down, negative lifts it. */
  browShift?: number;
  /** Fraction of eyeSize ADDED per unit of NEGATIVE browDown (a raised brow opens the eye: surprise). */
  browRaiseEye?: number;
  /** eyeLidTop (the heavy, inward-slanted upper lid) per unit of POSITIVE browDown: a brow pressed down narrows the eye from
   *  above. This is what makes a squinting grin EVIL rather than friendly (the friendly smile's brows are not down). */
  browLidTop?: number;
  /** browFurrow (the painted creases between the brows, the inner brow ends pulled down to them) per unit furrow (Task 19). Optional:
   *  a tuning without it paints no furrow; the furrow's GEOMETRY is the character's own `morph=furrow:` words either way. */
  furrowSheet?: number;
  /** eyeLidTop per unit furrow, on top of browLidTop's (Task 20: knitted brows press the lid down too, so the evil grin's eyes are
   *  thinner than the grin's). Optional: absent, the furrow leaves the lid alone. */
  furrowLidTop?: number;
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

/** A blink schedule with no state (emergence in the Flat, plan Task 4: the shared goblin puppet blinks from the sequence clock, so a
 *  scrub or a replay lands the same lids): one blink per `period` seconds, its start jittered inside the first `jitter` of the period
 *  by a hash of the period's index, each one `dur` long (blinkLid's shape). The jitter keeps the starts at least 1 - jitter of a period
 *  apart, which is far more than a blink. */
export const BLINK_SCHEDULE = { period: 3.6, jitter: 0.6, dur: 0.18 } as const;

/** The k-th period's blink start (k >= 0), from a small integer hash in [0, 1). */
function blinkStartOf(k: number, s: typeof BLINK_SCHEDULE): number {
  let h = Math.imul(k + 0x9e37, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (k + s.jitter * (h / 4294967296)) * s.period;
}

/** Every scheduled blink start in [t0, t1). */
export function blinkStarts(t0: number, t1: number, s: typeof BLINK_SCHEDULE = BLINK_SCHEDULE): number[] {
  const out: number[] = [];
  for (let k = Math.max(0, Math.floor(t0 / s.period) - 1); k * s.period < t1; k++) {
    const b = blinkStartOf(k, s);
    if (b >= t0 && b < t1) out.push(b);
  }
  return out;
}

/** The scheduled blink's lid at time t (0 before 0, between blinks, and at each blink's ends). */
export function scheduledBlinkLid(t: number, s: typeof BLINK_SCHEDULE = BLINK_SCHEDULE): number {
  if (!(t > 0)) return 0;
  const k = Math.floor(t / s.period);
  return Math.max(blinkLid(t, blinkStartOf(k, s), s.dur), k > 0 ? blinkLid(t, blinkStartOf(k - 1, s), s.dur) : 0);
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
  const squint = clamp(channels.squint, 0, 1);
  const squash = clamp(channels.squash, -1, 1);
  const furrow = clamp(channels.furrow, 0, 1);
  const sneer = clamp(channels.sneer, 0, 1);
  const grin = Math.max(smile, 0);
  const raise = Math.max(-browDown, 0);
  // The eye params are only written when they move, so a rest frame (or a tuning without the Task 15 fields) hands back the
  // authored numbers exactly, not the same numbers through arithmetic.
  const squintLid = squint * (tuning.squintLid ?? 0);
  const eyeScale = (1 - squint * (tuning.squintEyeSize ?? 0)) * (1 + raise * (tuning.browRaiseEye ?? 0));
  const tilt = squint * (tuning.squintTilt ?? 0);
  const cheek = squint * (tuning.squintCheek ?? 0);
  const drop = squint * (tuning.squintBrow ?? 0) + browDown * (tuning.browShift ?? 0);
  const lidTop = Math.max(browDown, 0) * (tuning.browLidTop ?? 0) + furrow * (tuning.furrowLidTop ?? 0);
  const knit = furrow * (tuning.furrowSheet ?? 0);
  return {
    jawGape: gape * tuning.maxGape,
    morphs: { gape, smile, browDown, lipCurl, lid, squint, squash, furrow, sneer },
    sheet: {
      ...base,
      mouthCurve: base.mouthCurve - smile * tuning.smileCurve + lipCurl * tuning.curlCurve,
      mouthWidth: base.mouthWidth * (1 + grin * tuning.smileWiden) * (1 - lipCurl * tuning.curlNarrow),
      mouthOpen: Math.max(0, base.mouthOpen + gape * tuning.gapeMouthOpen + grin * tuning.smileMouthOpen),
      browAngle: base.browAngle + browDown * tuning.browAngle,
      browHeavy: clamp(base.browHeavy + browDown * tuning.browHeavy, 0, 1.2),
      eyeLid: Math.max(base.eyeLid, lid, squintLid),
      ...(eyeScale === 1 ? {} : { eyeSize: base.eyeSize * eyeScale }),
      ...(tilt === 0 ? {} : { eyeTilt: base.eyeTilt + tilt }),
      ...(cheek === 0 ? {} : { eyeCheek: clamp(base.eyeCheek + cheek, 0, 1) }),
      ...(drop === 0 ? {} : { browDrop: base.browDrop + drop }),
      ...(lidTop === 0 ? {} : { eyeLidTop: clamp(base.eyeLidTop + lidTop, 0, 1) }),
      ...(knit === 0 ? {} : { browFurrow: clamp(base.browFurrow + knit, 0, 1) }),
    },
  };
}

/** A string that changes when (and only when) a sheet param this layer animates moves by more than 0.005 (eyeSize: 0.0005): the lab
 *  regenerates the texture only when it does. */
export function sheetKey(s: FaceSheetParams): string {
  const q = (v: number) => Math.round(v * 200);
  // eyeSize is a small number (0.07): a finer quantum, 0.0005, so a squint's few-percent shrink is not lost.
  return [
    ...[s.mouthCurve, s.mouthWidth, s.mouthOpen, s.browAngle, s.browHeavy, s.eyeLid, s.eyeCheek, s.eyeLidTop, s.browDrop, s.eyeTilt,
      s.browFurrow].map(q),
    Math.round(s.eyeSize * 2000),
  ].join(',');
}
