// scripts/upscale-pairs-capture.mjs — paired frozen-frame capture for the neural
// upscale (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md §7, gate G2).
//
// For each frame, ONE frozen simulation state is rendered twice:
//   input  = sdfScale 0.5, fields off -> march target 400x300 (rgb + clip depth)
//   target = sdfScale 1.0, fields off -> march target 800x600 (native progressive)
// setRenderLock(true) makes step(n) pure re-renders; the sim advances only between frames.
//
// G2 checks run on the first staged frame before anything is saved:
//   determinism (same scale twice, and 0.5 -> 1.0 -> 0.5), alignment (content registration
//   on interior flesh + coverage IoU), orientation (body staged below centre => centroid
//   row > H/2), depth sanity.
//
// Usage:
//   LAB_VITE_PORT=5313 LAB_CDP_PORT=9313 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs'
// Env: UPSCALE_OUT (default .upscale-data/<stamp>), UPSCALE_SEQS ("room:dist:orbit,..."),
//      UPSCALE_FRAMES (20), UPSCALE_ADVANCE (6 sim frames between captures), UPSCALE_PITCH_UP (0.2 rad)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';
import { encodeNpy } from './lib/npy.mjs';
import { registerHalfRes } from './lib/upscale-registration.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5313);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9313);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.UPSCALE_OUT ?? `.upscale-data/${STAMP}`;
const SEQS = (process.env.UPSCALE_SEQS ?? '1:2.5:0,3:3.0:1.2,4:2.0:-0.8').split(',').map((s) => {
  const [room, dist, orbit] = s.split(':').map(Number);
  return { room, dist, orbit };
});
const FRAMES = Number(process.env.UPSCALE_FRAMES ?? 20);
const ADVANCE = Number(process.env.UPSCALE_ADVANCE ?? 6);
const PITCH_UP = Number(process.env.UPSCALE_PITCH_UP ?? 0.2);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 60 min'); process.exit(3); }, 60 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;
await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off` });
await applyShipDefaults(evaluate);
// Pin the probe gather to its pure per-frame estimate: its afterglow (blend 0.6, fall
// 0.12) makes the march converge asymptotically, so consecutive render-locked reads
// never become bit-stable. Same staging fix as scripts/upscale-parity.mjs and
// docs/dev-notes/2026-09-11-neural-upscale/g1-parity.md "Bugs found and fixed".
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.installDebugProbe(); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
let baked = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { baked = true; break; }
  await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');

/** Read the march target as a Float32Array (row 0 = texel row 0). */
async function readMarch() {
  const r = await evaluate('__sdfGameDebug.readMarchTarget()', 300_000);
  const bytes = Buffer.from(r.rgba32f, 'base64');
  const copy = Buffer.from(bytes);
  return { w: r.w, h: r.h, data: new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4) };
}

async function renderAt(scale) {
  await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(${scale}); __sdfGame.step(4); return 1; })()`);
  await evaluate('__sdfGame.resolveGpu()');
  return readMarch();
}

const maxAbsDiff = (a, b) => {
  if (a.data.length !== b.data.length) return Infinity;
  let m = 0;
  for (let k = 0; k < a.data.length; k++) { const d = Math.abs(a.data[k] - b.data[k]); if (d > m) m = d; }
  return m;
};
const coverage = (img) => {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] < 1) { n++; sx += x + 0.5; sy += y + 0.5; }
  }
  return { n, frac: n / (img.w * img.h), cx: n ? sx / n : NaN, cy: n ? sy / n : NaN };
};
const linear = (d, near, far) => (near * far) / (far - d * (far - near));

async function stage(seq, pitchUp) {
  const r = await evaluate(`(async () => {
    __sdfGame.setRenderLock(false);
    __sdfGame.teleport(${seq.room});
    const z = __sdfGame.zombies().find(q => q.room === ${seq.room});
    if (!z) return { error: 'no body in room ${seq.room}' };
    __sdfGame.freeze(true);
    const d = ${seq.dist}, a = ${seq.orbit};
    const ex = z.pos[0] + Math.sin(a) * d, ez = z.pos[2] + Math.cos(a) * d;
    const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
    __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)) + ${pitchUp}, 0);
    __sdfGame.step(30);
    __sdfGame.setRenderLock(true);
    return { body: z.id, pose: [ex, ez] };
  })()`);
  if (r?.error) fail(r.error);
  return r;
}

// ---- G2 checks on the first staged frame -------------------------------------
const checks = {};
// Pitched UP so the body sits below screen centre, which the orientation check needs.
// EVERY check runs on this frame; the captured sequences below are re-staged level.
await stage(SEQS[0], PITCH_UP);
const { near, far } = await evaluate('__sdfGame.upscaleInfo()');
checks.nearFar = { near, far };

const lrA = await renderAt(0.5);
if (lrA.w !== 400 || lrA.h !== 300) fail(`input march is ${lrA.w}x${lrA.h}, expected 400x300`);
const lrB = await renderAt(0.5);
const hrA = await renderAt(1.0);
if (hrA.w !== 800 || hrA.h !== 600) fail(`target march is ${hrA.w}x${hrA.h}, expected 800x600`);
const hrB = await renderAt(1.0);
const lrC = await renderAt(0.5);
checks.determinism = {
  sameScaleInput: maxAbsDiff(lrA, lrB),
  sameScaleTarget: maxAbsDiff(hrA, hrB),
  scaleRoundTrip: maxAbsDiff(lrA, lrC),
};
let temporalStartOff = false;
if (Object.values(checks.determinism).some((v) => v > 1e-6)) {
  console.log('determinism failed with temporal start ON:', checks.determinism, '— retrying with setTemporalStart(false)');
  await evaluate('(() => { __sdfGame.setTemporalStart(false); return 1; })()');
  temporalStartOff = true;
  const a = await renderAt(0.5), b = await renderAt(0.5), h1 = await renderAt(1.0), h2 = await renderAt(1.0), c = await renderAt(0.5);
  checks.determinismTemporalStartOff = { sameScaleInput: maxAbsDiff(a, b), sameScaleTarget: maxAbsDiff(h1, h2), scaleRoundTrip: maxAbsDiff(a, c) };
  if (Object.values(checks.determinismTemporalStartOff).some((v) => v > 1e-6)) {
    fail(`G2 determinism: ${JSON.stringify(checks)}`);
  }
}
checks.temporalStart = temporalStartOff ? 'off (needed for determinism)' : 'on (shipped)';

const lr = await renderAt(0.5);
const hr = await renderAt(1.0);
const cl = coverage(lr), ch = coverage(hr);
if (cl.n < 500) fail(`G2: only ${cl.n} flesh pixels at 400x300 — the staged body is not in frame`);
// ALIGNMENT = content registration on interior flesh (scripts/lib/upscale-registration.mjs).
// The coverage-centroid offset stays in the report but does NOT gate: silhouette aliasing
// between a 400x300 and an 800x600 march moves it 1-3 px with no misregistration
// (docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md).
const reg = registerHalfRes(lr, hr);
checks.alignment = {
  inputCoverage: cl.frac, targetCoverage: ch.frac,
  registration: { texels: reg.texels, argmin: reg.argmin, subpixelOutputPx: reg.subpixel, mse: reg.mse },
  coverageCentroidOffsetOutputPx: { dx: 2 * cl.cx - ch.cx, dy: 2 * cl.cy - ch.cy, gated: false },
};
let inter = 0, union = 0;
for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
  let votes = 0;
  for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (hr.data[((2 * y + oy) * hr.w + 2 * x + ox) * 4 + 3] < 1) votes++;
  const a = lr.data[(y * lr.w + x) * 4 + 3] < 1, b = votes >= 2;
  if (a && b) inter++;
  if (a || b) union++;
}
checks.alignment.iou = inter / union;
checks.orientation = { inputCentroidRow: cl.cy, inputHeight: lr.h, targetCentroidRow: ch.cy, targetHeight: hr.h, rowZero: cl.cy > lr.h / 2 && ch.cy > hr.h / 2 ? 'top' : 'UNCONFIRMED' };
let dSum = 0, dN = 0;
for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
  const a = lr.data[(y * lr.w + x) * 4 + 3], b = hr.data[((2 * y) * hr.w + 2 * x) * 4 + 3];
  if (a < 1 && b < 1) { dSum += Math.abs(linear(a, near, far) - linear(b, near, far)); dN++; }
}
checks.depthMeanAbsDiffMetres = dN ? dSum / dN : NaN;

const g2 = [];
const regCheck = checks.alignment.registration;
if (regCheck.texels < 500) g2.push(`registration: only ${regCheck.texels} interior flesh texels (need 500)`);
if (regCheck.argmin.ox !== 0 || regCheck.argmin.oy !== 0) g2.push(`registration: best match at output shift (${regCheck.argmin.ox}, ${regCheck.argmin.oy}), not (0, 0)`);
if (!(Math.abs(regCheck.subpixelOutputPx.x) <= 0.25 && Math.abs(regCheck.subpixelOutputPx.y) <= 0.25)) {
  g2.push(`registration: sub-pixel offset (${regCheck.subpixelOutputPx.x}, ${regCheck.subpixelOutputPx.y}) exceeds 0.25 output px`);
}
if (checks.alignment.iou < 0.85) g2.push(`IoU ${checks.alignment.iou.toFixed(3)} < 0.85`);
if (checks.orientation.rowZero !== 'top') g2.push('orientation unconfirmed: body staged below centre but centroid row <= H/2');
if (!(checks.depthMeanAbsDiffMetres < 0.05)) g2.push(`mean depth diff ${checks.depthMeanAbsDiffMetres} m >= 0.05`);
console.log('G2 checks:', JSON.stringify(checks, null, 2));
if (g2.length) {
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ created: new Date().toISOString(), checks, g2Failures: g2, frames: [] }, null, 2));
  fail(`G2: ${g2.join('; ')}`);
}

// ---- capture ---------------------------------------------------------------------
const checkout = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const frames = [];
for (let s = 0; s < SEQS.length; s++) {
  const seq = SEQS[s];
  const staged = await stage(seq, 0);
  mkdirSync(`${OUT}/seq${s}`, { recursive: true });
  for (let f = 0; f < FRAMES; f++) {
    if (f > 0) {
      await evaluate(`(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.step(${ADVANCE}); __sdfGame.freeze(true); __sdfGame.setRenderLock(true); return 1; })()`);
    }
    const input = await renderAt(0.5);
    const target = await renderAt(1.0);
    const inPath = `seq${s}/frame${String(f).padStart(3, '0')}-in.npy`;
    const tgPath = `seq${s}/frame${String(f).padStart(3, '0')}-target.npy`;
    writeFileSync(`${OUT}/${inPath}`, encodeNpy(input.data, [input.h, input.w, 4]));
    writeFileSync(`${OUT}/${tgPath}`, encodeNpy(target.data, [target.h, target.w, 4]));
    const cov = coverage(input).frac;
    frames.push({ seq: s, frame: f, room: seq.room, body: staged.body, dist: seq.dist, orbit: seq.orbit, input: inPath, target: tgPath, inputCoverage: cov });
    process.stdout.write(`seq${s} frame ${f}: coverage ${(100 * cov).toFixed(2)}%${cov < 0.01 ? '  (WARN: body mostly out of frame)' : ''}\n`);
  }
}
await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setSdfScale(1.0); __sdfGame.setFieldStyle("bodies"); return 1; })()');

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  created: new Date().toISOString(),
  spec: 'docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md',
  checkout,
  page: 'sdf-game.html?frozen=1&vhs=off',
  input: { w: 400, h: 300, sdfScale: 0.5, fieldStyle: 'off' },
  target: { w: 800, h: 600, sdfScale: 1.0, fieldStyle: 'off' },
  channels: ['r', 'g', 'b', 'clipDepth (>= 1.0 means no flesh)'],
  dtype: 'float32 little-endian, shape (H, W, 4)',
  rowOrder: 'row 0 = texel row 0 = top of the rendered image (verified by checks.orientation)',
  depth: 'WebGPU [0,1] clip depth; linear = near*far / (far - d*(far - near))',
  near, far,
  temporalStart: checks.temporalStart,
  content: 'flesh layer only, tracked public/assets/lab/* — no Blood placeholder assets',
  checks,
  frames,
}, null, 2));
console.log(`\nG2: PASS — ${frames.length} pairs in ${OUT}`);
process.exit(0);
