// src/lab/sdf-zombie/webgpu/burn-room-light.ts
//
// FIRE → ROOM LIGHT, as pure numbers. The room is lit by the probe gather's
// dynamic list (8 slots shared with flashes, explosions, tracers), so fire gets
// a small fixed number of slots and surplus burners MERGE into the nearest kept
// slot rather than dropping out (the room must not go dark when a third body
// catches). Mesh props get a fixed always-visible PointLight pool.
import type { Vec3 } from '../types';

export interface FireLightSource { pos: Vec3; intensity: number }

const d2 = (a: Vec3, b: Vec3) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nearestFirst(src: readonly FireLightSource[], eye: Vec3): FireLightSource[] {
  return src.filter(s => s.intensity > 0).sort((a, b) => d2(a.pos, eye) - d2(b.pos, eye));
}

export function fireGatherLights(
  src: readonly FireLightSource[], eye: Vec3, cap: number,
): FireLightSource[] {
  if (cap <= 0) return [];
  const sorted = nearestFirst(src, eye);
  const kept = sorted.slice(0, cap).map(s => ({
    sum: s.intensity, wx: s.pos[0] * s.intensity, wy: s.pos[1] * s.intensity, wz: s.pos[2] * s.intensity,
    at: s.pos,
  }));
  for (const s of sorted.slice(cap)) {
    let best = kept[0]!;
    for (const k of kept) if (d2(k.at, s.pos) < d2(best.at, s.pos)) best = k;
    best.sum += s.intensity;
    best.wx += s.pos[0] * s.intensity; best.wy += s.pos[1] * s.intensity; best.wz += s.pos[2] * s.intensity;
  }
  return kept.map(k => ({ pos: [k.wx / k.sum, k.wy / k.sum, k.wz / k.sum] as Vec3, intensity: k.sum }));
}

export function assignFirePool(
  src: readonly FireLightSource[], eye: Vec3, slots: number,
): FireLightSource[] {
  const sorted = nearestFirst(src, eye);
  const out: FireLightSource[] = [];
  for (let i = 0; i < slots; i++) out.push(sorted[i] ?? { pos: [0, 0, 0], intensity: 0 });
  return out;
}
