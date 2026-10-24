// scripts/sdf-game-doom-gate.mjs — headless gate for sector levels (spec 2026-10-24-doom-sector-levels-design.md).
//   1. FIXTURE boot: webgpu, ready, no errors, geometry 'sectors'.
//   2. FIXTURE walk: up the 0.5 m step, stopped by the 1.0 m ledge, down into the pit, stopped by the column.
//   3. E1M1 (skipped if public/assets/levels/doom-e1m1.level.json is absent): boot, the ROUTE, budget, shots.
//   4. E1M1 pools and sector light (plan 2026-10-24-sector-levels-2): a hurt floor hurts (?god=0) and stops
//      hurting off it; the glow reads green; sector light lifts a bright sector's frame (A/B).
// Usage: LAB_TMP=.lab-tmp bash scripts/sdf-game-doom-gate.sh   (DOOM_GATE_ONLY_FIXTURE=1 skips 3–4; SHOTS=1 writes
// shots and .lab-tmp/doom/sector-light-sheet.png; TUNING=1 also writes the owner's .lab-tmp/doom/tuning-sheet.png)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const OUT = '.lab-tmp/doom';

const VITE = Number(process.argv[2] ?? 5483);
const CDP = Number(process.argv[3] ?? 9483);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); let consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  if (m.method === 'Runtime.exceptionThrown') consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000, expression.slice(0, 80));
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });

async function boot(level, query = '') {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=${level}${query}` });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) {
    await sleep(500);
    ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
    if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) break;
  }
  if (!ready) { console.error(consoleEvents.slice(-8)); fail(`${level} did not boot to ready`); }
  if ((await evaluate('__sdfGame.backend')) !== 'webgpu') fail('backend is not webgpu');
  const info = await evaluate('__sdfGame.level()');
  if (info.geometry !== 'sectors') fail(`${level}: geometry ${info.geometry}, expected sectors`);
  pass(`boot: ${level} ready on webgpu, ${info.rooms.length} zones`);
}

/** Walk from `from` toward `to` for `ms`; return the final pose. y is set to the floor there first. */
async function walk(from, to, ms) {
  const floor = (await evaluate(`__sdfGame.ground(${from[0]}, ${from[1]})`)).floor;
  await evaluate(`__sdfGame.setPose(${from[0]}, ${from[1]}, 0, 0, ${floor})`);
  await evaluate(`__sdfGame.walkTo(${to[0]}, ${to[1]})`);
  await sleep(ms);
  const pos = (await evaluate('__sdfGame.pose()')).pos;
  await evaluate('__sdfGame.walkCancel()');
  return pos;
}

/** A screenshot from a pose (x, z, yaw) standing on the floor there. */
async function shot(file, x, z, yaw) {
  mkdirSync(OUT, { recursive: true });
  const f = (await evaluate(`__sdfGame.ground(${x}, ${z})`)).floor;
  await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yaw}, 0, ${f})`);
  await sleep(1200);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${file}`, Buffer.from(s.result.data, 'base64'));
}

// 1–2. THE FIXTURE (see the plan's diagram)
await boot('fixtures/sectors');
let p = await walk([2.5, -6], [2.5, -10], 3000);
if (!(Math.abs(p[1] - 0.5) < 0.02 && p[2] < -8.3)) fail(`step: ended at ${p.map((v) => v.toFixed(2))}, expected on B (y 0.5, z < -8.3)`);
pass('fixture: walked up the 0.5 m step');
p = await walk([2.5, -10], [2.5, -14], 3000);
if (!(p[2] > -12 && Math.abs(p[1] - 0.5) < 0.02)) fail(`ledge: ended at ${p.map((v) => v.toFixed(2))}, expected stopped on B`);
pass(`fixture: stopped ${(p[2] + 12).toFixed(2)} m short of the 1.0 m ledge`);
p = await walk([2.5, -6], [6.5, -6], 3000);
if (!(Math.abs(p[1] + 1) < 0.02 && p[0] > 4.3)) fail(`pit: ended at ${p.map((v) => v.toFixed(2))}, expected in D (y -1)`);
pass('fixture: dropped into the pit');
// The autopilot strafes round a blocker when stuck, so the end pose says nothing: measure the closest approach
// to the column's footprint (x -1..1, z -5..-3) while walking at it, as sdf-game-flat-gate does.
await evaluate('__sdfGame.setPose(0, -1.2, 0, 0, 0)');
await evaluate('__sdfGame.walkTo(0, -6)');
let nearest = Infinity;
for (let i = 0; i < 12; i++) {
  await sleep(250);
  const [px, , pz] = (await evaluate('__sdfGame.pose()')).pos;
  nearest = Math.min(nearest, Math.hypot(Math.max(-1 - px, 0, px - 1), Math.max(-5 - pz, 0, pz + 3)));
}
await evaluate('__sdfGame.walkCancel()');
if (nearest < 0.28) fail(`column: came ${nearest.toFixed(2)} m from it (the radius is 0.32)`);
if (nearest > 0.45) fail(`column: never reached it (closest ${nearest.toFixed(2)} m)`);
pass(`fixture: stopped ${nearest.toFixed(2)} m from the column`);
// After the walks: right after boot the start overlay still covers the frame.
if (process.env.SHOTS === '1') {
  await shot('fixture.png', 0, -1.5, 0);                                // the start pose, facing -z
  await shot('fixture-steps.png', 2.5, -2, 0);                         // beside the column, facing the step up to B and the ledge to C
  await shot('fixture-pit.png', 7, -1, Math.atan2(-7, 9));             // from the pit, facing back toward B (0, -10)
  pass(`shots: ${OUT}/fixture*.png`);
}

// 3. E1M1
if (process.env.DOOM_GATE_ONLY_FIXTURE === '1') process.exit(0);
if (!existsSync('public/assets/levels/doom-e1m1.level.json')) {
  console.log('skip E1M1: run scripts/levels/doom_map.py <doomu.wad> E1M1 first');
  process.exit(0);
}
await boot('doom-e1m1');
const start = await evaluate('__sdfGame.ground(0, 0)');
if (start.floor !== 0) fail(`E1M1 start floor ${start.floor}, expected 0`);
// ROUTE: [x, z] waypoints along the main path (DOOM_ROUTE overrides). Each leg must end within 0.6 m of
// its target, standing on the floor the ground reports there. The default is derived numbers, not WAD data:
// a grid search over the generated level (step 0.75 m, headroom 1.9 m, 0.45 m clear of every blocking line,
// no nukage) for straight legs. Start room (floor -0.5..0) north, out its north-east door, the bent corridor
// (zone 7), across the window room (zone 2), the corridor east down a 0.25 m step, onto the zigzag
// walkway over the nukage (zone 9, floor -0.75).
const DEFAULT_ROUTE = [[0, 0], [0, -17], [5.75, -22.75], [8.5, -34], [30.25, -33.75], [32.75, -31.25], [49.75, -31.25], [57.75, -23.25]];
const ROUTE = process.env.DOOM_ROUTE ? JSON.parse(process.env.DOOM_ROUTE) : DEFAULT_ROUTE;
if (ROUTE.length < 4) fail('E1M1: ROUTE needs at least 4 waypoints (DOOM_ROUTE env, see the plan Task 7 Step 3)');
for (let i = 1; i < ROUTE.length; i++) {
  // Walk speed 3.4 m/s: allow the leg's length at ~2.4 m/s plus 2 s, so legs up to ~22 m fit.
  const len = Math.hypot(ROUTE[i][0] - ROUTE[i - 1][0], ROUTE[i][1] - ROUTE[i - 1][1]);
  const q = await walk(ROUTE[i - 1], ROUTE[i], Math.max(6000, 2000 + (len / 2.4) * 1000));
  const gap = Math.hypot(q[0] - ROUTE[i][0], q[2] - ROUTE[i][1]);
  const floor = (await evaluate(`__sdfGame.ground(${q[0]}, ${q[2]})`)).floor;
  if (gap > 0.6) fail(`E1M1 leg ${i}: stopped ${gap.toFixed(2)} m short of ${ROUTE[i]}`);
  if (Math.abs(q[1] - floor) > 0.02) fail(`E1M1 leg ${i}: feet ${q[1].toFixed(2)} but floor ${floor}`);
  pass(`E1M1 leg ${i}: reached ${ROUTE[i]} on floor ${floor}`);
}

await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await sleep(800);
await evaluate('__sdfGame.timeDraws(15)');                              // warm: the pipelines for what this pose sees
// One frame's draws: reset the counters, draw one frame, read them (a bare drawStats(true) after boot read 0).
await evaluate('__sdfGame.drawStats(true)');
await evaluate('__sdfGame.timeDraws(1)');
const drawCalls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
const readings = [];
for (let i = 0; i < 3; i++) readings.push(await evaluate('__sdfGame.timeDraws(21)'));
const frameMs = readings.sort((a, b) => a - b)[1];
const lights = await evaluate('JSON.stringify(__sdfGame.levelProbes?.lights ?? null)').catch(() => 'n/a');
console.log(`budget: ${drawCalls} draw calls, ${frameMs.toFixed(2)} ms a frame at the start (readings ${readings.map((v) => v.toFixed(1)).join(', ')}; level lights per room ${lights})`);

// Shots before the budget verdict, so an over-budget run still leaves pictures to look at.
if (process.env.SHOTS === '1') {
  const at = ROUTE[0][0] === 0 && ROUTE[0][1] === 0 ? ROUTE : [[0, 0], ...ROUTE];   // e1m1-<i>-<k>: waypoint i, yaw k (-z, +x, +z, -x)
  for (const [i, [x, z]] of at.entries()) {
    for (const [k, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) await shot(`e1m1-${i}-${k}.png`, x, z, yaw);
  }
  pass(`shots: ${OUT}/e1m1-*.png`);
}
if (frameMs > 33.3) fail(`frame ${frameMs.toFixed(2)} ms > 33.3 ms`);
pass('E1M1 budget: under 33.3 ms');

// 4. POOLS AND SECTOR LIGHT
const sleepSettle = 1200;
/** A screenshot as base64 PNG (no file). */
const grab = async () => (await send('Page.captureScreenshot', { format: 'png' })).result.data;
/** Decode a PNG in the page and average a centred crop (fraction of width and height): channel means 0..255. */
const measure = (b64, crop = 1) => evaluate(`(async () => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,${b64}')).blob());
  const cw = Math.max(1, Math.round(bmp.width * ${crop})), ch = Math.max(1, Math.round(bmp.height * ${crop}));
  const c = new OffscreenCanvas(cw, ch); const g = c.getContext('2d');
  g.drawImage(bmp, (bmp.width - cw) / 2, (bmp.height - ch) / 2, cw, ch, 0, 0, cw, ch);
  const d = g.getImageData(0, 0, cw, ch).data; let r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return { r: r / n, g: gr / n, b: b / n, grey: (r + gr + b) / 3 / n, lum: (0.2126 * r + 0.7152 * gr + 0.0722 * b) / n };
})()`);
const save = (file, b64) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${file}`, Buffer.from(b64, 'base64')); };
/** Compose a labelled grid in the page: cells[row][col] base64 PNGs (or null), drawn at cellW wide. */
async function sheet(file, title, rowLabels, colLabels, cells, notes = cells.map((r) => r.map(() => ''))) {
  const cellW = 400, cellH = 300, left = 190, top = 64;
  await evaluate('window.__sheetCells = []');
  for (const [r, row] of cells.entries()) for (const [c, b64] of row.entries()) {
    if (b64) await evaluate(`window.__sheetCells.push([${r}, ${c}, '${b64}'])`);
  }
  const out = await evaluate(`(async () => {
    const rows = ${JSON.stringify(rowLabels)}, cols = ${JSON.stringify(colLabels)}, notes = ${JSON.stringify(notes)};
    const cv = document.createElement('canvas'); cv.width = ${left} + cols.length * ${cellW}; cv.height = ${top} + rows.length * ${cellH};
    const g = cv.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.fillText(${JSON.stringify(title)}, 10, 26);
    g.font = '16px sans-serif';
    cols.forEach((t, c) => g.fillText(t, ${left} + c * ${cellW} + 8, 54));
    rows.forEach((t, r) => t.split('\\n').forEach((line, k) => g.fillText(line, 8, ${top} + r * ${cellH} + 24 + k * 20)));
    for (const [r, c, b64] of window.__sheetCells) {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const x = ${left} + c * ${cellW}, y = ${top} + r * ${cellH};
      g.drawImage(bmp, x + 2, y + 2, ${cellW} - 4, ${cellH} - 4);
      if (notes[r][c]) { g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x + 2, y + ${cellH} - 30, ${cellW} - 4, 28); g.fillStyle = '#ff0'; g.fillText(notes[r][c], x + 8, y + ${cellH} - 10); g.fillStyle = '#fff'; }
    }
    window.__sheetCells = [];
    return cv.toDataURL('image/png').split(',')[1];
  })()`);
  save(file, out);
}

const raw = JSON.parse(readFileSync('public/assets/levels/doom-e1m1.level.json', 'utf8'));
await boot('doom-e1m1', '&god=0');
// The flashlight adds its own light on top of the sector term; switch it off where the seam exists.
const flashOff = async () => evaluate('__sdfGame.setFlashlight ? __sdfGame.setFlashlight(false) : null');
const hz = await evaluate('__sdfGame.hazardPoint()');
if (!hz) fail('E1M1: no hurt sector (hazardPoint null)');
const hurtPerSec = raw.sectors[hz.sector].hurtPerSec;
await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0, 0, ${hz.pos[1]})`);
const h0 = await evaluate('__sdfGame.health()');
await sleep(3200);
const h1 = await evaluate('__sdfGame.health()');
if (!(h0 - h1 >= 2 * hurtPerSec)) fail(`hazard: health ${h0} -> ${h1} in 3.2 s on sector ${hz.sector}, expected a drop of >= ${2 * hurtPerSec}`);
if (!(h1 > 0)) fail(`hazard: the player died (${h1})`);
pass(`hazard: sector ${hz.sector} (${hz.glow}, ${hurtPerSec}/s) took health ${h0} -> ${h1} in 3.2 s`);
// Off the pool (the start pose): health holds.
await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await sleep(300);
const h2 = await evaluate('__sdfGame.health()');
await sleep(2000);
const h3 = await evaluate('__sdfGame.health()');
if (h3 < h2) fail(`hazard: still hurting off the pool (${h2} -> ${h3})`);
pass(`hazard: off the pool health holds (${h2} -> ${h3})`);
// boot() resets the console log: check the ?god=0 boot's errors first.
const hazardErrs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (hazardErrs.length) fail(`console errors (?god=0 boot): ${JSON.stringify(hazardErrs.slice(0, 4))}`);
// The look work: a fresh boot with god mode on, so no hurt flash tints the pool frames and nobody dies mid-sheet.
await boot('doom-e1m1', '&god=1');
// The glow, looking down at the pool.
await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0, -1.2, ${hz.pos[1]})`);
await sleep(sleepSettle);
const poolDown = await grab();
const gm = await measure(poolDown, 0.3);
console.log(`glow: centre-30% mean R ${gm.r.toFixed(1)} G ${gm.g.toFixed(1)} B ${gm.b.toFixed(1)}, G/R ${(gm.g / Math.max(gm.r, 1e-6)).toFixed(2)}`);
if (!(gm.g > 1.4 * gm.r && gm.g > 40)) fail(`glow: G ${gm.g.toFixed(1)} vs R ${gm.r.toFixed(1)} (need G > 1.4 R and G > 40)`);
pass('glow: the pool reads green');
await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0.6, -0.5, ${hz.pos[1]})`);
await sleep(sleepSettle);
const poolRim = await grab();

// Poses for the A/B: the game's own pure modules pick sectors; a march along __sdfGame.ground picks a yaw facing
// a wall 2.5..6 m off (a rise > 0.6 m or a ceiling under 1.9 m above the feet counts as a wall).
const poses = await evaluate(`(async () => {
  const sj = await import('/src/lab/sdf-zombie/webgpu/sector-json.ts');
  const sg = await import('/src/lab/sdf-zombie/webgpu/sector-geometry.ts');
  const map = sj.parseLevel(await (await fetch('/assets/levels/doom-e1m1.level.json')).json()).sectors;
  const wallYaw = (x, z, f0) => {
    let best = null;
    for (let k = 0; k < 16; k++) {
      const yaw = -Math.PI + (k * Math.PI) / 8, dx = Math.sin(yaw), dz = -Math.cos(yaw);
      let d = 0.25;
      for (; d < 14; d += 0.25) {
        const g = __sdfGame.ground(x + dx * d, z + dz * d);
        if (!Number.isFinite(g.floor) || g.floor - f0 > 0.6 || g.ceil - f0 < 1.9) break;
      }
      const score = d >= 2.5 && d <= 6 ? d : d >= 1.5 ? 50 + d : 1e9;
      if (best === null || score < best.score) best = { yaw, d, score };
    }
    return best;
  };
  const cands = [];
  map.sectors.forEach((s, i) => {
    if (s.glow !== null || s.special !== 'none' || s.ceil - s.floor < 2.2) return;
    const p = sg.sectorInteriorPoint(map, i); if (!p) return;
    const w = wallYaw(p[0], p[1], s.floor); if (!w || w.score > 1e8) return;
    cands.push({ i, zone: s.zone, light: s.light, sky: s.materials.ceil === 'sky', x: p[0], z: p[1], y: s.floor, yaw: w.yaw, wall: w.d, score: w.score });
  });
  const indoor = cands.filter((c) => !c.sky);
  const top = Math.max(...indoor.map((c) => c.light));
  const bright = indoor.filter((c) => c.light === top).sort((a, b) => a.score - b.score);
  const second = bright.find((c) => c.zone !== bright[0].zone) ?? bright[1];
  const low = Math.min(...cands.map((c) => c.light));
  const dark = cands.filter((c) => c.light === low).sort((a, b) => a.score - b.score)[0];
  return { bright: [bright[0] ?? null, second ?? null], dark: dark ?? null };
})()`);
console.log(`poses: ${JSON.stringify(poses)}`);
if (!poses.bright[0]) fail('A/B: no bright pose (no indoor non-special sector with 2.2 m headroom facing a wall 1.5..14 m off)');
if (!poses.dark) fail('A/B: no dark pose (no walkable non-special sector at the lowest light facing a wall)');
if ((process.env.SHOTS === '1' || process.env.TUNING === '1') && !poses.bright[1]) fail('sheets: no second bright pose');
const poseAt = async (q, pitch = -0.1) => evaluate(`__sdfGame.setPose(${q.x}, ${q.z}, ${q.yaw}, ${pitch}, ${q.y})`);
const flash = await flashOff();
console.log(`flashlight: setFlashlight(false) -> ${flash === null ? 'no seam on this level (on as authored)' : flash}`);
const DEFAULT_CURVE = await evaluate('__sdfGame.sectorLight()');
const shotWith = async (patch) => { await evaluate(`__sdfGame.sectorLight(${JSON.stringify(patch)})`); await flashOff(); await sleep(sleepSettle); return grab(); };
const restore = () => evaluate(`__sdfGame.sectorLight(${JSON.stringify({ on: DEFAULT_CURVE.on, max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma, glowGain: DEFAULT_CURVE.glowGain })})`);
/** On/off frames at a pose for a curve: luminance means and the ratio. */
async function ab(q, curve) {
  await poseAt(q);
  const on = await shotWith({ on: true, ...curve });
  const off = await shotWith({ on: false });
  await restore();
  const a = (await measure(on)).lum, b = (await measure(off)).lum;
  return { on, off, a, b, ratio: a / Math.max(b, 1e-6) };
}
const fmt = (r) => `on ${r.a.toFixed(2)} / off ${r.b.toFixed(2)} = ${r.ratio.toFixed(3)}`;
const TUNED = { max: 0.07, gamma: 2.2 };   // the pre-owner-pick default, for comparison
const bright = await ab(poses.bright[0], { max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma });
console.log(`sector light A/B, bright sector ${poses.bright[0].i} (light ${poses.bright[0].light}), default curve max ${DEFAULT_CURVE.max} γ${DEFAULT_CURVE.gamma}: ${fmt(bright)}`);
// The assertion is on the shipped default curve; the old default (max 0.07 γ2.2) is measured for comparison (report only).
const abPass = bright;
const abCurve = `default max ${DEFAULT_CURVE.max} γ${DEFAULT_CURVE.gamma}`;
const tunedBright = await ab(poses.bright[0], TUNED);
console.log(`sector light A/B, bright sector ${poses.bright[0].i}, max ${TUNED.max} γ${TUNED.gamma}: ${fmt(tunedBright)} (report only)`);
const dark = await ab(poses.dark, { max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma });
console.log(`sector light A/B, darkest sector ${poses.dark.i} (light ${poses.dark.light}), default curve: ${fmt(dark)} (report only)`);
if (process.env.SHOTS === '1') {
  save('e1m1-pool.png', poolRim); save('e1m1-pool-down.png', poolDown);
  save('e1m1-bright-on.png', abPass.on); save('e1m1-bright-off.png', abPass.off);
  const second = await ab(poses.bright[1], { max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma });
  const tunedDark = await ab(poses.dark, TUNED);
  const tunedSecond = await ab(poses.bright[1], TUNED);
  const lab = (q, what) => `${what}\nsector ${q.i}, light ${q.light}\nwall ${q.wall.toFixed(1)} m`;
  await sheet('sector-light-sheet.png', `Sector light on/off (on = ${abCurve}; pool at glowGain ${DEFAULT_CURVE.glowGain})`,
    [lab(poses.bright[0], 'bright A'), lab(poses.bright[1], 'bright B'), lab(poses.dark, 'darkest'), 'pool\n(pitch -0.5, -1.2)'],
    ['on', 'off', 'on, old max 0.07 γ2.2'],
    [[abPass.on, abPass.off, tunedBright.on], [second.on, second.off, tunedSecond.on], [dark.on, dark.off, tunedDark.on], [poolRim, poolDown, null]],
    [[abPass.a.toFixed(1), abPass.b.toFixed(1), tunedBright.a.toFixed(1)], [second.a.toFixed(1), second.b.toFixed(1), tunedSecond.a.toFixed(1)], [dark.a.toFixed(1), dark.b.toFixed(1), tunedDark.a.toFixed(1)], ['', `G/R ${(gm.g / Math.max(gm.r, 1e-6)).toFixed(2)}`, '']]);
  pass(`shots: ${OUT}/e1m1-pool.png, e1m1-bright-on/off.png, sector-light-sheet.png`);
}
if (process.env.TUNING === '1') {
  // The owner's sheet: rows = poses, columns = curves (light rows) or glowGain (pool row); mean grey per cell.
  const curves = [['off', { on: false }], ['max 0.07 γ2.2 (old)', { on: true, max: 0.07, gamma: 2.2 }], ['max 0.35 γ1.6 (default)', { on: true, max: 0.35, gamma: 1.6 }],
    ['max 0.6 γ1.2', { on: true, max: 0.6, gamma: 1.2 }], ['max 1.0 γ1.0', { on: true, max: 1, gamma: 1 }]];
  const gains = [1, 0.6, 0.35, 0.2];
  const rows = [poses.bright[0], poses.bright[1], poses.dark];
  const cells = [], notes = [], table = [];
  for (const q of rows) {
    await poseAt(q);
    const r = [], n = [];
    for (const [label, patch] of curves) {
      const b64 = await shotWith(patch); const m = await measure(b64);
      r.push(b64); n.push(`grey ${m.grey.toFixed(1)}`); table.push({ sector: q.i, light: q.light, curve: label, grey: +m.grey.toFixed(2) });
    }
    cells.push(r); notes.push(n);
  }
  await restore();
  await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0.6, -0.5, ${hz.pos[1]})`);
  const pr = [], pn = [];
  for (const k of gains) {
    const b64 = await shotWith({ glowGain: k }); const m = await measure(b64);
    pr.push(b64); pn.push(`grey ${m.grey.toFixed(1)} G/R ${(m.g / Math.max(m.r, 1e-6)).toFixed(2)}`);
    table.push({ sector: hz.sector, pool: true, glowGain: k, grey: +m.grey.toFixed(2), r: +m.r.toFixed(1), g: +m.g.toFixed(1), b: +m.b.toFixed(1) });
  }
  pr.push(null); pn.push('');
  cells.push(pr); notes.push(pn);
  await restore();
  const lab = (q, what) => `${what}\nsector ${q.i}\nDoom light ${q.light}\nwall ${q.wall.toFixed(1)} m`;
  await sheet('tuning-sheet.png', `E1M1 tuning sheet — light rows: columns = sector light curve; pool row: columns = glowGain 1.0 | 0.6 | 0.35 | 0.2 (flashlight ${flash === null ? 'ON (no seam)' : 'off'})`,
    [lab(rows[0], 'bright A'), lab(rows[1], 'bright B'), lab(rows[2], 'darkest'), `pool\nsector ${hz.sector}\npitch -0.5\ncols: glowGain`],
    curves.map(([l]) => l), cells, notes);
  console.log(`tuning: ${JSON.stringify(table)}`);
  pass(`tuning sheet: ${OUT}/tuning-sheet.png`);
}
if (!(abPass.ratio > 1.05)) fail(`sector light A/B: ${fmt(abPass)} at ${abCurve} (need > 1.05)`);
pass(`sector light A/B: ${fmt(abPass)} at ${abCurve}`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors: ${JSON.stringify(errs.slice(0, 4))}`);
process.exit(0);
