// src/lab/sdf-zombie/webgpu/near-light-pick.ts
//
// Which of a level's point and spot lights matter at one point: a pure ranking by what each can deliver there, and a
// stable assignment of the winners to a fixed number of slots.
//
// WHY. A held weapon, the player's arms and the loose props were lit by three's default light list, which on Night
// Train is every light of the whole train: 69 lights, 26 of them with a shadow map, evaluated for every pixel of
// those meshes (docs/dev-notes/2026-10-08-frame-cost: the arms and gun cost 6 to 7.5 ms of the frame there against
// 0.85 ms on the bare ring, and 0.2 ms with the lights out of the list). The level's walls already shade only their
// room's lights. near-lights.ts gives the held meshes the same, through a FIXED set of proxy lights that copy the
// winners each frame: the light list's membership never changes, so no pipeline is rebuilt when the player walks
// into the next carriage (the LightsNode re-key trap, game-main "MUZZLE FLASH").
//
// Renderer-free: plain numbers in, slot contents out. near-lights.ts owns the three.js side.
import type { Vec3 } from '../types';

export interface NearLightCand {
  /** A stable identity (the light's own id): a light keeps its slot from frame to frame by it. */
  id: number;
  kind: 'point' | 'spot';
  /** World position. */
  pos: Vec3;
  /** Intensity times the colour's luma: what the light can deliver, before distance. */
  power: number;
  /** three's cutoff distance (0 = none) and decay exponent. */
  distance: number;
  decay: number;
  /** Spots: the unit axis from the light to its target, and the cosine of the outer cone's half angle. */
  axis?: Vec3;
  cosOuter?: number;
}

/** Slot contents: a candidate id per slot, -1 for an empty slot. */
export interface NearLightSlots { point: number[]; spot: number[] }

/** How far outside its cone a spot still ranks at CONE_FLOOR of its weight: the pick is made at the eye, and the
 *  meshes it lights reach about a metre from it, so a cone that just misses the eye may still touch them. */
export const CONE_FLOOR = 0.15;
/** The cosine band over which a spot's rank falls from full (the eye inside the cone) to CONE_FLOOR. */
export const CONE_BAND = 0.35;

/** three's punctual falloff (getDistanceAttenuation): 1 / max(d^decay, 0.01), windowed to zero at the cutoff. */
export function distanceFalloff(d: number, cutoff: number, decay: number): number {
  let f = 1 / Math.max(Math.pow(d, decay), 0.01);
  if (cutoff > 0) {
    const w = Math.min(Math.max(1 - Math.pow(d / cutoff, 4), 0), 1);
    f *= w * w;
  }
  return f;
}

/** What `c` can deliver at `at`, for ranking only. 0 means "cannot reach": such a light never takes a slot. */
export function nearLightWeight(c: NearLightCand, at: Vec3): number {
  if (!(c.power > 0)) return 0;
  const dx = at[0] - c.pos[0], dy = at[1] - c.pos[1], dz = at[2] - c.pos[2];
  const d = Math.hypot(dx, dy, dz);
  let w = c.power * distanceFalloff(d, c.distance, c.decay);
  if (c.kind === 'spot' && c.axis && c.cosOuter !== undefined && d > 1e-6) {
    const cos = (dx * c.axis[0] + dy * c.axis[1] + dz * c.axis[2]) / d;
    const t = Math.min(Math.max((cos - (c.cosOuter - CONE_BAND)) / CONE_BAND, 0), 1);
    w *= CONE_FLOOR + (1 - CONE_FLOOR) * t * t * (3 - 2 * t);
  }
  return w;
}

function assign(chosen: number[], prev: readonly number[], n: number): number[] {
  const out = new Array<number>(n).fill(-1);
  const left = new Set(chosen);
  // A light that is still chosen keeps the slot it had: a slot never changes hands while both lights stay in the set.
  for (let s = 0; s < n; s++) { const id = prev[s]; if (id !== undefined && id >= 0 && left.has(id)) { out[s] = id; left.delete(id); } }
  const rest = chosen.filter((id) => left.has(id));
  for (let s = 0, r = 0; s < n && r < rest.length; s++) if (out[s] === -1) out[s] = rest[r++]!;
  return out;
}

/**
 * The `slots.point` strongest point lights and the `slots.spot` strongest spots at `at`, by nearLightWeight (ties by
 * id, so the answer does not depend on the candidates' order). `prev` is last frame's answer: a light that stays in
 * the set stays in its slot.
 */
export function pickNearLights(
  cands: readonly NearLightCand[], at: Vec3, slots: { point: number; spot: number }, prev?: NearLightSlots,
): NearLightSlots {
  const top = (kind: 'point' | 'spot', n: number): number[] => cands
    .filter((c) => c.kind === kind)
    .map((c) => ({ id: c.id, w: nearLightWeight(c, at) }))
    .filter((e) => e.w > 0)
    .sort((a, b) => b.w - a.w || a.id - b.id)
    .slice(0, n)
    .map((e) => e.id);
  return {
    point: assign(top('point', slots.point), prev?.point ?? [], slots.point),
    spot: assign(top('spot', slots.spot), prev?.spot ?? [], slots.spot),
  };
}
