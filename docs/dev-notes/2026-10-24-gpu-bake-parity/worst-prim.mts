import { readFileSync } from 'node:fs';
import { buildFromBlob, withDetail } from '../../../src/lab/sdf-zombie/body-normal-bake/regions';
import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { sdPrimitive, smin, sminChamfer, sdBody } from '../../../src/lab/sdf-zombie/validate';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
import { samplePoints } from '../../../scripts/body-normal-bake/gpu-parity-lib';
const CH = 'src/lab/sdf-zombie/characters', n = process.argv[2]!;
const body = buildFromBlob(withDetail(readFileSync(`${CH}/${n}.blob`, 'utf8'), readFileSync(`${CH}/${n}.detail`, 'utf8'), n));
const gpu = (await dawnDevice())!;
const pk = packBakeBody(body); const f = await GpuField.create(gpu, pk);
const pts = samplePoints(body, 1500, 11); const got = await f.evaluate(pts);
let wj = 0, we = 0; for (let j = 0; j < 1500; j++) { const p: any = [pts[j*3], pts[j*3+1], pts[j*3+2]]; const e = Math.abs(got[j]! - sdBody(p, body)); if (e > we) { we = e; wj = j; } }
const p: any = [pts[wj*3], pts[wj*3+1], pts[wj*3+2]]; console.log('worst', p, we);
// prefix folds: CPU vs GPU
const list = [...pk.list]; const P = new Float32Array(p);
let d = 1e9; const cpuPrefix: number[] = [];
for (const i of list) { const pr = body.prims[i]!; if (!pr.op || pr.op === 'add') { if (!pr.dead) { const s = sdPrimitive(p, pr); d = pr.blendProfile === 'chamfer' ? sminChamfer(d, s, pr.blendK) : smin(d, s, pr.blendK); } } cpuPrefix.push(d); }
let prev = 0;
for (let k = 1; k <= list.length; k++) {
  const g = (await f.evaluate(P, 0, k))[0]!; const e = Math.abs(g - cpuPrefix[k - 1]!);
  if (e > 5e-7 && e > prev * 3) { const pr = body.prims[list[k-1]!]!; console.log('jump at', k, 'prim', list[k-1], 'err', e, 'prev', prev, 'prim sd cpu', sdPrimitive(p, pr), JSON.stringify({ a: pr.a, b: pr.b, r: pr.radius, r2: pr.radiusB, s: pr.scale, k: pr.blendK, bend: pr.bend, src: pr.src })); }
  prev = e;
}
