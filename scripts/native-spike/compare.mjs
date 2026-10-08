// scripts/native-spike/compare.mjs
//
// NATIVE-RENDERER SPIKE, step 3: the A/B. Runs the four replays of one
// capture in ALTERNATION — on a fanless machine the thermal ramp between two
// back-to-back blocks is as large as the effect being measured — and prints
// one table.
//
//   chrome            the capture as recorded, bare WebGPU in the lab Chrome
//   chrome:naga       the naga-compat rewrite in Chrome (is the rewrite neutral?)
//   wgpu              the rewrite through wgpu, naga's runtime checks on
//   wgpu-unchecked    the same with bounds checks and loop bounding off
//
// Run under scripts/native-spike/servers.sh so the Chrome stays up:
//   scripts/native-spike/servers.sh node scripts/native-spike/compare.mjs <capture-dir> [reps]
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? '.scratch/native-spike/capture';
const REPS = Number(process.argv[3] ?? 5);
const REPEAT = process.env.SPIKE_REPEAT ?? '10';
const ROUNDS = process.env.SPIKE_ROUNDS ?? '15';
const CDP = process.env.LAB_CDP_PORT ?? '9291';
const NATIVE = 'native/march-replay/target/release/march-replay';

if (!existsSync(NATIVE)) { console.error(`build it first: (cd native/march-replay && cargo build --release)`); process.exit(1); }
if (!existsSync(join(DIR, 'manifest.naga.json'))) execFileSync('node', ['scripts/native-spike/naga-compat.mjs', DIR], { stdio: 'inherit' });

const last = (out) => JSON.parse(out.trim().split('\n').pop());
const chrome = (manifest) => () => last(execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, DIR, REPEAT, ROUNDS, manifest], { encoding: 'utf8' }));
const native = (...flags) => () => last(execFileSync(NATIVE, [DIR, '--repeat', REPEAT, '--rounds', ROUNDS, ...flags], { encoding: 'utf8' }));
const legs = {
  chrome: chrome('manifest.json'),
  'chrome:naga': chrome('manifest.naga.json'),
  wgpu: native(),
  'wgpu-unchecked': native('--unchecked'),
};

// One throwaway run of each first: the cold Metal compile of the march
// shader is tens of seconds and heats the machine before anything is timed.
for (const [name, run] of Object.entries(legs)) { process.stdout.write(`warm ${name}... `); run(); }
console.log('');

const runs = Object.fromEntries(Object.keys(legs).map((k) => [k, []]));
for (let rep = 0; rep < REPS; rep++) {
  // Rotate the order so no leg always runs first (coolest) or last.
  const names = Object.keys(legs);
  const order = names.map((_, i) => names[(i + rep) % names.length]);
  for (const name of order) {
    const r = legs[name]();
    if (r.parity.some((p) => p.differingFrac > 0.001)) { console.error(`${name}: the replayed image does not match the game's`, r.parity); process.exit(1); }
    runs[name].push(r);
    console.log(`  rep ${rep + 1} ${name.padEnd(15)} median ${r.medianMs.toFixed(2)} ms  min ${r.minMs.toFixed(2)}${r.gpuMedianMs ? `  gpu ${r.gpuMedianMs.toFixed(2)}` : ''}`);
  }
}

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const base = med(runs.chrome.map((r) => r.medianMs));
console.log(`\n${'leg'.padEnd(16)}${'median ms'.padStart(10)}${'best ms'.padStart(10)}${'range of medians'.padStart(20)}${'vs chrome'.padStart(11)}`);
const table = [];
for (const [name, rs] of Object.entries(runs)) {
  const medians = rs.map((r) => r.medianMs);
  const row = { leg: name, medianMs: med(medians), bestMs: Math.min(...rs.map((r) => r.minMs)), lo: Math.min(...medians), hi: Math.max(...medians) };
  table.push(row);
  console.log(`${name.padEnd(16)}${row.medianMs.toFixed(2).padStart(10)}${row.bestMs.toFixed(2).padStart(10)}${`${row.lo.toFixed(2)}..${row.hi.toFixed(2)}`.padStart(20)}${`${((row.medianMs / base - 1) * 100).toFixed(1)}%`.padStart(11)}`);
}
writeFileSync(join(DIR, 'compare.json'), JSON.stringify({ reps: REPS, repeat: Number(REPEAT), rounds: Number(ROUNDS), table, runs }, null, 1));
