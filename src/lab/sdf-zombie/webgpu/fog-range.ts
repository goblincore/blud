// src/lab/sdf-zombie/webgpu/fog-range.ts
//
// fogRange: the scene fog's near/far for a level — the ambient rig's own range on room levels, a
// longer, thinner veil on sector levels, then URL overrides. Pure (no three, no DOM).

import type { AmbientRig } from './dungeon-lighting';

/** Sector levels (Doom-style maps) push the dungeon's black veil back: the owner found 2.5..13 m
 *  too thick for E1M1's bigger rooms. Room levels keep the rig's own range. */
export const SECTOR_FOG = { near: 8, far: 40 } as const;

/** The fog range for this level: the rig's, or SECTOR_FOG on a sector level, then ?fognear= /
 *  ?fogfar= overrides (metres; ?fog=0 turns it off by pushing it out of reach). */
export function fogRange(rig: AmbientRig, sectorLevel: boolean, search: string): { near: number; far: number } {
  const q = new URLSearchParams(search);
  if (q.get('fog') === '0') return { near: 1e5, far: 2e5 };
  let near = sectorLevel ? SECTOR_FOG.near : rig.fogNear;
  let far = sectorLevel ? SECTOR_FOG.far : rig.fogFar;
  const n = Number(q.get('fognear') ?? NaN), f = Number(q.get('fogfar') ?? NaN);
  if (q.get('fognear') && Number.isFinite(n) && n >= 0) near = n;
  if (q.get('fogfar') && Number.isFinite(f) && f > near) far = f;
  return { near, far: Math.max(far, near + 0.01) };
}

