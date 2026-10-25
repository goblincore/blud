// Every bent prim of every shipped .blob (base body, what the game marches) and of every .detail body, evaluated
// ALONE at 2000 points on the GPU bake field vs sdBody: which prims carry the f32 conditioning error.
//   npx tsx docs/dev-notes/2026-10-24-gpu-bake-parity/bend-survey.mts [base|detail]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { buildFromBlob, withDetail } from '../../../src/lab/sdf-zombie/body-normal-bake/regions';
import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { sdBody } from '../../../src/lab/sdf-zombie/validate';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
import { samplePoints } from '../../../scripts/body-normal-bake/gpu-parity-lib';
const CH = 'src/lab/sdf-zombie/characters', mode = process.argv[2] ?? 'base';
const gpu = (await dawnDevice())!;
const names = readdirSync(CH).filter(f => f.endsWith(mode === 'base' ? '.blob' : '.detail')).map(f => f.replace(/\.(blob|detail)$/, '')).sort();
let total = 0, bad = 0, worst = 0;
for (const n of names) {
  const src = readFileSync(`${CH}/${n}.blob`, 'utf8');
  const body = buildFromBlob(mode === 'base' ? src : withDetail(src, readFileSync(`${CH}/${n}.detail`, 'utf8'), n));
  const bent = body.prims.filter(p => p.bend !== undefined && !p.dead && p.op !== 'bone' && p.op !== 'organ');
  if (!bent.length) continue;
  const singles = bent.map(p => ({ prims: [{ ...p, op: 'add' as const, cluster: 0 }], clusters: [{ id: 0, limb: p.limb, start: 0, count: 1, center: [0, 0, 0], radius: 1, alive: true }] } as any));
  let nb = 0, w = 0;
  for (const b of singles) {
    const f = await GpuField.create(gpu, packBakeBody(b)); const pts = samplePoints(b, 2000, 5); const got = await f.evaluate(pts); f.destroy();
    let e = 0; for (let j = 0; j < 2000; j++) e = Math.max(e, Math.abs(got[j]! - sdBody([pts[j * 3]!, pts[j * 3 + 1]!, pts[j * 3 + 2]!], b)));
    if (e > 2e-6) nb++; w = Math.max(w, e);
  }
  total += bent.length; bad += nb; worst = Math.max(worst, w);
  console.log(`${n}: ${bent.length} bent prims, ${nb} over 2e-6, worst ${w.toExponential(2)}`);
}
console.log(`ALL (${mode}): ${total} bent prims, ${bad} over 2e-6, worst ${worst.toExponential(2)}`);
