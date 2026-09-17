// scripts/tmp/tstart-artifact-check.mjs — does the aggressive temporal start
// CHANGE what renders? (2026-09-10 follow-up.) The start bound may only skip
// PROVEN-EMPTY space, so with the scene frozen and the camera fixed, on and
// off must render the identical image. Any pixel that differs is either a
// skipped surface (artifact — the 2026-09-10 see-through class) or noise.
//
// Scene: the close-up staging library's frozen wounded fill-screen body.
// Legs: off (tstart=0) vs adaptive (the full new behaviour). Each leg steps
// 60 frames after its flip (bound change settles; no temporal accumulation
// in this pipeline — FXAA is spatial), then the canvas is screenshot. The
// diff runs in the page itself (two data-URI images through a canvas) and
// writes both captures plus a heatmap PNG to TSTART_ART_OUT.
//
// Usage: node scripts/tmp/tstart-artifact-check.mjs <vitePort> <cdpPort>
import { writeFileSync, mkdirSync } from 'node:fs';
import { connectGame, bootCloseupPage, applyShipDefaults, stageCloseUp, stampFacingWounds, sleep } from '../lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5299);
const CDP = Number(process.argv[3] ?? 9299);
const OUT = process.env.TSTART_ART_OUT ?? '/tmp/sdf-tstart-ab/art';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (12 min)'); process.exit(3); }, 12 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800 });
const evaluate = conn.evaluate;

await bootCloseupPage({ send: conn.send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
await applyShipDefaults(evaluate);
await evaluate(`__sdfGame.setVhs(null)`); // animated grain — the whole noise floor
// TSTART_FIELD=off isolates the march from the bodies-field weave (the
// interleave's depth test flips whole rows when the march's accepted depth
// moves a hair — horizontal striping on the body).
if (process.env.TSTART_FIELD === 'off') await evaluate(`__sdfGame.setFieldStyle('off')`);
const staging = await stageCloseUp(evaluate, undefined, fail);
if (staging.error) fail(staging.error);
const wound = await stampFacingWounds(evaluate, { minStamped: 3 }, fail);
console.log(`staged: d=${staging.d?.toFixed(2)} cov=${(staging.cov * 100)?.toFixed(0)}% wounds=${wound?.wounds}`);
await evaluate('__sdfGame.step(600)'); // settle: blood to rest, history fills

const capture = async () => {
  const shot = await conn.send('Page.captureScreenshot', { format: 'png' });
  return shot.result.data; // base64
};

const runLeg = async (legJs) => {
  await evaluate(`(async () => { ${legJs} })()`);
  await evaluate('__sdfGame.step(60)');
  return capture();
};

const legOff = await runLeg(`__sdfGame.setTemporalStart(false)`);
// TSTART_PIN='{"0.15":"..."}' style override: an explicit margin pins the
// margin AND disables the adaptation (seam contract) — used to bisect the
// banding threshold. Default legs: adaptive (the new behaviour) + pinned 0.25.
const pinEnv = process.env.TSTART_PIN ? Number(process.env.TSTART_PIN) : null;
const legNew = await runLeg(pinEnv != null
  ? `__sdfGame.setTemporalStart(true, ${pinEnv})`
  : `__sdfGame.setTemporalStart(true)`);
const legPin = await runLeg(`__sdfGame.setTemporalStart(true, 0.25)`);

// Sanity: a second off capture must be pixel-stable (the scene is frozen;
// if off-vs-off differs, the diff metric itself is unreliable).
const legOff2 = await runLeg(`__sdfGame.setTemporalStart(false)`);

// The diff runs in the page; the heatmap comes back in ~48 KB base64
// chunks — one big returnByValue string silently arrives as undefined
// (CDP serialization cap).
const diffInPage = async (aB64, bB64) => {
  const expr = `
    (async () => {
      const A64 = ${JSON.stringify(aB64)};
      const B64 = ${JSON.stringify(bB64)};
      window.__heatB64 = null;
      const load = (b64) => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error('image decode failed')); i.src = 'data:image/png;base64,' + b64; });
      const [ia, ib] = await Promise.all([load(A64), load(B64)]);
      const w = ia.width, h = ia.height;
      const ca = new OffscreenCanvas(w, h), cb = new OffscreenCanvas(w, h);
      ca.getContext('2d').drawImage(ia, 0, 0);
      cb.getContext('2d').drawImage(ib, 0, 0);
      const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
      const db = cb.getContext('2d').getImageData(0, 0, w, h).data;
      const heat = new Uint8ClampedArray(da.length);
      let changed = 0, maxDelta = 0, sumDelta = 0, counted = 0;
      const spots = [];
      const BANDS = 16;
      const bandChanged = new Array(BANDS).fill(0);
      for (let p = 0; p < da.length; p += 4) {
        const py = (p >> 2) / w | 0;
        counted++;
        let d = 0;
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(da[p + c] - db[p + c]));
        if (d > 8) {
          changed++;
          bandChanged[Math.min(BANDS - 1, (py * BANDS / h) | 0)]++;
          if (spots.length < 20) spots.push([(p >> 2) % w, py, d]);
        }
        if (d > maxDelta) maxDelta = d;
        sumDelta += d;
        const hv = Math.min(255, d * 8);
        heat[p] = hv; heat[p + 1] = 0; heat[p + 2] = hv ? 255 - hv : 0; heat[p + 3] = 255;
      }
      const hc = new OffscreenCanvas(w, h);
      hc.getContext('2d').putImageData(new ImageData(heat, w, h), 0, 0);
      const blob = await hc.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      const STEP = 32768;
      for (let i = 0; i < buf.length; i += STEP) {
        s += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i + STEP, buf.length)));
      }
      window.__heatB64 = btoa(s);
      return { w, h, counted, changed, maxDelta, meanDelta: sumDelta / counted, heatLen: window.__heatB64.length, spots, bandChanged };
    })()
  `;
  const metrics = await evaluate(expr, 120_000);
  if (!metrics) throw new Error('in-page diff returned undefined');
  let heat = '';
  for (let i = 0; i < metrics.heatLen; i += 48000) {
    heat += await evaluate(`window.__heatB64.slice(${i}, ${i + 48000})`);
  }
  return { ...metrics, heatB64: heat };
};

const pairs = [
  ['off-vs-off2', legOff, legOff2],
  ['off-vs-pinned', legOff, legPin],
  ['off-vs-adaptive', legOff, legNew],
];
let worst = null;
for (const [name, a, b] of pairs) {
  const d = await diffInPage(a, b);
  writeFileSync(`${OUT}/${name}-heat.png`, Buffer.from(d.heatB64, 'base64'));
  console.log(`${name}: changed ${d.changed} px (${((d.changed / d.counted) * 100).toFixed(4)}%)  maxDelta ${d.maxDelta}  mean ${d.meanDelta.toFixed(3)}`);
  console.log(`  by band (50px rows): ${d.bandChanged.join(', ')}`);
  console.log(`  spots: ${JSON.stringify(d.spots.slice(0, 8))}`);
  if (name !== 'off-vs-off2' && d.changed > 0 && (!worst || d.changed > worst.changed)) worst = { name, ...d };
}
writeFileSync(`${OUT}/off.png`, Buffer.from(legOff, 'base64'));
writeFileSync(`${OUT}/pinned.png`, Buffer.from(legPin, 'base64'));
writeFileSync(`${OUT}/adaptive.png`, Buffer.from(legNew, 'base64'));
console.log(`\nframes: ${OUT}/{off,pinned,adaptive}.png  (off-vs-off2 is the metric's own noise floor)`);
if (worst) console.log(`WORST: ${worst.name} changed ${worst.changed} px`);
process.exit(0);
