// scripts/flail-gate.mjs — the spike flail lands one big crater, refuses out-of-reach and
// out-of-arc targets, chains R → L → H on quick clicks, sweeps H wide enough to catch two
// zombies flanking the crosshair, wears a head's flesh away over crosshair-aimed hits until the
// brain kills (head damage v2) without ever taking it off, and needs at least seven body
// hits to drop a zombie (Tasks 6, 11, 12 and 18–21 of the spike-flail plan; spec docs/superpowers/specs/2026-09-26-spike-flail-design.md
// §12; notes and photos in docs/dev-notes/2026-09-26-flail/NOTES.md).
//
// Headless gate on /sdf-game.html?seed=1&vhs=off&loader=0 (the sandbox; its arena — the
// room holding the most zombies — has 8). Zombies are frozen in place (__sdfGame.freeze),
// hit-stop is off (frame counts stay deterministic), and swings are driven with
// __sdfGame.flail.click(). Every check uses a FRESH zombie, and stands the player on the
// arena-centre side of it.
//
// Asserts:
//   1. front hit: 1.5 m from the torso centre (horizontal, eye → centre — the strike's own
//      measure), the crosshair on it (the strike lands on the crosshair, so a level view
//      would hit the head): one click + 30 frames adds EXACTLY one wound, radius within
//      0.005 of 0.09, and state().lastStrike.hits holds the zombie;
//   2. too far: at 2.2 m (reach is 1.8), a click adds no wound to that zombie;
//   3. too wide: at 1.2 m but turned 80° away (outside H's ±70° arc as well as R/L's ±50°),
//      a click adds no wound;
//      POSITIVE CONTROL on every click: strikes went up by exactly 1 and lastStrike.side is
//      the side state().nextSide promised — a dropped click cannot pass a refusal check;
//   4. the combo: after a pause (> comboWindowSec), three chained clicks strike R, then L,
//      then H, in order (each swing() call's own positive control proves the side); after
//      another pause, state().nextSide is back to R;
//   5. sweep width: two fresh zombies flanking the facing at 55–65° and 1.0–1.6 m (the
//      sweepStands helper below); R and L from that stand hit neither (bearings ≥ 55° sit
//      outside their ±50° arc), H hits both;
//   6. CROSSHAIR-aimed head hits, never decapitating (spec §12.3), the head damage v2 contract
//      (docs/superpowers/specs/2026-09-28-melee-head-damage-design.md §15): a fresh zombie; before
//      EVERY click the crosshair is put on actorLimbCenter(id, 'head') from 0.9 m
//      (standOff(head, 0.9), pitch atan2(head.y − EYE_H, 0.9)) — exactly as a player aims,
//      not the old strike-ray solver (the stand is on the arena-centre side, so the blow lands
//      wherever the zombie's facing puts it — face, side or back of the head). Clicks run through
//      the combo (H included) until the head damage model kills (head.state(id).dead) or
//      HEAD_HITS_MAX clicks. EVERY hit: the head stays ON (limbAlive(id, 'head') > 0),
//      lastStrike.headHits counts 1, 2, …, and the hit STRIPS FLESH — the model's total flesh
//      (head.state(id).flesh, six regions) goes down, and a head-region wound (Wound.headRegion)
//      appears or grows, on a head prim within ON_HEAD of the head centre. The kill (the brain)
//      comes from head hits alone within KILL_MIN–KILL_MAX hits; one thawed-frames readback after
//      it shows the phase out of 'standing'. The damage model's own look and numbers are
//      scripts/head-damage-gate.mjs's. Photos head-hit-1.png and head-hit-kill.png (head-hit-last.png
//      when no kill came);
//   7. hits to collapse: a fresh zombie; before every click the crosshair is put on its
//      CURRENT torso centre from 1.2 m. Click until collapse.ts's phase leaves 'standing' or
//      12 clicks. The collapse must come on hit ≥ COLLAPSE_MIN (7: meterThreshold 0.8, 0.10
//      credit/R-or-L hit, 0.14/H hit), and hit 1's wound radius is CRATER_R (0.09) ± 0.005;
//   8. crosshair accuracy: every head- and collapse-section hit's STRIKE-TIME hit point
//      (lastStrike.points[id], resolveStrike's own snapped surface point) lands within
//      AIM_MAX (5 cm) of the strike ray (lastStrike.eye → lastStrike.impact, the crosshair's
//      own ray, spec §12.4) — the worst distance is printed. The wound's LATER position (as
//      read back via actorWounds, after its local-frame round trip and any reaction settling)
//      is logged too, but not asserted: a first hit on a fresh head can reconstruct several cm
//      off this point without the strike itself having missed by that much (investigated
//      2026-09-28 — the struck prim's own centre never moves, confirmed frame-by-frame);

//   9. strike-frame ball: on EVERY click's strike frame the drawn (simulated) ball sits
//      within 2 cm of FLAIL_IMPACT (lastStrike.ballErr, set by that frame's draw);
//   9b. the same at 144 Hz: R, L and H swings stepped at 1/144 s, then again at 1/144 s ±15%
//      (seeded jitter) — the chain carries sub-frame time at these rates (the review's C1:
//      the pin landed 0.8–1.9 cm short here) — ball within 1 mm, one strike each;
//   10. zero console errors or exceptions.
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
const CRATER_R = 0.09;      // FLAIL_FEEL.craterR (game-flail.ts)
// Head damage v2 (game-head-damage.ts; spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md
// §15): every head hit strips flesh region by region; the brain comes out and kills at 5–7 hits in the
// model's own tests, 5–9 in play (the head-damage gate's bound: jitter, where the blows land). All head
// craters have severRadius 0 — the flail never decapitates (flail spec §12.3).
const KILL_MIN = 5, KILL_MAX = 9;
const HEAD_HITS_MAX = 10;   // crosshair-aimed clicks the gate allows before calling the kill missing
// A region crater sits at its region's surface point — the crown's ~0.2 m from actorLimbCenter('head')
// (the head cluster's centre) — so a head-region wound must sit on a `head` prim within this of it.
const ON_HEAD = 0.26;
const COLLAPSE_MIN = 7;     // meterThreshold 0.8; 0.10 credit/R-or-L hit, 0.14/H hit (spec §12.2)
const AIM_MAX = 0.05;       // every head/collapse crater must land within this of the crosshair's
                             // own ray (lastStrike.eye → lastStrike.impact, spec §12.4)
const TOO_WIDE_DEG = 80;    // outside H's ±70° arc as well as R/L's ±50°
const BALL_ERR_MAX = 0.02;  // the drawn ball on the strike frame vs FLAIL_IMPACT
// At 144 Hz the pin must be EXACT: the pre-fix pin (review C1) landed 0.8–1.9 cm short in
// this gate — inside the 2 cm above, so that bound could not catch it.
const BALL_ERR_144_MAX = 0.001;
const SWING_FRAMES = 36;    // 0.6 s at 60 Hz: past H's 0.55 s, back to idle

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
if (pool.length < 8) die(`room ${ROOM} has ${pool.length} zombies; the gate needs 8`);
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
/** Every head/collapse hit's strike-time hit point (lastStrike.points[id]) distance to the
 *  strike ray (eye → impact), metres — see the "ASSERTED" comments in the head/collapse
 *  sections for why this, not the wound's later readback, is what the spec means. */
const aimErrs = [];
/** Perpendicular distance from world point `p` to the ray from `eye` through `impact`. */
function distToRay(eye, impact, p) {
  const d = [impact[0] - eye[0], impact[1] - eye[1], impact[2] - eye[2]];
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const u = [d[0] / dl, d[1] / dl, d[2] / dl];
  const v = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const t = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  const proj = [eye[0] + u[0] * t, eye[1] + u[1] * t, eye[2] + u[2] * t];
  return Math.hypot(p[0] - proj[0], p[1] - proj[1], p[2] - proj[2]);
}
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

// ---- Reserve the sweep-width pair up front, before other sections' fresh() calls can
// claim the only zombies close enough together to fit (the arena spaces its pool wide;
// two zombies within 2.9 m of each other — the most a 1.0–1.6 m stand at 55–65° can
// bridge — are the exception, not the rule). Reserving them here still leaves them
// FRESH (untouched by any swing) for the sweep section itself, later in the file.
/** Candidate stands for a pair (a, b: torso centres); the caller keeps the first inside the room
 *  bounds with no other zombie within 1.8 m inside ±70°. */
function sweepStands(a, b) {
  const out = [];
  const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2, half = Math.hypot(b[0] - a[0], b[2] - a[2]) / 2;
  for (const deg of [60, 57, 63, 55, 65]) {
    const th = (deg * Math.PI) / 180, back = half / Math.tan(th), dist = half / Math.sin(th);
    if (dist < 1.0 || dist > 1.6) continue;
    const nx = -(b[2] - a[2]) / (2 * half), nz = (b[0] - a[0]) / (2 * half);   // unit normal to a→b
    for (const s of [1, -1]) {
      const x = mx + s * nx * back, z = mz + s * nz * back;
      out.push({ x, z, yaw: yawOf(mx - x, mz - z), deg });
    }
  }
  return out;
}
const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
let sweepChoice = null;
{
  const torsos = new Map();
  for (const z of pool) torsos.set(z.id, await torso(z.id));
  outer:
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const za = pool[i], zb = pool[j];
      const ta = torsos.get(za.id), tb = torsos.get(zb.id);
      for (const st of sweepStands(ta, tb)) {
        if (st.x < room.bounds.minX || st.x > room.bounds.maxX || st.z < room.bounds.minZ || st.z > room.bounds.maxZ) continue;
        let blocked = false;
        for (const other of pool) {
          if (other.id === za.id || other.id === zb.id) continue;
          const to = torsos.get(other.id);
          const dx = to[0] - st.x, dz = to[2] - st.z, dist = Math.hypot(dx, dz);
          if (dist >= 1.8) continue;
          if (Math.abs(angleDiff(yawOf(dx, dz), st.yaw)) <= (70 * Math.PI) / 180) { blocked = true; break; }
        }
        if (blocked) continue;
        sweepChoice = { za, zb, stand: st, torsos };
        break outer;
      }
    }
  }
  if (sweepChoice) { used.add(sweepChoice.za.id); used.add(sweepChoice.zb.id); }
  else {
    console.error(`  sweep: no zombie pair fits; room ${ROOM} bounds (${room.bounds.minX.toFixed(2)}, ${room.bounds.minZ.toFixed(2)}) – ` +
      `(${room.bounds.maxX.toFixed(2)}, ${room.bounds.maxZ.toFixed(2)}); torso positions: ` +
      `${pool.map((z) => `#${z.id} (${f2(torsos.get(z.id))})`).join('; ')}`);
  }
}

// ---- 1. Front hit (and the rest / R-swing photos) ------------------------------------
{
  const z = fresh();
  const t = await torso(z.id);
  const pose = standOff(t, 1.5);
  // The crosshair on the torso centre (the v1.2 strike lands on the crosshair).
  const pitch = Math.atan2(t[1] - EYE_H, 1.5);
  await place(pose, pitch);
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
  await place(pose, pitch);
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
  await place({ ...pose, yaw: pose.yaw + (TOO_WIDE_DEG * Math.PI) / 180 });
  await stepN(10);
  const before = (await wounds(z.id)).length;
  const sw = await swing();
  const st = await state();
  const added = (await wounds(z.id)).length - before;
  console.log(`too wide: zombie ${z.id} at 1.2 m, turned ${TOO_WIDE_DEG}°, side ${st.lastStrike?.side} (expected ${sw.side}), strike fired ${sw.control}: +${added} wounds; hits ${JSON.stringify(st.lastStrike?.hits)}`);
  if (sw.control && added === 0 && !st.lastStrike.hits.includes(z.id)) pass(`too wide (${TOO_WIDE_DEG}° off at 1.2 m): the ${sw.side} strike fired and missed`);
  else fail(`too wide (${TOO_WIDE_DEG}° off): control ${sw.control}, +${added} wounds`);
}

// ---- 4. The combo: R → L → H → R -------------------------------------------------------
{
  await stepN(30);   // > comboWindowSec (0.35 s): the combo resets to R
  const pre = await state();
  if (pre.nextSide !== 'R') console.error(`  combo: nextSide ${pre.nextSide} before the first click (expected R after the pause)`);
  const sides = [];
  for (let i = 0; i < 3; i++) {
    const sw = await swing();
    sides.push(sw.control ? sw.side : `MISS(${sw.side})`);
  }
  const seq = sides.join(',');
  console.log(`combo: struck ${seq}`);
  if (seq === 'R,L,H') pass('combo: three chained clicks struck R, L, H in order');
  else fail(`combo: struck ${seq} (expected R,L,H)`);
  await stepN(30);   // > comboWindowSec again: the combo should reset to R
  const post = await state();
  if (post.nextSide === 'R') pass('combo: nextSide resets to R after a pause');
  else fail(`combo: nextSide ${post.nextSide} after a 30-frame pause (expected R)`);
}

// ---- 5. Sweep width: H catches two flanking zombies, R/L miss them -----------------------
// (the pair itself was found and reserved above, before any other section's fresh() could
// claim the only zombies close enough together to fit)
{
  if (!sweepChoice) {
    fail('sweep: no zombie pair fits');
  } else {
    const { za, zb, stand: pose, torsos } = sweepChoice;
    await place(pose);
    await stepN(10);
    console.log(`sweep stand: (${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}) yaw ${pose.yaw.toFixed(2)} @ ${pose.deg}°, ` +
      `zombies #${za.id} (${f2(torsos.get(za.id))}) / #${zb.id} (${f2(torsos.get(zb.id))})`);
    const ids = [za.id, zb.id];
    for (const side of ['R', 'L']) {
      const before = await Promise.all(ids.map((id) => wounds(id).then((w) => w.length)));
      const sw = await swing();
      const st = await state();
      const after = await Promise.all(ids.map((id) => wounds(id).then((w) => w.length)));
      const added = after.map((a, k) => a - before[k]);
      const missed = added.every((a) => a === 0) && !ids.some((id) => st.lastStrike?.hits?.includes(id));
      console.log(`sweep ${side}: side ${st.lastStrike?.side} (expected ${sw.side}), control ${sw.control}: +${added.join(',')} wounds; hits ${JSON.stringify(st.lastStrike?.hits)}`);
      if (sw.control && sw.side === side && missed) pass(`sweep ${side}: missed both flanking zombies`);
      else fail(`sweep ${side}: control ${sw.control}, +${added.join(',')} wounds, hits ${JSON.stringify(st.lastStrike?.hits)}`);
    }
    {
      const before = await Promise.all(ids.map((id) => wounds(id).then((w) => w.length)));
      const sw = await swing();
      const st = await state();
      const after = await Promise.all(ids.map((id) => wounds(id).then((w) => w.length)));
      const added = after.map((a, k) => a - before[k]);
      const bothHit = ids.every((id) => st.lastStrike?.hits?.includes(id)) && added.every((a) => a === 1);
      console.log(`sweep H: side ${st.lastStrike?.side} (expected ${sw.side}), control ${sw.control}: +${added.join(',')} wounds; hits ${JSON.stringify(st.lastStrike?.hits)}`);
      if (sw.control && sw.side === 'H' && bothHit) pass('sweep H: hit both flanking zombies');
      else fail(`sweep H: control ${sw.control}, +${added.join(',')} wounds, hits ${JSON.stringify(st.lastStrike?.hits)}`);
    }
  }
}

// ---- 6. Crosshair-aimed head hits: the flesh wears away, the head never comes off ---------
{
  const z = fresh();
  const woundList = (id) => evaluate(`__sdfGame.zombie(${id}).woundList()`);
  const posedOf = (id) => evaluate(`__sdfGame.zombie(${id}).posed()`);
  const headOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, 'head')`);
  const aliveOf = (id) => evaluate(`__sdfGame.flail.limbAlive(${id}, 'head')`);
  const headState = (id) => evaluate(`__sdfGame.head.state(${id})`);
  const distTo = (p, o) => Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
  const fleshSum = (hs) => (hs ? Object.values(hs.flesh).reduce((a, b) => a + b, 0) : 6);
  /** Stand at `pose`, turn the view straight onto `p` (the crosshair aim looks off to one side), shoot. */
  async function photoOf(pose, p, name) {
    const e = [pose.x, EYE_H, pose.z];
    await place({ ...pose, yaw: yawOf(p[0] - e[0], p[2] - e[2]) }, Math.atan2(p[1] - EYE_H, Math.hypot(p[0] - e[0], p[2] - e[2])));
    await capture(name);
  }
  // The page's own region centres (head-damage.ts) — the struck point's region is logged per hit.
  const REGIONS = await evaluate(`import('/src/lab/sdf-zombie/head-damage.ts').then((m) => m.HEAD_REGIONS)`);
  const qRot = (q, v) => {
    const [x, y, zq, w] = q;
    const tx = 2 * (y * v[2] - zq * v[1]), ty = 2 * (zq * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - zq * ty), v[1] + w * ty + (zq * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  /** The strike point in head-normalised coordinates (the leaf's frame) and its nearest region. */
  const struckHs = (fr, p) => {
    if (!fr || !p) return null;
    const l = qRot([-fr.quat[0], -fr.quat[1], -fr.quat[2], fr.quat[3]], p.map((v, i) => v - fr.centre[i]));
    const hs = [l[0] / fr.axes[0], l[1] / fr.axes[1], l[2] / fr.axes[2]];
    let near = null, bd = Infinity;
    for (const [r, c] of Object.entries(REGIONS)) { const d = (hs[0] - c[0]) ** 2 + (hs[1] - c[1]) ** 2 + (hs[2] - c[2]) ** 2; if (d < bd) { bd = d; near = r; } }
    return { hs, near };
  };
  const alive0 = await aliveOf(z.id);
  let killHit = null;
  let lastPose = null, lastHead = null;
  for (let hit = 1; hit <= HEAD_HITS_MAX; hit++) {
    const aliveBefore = await aliveOf(z.id);
    if (aliveBefore === 0) { fail(`head hit ${hit}: no head to aim at (already off — the flail is not meant to decapitate)`); break; }
    const head = await headOf(z.id);
    if (!head) { fail(`head hit ${hit}: actorLimbCenter('head') is null though limbAlive ${aliveBefore}`); break; }
    // The crosshair on the head centre, exactly as a player aims: 0.9 m out, pitch
    // solved from that same horizontal distance — no strike-ray solver.
    const pose = standOff(head, 0.9);
    const pitch = Math.atan2(head[1] - EYE_H, 0.9);
    await place(pose, pitch);
    await stepN(5);
    const hsBefore = await headState(z.id);
    const regionR = (wl) => new Map(wl.filter((w) => w.headRegion).map((w) => [w.headRegion, w.radius]));
    const rBefore = regionR(await woundList(z.id));
    const sw = await swing();
    if (!sw.control) fail(`head hit ${hit}: the strike did not fire as expected`);
    const st = await state();
    const hsAfter = await headState(z.id);
    const afterWL = await woundList(z.id);
    const afterWorld = await wounds(z.id);   // actorWounds() — world positions, same order as woundList
    const posed = await posedOf(z.id);
    // The head-region wounds this hit stamped: new regions, or regions whose crater grew.
    const grown = afterWL.map((w, i) => ({ w, i })).filter(({ w }) => w.headRegion && (!rBefore.has(w.headRegion) || w.radius > rBefore.get(w.headRegion) + 1e-6))
      .map(({ w, i }) => {
        const pos = afterWorld[i]?.pos ?? null;
        return { region: w.headRegion, radius: w.radius, was: rBefore.get(w.headRegion) ?? null, pos, toHead: pos ? distTo(pos, head) : null, limb: posed.prims[w.primIdx]?.limb, sever: w.severRadius ?? 0 };
      });
    const alive = await aliveOf(z.id);
    const counted = st.lastStrike?.headHits?.[z.id] ?? null;
    const impactToHead = distTo(st.lastStrike?.impact ?? [0, 0, 0], head);
    const f0 = fleshSum(hsBefore), f1 = fleshSum(hsAfter);
    const sh = struckHs(hsAfter?.frame, st.lastStrike?.points?.[z.id]);
    lastPose = pose; lastHead = head;
    console.log(`head hit ${hit} (${st.lastStrike?.side}): impact (${f2(st.lastStrike.impact)}), ${impactToHead.toFixed(3)} m from head centre; ` +
      `struck hs ${sh ? f2(sh.hs) : '?'} (nearest region ${sh?.near ?? '?'}); ` +
      `flesh ${f0.toFixed(2)} -> ${f1.toFixed(2)} (${hsAfter ? Object.entries(hsAfter.flesh).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' ') : 'no head state'}); ` +
      `skull ${hsAfter ? JSON.stringify(hsAfter.skull) : '?'}; eyes ${hsAfter ? JSON.stringify(hsAfter.eyes) : '?'}; dead ${hsAfter?.dead}; ` +
      `region craters new/grown: ${grown.map((g) => `${g.region} ${g.was === null ? 'new' : g.was.toFixed(3) + '->'}${g.radius.toFixed(3)} ${g.limb} ${g.toHead === null ? '?' : g.toHead.toFixed(3)}m/head sev${g.sever}`).join('; ') || 'none'}; ` +
      `headHits ${counted}; head prims ${alive}/${alive0}`);
    // ASSERTED: resolveStrike's own snapped hit point (lastStrike.points[id]) at strike time —
    // before the wound's local-frame round trip (worldHitToWound/woundWorldPos) can drift it.
    // Investigation 2026-09-28: a first hit on a fresh head reconstructs several cm off this
    // point because the struck prim's orientation frame at READ time (a few frames later, once
    // any reaction has settled) can differ from the frame at STAMP time — not because anything
    // moved (actorLimbCenter('head') was confirmed bit-identical, 0.00000 m, across every frame
    // of the swing, for both the first and second hit on two separate fresh zombies). The ray's
    // own hit point sidesteps that round trip entirely, so it is what "lands within 5 cm of the
    // crosshair ray" (spec §12.4/§12.5) actually means.
    const strikePoint = st.lastStrike?.points?.[z.id];
    if (strikePoint && st.lastStrike?.eye && st.lastStrike?.impact) {
      const aim = distToRay(st.lastStrike.eye, st.lastStrike.impact, strikePoint);
      aimErrs.push(aim);
      console.log(`  crosshair distance (at the strike): ${(aim * 100).toFixed(2)} cm`);
    }
    if (alive > 0 && counted === hit) pass(`head hit ${hit}: the head is still on (${alive}/${alive0} prims), headHits ${counted}`);
    else fail(`head hit ${hit}: alive ${alive}/${alive0}, headHits ${counted} (expected ${hit}) — the flail must never take the head off`);
    const onHead = grown.filter((g) => g.limb === 'head' && g.toHead !== null && g.toHead < ON_HEAD && g.sever === 0);
    if (hsAfter && f1 < f0 - 1e-6 && onHead.length > 0) pass(`head hit ${hit}: strips flesh (${f0.toFixed(2)} -> ${f1.toFixed(2)}) and ${onHead.length} head-region crater(s) appeared or grew (${onHead.map((g) => g.region).join(', ')}) on the head`);
    else fail(`head hit ${hit}: no strip — flesh ${f0.toFixed(2)} -> ${f1.toFixed(2)}, head-region craters new/grown on a head prim within ${ON_HEAD} m: ${onHead.length} (of ${grown.length})`);
    if (hit === 1) await photoOf(pose, head, 'head-hit-1');
    if (hsAfter?.dead) {
      killHit = hit;
      await photoOf(pose, head, 'head-hit-kill');
      // Thaw a few frames so the actor's debug readback (actorList's phase) is fresh — the forced
      // collapse is fed to the motion signals on the next step.
      await evaluate('__sdfGame.freeze(false)');
      await stepN(3);
      await evaluate('__sdfGame.freeze(true)');
      const al = (await evaluate('__sdfGame.actorList()')).find((a) => a.id === z.id);
      if (al && al.phase !== 'standing') pass(`head hit ${hit} kills (the brain): phase ${al.phase}, meter ${al.meter?.toFixed(3) ?? '?'}`);
      else fail(`head hit ${hit}: the head model is dead (the brain) but the phase is ${al?.phase ?? 'unknown'}`);
      const aliveK = await aliveOf(z.id);
      if (aliveK > 0) pass(`head hit ${hit}: the head is still on after the kill (${aliveK}/${alive0} prims)`);
      else fail(`head hit ${hit}: the head came off with the kill`);
      break;
    }
  }
  if (killHit === null && lastPose) await photoOf(lastPose, lastHead, 'head-hit-last');
  if (killHit !== null && killHit >= KILL_MIN && killHit <= KILL_MAX) pass(`head hits alone kill on hit ${killHit} (${KILL_MIN}–${KILL_MAX})`);
  else fail(`head hits alone: ${killHit === null ? `no kill within ${HEAD_HITS_MAX} hits` : `the kill came on hit ${killHit}`} (expected ${KILL_MIN}–${KILL_MAX})`);
}

// ---- 7. Hits to collapse ----------------------------------------------------------------
{
  const z = fresh();
  const woundList = (id) => evaluate(`__sdfGame.zombie(${id}).woundList()`);
  const posedOf = (id) => evaluate(`__sdfGame.zombie(${id}).posed()`);
  let hitsTaken = 0, finalPhase = 'standing';
  for (let clickNum = 1; clickNum <= 12; clickNum++) {
    // Re-place from the CURRENT torso centre every click: the thaw below lets the
    // zombie take one step, so a stale pose could drift off-arc.
    const t = await torso(z.id);
    const pose = standOff(t, 1.2);
    const pitch = Math.atan2(t[1] - EYE_H, 1.2);
    await place(pose, pitch);
    await stepN(3);
    const beforeWL = await woundList(z.id);
    const sw = await swing();
    if (!sw.control) fail(`collapse hit ${clickNum}: the strike did not fire as expected`);
    const st = await state();
    // Thaw one frame so the actor's debug readback (actorList's phase/meter) is fresh —
    // it is otherwise the LAST STEPPED frame's, which is stale on a frozen actor.
    await evaluate('__sdfGame.freeze(false)');
    await stepOne();
    await evaluate('__sdfGame.freeze(true)');
    const al = (await evaluate('__sdfGame.actorList()')).find((a) => a.id === z.id);
    const afterWL = await woundList(z.id);
    const afterWorld = await wounds(z.id);
    const newWL = afterWL.slice(beforeWL.length);
    const newWorld = afterWorld.slice(beforeWL.length);
    const posed = await posedOf(z.id);
    const severed = posed.clusters.filter((c) => !c.alive).map((c) => c.limb);
    const phaseNow = al?.phase ?? 'unknown';
    console.log(`collapse hit ${clickNum} (${st.lastStrike?.side}): meter ${al?.meter?.toFixed(3) ?? '?'}, phase ${phaseNow}, ` +
      `+${newWL.length} wounds (radii ${newWL.map((w) => w.radius.toFixed(3)).join(' ')}), severed [${severed.join(', ')}]`);
    const r0i = newWL.findIndex((w) => !w.injuryIgnored);
    const r0 = r0i >= 0 ? newWL[r0i] : null;
    // ASSERTED: the strike-time hit point (see the head section's comment above) — here doubly
    // warranted, since the one-frame thaw right after the strike lets the actor step before the
    // wound readback below.
    const strikePoint = st.lastStrike?.points?.[z.id];
    if (strikePoint && st.lastStrike?.eye && st.lastStrike?.impact) {
      const aim = distToRay(st.lastStrike.eye, st.lastStrike.impact, strikePoint);
      aimErrs.push(aim);
      console.log(`  crosshair distance (at the strike): ${(aim * 100).toFixed(2)} cm`);
    }
    if (r0 && st.lastStrike?.eye && st.lastStrike?.impact && newWorld[r0i]?.pos) {
      const post = distToRay(st.lastStrike.eye, st.lastStrike.impact, newWorld[r0i].pos);
      console.log(`  crosshair distance (wound readback, post-reaction, not asserted): ${(post * 100).toFixed(2)} cm`);
    }
    if (clickNum === 1) {
      const ok = !!r0 && Math.abs(r0.radius - CRATER_R) <= 0.005;
      if (ok) pass(`collapse hit 1: wound radius ${r0.radius.toFixed(3)} (CRATER_R ${CRATER_R})`);
      else fail(`collapse hit 1: wound radius ${r0 ? r0.radius.toFixed(3) : 'none'} (expected ${CRATER_R})`);
    }
    hitsTaken = clickNum;
    finalPhase = phaseNow;
    if (phaseNow !== 'standing') break;
  }
  const ok = finalPhase !== 'standing' && hitsTaken >= COLLAPSE_MIN;
  if (ok) pass(`collapse: came on hit ${hitsTaken} (target ≥ ${COLLAPSE_MIN})`);
  else if (finalPhase !== 'standing') fail(`collapse: came too early, on hit ${hitsTaken} (target ≥ ${COLLAPSE_MIN})`);
  else fail(`collapse: never left 'standing' within ${hitsTaken} clicks`);
}

// ---- 8b. Free aim: the hit follows the free-aim reticle, not the screen centre ------------
// Owner, v1.3 playtest (2026-09-28): with free aim the reticle drifts inside a dead zone, and
// the flail used to strike down the camera's forward (the screen centre) — the reticle on the
// head hit the torso, the screen centre on the head hit the face. The shotgun fires through
// the reticle (game-weapon-leaves.ts aimDir); the flail must too. The view looks at the torso;
// CONTROL: reticle centred → a torso hit. Then the reticle moved onto the head → a head hit.
{
  const z = fresh();
  const t = await torso(z.id);
  const pose = standOff(t, 1.2);
  const pitch = Math.atan2(t[1] - EYE_H, 1.2);
  await evaluate('__sdfGame.setFreeAim(true)');
  const hitLimbs = async (before) => evaluate(`(() => { const a = __sdfGame.zombie(${z.id}); const p = a.posed();
    return a.woundList().slice(${before}).filter(w => !w.injuryIgnored).map(w => p.prims[w.primIdx]?.limb ?? '?'); })()`);
  const aimed = async (label, aimXY) => {
    await place(pose, pitch);
    await evaluate(`__sdfGame.setAimPoint(${aimXY[0]}, ${aimXY[1]})`);
    await stepN(5);
    const before = await evaluate(`__sdfGame.zombie(${z.id}).woundCount()`);
    const heads0 = (await state()).lastStrike?.headHits?.[z.id] ?? 0;
    const sw = await swing();
    const st = await state();
    const limbs = await hitLimbs(before);
    const struck = !!sw.control && st.lastStrike.hits.includes(z.id);
    const headHit = (st.lastStrike.headHits?.[z.id] ?? 0) > heads0 || limbs.includes('head');
    console.log(`free aim ${label}: aim (${aimXY.map((v) => v.toFixed(2)).join(', ')}), side ${st.lastStrike?.side}, struck ${struck}, ` +
      `new wounds on ${JSON.stringify(limbs)}, head hit ${headHit}`);
    return { struck, headHit };
  };
  const centre = await aimed('reticle centred (control)', [0, 0]);
  await place(pose, pitch);
  await stepN(2);
  const head = await evaluate(`__sdfGame.actorLimbCenter(${z.id}, 'head')`);
  const n = head ? await evaluate(`__sdfGame.flail.toScreen(${head[0]}, ${head[1]}, ${head[2]})`) : null;
  if (!n) fail('free aim: the head is not on screen from the torso stand');
  else {
    const onHead = await aimed('reticle on the head', [n[0], n[1]]);
    if (centre.struck && !centre.headHit) pass('free aim control: the reticle centred on the torso hits the torso');
    else fail(`free aim control: struck ${centre.struck}, head hit ${centre.headHit} (expected a torso hit)`);
    if (onHead.struck && onHead.headHit) pass('free aim: the reticle moved onto the head hits the head');
    else fail(`free aim: the reticle on the head — struck ${onHead.struck}, head hit ${onHead.headHit} (expected a head hit)`);
  }
  await evaluate('__sdfGame.setAimPoint(0, 0)');
}

// ---- 8. Crosshair accuracy over the head and collapse hits ------------------------------
{
  const worst = aimErrs.length ? Math.max(...aimErrs) : Infinity;
  console.log(`crosshair distance per hit (cm): ${aimErrs.map((e) => (e * 100).toFixed(2)).join(' ')}`);
  if (aimErrs.length && worst <= AIM_MAX) pass(`crosshair accuracy: worst crater ${(worst * 100).toFixed(2)} cm from the strike ray over ${aimErrs.length} hits (≤ ${(AIM_MAX * 100).toFixed(0)} cm)`);
  else fail(`crosshair accuracy: worst crater ${(worst * 100).toFixed(2)} cm from the strike ray over ${aimErrs.length} hits`);
}

// ---- 9b. The strike-frame ball at 144 Hz, steady and jittered (R, L and H all pinned) ----
{
  let seed = 1;
  const jitter = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (1 + 0.15 * (2 * (seed / 2147483648) - 1)) / 144; };
  const errs = [];
  for (const [label, dt] of [['144 Hz', () => 1 / 144], ['144 Hz ±15%', jitter]]) {
    for (let k = 0; k < 3; k++) {
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

// ---- 9. The drawn ball on the strike frame -------------------------------------------------
{
  const worst = ballErrs.length ? Math.max(...ballErrs) : Infinity;
  console.log(`strike-frame ball error per click (cm): ${ballErrs.map((e) => (e * 100).toFixed(3)).join(' ')}`);
  if (ballErrs.length >= 6 && worst <= BALL_ERR_MAX) pass(`strike frame: the drawn ball within ${(worst * 100).toFixed(3)} cm of the impact on all ${ballErrs.length} clicks (≤ 2 cm)`);
  else fail(`strike frame: worst drawn-ball error ${(worst * 100).toFixed(2)} cm over ${ballErrs.length} clicks`);
}

if (controlFails === 0) pass('positive control: every click struck exactly once, on the side nextSide promised');
else fail(`positive control: ${controlFails} click(s) did not strike as expected`);

// ---- 10. Console -------------------------------------------------------------------------
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception' || e.type === 'assert');
if (errs.length === 0) pass('zero console errors or exceptions');
else fail(`console errors: ${JSON.stringify(errs).slice(0, 2000)}`);
const warns = consoleEvents.filter((e) => e.type === 'warning' && /flail/i.test(e.text));
if (warns.length) console.log(`flail warnings: ${JSON.stringify(warns).slice(0, 1000)}`);

console.log(failures === 0 ? 'GATE PASSED' : `GATE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
