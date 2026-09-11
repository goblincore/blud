// scripts/upscale-trained-parity.ts — G3 parity for a trained export: the TypeScript twin (both
// layouts, no float16 emulation) against PyTorch's reconstruction in <export>/parity
// (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §3).
// Usage: npx tsx scripts/upscale-trained-parity.ts <export dir with model.json and parity/>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeNpy } from './lib/npy.mjs';
import { compareReconstruction } from './lib/upscale-parity-compare';
import { parseUpscaleModelJson } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-model';
import { upscaleReference, type FloatImage } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-reference';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npx tsx scripts/upscale-trained-parity.ts <export dir>');
  process.exit(2);
}
const model = parseUpscaleModelJson(JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8')));
const meta = JSON.parse(readFileSync(join(dir, 'parity', 'meta.json'), 'utf8')) as {
  near: number; far: number; fixtures: Array<{ pair: string; input: string; output: string }>;
};
const image = (file: string): FloatImage => {
  const { shape, data } = decodeNpy(readFileSync(join(dir, 'parity', file)));
  if (shape.length !== 3 || shape[2] !== 4) throw new Error(`${file}: shape (${shape.join(', ')}), expected (h, w, 4)`);
  return { h: shape[0]!, w: shape[1]!, c: 4, data };
};

console.log(`model ${model.id} ${model.inputs} source ${model.source} run ${model.run ?? '-'} step ${model.step ?? '-'} weightHash ${model.weightHash}`);
let ok = meta.fixtures.length > 0;
for (const f of meta.fixtures) {
  const input = image(f.input);
  const expected = image(f.output);
  if (expected.w !== input.w * 2 || expected.h !== input.h * 2) throw new Error(`${f.pair}: output is not 2x the input`);
  for (const layout of ['sp', 'dc'] as const) {
    const margin = new Float32Array(expected.w * expected.h);
    const ours = upscaleReference(input, model, layout, meta.near, meta.far, expected.w, expected.h, { marginOut: margin });
    const r = compareReconstruction(ours, expected, margin);
    ok = ok && r.pass;
    console.log(`${f.pair} ${layout}: covered ${r.covered}/${r.pixels} maxRelRgb ${r.maxRelRgb.toExponential(2)} `
      + `depthMismatch ${r.depthMismatch} coverageMismatch ${r.coverageMismatch} (outside band ${r.coverageMismatchFar}) ${r.pass ? 'PASS' : 'FAIL'}`);
  }
}
console.log(ok ? 'G3: PASS' : 'G3: FAIL');
process.exit(ok ? 0 : 1);
