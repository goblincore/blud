// scripts/body-normal-bake/rebake-all.ts
//
// Rollout step 3 (spec 2026-10-24-gpu-body-normal-bake-design.md): re-bake EVERY committed body normal map on the
// GPU from bake-args.json, into <out>/ (never public/: the owner looks first), with a report per character:
//   - the change against the committed map: texels whose bytes differ, a histogram of the largest channel change;
//   - a sheet, committed | GPU | |diff| x 8;
//   - backend parity on the NEW layout: GPU vs the CPU reference at 300 seeded texels (bake-parity-lib.ts), which
//     separates "the backend differs" (should be <= 1 code) from "the committed map is stale against its .blob and
//     .detail" (gamer's and teratoma's torso axes moved after they were baked; check-bake-args.test.ts).
//   npx tsx scripts/body-normal-bake/rebake-all.ts [outDir=.lab-tmp/rebake] [character ...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bakeBodies, buildRegions } from '../../src/lab/sdf-zombie/body-normal-bake/regions';
import { sidecar, writeHeader } from '../../src/lab/sdf-zombie/body-normal-bake/header';
import { dawnDevice } from '../lib/dawn-field';
import { GpuBaker } from '../lib/dawn-bake';
// @ts-expect-error -- plain .mjs helpers with no types
import { writePng } from '../lib/png-write.mjs';
// @ts-expect-error -- plain .mjs helpers with no types
import { decodePng } from '../lib/demo-presented.mjs';
import { committedBakes } from './bake-args';
import { compareBake, describeBake } from './bake-parity-lib';

const [outDir = '.lab-tmp/rebake', ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const gpu = await dawnDevice();
if (!gpu) { console.error('rebake-all: no WebGPU adapter'); process.exit(2); }
const CH = 'src/lab/sdf-zombie/characters', LAB = 'public/assets/lab';
const report: string[] = [`# GPU re-bake of every committed body normal map\n`, `Adapter: ${gpu.adapter}\n`,
  '| character | size | GPU bake | texels changed vs committed | of those > 4 codes | > 32 codes | backend parity (300 samples) |',
  '| --- | --- | --- | --- | --- | --- | --- |'];

for (const [name, args] of committedBakes()) {
  if (only.length && !only.includes(name)) continue;
  const { base, detail } = bakeBodies(readFileSync(`${CH}/${name}.blob`, 'utf8'), readFileSync(`${CH}/${name}.detail`, 'utf8'), name);
  const { regions, height } = buildRegions(base, args.regions);
  const W = args.width, rgba = new Uint8Array(W * height * 4);
  const t0 = performance.now();
  const baker = await GpuBaker.create(gpu, base, detail);
  for (const R of regions) await baker.bakeRegion(rgba, W, R);
  baker.destroy();
  const ms = performance.now() - t0;
  writeHeader(rgba, W, regions);
  writeFileSync(`${outDir}/${name}-body-n.png`, writePng(W, height, rgba));
  writeFileSync(`${outDir}/${name}-body-n.json`, JSON.stringify({ ...sidecar(name, W, height, regions), backend: 'gpu', adapter: gpu.adapter }, null, 2) + '\n');

  // Against the committed map (same size unless the layout changed).
  const old = decodePng(readFileSync(`${LAB}/${name}-body-n.png`));
  let changed = 0, over4 = 0, over32 = 0;
  const sameSize = old.w === W && old.h === height;
  const sheetW = W * 3 + 16, sheetH = Math.max(old.h, height), sheet = new Uint8Array(sheetW * sheetH * 4).fill(255);
  const put = (x: number, y: number, r: number, g: number, b: number) => { const o = (y * sheetW + x) * 4; sheet[o] = r; sheet[o + 1] = g; sheet[o + 2] = b; sheet[o + 3] = 255; };
  for (let y = 0; y < sheetH; y++) for (let x = 0; x < W; x++) {
    const oi = (y * old.w + x) * old.ch, ni = (y * W + x) * 4;
    if (y < old.h && x < old.w) put(x, y, old.data[oi], old.data[oi + 1], old.data[oi + 2]);
    if (y < height) put(W + 8 + x, y, rgba[ni]!, rgba[ni + 1]!, rgba[ni + 2]!);
    if (sameSize && y > 0) {
      const d = Math.max(...[0, 1, 2].map(c => Math.abs(old.data[oi + c] - rgba[ni + c]!)));
      if (d) changed++;
      if (d > 4) over4++;
      if (d > 32) over32++;
      const v = Math.min(255, d * 8);
      put(2 * W + 16 + x, y, v, v, v);
    }
  }
  writeFileSync(`${outDir}/${name}-sheet.png`, writePng(sheetW, sheetH, sheet));
  const parity = await compareBake(gpu, name, W, args.regions, 300);
  const texels = W * (height - 1);
  const pct = (n: number) => `${n} (${(100 * n / texels).toFixed(1)} %)`;
  report.push(`| ${name} | ${W}x${height}${sameSize ? '' : ` (was ${old.w}x${old.h})`} | ${(ms / 1000).toFixed(1)} s | ${sameSize ? pct(changed) : 'layout changed'} | ${sameSize ? pct(over4) : '-'} | ${sameSize ? pct(over32) : '-'} | mismatch ${parity.coverageMismatch}, max ${parity.maxCode} codes |`);
  console.log(`${name}: ${(ms / 1000).toFixed(1)} s, changed ${changed}/${texels}, >4 ${over4}, >32 ${over32}; parity ${describeBake(parity)}`);
}
writeFileSync(`${outDir}/REPORT.md`, report.join('\n') + '\n');
console.log(`report: ${outDir}/REPORT.md`);
gpu.device.destroy();
