// scripts/earlyz-parity.mjs — early-Z stage 1 parity + owner look sheet (plan 2026-10-01 Task 12).
// Usage: scripts/earlyz-run.sh parity [outDir]   (EARLYZ_SCENES=pack,doorway to subset)
//
// THE QUESTION: does `?earlyz=1` leave the PRESENTED frame unchanged? Per scene, three fresh boots
// on one tab, staged identically (scripts/lib/earlyz-scenes.mjs):
//   off   ?frozen=1&vhs=off&seed=20260918[&scene query]        the shipped image
//   on    the same + &earlyz=1                                  the flag's image
//   off2  the same as off                                       this scene's noise floor
// on vs off is the parity diff and the owner sheet (off | on | red diff); off vs off2 is the
// determinism floor of THIS scene, run after `on` so it brackets it. The gate floor is the plan's:
// the PACK scene's off-vs-off pixel count (pack runs first, for the floor, even when not listed).
//
// GATE (plan Task 12, spec §7), unchanged from the plan: every scene but the two doorways within
// max(2 x the pack floor, 0.1 % of the pixels) diff pixels. The doorways are REPORTED, not gated: at
// occlusion edges the neural upscaler now sees `miss` texels where it used to see hidden flesh, and
// the fringe there is the owner's look call. Red INSIDE the open doorway or on a fully visible body
// is a bug; so is a vertically mirrored band of missing bodies (seed uv flipped, seed-depth.wgsl.ts).
// The checks besides the gate: each boot staged the same pose, no page exceptions, no GPU errors,
// the upscale stage on, the flag reads as asked, the seed DREW in every flag-on boot, no march texel
// went miss -> hit under the flag, and in `melee` the near body's type sits in the back batch. Exit 0
// only when every check passes.
//
// WHY, NOT ONLY HOW MUCH. Each boot also reads the exact march target (readMarchTarget, after the
// screenshot). off vs on, texel by texel: `seededOut` (hit -> miss: the seed took it), `changedHit`
// (both hits, the value moved; `changedHitBig` when rgb moved by > 0.03), `newHit` (must be 0).
// Each presented diff pixel is then classified (classify(): seed fringe / march change /
// unexplained, a report, not a gate) through the canvas rect and THE LENS (the presented canvas is
// the capture warped by fisheye.ts, so a screen pixel is not where the march texel is).
//
// DETERMINISM PINS, identical in every boot (the march-hash recipe, scripts/march-hash.mjs header):
// the rAF loop stopped; the dynamic-light clock frozen AND set to 0 (lamp moods, fill, key); the
// demo hold (actor animation phase, gather frame seed, VHS time hashes); the probe afterglow as a
// pure per-frame estimate (blend 1, fall 1); ship defaults (applyShipDefaults). The HUD text line
// is hidden: it prints the frame-time EMA, which differs per boot and is not the renderer's image.
// THE TRAIN (Night Train only) is stopped, setTrainSpeed(0), as sdf-game-light-gate.mjs does: its
// own clock (game-train-leaves.ts rt.time, advanced by every sim step from boot, so a wall-clock
// length by the time staging runs) drives the camera roll/bob and the lamp and curtain swing. At
// speed 0 all four are exactly 0 (train-motion.ts). Measured without it: off vs off2 differed on
// 2.6 % of the pixels, every level edge shifted by the roll, and the flail's chain swung differently.
// THE FLAIL's idle sway runs on a private clock: TRAIN_ALIGN_JS steps every boot to the same sway
// phase (measured: 1.4 % -> 0.01 %).
// Then SETTLE_FRAMES (180, 3 s of sim) hand steps: the flail chain (flail-chain.ts, damped) comes
// to rest, and post-aa's smear history converges (at 30 frames, melee showed a highlight on the
// shotgun that 180 frames removed). The screenshot is taken only once two consecutive screenshots
// 250 ms apart are byte-identical (a deferred render landing late cannot be captured).
// EARLYZ_ON_NOISE=1 adds a second flag-on boot (on2) per scene: the flag-on path's own noise.
//
// OUTPUT. outDir (committed): <scene>-off-on-diff-half.png, the sheet at half size (1920 x 400:
// off and on 2x2 box-averaged, the diff panel 2x2 MAX-pooled so a 1 px red fringe survives);
// <scene>-zoom.png when the scene has diff pixels (a 320 x 200 window round the densest diff, 3x
// nearest-neighbour, off | on | diff); <scene>-seed-overlay-half.png (the off frame, seeded-out
// texels tinted blue, the diff coloured by cause: seed fringe red, march change yellow,
// unexplained magenta); parity.json. $LAB_TMP/earlyz-parity (disposable): the full-size sheets
// (3840 x 800), the raw captures and march floats, the march maps and the noise sheets.
//
// BOUNDED (the earlyz-smoke patterns): a watchdog (EARLYZ_WATCHDOG_MIN, default 75) ends the run
// whatever hangs, a loader gate that settles anything but 'ready' fails at once, and fail() gives
// the page 10 s to answer its diagnostic read. A second CDP client collects the console per boot
// into $LAB_TMP/earlyz-parity/<scene>-<boot>.console.log.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import { connectGame, bootCloseupPage, applyShipDefaults, sleep } from './lib/sdf-closeup-stage.mjs';
import { decodePng } from './lib/demo-presented.mjs';
import { writePng } from './lib/png-write.mjs';
import { STAGES } from './lib/earlyz-scenes.mjs';

const [, , VITE, CDP, OUT = 'docs/dev-notes/2026-10-01-earlyz-stage-1/look'] = process.argv;
const TMP = process.env.LAB_TMP ?? '/tmp';
const RAW = join(TMP, 'earlyz-parity');
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });
const SCENES = (process.env.EARLYZ_SCENES ?? 'pack,doorway,train-doorway,melee,far').split(',').filter(Boolean);
for (const s of SCENES) if (!STAGES[s]) { console.error(`earlyz-parity: unknown scene '${s}' (have ${Object.keys(STAGES).join(', ')})`); process.exit(2); }
const FLOOR_SCENE = 'pack';
const DIFF_LEVEL = 8;
const W = 1280, H = 800;
const SETTLE_FRAMES = Number(process.env.EARLYZ_SETTLE_FRAMES ?? 180);
const WATCHDOG_MIN = Number(process.env.EARLYZ_WATCHDOG_MIN ?? 75);
const SEED = 20260918;

// ---- console collector state (the watchdog dumps it, so it exists before anything can hang) ----
let phase = 'connect';
const logs = { connect: [] };
const push = (level, text) => { (logs[phase] ??= []).push({ t: Date.now(), level, text }); };
const isLoud = (l) => /earlyz/i.test(l.text) || /warn|error|exception/.test(l.level);
function dumpConsole(p, quiet = false) {
  const lines = logs[p] ?? [];
  const file = join(RAW, `${p}.console.log`);
  writeFileSync(file, lines.map((l) => `${l.level}\t${l.text}`).join('\n') + '\n');
  const loud = new Map();
  for (const l of lines.filter(isLoud)) {
    const k = `${l.level}\t${l.text.slice(0, 400)}`;
    loud.set(k, (loud.get(k) ?? 0) + 1);
  }
  if (quiet) return { file, lines: lines.length, loud: loud.size };
  console.log(`console[${p}] ${lines.length} lines -> ${file}; ${loud.size} distinct earlyz/warn/error:`);
  for (const [k, n] of [...loud].slice(0, 40)) console.log(`  ${n > 1 ? `x${n} ` : ''}${k}`);
  return { file, lines: lines.length, loud: loud.size };
}
const exceptionsIn = (p) => (logs[p] ?? []).filter((l) => l.level === 'exception');

const report = {
  when: new Date().toISOString(), load: loadavg().map((x) => +x.toFixed(2)), diffLevel: DIFF_LEVEL,
  settleFrames: SETTLE_FRAMES, seed: SEED, viewport: [W, H], rawDir: RAW, scenes: {}, checks: [],
};
const writeReport = () => writeFileSync(join(OUT, 'parity.json'), JSON.stringify(report, null, 2));

// Ref'd on purpose: it must fire even if every other handle is gone. Every exit path calls
// process.exit, so it never holds a finished run open.
setTimeout(() => {
  console.error(`FAIL: watchdog ${WATCHDOG_MIN} min (phase ${phase})`);
  try { dumpConsole(phase); writeReport(); } catch (e) { console.error('dump failed:', String(e)); }
  process.exit(1);
}, WATCHDOG_MIN * 60_000);

const { tab, send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: W, height: H });

// ---- console collector (second CDP client on the same target) ---------------------------------
const cws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { cws.onopen = ok; cws.onerror = err; });
const argText = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value))
  : a.description ?? a.unserializableValue ?? a.type);
cws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') push(m.params.type, (m.params.args ?? []).map(argText).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    push('exception', d.exception?.description ?? d.text);
  } else if (m.method === 'Log.entryAdded') push(`log:${m.params.entry.level}`, `${m.params.entry.source}: ${m.params.entry.text}`);
};
let cseq = 0;
const csend = (method) => cws.send(JSON.stringify({ id: ++cseq, method }));
csend('Runtime.enable');
csend('Log.enable');

/** Inside the run every failure THROWS (bootCloseupPage calls its `fail` synchronously and expects
 *  it not to return); the top level catches it and prints the evidence before exiting. */
const die = (msg) => { throw new Error(msg); };

/** Print whatever evidence the page still answers (10 s at most), write the partial report, exit 1. */
async function fail(msg) {
  console.error(`FAIL: ${msg}`);
  const read = evaluate(`JSON.stringify({
    earlyz: window.__sdfGame?.earlyzInfo?.() ?? null,
    gpu: window.__sdfGame?.gpuDiagnostics?.() ?? null,
    gate: window.__warmGate ?? null, bg: window.__sdfGame?.warmBackground?.() ?? null,
  })`, 10_000).catch((e) => `unavailable: ${String(e)}`);
  const timeout = new Promise((ok) => setTimeout(() => ok('unavailable: no answer in 10 s'), 10_000));
  console.error('page state', await Promise.race([read, timeout]));
  dumpConsole(phase);
  report.failed = msg;
  writeReport();
  process.exit(1);
}

/** Wait for the loader gate AND the background crowd job (the crowd path, not the per-body
 *  fallback, is what ships). A gate that settles anything but 'ready' is final. */
async function waitReady(query) {
  for (let i = 0; ; i++) {
    const s = JSON.parse(await evaluate(`JSON.stringify({ gate: window.__warmGate?.phase ?? null, bg: __sdfGame.warmBackground?.() ?? null })`));
    if (s.gate !== null && s.gate !== 'ready') die(`loader gate settled '${s.gate}', not 'ready', under ?${query}`);
    if (s.gate === 'ready' && s.bg?.crowd === 'ready') return;
    if (s.bg?.crowd === 'failed') die(`crowd warm job failed under ?${query}`);
    if (i > 1440) die(`not ready after 12 min under ?${query}: ${JSON.stringify(s)}`); // a cold compile
    await sleep(500);
  }
}

/** The pins (header). Run after the gate, before staging, in EVERY boot. */
const PIN_JS = `(() => {
  __sdfGame.setLoopRunning(false);
  const hud = document.getElementById('hud');
  if (hud) hud.style.visibility = 'hidden';
  __sdfGame.setLightClockFrozen(true);
  __sdfGame.setLightTime(0);
  __sdfGame.setDemoHold(true);
  __sdfGame.setProbeBlend(1);
  __sdfGame.setProbeFall(1);
  if (__sdfGame.train()) __sdfGame.setTrainSpeed(0);
  return 1;
})()`;

/** THE FLAIL'S IDLE SWAY (Night Train's melee-only loadout): game-flail.ts sways the ball's rest
 *  target by sin(2 pi 0.9 c) and sin(2 pi 1.17 c) on a PRIVATE clock c, advanced by every sim
 *  tick from boot and readable nowhere. The train's clock (train().time) is advanced by the same
 *  tick with the same dt from the same first tick, so it stands in for c: step the sim, in equal
 *  steps of at most 1/60 s, until the train clock reaches the next whole period of the sway
 *  pattern (100/9 s: 0.9 and 1.17 Hz share 0.09 Hz), at least 1 s ahead. Every boot then shows the
 *  same sway phase. The train is stopped (PIN_JS), so nothing else on it moves. Ring scenes: no-op. */
const TRAIN_ALIGN_JS = `(() => {
  const tr = __sdfGame.train();
  if (!tr) return null;
  const P = 100 / 9, t0 = tr.time, T = Math.ceil((t0 + 1) / P) * P;
  const n = Math.ceil((T - t0) * 60), dt = (T - t0) / n;
  __sdfGame.step(n, dt);
  return { t0, T, n, dt, t1: __sdfGame.train().time };
})()`;

/** Screenshot until two consecutive shots 250 ms apart are byte-identical. */
async function stableShot() {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const data = shot.result?.data;
    if (!data) die('captureScreenshot returned no data');
    if (prev !== null && data === prev) return { b64: data, tries: i + 1 };
    prev = data;
    await sleep(250);
  }
  die('presented frame never stable across two screenshots in 10 s');
}

/** Boot `scene` with the flag on or off, pin, stage, settle, capture. `boot` names the boot. */
async function capture(scene, flagOn, boot) {
  phase = `${scene}-${boot}`;
  logs[phase] = [];
  const s = STAGES[scene];
  const q = ['frozen=1', 'vhs=off', `seed=${SEED}`, s.query, flagOn ? 'earlyz=1' : ''].filter(Boolean).join('&');
  const t0 = Date.now();
  const load = +loadavg()[0].toFixed(2);
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?${q}`, fail: die });
  await waitReady(q);
  const readyMs = Date.now() - t0;
  await evaluate(PIN_JS);
  const ship = await applyShipDefaults(evaluate);
  const staged = await s.stage(evaluate, die);
  const align = await evaluate(TRAIN_ALIGN_JS);
  await evaluate(`(() => { __sdfGame.step(${SETTLE_FRAMES}); return 1; })()`);
  await sleep(300);
  const shot = await stableShot();
  const img = decodePng(Buffer.from(shot.b64, 'base64'));
  writeFileSync(join(RAW, `${scene}-${boot}.png`), Buffer.from(shot.b64, 'base64'));
  const info = JSON.parse(await evaluate('JSON.stringify(__sdfGame.earlyzInfo())'));
  const gpu = JSON.parse(await evaluate('JSON.stringify(__sdfGame.gpuDiagnostics())'));
  const march = await evaluate('__sdfGameDebug.hashMarchTarget()');
  const state = JSON.parse(await evaluate(`JSON.stringify((() => {
    const c = __sdfGame.crowdInfo();
    const cv = document.querySelector('#app canvas') ?? document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    return { pose: __sdfGame.pose(), upscale: __sdfGame.upscaleInfo().on, resolution: __sdfGame.resolution, train: __sdfGame.train(),
      canvas: { w: cv.width, h: cv.height, rect: [r.left, r.top, r.width, r.height] },
      lens: (() => { const f = __sdfGame.fisheye, c = __sdfGame.resolution.content;
        return { k: f.k, renderFovDeg: f.renderFovDeg, centerFovDeg: f.centerFovDeg, aspect: c.width / c.height }; })(),
      visible: Object.fromEntries(c.types.filter(t => t.visible > 0).map(t => [t.name, t.visible])) };
  })())`));
  // melee: which crowd type the staged near body is filed under (its batch is the check).
  let nearType = null;
  if (staged && typeof staged.body === 'number') {
    nearType = await evaluate(`(() => {
      const hit = Object.entries(__sdfGame.crowdSlotDump()).find(([, rows]) => rows.some(r => r.actor === ${staged.body}));
      return hit ? hit[0] : null;
    })()`);
  }
  // The exact march target, AFTER the screenshot (readMarchTarget draws one dt-0 frame itself).
  const mt = await evaluate('__sdfGameDebug.readMarchTarget()');
  const mb = Buffer.from(mt.rgba32f, 'base64');
  writeFileSync(join(RAW, `${scene}-${boot}.march.f32`), mb);
  const marchF32 = { w: mt.w, h: mt.h, f: new Float32Array(mb.buffer.slice(mb.byteOffset, mb.byteOffset + mb.length)) };
  const ex = exceptionsIn(phase);
  const con = dumpConsole(phase, true);
  const rec = {
    query: q, readyMs, load, ship, staged, nearType, trainAlign: align, shotTries: shot.tries, earlyz: info, gpu,
    march: { nonZero: march.nonZero, rSum: march.rSum, w: march.w, h: march.h }, ...state,
    exceptions: ex.map((l) => l.text.slice(0, 300)), console: con,
  };
  console.log(`  ${phase.padEnd(22)} ready ${(readyMs / 1000).toFixed(1)} s, load ${load}, shot tries ${shot.tries}, march nonZero ${march.nonZero}, `
    + `seed ${info.seed.on}${info.seed.reason ? ` (${info.seed.reason})` : ''}, visible ${JSON.stringify(state.visible)}`);
  return { img, rec, march: marchF32 };
}

/** The march target, texel by texel (alpha >= 1 is a miss, sdf-layer.ts). With the flag on, a texel
 *  may only go hit -> miss (the seed pre-occluded it: level or viewmodel depth nearer over its whole
 *  output block). Anything else that moved is a march change the seed does not explain. Writes a
 *  2x map to RAW: the off march colour dimmed, seeded-out texels BLUE, changed hits YELLOW, new hits
 *  MAGENTA, changed misses GREEN. */
function marchDiff(a, b, file) {
  if (a.w !== b.w || a.h !== b.h) die(`march size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const { w, h } = a;
  const r = { w, h, same: 0, seededOut: 0, newHit: 0, changedHit: 0, changedHitBig: 0, changedMiss: 0, changedHitMaxRgb: 0, changedHitMaxAlpha: 0 };
  // Masks for classify(): seeded-out texels, and every OTHER texel whose value moved by more than
  // float noise (a hit that changed rgb by > BIG, a new hit, a changed miss).
  const seededMask = new Uint8Array(w * h), otherMask = new Uint8Array(w * h);
  const BIG = 0.03;
  const Z = 2;
  const out = new Uint8Array(w * Z * h * Z * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const missA = a.f[o + 3] >= 1, missB = b.f[o + 3] >= 1;
    let same = true;
    for (let c = 0; c < 4; c++) if (a.f[o + c] !== b.f[o + c] && !(Number.isNaN(a.f[o + c]) && Number.isNaN(b.f[o + c]))) same = false;
    let col;
    if (same) { r.same++; const g = Math.min(255, Math.round(Math.max(0, a.f[o]) * 96)); col = [g, g, g]; }
    else if (!missA && missB) { r.seededOut++; seededMask[i] = 1; col = [40, 90, 255]; }
    else if (missA && !missB) { r.newHit++; otherMask[i] = 1; col = [255, 0, 255]; }
    else if (!missA) {
      r.changedHit++;
      let dr = 0;
      for (let c = 0; c < 3; c++) dr = Math.max(dr, Math.abs(a.f[o + c] - b.f[o + c]));
      r.changedHitMaxRgb = Math.max(r.changedHitMaxRgb, dr);
      r.changedHitMaxAlpha = Math.max(r.changedHitMaxAlpha, Math.abs(a.f[o + 3] - b.f[o + 3]));
      if (dr > BIG) { r.changedHitBig++; otherMask[i] = 1; col = [255, 120, 0]; } else col = [255, 220, 0];
    } else { r.changedMiss++; otherMask[i] = 1; col = [0, 200, 0]; }
    const x = i % w, y = (i - x) / w;
    for (let dy = 0; dy < Z; dy++) for (let dx = 0; dx < Z; dx++) out.set([...col, 255], (((y * Z + dy) * w * Z) + x * Z + dx) * 4);
  }
  writeFileSync(file, writePng(w * Z, h * Z, out));
  r.changedHitMaxRgb = +r.changedHitMaxRgb.toExponential(3);
  r.changedHitMaxAlpha = +r.changedHitMaxAlpha.toExponential(3);
  Object.defineProperty(r, 'masks', { value: { seededMask, otherMask }, enumerable: false });
  return r;
}

/** Screen pixel -> march texel index (or -1 off the content). The canvas sits on the screen at
 *  `rect` (CSS px, deviceScale 1); the presented canvas is the post-aa capture through THE LENS
 *  (fisheye.ts warpUv: the centre magnified, the corners pinned), and the march target covers the
 *  capture uniformly. `lens` is __sdfGame.fisheye ({ k }) plus the content aspect. */
function screenToTexel(x, y, rect, lens, mw, mh) {
  const [rx, ry, rw, rh] = rect;
  let u = (x + 0.5 - rx) / rw, v = (y + 0.5 - ry) / rh;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return -1;
  if (lens.k > 0) {
    const qx = (u - 0.5) * 2 * lens.aspect, qy = (v - 0.5) * 2;
    const r = Math.hypot(qx, qy);
    if (r >= 1e-6) {
      const rmax2 = lens.aspect * lens.aspect + 1;
      const s = (1 + lens.k * r * r) / (1 + lens.k * rmax2);
      u = (qx * s) / (2 * lens.aspect) + 0.5; v = qy * s * 0.5 + 0.5;
    }
  }
  const tx = Math.min(mw - 1, Math.max(0, Math.floor(u * mw))), ty = Math.min(mh - 1, Math.max(0, Math.floor(v * mh)));
  return ty * mw + tx;
}

/** Chebyshev distance (screen px, capped at CAP) from every screen pixel to the nearest pixel whose
 *  march texel is set in `mask` (screenToTexel). Two-pass chamfer with unit diagonal cost. */
function screenDistance(mask, mw, mh, rect, lens, W, H, CAP = 255) {
  const dist = new Uint8Array(W * H).fill(CAP);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = screenToTexel(x, y, rect, lens, mw, mh);
      if (t >= 0 && mask[t]) dist[y * W + x] = 0;
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? CAP : dist[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    dist[i] = Math.min(dist[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1, at(x + 1, y - 1) + 1, CAP);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    dist[i] = Math.min(dist[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1, at(x - 1, y + 1) + 1, CAP);
  }
  return dist;
}

/** Where the presented diff pixels are, relative to what moved in the march target. A REPORT, not a
 *  gate (the plan's gate is the pixel count below); it says where to look.
 *  - `seedFringe`: within FRINGE_PX screen px of a seeded-out texel (the upscaler and the post chain
 *    read that texel's neighbourhood: hidden flesh before, `miss` now). FRINGE_PX is the upscaler's
 *    own reach: t16 is 3x3 convs with dilations 1, 2, 1, 1 (radius 5 texels), the reconstruction
 *    borrows one neighbour and CAS reads a 3x3, about 6.5 texels = 13 canvas px; the canvas is drawn
 *    at 1.33x and the lens magnifies the centre up to 1.31x, so 13 canvas px is up to ~23 screen px.
 *    FXAA's along-edge search (up to ~26 px each way) can carry a change further along a silhouette;
 *    that is NOT counted, so such pixels land in `unexplained`.
 *  - `marchChange`: not seed fringe, but within FRINGE_PX of a texel that moved for another reason
 *    (a hit whose rgb moved by more than BIG, a new hit, a changed miss).
 *  - `unexplained`: neither. Red there is what to inspect first (spec: red inside an open doorway or
 *    on a fully visible body is a bug).
 *  `seedDistHist` bins the seed-fringe pixels by their distance to the nearest seeded-out pixel. */
const FRINGE_PX = 24;
/** The "why" picture, half size: the OFF frame with every pixel whose march texel the seed took out
 *  tinted BLUE, texels that moved for another reason ORANGE; the presented diff on top, max-pooled,
 *  by cause (classify): seed fringe RED, march change YELLOW, unexplained MAGENTA. */
const CLASS_COL = [null, [255, 0, 0, 255], [255, 255, 0, 255], [255, 0, 255, 255]];
function seedOverlayHalf(a, where, march, rect, lens) {
  const { w, h } = a;
  const hw = w >> 1, hh = h >> 1;
  const out = new Uint8Array(hw * hh * 4);
  const { seededMask, otherMask } = march.masks;
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const o = (y * hw + x) * 4;
    const taps = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => (2 * y + dy) * w + 2 * x + dx);
    const k = Math.max(...taps.map((i) => where.cls[i]));
    if (k) { out.set(CLASS_COL[k], o); continue; }
    const col = [0, 1, 2].map((c) => (taps.reduce((n, i) => n + a.data[i * a.ch + c], 0) + 2) >> 2);
    const t = screenToTexel(2 * x, 2 * y, rect, lens, march.w, march.h);
    if (t >= 0 && seededMask[t]) out.set([col[0] >> 1, col[1] >> 1, Math.min(255, (col[2] >> 1) + 130), 255], o);
    else if (t >= 0 && otherMask[t]) out.set([255, 150, 0, 255], o);
    else out.set([...col, 255], o);
  }
  return writePng(hw, hh, out);
}

function classify(d, march, rect, lens, W, H) {
  const sd = screenDistance(march.masks.seededMask, march.w, march.h, rect, lens, W, H);
  const od = screenDistance(march.masks.otherMask, march.w, march.h, rect, lens, W, H);
  const BINS = [0, 1, 2, 3, 4, 6, 10, FRINGE_PX];
  const hist = Object.fromEntries(BINS.map((b) => [`<=${b}`, 0]));
  const r = { fringePx: FRINGE_PX, seedFringe: 0, marchChange: 0, unexplained: 0, seedDistHist: hist, unexplainedBbox: null };
  const cls = new Uint8Array(W * H); // 1 seed fringe, 2 march change, 3 unexplained
  Object.defineProperty(r, 'cls', { value: cls, enumerable: false });
  let ux0 = W, uy0 = H, ux1 = -1, uy1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (!(d.image[i * 4] === 255 && d.image[i * 4 + 1] === 0)) continue;
    if (sd[i] <= FRINGE_PX) { r.seedFringe++; cls[i] = 1; hist[`<=${BINS.find((b) => sd[i] <= b)}`]++; continue; }
    if (od[i] <= FRINGE_PX) { r.marchChange++; cls[i] = 2; continue; }
    r.unexplained++; cls[i] = 3;
    const x = i % W, y = (i - x) / W;
    if (x < ux0) ux0 = x; if (x > ux1) ux1 = x; if (y < uy0) uy0 = y; if (y > uy1) uy1 = y;
  }
  if (r.unexplained) r.unexplainedBbox = [ux0, uy0, ux1, uy1];
  return r;
}

/** Max per-channel abs diff per pixel; red where it exceeds DIFF_LEVEL, dim grey (a's red) elsewhere.
 *  Also the diff's bounding box and an 8 x 5 grid of counts, so a reader can place the red. */
function diff(a, b) {
  if (a.w !== b.w || a.h !== b.h) die(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const { w, h } = a;
  const out = new Uint8Array(w * h * 4);
  const GX = 8, GY = 5;
  const grid = Array.from({ length: GY }, () => new Array(GX).fill(0));
  let px = 0, max = 0, sum = 0;
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let i = 0; i < w * h; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i * a.ch + c] - b.data[i * b.ch + c]));
    sum += d;
    if (d > max) max = d;
    const hot = d > DIFF_LEVEL;
    if (hot) {
      px++;
      const x = i % w, y = (i - x) / w;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      grid[Math.floor((y * GY) / h)][Math.floor((x * GX) / w)]++;
    }
    const g = a.data[i * a.ch] >> 2;
    out.set(hot ? [255, 0, 0, 255] : [g, g, g, 255], i * 4);
  }
  return { px, frac: px / (w * h), max, meanAbs: +(sum / (w * h)).toFixed(4),
    bbox: px ? [bx0, by0, bx1, by1] : null, grid, image: out };
}

/** RGBA panel accessor over a decoded capture (3 or 4 channels) or a diff image (4). */
const panel = (src, ch) => ({ src, ch });

/** off | on | diff, side by side, full size. */
function sheetFull(a, b, d) {
  const { w, h } = a;
  const panels = [panel(a.data, a.ch), panel(b.data, b.ch), panel(d.image, 4)];
  const out = new Uint8Array(w * 3 * h * 4);
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < 3; k++) {
      const { src, ch } = panels[k];
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * ch, o = (y * w * 3 + k * w + x) * 4;
        out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; out[o + 3] = 255;
      }
    }
  }
  return writePng(w * 3, h, out);
}

/** The same sheet at half size: images 2x2 box-averaged, the diff 2x2 max-pooled (red wins). */
function sheetHalf(a, b, d) {
  const { w, h } = a;
  const hw = w >> 1, hh = h >> 1;
  const panels = [panel(a.data, a.ch), panel(b.data, b.ch), panel(d.image, 4)];
  const out = new Uint8Array(hw * 3 * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let k = 0; k < 3; k++) {
      const { src, ch } = panels[k];
      for (let x = 0; x < hw; x++) {
        const o = (y * hw * 3 + k * hw + x) * 4;
        const taps = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => ((2 * y + dy) * w + 2 * x + dx) * ch);
        if (k === 2 && taps.some((s) => src[s] === 255 && src[s + 1] === 0)) { out.set([255, 0, 0, 255], o); continue; }
        for (let c = 0; c < 3; c++) out[o + c] = (taps.reduce((n, s) => n + src[s + c], 0) + 2) >> 2;
        out[o + 3] = 255;
      }
    }
  }
  return writePng(hw * 3, hh, out);
}

/** A ZW x ZH window centred on the densest diff (by a coarse count), ZOOM x nearest, off | on | diff. */
function zoomSheet(a, b, d) {
  const ZW = 320, ZH = 200, ZOOM = 3, CELL = 40;
  const { w, h } = a;
  const cw = Math.ceil(w / CELL), chh = Math.ceil(h / CELL);
  const counts = new Array(cw * chh).fill(0);
  for (let i = 0; i < w * h; i++) {
    if (d.image[i * 4] === 255 && d.image[i * 4 + 1] === 0) {
      const x = i % w, y = (i - x) / w;
      counts[Math.floor(y / CELL) * cw + Math.floor(x / CELL)]++;
    }
  }
  // Densest ZW x ZH window over the cell grid.
  const nx = ZW / CELL, ny = ZH / CELL;
  let best = -1, bx = 0, by = 0;
  for (let cy = 0; cy + ny <= chh; cy++) {
    for (let cx = 0; cx + nx <= cw; cx++) {
      let n = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) n += counts[(cy + j) * cw + cx + i];
      if (n > best) { best = n; bx = cx; by = cy; }
    }
  }
  const x0 = Math.min(bx * CELL, w - ZW), y0 = Math.min(by * CELL, h - ZH);
  const panels = [panel(a.data, a.ch), panel(b.data, b.ch), panel(d.image, 4)];
  const OW = ZW * ZOOM, OH = ZH * ZOOM;
  const out = new Uint8Array(OW * 3 * OH * 4);
  for (let y = 0; y < OH; y++) {
    for (let k = 0; k < 3; k++) {
      const { src, ch } = panels[k];
      for (let x = 0; x < OW; x++) {
        const s = ((y0 + Math.floor(y / ZOOM)) * w + x0 + Math.floor(x / ZOOM)) * ch;
        const o = (y * OW * 3 + k * OW + x) * 4;
        out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; out[o + 3] = 255;
      }
    }
  }
  return { png: writePng(OW * 3, OH, out), window: [x0, y0, ZW, ZH], redInWindow: best };
}

const strip = ({ image, ...r }) => r;
const check = (name, ok) => { report.checks.push({ name, ok }); return ok; };
const samePose = (p, q) => p && q && p.pos.every((v, i) => Math.abs(v - q.pos[i]) < 1e-4)
  && Math.abs(p.yaw - q.yaw) < 1e-5 && Math.abs(p.pitch - q.pitch) < 1e-5;

/** One scene: off, on, off2; the sheets; the per-boot checks. */
async function runScene(scene, { floorOnly = false } = {}) {
  console.log(`--- ${scene}${floorOnly ? ' (noise floor only)' : ''} ---`);
  const off = await capture(scene, false, 'off');
  const on = floorOnly ? null : await capture(scene, true, 'on');
  const off2 = await capture(scene, false, 'off2');
  // EARLYZ_ON_NOISE=1: a second flag-on boot, so the flag-on path's own boot-to-boot noise is on
  // record too (diagnostic; not part of the gate).
  const on2 = !floorOnly && process.env.EARLYZ_ON_NOISE === '1' ? await capture(scene, true, 'on2') : null;
  const floor = diff(off.img, off2.img);
  writeFileSync(join(RAW, `${scene}-noise-sheet.png`), sheetFull(off.img, off2.img, floor));
  const marchNoise = marchDiff(off.march, off2.march, join(RAW, `${scene}-noise-march.png`));
  const row = { noise: strip(floor), marchNoise, boots: { off: off.rec, off2: off2.rec } };
  console.log(`  noise floor (off vs off2): ${floor.px} px (${(floor.frac * 100).toFixed(3)} %), max ${floor.max}, bbox ${JSON.stringify(floor.bbox)}; march ${JSON.stringify(marchNoise)}`);
  if (on2) {
    const n2 = diff(on.img, on2.img);
    writeFileSync(join(RAW, `${scene}-on-noise-sheet.png`), sheetFull(on.img, on2.img, n2));
    row.onNoise = strip(n2);
    row.onMarchNoise = marchDiff(on.march, on2.march, join(RAW, `${scene}-on-noise-march.png`));
    row.boots.on2 = on2.rec;
    console.log(`  flag-on noise (on vs on2): ${n2.px} px, max ${n2.max}, bbox ${JSON.stringify(n2.bbox)}; march ${JSON.stringify(row.onMarchNoise)}`);
  }
  for (const [name, b] of [['off', off], ['off2', off2], ...(on ? [['on', on]] : [])]) {
    check(`[${scene}/${name}] no page exceptions (${b.rec.exceptions.length})`, b.rec.exceptions.length === 0);
    check(`[${scene}/${name}] GPU device not lost, 0 uncaptured errors`, b.rec.gpu.lost === null && b.rec.gpu.uncapturedCount === 0);
    check(`[${scene}/${name}] upscale stage on (the shipped path)`, b.rec.upscale === true);
  }
  check(`[${scene}] off boots: flag off, nothing patched`, [off, off2].every((b) => b.rec.earlyz.flag === false && b.rec.earlyz.patchHits === 0));
  check(`[${scene}] off and off2 staged the same pose`, samePose(off.rec.pose, off2.rec.pose));
  if (on) {
    row.boots.on = on.rec;
    const d = diff(off.img, on.img);
    row.parity = strip(d);
    row.march = marchDiff(off.march, on.march, join(RAW, `${scene}-off-on-march.png`));
    row.where = classify(d, row.march, off.rec.canvas.rect, off.rec.lens, W, H);
    writeFileSync(join(OUT, `${scene}-seed-overlay-half.png`), seedOverlayHalf(off.img, row.where, row.march, off.rec.canvas.rect, off.rec.lens));
    console.log(`  march off vs on: ${JSON.stringify(row.march)}`);
    console.log(`  diff px by cause: ${JSON.stringify(row.where)}`);
    check(`[${scene}] no march texel went miss -> hit under the flag (${row.march.newHit})`, row.march.newHit === 0);
    writeFileSync(join(RAW, `${scene}-off-on-diff.png`), sheetFull(off.img, on.img, d));
    writeFileSync(join(OUT, `${scene}-off-on-diff-half.png`), sheetHalf(off.img, on.img, d));
    if (d.px > 0) {
      const z = zoomSheet(off.img, on.img, d);
      writeFileSync(join(OUT, `${scene}-zoom.png`), z.png);
      row.zoom = { window: z.window, redInWindow: z.redInWindow, scale: 3 };
    }
    const e = on.rec.earlyz;
    check(`[${scene}/on] flag on, patched + detected`, e.flag === true && e.on === true && e.patchHits > 0);
    check(`[${scene}/on] seed drew (seed.on ${e.seed.on}, reason ${JSON.stringify(e.seed.reason)})`, e.seed.on === true);
    check(`[${scene}] off and on staged the same pose`, samePose(off.rec.pose, on.rec.pose));
    if (scene === 'melee') {
      const b = on.rec.nearType ? e.batches[on.rec.nearType] : null;
      check(`[melee/on] the near body's type (${on.rec.nearType}) is in the back batch (${JSON.stringify(b)})`, !!b && b.back >= 1);
    }
    console.log(`  ${scene.padEnd(14)} diff px ${d.px} (${(d.frac * 100).toFixed(3)} %) max ${d.max} bbox ${JSON.stringify(d.bbox)}`
      + ` seed ${e.seed.on} ${e.seed.reason ?? ''} batches ${JSON.stringify(e.batches)}`);
  }
  report.scenes[scene] = row;
  writeReport();
}

try {
  console.log(`earlyz-parity: scenes ${SCENES.join(',')}, settle ${SETTLE_FRAMES} frames, load ${report.load.join(' ')}`);
  if (!SCENES.includes(FLOOR_SCENE)) await runScene(FLOOR_SCENE, { floorOnly: true });
  for (const scene of SCENES) await runScene(scene);
} catch (e) {
  await fail(e?.message ?? String(e));
}

// The gate (plan Task 12): every scene but the doorways within max(2 x the pack floor, 0.1 %).
const packFloor = report.scenes[FLOOR_SCENE].noise.px;
const floor = Math.max(2 * packFloor, 0.001 * W * H);
report.noiseFloor = { scene: FLOOR_SCENE, px: packFloor, gatePx: floor };
console.log('--- result ---');
console.log(`noise floor (pack off vs off2) ${packFloor} px -> gate ${floor} px`);
for (const [scene, r] of Object.entries(report.scenes)) {
  if (!r.parity) continue;
  const gated = !scene.includes('doorway');
  const ok = !gated || r.parity.px <= floor;
  if (gated) check(`[${scene}] parity: ${r.parity.px} px <= ${floor} px`, ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${scene}${gated ? '' : ' (reported only)'}  ${r.parity.px} px vs floor ${floor}  (own noise ${r.noise.px} px;`
    + ` seed fringe ${r.where.seedFringe}, march change ${r.where.marchChange}, unexplained ${r.where.unexplained})`);
}
let bad = 0;
for (const c of report.checks) { if (!c.ok) { bad++; console.log(`FAIL  ${c.name}`); } }
console.log(`${report.checks.length - bad}/${report.checks.length} checks pass`);
writeReport();
cws.close();
process.exit(bad ? 1 : 0);
