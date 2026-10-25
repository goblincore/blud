// scripts/bake-body-normal.ts
//
// Bake a character's BODY NORMAL MAP (spec docs/superpowers/specs/2026-10-21-body-normal-map-design.md):
//
//   npx tsx scripts/bake-body-normal.ts <character> [width] [torsoRows] [--limb bone:t0:t1:rMax:rows ...]
//     [--torso-axis hx,hy,hz:tx,ty,tz] [--torso-seg label:hx,hy,hz:tx,ty,tz:rMax:rows ...] [--cpu] [--shards N]
//     reads  src/lab/sdf-zombie/characters/<character>.blob
//            src/lab/sdf-zombie/characters/<character>.detail   (extra `body` lines, never marched)
//     writes public/assets/lab/<character>-body-n.png            (an atlas of tangent-space normals)
//            public/assets/lab/<character>-body-n.json           (the regions, for people and the loader)
//
// e.g. the twinhead:  npx tsx scripts/bake-body-normal.ts twinhead 512 256 \
//   --limb upperarm.l:0:1:0.17:96 --limb forearm.l:0:0.5:0.13:48 --limb upperarm.r:0:1:0.17:96 --limb forearm.r:0:0.5:0.13:48
//
// The bake itself lives in src/lab/sdf-zombie/body-normal-bake/: regions.ts (the bodies, the regions and their
// arguments), frame.ts (the tangent frame the shader must agree with, and the texel encode), header.ts (the
// region-table row and the sidecar), cpu-bake.ts (the reference backend over `sdBody`). This file is the CLI.
//
// BACKENDS (spec docs/superpowers/specs/2026-10-24-gpu-body-normal-bake-design.md). The GPU is the default: the same
// bake through WebGPU in Node (Dawn, scripts/lib/dawn-bake.ts), held to the CPU reference by `npm run test:gpu`
// (bake-parity.gpu.test.ts: every covered texel within one 8-bit code). Seconds instead of tens of minutes. With no
// WebGPU adapter it falls back to the CPU and says so; `--cpu` forces the CPU. The sidecar records which ran.
//
// --shards N (the CPU backend only) bakes on N cores: it re-runs itself as N children (`--cpu --shard k/N --shard-out
// <file>`), each baking every Nth texel row into a raw buffer, and stitches the rows back together. Same bytes as one
// process. The torso band of a long body marches nearly every detail prim per texel (its ray disc is 0.6 m wide), so
// one CPU process took over an hour on the gutcrawler's 768 x 1152 atlas and 3,700 detail prims (2026-10-24). On the
// GPU the option is ignored: the GPU bake takes seconds.
// The runtime (march/body/blocks/post/body-normal.wgsl.ts) rebuilds the frame at every hit and bends the shading
// normal by it.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeBodies, buildRegions } from '../src/lab/sdf-zombie/body-normal-bake/regions';
import { bakeRegionCpu } from '../src/lab/sdf-zombie/body-normal-bake/cpu-bake';
import type { Region } from '../src/lab/sdf-zombie/body-normal-bake/regions';
import { sidecar, writeHeader } from '../src/lab/sdf-zombie/body-normal-bake/header';
// @ts-expect-error -- a plain .mjs helper with no types
import { writePng } from './lib/png-write.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const limbArgs: string[] = [];
const segArgs: string[] = [];
const pos: string[] = [];
let torsoAxisArg: string | null = null;
let forceCpu = false;
let shards = 1, shardK = 0, shardN = 1, shardOut: string | null = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--cpu') forceCpu = true;
  else if (argv[i] === '--shards') shards = Math.max(1, Number(argv[++i]));
  else if (argv[i] === '--shard') [shardK, shardN] = argv[++i]!.split('/').map(Number) as [number, number];
  else if (argv[i] === '--shard-out') shardOut = argv[++i]!;
  else if (argv[i] === '--limb') limbArgs.push(argv[++i]!);
  else if (argv[i] === '--torso-axis') torsoAxisArg = argv[++i]!;
  else if (argv[i] === '--torso-seg') segArgs.push(argv[++i]!);
  else pos.push(argv[i]!);
}
const [name, wArg, hArg] = pos;
if (!name) { console.error('usage: bake-body-normal.ts <character> [width] [torsoRows] [--limb bone:t0:t1:rMax:rows ...]'); process.exit(2); }
const W = Number(wArg ?? 512), H = Number(hArg ?? 256);
const CH = resolve(ROOT, 'src/lab/sdf-zombie/characters');
const blobSrc = readFileSync(resolve(CH, `${name}.blob`), 'utf8');
const detailPath = resolve(CH, `${name}.detail`);
if (!existsSync(detailPath)) { console.error(`no ${name}.detail beside the .blob`); process.exit(2); }
const detailSrc = readFileSync(detailPath, 'utf8');

let bodies: ReturnType<typeof bakeBodies>, layout: ReturnType<typeof buildRegions>;
try {
  bodies = bakeBodies(blobSrc, detailSrc, name);
  layout = buildRegions(bodies.base, { torsoRows: H, torsoAxis: torsoAxisArg, limbs: limbArgs, torsoSegs: segArgs });
} catch (e) { console.error((e as Error).message); process.exit(2); }
const { base, detail } = bodies;
const { regions, height: TH } = layout;

// The backend: the GPU unless --cpu, or unless this machine has no WebGPU adapter. A shard child is always the CPU.
let bakeRegion: (rgba: Uint8Array, R: Region) => Promise<number> =
  async (rgba, R) => bakeRegionCpu(rgba, W, R, base, detail, row => row % shardN === shardK);
let backend = 'cpu', adapter: string | undefined, done = () => {};
if (!forceCpu && !shardOut) {
  const { dawnDevice } = await import('./lib/dawn-field');
  const gpu = await dawnDevice();
  if (!gpu) console.log('bake-body-normal: no WebGPU adapter, baking on the CPU (slow; --cpu says this on purpose)');
  else {
    const { GpuBaker } = await import('./lib/dawn-bake');
    const baker = await GpuBaker.create(gpu, base, detail);
    bakeRegion = (rgba, R) => baker.bakeRegion(rgba, W, R);
    backend = 'gpu'; adapter = gpu.adapter;
    done = () => { baker.destroy(); gpu.device.destroy(); };
  }
}
if (backend === 'gpu' && shards > 1) { console.log('bake-body-normal: --shards ignored on the GPU'); shards = 1; }
if (!shardOut) console.log(`bake-body-normal: ${backend}${adapter ? ` (${adapter})` : ''}${shards > 1 ? `, ${shards} shards` : ''}`);

const rgba = new Uint8Array(W * TH * 4);
const t0 = Date.now();
const shardCovered = new Map<string, number>();
if (shards > 1) {
  // The parent: run the shards, then stitch each one's rows (row % shards === k) into rgba.
  const dir = mkdtempSync(resolve(tmpdir(), 'bake-body-normal-'));
  const self = fileURLToPath(import.meta.url);
  const childArgs = argv.filter((a, i) => a !== '--shards' && argv[i - 1] !== '--shards' && a !== '--cpu');
  await Promise.all(Array.from({ length: shards }, (_, k) => new Promise<void>((ok, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, self, ...childArgs, '--cpu', '--shard', `${k}/${shards}`, '--shard-out', resolve(dir, `${k}.bin`)],
      { stdio: ['ignore', 'pipe', 'inherit'] });
    // Each shard prints `COVERED <region> <n>` per region; the parent sums them for the stats line.
    let out = '';
    child.stdout!.on('data', d => { out += d; });
    child.on('exit', code => {
      if (code !== 0) { fail(new Error(`shard ${k} exited ${code}`)); return; }
      for (const m of out.matchAll(/^COVERED (\S+) (\d+)$/gm)) shardCovered.set(m[1]!, (shardCovered.get(m[1]!) ?? 0) + Number(m[2]));
      ok();
    });
  })));
  for (let k = 0; k < shards; k++) {
    const part = readFileSync(resolve(dir, `${k}.bin`));
    for (let row = k; row < TH; row += shards) rgba.set(part.subarray(row * W * 4, (row + 1) * W * 4), row * W * 4);
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`  ${shards} shards stitched, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const stats: string[] = [];
for (const R of regions) {
  // A sharded parent bakes nothing itself (its shards did); a shard bakes only its own rows.
  const covered = shards > 1 ? shardCovered.get(R.label) ?? 0 : await bakeRegion(rgba, R);
  if (shardOut) { console.log(`COVERED ${R.label} ${covered}`); continue; }
  stats.push(`${R.label} ${(100 * covered / (W * R.rows)).toFixed(0)}%`);
  console.log(`  ${R.label}: rows ${R.row0}..${R.row0 + R.rows - 1}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
done();
if (shardOut) { writeFileSync(shardOut, rgba); process.exit(0); }
writeHeader(rgba, W, regions);

writeFileSync(resolve(ROOT, `public/assets/lab/${name}-body-n.png`), writePng(W, TH, rgba));
writeFileSync(resolve(ROOT, `public/assets/lab/${name}-body-n.json`), JSON.stringify({ ...sidecar(name, W, TH, regions), backend, ...(adapter ? { adapter } : {}) }, null, 2) + '\n');
console.log(`bake-body-normal: ${name} ${W}x${TH}, ${regions.length} regions (${stats.join(', ')}), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
