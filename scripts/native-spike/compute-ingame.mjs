// scripts/native-spike/compute-ingame.mjs
//
// THE COMPUTE MARCH IN THE GAME (?marchcompute; src/lab/sdf-zombie/webgpu/march-compute.ts). Boots sdf-game.html
// with the flag, stages a frozen scene, and times WHOLE FRAMES with the compute march on and off in alternation:
// one compiled page, the runtime switch (__sdfGame.setMarchCompute). A frame's time is wall-clock from the first
// hand-stepped frame to the GPU fence after the last, over FRAMES frames; ROUNDS rounds, the order flipped each
// round, with an off-against-off pair as the A/A control. It also compares the march target between the two (the
// light and probe clocks pinned, as march-hash.mjs pins them), from two hashes of a readback.
//
//   node scripts/native-spike/compute-ingame.mjs <vite-port> <cdp-port> <prelude.js> [out.json]
//   INGAME_FRAMES (default 30), INGAME_ROUNDS (default 8), INGAME_QUERY (default frozen=1&marchcompute)
//
// Run through servers.sh, under the GPU lock.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyShipDefaults, bootCloseupPage, connectGame, failHard, sleep } from '../lib/sdf-closeup-stage.mjs';
import { waitForLoader } from '../lib/wait-loader.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const PRELUDE = readFileSync(process.argv[4], 'utf8');
const OUT = process.argv[5] ?? '';
const FRAMES = Number(process.env.INGAME_FRAMES ?? 30);
const ROUNDS = Number(process.env.INGAME_ROUNDS ?? 8);
const QUERY = process.env.INGAME_QUERY ?? 'frozen=1&marchcompute';

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?${QUERY}` });
await waitForLoader(evaluate, { fail: failHard });
let crowd = 'pending';
for (let i = 0; i < 1200 && crowd !== 'ready' && crowd !== 'failed'; i++) {
  crowd = await evaluate('__sdfGame.warmBackground().crowd');
  if (crowd !== 'ready') await sleep(1000);
}
if (crowd !== 'ready') failHard(`the crowd program is ${crowd}`);
const ship = await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
await evaluate(PRELUDE);
// The first compute frame compiles the compute programs (tens of seconds cold); settle both paths.
const t0 = Date.now();
await evaluate('(async () => { __sdfGame.setMarchCompute(true); __sdfGame.step(12); await __sdfGame.resolveGpu(); __sdfGame.setMarchCompute(false); __sdfGame.step(12); await __sdfGame.resolveGpu(); return 1; })()', 900_000);
const settleS = (Date.now() - t0) / 1000;
const state = await evaluate('(() => { __sdfGame.setMarchCompute(true); __sdfGame.step(2); return JSON.stringify(__sdfGame.marchComputeState()); })()');
console.log(`settled in ${settleS.toFixed(0)} s; ${state}`);
const st = JSON.parse(state);
if (!st.compiled || !st.types.some((t) => t.frames > 0)) failHard('the compute march never dispatched');

const time = (on) => evaluate(`(async () => {
  __sdfGame.setMarchCompute(${on});
  __sdfGame.step(6);
  await __sdfGame.resolveGpu();
  const t0 = performance.now();
  __sdfGame.step(${FRAMES});
  await __sdfGame.resolveGpu();
  return (performance.now() - t0) / ${FRAMES};
})()`, 300_000);

const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  const order = r % 2 ? ['on', 'off', 'off2'] : ['off', 'off2', 'on'];
  const ms = {};
  for (const leg of order) ms[leg] = await time(leg === 'on');
  rows.push(ms);
  console.log(`  round ${String(r + 1).padStart(2)}  off ${ms.off.toFixed(2)}  off2 ${ms.off2.toFixed(2)} (${(ms.off2 - ms.off >= 0 ? '+' : '') + (ms.off2 - ms.off).toFixed(2)})  on ${ms.on.toFixed(2)} (${(ms.on - ms.off >= 0 ? '+' : '') + (ms.on - ms.off).toFixed(2)})`);
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const base = med(rows.map((r) => r.off));
const summary = {};
for (const leg of ['off2', 'on']) {
  const d = rows.map((r) => r[leg] - r.off);
  summary[leg] = { medianMs: med(rows.map((r) => r[leg])), diffMedianMs: med(d), diffMinMs: Math.min(...d), diffMaxMs: Math.max(...d), diffMedianPct: 100 * med(d) / base };
}
console.log(`\nwhole frame, ${FRAMES} frames a sample: off ${base.toFixed(2)} ms`);
for (const [leg, s] of Object.entries(summary)) console.log(`  ${leg.padEnd(5)} ${s.medianMs.toFixed(2)} ms  ${(s.diffMedianMs >= 0 ? '+' : '') + s.diffMedianMs.toFixed(2)} (${s.diffMinMs.toFixed(2)} .. ${s.diffMaxMs.toFixed(2)})  ${s.diffMedianPct.toFixed(1)} %`);
const passes = await evaluate('(async () => { __sdfGame.setMarchCompute(true); const p = await __sdfGame.passTimings(); return JSON.stringify(p).slice(0, 3000); })()').catch((e) => String(e));
if (OUT) writeFileSync(OUT, JSON.stringify({ query: QUERY, prelude: process.argv[4], frames: FRAMES, rounds: ROUNDS, ship, settleS, state: st, baseMs: base, summary, rows, passes }, null, 1));
process.exit(0);
