// Which side is right on a badly conditioned bent prim? sdBody (f64 cubic + grid refine) and the GPU field (f32)
// against a brute-force minimum of |q - P(t)| - r(t) over 20001 t samples plus golden-section polish.
//   npx tsx docs/dev-notes/2026-10-24-gpu-bake-parity/bend-truth.mts <character>
import { readFileSync } from 'node:fs';
import { buildFromBlob } from '../../../src/lab/sdf-zombie/body-normal-bake/regions';
import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { sdBody } from '../../../src/lab/sdf-zombie/validate';
import { bendCtrl } from '../../../src/lab/sdf-zombie/vec';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
import { samplePoints } from '../../../scripts/body-normal-bake/gpu-parity-lib';
const n = process.argv[2] ?? 'twinhead';
const body = buildFromBlob(readFileSync(`src/lab/sdf-zombie/characters/${n}.blob`, 'utf8'));
const gpu = (await dawnDevice())!;
let worst: any = null;
for (const p of body.prims.filter(p => p.bend !== undefined && !p.dead && (!p.op || p.op === 'add'))) {
  const b: any = { prims: [{ ...p, cluster: 0 }], clusters: [{ id: 0, limb: p.limb, start: 0, count: 1, center: [0, 0, 0], radius: 1, alive: true }] };
  const f = await GpuField.create(gpu, packBakeBody(b)); const pts = samplePoints(b, 2000, 5); const got = await f.evaluate(pts); f.destroy();
  for (let j = 0; j < 2000; j++) { const q = [pts[j * 3]!, pts[j * 3 + 1]!, pts[j * 3 + 2]!]; const e = Math.abs(got[j]! - sdBody(q as any, b)); if (!worst || e > worst.e) worst = { e, p, q, gpu: got[j], cpu: sdBody(q as any, b) }; }
}
const { p, q } = worst;
// brute force in the prim's scaled frame, the way sdPrimitive evaluates it (no orient on these prims)
if (p.orient && Math.abs(1 - p.orient[3]) > 1e-6) console.log('(oriented prim: brute force ignores orient)');
const inv = p.scale.map((s: number) => 1 / s), ms = Math.min(...p.scale);
const S = (v: number[]) => v.map((x, i) => x * inv[i]);
const A = S(p.a), B = S(p.b), C = S(bendCtrl(p.a, p.b, p.bend)), Q = S(q);
const r1 = p.radius, r2 = p.radiusB ?? p.radius;
const G = (t: number) => { const P = [0, 1, 2].map(i => (1 - t) ** 2 * A[i] + 2 * (1 - t) * t * C[i] + t * t * B[i]); return Math.hypot(...P.map((v, i) => Q[i] - v)) - (r1 + (r2 - r1) * t); };
let bt = 0, bv = Infinity; for (let i = 0; i <= 20000; i++) { const v = G(i / 20000); if (v < bv) { bv = v; bt = i / 20000; } }
let lo = Math.max(0, bt - 1e-4), hi = Math.min(1, bt + 1e-4);
for (let i = 0; i < 100; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (G(m1) < G(m2)) hi = m2; else lo = m1; }
const truth = G((lo + hi) / 2) * ms;
console.log(`${n} worst bent prim (src ${p.src}): |cpu - truth| ${Math.abs(worst.cpu - truth).toExponential(2)}, |gpu - truth| ${Math.abs(worst.gpu - truth).toExponential(2)}, |gpu - cpu| ${worst.e.toExponential(2)}`);
