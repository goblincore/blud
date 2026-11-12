// scripts/native-spike/frame-breakdown.mjs
//
// WHERE A STAGED FRAME'S TIME GOES. Boots sdf-game.html, stages a frozen scene with a prelude (as
// wound-volume-ingame.mjs), then steps it a frame at a time and reads three clocks for each frame:
//
//   wall   performance.now() from before the step to after the GPU fence (what the timing scripts report)
//   cpu    the step call alone: the tick, the uploads and the encoding of the frame's passes (it returns before
//          the GPU has drawn)
//   gpu    the page's timestamp queries (__sdfGame.passTimings()), one sample a labelled pass
//
// A pass's own `ms` is not its cost here: on this GPU the passes of a frame overlap in time (one that starts at 7
// ms and ends at 39 was mostly waiting on the pass before it). So the passes are ordered by when they END, and a
// pass is charged the time between the end before it and its own end. Passes with the same label are summed.
//
//   node scripts/native-spike/frame-breakdown.mjs <vite-port> <cdp-port> <prelude.js> [out.json]
//   FB_QUERY (default empty: extra query, e.g. woundgrid), FB_FRAMES (default 40), FB_SKIP (default 8, settling)
//   FB_MODES (default 0): march debug modes to time in turn on the one page (__sdfGame.setMarchDebugMode).
//     0  the shipped frame
//     13 the walk only: the march returns its counters right after the walk loop, before any shading
//     14 everything, with the counters on (what mode 13's counters cost: compare with 0)
//   so 0 against 13 splits a march pass into its walk and what comes after the hit.
//
// Run through servers.sh, under the GPU lock.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyShipDefaults, bootCloseupPage, connectGame, failHard, sleep } from '../lib/sdf-closeup-stage.mjs';
import { waitForLoader } from '../lib/wait-loader.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const PRELUDE = readFileSync(process.argv[4], 'utf8');
const OUT = process.argv[5] ?? '';
const QUERY = process.env.FB_QUERY ?? '';
const FRAMES = Number(process.env.FB_FRAMES ?? 40);
const SKIP = Number(process.env.FB_SKIP ?? 8);
const MODES = (process.env.FB_MODES ?? '0').split(',').map(Number);

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1${QUERY ? '&' + QUERY : ''}` });
await waitForLoader(evaluate, { fail: failHard });
let crowd = 'pending';
for (let i = 0; i < 1200 && crowd !== 'ready' && crowd !== 'failed'; i++) {
  crowd = await evaluate('__sdfGame.warmBackground().crowd');
  if (crowd !== 'ready') await sleep(1000);
}
if (crowd !== 'ready') failHard(`the crowd program is ${crowd}`);
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
await evaluate(PRELUDE);
await evaluate('(async () => { __sdfGame.step(12); await __sdfGame.resolveGpu(); await __sdfGame.passTimings(); return 1; })()', 600_000);

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const family = (l) => l.startsWith('sdf:upscale') ? 'sdf:upscale (all)' : l;
const report = [];
for (const mode of MODES) {
  const frames = JSON.parse(await evaluate(`(async () => {
    __sdfGame.setMarchDebugMode(${mode});
    const out = [];
    for (let f = 0; f < ${FRAMES + SKIP}; f++) {
      const t0 = performance.now();
      __sdfGame.step(1);
      const t1 = performance.now();
      await __sdfGame.resolveGpu();
      const t2 = performance.now();
      const p = await __sdfGame.passTimings();
      out.push({ cpu: t1 - t0, wall: t2 - t0, samples: (p && p.samples) || [], installed: !!(p && p.installed) });
    }
    __sdfGame.setMarchDebugMode(0);
    return JSON.stringify(out);
  })()`, 900_000)).slice(SKIP);
  if (!frames.some((f) => f.installed && f.samples.length)) failHard('no pass timings: timestamp queries are not installed on this page');
  // One frame: its passes by end time, each charged the gap to the end before it (the first: its own length).
  const perLabel = new Map();
  const gpuTotals = [];
  let used = 0;
  for (const f of frames) {
    if (!f.samples.length) continue;
    used++;
    const s = [...f.samples].sort((a, b) => a.end - b.end);
    const own = new Map();
    const first = Math.min(...s.map((x) => x.start));
    let prev = first;
    for (const x of s) { own.set(x.label, (own.get(x.label) ?? 0) + Math.max(0, x.end - prev)); prev = Math.max(prev, x.end); }
    gpuTotals.push(prev - first);
    for (const [k, v] of own) { if (!perLabel.has(k)) perLabel.set(k, []); perLabel.get(k).push(v); }
  }
  const rows = [...perLabel].map(([label, v]) => ({ label, ms: med(v.concat(Array(Math.max(0, used - v.length)).fill(0))) })).sort((a, b) => b.ms - a.ms);
  const wall = med(frames.map((f) => f.wall)), cpu = med(frames.map((f) => f.cpu)), gpu = med(gpuTotals);
  console.log(`\n${QUERY || '(default)'}, march debug mode ${mode}: ${used} frames with pass timings of ${frames.length}`);
  console.log(`  wall ${wall.toFixed(2)} ms   cpu (the step call) ${cpu.toFixed(2)} ms   gpu (first pass start to last pass end) ${gpu.toFixed(2)} ms`);
  const fam = new Map();
  for (const r of rows) fam.set(family(r.label), (fam.get(family(r.label)) ?? 0) + r.ms);
  for (const [label, ms] of [...fam].sort((a, b) => b[1] - a[1])) if (ms >= 0.05) console.log(`  ${ms.toFixed(2).padStart(7)} ms  ${(100 * ms / gpu).toFixed(1).padStart(5)} %  ${label}`);
  report.push({ mode, frames: used, wallMs: wall, cpuMs: cpu, gpuMs: gpu, rows });
}
if (OUT) writeFileSync(OUT, JSON.stringify({ query: QUERY, prelude: process.argv[4], modes: report }, null, 1));
process.exit(0);
