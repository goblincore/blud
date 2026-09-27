// THE SHARED LIGHT LIST (spec §4). Pure: every light that can touch a body, built once a frame
// from plain sources (the game's leaves read three's lights and hand them here), capped at 32
// (ties by source order: deterministic), packed into one GPU buffer together with the profile
// table (light-profiles.ts). Layout in the plan's "Shared facts".
//
// THE CAP IS RELEVANCE-FIRST (Task 6 review): a level can hold far more than 32 lights (Night
// Train: 8 carriages), so with a relevance context the list keeps, in order, the lights that can
// reach the player's surroundings (any-room lights, and lights for the player's room or a room
// joined to it) then every other light, each tier ranked by effective intensity / (1 + d²) to
// the viewer. Without a context it ranks by effective intensity alone.

import { MAX_PROFILES, PROFILE_ID, PROFILE_VEC4S, packProfiles, type ProfileName } from './light-profiles';

export type Vec3 = [number, number, number];
export type LightKind = 'point' | 'spot' | 'directional';
export const KIND_CODE: Record<LightKind, number> = { point: 0, spot: 1, directional: 2 };

export interface LightSource {
  kind: LightKind; profile: ProfileName;
  /** Position; for 'directional' the direction TOWARD the light. */
  pos: Vec3; color: Vec3; intensity: number; range: number;
  axis?: Vec3; cosOuter?: number; cosInner?: number;
  /** The rooms it lights (absent/empty, or any id < 0 = any room). Picking skips a body in a
   *  room outside the set. Lamps and tubes light one room; the storm's window light lights
   *  every windowed carriage. */
  rooms?: readonly number[];
  /** Level JSON per-light overrides (spec §5, option A). */
  levelGain?: number; levelTint?: Vec3;
  /** The light's own reference (base, full-level) intensity, where it differs light to light
   *  (lamps, tubes, the flashlight): the body key reads intensity / refIntensity, i.e. the
   *  light's live level (Task 10 calibration, light-profiles.ts). Absent: 1 (the profile gain
   *  converts the raw intensity). */
  refIntensity?: number;
}

export interface ListLight {
  kind: LightKind; profile: number; pos: Vec3; color: Vec3; intensity: number; range: number;
  axis: Vec3; cosOuter: number; cosInner: number;
  /** The rooms it lights as a bitmask (bit r = room r; 0 = any room). See roomMaskOf. */
  roomMask: number;
  /** 1 / refIntensity (1 when absent): the body shader's per-light normaliser, packed in light
   *  v3.z. rgb stays physical (plan 2's level materials read it and ignore this lane). */
  bodyNorm: number;
}

/** Room ids that fit the mask: bits 0..30 keep the mask a positive int32 (it may be packed
 *  into an f32/i32 lane later). Night Train's ids are 1..8. */
export const ROOM_MASK_BITS = 31;

/** The room set as a bitmask; 0 = any room. An id < 0 means "any room"; an id past the mask
 *  (>= ROOM_MASK_BITS) also widens the light to any room: over-lighting a room beats silently
 *  dropping a light from the room it belongs to. */
export function roomMaskOf(rooms: readonly number[] | undefined): number {
  if (!rooms || rooms.length === 0) return 0;
  let m = 0;
  for (const r of rooms) {
    if (r < 0 || r >= ROOM_MASK_BITS || !Number.isInteger(r)) return 0;
    m |= 1 << r;
  }
  return m;
}

/** Does a light with this mask reach a body in `room` (-1 = unknown: matches anything)? */
export function maskHasRoom(mask: number, room: number): boolean {
  if (mask === 0 || room < 0) return true;
  if (room >= ROOM_MASK_BITS) return false;
  return (mask & (1 << room)) !== 0;
}

/** Where the list is being built FOR: the viewer's position and the rooms around it. */
export interface ListRelevance {
  /** The viewer (player/camera) position: distance ranks lights within a tier. */
  pos: Vec3;
  /** The viewer's room and the rooms joined to it (tunnels/doors), as a room mask
   *  (roomMaskOf). 0 = unknown: no room tier, distance alone. */
  nearMask: number;
}

export const LIST_CAP = 32;
export const LIST_HEADER = MAX_PROFILES * PROFILE_VEC4S;   // 24
export const LIST_LIGHTS_AT = LIST_HEADER + 1;             // 25
export const LIGHT_VEC4S = 4;
export const LIST_VEC4S = LIST_LIGHTS_AT + LIST_CAP * LIGHT_VEC4S;   // 153

// Packed once at module load: the profile table is fixed in code (light-profiles.ts), so
// packLightList copies this cached block instead of re-packing 96 floats every frame.
const PACKED_PROFILES = packProfiles();

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Tier 0 (kept first): the light can reach the viewer's surroundings. */
function tierOf(mask: number, rel: ListRelevance | undefined): number {
  if (!rel || rel.nearMask === 0 || mask === 0) return 0;
  return (mask & rel.nearMask) !== 0 ? 0 : 1;
}

/** Relevance score within a tier: effective intensity, attenuated by d² to the viewer
 *  (directional lights have no position: no attenuation). */
function scoreOf(s: LightSource, e: number, rel: ListRelevance | undefined): number {
  if (!rel || s.kind === 'directional') return e;
  const dx = s.pos[0] - rel.pos[0], dy = s.pos[1] - rel.pos[1], dz = s.pos[2] - rel.pos[2];
  return e / (1 + dx * dx + dy * dy + dz * dz);
}

/** Build the frame's list. `rel` (optional) makes the 32 cap prefer the viewer's surroundings
 *  (see the header); without it the strongest 32 by effective intensity win. Ties keep source
 *  order either way. Allocates a small map/filter/sort chain per call (bounded by the source
 *  count; the result is at most LIST_CAP lights). */
export function buildLightList(src: readonly LightSource[], rel?: ListRelevance): ListLight[] {
  return src
    .map((s, i) => {
      const e = s.intensity * (s.levelGain ?? 1);
      const mask = roomMaskOf(s.rooms);
      return { s, i, e, mask, tier: tierOf(mask, rel), score: scoreOf(s, e, rel) };
    })
    .filter(x => x.e > 0)
    .sort((a, b) => a.tier - b.tier || b.score - a.score || a.i - b.i)
    .slice(0, LIST_CAP)
    .map(({ s, e, mask }) => {
      const t = s.levelTint ?? [1, 1, 1];
      const tl = Math.max(t[0], t[1], t[2], 1e-6);
      // An inverted cone (inner wider than outer) becomes a hard-edged one: cosInner >= cosOuter.
      const cosOuter = s.cosOuter ?? -1;
      const cosInner = Math.max(s.cosInner ?? -1, cosOuter);
      return {
        kind: s.kind, profile: PROFILE_ID[s.profile],
        pos: s.kind === 'directional' ? norm(s.pos) : [...s.pos] as Vec3,
        color: [s.color[0] * e * t[0] / tl, s.color[1] * e * t[1] / tl, s.color[2] * e * t[2] / tl],
        intensity: e, range: s.range,
        axis: norm(s.axis ?? [0, -1, 0]), cosOuter, cosInner, roomMask: mask,
        bodyNorm: s.refIntensity && s.refIntensity > 0 ? 1 / s.refIntensity : 1,
      };
    });
}

export function packLightList(list: readonly ListLight[], out = new Float32Array(LIST_VEC4S * 4)): Float32Array {
  out.set(PACKED_PROFILES, 0);
  out.fill(0, LIST_HEADER * 4);
  out[LIST_HEADER * 4] = list.length;
  list.forEach((l, i) => {
    const o = (LIST_LIGHTS_AT + i * LIGHT_VEC4S) * 4;
    const cone = Math.floor(Math.max(-1, l.cosOuter) * 1000) + Math.max(0, l.cosInner) * 0.999;
    out.set([l.pos[0], l.pos[1], l.pos[2], KIND_CODE[l.kind],
             l.color[0], l.color[1], l.color[2], l.range,
             l.axis[0], l.axis[1], l.axis[2], cone,
             l.profile, -1, l.bodyNorm, 0], o);
  });
  return out;
}
