// The coneBend polish's GPU cost, leaf only: the bake field (the game's leaf WGSL) over a whole body at 262144
// points, 20 dispatches per submit (one upload, one readback), reported per dispatch. BEFORE (CONE_BEND's text at
// <rev>) and AFTER (this tree) alternate in one process, 7 rounds after a warm-up each, so machine drift hits both.
//   npx tsx docs/dev-notes/2026-10-24-gpu-bake-parity/field-microbench.mts [rev=HEAD]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildFromBlob } from '../../../src/lab/sdf-zombie/body-normal-bake/regions';
import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { fieldShaderSource } from '../../../src/lab/sdf-zombie/body-normal-bake/bake.wgsl';
import { CONE_BEND } from '../../../src/lab/sdf-zombie/webgpu/march/primitives.wgsl';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
import { samplePoints } from '../../../scripts/body-normal-bake/gpu-parity-lib';

const rev = process.argv[2] ?? 'HEAD';
const oldFile = execFileSync('git', ['show', `${rev}:src/lab/sdf-zombie/webgpu/march/primitives.wgsl.ts`], { encoding: 'utf8' });
const oldCone = oldFile.slice(oldFile.indexOf('fn coneBend('), oldFile.indexOf('}`;', oldFile.indexOf('fn coneBend(')) + 1);
const after = fieldShaderSource(), before = after.replace(CONE_BEND, oldCone);
const gpu = (await dawnDevice())!;
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
for (const name of ['twinhead', 'cyclops', 'teratoma', 'zombie']) {
  const body = buildFromBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
  const bent = body.prims.filter(p => p.bend !== undefined).length;
  const packed = packBakeBody(body), pts = samplePoints(body, 262144, 9);
  const fields = [await GpuField.create(gpu, packed, before), await GpuField.create(gpu, packed, after)];
  const times: number[][] = [[], []];
  for (const f of fields) await f.evaluate(pts, 0, f.listLength, 20);
  for (let round = 0; round < 7; round++) for (const k of [0, 1]) {
    const t = performance.now(); await fields[k]!.evaluate(pts, 0, fields[k]!.listLength, 20); times[k]!.push((performance.now() - t) / 20);
  }
  const [b, a] = times.map(med) as [number, number];
  console.log(`${name} (${body.prims.length} prims, ${bent} bent): before ${b.toFixed(2)} ms, after ${a.toFixed(2)} ms (${((a / b - 1) * 100).toFixed(1)}%)`);
  for (const f of fields) f.destroy();
}
