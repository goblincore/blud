// closeup-multiscale-probe.mjs — research probe (2026-09-21), NOT a gate.
//
// Question: at fill-screen, would "march at 0.25 and reconstruct" pay?
//  (1) COST SPLIT, one page, alternating legs (the clock-scaling rule):
//        full/fullflat  march 1.0  (800x600), shaded / walk only (setFlatAlbedo)
//        ship/flat      march 0.5  (400x300, the shipped scale)
//        q/qflat        march 0.25 (200x150)
//  (2) RECONSTRUCTIBILITY: read the per-pixel hit distance t at march scale 1.0
//      (800x600 = the output grid), subsample it 2x/4x/8x, bilinearly rebuild,
//      and count how many output pixels land within a tolerance of the truth.
//
// Usage: node closeup-multiscale-probe.mjs <vitePort> <cdpPort> <repoRoot>
import { writeFileSync, mkdirSync } from 'node:fs';
const [, , VITE = '5391', CDP = '9391', ROOT] = process.argv;
const lib = await import(`${ROOT}/scripts/lib/sdf-closeup-stage.mjs`);
const { connectGame, bootCloseupPage, stageCloseUp, stampFacingWounds, sleep } = lib;

const OUT = process.env.PROBE_OUT ?? '.';
mkdirSync(OUT, { recursive: true });
const BLOCKS = Number(process.env.PROBE_BLOCKS ?? 4);
const FRAMES = Number(process.env.PROBE_FRAMES ?? 90);
const WOUNDED = process.env.PROBE_WOUNDS !== '0';

const { send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });

// Wait for the shipped upscaler + crowd program: the ship state, not the fallback.
for (let i = 0; i < 120; i++) {
  const info = await evaluate('JSON.stringify(__sdfGame.upscaleInfo?.() ?? null)');
  if (info && info !== 'null' && JSON.parse(info).enabled !== false) break;
  await sleep(500);
}
await evaluate('__sdfGame.setFrameCap(0); __sdfGame.setWoundTuning({ spillChance: 0 }); 1');
const ROOM = Number(process.env.PROBE_ROOM ?? 1);
const staged = await stageCloseUp(evaluate, { settleTries: 2400, room: ROOM, ladder: process.env.PROBE_LADDER ? JSON.parse(process.env.PROBE_LADDER) : undefined });
console.log('staged', JSON.stringify(staged));
let wounds = null;
if (WOUNDED) { wounds = await stampFacingWounds(evaluate, {}); console.log('wounds', JSON.stringify(wounds)); }
const bootInfo = await evaluate(`JSON.stringify({ up: __sdfGame.upscaleInfo?.(), bodies: __sdfGame.bodiesOnScreen, zombies: __sdfGame.zombies().length })`);
console.log('boot', bootInfo);

const LEGS = {
  full:  { scale: 1.0,  flat: false },
  fullflat: { scale: 1.0, flat: true },
  ship:  { scale: 0.5,  flat: false },
  flat:  { scale: 0.5,  flat: true },
  q:     { scale: 0.25, flat: false },
  qflat: { scale: 0.25, flat: true },
};
const applyLeg = (l) => evaluate(`(() => { __sdfGame.setSdfScale(${l.scale}); __sdfGame.setFlatAlbedo(${l.flat}); __sdfGame.step(3); return 1; })()`);
const runBlock = async (name) => {
  await applyLeg(LEGS[name]);
  const r = await evaluate(`(async () => {
    const r = await __sdfGame.bench({ kind: 'closeup', mode: 'passes', closeupFrames: ${FRAMES}, warmup: 20, label: '${name}' });
    const lab = r.passes?.overall?.labels ?? {};
    const pick = {};
    for (const k of Object.keys(lab)) pick[k] = lab[k].p50;
    return JSON.stringify({ valid: r.valid, frameP50: r.overall.p50, span: r.passes?.overall?.span?.p50, passes: pick });
  })()`, 600_000);
  return JSON.parse(r);
};

const rows = [];
const names = Object.keys(LEGS);
for (let b = 0; b < BLOCKS; b++) {
  for (let k = 0; k < names.length; k++) {
    const name = names[(k + b) % names.length];
    const r = await runBlock(name);
    rows.push({ block: b, leg: name, ...r });
    console.log(b, name.padEnd(8), 'frame', r.frameP50?.toFixed(2), 'march', r.passes['sdf:march']?.toFixed(2), 'valid', r.valid);
  }
}

// ---- (2) reconstructibility -------------------------------------------------
const readT = async (scale) => {
  await evaluate(`(() => { __sdfGame.setFlatAlbedo(false); __sdfGame.setSdfScale(${scale}); __sdfGame.setMarchDebugMode(4); __sdfGame.step(3); return 1; })()`);
  await sleep(500);
  const raw = await evaluate(`(async () => { const r = await __sdfGameDebug.readMarchTarget(); return JSON.stringify({ w: r.w, h: r.h, b: r.rgba32f }); })()`, 300_000);
  await evaluate('__sdfGame.setMarchDebugMode(0); 1');
  const { w, h, b } = JSON.parse(raw);
  const buf = Buffer.from(b, 'base64');
  return { w, h, f: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
};
for (const sc of [0.25, 0.5]) {
  const c = await readT(sc); let st = 0, ra = 0, hi = 0, mx = 0;
  for (let i = 0; i < c.w * c.h; i++) { if (c.f[i * 4 + 2] > 0.5) { ra++; st += c.f[i * 4]; mx = Math.max(mx, c.f[i * 4]); if (c.f[i * 4 + 1] > 0.5) hi++; } }
  console.log('census', sc, JSON.stringify({ grid: c.w + 'x' + c.h, rasterisedFrac: ra / (c.w * c.h), hitFrac: hi / (c.w * c.h), stepsPerRasterised: st / ra, maxSteps: mx }));
}
const truth = await readT(1.0);
await evaluate('__sdfGame.setSdfScale(0.5); __sdfGame.step(3); 1');
const { w, h, f } = truth;
const hitAt = (x, y) => f[(y * w + x) * 4 + 1] > 0.5;
// alpha is CLIP DEPTH (the material's outputNode overwrites it) — convert to view metres.
const NEAR = 0.1, FAR = 200;
const tAt = (x, y) => { const d = f[(y * w + x) * 4 + 3]; return NEAR * FAR / (FAR - d * (FAR - NEAR)); };
const stepsAt = (x, y) => f[(y * w + x) * 4];
let hits = 0, rast = 0, stepSum = 0, missSteps = 0, misses = 0; const hitHist = new Array(12).fill(0), missHist = new Array(12).fill(0);
const bucket = (n) => Math.min(11, n <= 8 ? Math.max(0, Math.round(n) - 1) : n <= 16 ? 8 : n <= 32 ? 9 : n <= 64 ? 10 : 11);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (f[(y * w + x) * 4 + 2] > 0.5) rast++;
  if (hitAt(x, y)) { hits++; stepSum += stepsAt(x, y); hitHist[bucket(stepsAt(x, y))]++; }
  else if (f[(y * w + x) * 4 + 2] > 0.5) { misses++; missSteps += stepsAt(x, y); missHist[bucket(stepsAt(x, y))]++; }
}
// One output pixel's world footprint at distance t: vertical fov 2*atan(k*h/2)... use the
// measured neighbour spacing instead: tolerance in metres, reported at several values.
const recon = (N) => {
  const tol = [0.001, 0.002, 0.005, 0.01];
  const ok = tol.map(() => 0);
  let interior = 0, edge = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hitAt(x, y)) continue;
    // coarse sample centres sit at N*i + N/2; bilinear between the 4 around (x, y)
    const gx = (x - N / 2 + 0.5) / N, gy = (y - N / 2 + 0.5) / N;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    let all = true, acc = 0;
    for (let k = 0; k < 4 && all; k++) {
      const cx = Math.min(w - 1, Math.max(0, (x0 + (k & 1)) * N + (N >> 1)));
      const cy = Math.min(h - 1, Math.max(0, (y0 + (k >> 1)) * N + (N >> 1)));
      if (!hitAt(cx, cy)) { all = false; break; }
      acc += tAt(cx, cy) * ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
    }
    if (!all) { edge++; continue; }
    interior++;
    const err = Math.abs(acc - tAt(x, y));
    tol.forEach((tt, i) => { if (err < tt) ok[i]++; });
  }
  return { N, hitPixels: interior + edge, allCornersHit: interior / (interior + edge), within: Object.fromEntries(tol.map((tt, i) => [`${tt * 1000}mm`, ok[i] / (interior + edge)])) };
};
const reconstruct = { grid: `${w}x${h}`, coverage: hits / (w * h), rasterised: rast / (w * h), meanStepsHit: stepSum / Math.max(1, hits), meanStepsMiss: missSteps / Math.max(1, misses), missShareOfSteps: missSteps / Math.max(1, missSteps + stepSum), hitHist, missHist, histBuckets: '1,2,3,4,5,6,7,8,9-16,17-32,33-64,65+', x2: recon(2), x4: recon(4), x8: recon(8) };
console.log('reconstruct', JSON.stringify(reconstruct, null, 1));

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const summary = {};
for (const n of names) {
  const rs = rows.filter(r => r.leg === n && r.valid);
  summary[n] = { n: rs.length, frame: med(rs.map(r => r.frameP50)), march: med(rs.map(r => r.passes['sdf:march'] ?? NaN)), span: med(rs.map(r => r.span ?? NaN)) };
}
console.log('summary', JSON.stringify(summary, null, 1));
writeFileSync(`${OUT}/probe-room${ROOM}-${WOUNDED ? 'wounded' : 'clean'}.json`, JSON.stringify({ staged, wounds, bootInfo: JSON.parse(bootInfo), rows, summary, reconstruct }, null, 1));
process.exit(0);
