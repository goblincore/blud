// THE SHARED LIGHT LIST (spec §4). Pure: every light that can touch a body, built once a frame
// from plain sources (the game's leaves read three's lights and hand them here), capped at 32
// by intensity (ties by source order: deterministic), packed into one GPU buffer together
// with the profile table (light-profiles.ts). Layout in the plan's "Shared facts".

import { MAX_PROFILES, PROFILE_ID, PROFILE_VEC4S, packProfiles, type ProfileName } from './light-profiles';

export type Vec3 = [number, number, number];
export type LightKind = 'point' | 'spot' | 'directional';
export const KIND_CODE: Record<LightKind, number> = { point: 0, spot: 1, directional: 2 };

export interface LightSource {
  kind: LightKind; profile: ProfileName;
  /** Position; for 'directional' the direction TOWARD the light. */
  pos: Vec3; color: Vec3; intensity: number; range: number;
  axis?: Vec3; cosOuter?: number; cosInner?: number;
  /** The room it lights (-1 = any). Picking skips lights for other rooms. */
  room: number;
  /** Level JSON per-light overrides (spec §5, option A). */
  levelGain?: number; levelTint?: Vec3;
}

export interface ListLight {
  kind: LightKind; profile: number; pos: Vec3; color: Vec3; intensity: number; range: number;
  axis: Vec3; cosOuter: number; cosInner: number; room: number;
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

export function buildLightList(src: readonly LightSource[]): ListLight[] {
  return src
    .map((s, i) => ({ s, i, e: s.intensity * (s.levelGain ?? 1) }))
    .filter(x => x.e > 0)
    .sort((a, b) => b.e - a.e || a.i - b.i)
    .slice(0, LIST_CAP)
    .map(({ s, e }) => {
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
        axis: norm(s.axis ?? [0, -1, 0]), cosOuter, cosInner, room: s.room,
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
             l.profile, -1, 0, 0], o);
  });
  return out;
}
