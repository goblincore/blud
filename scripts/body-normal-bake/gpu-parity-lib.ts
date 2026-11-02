// scripts/body-normal-bake/gpu-parity-lib.ts
//
// Shared by the *.gpu.test.ts parity suites: the device (skip without one locally, FAIL without one when
// BLUD_REQUIRE_GPU=1, as the gpu-parity CI job sets), seeded sample points round a body, and the CPU-vs-GPU
// comparison. The CPU side is `sdBody` (validate.ts), the reference; the GPU side is the bake field.
import { sdBody } from '../../src/lab/sdf-zombie/validate';
import { packBakeBody } from '../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import type { Body } from '../../src/lab/sdf-zombie/body-normal-bake/regions';
import { dawnDevice, GpuField, type DawnGpu } from '../lib/dawn-field';

/** Max |gpu - cpu| in metres. The GPU is f32 and the CPU f64; measured (2026-10-24) ~1e-7 on Metal and llvmpipe. */
export const FIELD_TOL = 2e-6;

let gpuPromise: Promise<DawnGpu | null> | null = null;
/** The shared device, or null (the suite then skips). Throws when BLUD_REQUIRE_GPU=1 and there is none. */
export async function parityGpu(): Promise<DawnGpu | null> {
  gpuPromise ??= dawnDevice();
  const gpu = await gpuPromise;
  if (!gpu && process.env.BLUD_REQUIRE_GPU === '1') throw new Error('BLUD_REQUIRE_GPU=1 but Dawn found no WebGPU adapter');
  return gpu;
}

/** mulberry32: the same points on every machine. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` points on and around the body: per point a random prim, a random spot along its axis, out along a random
 *  direction by about its radius (on the skin, give or take a centimetre), every third point 2-8 cm further out
 *  (the shell the bake's march walks through). Rounded to f32, so both sides read the same point. */
export function samplePoints(body: Body, count: number, seed: number): Float32Array {
  const r = rng(seed);
  const prims = body.prims.filter(p => !p.dead);
  const out = new Float32Array(count * 3);
  for (let j = 0; j < count; j++) {
    const p = prims[Math.floor(r() * prims.length)]!;
    const t = r();
    const z = r() * 2 - 1, ph = r() * 2 * Math.PI, rho = Math.sqrt(1 - z * z);
    const dir = [rho * Math.cos(ph), rho * Math.sin(ph), z];
    const reach = Math.max(p.radius, p.radiusB ?? 0) * Math.max(...p.scale);
    const off = reach * (0.7 + 0.6 * r()) + (r() - 0.5) * 0.02 + (j % 3 === 2 ? 0.02 + 0.06 * r() : 0);
    for (let k = 0; k < 3; k++) out[j * 3 + k] = p.a[k]! + (p.b[k]! - p.a[k]!) * t + dir[k]! * off;
  }
  return out;
}

export interface FieldParity { maxErr: number; worst: [number, number, number]; cpu: number; gpu: number; n: number }

/** sdBody vs the GPU bake field at `points`. */
export async function compareField(gpu: DawnGpu, body: Body, points: Float32Array): Promise<FieldParity> {
  const field = await GpuField.create(gpu, packBakeBody(body));
  try {
    const got = await field.evaluate(points);
    const res: FieldParity = { maxErr: 0, worst: [0, 0, 0], cpu: 0, gpu: 0, n: got.length };
    for (let j = 0; j < got.length; j++) {
      const p: [number, number, number] = [points[j * 3]!, points[j * 3 + 1]!, points[j * 3 + 2]!];
      const want = sdBody(p, body);
      const err = Math.abs(got[j]! - want);
      if (!(err <= res.maxErr)) Object.assign(res, { maxErr: Number.isNaN(err) ? Infinity : err, worst: p, cpu: want, gpu: got[j]! });
    }
    return res;
  } finally { field.destroy(); }
}

export const describeParity = (r: FieldParity) =>
  `max |gpu - cpu| ${r.maxErr.toExponential(2)} over ${r.n} points; worst at [${r.worst.map(v => v.toFixed(4))}] cpu ${r.cpu} gpu ${r.gpu}`;
