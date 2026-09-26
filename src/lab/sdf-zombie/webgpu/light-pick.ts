// EACH BODY'S 4 LIGHTS (spec §4). Pure. A light's weight on a body is what it DELIVERS there,
// by the presentation rules tuned with the owner on 2026-09-26 (game-dynamic-light-leaves.ts
// presentingLamp, ported rule for rule and generalised to every kind):
//  - spot coverage judged at the FEET (the visible pool; a chest-height cone is only ~1 m),
//    full inside the inner cone, a smoothstep down to zero at the outer angle x profile.edge;
//  - a small coverage floor (profile.coverFloor, CPU-only) while the body is in range: never pitch black;
//  - distance fall 1 / (1 + distFall d²);
//  - facing falloff: backKey + (1 - backKey) x facing (back to the light: dimmer, never black;
//    a light straight overhead counts as side-on, a crown-only light reads dark).
//
// The packed weight is ABSOLUTE PRESENCE (cover x distFall x facing), NOT a share of the
// dominant light (review fix, Task 4): a body standing only in a tube's dim floor region, far
// off, back to the light, must pack a small weight even when that tube is its only light — the
// old "dominant always gets 0.999" rule discarded the dominant's own attenuation and lit such a
// body at full tube strength. The shader multiplies the packed weight by the light's list rgb
// (intensity x level gain already folded in) and the profile gain, so absolute brightness comes
// from presence x rgb x gain, matching presentingLamp's own math (room level only there).
//
// Ranking (which 4 lights win the body's slots) additionally multiplies presence by the light's
// rgb luminance, so a dim light close up and a bright light far off compare on what they'd
// actually contribute, not just geometry. Ties by list index.
//
// Each lane packs index + weight (weight < 1, clamped to 0.999 so index + weight never rolls
// into the next index), -1 empty.

import { LIGHT_PROFILES } from './light-profiles';
import { maskHasRoom, type ListLight, type Vec3 } from './light-list';

export interface PickBody {
  /** The body's centre (chest height): distance and the direction to the light are taken here. */
  pos: Vec3;
  /** The body's room, or -1 (unknown / a tunnel): matches every light. */
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
/** The packed weight's ceiling: < 1 so index + weight never rolls into the next index. */
const MAX_WEIGHT = 0.999;
/** Below this a light contributes nothing worth a slot (rank, not raw presence). */
const RANK_FLOOR = 1e-4;

/** cover x distFall x facing — what the light actually delivers at the body, no luminance.
 *  This is the value packed as the GPU weight (absolute presence, review fix Task 4). */
export function lightPresence(l: ListLight, b: PickBody): number {
  if (!maskHasRoom(l.roomMask, b.room)) return 0;
  const prof = LIGHT_PROFILES[l.profile]!;
  let toLx: number, toLz: number, cover = 1, dist = 0;
  if (l.kind === 'directional') {
    toLx = l.pos[0]; toLz = l.pos[2];
  } else {
    const dx = l.pos[0] - b.pos[0], dy = l.pos[1] - b.pos[1], dz = l.pos[2] - b.pos[2];
    dist = Math.hypot(dx, dy, dz);
    if (l.range > 0 && dist > l.range) return 0;
    const inv = 1 / (dist || 1);
    toLx = dx * inv; toLz = dz * inv;
    if (l.kind === 'spot') {
      // Coverage at the feet: the ray from the lamp to the body's feet against the cone.
      const fx = b.pos[0] - l.pos[0], fy = (b.feetY ?? FEET_Y) - l.pos[1], fz = b.pos[2] - l.pos[2];
      const fl = Math.hypot(fx, fy, fz) || 1;
      const c = (fx * l.axis[0] + fy * l.axis[1] + fz * l.axis[2]) / fl;
      // presentingLamp: full inside the inner cone, smoothstep to zero at the outer ANGLE x edge
      // (edge 1.25: the light lets go a quarter past the visible cone), then the floor.
      const zero = Math.cos(Math.min(Math.PI, Math.acos(Math.max(-1, Math.min(1, l.cosOuter))) * prof.edge));
      const t = clamp01((c - zero) / Math.max(l.cosInner - zero, 1e-4));
      cover = prof.coverFloor + (1 - prof.coverFloor) * t * t * (3 - 2 * t);
    }
  }
  const distFall = 1 / (1 + prof.distFall * dist * dist);
  const hl = Math.hypot(toLx, toLz);
  // Straight overhead: side-on (presentingLamp's facing 0.5), not "in front".
  const facingDot = hl > 1e-4 ? (toLx * b.facing[0] + toLz * b.facing[1]) / hl : 0;
  const facing = prof.backKey + (1 - prof.backKey) * clamp01(facingDot * 0.5 + 0.5);
  return cover * distFall * facing;
}

/** presence x luminance(rgb) — used only to RANK lights against each other (different kinds/
 *  intensities compare); not what gets packed. */
export function lightRank(l: ListLight, b: PickBody): number {
  const presence = lightPresence(l, b);
  if (presence === 0) return 0;
  const lum = l.color[0] * 0.2126 + l.color[1] * 0.7152 + l.color[2] * 0.0722;
  return presence * lum;
}

export function pickLights(list: readonly ListLight[], b: PickBody, out?: Pick): Pick {
  const p = out ?? { idx: [-1, -1, -1, -1], weight: [0, 0, 0, 0], packed: [-1, -1, -1, -1] };
  const idx = p.idx, weight = p.weight, packed = p.packed;
  const rank: [number, number, number, number] = [0, 0, 0, 0];
  idx[0] = idx[1] = idx[2] = idx[3] = -1;
  weight[0] = weight[1] = weight[2] = weight[3] = 0;
  packed[0] = packed[1] = packed[2] = packed[3] = -1;

  for (let i = 0; i < list.length; i++) {
    const l = list[i]!;
    const r = lightRank(l, b);
    if (r <= RANK_FLOOR) continue;
    // Fixed 4-slot insertion, index order, strictly greater so ties keep the lower index.
    if (r > rank[3]!) {
      let slot = 3;
      while (slot > 0 && r > rank[slot - 1]!) {
        rank[slot] = rank[slot - 1]!;
        idx[slot] = idx[slot - 1]!;
        slot--;
      }
      rank[slot] = r;
      idx[slot] = i;
    }
  }

  for (let k = 0; k < 4; k++) {
    if (idx[k]! < 0) continue;
    const presence = lightPresence(list[idx[k]!]!, b);
    weight[k] = Math.min(MAX_WEIGHT, presence);
    packed[k] = idx[k]! + weight[k]!;
  }
  return p;
}

/** WGSL decodes the same way: i32(floor(v)), fract(v); negative = empty. */
export function unpackPick(p: readonly number[]): { index: number; weight: number }[] {
  return p.map(v => (v < 0 ? { index: -1, weight: 0 } : { index: Math.floor(v), weight: v - Math.floor(v) }));
}
