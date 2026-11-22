// src/lab/sdf-zombie/webgpu/stress-spawns.ts
//
// STRESS CAST (occlusion pass, 2026-10-28): `?stress=N` on a sector level adds N enemies to the level's own spawns,
// for measuring culling at Doom 2 MAP28 scale (many zones, ~100 enemies) on E1M1. Pure: each extra copies a source
// spawn's kind round robin and stands 1.2-4 m from it, at a point `accept` approves (a floor the body fits on),
// seeded so a run repeats. A source with no free point within `tries` gets no extra that round.

export interface StressSource { kind: string; pos: readonly [number, number, number] }
export interface StressSpawn { kind: string; pos: [number, number, number]; from: number }

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `accept(x, z, y)` returns the floor height to stand on at (x, z) for a body from floor y, or null to refuse. */
export function stressSpawns(sources: readonly StressSource[], n: number, accept: (x: number, z: number, y: number) => number | null,
  seed = 1, tries = 12): StressSpawn[] {
  const out: StressSpawn[] = [];
  if (sources.length === 0 || n <= 0) return out;
  const r = rng(seed);
  const taken: [number, number][] = sources.map(s => [s.pos[0], s.pos[2]]);
  for (let i = 0, misses = 0; out.length < n && misses < sources.length * 2; i++) {
    const k = i % sources.length, s = sources[k]!;
    let placed = false;
    for (let t = 0; t < tries && !placed; t++) {
      const a = r() * Math.PI * 2, d = 1.2 + r() * 2.8;
      const x = s.pos[0] + Math.cos(a) * d, z = s.pos[2] + Math.sin(a) * d;
      if (taken.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.9)) continue;
      const y = accept(x, z, s.pos[1]);
      if (y === null) continue;
      out.push({ kind: s.kind, pos: [x, y, z], from: k });
      taken.push([x, z]);
      placed = true;
    }
    misses = placed ? 0 : misses + 1;
  }
  return out;
}
