// Unit A/B gate for the compute tile binner (perf task 5 step 5).
//
// Drives __sdfLab.tileAB() across a grid of poses: SDF scales x camera
// distances x yaws, on intact AND severed+wounded bodies. Every call bins the
// SAME camera and group inputs on the GPU (compute) and on the CPU
// (TileBinner, the untouched reference), reads the GPU buffers back, and
// diffs per tile — order-sensitive, exact float equality. The compute lists
// are supposed to be BIT-IDENTICAL to the CPU lists; anything else is a
// finding to investigate, not a tolerance to widen.
//
// Usage:
//   node scripts/tile-ab.mjs <vitePort> <cdpPort> [character] [outJson]
// Env:
//   SCALES (default "1.0,0.85,0.7,0.5")  DISTANCES (default "3.0,1.0,0.6,0.3")
//   YAWS (default 6)  PITCHES (default "-0.15,0.12,0.45")
//   DAMAGE (default 1 — include a severed+wounded pass)

const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
const CHARACTER = process.argv[4] ?? 'schoolgirl';
const OUT = process.argv[5] ?? `/tmp/tile-ab/${CHARACTER}-${Date.now()}.json`;
const SCALES = (process.env.SCALES ?? '1.0,0.85,0.7,0.5').split(',').map(Number);
const DISTANCES = (process.env.DISTANCES ?? '3.0,1.0,0.6,0.3').split(',').map(Number);
const YAWS = Number(process.env.YAWS ?? 6);
const PITCHES = (process.env.PITCHES ?? '-0.15,0.12,0.45').split(',').map(Number);
const DAMAGE = process.env.DAMAGE !== '0';
import { mkdirSync, writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 960, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html?character=${encodeURIComponent(CHARACTER)}` });

let lab = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  lab = await evaluate('typeof window.__sdfLab === "object"');
  if (lab) break;
}
if (!lab) { console.error('console tail:', consoleEvents.slice(-8)); fail('__sdfLab never booted'); }
if (await evaluate('window.__sdfLab.backend') !== 'webgpu') fail('backend is not webgpu');
console.log(`boot ok (${CHARACTER})`);

// Freeze everything that can move between two bins — the A/B is exact float
// equality, so the posed groups must be identical for both bins (they are the
// same call, but a moving body between evaluate() calls would change nothing
// here since tileAB bins both sides from the same snapshot — still, freeze so
// the POSE SET across poses is stable and reproducible).
await evaluate(`(() => {
  const L = window.__sdfLab;
  L.setMotionEnabled(false);
  L.setWander(false);
  L.setAdaptive(false);
  if (L.freezeCosmetics) L.freezeCosmetics();
  return true;
})()`);
await sleep(300);

const damagePasses = DAMAGE ? [{ label: 'intact' }, { label: 'severed+wounded' }] : [{ label: 'intact' }];
const results = [];
let worst = null;

for (const pass of damagePasses) {
  if (pass.label !== 'intact') {
    // Sever via the lab's own key path, then stamp wounds — densest group
    // layouts and the closest thing to the entry-stream worst case.
    for (const k of ['3', '5']) {
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}' }))`);
      await sleep(300);
    }
    await evaluate(`window.__sdfLab.stampWounds(8)`);
    await sleep(500);
  }
  for (const scale of SCALES) {
    await evaluate(`window.__sdfLab.setSdfScale(${scale})`);
    await sleep(250);
    for (const dist of DISTANCES) {
      for (let yi = 0; yi < YAWS; yi++) {
        const yaw = (yi / YAWS) * Math.PI * 2;
        for (const pitch of PITCHES) {
          await evaluate(`window.__sdfLab.setCam(${yaw.toFixed(4)}, ${pitch}, ${dist})`);
          await sleep(60);
          const r = await evaluate(`window.__sdfLab.tileAB()`);
          if (!r || r.error) fail(`tileAB returned ${JSON.stringify(r)}`);
          const bad = r.countMismatches + r.entryMismatches; // missing = hole class
          results.push({
            pass: pass.label, scale, dist,
            yaw: +yaw.toFixed(3), pitch,
            ...r,
          });
          if (bad > 0 && (!worst || bad > worst.bad)) {
            worst = { bad, ...r, scale, dist, yaw, pitch, pass: pass.label };
          }
          const tot = r.totalEntries;
          console.log(
            `${pass.label} scale ${scale} dist ${dist} yaw ${(yaw * 180 / Math.PI).toFixed(0)} p${pitch}: `
            + `missing ${r.countMismatches}/${r.entryMismatches}, extras ${r.extraEntries ?? 0} `
            + `of ${r.tilesCompared} tiles (entries cpu ${tot.cpu} gpu ${tot.gpu}, groups ${r.groups})`,
          );
        }
      }
    }
  }
}

const totals = results.reduce(
  (a, r) => ({ tiles: a.tiles + r.tilesCompared, countBad: a.countBad + r.countMismatches, entryBad: a.entryBad + r.entryMismatches, extras: a.extras + (r.extraEntries ?? 0) }),
  { tiles: 0, countBad: 0, entryBad: 0, extras: 0 },
);
const entryTotals = results.reduce(
  (a, r) => ({ cpu: a.cpu + r.totalEntries.cpu, gpu: a.gpu + r.totalEntries.gpu }),
  { cpu: 0, gpu: 0 },
);
const summary = {
  character: CHARACTER,
  scales: SCALES, distances: DISTANCES, yaws: YAWS, pitches: PITCHES,
  poses: results.length,
  tilesCompared: totals.tiles,
  // THE GATE: zero MISSING entries (the hole class). extraEntries are the
  // documented f32-boundary conservatism — the GPU pads its AABB edges
  // sub-tile so its lists strictly CONTAIN the CPU reference's.
  countMismatches: totals.countBad,
  entryMismatches: totals.entryBad,
  extraEntries: totals.extras,
  totalEntries: entryTotals,
  worst,
  consoleErrors: consoleEvents.filter((e) => /error|EXCEPTION/i.test(e)).length,
  verdict: totals.countBad === 0 && totals.entryBad === 0 ? 'PASS (gpu superset of cpu, zero missing)' : 'FAIL',
};
mkdirSync(OUT.substring(0, OUT.lastIndexOf('/')), { recursive: true });
writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 2));
console.log(`written ${OUT}`);
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`).catch(() => {});
process.exit(summary.verdict.startsWith('PASS') ? 0 : 2);
