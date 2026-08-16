// src/lab/sdf-zombie/gobs.ts
//
// Amorphous gib shapes (spec: gobs-and-goo §1). A full-body gib should read
// as "a few ragged hunks + gooey scraps", not anatomy capsules — playtest
// called the per-prim pieces "too geometric primitive shaped" (the torso's
// fat prims made clean balls).
//
// LARGE GOBS are chunk groups whose prims are NEWLY SYNTHESISED blobs: 2-4
// jittered overlapping spheres/short capsules seeded from a source prim's
// position and volume, smin'd by the normal chunk-view path. SCRAPS are not
// raymarched at all — they are particle descriptors the blood sim ingests,
// so they render through the metaball pass and fuse with the spray.
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import type { ChunkGroup } from './sever';
import { add, len, scale as vscale, sub } from './vec';

export const GOB_TUNING = {
  largeMin: 4,
  largeMax: 6,
  blobsMin: 2,
  blobsMax: 4,
  /** Per-axis ellipsoid jitter band — spec §1. */
  jitterMin: 0.6,
  jitterMax: 1.3,
  scrapMin: 10,
  scrapMax: 15,
  scrapSizeMin: 0.05,
  scrapSizeMax: 0.11,
  /** Gob blob radius as a fraction of the source prim's radius. */
  blobRadiusScale: 0.75,
  /** Blob centre scatter, as a fraction of the source prim's radius. */
  blobScatter: 0.6,
} as const;

export interface Scrap {
  pos: Vec3;
  size: number;
}

/**
 * Gibs the live, non-dead prims of a body into large gobs + scraps.
 * Does NOT mutate the body — the caller still uses gibAllPieces/gibAll for
 * the alive-flag bookkeeping, or marks clusters dead itself.
 */
export function makeGobs(
  body: BuildResult, torsoCentre: Vec3, rng: () => number,
): { gobs: ChunkGroup[]; scraps: Scrap[] } {
  // Source pool: live add-prims of live non-head clusters, biggest first —
  // the biggest regions deserve the large gobs.
  const sources: { limb: LimbId; p: Primitive }[] = [];
  let head: ChunkGroup | null = null;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    const prims = body.prims.slice(c.start, c.start + c.count);
    if (c.limb === 'head') {
      // Intact head, torn at the neck end — same as gibAllPieces' head case.
      let neck: Vec3 = prims[0]!.a; let best = Infinity;
      for (const p of prims) {
        if (p.op === 'sub' || p.dead) continue;
        for (const e of [p.a, p.b]) {
          const d = len(sub(e, torsoCentre));
          if (d < best) { best = d; neck = e; }
        }
      }
      head = { limb: c.limb, prims, origin: c.center, tornAt: [neck] };
      continue;
    }
    for (const p of prims) {
      if (p.op === 'sub' || p.dead) continue;
      sources.push({ limb: c.limb, p });
    }
  }
  sources.sort((a, b) => b.p.radius - a.p.radius);

  const nLarge = GOB_TUNING.largeMin
    + Math.floor(rng() * (GOB_TUNING.largeMax - GOB_TUNING.largeMin + 1));

  // PLAN DEVIATION (coverage): a pure radius-desc top slice only ever picks
  // torso + thigh prims on the stock ZOMBIE (arm prims rank below them), so
  // no region outside the trunk would ever get a gob. Take the biggest prim
  // of EACH live non-head cluster first — the rep is still the cluster's
  // fattest prim, so the biggest regions still own the biggest gobs — then
  // fill any remaining slots from the top of the global radius order. Reps
  // can exceed nLarge by at most 1 (CLUSTER_ORDER has ≤5 non-head limbs and
  // nLarge ≥ 4), which stays inside the [largeMin, largeMax] band.
  const chosen: { limb: LimbId; p: Primitive }[] = [];
  const covered = new Set<LimbId>();
  const taken = new Set<Primitive>();
  for (const s of sources) {
    if (covered.has(s.limb)) continue; // one rep per cluster, its fattest prim
    covered.add(s.limb); taken.add(s.p); chosen.push(s);
  }
  for (const s of sources) {
    if (chosen.length >= nLarge) break;
    if (!taken.has(s.p)) { taken.add(s.p); chosen.push(s); }
  }

  const gobs: ChunkGroup[] = [];
  for (const { limb, p } of chosen) {
    const mid: Vec3 = [
      (p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2,
    ];
    const nBlobs = GOB_TUNING.blobsMin
      + Math.floor(rng() * (GOB_TUNING.blobsMax - GOB_TUNING.blobsMin + 1));
    const prims: Primitive[] = [];
    for (let b = 0; b < nBlobs; b++) {
      const scatter = p.radius * GOB_TUNING.blobScatter;
      const centre = add(mid, [
        (rng() - 0.5) * 2 * scatter,
        (rng() - 0.5) * 2 * scatter,
        (rng() - 0.5) * 2 * scatter,
      ]);
      // Short fat capsule with a random small axis, or a sphere (a==b).
      const axis: Vec3 = rng() < 0.5
        ? [0, 0, 0]
        : vscale([rng() - 0.5, rng() - 0.5, rng() - 0.5], p.radius * 0.8);
      const jit = (): number => GOB_TUNING.jitterMin
        + rng() * (GOB_TUNING.jitterMax - GOB_TUNING.jitterMin);
      prims.push({
        a: centre,
        b: add(centre, axis),
        radius: p.radius * GOB_TUNING.blobRadiusScale * (0.8 + rng() * 0.4),
        scale: [jit(), jit(), jit()],
        blendK: 0.06,
        limb,
        cluster: 0,
      });
    }
    // 1-2 torn points on blob surfaces, so edges read ripped.
    const tornAt: Vec3[] = [];
    const nTorn = 1 + (rng() < 0.5 ? 1 : 0);
    for (let t = 0; t < nTorn; t++) {
      const bp = prims[Math.floor(rng() * prims.length)]!;
      const dir: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const l = len(dir) || 1;
      tornAt.push(add(bp.a, vscale(dir, bp.radius / l)));
    }
    gobs.push({ limb, prims, origin: mid, tornAt: tornAt.slice(0, 2) });
  }
  if (head) gobs.push(head);

  const nScraps = GOB_TUNING.scrapMin
    + Math.floor(rng() * (GOB_TUNING.scrapMax - GOB_TUNING.scrapMin + 1));
  const scraps: Scrap[] = [];
  for (let s = 0; s < nScraps; s++) {
    const src = sources[Math.floor(rng() * sources.length)]?.p;
    const at: Vec3 = src
      ? [(src.a[0] + src.b[0]) / 2, (src.a[1] + src.b[1]) / 2, (src.a[2] + src.b[2]) / 2]
      : torsoCentre;
    scraps.push({
      pos: [at[0] + (rng() - 0.5) * 0.2, at[1] + (rng() - 0.5) * 0.2, at[2] + (rng() - 0.5) * 0.2],
      size: GOB_TUNING.scrapSizeMin
        + rng() * (GOB_TUNING.scrapSizeMax - GOB_TUNING.scrapSizeMin),
    });
  }
  return { gobs, scraps };
}
