// EACH BODY'S 4 LIGHTS (spec §4). Pure. A light's weight on a body is what it DELIVERS there,
// by the presentation rules tuned with the owner on 2026-09-26 (game-dynamic-light-leaves.ts
// presentingLamp, ported rule for rule and generalised to every kind):
//  - spot coverage judged at the FEET (the visible pool; a chest-height cone is only ~1 m),
//    full inside the inner cone, a smoothstep down to zero at the outer angle x profile.edge;
//  - a small coverage floor (profile.floor) while the body is in range: never pitch black;
//  - distance fall 1 / (1 + distFall d²);
//  - facing falloff: backKey + (1 - backKey) x facing (back to the light: dimmer, never black;
//    a light straight overhead counts as side-on, a crown-only light reads dark).
// Unlike presentingLamp (room level only) the weight also carries the light's rgb luminance,
// which already includes intensity x level gain, so lights of different strength compare.
//
// The top 4 by weight win, ties by list index. Each lane packs index + weight (weight < 1),
// -1 empty. The packed weight is a SHARE OF THE DOMINANT: the dominant gets 0.999, the others
// w / w_dominant x 0.999. Absolute brightness comes from the light's own list rgb x profile
// gain in the shader, so the dominant lights a body at its rgb x gain, the rest at their share.

import { LIGHT_PROFILES } from './light-profiles';
import type { ListLight, Vec3 } from './light-list';

export interface PickBody {
  /** The body's centre (chest height): distance and the direction to the light are taken here. */
  pos: Vec3;
  room: number;
  /** Unit xz direction the presentation treats as the body's FRONT. presentingLamp used the
   *  direction from the body toward the viewer here; pass that to keep its look exactly. */
  facing: [number, number];
  /** World y of the feet, where spot coverage is judged (default FEET_Y: a floor at y = 0). */
  feetY?: number;
}
export interface Pick { idx: [number, number, number, number]; weight: [number, number, number, number]; packed: [number, number, number, number] }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const FEET_Y = 0.05;
/** The dominant light's packed weight: < 1 so index + weight never rolls into the next index. */
const TOP_SHARE = 0.999;

export function lightWeight(l: ListLight, b: PickBody): number {
  if (l.room >= 0 && b.room >= 0 && l.room !== b.room) return 0;
  const prof = LIGHT_PROFILES[l.profile]!;
  let toL: Vec3, cover = 1, dist = 0;
  if (l.kind === 'directional') {
    toL = l.pos;
  } else {
    const d: Vec3 = [l.pos[0] - b.pos[0], l.pos[1] - b.pos[1], l.pos[2] - b.pos[2]];
    dist = Math.hypot(d[0], d[1], d[2]);
    if (l.range > 0 && dist > l.range) return 0;
    toL = [d[0] / (dist || 1), d[1] / (dist || 1), d[2] / (dist || 1)];
    if (l.kind === 'spot') {
      // Coverage at the feet: the ray from the lamp to the body's feet against the cone.
      const f: Vec3 = [b.pos[0] - l.pos[0], (b.feetY ?? FEET_Y) - l.pos[1], b.pos[2] - l.pos[2]];
      const fl = Math.hypot(f[0], f[1], f[2]) || 1;
      const c = (f[0] * l.axis[0] + f[1] * l.axis[1] + f[2] * l.axis[2]) / fl;
      // presentingLamp: full inside the inner cone, smoothstep to zero at the outer ANGLE x edge
      // (edge 1.25: the light lets go a quarter past the visible cone), then the floor.
      const zero = Math.cos(Math.min(Math.PI, Math.acos(Math.max(-1, Math.min(1, l.cosOuter))) * prof.edge));
      const t = clamp01((c - zero) / Math.max(l.cosInner - zero, 1e-4));
      cover = prof.floor + (1 - prof.floor) * t * t * (3 - 2 * t);
    }
  }
  const distFall = 1 / (1 + prof.distFall * dist * dist);
  const hl = Math.hypot(toL[0], toL[2]);
  // Straight overhead: side-on (presentingLamp's facing 0.5), not "in front".
  const facingDot = hl > 1e-4 ? (toL[0] * b.facing[0] + toL[2] * b.facing[1]) / hl : 0;
  const facing = prof.backKey + (1 - prof.backKey) * clamp01(facingDot * 0.5 + 0.5);
  const lum = l.color[0] * 0.2126 + l.color[1] * 0.7152 + l.color[2] * 0.0722;
  return cover * distFall * facing * lum;
}

export function pickLights(list: readonly ListLight[], b: PickBody): Pick {
  const scored = list.map((l, i) => ({ i, w: lightWeight(l, b) })).filter(x => x.w > 1e-4)
    .sort((a, c) => c.w - a.w || a.i - c.i).slice(0, 4);
  const top = scored[0]?.w ?? 1;
  const idx = [-1, -1, -1, -1] as Pick['idx'];
  const weight = [0, 0, 0, 0] as Pick['weight'];
  const packed = [-1, -1, -1, -1] as Pick['packed'];
  scored.forEach((s, k) => {
    idx[k] = s.i;
    weight[k] = Math.min(TOP_SHARE, s.w / top * TOP_SHARE);
    packed[k] = s.i + weight[k];
  });
  return { idx, weight, packed };
}

/** WGSL decodes the same way: i32(floor(v)), fract(v); negative = empty. */
export function unpackPick(p: readonly number[]): { index: number; weight: number }[] {
  return p.map(v => (v < 0 ? { index: -1, weight: 0 } : { index: Math.floor(v), weight: v - Math.floor(v) }));
}
