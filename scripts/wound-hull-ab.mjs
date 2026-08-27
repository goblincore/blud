// scripts/wound-hull-ab.mjs — hull-exclusion A/B driver (2026-08-27).
//
// The owner's regression: heavily-shot zombies lose whole parts; see-through
// holes when one body stands in front of another. Prime suspect: dcd61ca's
// wound exclusions on the occluder hull. This driver stages BOTH symptoms and
// captures each under three hull configs, everything else bit-identical
// (wounds stamped once, rig frozen, hand-stepped frames):
//
//   on      — shipped behaviour: occluder ON, wound exclusions ON
//   noexcl  — occluder ON, exclusions passed as []   (the brief's experiment)
//   noocc   — occluder pre-pass entirely OFF          (ground truth march)
//
// Every capture is pixel-diffed IN THE PAGE against its noocc reference, so
// the verdict is a pixel count, not an eyeball. Also records the redness
// metric on the crater close-up (the gate the fix must not regress).
//
//   node scripts/wound-hull-ab.mjs <vitePort> <cdpPort> <outDir> [phase]
//
// phase: all | invis | overlap | live
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5345);
const CDP = Number(process.argv[3] ?? 9345);
const OUT = process.argv[4] ?? '/tmp/wound-hull-ab';
const PHASE = process.argv[5] ?? 'all';
const W = 1100, H = 800;
const EYE = 1.62;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

/** Camera pose standing `dist` from (tx,tz) at angle `a`, looking at height ty. */
function around(tx, tz, a, dist, ty) {
  const sx = tx + Math.sin(a) * dist;
  const sz = tz + Math.cos(a) * dist;
  const yaw = Math.atan2(tx - sx, -(tz - sz));
  const pitch = Math.atan2(ty - EYE, dist);
  return { x: sx, z: sz, yaw, pitch };
}

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  return s.result.data;
}

// In-page: pixel diff of two PNGs (maxChannel delta > 24 counts), plus the
// red-dominant fraction + mean RGB of the central 40% crop (crater redness).
const DIFF_FN = `(async (a64, b64) => {
  const load = async (b) => { const i = new Image(); i.src = 'data:image/png;base64,' + b; await i.decode(); return i; };
  const [ia, ib] = await Promise.all([load(a64), load(b64)]);
  const c = document.createElement('canvas');
  c.width = ia.width; c.height = ia.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(ia, 0, 0);
  const da = g.getImageData(0, 0, c.width, c.height).data;
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(ib, 0, 0);
  const db = g.getImageData(0, 0, c.width, c.height).data;
  let diff = 0, n = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i]-db[i]), Math.abs(da[i+1]-db[i+1]), Math.abs(da[i+2]-db[i+2]));
    if (d > 24) diff++;
    n++;
  }
  // redness on the central crop of image a
  const x0 = Math.floor(c.width*0.3), x1 = Math.ceil(c.width*0.7);
  const y0 = Math.floor(c.height*0.3), y1 = Math.ceil(c.height*0.7);
  const dc = g.getImageData(x0, y0, x1-x0, y1-y0).data;
  let red = 0, R = 0, G = 0, B = 0, m = 0;
  for (let i = 0; i < dc.length; i += 4) {
    const r = dc[i], gg = dc[i+1], b = dc[i+2];
    R += r; G += gg; B += b; m++;
    if (r > 60 && r > 1.35*gg && r > 1.35*b) red++;
  }
  return { diffPx: diff, totalPx: n, diffFrac: +(diff/n).toFixed(5),
           redFrac: +(red/m).toFixed(4), meanR: +(R/m).toFixed(1), meanG: +(G/m).toFixed(1), meanB: +(B/m).toFixed(1) };
})`;

async function bootGame() {
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
  let api = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (api) break;
  }
  if (api !== 'webgpu') fail(`page never booted on webgpu (got ${api})`);
  for (let i = 0; i < 40; i++) {
    if (await evaluate('window.__sdfGame.frames > 30')) break;
    await sleep(250);
  }
  await evaluate('window.__sdfGame.freeze(true)');
  await evaluate('window.__sdfGame.step(2)');
  console.log('game booted: webgpu, frozen');
}

async function setPose(p) {
  await evaluate(`__sdfGame.setPose(${p.x}, ${p.z}, ${p.yaw}, ${p.pitch})`);
}

/** Set hull config by name; refreshHull rebuilds instances without a sim step. */
async function setConfig(cfg) {
  if (cfg === 'on') {
    await evaluate('__sdfGame.setOccluder(true); __sdfGame.setHullExclusions(true)');
  } else if (cfg === 'noexcl') {
    await evaluate('__sdfGame.setOccluder(true); __sdfGame.setHullExclusions(false)');
  } else if (cfg === 'noocc') {
    await evaluate('__sdfGame.setOccluder(false); __sdfGame.setHullExclusions(true)');
  }
  await evaluate('__sdfGame.refreshHull()');
  const hd = await evaluate('__sdfGame.hullDebug()');
  console.log(`  config ${cfg}: ${JSON.stringify(hd)}`);
  return hd;
}

/** Chest anchor (posed torso centre) of a zombie id. */
const chestExpr = `(id => {
  const z = __sdfGame.zombie(id);
  const p = z.posed();
  const t = p.clusters.find(c => c.limb === 'torso');
  return t ? t.center : null;
})`;

/** Stamp count slug wounds on body `id` from origin, aimed at a grid laid out
 *  in the origin→chest SCREEN plane (right/up basis), so a sideways-facing
 *  body still takes its wounds across the chest. */
async function stampGrid(id, origin, spread = 0.22) {
  const chest = await evaluate(`${chestExpr}(${id})`);
  if (!chest) fail(`no torso cluster on zombie ${id}`);
  let fx = chest[0] - origin[0], fy = chest[1] - origin[1], fz = chest[2] - origin[2];
  const L = Math.hypot(fx, fy, fz);
  fx /= L; fy /= L; fz /= L;                       // forward
  let rx = fz, ry = 0, rz = -fx;                   // forward × worldUp(0,1,0)
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; rz /= rl;
  const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx; // fwd × right
  const targets = [];
  for (const [sx, sy] of [[0, 0], [-spread, spread * 0.6], [spread, spread * 0.6], [-spread * 0.8, -spread], [spread * 0.8, -spread],
    [0, spread * 1.3], [-spread * 1.4, 0], [spread * 1.4, 0], [0, -spread * 1.7],
    [-spread * 2.1, -spread * 0.9], [spread * 2.1, -spread * 0.9], [-spread * 1.8, spread * 1.5]]) {
    targets.push([
      chest[0] + rx * sx + ux * sy,
      chest[1] + ry * sx + uy * sy,
      chest[2] + rz * sx + uz * sy,
    ]);
  }
  let ok = 0;
  for (const t of targets) {
    const ddx = t[0] - origin[0], ddy = t[1] - origin[1], ddz = t[2] - origin[2];
    const ll = Math.hypot(ddx, ddy, ddz);
    const hit = await evaluate(
      `__sdfGame.stampWoundAt(${origin[0]}, ${origin[1]}, ${origin[2]}, ${ddx / ll}, ${ddy / ll}, ${ddz / ll}, 'slug', ${id})`);
    if (hit) ok++;
  }
  const hd = await evaluate('__sdfGame.hullDebug()');
  console.log(`  stamped ${ok}/${targets.length} slug wounds on zombie ${id}; woundsPerBody=${JSON.stringify(hd.woundsPerBody)}`);
  return ok;
}

/** Capture one angle under one config; diff against the noocc reference. */
const refs = new Map(); // angleKey -> base64 (noocc)
const summary = [];
async function capture(key, cfg, pose) {
  await setPose(pose);
  await evaluate('__sdfGame.step(1)');
  const b64 = await shot(`${key}-${cfg}`);
  let row = { key, cfg };
  const ref = refs.get(key);
  if (cfg === 'noocc') {
    refs.set(key, b64);
    const m = await evaluate(`(${DIFF_FN})("${b64}", "${b64}")`);
    row.redFrac = m.redFrac; row.meanRGB = [m.meanR, m.meanG, m.meanB];
  } else if (ref) {
    const m = await evaluate(`(${DIFF_FN})("${b64}", "${ref}")`);
    row.diffPx = m.diffPx; row.diffFrac = m.diffFrac;
  }
  summary.push(row);
  console.log(`  ${key}-${cfg}: ${row.diffPx !== undefined ? `diff=${row.diffPx}px (${row.diffFrac})` : `ref (red=${row.redFrac})`}`);
  return row;
}

// =========================================================================
if (PHASE === 'invis' || PHASE === 'all') {
  console.log('== SCENE invis: room 1, one zombie, 12 slugs, 5 angles ==');
  await bootGame();
  const zs = await evaluate('__sdfGame.zombies()');
  const z = zs[0];
  console.log(`  target zombie ${z.id} at (${z.pos[0].toFixed(2)}, ${z.pos[2].toFixed(2)})`);
  const cam0 = around(z.pos[0], z.pos[2], 0, 1.8, 1.05);
  await setPose(cam0);
  await evaluate('__sdfGame.step(1)');
  await stampGrid(z.id, [cam0.x, EYE, cam0.z]);
  const angles = [
    ['front-close', around(z.pos[0], z.pos[2], 0, 1.4, 1.05)],
    ['front-wide', around(z.pos[0], z.pos[2], 0, 2.6, 1.05)],
    ['left55', around(z.pos[0], z.pos[2], 55 * Math.PI / 180, 2.0, 1.05)],
    ['right55', around(z.pos[0], z.pos[2], -55 * Math.PI / 180, 2.0, 1.05)],
    ['back150', around(z.pos[0], z.pos[2], 150 * Math.PI / 180, 2.2, 1.05)],
  ];
  for (const cfg of ['noocc', 'on', 'noexcl']) {
    await setConfig(cfg);
    for (const [key, pose] of angles) await capture(`invis-${key}`, cfg, pose);
  }
  writeFileSync(`${OUT}/summary-invis.json`, JSON.stringify(summary, null, 2));
}

if (PHASE === 'overlap' || PHASE === 'all') {
  console.log('== SCENE overlap: room 2, two zombies in depth, front one wounded ==');
  await bootGame();
  const zs = await evaluate('__sdfGame.zombies()').then(a => a.filter(z => z.room === 2));
  if (zs.length < 2) fail(`room 2 has ${zs.length} zombies, need 2`);
  const room = await evaluate('__sdfGame.rooms().find(r => r.id === 2)');
  // Choose the assignment whose extended camera stays inside the room (0.5 m margin).
  const camFor = (front, back) => {
    const ux = front.pos[0] - back.pos[0], uz = front.pos[2] - back.pos[2];
    const L = Math.hypot(ux, uz);
    return { x: front.pos[0] + ux / L * 2.0, z: front.pos[2] + uz / L * 2.0 };
  };
  const inside = (c) => c.x > room.bounds.minX + 0.5 && c.x < room.bounds.maxX - 0.5
    && c.z > room.bounds.minZ + 0.5 && c.z < room.bounds.maxZ - 0.5;
  let front, back, cam;
  if (inside(camFor(zs[0], zs[1]))) { front = zs[0]; back = zs[1]; }
  else { front = zs[1]; back = zs[0]; }
  cam = camFor(front, back);
  if (!inside(cam)) fail(`no legal axis camera for room-2 pair: ${JSON.stringify(cam)}`);
  console.log(`  front zombie ${front.id} at (${front.pos[0].toFixed(2)}, ${front.pos[2].toFixed(2)}), ` +
    `back zombie ${back.id} at (${back.pos[0].toFixed(2)}, ${back.pos[2].toFixed(2)}), cam (${cam.x.toFixed(2)}, ${cam.z.toFixed(2)})`);
  const dx = front.pos[0] - cam.x, dz = front.pos[2] - cam.z;
  const orbit = Math.atan2(-dx, -dz);  // around() angle that lands the camera AT cam
  const axisPose = { x: cam.x, z: cam.z, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(1.05 - EYE, Math.hypot(dx, dz)) };
  await setPose(axisPose);
  await evaluate('__sdfGame.step(1)');
  await stampGrid(front.id, [cam.x, EYE, cam.z]);
  const oangles = [
    ['axis', axisPose],
    ['left20', around(front.pos[0], front.pos[2], orbit + 20 * Math.PI / 180, 2.0, 1.05)],
    ['right20', around(front.pos[0], front.pos[2], orbit - 20 * Math.PI / 180, 2.0, 1.05)],
  ];
  const osummary = [];
  for (const cfg of ['noocc', 'on', 'noexcl']) {
    await setConfig(cfg);
    for (const [key, pose] of oangles) {
      const before = summary.length;
      const row = await capture(`overlap-${key}`, cfg, pose);
      osummary.push(row);
      void before;
    }
  }
  writeFileSync(`${OUT}/summary-overlap.json`, JSON.stringify(osummary, null, 2));
}

if (PHASE === 'live') {
  console.log('== SCENE live: room 2 wandering, wait for depth alignment, capture ==');
  await bootGame();
  const zs = await evaluate('__sdfGame.zombies()').then(a => a.filter(z => z.room === 2));
  const room = await evaluate('__sdfGame.rooms().find(r => r.id === 2)');
  const cx = (room.bounds.minX + room.bounds.maxX) / 2, cz = (room.bounds.minZ + room.bounds.maxZ) / 2;
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, 0, 0)`);
  await evaluate('__sdfGame.freeze(false)');
  await evaluate('__sdfGame.setLoopRunning(true)');
  console.log('  live loop running; polling for alignment (|angle| < 4 deg)...');
  const alignedExpr = `(() => {
    const zs = __sdfGame.zombies().filter(z => z.room === 2);
    if (zs.length < 2) return null;
    const p = __sdfGame.pose();
    const a1 = Math.atan2(zs[0].pos[0]-p.pos[0], -(zs[0].pos[2]-p.pos[2]));
    const a2 = Math.atan2(zs[1].pos[0]-p.pos[0], -(zs[1].pos[2]-p.pos[2]));
    let d = Math.abs(a1-a2); if (d > Math.PI) d = 2*Math.PI-d;
    const r1 = Math.hypot(zs[0].pos[0]-p.pos[0], zs[0].pos[2]-p.pos[2]);
    const r2 = Math.hypot(zs[1].pos[0]-p.pos[0], zs[1].pos[2]-p.pos[2]);
    return { deg: d*180/Math.PI, r1, r2 };
  })()`;
  let hit = null;
  for (let i = 0; i < 450; i++) {
    await sleep(200);
    hit = await evaluate(alignedExpr);
    if (hit && hit.deg < 4 && Math.abs(hit.r1 - hit.r2) > 0.8 && Math.min(hit.r1, hit.r2) < 5.5) break;
    hit = null;
  }
  if (!hit) { console.log('  no alignment within 90s — skipping live captures'); }
  else {
    console.log(`  aligned: ${JSON.stringify(hit)}; capturing 3 frames`);
    for (let i = 0; i < 3; i++) {
      await shot(`live-align-${i}`);
      await sleep(400);
    }
  }
  await evaluate('__sdfGame.setLoopRunning(false)');
}

console.log('== summary ==');
for (const r of summary) {
  console.log(`  ${r.key} [${r.cfg}]${r.diffPx !== undefined ? ` diffPx=${r.diffPx} (${r.diffFrac})` : ` redFrac=${r.redFrac} meanRGB=${JSON.stringify(r.meanRGB)}`}`);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
process.exit(0);
