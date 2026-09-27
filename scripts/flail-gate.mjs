// scripts/flail-gate.mjs — the spike flail lands one big crater, refuses out-of-reach and
// out-of-arc targets, caves a head in over three hits and takes it off on the third
// (Tasks 6 and 11 of the spike-flail plan; spec
// docs/superpowers/specs/2026-09-26-spike-flail-design.md; notes and photos in
// docs/dev-notes/2026-09-26-flail/NOTES.md).
//
// Headless gate on /sdf-game.html?seed=1&vhs=off&loader=0 (the sandbox; its arena — the
// room holding the most zombies — has 8). Zombies are frozen in place (__sdfGame.freeze),
// hit-stop is off (frame counts stay deterministic), and swings are driven with
// __sdfGame.flail.click(). Every check uses a FRESH zombie, and stands the player on the
// arena-centre side of it.
//
// Asserts:
//   1. front hit: 1.5 m from the torso centre (horizontal, eye → centre — the strike's own
//      measure), facing it: one click + 30 frames adds EXACTLY one wound, radius within
//      0.005 of 0.14, and state().lastStrike.hits holds the zombie;
//   2. too far: at 2.2 m (reach is 1.8), a click adds no wound to that zombie;
//   3. too wide: at 1.2 m but turned 70° away (the arc is ±50°), a click adds no wound;
//      POSITIVE CONTROL on every click: strikes went up by exactly 1 and lastStrike.side is
//      the side state().nextSide promised — a dropped click cannot pass a refusal check;
//   4. GRADUAL head damage (spec §10.5): a fresh zombie, 1.4 m from the neck, the view
//      aimed so the strike's eye → impact ray (viewToWorld(eye, yaw, pitch,
//      FLAIL_IMPACT[side]), imported from the game's own modules in the page) passes
//      through the neck — re-aimed before every click, for that click's side. Exactly 3
//      clicks: after hits 1 and 2 the head is still ON (limbAlive(id, 'head') > 0, read off
//      the actor's CURRENT body — see game-seams-flail.ts), each added one wound of radius
//      0.09 ± 0.005 within 0.25 m of the head cluster's centre, and lastStrike.headHits
//      counts 1, 2; after hit 3 the head is OFF (limbAlive === 0). Each click's REAL strike
//      ray (lastStrike.eye → lastStrike.impact) passes within 5 cm of the neck. Photos
//      head-hit-1/2/3.png, the view turned onto the head;
//   5. strike-frame ball: on EVERY click's strike frame the drawn (simulated) ball sits
//      within 2 cm of FLAIL_IMPACT (lastStrike.ballErr, set by that frame's draw);
//   5b. the same at 144 Hz: an R and an L swing stepped at 1/144 s, then again at
//      1/144 s ±15% (seeded jitter) — the chain carries sub-frame time at these rates
//      (the review's C1: the pin landed 0.8–1.9 cm short here) — ball within 1 mm, one strike each;
//   6. zero console errors or exceptions.
// Measures (printed, not asserted): the rest pose's ball/bolt/grip screen NDC, the share of
// clipped pixels on the ball and haft at rest, the ball ↔ eye-bolt distance through a
// swing, the red-minus-green rise in a 40x40 crop on the front-hit crater (saturated on
// torch-lit skin), and the CRATER CONTRAST: mean luma in a ring just outside the crater
// (1.2–1.6 r) minus mean luma inside it (0–0.6 r), after the hit vs the same regions
// before it — a crater reads by its dark interior.
//
// Usage (vite + a WebGPU Chrome already listening — from BASH, e.g.
//   . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up):
//   node scripts/flail-gate.mjs <vitePort> <cdpPort>
// Env: OUT (docs/dev-notes/2026-09-26-flail/gate), ROOM (most zombies), W/H (1280x800).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5233);
const CDP = Number(process.argv[3] ?? 9223);
const OUT = process.env.OUT ?? 'docs/dev-notes/2026-09-26-flail/gate';
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const CRATER_R = 0.14;      // FLAIL_FEEL.craterR (game-flail.ts)
const FACE_R = 0.09;        // FLAIL_HEAD.faceCraterR (flail-strike.ts): head hits 1–2
const HEAD_NEAR = 0.25;     // FLAIL_HEAD.regionDist: "on or near the head"
const BALL_ERR_MAX = 0.02;  // the drawn ball on the strike frame vs FLAIL_IMPACT
// At 144 Hz the pin must be EXACT: the pre-fix pin (review C1) landed 0.8–1.9 cm short in
// this gate — inside the 2 cm above, so that bound could not catch it.
const BALL_ERR_144_MAX = 0.001;
const SWING_FRAMES = 30;    // 0.5 s at 60 Hz: past swingSec 0.45, back to idle

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS: ${msg}`);
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

// ---- CDP ------------------------------------------------------------------------
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
});
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
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
const evaluate = async (expression, ms = 90000) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), ms,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
mkdirSync(OUT, { recursive: true });

// ---- PNG decode (screenshots are the only pixels a WebGPU canvas gives up) --------
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
const px = (img, x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Mean red minus mean green in a size x size crop centred on (cx, cy). */
function redMinusGreen(img, cx, cy, size = 40) {
  let n = 0, r = 0, g = 0;
  const x0 = Math.max(0, Math.round(cx - size / 2)), y0 = Math.max(0, Math.round(cy - size / 2));
  const x1 = Math.min(img.w, x0 + size), y1 = Math.min(img.h, y0 + size);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = px(img, x, y); r += c[0]; g += c[1]; n++; }
  return n ? (r - g) / n : 0;
}

/** Mean luma over an annulus rIn..rOut (px) about (cx, cy). */
function annulusLuma(img, cx, cy, rIn, rOut) {
  let n = 0, l = 0;
  for (let y = Math.floor(cy - rOut); y <= Math.ceil(cy + rOut); y++) for (let x = Math.floor(cx - rOut); x <= Math.ceil(cx + rOut); x++) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < rIn || d > rOut) continue;
    l += luma(px(img, x, y)); n++;
  }
  return n ? l / n : 0;
}

// The canvas is letterboxed inside the viewport (4:3 in a 16:10 window): screen NDC maps
// onto ITS rect, not the window's.
let rect = null;
/** Screen NDC (through the fisheye — state().ndc and flail.toScreen already are) → px. */
const ndcPx = (n) => [rect.x + (n[0] + 1) * 0.5 * rect.w, rect.y + (1 - n[1]) * 0.5 * rect.h];
/** Clipped share + mean luma over the ball's projected disc (0.8 r, to skip its rim). */
function ballStats(img, st) {
  const [cx, cy] = ndcPx(st.ndc.ball); const r = 0.8 * st.ndc.ballR * 0.5 * rect.w;
  let n = 0, clip = 0, lum = 0;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h || Math.hypot(x - cx, y - cy) > r) continue;
    const c = px(img, x, y); n++; if (Math.max(...c) >= 245) clip++; lum += luma(c);
  }
  return { n, clipped: n ? +(clip / n).toFixed(3) : null, meanLuma: n ? +(lum / n).toFixed(1) : null };
}
/** The haft, bolt → grip on screen: at each step the brightest pixel within ±4 px across
 *  the line (the haft is a few px wide); the share of those that clip. */
function haftStats(img, st) {
  const a = ndcPx(st.ndc.bolt), b = ndcPx(st.ndc.grip);
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  let n = 0, clip = 0, lum = 0;
  for (let i = 2; i < 60; i++) {
    const cx = a[0] + dx * i / 60, cy = a[1] + dy * i / 60;
    let best = null;
    for (let k = -4; k <= 4; k++) {
      const x = Math.round(cx + nx * k), y = Math.round(cy + ny * k);
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const c = px(img, x, y); if (!best || luma(c) > luma(best)) best = c;
    }
    if (!best) continue;
    n++; lum += luma(best); if (Math.max(...best) >= 245) clip++;
  }
  return { n, clipped: n ? +(clip / n).toFixed(3) : null, meanLuma: n ? +(lum / n).toFixed(1) : null };
}

/** Screenshots lag hand-stepped frames by one: lock the sim, re-render twice, then shoot. */
async function capture(name) {
  await evaluate('__sdfGame.setRenderLock(true)');
  await evaluate('__sdfGame.step(1, 1 / 60)');
  await evaluate('__sdfGame.step(1, 1 / 60)');
  const s = await send('Page.captureScreenshot', { format: 'png' });
  await evaluate('__sdfGame.setRenderLock(false)');
  const buf = Buffer.from(s.result.data, 'base64');
  if (name) { writeFileSync(`${OUT}/${name}.png`, buf); console.log(`  shot ${OUT}/${name}.png`); }
  return decodePng(buf);
}

// ---- Boot -----------------------------------------------------------------------
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off&loader=0` });

let backend = null;
for (let i = 0; i < 240 && !backend; i++) {
  await sleep(500);
  try { backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null'); } catch { backend = null; }
}
if (backend !== 'webgpu') die(`backend ${backend}, expected webgpu`);
for (let i = 0; i < 480; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') !== 'ready') die('warm gate never reached ready');
await evaluate('__sdfGame.setLoopRunning(false)');
// The photos are for the owner: hide the tuning panels and the recorder (DOM only).
await evaluate(`(() => { for (const e of document.body.children) {
  if (/TUNING|DYNAMITE \\/ GIB|BLOOD \\+ GIB BLUR|Record \\[F8\\]/.test(e.innerText || '')) e.style.display = 'none'; } return 1; })()`);
rect = await evaluate(`(() => { const r = document.querySelector('#app canvas, canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
await evaluate('__sdfGame.freeze(true)');
const sel = await evaluate(`__sdfGame.selectSlot('flail')`);
if (!sel?.ok) die(`selectSlot('flail') refused: ${JSON.stringify(sel)}`);
// ONE frame per call at first: the first frames compile pipelines, and step(n) timed out there.
for (let i = 0; i < 90; i++) await evaluate('__sdfGame.step(1, 1 / 60)');
await evaluate('__sdfGame.flail.setHitStop(false)');
const st0 = await evaluate('__sdfGame.flail.state()');
if (!st0 || st0.phase !== 'idle') die(`flail not idle after the raise: ${JSON.stringify(st0)}`);
if ((await evaluate('__sdfGame.dynamite()'))?.live !== 'flail') die('the live slot is not the flail');
// The FIRST render-locked capture of a session has come back with neither the level nor
// the flail drawn (seen twice: a dark frame, the zombie alone). Throw two away first, so
// the rest photo — and the crater's BEFORE crop — are real frames.
await capture(null); await capture(null);
console.log(`flail ready; canvas ${JSON.stringify(rect)}`);

// ---- The arena --------------------------------------------------------------------
const f2 = (v) => v.map((c) => c.toFixed(2)).join(', ');
const zombies = (await evaluate('__sdfGame.actorList()')).filter((a) => a.kind === 'zombie');
const byRoom = new Map();
for (const z of zombies) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
const ROOM = process.env.ROOM ? Number(process.env.ROOM)
  : [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
const pool = byRoom.get(ROOM) ?? [];
if (pool.length < 5) die(`room ${ROOM} has ${pool.length} zombies; the gate needs 5`);
const room = (await evaluate('__sdfGame.rooms')).find((r) => r.id === ROOM);
const centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
console.log(`room ${ROOM} (${room.name}): ${pool.length} zombies; centre (${f2(centre)})`);

const state = () => evaluate('__sdfGame.flail.state()');
const stepOne = () => evaluate('__sdfGame.step(1, 1 / 60)');
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const EYE_H = 1.62;   // game-player.ts PLAYER.eye (the strike's eye is eyeOf(player))
const torso = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, 'torso')`);
const wounds = (id) => evaluate(`__sdfGame.actorWounds(${id})`);
/** The yaw whose forward is (dx, dz) — the game's forward is (sin yaw, −cos yaw) (flail-strike viewToWorld). */
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
/** Stand with the EYE `dist` m (horizontal) from `target`, on the arena-centre side, facing it. */
function standOff(target, dist) {
  const ax = centre[0] - target[0], az = centre[2] - target[2], l = Math.hypot(ax, az) || 1;
  const x = target[0] + (ax / l) * dist, z = target[2] + (az / l) * dist;
  return { x, z, yaw: yawOf(target[0] - x, target[2] - z) };
}
async function place(p, pitch = 0) {
  await evaluate(`__sdfGame.placePlayer({ x: ${p.x}, z: ${p.z}, yaw: ${p.yaw}, pitch: ${pitch} })`);
  await stepOne();
}
/** One click, then `frames` frames one at a time; `onFrame(i, st)` may return a shot name.
 *  Every click is its own positive control: it must strike exactly once, on the side
 *  state().nextSide promised before it (a dropped click fails here, not silently). */
let controlFails = 0;
/** Every click's strike-frame drawn-ball error (lastStrike.ballErr), metres. */
const ballErrs = [];
async function swing(frames = SWING_FRAMES, onFrame) {
  const pre = await state();
  await evaluate('__sdfGame.flail.click()');
  const samples = [];
  for (let i = 1; i <= frames; i++) {
    await stepOne();
    const st = await state();
    samples.push({ i, phase: st.phase, side: st.side, strikes: st.strikes, keyed: st.ballBolt.keyed, drawn: st.ballBolt.drawn, ball: st.ndc.ball, grip: st.ndc.grip });
    const name = onFrame?.(i, st);
    if (name) await capture(name);
  }
  const post = await state();
  const control = post.strikes === pre.strikes + 1 && post.lastStrike?.side === pre.nextSide;
  if (!control) {
    controlFails++;
    console.error(`  control: strikes ${pre.strikes} → ${post.strikes}, side ${post.lastStrike?.side} (expected ${pre.nextSide})`);
  }
  samples.control = control;
  samples.side = pre.nextSide;
  if (control) ballErrs.push(post.lastStrike.ballErr ?? Infinity);
  return samples;
}
const toPx = async (w) => { const n = await evaluate(`__sdfGame.flail.toScreen(${w[0]}, ${w[1]}, ${w[2]})`); return n ? ndcPx(n) : null; };
const used = new Set();
/** The next fresh zombie — one no earlier check has touched. */
function fresh() { const z = pool.find((q) => !used.has(q.id)); if (!z) die('ran out of fresh zombies'); used.add(z.id); return z; }

// ---- 1. Front hit (and the rest / R-swing photos) ------------------------------------
{
  const z = fresh();
  const t = await torso(z.id);
  const pose = standOff(t, 1.5);
  await place(pose);
  await stepN(30);
  const rest = await state();
  const img0 = await capture('rest');
  console.log(`rest: ball NDC (${f2(rest.ndc.ball)}), bolt (${f2(rest.ndc.bolt)}), grip (${f2(rest.ndc.grip)}), ball r ${rest.ndc.ballR.toFixed(3)}; ` +
    `ball↔bolt ${rest.ballBolt.keyed.toFixed(3)} m`);
  console.log(`rest clipping: ball ${JSON.stringify(ballStats(img0, rest))}; haft ${JSON.stringify(haftStats(img0, rest))}`);
  const before = await wounds(z.id);
  const samples = await swing(SWING_FRAMES, (i) => (i === 9 ? 'swing-R-mid' : i === 11 ? 'swing-R-strike' : null));
  const st = await state();
  const after = await wounds(z.id);
  const added = after.slice(before.length);
  const worst = Math.max(...samples.map((s) => s.keyed));
  const clamped = samples.filter((s) => s.keyed - s.drawn > 0.005).length;
  console.log(`front hit: zombie ${z.id} +${added.length} wounds (radii ${added.map((w) => w.radius.toFixed(3)).join(' ')}); ` +
    `lastStrike ${JSON.stringify(st.lastStrike)}; swing ball↔bolt worst ${worst.toFixed(3)} m, clamped on ${clamped}/${samples.length} frames`);
  for (const s of samples.filter((q) => q.i >= 6 && q.i <= 13)) {
    console.log(`  f${s.i} ${s.phase}/${s.side} ball (${f2(s.ball)}) grip (${f2(s.grip)}) keyed ${s.keyed.toFixed(2)} drawn ${s.drawn.toFixed(2)}`);
  }
  await stepN(20);
  await place(pose);
  const img1 = await capture('hit-wound');
  let rg = null;
  if (added.length) {
    const p = await toPx(added[0].pos);
    if (p) {
      const r0 = redMinusGreen(img0, p[0], p[1]), r1 = redMinusGreen(img1, p[0], p[1]);
      rg = r1 - r0;
      console.log(`  R-G in the 40x40 crop: ${r0.toFixed(1)} before → ${r1.toFixed(1)} after`);
      // The crater's on-screen radius: its world radius along the camera's right.
      const w = added[0].pos, right = [Math.cos(pose.yaw), 0, Math.sin(pose.yaw)];
      const q = await toPx([w[0] + right[0] * CRATER_R, w[1], w[2] + right[2] * CRATER_R]);
      if (q) {
        const rPx = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const disc = (img) => annulusLuma(img, p[0], p[1], 0, 0.6 * rPx);
        const contrast = (img) => annulusLuma(img, p[0], p[1], 1.2 * rPx, 1.6 * rPx) - disc(img);
        const c0 = contrast(img0), c1 = contrast(img1);
        console.log(`  crater contrast (ring 1.2–1.6 r minus disc 0–0.6 r, r ${rPx.toFixed(0)} px): ` +
          `${c0.toFixed(1)} before → ${c1.toFixed(1)} after (rise ${(c1 - c0).toFixed(1)}); ` +
          `disc luma ${disc(img0).toFixed(1)} → ${disc(img1).toFixed(1)}`);
      }
    }
    console.log(`  crater at px (${p ? p.map((v) => v.toFixed(0)).join(', ') : 'off-screen'}): R-G rise ${rg === null ? 'n/a' : rg.toFixed(1)}`);
  }
  const ok = samples.control && added.length === 1 && Math.abs(added[0].radius - CRATER_R) <= 0.005 && st.lastStrike?.hits?.includes(z.id);
  if (ok) pass(`front hit at 1.5 m: exactly one wound, radius ${added[0].radius.toFixed(3)}, lastStrike holds ${z.id}`);
  else fail(`front hit at 1.5 m: +${added.length} wounds (radii ${added.map((w) => w.radius.toFixed(3)).join(' ')}), lastStrike ${JSON.stringify(st.lastStrike)}`);
}

// ---- 2. Too far (and the L-swing photo) ------------------------------------------------
{
  const z = fresh();
  const t = await torso(z.id);
  await place(standOff(t, 2.2));
  await stepN(10);
  const before = (await wounds(z.id)).length;
  const sw = await swing(SWING_FRAMES, (i) => (i === 9 ? 'swing-L-mid' : null));
  const st = await state();
  const added = (await wounds(z.id)).length - before;
  console.log(`too far: zombie ${z.id} at 2.2 m, side ${st.lastStrike?.side} (expected ${sw.side}), strike fired ${sw.control}: +${added} wounds; hits ${JSON.stringify(st.lastStrike?.hits)}`);
  if (sw.control && added === 0 && !st.lastStrike.hits.includes(z.id)) pass(`too far (2.2 m): the ${sw.side} strike fired and missed`);
  else fail(`too far (2.2 m): control ${sw.control}, +${added} wounds`);
}

// ---- 3. Too wide -----------------------------------------------------------------------
{
  const z = fresh();
  const t = await torso(z.id);
  const pose = standOff(t, 1.2);
  await place({ ...pose, yaw: pose.yaw + (70 * Math.PI) / 180 });
  await stepN(10);
  const before = (await wounds(z.id)).length;
  const sw = await swing();
  const st = await state();
  const added = (await wounds(z.id)).length - before;
  console.log(`too wide: zombie ${z.id} at 1.2 m, turned 70°, side ${st.lastStrike?.side} (expected ${sw.side}), strike fired ${sw.control}: +${added} wounds; hits ${JSON.stringify(st.lastStrike?.hits)}`);
  if (sw.control && added === 0 && !st.lastStrike.hits.includes(z.id)) pass(`too wide (70° off at 1.2 m): the ${sw.side} strike fired and missed`);
  else fail(`too wide (70° off): control ${sw.control}, +${added} wounds`);
}

// ---- 4. Gradual head damage -------------------------------------------------------------
{
  const z = fresh();
  await evaluate(`import('/src/lab/sdf-zombie/webgpu/flail-swing.ts').then((m) => { window.__flailSwing = m; return 1; })`);
  await evaluate(`import('/src/lab/sdf-zombie/webgpu/flail-strike.ts').then((m) => { window.__flailStrike = m; return 1; })`);
  /** The neck: the head chain's first capsule (its root sits in the shoulders), its midpoint. */
  const neckOf = (id) => evaluate(`(() => {
    const p = __sdfGame.zombie(${id}).posed();
    const head = p.prims.filter(q => q.limb === 'head' && q.op !== 'sub' && !q.dead);
    if (!head.length) return null;
    const n = head[0];
    return [(n.a[0] + n.b[0]) / 2, (n.a[1] + n.b[1]) / 2, (n.a[2] + n.b[2]) / 2];
  })()`);
  /** Solve yaw and pitch so the strike's eye → impact ray for `side` passes through `n`. */
  const aim = (eye, n, side) => evaluate(`(() => {
    const imp = __flailSwing.FLAIL_IMPACT['${side}'], eye = ${JSON.stringify(eye)}, n = ${JSON.stringify(n)};
    const az = (v) => Math.atan2(v[0], -v[2]), el = (v) => Math.atan2(v[1], Math.hypot(v[0], v[2]));
    const want = [n[0] - eye[0], n[1] - eye[1], n[2] - eye[2]];
    let yaw = az(want), pitch = 0;
    for (let i = 0; i < 20; i++) {
      const w = __flailStrike.viewToWorld(eye, yaw, pitch, imp);
      const d = [w[0] - eye[0], w[1] - eye[1], w[2] - eye[2]];
      let dy = az(want) - az(d); dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw += dy; pitch += el(want) - el(d);
    }
    const w = __flailStrike.viewToWorld(eye, yaw, pitch, imp);
    const d = [w[0] - eye[0], w[1] - eye[1], w[2] - eye[2]], l = Math.hypot(...d);
    const tt = (want[0] * d[0] + want[1] * d[1] + want[2] * d[2]) / l;   // along the ray to the neck's foot
    const miss = Math.hypot(...want.map((c, k) => c - d[k] / l * tt));
    return { yaw, pitch, miss };
  })()`);
  /** Stand at `pose`, turn the view straight onto `p` (the strike aim looks off to one side), shoot. */
  async function photoOf(pose, p, name) {
    const e = [pose.x, EYE_H, pose.z];
    await place({ ...pose, yaw: yawOf(p[0] - e[0], p[2] - e[2]) }, Math.atan2(p[1] - EYE_H, Math.hypot(p[0] - e[0], p[2] - e[2])));
    await capture(name);
  }
  const alive0 = await evaluate(`__sdfGame.flail.limbAlive(${z.id}, 'head')`);
  let alive = alive0, worstRay = 0, lastPose = null, lastHead = null;
  const rows = [];
  for (let hit = 1; hit <= 3; hit++) {
    const n = await neckOf(z.id);
    if (!n) { fail(`head hit ${hit}: no live head prims to aim at`); break; }
    const head = await evaluate(`__sdfGame.actorLimbCenter(${z.id}, 'head')`);
    const t = await torso(z.id);
    const base = standOff([n[0], t[1], n[2]], 1.4);
    const side = (await state()).nextSide;   // the next click's side
    const eye = [base.x, EYE_H, base.z];
    const a = await aim(eye, n, side);
    lastPose = { x: base.x, z: base.z, yaw: a.yaw }; lastHead = head ?? n;
    await place(lastPose, a.pitch);
    await stepN(5);
    const before = (await wounds(z.id)).length;
    const sw = await swing();
    const st = await state();
    // The REAL strike ray (what the game cast), its distance to the neck.
    const e = st.lastStrike.eye, im = st.lastStrike.impact;
    const d = [im[0] - e[0], im[1] - e[1], im[2] - e[2]], dl = Math.hypot(...d);
    const v = [n[0] - e[0], n[1] - e[1], n[2] - e[2]], along = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dl;
    const rayMiss = Math.hypot(...v.map((c, k) => c - (d[k] / dl) * along));
    worstRay = Math.max(worstRay, rayMiss);
    if (!sw.control) fail(`head hit ${hit}: the strike did not fire as expected`);
    const w = (await wounds(z.id)).slice(before);
    alive = await evaluate(`__sdfGame.flail.limbAlive(${z.id}, 'head')`);
    const counted = st.lastStrike.headHits?.[z.id] ?? null;
    const near = head ? w.map((q) => Math.hypot(q.pos[0] - head[0], q.pos[1] - head[1], q.pos[2] - head[2])) : [];
    rows.push({ hit, alive, added: w, near, counted });
    console.log(`head hit ${hit} (${st.lastStrike?.side}): neck y ${n[1].toFixed(2)}, pitch ${a.pitch.toFixed(3)} (solved miss ${a.miss.toExponential(1)} m, ` +
      `real strike ray ${(rayMiss * 100).toFixed(2)} cm from the neck); ` +
      `+${w.length} wounds (y@radius/type ${w.map((q) => `${q.pos[1].toFixed(2)}@${q.radius.toFixed(3)}/${q.type}`).join(' ')}; ` +
      `from the head centre ${near.map((x) => x.toFixed(3)).join(' ')} m); headHits ${counted}; head prims ${alive}/${alive0}`);
    if (hit < 3) {
      const ok = alive > 0 && w.length === 1 && Math.abs(w[0].radius - FACE_R) <= 0.005 && near[0] <= HEAD_NEAR && counted === hit;
      if (ok) pass(`head hit ${hit}: the head is still on (${alive}/${alive0} prims), one ${w[0].radius.toFixed(3)} crater ${near[0].toFixed(3)} m from the head centre, headHits ${counted}`);
      else fail(`head hit ${hit}: alive ${alive}/${alive0}, +${w.length} wounds (radii ${w.map((q) => q.radius.toFixed(3)).join(' ')}; ${near.map((x) => x.toFixed(3)).join(' ')} m from the head), headHits ${counted}`);
      await photoOf(lastPose, lastHead, `head-hit-${hit}`);
    }
  }
  const last = rows[2];
  if (last && last.alive === 0) pass(`head hit 3: the head came off (headHits ${last.counted})`);
  else fail(`head hit 3: ${last ? `${last.alive}/${alive0}` : '?'} head prims alive after 3 clicks`);
  // A FROZEN actor does not step, so it is not re-posed after the sever: its drawn
  // body still carries the head until something re-poses it (in play it steps every
  // frame). Thaw the crowd for a few frames so the photo shows the body the game now
  // holds, then freeze again and let the severed head fall clear (1 s).
  await evaluate('__sdfGame.freeze(false)');
  await stepN(3);
  await evaluate('__sdfGame.freeze(true)');
  await stepN(60);
  if (lastPose && lastHead) await photoOf(lastPose, lastHead, 'head-hit-3');
  if (worstRay < 0.05) pass(`head hits: every strike ray passed within 5 cm of the neck (worst ${(worstRay * 100).toFixed(2)} cm)`);
  else fail(`head hits: a strike ray missed the neck by ${(worstRay * 100).toFixed(1)} cm`);
}

// ---- 5b. The strike-frame ball at 144 Hz, steady and jittered ------------------------------
{
  let seed = 1;
  const jitter = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (1 + 0.15 * (2 * (seed / 2147483648) - 1)) / 144; };
  const errs = [];
  for (const [label, dt] of [['144 Hz', () => 1 / 144], ['144 Hz ±15%', jitter]]) {
    for (let k = 0; k < 2; k++) {
      const pre = await state();
      await evaluate('__sdfGame.flail.click()');
      for (let i = 0; i < 90; i++) await evaluate(`__sdfGame.step(1, ${dt()})`);   // ~0.62 s: back to idle
      const post = await state();
      const ok = post.strikes === pre.strikes + 1 && post.lastStrike?.side === pre.nextSide && post.phase === 'idle';
      const e = post.lastStrike?.ballErr ?? Infinity;
      console.log(`${label} ${pre.nextSide}: strike ${ok ? 'fired once' : 'MISSING/EXTRA'}, strike-frame ball error ${(e * 100).toFixed(6)} cm`);
      if (!ok) fail(`${label} ${pre.nextSide}: the click did not strike exactly once and return to idle`);
      errs.push(e);
    }
  }
  const worst = Math.max(...errs);
  if (worst <= BALL_ERR_144_MAX) pass(`144 Hz (steady + jittered): the drawn ball within ${(worst * 100).toFixed(6)} cm of the impact on all ${errs.length} strike frames (≤ 1 mm)`);
  else fail(`144 Hz: worst strike-frame ball error ${(worst * 100).toFixed(2)} cm`);
  await stepN(10);
}

// ---- 5. The drawn ball on the strike frame -------------------------------------------------
{
  const worst = ballErrs.length ? Math.max(...ballErrs) : Infinity;
  console.log(`strike-frame ball error per click (cm): ${ballErrs.map((e) => (e * 100).toFixed(3)).join(' ')}`);
  if (ballErrs.length >= 6 && worst <= BALL_ERR_MAX) pass(`strike frame: the drawn ball within ${(worst * 100).toFixed(3)} cm of the impact on all ${ballErrs.length} clicks (≤ 2 cm)`);
  else fail(`strike frame: worst drawn-ball error ${(worst * 100).toFixed(2)} cm over ${ballErrs.length} clicks`);
}

if (controlFails === 0) pass('positive control: every click struck exactly once, on the side nextSide promised');
else fail(`positive control: ${controlFails} click(s) did not strike as expected`);

// ---- 6. Console ------------------------------------------------------------------------
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception' || e.type === 'assert');
if (errs.length === 0) pass('zero console errors or exceptions');
else fail(`console errors: ${JSON.stringify(errs).slice(0, 2000)}`);
const warns = consoleEvents.filter((e) => e.type === 'warning' && /flail/i.test(e.text));
if (warns.length) console.log(`flail warnings: ${JSON.stringify(warns).slice(0, 1000)}`);

console.log(failures === 0 ? 'GATE PASSED' : `GATE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
