// src/lab/sdf-zombie/morph.ts
//
// PER-PRIM MORPHS (goblin expressions Task 12, a minimal approach C; spec docs/superpowers/specs/2026-10-13-goblin-expressions-
// design.md, "Amendment (2026-10-15)"). A prim may carry a delta per face CHANNEL (expression.ts CHANNEL_NAMES) that a channel
// weight scales linearly: move both ends, move the far end, add to the bend, scale the radius, scale wide/tall/deep. The jaw's
// rotation and the painted sheet cannot widen a chin or curl a mouth corner up; moving the prims can.
//
// Pure: plain data in, plain data out, no renderer. rig-bind.ts applyRig is the one consumer that moves prims; blob-parse.ts
// parses the `.blob` word (`morph=<channel>:<terms>`) through parseMorph; mirror.ts reflects the second copy through mirrorMorph.
//
// THE NEUTRAL GUARANTEE: morphOf returns null unless some morph has a nonzero finite weight, and a null result means the caller
// takes its pre-morph path untouched (no arithmetic at all), so every body without weights renders and packs bit-identically.
import { CHANNEL_NAMES, type ChannelName } from './expression';
import type { Vec3 } from './types';

/** One channel's delta on one prim, at weight 1. Absent terms do nothing. */
export interface PrimMorph {
  channel: ChannelName;
  /** Added to BOTH endpoints (m, the rest pose's world axes, like `offset=`). */
  move?: Vec3;
  /** Added to the far endpoint `b` only, on top of `move` (m). */
  tip?: Vec3;
  /** Added to the Bezier control displacement (m); an unbent prim counts as bend 0. */
  bend?: Vec3;
  /** Radius factor at weight 1: r (and r2) times 1 + w (k - 1). */
  radius?: number;
  /** wide/tall/deep factors at weight 1: each times 1 + w (s - 1). */
  scale?: Vec3;
}

/** Channel weights, as `actuate` hands them on (RigState.morphs). A channel it omits weighs 0. */
export type MorphWeights = Readonly<Partial<Record<ChannelName, number>>>;

/** The summed effect of a prim's morphs at some weights. */
export interface MorphResult {
  /** Offset of endpoint a. */
  da: Vec3;
  /** Offset of endpoint b (da plus the tip terms). */
  db: Vec3;
  /** Added to the bend; null when no morph bends (the prim's bend is then left exactly as it was). */
  bend: Vec3 | null;
  /** Radius factor (floored at 0). */
  radius: number;
  /** wide/tall/deep factors (each floored at 0). */
  scale: Vec3;
}

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const TERM = new RegExp(`^(?:(tip|bend)?\\(([^()]*)\\)|\\*\\(([^()]*)\\)|\\*(${NUM}))`);

function vec3Of(raw: string, what: string): Vec3 {
  const parts = raw.split(',');
  const v = parts.map(s => (s.trim() === '' ? Number.NaN : Number(s)));
  if (v.length !== 3 || v.some(x => !Number.isFinite(x)))
    throw new Error(`morph ${what} needs three numbers, (x,y,z), got "(${raw})"`);
  return [v[0]!, v[1]!, v[2]!];
}

/**
 * `<channel>:<terms>` (the value of a `.blob` `morph=` word) -> a PrimMorph. Terms, concatenated in any order, each at most once:
 * `(dx,dy,dz)` move, `tip(dx,dy,dz)`, `bend(dx,dy,dz)`, `*k` radius, `*(sx,sy,sz)` scale. Throws a plain Error whose message the
 * parser wraps with the line.
 */
export function parseMorph(raw: string): PrimMorph {
  const colon = raw.indexOf(':');
  if (colon === -1) throw new Error(`morph= is channel:terms, e.g. morph=smile:(0.004,0.002,0)*1.1; got "${raw}"`);
  const name = raw.slice(0, colon);
  if (!(CHANNEL_NAMES as readonly string[]).includes(name))
    throw new Error(`unknown morph channel "${name}" (one of ${CHANNEL_NAMES.join('|')})`);
  const out: PrimMorph = { channel: name as ChannelName };
  let rest = raw.slice(colon + 1);
  if (rest === '') throw new Error(`morph=${name}: needs at least one term: (dx,dy,dz), tip(...), bend(...), *k or *(sx,sy,sz)`);
  const once = (key: keyof Omit<PrimMorph, 'channel'>) => {
    if (out[key] !== undefined) throw new Error(`morph=${name}: gives its ${key} twice`);
  };
  while (rest !== '') {
    const m = TERM.exec(rest);
    if (!m) throw new Error(`morph=${name}: cannot read "${rest}" (terms: (dx,dy,dz), tip(...), bend(...), *k, *(sx,sy,sz))`);
    if (m[2] !== undefined) {
      const key = (m[1] ?? 'move') as 'move' | 'tip' | 'bend';
      once(key);
      out[key] = vec3Of(m[2], key);
    } else if (m[3] !== undefined) {
      once('scale');
      const s = vec3Of(m[3], 'scale');
      if (s.some(x => x <= 0)) throw new Error(`morph=${name}: scale factors must be above zero, got (${m[3]})`);
      out.scale = s;
    } else {
      once('radius');
      const k = Number(m[4]);
      if (!(k > 0)) throw new Error(`morph=${name}: the radius factor must be above zero, got ${m[4]}`);
      out.radius = k;
    }
    rest = rest.slice(m[0].length);
  }
  return out;
}

const flipX = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

/** The x-reflected twin, for the second copy of a `both`/`mirror` line (mirror.ts reflects offset, tip and bend the same way). */
export function mirrorMorph(m: PrimMorph): PrimMorph {
  return {
    ...m,
    ...(m.move ? { move: flipX(m.move) } : {}),
    ...(m.tip ? { tip: flipX(m.tip) } : {}),
    ...(m.bend ? { bend: flipX(m.bend) } : {}),
  };
}

/** The summed deltas and factors of a prim's morphs at these weights, or null when no morph has a nonzero finite weight. */
export function morphOf(morphs: readonly PrimMorph[] | undefined, weights: MorphWeights | undefined): MorphResult | null {
  if (!morphs || !weights) return null;
  let live = false;
  let ax = 0, ay = 0, az = 0, tx = 0, ty = 0, tz = 0;
  let bend: [number, number, number] | null = null;
  let radius = 1;
  const scale: [number, number, number] = [1, 1, 1];
  for (const m of morphs) {
    const w = weights[m.channel];
    if (w === undefined || w === 0 || !Number.isFinite(w)) continue;
    live = true;
    if (m.move) { ax += w * m.move[0]; ay += w * m.move[1]; az += w * m.move[2]; }
    if (m.tip) { tx += w * m.tip[0]; ty += w * m.tip[1]; tz += w * m.tip[2]; }
    if (m.bend) {
      bend ??= [0, 0, 0];
      bend[0] += w * m.bend[0]; bend[1] += w * m.bend[1]; bend[2] += w * m.bend[2];
    }
    if (m.radius !== undefined) radius *= Math.max(0, 1 + w * (m.radius - 1));
    if (m.scale) for (let k = 0; k < 3; k++) scale[k] = scale[k]! * Math.max(0, 1 + w * (m.scale[k]! - 1));
  }
  if (!live) return null;
  return { da: [ax, ay, az], db: [ax + tx, ay + ty, az + tz], bend, radius, scale };
}

/** A prim's radius, radiusB, scale and bend under a morph result. Untapered stays untapered, unbent stays unbent unless a morph
 *  bends; nothing else on the prim is touched. */
export function morphShape<P extends { radius: number; radiusB?: number; scale: Vec3; bend?: Vec3 }>(p: P, r: MorphResult): P {
  const out: P = {
    ...p,
    radius: p.radius * r.radius,
    scale: [p.scale[0] * r.scale[0], p.scale[1] * r.scale[1], p.scale[2] * r.scale[2]],
  };
  if (p.radiusB !== undefined) out.radiusB = p.radiusB * r.radius;
  if (r.bend) {
    const b = p.bend ?? [0, 0, 0];
    out.bend = [b[0] + r.bend[0], b[1] + r.bend[1], b[2] + r.bend[2]];
  }
  return out;
}
