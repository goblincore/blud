// scripts/body-normal-bake/bake-parity-lib.ts
//
// Bake parity (spec Tests 3): the GPU bake (scripts/lib/dawn-bake.ts) against the CPU reference (cpu-bake.ts) on the
// SAME layout, compared texel by texel at seeded sample positions (the CPU costs ~5 ms a texel on a detail body, so
// it bakes only the samples; the GPU bakes the whole layout). A layout can be shrunk for CI with scaleBakeArgs.
import { readFileSync } from 'node:fs';
import { bakeBodies, buildRegions, nearBody, type Body, type Region, type RegionArgs } from '../../src/lab/sdf-zombie/body-normal-bake/regions';
import { colAngle, rayDir, regionFrame, rowAxisPoint, writeFlat, writeTexel } from '../../src/lab/sdf-zombie/body-normal-bake/frame';
import { texelNormals } from '../../src/lab/sdf-zombie/body-normal-bake/cpu-bake';
import { GpuBaker } from '../lib/dawn-bake';
import type { DawnGpu } from '../lib/dawn-field';
import { rng } from './gpu-parity-lib';

const CH = 'src/lab/sdf-zombie/characters';

/** The same regions with every band's rows divided by `k` (at least 4), for a small CI layout. */
export function scaleBakeArgs(a: RegionArgs, k: number): RegionArgs {
  const rows = (n: string) => String(Math.max(4, Math.round(Number(n) / k)));
  const last = (s: string) => { const p = s.split(':'); p[p.length - 1] = rows(p[p.length - 1]!); return p.join(':'); };
  return { ...a, torsoRows: Number(rows(String(a.torsoRows))), limbs: a.limbs?.map(last), torsoSegs: a.torsoSegs?.map(last) };
}

export interface BakeParity {
  samples: number;
  /** Sampled texels where exactly one side hit the plain skin. */
  coverageMismatch: number;
  /** Covered-on-both texels, by the largest channel difference in 8-bit codes. */
  within1: number; within4: number; covered: number; maxCode: number;
  gpuMs: number;
}

/** GPU-bake `name` on the given layout and compare `samples` seeded texels against the CPU reference. */
export async function compareBake(gpu: DawnGpu, name: string, width: number, args: RegionArgs, samples: number, seed = 3): Promise<BakeParity> {
  const { base, detail } = bakeBodies(readFileSync(`${CH}/${name}.blob`, 'utf8'), readFileSync(`${CH}/${name}.detail`, 'utf8'), name);
  const { regions, height } = buildRegions(base, args);
  const gpuRgba = new Uint8Array(width * height * 4), gpuHits = new Uint8Array(width * height);
  const t0 = performance.now();
  const baker = await GpuBaker.create(gpu, base, detail);
  for (const R of regions) await baker.bakeRegion(gpuRgba, width, R, gpuHits);
  baker.destroy();
  const gpuMs = performance.now() - t0;
  const r = rng(seed), res: BakeParity = { samples, coverageMismatch: 0, within1: 0, within4: 0, covered: 0, maxCode: 0, gpuMs };
  const rowBodies = new Map<string, [Body, Body]>();
  const cpu = new Uint8Array(4);
  for (let s = 0; s < samples; s++) {
    // Each region in proportion to its rows, like a uniform pick over the image below the header.
    const y = 1 + Math.floor(r() * (height - 1)), col = Math.floor(r() * width);
    const R = regions.find(g => y >= g.row0 && y < g.row0 + g.rows) as Region, row = y - R.row0;
    const key = `${R.label}:${R.row0}:${row}`;
    const P = rowAxisPoint(R.head, R.tail, row, R.rows);
    if (!rowBodies.has(key)) rowBodies.set(key, [nearBody(base, R.limb, P, R.r0), nearBody(detail, R.limb, P, R.r0)]);
    const [nb0, nd0] = rowBodies.get(key)!;
    const F = regionFrame(R.head, R.tail), th = colAngle(col, width);
    writeFlat(cpu, 0);
    const n = texelNormals(nb0, nd0, P, rayDir(F, th), R.r0);
    if (n) writeTexel(cpu, 0, F, th, n.nb, n.nd);
    const o = (y * width + col) * 4;
    const gpuHit = gpuHits[o / 4] === 1;
    if (!!n !== gpuHit) { res.coverageMismatch++; if (process.env.BAKE_PARITY_DEBUG) console.log(`mismatch ${R.label} row ${row}/${R.rows} col ${col}: cpu ${n ? 'hit' : 'miss'}, gpu ${gpuHit ? 'hit' : 'miss'}`); continue; }
    if (!n) continue;
    res.covered++;
    const d = Math.max(...[0, 1, 2].map(c => Math.abs(cpu[c]! - gpuRgba[o + c]!)));
    res.maxCode = Math.max(res.maxCode, d);
    if (d <= 1) res.within1++;
    if (d <= 4) res.within4++;
  }
  return res;
}

export const describeBake = (b: BakeParity) =>
  `${b.samples} samples: coverage mismatch ${b.coverageMismatch}, covered ${b.covered}, within 1 code ${b.within1}, within 4 ${b.within4}, max ${b.maxCode} codes; GPU bake ${(b.gpuMs / 1000).toFixed(1)} s`;
