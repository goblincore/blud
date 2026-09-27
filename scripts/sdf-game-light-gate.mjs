// scripts/sdf-game-light-gate.mjs — headless gate for the Night Train dynamic light and the
// flashlight (docs/superpowers/plans/2026-09-26-night-train-dynamic-light.md), on Night Train.
// No-deps CDP, same plumbing as scripts/sdf-game-loop-gate.mjs.
//
//   1. DARK START: the flashlight is off (spot intensity 0) until the coat check.
//   2. THE TORCH: taking it switches the flashlight on and kills the coat-check lamps (the cue).
//   3. LIGHTNING: a forced bolt spikes the window light and renders its shadow, only while lit.
//   4. THE STORM IN THE GLASS: the dining window is much brighter during a bolt.
//   5. BLACKOUT: the sleeper corridor trigger cuts the sleeper lamps, then they come back.
//   6. THE BOILER ROOM: the strobe, the steam plumes, the machinery.
//   7. THE SHARED LIST (plan 1, Task 10): the list is on for bodies and crowds. Two crowd actors
//      under different tubes pick different dominants; under a tube, a held bolt and the flashlight
//      the body-box mean is within 0.9x..1.2x of `?lightlist=0` at the same pose (a second boot);
//      the body box is never mostly black.
//      LIGHT_GATE_SHOT=<dir> keeps the A/B shots (list-<scene>-on|off.png).
//   8. BONES (Task 11): the skull catches the muzzle flash and does not glow in the dark.
//   9. GIBS (Task 12): a zombie blown up under a tube (default asset gibs, baked-chunk materials)
//      in the list boot and a `?lightlist=0` boot, gib pixels (the pixels that change when the
//      pieces are hidden in the same frame), tube then flashlight. List mode: the gib mean is no
//      darker than the old global key, within an absolute band under the tube and capped in the
//      beam, <= 10% dark (a gib pixel under 0.04 where the bare frame reads >= 0.07) and not blown;
//      every drawn gib MESH near the blast is list-lit by its own per-object record with a
//      third-class tube picked. `?lightlist=0`: no gib light switch is on. Then a third boot,
//      `?gibrender=march&chunkbake=0`: the marched chunk VIEWS are list-lit, rim-free (fresnel 0,
//      no list back rim), pick the tube in its pool, and are neither black nor blown.
//      LIGHT_GATE_ONLY_GIBS=1 runs section 9 alone.
//  10. COST (Task 13, spec §7): list on - off at most +1.5 ms a frame (median) in third class and
//      the Boiler Room (live switch, interleaved rounds). Enforced when the 1-min load average is
//      <= 4, a WARN line above that. LIGHT_GATE_ONLY_COST=1 runs it alone.
//
// Usage: LAB_VITE_PORT=5297 LAB_CDP_PORT=9297 node scripts/sdf-game-light-gate.mjs
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const T0 = Date.now();
const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const closeUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', closeUrl], { stdio: 'ignore' }); } catch {} });

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
let consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, ms = 30000) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), ms,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
async function boot(query) {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}` });
  for (let i = 0; i < 360; i++) {
    await sleep(500);
    const phase = await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null);
    if (phase === 'ready') return true;
    const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
    if (errs.length) return false;
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });

/** PNG decode (8-bit RGB/RGBA), copied from scripts/dungeon-shadowab.mjs. */
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}

import { writeFileSync } from 'node:fs';
const SHOT_OUT = process.env.LIGHT_GATE_SHOT;

/** Mean rgb (0..1) over a box given in fractions of the frame. */
function meanRgb(img, fx0, fy0, fx1, fy1) {
  const { w, h, ch, data } = img;
  const x0 = Math.floor(fx0 * w), x1 = Math.floor(fx1 * w), y0 = Math.floor(fy0 * h), y1 = Math.floor(fy1 * h);
  const acc = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * ch; acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n++; }
  return acc.map((v) => v / n / 255);
}

const f3 = (v) => v.map((x) => x.toFixed(3)).join(',');
const shoot = async (name) => {
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  if (SHOT_OUT) writeFileSync(`${SHOT_OUT}/${name}.png`, png);
  return decodePng(png);
};

const stats = (img, fx0, fy0, fx1, fy1) => {
  const { w, h, ch, data } = img; const v = [];
  for (let y = Math.floor(fy0 * h); y < Math.floor(fy1 * h); y++) for (let x = Math.floor(fx0 * w); x < Math.floor(fx1 * w); x++) {
    const i = (y * w + x) * ch; v.push((data[i] + data[i + 1] + data[i + 2]) / 765);
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { v, mean, std: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) };
};

/** Mean luminance (0..1) over the ring rIn..rOut px around (cx, cy), clipped to the frame. */
const ringMean = (img, cx, cy, rIn, rOut) => {
  const { w, h, ch, data } = img; let sum = 0, n = 0;
  for (let y = Math.max(0, Math.floor(cy - rOut)); y < Math.min(h, Math.ceil(cy + rOut)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rOut)); x < Math.min(w, Math.ceil(cx + rOut)); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < rIn || d > rOut) continue;
      const i = (y * w + x) * ch; sum += (data[i] + data[i + 1] + data[i + 2]) / 765; n++;
    }
  }
  return n ? sum / n : 0;
};
/** Skull disc radius and hood ring radii, in units of the skull's projected half-width. */
const SKULL_DISC = 0.7, RING_IN = 1.25, RING_OUT = 1.6;
const SKULL_FLESH_MAX = 1.5;

const settle = (ms = 700) => sleep(ms);

const lights = () => evaluate('__sdfGame.lights()');
const roomLamps = (l, room) => l.lamps.filter((x) => x.room === room && x.mood !== 'fire');

// LIGHT_GATE_ONLY_LIST=1 runs section 7 alone (the calibration loop).
if (!process.env.LIGHT_GATE_ONLY_LIST && !process.env.LIGHT_GATE_ONLY_GIBS && !process.env.LIGHT_GATE_ONLY_COST) {
// 1. DARK START — no flashlight until the coat check (carriage 4 of 8).
if (!(await boot('level=night-train&frozen&nospawn&god'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
let L = await lights();
if (!L) fail('no lights() seam');
if (L.flashlight !== 0 || L.spotIntensity !== 0) fail(`flashlight not dark at start: ${JSON.stringify({ f: L.flashlight, spot: L.spotIntensity })}`);
const coats = roomLamps(L, 6);
if (coats.map((x) => x.mood).join('/') !== 'dead/dying') fail(`coat-check lamp moods ${coats.map((x) => x.mood)}`);
if (L.windowLights.length < 5) fail(`window lights: ${JSON.stringify(L.windowLights)}`);
pass(`dark start: flashlight 0, coat-check lamps ${coats.map((x) => x.mood).join('/')}, window lights in rooms ${L.windowLights.join(',')}`);
// The shared light list (plan 1, Task 6): filled once a frame, capped at 32.
const LL = await evaluate('__sdfGame.lightList()');
if (!Array.isArray(LL) || LL.length === 0 || LL.length > 32) fail(`lightList(): ${JSON.stringify(LL)?.slice(0, 300)}`);
const llKinds = {};
for (const l of LL) llKinds[`${l.kind}:${l.profile}`] = (llKinds[`${l.kind}:${l.profile}`] ?? 0) + 1;
const llWin = LL.find((l) => l.profile === 'window');
// The window light reaches every windowed carriage (room mask, Task 6 review), not the tender.
if (llWin && llWin.rooms.join(',') !== [...L.windowLights].sort((x, y) => x - y).join(',')) fail(`window light rooms ${JSON.stringify(llWin.rooms)} != window lights ${JSON.stringify(L.windowLights)}`);
pass(`light list: ${LL.length} lights ${JSON.stringify(llKinds)}; window rooms ${llWin ? llWin.rooms.join(',') : 'none'}`);
await evaluate('__sdfGame.setPose(1.2, -57.0, 0, 0)');
await settle(1200);
const coatsDark = stats(await shoot('light-coats-dark'), 0.1, 0.1, 0.9, 0.9).mean;

// 2. THE TORCH — behind the coat-check counter (x -1.2, z -68.0).
await evaluate('__sdfGame.setPose(-0.5, -68.0, 1.5708, 0)');
await settle(1600);
L = await lights();
if (!(L.flashlight === 1 && L.spotIntensity > 0)) fail(`flashlight not on after the pickup: ${JSON.stringify({ f: L.flashlight, spot: L.spotIntensity })}`);
if (!roomLamps(L, 6).every((x) => x.script === 'die' && x.level === 0)) fail(`coat-check lamps not dead: ${JSON.stringify(roomLamps(L, 6))}`);
if ((await evaluate('__sdfGame.inventory()')).flashlight !== true) fail('inventory has no flashlight');
await evaluate('__sdfGame.setPose(1.2, -57.0, 0, 0)');
await settle(800);
const coatsLit = stats(await shoot('light-coats-lit'), 0.1, 0.1, 0.9, 0.9).mean;
pass(`the torch: flashlight on (spot ${L.spotIntensity.toFixed(0)}), coat-check lamps dead; mean ${coatsDark.toFixed(3)} -> ${coatsLit.toFixed(3)}`);

// 3. LIGHTNING — in the dining car, looking at the west window.
await evaluate(`__sdfGame.setPose(-0.4, -37.8, ${-Math.PI / 2}, -0.05)`);
await settle(1000);
for (let i = 0; i < 20 && (await lights()).windowIntensity > 0; i++) await sleep(150);
const idle0 = (await lights()).shadowFrames;
await sleep(400);
const idle1 = (await lights()).shadowFrames;
const noBolt = stats(await shoot('light-dining-idle'), 0.42, 0.30, 0.58, 0.45).mean;
await evaluate('__sdfGame.forceBolt(-1, -37)');
let peak = 0, frames0 = (await lights()).shadowFrames, shadowRoom = null;
let boltWin = null;
for (let i = 0; i < 6; i++) {
  await sleep(30);
  const l = await lights();
  if (l.windowIntensity > peak) { peak = l.windowIntensity; shadowRoom = l.shadowRoom ?? shadowRoom; }
  boltWin ??= (await evaluate('__sdfGame.lightList()')).find((x) => x.profile === 'window') ?? null;
}
const litFrames = (await lights()).shadowFrames - frames0;
if (!(peak > 3)) fail(`forced bolt: window light peaked at ${peak.toFixed(2)}`);
if (!(litFrames > 0)) fail('the window light rendered no shadow while lit');
// The list's window light reaches every windowed carriage, not the tender (room mask, Task 6 review).
const winRooms = [...L.windowLights].sort((x, y) => x - y).join(',');
if (!boltWin) fail('forced bolt: no window light in the light list');
if (boltWin.rooms.join(',') !== winRooms) fail(`list window light rooms ${JSON.stringify(boltWin.rooms)} != window lights ${winRooms}`);
pass(`lightning: window light peak ${peak.toFixed(2)}, ${litFrames} shadow frames lit (room ${shadowRoom}); list window rooms ${boltWin.rooms.join(',')}; idle ${idle1 - idle0}`);

// 4. THE STORM IN THE GLASS — the bolt flickers: the brightest of a few captures.
await sleep(1200);
for (let i = 0; i < 20 && (await lights()).windowIntensity > 0; i++) await sleep(150);
await evaluate('__sdfGame.forceBolt(-1, -37)');
let withBolt = 0;
for (let i = 0; i < 4; i++) withBolt = Math.max(withBolt, stats(await shoot(`light-dining-bolt-${i}`), 0.42, 0.30, 0.58, 0.45).mean);
if (!(withBolt > noBolt * 1.5)) fail(`the glass did not flash: ${noBolt.toFixed(4)} -> ${withBolt.toFixed(4)}`);
pass(`storm glass: mean ${noBolt.toFixed(4)} idle -> ${withBolt.toFixed(4)} with a bolt`);

// 5. BLACKOUT — the sleeper corridor at C3 (x -1.3, z -79.8).
await evaluate('__sdfGame.setPose(-1.3, -78.4, 0, 0)');
await settle(600);
if (!roomLamps(await lights(), 4).every((x) => x.script === null)) fail('sleeper lamps scripted before the trigger');
await evaluate('__sdfGame.setPose(-1.3, -79.8, 0, 0)');
await sleep(3000);
L = await lights();
if (!roomLamps(L, 4).every((x) => x.script === 'blackout' && x.level === 0)) fail(`sleeper not blacked out: ${JSON.stringify(roomLamps(L, 4))}`);
await shoot('light-sleeper-blackout');
// The light clock is SIM time, slower than wall time headless: wait for the recovery, up to 15 s.
let back = false;
for (let i = 0; i < 30 && !back; i++) {
  await sleep(500);
  L = await lights();
  back = roomLamps(L, 4).some((x) => x.level > 0) && L.time - roomLamps(L, 4)[0].scriptAt > 7.5;
}
if (!roomLamps(L, 4).some((x) => x.level > 0)) fail(`sleeper lamps did not come back: ${JSON.stringify(roomLamps(L, 4))}`);
pass('blackout: the sleeper corridor trigger cuts the lamps, and they come back');

// 6. THE BOILER ROOM STROBE, the steam and the machinery
await evaluate('__sdfGame.setPose(0, -96.0, 0, 0)');
await sleep(900);
await shoot('light-boiler-strobe');
L = await lights();
if (!roomLamps(L, 5).every((x) => x.script === 'strobe')) fail(`boiler room lamps not strobing: ${JSON.stringify(roomLamps(L, 5))}`);
const tr = await evaluate('__sdfGame.train()');
if (!(tr.steam > 0)) fail(`no steam plumes: ${JSON.stringify(tr)}`);
pass(`boiler room: the threshold starts the strobe; ${tr.steam} steam plumes, ${tr.swaying} moving piece sets`);
}

// 7. THE SHARED LIST (plan 1, Task 10). Fresh boots WITH the cast, clocks pinned so the two boots
// render the same scene state: `lightlist` on (the default) first, then `?lightlist=0` (the old
// key path) at the same poses.
/** The actor nearest (x, z), moved to stand at (x, z) (the nudge's own clamps apply). */
async function placeNearest(x, z) {
  const zs = await evaluate('__sdfGame.zombies()');
  const a = zs.sort((p, q) => Math.hypot(p.pos[0] - x, p.pos[2] - z) - Math.hypot(q.pos[0] - x, q.pos[2] - z))[0];
  if (!a) fail('no actor to place');
  await evaluate(`__sdfGame.zombieNudge(${a.id}, ${x - a.pos[0]}, ${z - a.pos[2]})`);
  return a.id;
}
/** Frame the actor nearest (x, z) from `back` metres toward +z, eye height, looking at it. */
async function frameNearest(x, z, back = 2.4) {
  const zs = await evaluate('__sdfGame.zombies()');
  const a = zs.sort((p, q) => Math.hypot(p.pos[0] - x, p.pos[2] - z) - Math.hypot(q.pos[0] - x, q.pos[2] - z))[0];
  if (!a) fail('no actor to frame');
  const cx = a.pos[0], cz = a.pos[2] + back;
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${Math.atan2(-(a.pos[0] - cx), -(a.pos[2] - cz))}, -0.12)`);
  return a;
}
/** A hand step: the first frames at a new pose can compile a crowd type's program (tens of s). */
const stepN = (n, dt) => evaluate(`__sdfGame.step(${n}${dt === undefined ? '' : `, ${dt}`})`, 300000);
/** Body-box luminance: mean, std and the share of near-black pixels (< 0.04). */
function bodyBox(img) {
  const s = stats(img, 0.38, 0.2, 0.62, 0.8);
  return { mean: s.mean, std: s.std, dark: s.v.filter((v) => v < 0.04).length / s.v.length };
}
// Third class (room 1): tubes at z -12 and -4 (the list's first two). The A/B actor stands under
// the z -12 tube's pool; the crowd pair stands under the two tubes.
// Both stand just past their tube (seen from the camera, 2.4 m toward +z), so the tube is between
// the body and the viewer: the pool presents the body's front on both paths. The train is stopped
// (setTrainSpeed(0)) so the tubes hang still: the old key's direction follows the tube's swing, and
// a swing frozen at a random phase moved the ?lightlist=0 tube mean 0.16-0.23 boot to boot.
const UNDER_A = [0.4, -12.6], UNDER_B = [-0.4, -4.4];
/** The dining car (room 3), 1.3 m from its west windows: the held bolt's owner A/B (Task 13), a
 *  look row only (not in the on/off band: the calibration scenes are the three above). The nudge's
 *  clamps leave the actor about 2.2 m from the point, so its frame check allows 3 m. */
const DINING = [-0.8, -42.0];
const SCENES = [
  { name: 'tube', frame: UNDER_A, setup: ['holdWindowLight(0, -1)', 'setFlashlight(false)'] },
  { name: 'bolt', frame: UNDER_A, setup: ['holdWindowLight(32, -1)', 'setFlashlight(false)'] },
  // The torch ramps on the light clock (TORCH_ON_S): run it for the scene's 30 steps, then re-pin
  // the clock with the tubes lit.
  { name: 'flashlight', frame: UNDER_B, setup: ['holdWindowLight(0, -1)', 'setLightClockFrozen(false)', 'setFlashlight(true)'], repin: true },
  // Before the dark scene, which drops the held bolt again for the sections after it.
  { name: 'dining', frame: DINING, room: 3, near: 3, setup: ['holdWindowLight(32, -1)', 'setFlashlight(false)'] },
  // The coat check (room 6): its lamps are dead at the start, nothing picks these bodies.
  { name: 'dark', frame: [-1.2, -62.4], room: 6, setup: ['holdWindowLight(0, -1)', 'setFlashlight(false)'] },
];
/** How far the framed actor may stand from a scene's target point (Task 10 review): the nearest
 *  actor must really be the one placed there, not a body in another carriage. */
const FRAME_NEAR = 2;
/** Pin the flicker clock at a moment when third class's tubes are all at full level (one of them
 *  flickers; its frozen phase is otherwise boot-to-boot luck), so both boots, the crowd pair and
 *  every scene see the same lamps. */
async function pinLit() {
  for (let i = 0; ; i++) {
    await evaluate('__sdfGame.setLightClockFrozen(true)');
    await stepN(2);
    if (roomLamps(await lights(), 1).every((x) => x.level > 0.97)) return;
    if (i >= 60) fail(`third-class tubes never all lit: ${JSON.stringify(roomLamps(await lights(), 1))}`);
    await evaluate('__sdfGame.setLightClockFrozen(false)');
    await stepN(7);
  }
}
async function listBoot(query) {
  if (process.env.GIB_RENDER) query += `&gibrender=${process.env.GIB_RENDER}`;
  if (!(await boot(query))) { console.error(consoleEvents.slice(-8)); fail(`night-train did not boot (${query})`); }
  await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
  await evaluate('__sdfGame.setFlashlight(false)');
  await evaluate('__sdfGame.setDemoHold(true)');
  await evaluate('__sdfGame.setTrainSpeed(0)');
  await evaluate('__sdfGame.holdWindowLight(0, -1)');
  // The coat check's lamps start dead/dying on a clock: kill them, so the dark scene has no picks
  // in either boot (a dying lamp's frozen flicker phase differs boot to boot).
  await evaluate('__sdfGame.lightCommand("die", 6)');
  await evaluate('__sdfGame.setPose(0, -12.0, 0, -0.05)');
  await settle(3000);   // the first step at a new pose compiles; let the warm path finish (and the lamps die)
  // The die script runs on the light clock (hand-stepped here): step until the coat check is dark.
  const died = (l) => roomLamps(l, 6).every((x) => x.level === 0 && x.scriptAt !== null && l.time - x.scriptAt > 2.5);
  for (let i = 0; !died(await lights()); i++) {
    if (i >= 60) fail(`coat-check lamps never died: ${JSON.stringify(roomLamps(await lights(), 6))}`);
    await stepN(10);
  }
  await pinLit();
  if (!roomLamps(await lights(), 6).every((x) => x.level === 0)) fail(`coat-check lamps not dead: ${JSON.stringify(roomLamps(await lights(), 6))}`);
  await placeNearest(...UNDER_A);
  await placeNearest(...UNDER_B);
  await placeNearest(...DINING);
  await stepN(20);
}
async function listScenes(tag) {
  const out = {};
  for (const sc of SCENES) {
    for (const c of sc.setup) await evaluate(`__sdfGame.${c}`);
    await frameNearest(...sc.frame);
    await stepN(30);
    if (sc.repin) await pinLit();
    await stepN(12, 0);
    if (sc.name === 'flashlight' && (await lights()).flashlight !== 1) fail(`flashlight scene: torch level ${(await lights()).flashlight}`);
    await settle(300);
    out[sc.name] = bodyBox(await shoot(`list-${sc.name}-${tag}`));
    if (process.env.LIGHT_GATE_DEBUG) {
      const a = await frameNearest(...sc.frame);
      console.log('DBG', tag, sc.name, JSON.stringify(await evaluate(`(() => { const z = __sdfGame.zombie(${a.id}); const u = z.view.uniforms; const L = __sdfGame.lights(); return { id: ${a.id}, room: z.room, pos: z.pose().pos, s2: u.spotCfg2.value.toArray(), kc: u.keyColor.value.toArray(), ld: u.lightDir.value.toArray(), lc: u.lightCfg.value.toArray(), ll: u.lightListCfg.value.toArray(), bl: u.bodyLights.value.toArray(), win: L.windowIntensity, flash: L.flash, r1: L.lamps.filter(x => x.room === 1).map(x => x.level), rl: L.roomLight }; })()`)));
    }
    if (sc.room !== undefined) {
      // The framed actor really is in the scene's room, at its target (Task 10 review): else the
      // "dark" A/B could silently measure a body in a lit carriage.
      const a = await frameNearest(...sc.frame);
      const room = a.room;
      const d = Math.hypot(a.pos[0] - sc.frame[0], a.pos[2] - sc.frame[1]);
      if (room !== sc.room || !(d <= (sc.near ?? FRAME_NEAR))) fail(`${sc.name} scene (${tag}): framed actor ${a.id} in room ${room} (want ${sc.room}), ${d.toFixed(2)} m from the target (max ${sc.near ?? FRAME_NEAR})`);
    }
    if (sc.name === 'dark' && tag === 'on') {
      const a = await frameNearest(...sc.frame);
      const p = (await evaluate('__sdfGame.bodyPicks()')).find((q) => q.id === a.id);
      if (!p || p.picks.some((k) => k.index >= 0)) fail(`dark scene: the framed body still picks lights: ${JSON.stringify(p)}`);
    }
  }
  return out;
}
const fmt = (b) => `mean ${b.mean.toFixed(3)} std ${b.std.toFixed(3)} dark ${(b.dark * 100).toFixed(1)}%`;

// 10. COST (plan 1, Task 13; spec §7): the list may cost at most +1.5 ms a frame over
// `?lightlist=0` in either carriage. One boot, the live switch (`setLightList(on)`: the list and
// the old path are one compiled shader behind a uniform, so the switch is the second boot's frame
// without the boot-to-boot noise), rounds interleaved off/on (the order alternates per round, so a
// drift in the machine's state lands on both sides). The rAF loop is stopped (hand steps, frame cap
// 1); each sample is COST_FRAMES fenced `timeDraws(1)` frames (CPU + GPU, the list's CPU pick and
// gather included: both run inside the draw) with the per-pass GPU timestamps drained per frame.
// Third class (0, -12.0, 0, -0.05) and the Boiler Room (0, -96.0, 0, 0), the window held dark, the
// flicker clock pinned with the carriage's lamps lit (the Boiler Room at a strobe peak: the most
// picks). The pass/fail is the median frame on - off; the GPU passes are reported alongside.
// ENFORCED ON A QUIET MACHINE. Measured (Task 13, dev note): the list costs +0.0..0.4 ms frame
// median and +0.0..0.3 ms GPU span in both carriages, and the median's run-to-run noise at load
// average < 4 is about +-0.4 ms, well under the budget. On a loaded machine the medians swing by
// +-3 ms (one run at load 6-7 read -3.25 ms), so when the 1-minute load average is over
// COST_MAX_LOAD at the start of the section, an over-budget result is a WARN line, not a fail
// (a flake is not a finding). LIGHT_GATE_COST_REPORT_ONLY=1 forces report-only.
// LIGHT_GATE_ONLY_COST=1 runs this section alone; LIGHT_GATE_COST_QUERY adds to the boot query
// (e.g. `&refine=1`); LIGHT_GATE_COST_ROUNDS (default 8) sets the rounds;
// LIGHT_GATE_COST_JSON=<file> keeps the samples.
const COST_BUDGET_MS = 1.5;
const COST_MAX_LOAD = 4;
const COST_ROUNDS = Number(process.env.LIGHT_GATE_COST_ROUNDS ?? 8);
const COST_FRAMES = 9;
const COST_CARRIAGES = [
  { name: 'third class', pose: '0, -12.0, 0, -0.05', room: 1 },
  { name: 'Boiler Room', pose: '0, -96.0, 0, 0', room: 5 },
];
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
/** COST_FRAMES fenced frames, each with its passes' GPU timestamps drained: frame ms, and the
 *  GPU passes charged EXCLUSIVELY by completion order (gpu-pass-timing.ts attributePassSamples: on
 *  this Apple GPU every pass in a frame reports the same start, so a pass's own end - start is
 *  queue residency, not cost; summed it reads 100+ ms for a 16 ms frame). One evaluate, so no CDP
 *  round trip sits between a frame and its timestamps. */
const costFrames = () => evaluate(`(async () => {
  await __sdfGame.passTimings();
  const out = [];
  for (let i = 0; i < ${COST_FRAMES}; i++) {
    const ms = await __sdfGame.timeDraws(1);
    const pt = await __sdfGame.passTimings();
    out.push({ ms, s: (pt?.samples ?? []).filter((x) => x.start !== undefined && x.end !== undefined).map((x) => [x.label, x.start, x.end]) });
  }
  return out;
})()`, 120000);
/** Exclusive GPU ms per label for one frame's samples, and the GPU span (their sum). */
function exclusivePasses(samples) {
  const sorted = [...samples].sort((a, b) => a[2] - b[2]);
  let cursor = Math.min(...sorted.map((x) => x[1]));
  const by = {}; let span = 0;
  for (const [label, start, end] of sorted) {
    const ms = Math.max(0, end - Math.max(cursor, start));
    by[label] = (by[label] ?? 0) + ms; span += ms;
    cursor = Math.max(cursor, end);
  }
  return { by, span };
}
async function costCarriage(c) {
  await evaluate(`__sdfGame.setPose(${c.pose})`);
  await evaluate('__sdfGame.setLightClockFrozen(false)');
  await stepN(3, 0);
  await settle(1500);   // a new pose compiles; let the warm path finish
  // Pin the flicker clock with this carriage's lamps lit (the strobe at a peak).
  for (let i = 0; ; i++) {
    await evaluate('__sdfGame.setLightClockFrozen(true)');
    await stepN(2);
    const lamps = roomLamps(await lights(), c.room);
    if (lamps.length && Math.min(...lamps.map((x) => x.level)) > 0.9) break;
    if (i >= 80) { console.log(`     cost ${c.name}: lamps never all lit, measuring at ${JSON.stringify(lamps.map((x) => x.level))}`); break; }
    await evaluate('__sdfGame.setLightClockFrozen(false)');
    await stepN(1 + (i % 5));
  }
  const s = { off: [], on: [], gpuOff: [], gpuOn: [], by: { off: {}, on: {} } };
  for (let round = 0; round < COST_ROUNDS; round++) {
    for (const on of round % 2 ? [true, false] : [false, true]) {
      const k = on ? 'on' : 'off';
      await evaluate(`__sdfGame.setLightList(${on})`);
      await stepN(3, 0);
      await evaluate('__sdfGame.timeDraws(3)');
      const fr = await costFrames();
      s[k].push(median(fr.map((f) => f.ms)));
      const ex = fr.filter((f) => f.s.length).map((f) => exclusivePasses(f.s));
      if (ex.length) s[on ? 'gpuOn' : 'gpuOff'].push(median(ex.map((e) => e.span)));
      for (const e of ex) for (const [l, v] of Object.entries(e.by)) (s.by[k][l] ??= []).push(v);
    }
  }
  // What the frame holds: the bodies that pick a light here (list on), and the A/B frames.
  const pk = await evaluate('__sdfGame.bodyPicks()');
  const picked = pk.filter((p) => p.room === c.room && p.picks.some((q) => q.index >= 0)).length;
  const inRoom = pk.filter((p) => p.room === c.room).length;
  if (SHOT_OUT) {
    const tag = c.name.replace(/\W+/g, '-').toLowerCase();
    for (const on of [false, true]) {
      await evaluate(`__sdfGame.setLightList(${on})`);
      await stepN(3, 0);
      await settle(300);
      await shoot(`cost-${tag}-${on ? 'on' : 'off'}`);
    }
  }
  await evaluate('__sdfGame.setLightList(true)');
  const byMed = (k) => Object.fromEntries(Object.entries(s.by[k]).map(([l, v]) => [l, median(v)]));
  const r = {
    name: c.name, bodies: { inRoom, picked }, off: median(s.off), on: median(s.on), gpuOff: median(s.gpuOff), gpuOn: median(s.gpuOn),
    spreadOff: [Math.min(...s.off), Math.max(...s.off)], spreadOn: [Math.min(...s.on), Math.max(...s.on)],
    // Per-round deltas (a round's on minus its own off): their spread is the bench's noise.
    deltas: s.on.map((v, i) => v - s.off[i]), gpuDeltas: s.gpuOn.map((v, i) => v - s.gpuOff[i]),
    passOff: byMed('off'), passOn: byMed('on'), samples: s,
  };
  return r;
}
async function costSection() {
  const q = `level=night-train&frozen&god${process.env.LIGHT_GATE_COST_QUERY ?? ''}`;
  if (!(await boot(q))) { console.error(consoleEvents.slice(-8)); fail(`night-train did not boot (${q})`); }
  await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
  await evaluate('__sdfGame.setFlashlight(false)');
  await evaluate('__sdfGame.setDemoHold(true)');
  await evaluate('__sdfGame.setTrainSpeed(0)');
  await evaluate('__sdfGame.holdWindowLight(0, -1)');
  await evaluate('__sdfGame.setFrameCap(1)');
  const pt = await evaluate('__sdfGame.passTimings()');
  // The gate's own earlier sections (shader compiles, three boots) push the 1-min load average
  // to 6-7 by here: give it up to 2 minutes to decay before measuring.
  const { loadavg } = await import('node:os');
  for (let i = 0; i < 24 && loadavg()[0] > COST_MAX_LOAD; i++) await sleep(5000);
  const load = loadavg()[0];
  const enforce = !process.env.LIGHT_GATE_COST_REPORT_ONLY && load <= COST_MAX_LOAD;
  const out = [];
  for (const c of COST_CARRIAGES) out.push(await costCarriage(c));
  const f2 = (v) => v.toFixed(2);
  const spread = (d) => `${f2(Math.min(...d))}..${f2(Math.max(...d))}`;
  for (const r of out) {
    console.log(`     cost ${r.name.padEnd(11)} (${r.bodies.picked}/${r.bodies.inRoom} bodies in the carriage list-lit) frame off ${f2(r.off)} (${r.spreadOff.map(f2).join('..')}) on ${f2(r.on)} (${r.spreadOn.map(f2).join('..')}) -> median on-off ${f2(r.on - r.off)} ms, per-round deltas ${spread(r.deltas)} | GPU span off ${f2(r.gpuOff)} on ${f2(r.gpuOn)} -> ${f2(r.gpuOn - r.gpuOff)} ms (rounds ${spread(r.gpuDeltas)})`);
    const labels = [...new Set([...Object.keys(r.passOff), ...Object.keys(r.passOn)])]
      .map((l) => [l, (r.passOn[l] ?? 0) - (r.passOff[l] ?? 0), r.passOn[l] ?? 0])
      .filter(([, , v]) => v > 0.05).sort((a, b) => b[2] - a[2]).slice(0, 8);
    console.log(`          passes (exclusive GPU ms: median on, on-off): ${labels.map(([l, d, v]) => `${l} ${f2(v)} (${d >= 0 ? '+' : ''}${f2(d)})`).join(', ')}`);
  }
  if (!pt?.installed) console.log('     cost: no GPU timestamps on this page (passTimings not installed); frame times only');
  if (process.env.LIGHT_GATE_COST_JSON) writeFileSync(process.env.LIGHT_GATE_COST_JSON, JSON.stringify({ query: q, rounds: COST_ROUNDS, frames: COST_FRAMES, out }, null, 2));
  for (const r of out) {
    const d = r.on - r.off;
    if (d > COST_BUDGET_MS) {
      const msg = `cost: ${r.name} median frame on-off ${f2(d)} ms > ${COST_BUDGET_MS} ms (spec §7)`;
      if (enforce) fail(msg);
      console.log(`WARN ${msg} [report-only: load average ${load.toFixed(2)}${load > COST_MAX_LOAD ? ` > ${COST_MAX_LOAD}` : ', LIGHT_GATE_COST_REPORT_ONLY'}; rerun on a quiet machine]`);
    }
  }
  pass(`cost (${enforce ? 'enforced' : 'report-only'}, load ${load.toFixed(2)}, budget +${COST_BUDGET_MS} ms): ${out.map((r) => `${r.name} ${f2(r.on - r.off)} ms`).join(', ')}`);
  return out;
}
if (process.env.LIGHT_GATE_ONLY_COST) {
  await costSection();
  console.log(`PASS sdf-game-light-gate cost only (wall ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  process.exit(0);
}

await listBoot('level=night-train&frozen&god');
const LL3 = await evaluate('__sdfGame.lightList()');
if (!Array.isArray(LL3) || LL3.length === 0 || LL3.length > 32) fail(`lightList() in third class: ${JSON.stringify(LL3)?.slice(0, 300)}`);
// The crowd fix: every crowd member carries its own picks (its record), not the type's.
const zs7 = await evaluate('__sdfGame.zombies()');
const near = (x, z) => zs7.sort((p, q) => Math.hypot(p.pos[0] - x, p.pos[2] - z) - Math.hypot(q.pos[0] - x, q.pos[2] - z))[0];
const [ia, ib] = [near(...UNDER_A), near(...UNDER_B)];
const picks = await evaluate('__sdfGame.bodyPicks()');
const pa = picks.find((p) => p.id === ia.id), pb = picks.find((p) => p.id === ib.id);
const sep = Math.hypot(ia.pos[0] - ib.pos[0], ia.pos[2] - ib.pos[2]);
if (!pa || !pb || pa.room !== pb.room || !pa.crowd || !pb.crowd || !(sep > 1.5)) fail(`crowd pair: ${JSON.stringify({ pa, pb, sep })}`);
if (pa.picks[0].index < 0 || pb.picks[0].index < 0 || pa.picks[0].index === pb.picks[0].index) fail(`crowd pair share a dominant: ${JSON.stringify({ a: pa.picks, b: pb.picks })}`);
const lit = picks.filter((p) => p.picks[0].index >= 0).length;
pass(`shared list: ${LL3.length} lights in third class; crowd actors ${pa.id}/${pb.id} (room ${pa.room}, ${sep.toFixed(1)} m apart) dominants ${pa.picks[0].index} (w ${pa.picks[0].weight.toFixed(3)}) / ${pb.picks[0].index} (w ${pb.picks[0].weight.toFixed(3)}); ${lit}/${picks.length} bodies picked`);
const listOn = process.env.LIGHT_GATE_ONLY_GIBS ? null : await listScenes('on');

// 8. BONES READ THE SAME LIGHTS (plan 1, Task 11): the skull catches the muzzle flash. In the dark
// coat check (nothing picks the body), a slug crater opens the face of the nearest actor to its
// mesh skull; the player's muzzle flash (held by hand-stepping at dt 0) must be among the skull
// instances' own picks (iLights = the owner's bodyLights), and the crater crop brightens. Before the
// flash (Task 11b) the skull may not glow: its bone fill is the body's dark-room factor and the skull
// disc is at most 1.5x the hood ring around it.
// LIGHT_GATE_SHOT=<dir> keeps skull-noflash-<tag>.png / skull-flash-<tag>.png. The ?lightlist=0
// boot runs the same scene for the record (the old key path: no picks, the flash rides the beam).
async function skullScene(tag) {
  const [sx, sz] = [-1.2, -62.4];
  const a = await frameNearest(sx, sz);
  const diag = await evaluate('__sdfGame.skeletonDiagnostics()');
  if (diag.activeMode !== 'mesh') fail(`skull: skeleton mode ${JSON.stringify(diag)}`);
  const hit = await evaluate(`__sdfGame.hitMeshSkull(${a.id})`);
  if (!hit || !hit.stamped) fail(`skull: hitMeshSkull(${a.id}) stamped nothing: ${JSON.stringify(hit)}`);
  // Face the crater from 0.9 m, straight on, at its height.
  const w = (await evaluate(`__sdfGame.actorWounds(${a.id})`)).at(-1);
  const zs = await evaluate('__sdfGame.zombies()');
  const me = zs.find((q) => q.id === a.id);
  const dx = w.pos[0] - me.pos[0], dz = w.pos[2] - me.pos[2], dl = Math.hypot(dx, dz) || 1;
  const cx = w.pos[0] + (dx / dl) * 0.9, cz = w.pos[2] + (dz / dl) * 0.9;
  const eye = (await evaluate('__sdfGame.pose()')).pos[1] + 1.62;   // PLAYER.eye
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${Math.atan2(-(w.pos[0] - cx), -(w.pos[2] - cz))}, ${Math.atan2(w.pos[1] - eye, 0.9)})`);
  await stepN(20);
  await stepN(8, 0);
  await settle(300);
  const W = 800, H = 600;
  const sp = await evaluate(`__sdfGame.worldToScreen(${w.pos[0]}, ${w.pos[1]}, ${w.pos[2]}, ${W}, ${H})`);
  if (!sp || sp.x < 0 || sp.x > W || sp.y < 0 || sp.y > H) fail(`skull: crater off screen ${JSON.stringify(sp)}`);
  const rPx = Math.max(12, Math.min(60, (w.radius / 0.9) * (H / 2) / Math.tan((35 * Math.PI) / 180) * 0.7));
  const box = [(sp.x - rPx) / W, (sp.y - rPx) / H, (sp.x + rPx) / W, (sp.y + rPx) / H];
  const before = await evaluate(`__sdfGame.boneLights(${a.id})`);
  const imgOff = await shoot(`skull-noflash-${tag}`);
  const skullOff = stats(imgOff, ...box).mean;
  // Task 11b: the exposed skull vs the flesh around it, in the same frame, centred on the
  // projected head bound (the crater box above sits off the skull's centre): a disc inside the
  // skull and a ring on the hood just outside it, both in units of the skull's projected half-width.
  const hc = await evaluate(`__sdfGame.worldToScreen(${hit.headCenter.join(', ')}, ${W}, ${H})`);
  const he = await evaluate(`__sdfGame.worldToScreen(${hit.headEdge.join(', ')}, ${W}, ${H})`);
  const hR = Math.hypot(he.x - hc.x, he.y - hc.y);
  const boneOff = ringMean(imgOff, hc.x, hc.y, 0, hR * SKULL_DISC);
  const fleshOff = ringMean(imgOff, hc.x, hc.y, hR * RING_IN, hR * RING_OUT);
  const woundsBefore = (await evaluate(`__sdfGame.actorWounds(${a.id})`)).length;
  // The flash alone (no shot: Night Train's player owns no shotgun here), the same flash clock fire() restarts.
  const fired = await evaluate('__sdfGame.muzzleFlash()');
  if (!fired) fail('skull: no muzzle flash light');
  await stepN(3, 0);
  await settle(300);
  const skullOn = stats(await shoot(`skull-flash-${tag}`), ...box).mean;
  const after = await evaluate(`__sdfGame.boneLights(${a.id})`);
  const LLf = await evaluate('__sdfGame.lightList()');
  const woundsAfter = (await evaluate(`__sdfGame.actorWounds(${a.id})`)).length;
  const muzzleIdx = LLf.map((l, i) => (l.profile === 'muzzle' ? i : -1)).filter((i) => i >= 0);
  if (process.env.LIGHT_GATE_DEBUG) console.log('DBG skull', JSON.stringify({ hit, w, sp, rPx, hc, hR, boneOff, fleshOff, fired, before, after, muzzleIdx, woundsBefore, woundsAfter }));
  if (tag === 'off') {
    if (after?.listOn !== 0) fail(`skull (?lightlist=0): bone renderer list switch on: ${JSON.stringify(after)}`);
    return { skullOff, skullOn, boneOff, fleshOff };
  }
  if (muzzleIdx.length === 0) fail(`skull: no muzzle light in the list after fire(): ${JSON.stringify(LLf.map((l) => l.profile))}`);
  if (!after || after.listOn !== 1) fail(`skull: bone renderer list switch off: ${JSON.stringify(after)}`);
  if (!after.instances.length) fail('skull: the actor draws no bone-mesh instances');
  const idx = (v) => Math.floor(v + 1e-6);
  const withMuzzle = after.instances.filter((row) => row.some((v) => v >= 0 && muzzleIdx.includes(idx(v)))).length;
  if (withMuzzle !== after.instances.length) fail(`skull: ${withMuzzle}/${after.instances.length} bone instances pick the muzzle light (${muzzleIdx}): ${JSON.stringify(after.instances[0])} body ${JSON.stringify(after.body)}`);
  if (before.instances.some((row) => row.some((v) => v >= 0 && muzzleIdx.includes(idx(v))))) fail(`skull: muzzle picked before the flash: ${JSON.stringify(before.instances[0])}`);
  if (!(skullOn > skullOff * 1.15 && skullOn - skullOff > 0.02)) fail(`skull: crater crop did not brighten in the flash: ${skullOff.toFixed(3)} -> ${skullOn.toFixed(3)}`);
  // Task 11b: NO GLOW in the dark. The bone ambient follows the owner's room fill (the body's
  // applyRoomFill factor), so with nothing picking the body the skull may not sit far above the
  // flesh around it: skull disc mean <= SKULL_FLESH_MAX x the hood ring mean. Measured at Task 11b:
  // 1.73x before the fix (the ambient seeded once, at full), 1.18x after; ?lightlist=0 reads ~1.8x
  // (the old path, untouched on purpose). Every bone instance carries the body's fill factor, < 1 in this dead room.
  const fills = before.fill ?? [];
  if (!fills.length || fills.some((f) => !(f < 0.999)) || Math.max(...fills) - Math.min(...fills) > 1e-6) fail(`skull: bone fill not the owner's dark-room factor: ${JSON.stringify(fills)}`);
  if (!(boneOff <= fleshOff * SKULL_FLESH_MAX)) fail(`skull glows in the dark: skull ${boneOff.toFixed(3)} vs surrounding flesh ${fleshOff.toFixed(3)} (${(boneOff / fleshOff).toFixed(2)}x > ${SKULL_FLESH_MAX}x)`);
  pass(`skull does not glow in the dark coat check: bone fill ${fills[0].toFixed(3)} x ${fills.length}; skull ${boneOff.toFixed(3)} vs surrounding flesh ${fleshOff.toFixed(3)} (${(boneOff / fleshOff).toFixed(2)}x <= ${SKULL_FLESH_MAX}x)`);
  pass(`skull catches the muzzle flash: actor ${a.id}, ${withMuzzle}/${after.instances.length} bone instances pick muzzle light ${muzzleIdx} (skull picks ${JSON.stringify(after.instances[0].map((v) => +v.toFixed(3)))}); crater crop mean ${skullOff.toFixed(3)} -> ${skullOn.toFixed(3)} (${(skullOn / skullOff).toFixed(2)}x)`);
  return { skullOff, skullOn, boneOff, fleshOff };
}
// 9. GIB CHUNKS PICK THEIR LIGHTS (plan 1, Task 12). The actor under the z -4 tube is blown up
// (the real detonation, gibs and all); the pieces fly and settle on the hand-stepped clock, then
// the camera looks down at the pile. The gib pixels are the ones that change when the pieces are
// hidden (the same frame, setChunksVisible(false)). Then the flashlight on the same pile.
// NOT an on/off ratio band: ?lightlist=0 lights gibs by body 0's key (a global key from wherever
// body 0 stands), which leaves a pile under a lit tube near-black, so the list is MEANT to differ
// (on/off 1.6-2.9x measured; the old beam barely reaches a gib either, 2-3x in the beam).
// Judged instead: the list is no darker than the global key, the tube mean in an absolute band and
// the torch mean capped, not black, not blown, and every drawn gib mesh (per-object picks) and
// marched view is list-lit with a tube picked.
// GIB_RENDER=<mode> adds &gibrender=<mode> to the on/off boots; GIB_SWEEP=a,b,.. sweeps
// setChunkListGain in the list boot (the CHUNK_LIST_GAIN calibration). The march sub-pass (a third
// boot, ?gibrender=march&chunkbake=0, list on) always runs: the marched chunk views stay live.
const GIB_MASK = 0.03, GIB_NEAR = 4, GIB_DARK = 0.04, GIB_DARK_BARE = 0.07, GIB_BLAST_DX = Number(process.env.GIB_BLAST_DX ?? 0.6);
async function gibScene(tag) {
  await evaluate('__sdfGame.holdWindowLight(0, -1)');
  await evaluate('__sdfGame.setFlashlight(false)');
  // The z -4 tube (UNDER_B): the pieces settle in its pool. Under the z -12 tube they come to
  // rest by the stove (z -15), in the fire's light and at the tube's dim edge.
  const at = UNDER_B;
  await placeNearest(...at);
  await stepN(4);
  const a = await frameNearest(...at);
  // The blast point sits GIB_BLAST_DX on the bench side (+x) of the actor, so the pieces fly into
  // the aisle and settle on the floor in the tube's pool (straight up, half of them land on the bench
  // top at the pool's edge, and the pile then measures where it landed, not how it is lit).
  const boom = await evaluate(`__sdfGame.detonate(${a.pos[0] + GIB_BLAST_DX}, 0.7, ${a.pos[2]})`);
  // FIRST-DETONATION FRAMES (Task 12 review M6): the first gib draws compile its shader. The wall
  // time of each of the first 6 hand steps (one frame each) after the blast; the worst is reported.
  const firstMs = [];
  for (let i = 0; i < 6; i++) { const t0 = Date.now(); await stepN(1); firstMs.push(Date.now() - t0); }
  await stepN(144);
  await pinLit();
  const all = await evaluate('__sdfGame.chunkStates()');
  const near = all.filter((c) => Math.hypot(c.pos[0] - a.pos[0], c.pos[2] - a.pos[2]) < GIB_NEAR);
  if (near.length < 3) fail(`gibs (${tag}): ${near.length} pieces within ${GIB_NEAR} m of the blast (${all.length} in all): ${JSON.stringify(boom)}`);
  const c = [0, 1, 2].map((k) => near.reduce((acc, q) => acc + q.pos[k], 0) / near.length);
  const eye = (await evaluate('__sdfGame.pose()')).pos[1] + 1.62;
  const cx = c[0], cz = c[2] + 1.8;
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, 0, ${Math.atan2(c[1] - eye, 1.8)})`);
  await stepN(20);
  /** Shoot the pile, then the same frame with the pieces hidden: the gib pixels are the changed
   *  ones. Mean, near-black and blown shares over them. */
  const measure = async (name) => {
    await stepN(8, 0);
    await settle(300);
    const img = await shoot(name);
    const cl = await evaluate('__sdfGame.chunkLights()');
    const LL = await evaluate('__sdfGame.lightList()');
    await evaluate('__sdfGame.setChunksVisible(false)');
    await stepN(2, 0);
    await settle(300);
    const bare = await shoot(`${name}-hidden`);
    await evaluate('__sdfGame.setChunksVisible(true)');
    let sum = 0, n = 0, dark = 0, blown = 0;
    for (let i = 0; i < img.data.length; i += img.ch) {
      const l = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 765;
      const lb = (bare.data[i] + bare.data[i + 1] + bare.data[i + 2]) / 765;
      if (Math.abs(l - lb) < GIB_MASK) continue;
      sum += l; n++;
      // Dark: a gib pixel near-black where the bare frame is visibly lit (the gib blacked out the
      // floor it lies on), not merely a dark gib on a dark floor.
      if (l < GIB_DARK && lb >= GIB_DARK_BARE) dark++;
      if (l > 0.95) blown++;
    }
    return { img, cl, LL, n, mean: sum / Math.max(n, 1), dark: dark / Math.max(n, 1), blown: blown / Math.max(n, 1) };
  };
  let m = await measure(`gibs-${tag}`);
  // One retry when the pile is (nearly) absent from the shot: under load a capture can land on a
  // frame from before the pieces were drawn (one full run read 29 gib pixels for the march views;
  // the gibs-only run of the same tree 3.2%). A real regression stays absent on the retry.
  if (!(m.n > m.img.w * m.img.h * 0.01)) {
    console.log(`     gibs (${tag}): ${m.n} gib pixels, retrying the measure once`);
    await stepN(10);
    await settle(1500);
    m = await measure(`gibs-${tag}`);
  }
  const img = m.img, n = m.n;
  const cl = m.cl, LLg = m.LL;
  const SWEEP = process.env.GIB_SWEEP && tag === 'on' ? process.env.GIB_SWEEP.split(',').map(Number) : [];
  for (const g of SWEEP) { await evaluate(`__sdfGame.setChunkListGain(${g})`); const q = await measure(`gibs-sweep-${g}`); console.log(`SWEEP tube  gain ${g}: mean ${q.mean.toFixed(3)} dark ${(q.dark * 100).toFixed(1)}% blown ${(q.blown * 100).toFixed(1)}%`); }
  if (SWEEP.length) await evaluate('__sdfGame.setChunkListGain(NaN)');
  // The flashlight on the same pile: a light BOTH paths model (the old one by its beam cone), so
  // this is the like-for-like level check.
  await evaluate('__sdfGame.setLightClockFrozen(false)');
  await evaluate('__sdfGame.setFlashlight(true)');
  await stepN(30);
  await pinLit();
  if ((await lights()).flashlight !== 1) fail(`gibs (${tag}): torch level ${(await lights()).flashlight}`);
  const t = await measure(`gibs-torch-${tag}`);
  for (const g of SWEEP) { await evaluate(`__sdfGame.setChunkListGain(${g})`); const q = await measure(`gibs-torch-sweep-${g}`); console.log(`SWEEP torch gain ${g}: mean ${q.mean.toFixed(3)} dark ${(q.dark * 100).toFixed(1)}% blown ${(q.blown * 100).toFixed(1)}%`); }
  if (SWEEP.length) await evaluate('__sdfGame.setChunkListGain(NaN)');
  await evaluate('__sdfGame.setFlashlight(false)');
  const px = img.w * img.h;
  if (process.env.LIGHT_GATE_DEBUG) console.log('DBG gibs', tag, JSON.stringify({ boom, near: near.length, render: [...new Set(near.map((q) => q.render))], c, cl, a: a.pos, LL: LLg.map((l, i) => `${i}:${l.profile}@${l.pos.map((v) => v.toFixed(1))}r${l.rooms}`) }));
  if (!(n > px * 0.01)) fail(`gibs (${tag}): only ${n} gib pixels in frame (${near.length} pieces at ${c.map((v) => v.toFixed(2))})`);
  const tubeIdx = LLg.map((l, i) => (l.profile === 'tube' && l.rooms.includes(1) ? i : -1)).filter((i) => i >= 0);
  const picksTube = (p) => p.some((v) => v >= 0 && tubeIdx.includes(Math.floor(v + 1e-6)));
  const nearBlast = (pos) => Math.hypot(pos[0] - a.pos[0], pos[2] - a.pos[2]) < GIB_NEAR;
  const pieces = cl.pieces.filter((q) => nearBlast(q.pos));
  const views = cl.views.filter((v) => nearBlast(v.pos));
  if (tag === 'off') {
    if (cl.materials.some((q) => q.listOn !== 0) || cl.pieces.some((q) => q.listOn !== 0) || cl.views.some((v) => v.listOn !== 0)) fail(`gibs (?lightlist=0): a gib light switch is on: ${JSON.stringify(cl)}`);
  } else {
    if (pieces.length + views.length === 0) fail(`gibs (${tag}): no drawn gib mesh or view near the blast: ${JSON.stringify(cl)}`);
    if (cl.materials.some((q) => q.listOn !== 1)) fail(`gibs (${tag}): a lit gib material's list switch is off: ${JSON.stringify(cl.materials)}`);
    // Every drawn gib mesh near the blast is list-lit by its OWN record and picks a third-class tube.
    for (const q of pieces) {
      if (q.listOn !== 1) fail(`gibs (${tag}): a drawn gib mesh is not list-lit: ${JSON.stringify(q)}`);
      if (!picksTube(q.picks)) fail(`gibs (${tag}): a gib mesh does not pick a third-class tube (${tubeIdx}): ${JSON.stringify(q)}`);
    }
    for (const v of views) {
      if (v.listOn !== 1) fail(`gibs (${tag}): a live chunk view is not list-lit: ${JSON.stringify(v)}`);
      if (v.fresnel !== 0 || v.noRim !== 1) fail(`gibs (${tag}): a chunk view wears a rim (fresnel ${v.fresnel}, noRim ${v.noRim}): ${JSON.stringify(v)}`);
      if (Math.hypot(v.pos[0] - UNDER_B[0], v.pos[2] - UNDER_B[1]) < 1.5 && !picksTube(v.picks)) fail(`gibs (${tag}): a chunk view in the tube's pool does not pick a tube (${tubeIdx}): ${JSON.stringify(v)}`);
    }
    if (tag === 'march' && views.length === 0) fail(`gibs (march): no live chunk view near the blast (${cl.views.length} in all)`);
  }
  const distinct = new Set(pieces.map((q) => q.picks.map((v) => v.toFixed(3)).join(','))).size;
  return { firstMs, mean: m.mean, px: n / px, dark: m.dark, blown: m.blown, torch: t, pieces: near.length, render: [...new Set(near.map((q) => q.render))].join('+'), meshes: pieces.length, sources: [...new Set(pieces.map((q) => q.source))].join('+'), distinct, views: views.length, picks: pieces.slice(0, 4).map((q) => q.picks.map((v) => +v.toFixed(3))) };
}
const ONLY_GIBS = !!process.env.LIGHT_GATE_ONLY_GIBS;
const skullListOn = ONLY_GIBS ? null : await skullScene('on');
const gibsOn = await gibScene('on');
await listBoot('level=night-train&frozen&god&lightlist=0');
if ((await evaluate('__sdfGame.bodyPicks()')).some((p) => p.picks.some((k) => k.index >= 0))) fail('?lightlist=0 still picks');
const listOff = ONLY_GIBS ? null : await listScenes('off');
const skullListOff = ONLY_GIBS ? null : await skullScene('off');
const gibsOff = await gibScene('off');
// The march sub-pass: marched chunk views (no bake, so they stay views), list on.
await listBoot('level=night-train&frozen&god&gibrender=march&chunkbake=0');
const gibsMarch = await gibScene('march');
const gibFmt = (g) => `mean ${g.mean.toFixed(3)} (${(g.px * 100).toFixed(1)}% of frame, ${g.pieces} ${g.render} pieces) dark ${(g.dark * 100).toFixed(1)}% blown ${(g.blown * 100).toFixed(1)}%`;
const torchFmt = (g) => `mean ${g.torch.mean.toFixed(3)} dark ${(g.torch.dark * 100).toFixed(1)}% blown ${(g.torch.blown * 100).toFixed(1)}%`;
console.log(`     gibs       on  ${gibFmt(gibsOn)} | off ${gibFmt(gibsOff)}`);
console.log(`     gibs+torch on  ${torchFmt(gibsOn)} | off ${torchFmt(gibsOff)}`);
console.log(`     gibs march on  ${gibFmt(gibsMarch)} | torch ${torchFmt(gibsMarch)}`);
console.log(`     first-detonation frames (ms, 6 steps): on ${gibsOn.firstMs.join(' ')} | off ${gibsOff.firstMs.join(' ')} | march ${gibsMarch.firstMs.join(' ')}`);
// ABSOLUTE BOUNDS (Task 12 review). Tube: the baked pile's gib mean within GIB_TUBE_BAND, a band
// around the MARCHED anchor under the list (the march sub-pass below reads it every run); torch:
// at most GIB_TORCH_MAX (a pile gone flat pink-white in the beam reads above it). Numbers in the
// Task 12 dev-note.
const GIB_TUBE_BAND = [0.18, 0.40], GIB_TORCH_MAX = 0.65;
{
  const r = gibsOn.mean / gibsOff.mean, rt = gibsOn.torch.mean / gibsOff.torch.mean;
  if (!(r >= 1.0)) fail(`gibs: the list is darker than the global key under the tube: ${gibsOn.mean.toFixed(3)} < ${gibsOff.mean.toFixed(3)}`);
  if (!(gibsOn.mean >= GIB_TUBE_BAND[0] && gibsOn.mean <= GIB_TUBE_BAND[1])) fail(`gibs: tube gib mean ${gibsOn.mean.toFixed(3)} outside ${GIB_TUBE_BAND}`);
  if (!(gibsOn.torch.mean <= GIB_TORCH_MAX)) fail(`gibs: torch gib mean ${gibsOn.torch.mean.toFixed(3)} > ${GIB_TORCH_MAX}`);
  if (!(gibsOn.dark <= 0.10)) fail(`gibs: ${(gibsOn.dark * 100).toFixed(1)}% of gib pixels near-black under the tube`);
  if (!(gibsOn.blown <= 0.02)) fail(`gibs: ${(gibsOn.blown * 100).toFixed(1)}% of gib pixels blown to white under the tube`);
  // In the beam: at most 15% of gib pixels over 0.95. A face-up pile in the beam varies with where
  // it lands: 4-13% at CHUNK_LIST_GAIN 0.6 over four runs; the marched views in the same beam 15-32%.
  if (!(gibsOn.torch.blown <= 0.15)) fail(`gibs: ${(gibsOn.torch.blown * 100).toFixed(1)}% of gib pixels blown to white in the beam`);
  pass(`gibs lit by the tube: on/off gib mean tube ${r.toFixed(2)}x torch ${rt.toFixed(2)}x; tube ${gibsOn.mean.toFixed(3)} in ${GIB_TUBE_BAND}, torch ${gibsOn.torch.mean.toFixed(3)} <= ${GIB_TORCH_MAX}; ${gibsOn.meshes} gib mesh(es) (${gibsOn.sources}) each list-lit by its own picks (${gibsOn.distinct} distinct), e.g. ${JSON.stringify(gibsOn.picks)}`);
  // March: the views are gated too (not black, not blown under the tube; the beam as the bake's).
  if (!(gibsMarch.dark <= 0.10)) fail(`gibs (march): ${(gibsMarch.dark * 100).toFixed(1)}% of gib pixels near-black under the tube`);
  if (!(gibsMarch.blown <= 0.02)) fail(`gibs (march): ${(gibsMarch.blown * 100).toFixed(1)}% of gib pixels blown under the tube`);
  if (!(gibsMarch.torch.dark <= 0.10)) fail(`gibs (march): ${(gibsMarch.torch.dark * 100).toFixed(1)}% of gib pixels near-black in the beam`);
  // The marched views carry no chunk trim (the list at the march's full level, like a body), and a
  // floor pile face-up in the beam reads 28-32% over 0.95 (Task 12 review, recorded as a known
  // gap). This cap is a regression fence around that, not a look target.
  if (!(gibsMarch.torch.blown <= 0.40)) fail(`gibs (march): ${(gibsMarch.torch.blown * 100).toFixed(1)}% of gib pixels blown in the beam (> 40%)`);
  pass(`marched gib views: ${gibsMarch.views} live view(s) near the blast, list-lit, rim-free, tube picked in its pool; tube mean ${gibsMarch.mean.toFixed(3)} (baked ${gibsOn.mean.toFixed(3)}), torch ${gibsMarch.torch.mean.toFixed(3)} (baked ${gibsOn.torch.mean.toFixed(3)})`);
}
if (ONLY_GIBS) { console.log(`PASS sdf-game-light-gate gibs only (wall ${((Date.now() - T0) / 1000).toFixed(0)} s)`); process.exit(0); }
console.log(`     skull      on  crater ${skullListOn.skullOff.toFixed(3)} -> flash ${skullListOn.skullOn.toFixed(3)} | off crater ${skullListOff.skullOff.toFixed(3)} -> flash ${skullListOff.skullOn.toFixed(3)}`);
console.log(`     skull/flesh on  ${skullListOn.boneOff.toFixed(3)} / ${skullListOn.fleshOff.toFixed(3)} = ${(skullListOn.boneOff / skullListOn.fleshOff).toFixed(2)}x | off ${skullListOff.boneOff.toFixed(3)} / ${skullListOff.fleshOff.toFixed(3)} = ${(skullListOff.boneOff / skullListOff.fleshOff).toFixed(2)}x`);
for (const sc of SCENES) console.log(`     ${sc.name.padEnd(10)} on  ${fmt(listOn[sc.name])} | off ${fmt(listOff[sc.name])}`);
// Calibrated to today (Task 10): under a tube, a held bolt and the flashlight the body is neither
// darker than ?lightlist=0 (>= 0.9x) nor blown out (<= 1.2x; the first uncalibrated cut was flat white).
for (const n of ['tube', 'bolt', 'flashlight']) {
  const r = listOn[n].mean / listOff[n].mean;
  if (!(r >= 0.9)) fail(`${n}: the list is darker than ?lightlist=0: ${listOn[n].mean.toFixed(3)} < 0.9 x ${listOff[n].mean.toFixed(3)}`);
  if (!(r <= 1.2)) fail(`${n}: the list blows the body out vs ?lightlist=0: ${listOn[n].mean.toFixed(3)} > 1.2 x ${listOff[n].mean.toFixed(3)}`);
}
// Never black: the body box is at most 15% near-black under a tube, a held bolt and the flashlight.
for (const n of ['tube', 'bolt', 'flashlight']) if (!(listOn[n].dark <= 0.15)) fail(`${n}: body box ${(listOn[n].dark * 100).toFixed(1)}% near-black (> 15%)`);
// And with no picks at all (the dark coat check) the fill floor still carries the body.
if (!(listOn.dark.dark <= Math.max(0.15, listOff.dark.dark + 0.05))) fail(`dark coat check: body box ${(listOn.dark.dark * 100).toFixed(1)}% near-black (off ${(listOff.dark.dark * 100).toFixed(1)}%)`);
pass(`shared list look: on/off mean tube ${(listOn.tube.mean / listOff.tube.mean).toFixed(2)}x bolt ${(listOn.bolt.mean / listOff.bolt.mean).toFixed(2)}x flashlight ${(listOn.flashlight.mean / listOff.flashlight.mean).toFixed(2)}x; near-black tube ${(listOn.tube.dark * 100).toFixed(1)}% bolt ${(listOn.bolt.dark * 100).toFixed(1)}% flashlight ${(listOn.flashlight.dark * 100).toFixed(1)}% dark-corridor ${(listOn.dark.dark * 100).toFixed(1)}%`);

await costSection();

console.log(`PASS sdf-game-light-gate (wall ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
process.exit(0);
