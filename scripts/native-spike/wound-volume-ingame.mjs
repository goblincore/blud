// scripts/native-spike/wound-volume-ingame.mjs
//
// THE BAKED WOUND VOLUME IN THE GAME, TIMED (?woundvol; src/lab/sdf-zombie/webgpu/wound-volume-store.ts). The flag
// is compiled in, so there is no runtime switch: each leg is a FRESH PAGE (sdf-game.html with or without the flag),
// staged by the prelude, then timed as WHOLE FRAMES (wall-clock from the first hand-stepped frame to the GPU fence
// after the last, as compute-ingame.mjs). A round loads off, on and off again (`off2`: the A/A control, a second
// load of the same page); the order flips each round.
//
//   node scripts/native-spike/wound-volume-ingame.mjs <vite-port> <cdp-port> <prelude.js> [out.json]
//   WV_FRAMES (default 30), WV_SAMPLES (default 3, the median is the leg's time), WV_ROUNDS (default 4),
//   WV_ON (default woundvol: the query that turns it on, e.g. woundvol=1.5), WV_SHOT (a path prefix for stills)
//
// Run through servers.sh, under the GPU lock.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyShipDefaults, bootCloseupPage, connectGame, failHard, sleep } from '../lib/sdf-closeup-stage.mjs';
import { waitForLoader } from '../lib/wait-loader.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const PRELUDE = readFileSync(process.argv[4], 'utf8');
const OUT = process.argv[5] ?? '';
const FRAMES = Number(process.env.WV_FRAMES ?? 30);
const SAMPLES = Number(process.env.WV_SAMPLES ?? 3);
const ROUNDS = Number(process.env.WV_ROUNDS ?? 4);
const ON = process.env.WV_ON ?? 'woundvol';

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800 });

const shot = {};
async function leg(on) {
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1${on ? '&' + ON : ''}` });
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
  await evaluate('(async () => { __sdfGame.step(12); await __sdfGame.resolveGpu(); return 1; })()', 600_000);
  // WV_SHOT=<path prefix>: one still of each page as staged (<prefix>-on.png, <prefix>-off.png).
  if (process.env.WV_SHOT && !shot[on]) {
    shot[on] = true;
    const { data } = (await send('Page.captureScreenshot', { format: 'png' })).result;
    writeFileSync(`${process.env.WV_SHOT}-${on ? 'on' : 'off'}.png`, Buffer.from(data, 'base64'));
  }
  const samples = [];
  for (let s = 0; s < SAMPLES; s++) {
    samples.push(await evaluate(`(async () => {
      __sdfGame.step(6);
      await __sdfGame.resolveGpu();
      const t0 = performance.now();
      __sdfGame.step(${FRAMES});
      await __sdfGame.resolveGpu();
      return (performance.now() - t0) / ${FRAMES};
    })()`, 300_000));
  }
  // What the page holds: the staged wounds, and the atlas when the flag is on (the module instance the page loaded).
  const census = await evaluate(`(async () => {
    // A fresh load serves the module at its plain path, so this import is the page's own instance.
    let atlas = null;
    if (${on}) { const m = await import('/src/lab/sdf-zombie/webgpu/wound-volume-store.ts'); atlas = m.woundVolumeAtlas().stats(); }
    return JSON.stringify({ wounds: window.__mobWounds ?? null, atlas });
  })()`).catch((e) => String(e));
  return { ms: med(samples), samples, census };
}

const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  const order = r % 2 ? ['on', 'off', 'off2'] : ['off', 'off2', 'on'];
  const row = {};
  for (const name of order) {
    row[name] = await leg(name === 'on');
    console.log(`  round ${r + 1} ${name.padEnd(4)} ${row[name].ms.toFixed(2)} ms  (${row[name].samples.map((x) => x.toFixed(2)).join(' ')})  ${row[name].census}`);
  }
  rows.push(row);
}
const base = med(rows.map((r) => r.off.ms));
const summary = {};
for (const name of ['off2', 'on']) {
  const d = rows.map((r) => r[name].ms - r.off.ms);
  summary[name] = { medianMs: med(rows.map((r) => r[name].ms)), diffMedianMs: med(d), diffMinMs: Math.min(...d), diffMaxMs: Math.max(...d), diffMedianPct: 100 * med(d) / base };
}
console.log(`\nwhole frame, ${FRAMES} frames a sample, ${SAMPLES} samples a load: off ${base.toFixed(2)} ms`);
for (const [name, s] of Object.entries(summary)) console.log(`  ${name.padEnd(5)} ${s.medianMs.toFixed(2)} ms  ${(s.diffMedianMs >= 0 ? '+' : '') + s.diffMedianMs.toFixed(2)} (${s.diffMinMs.toFixed(2)} .. ${s.diffMaxMs.toFixed(2)})  ${s.diffMedianPct.toFixed(1)} %`);
if (OUT) writeFileSync(OUT, JSON.stringify({ on: ON, prelude: process.argv[4], frames: FRAMES, samples: SAMPLES, rounds: ROUNDS, baseMs: base, summary, rows }, null, 1));
process.exit(0);
