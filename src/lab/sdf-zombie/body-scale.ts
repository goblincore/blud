// src/lab/sdf-zombie/body-scale.ts
//
// A uniform SCALE for a compiled body (spec docs/superpowers/specs/2026-10-11-goblin-human-height-design.md, section 3). A `.blob`'s
// numbers are absolute metres; `scale k` in its `model` block multiplies every LENGTH once, here, so the character can be resized
// without rewriting a file whose comments quote the old metres. Fractions (`at`, `scale`, `box.round`, strand `fat`), directions,
// colours and flags are not lengths and are left alone.
//
// THE GUARD. Each table below is `satisfies Record<keyof T, Unit>`: adding a field to PrimDef, BoneDef or ShellParams fails the typecheck
// until someone decides here whether it is a length. A silent default would resize the body wrongly in a way no test of today's fields sees.
import type { BodyDef, BoneDef, PrimDef, ShellParams, Vec3 } from './types';

/** `length`: metres, multiplied. `perLength`: radians per metre, divided. `same`: not a length. */
export type FieldUnit = 'length' | 'perLength' | 'same';

export const BONE_UNITS = {
  name: 'same', parent: 'same', dir: 'same', length: 'length', lengthR: 'length', side: 'length', mirror: 'same',
} as const satisfies Record<keyof BoneDef, FieldUnit>;

export const SHELL_UNITS = {
  thickness: 'length', clipNormal: 'same', clipOffset: 'length', rim: 'length', warpAmp: 'length', warpFreq: 'perLength',
} as const satisfies Record<keyof ShellParams, FieldUnit>;

export const PRIM_UNITS = {
  bone: 'same', src: 'same', at: 'same', capTo: 'same',
  radius: 'length', radiusB: 'length', scale: 'same', blendK: 'length', blendProfile: 'same', bend: 'length',
  limb: 'same', mirror: 'same',
  // `side` on a PrimDef is 'l' | 'r' (which half a single-sided prim lives on), not a distance.
  side: 'same',
  op: 'same', grooveDepth: 'length', grooveWidth: 'length', offset: 'length', tip: 'length', mirrorOffset: 'same',
  color: 'same', gloss: 'same', metal: 'same', glow: 'same', core: 'same', rigid: 'same', when: 'same',
  // `shell` is recursed into below (SHELL_UNITS); `box` and `strand` hold fractions and counts only.
  shell: 'same', box: 'same', strand: 'same',
} as const satisfies Record<keyof PrimDef, FieldUnit>;

const mul = (v: number | Vec3, f: number): number | Vec3 =>
  typeof v === 'number' ? v * f : [v[0] * f, v[1] * f, v[2] * f];
const div = (v: number | Vec3, f: number): number | Vec3 =>
  typeof v === 'number' ? v / f : [v[0] / f, v[1] / f, v[2] / f];

function scaleFields<T extends object>(src: T, units: Record<keyof T, FieldUnit>, k: number): T {
  const from = src as Record<string, unknown>;
  const table = units as Record<string, FieldUnit | undefined>;
  const out: Record<string, unknown> = { ...from };
  for (const key of Object.keys(from)) {
    const unit = table[key];
    if (unit === undefined) throw new Error(`scaleBodyDef: no unit for field "${key}"`);
    const v = from[key];
    if (unit === 'same' || v === undefined) continue;
    out[key] = unit === 'length' ? mul(v as number | Vec3, k) : div(v as number | Vec3, k);
  }
  return out as T;
}

function scalePrim(p: PrimDef, k: number): PrimDef {
  const out = scaleFields(p, PRIM_UNITS, k);
  return p.shell ? { ...out, shell: scaleFields(p.shell, SHELL_UNITS, k) } : out;
}

/** The body at `k` times its authored size: the same object when k is 1, a new one otherwise (the input is never mutated). */
export function scaleBodyDef(def: BodyDef, k: number): BodyDef {
  if (!(k > 0) || !Number.isFinite(k)) throw new Error(`scaleBodyDef: scale must be a positive finite number, got ${k}`);
  if (k === 1) return def;
  return {
    ...def,
    root: mul(def.root, k) as Vec3,
    bones: def.bones.map(b => scaleFields(b, BONE_UNITS, k)),
    prims: def.prims.map(p => scalePrim(p, k)),
    ...(def.bonePrims ? { bonePrims: def.bonePrims.map(p => scalePrim(p, k)) } : {}),
  };
}
