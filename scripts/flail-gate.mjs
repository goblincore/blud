// scripts/flail-gate.mjs — the spike flail lands one big crater, refuses out-of-reach and
// out-of-arc targets, chains R → L → H on quick clicks, sweeps H wide enough to catch two
// zombies flanking the crosshair, wears a head's flesh away over crosshair-aimed hits until the
// brain kills (head damage v2) without ever taking it off, needs at least ten body hits to
// drop a zombie, and lands a head-aimed strike at a walking zombie on its head (Tasks 6, 11,
// 12, 18–21 and 23 of the spike-flail plan; spec docs/superpowers/specs/2026-09-26-spike-flail-design.md
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
//      it shows the phase out of 'standing'. From hit 2 on, the STRUCK region's crater (anchored where the
//      region was first struck, spec §15 as built) sits within ANCHOR_MAX of the strike point — the side
//      stand's hits land nearest cheekL, whose fixed centre is on the front of the face. The damage model's own look and numbers are
//      scripts/head-damage-gate.mjs's. Photos head-hit-1.png and head-hit-kill.png (head-hit-last.png
//      when no kill came);
//   7. hits to collapse: a fresh zombie; before every click the crosshair is put on its
//      CURRENT torso centre from 1.2 m. Click until collapse.ts's phase leaves 'standing' or
//      COLLAPSE_CLICKS (16) clicks. The collapse must come on hit ≥ COLLAPSE_MIN (10: meterThreshold
//      0.8, 0.065 credit/R-or-L hit, 0.09/H hit — spec §13.2), and hit 1's wound radius is
//      CRATER_R (0.09) ± 0.005;
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
//   10. zero console errors or exceptions;
//   12. IMPACT (spec §14.1, v1.5a): fx and hit-stop on, a frozen standing zombie struck on the body with R,
//      then L and H in a chain; per frame the time scale, the camera pitch kick (+ recoilPitch), the judder
//      and the FOV the camera draws. Asserted on R: the hit-stop at 0.08 for 70 ms (4–5 frames at 60 Hz), the
//      slow tail monotone and exactly 1.0 within slowSec (+1 frame), the pitch kick peak ≥ 0.04 rad, the judder
//      below 10% of its peak from 0.35 s, the FOV pinched ≥ 2° and back within 0.05° of its base by 0.3 s, the
//      rig kick back at rest by 0.6 s; H's pitch, FOV and rig peaks above R's. Printed: every number.
//   14. FLESH (v1.5b Task 32, flesh-bits.ts): flesh bits on, bleed on. A standing zombie: one R body hit throws
//      3–5 live 'flesh' chunks (chunkTags), one head hit 5–7 (8–11 on an H); frame strips (8 frames, 0.1 s apart,
//      from the strike frame) of both into docs/dev-notes/2026-09-28-head-damage/flesh/. Ten more hits: live flesh
//      never above FLESH_CAP (10) after any hit, views never above the budget; the draw time with the bits live vs
//      the same stand before (printed, noisy); 16 s later every flesh bit is gone (FLESH_BITS.lifeS 8).
//   13. BLOOD (spec §14.1 item 7): a fresh flail's state().blood is 0 (the rest photo's pixel measures run
//      clean); three R body hits from 0 raise it by ~0.12 each to 0.36 less its drying (120 s time constant)
//      over the swings; set to 1, ten seconds of simulated time dry it to exp(−10/120) ± 0.003;
//   11. LIVE (spec §13, v1.4): the section-2 zombie (untouched) unfrozen and walking up, hit-stop on, free aim
//      on with the reticle centred; before each of LIVE_SWINGS (8) clicks the player stands LIVE_DIST (1.3 m)
//      out from its current torso with the crosshair on its current head centre — its arms up in front of
//      the face. At least LIVE_MIN (6) must be head hits (lastStrike.headHits counts; a head-model kill ends
//      the run early — the zombie is going down); printed per swing: the ray → head-centre distance at the
//      strike, how far the head moved since the click, where the hit landed and whether the head magnet
//      (flail-strike.ts, spec §13.1) moved it.
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
// Env: OUT (docs/dev-notes/2026-09-26-flail/gate), ROOM (most zombies), W/H (1280x800); section 14's strips:
//   FLESH_BLEED=0 (bleed off, to pick the bits out of the gout), FLESH_SUFFIX (appended to the strip names).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { writePng } from './lib/png-write.mjs';

const VITE = Number(process.argv[2] ?? 5233);
const CDP = Number(process.argv[3] ?? 9223);
const OUT = process.env.OUT ?? 'docs/dev-notes/2026-09-26-flail/gate';
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const CRATER_R = 0.09;      // FLAIL_FEEL.craterR (game-flail.ts)
// Head damage v2 (game-head-damage.ts; spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md
// §15): every head hit strips flesh region by region; the brain comes out and kills. v1.5b BIGGER BITES (owner:
// "too gradual"): 4–7 hits on a single region in the model's own tests, 4–9 in play here (jitter, where the blows
// land; v1.4 was 7–10 / 7–12). All head craters have severRadius 0 — the flail never decapitates (flail spec §12.3).
const KILL_MIN = 4, KILL_MAX = 9;
// The struck region's crater (anchored at its first strike) within this of the strike point (hits 2+). The
// fixed cheekL centre the side stand used to crater sits ~10 cm from where the side hits land.
const ANCHOR_MAX = 0.05;
const HEAD_HITS_MAX = 12;   // crosshair-aimed clicks the gate allows before calling the kill missing
// A region crater sits at its region's surface point — the crown's ~0.2 m from actorLimbCenter('head')
// (the head cluster's centre) — so a head-region wound must sit on a `head` prim within this of it.
const ON_HEAD = 0.26;
const COLLAPSE_MIN = 10;    // meterThreshold 0.8; 0.065 credit/R-or-L hit, 0.09/H hit (spec §13.2: ~12 body hits)
const COLLAPSE_CLICKS = 16; // clicks the collapse section allows before calling the collapse missing
const AIM_MAX = 0.05;       // every head/collapse crater must land within this of the crosshair's
                             // own ray (lastStrike.eye → lastStrike.impact, spec §12.4)
const TOO_WIDE_DEG = 80;    // outside H's ±70° arc as well as R/L's ±50°
const BALL_ERR_MAX = 0.02;  // the drawn ball on the strike frame vs FLAIL_IMPACT
// At 144 Hz the pin must be EXACT: the pre-fix pin (review C1) landed 0.8–1.9 cm short in
// this gate — inside the 2 cm above, so that bound could not catch it.
const BALL_ERR_144_MAX = 0.001;
const SWING_FRAMES = 36;
// LIVE (section 11, spec §13): of LIVE_SWINGS swings at an unfrozen zombie's head from LIVE_DIST out, at least
// LIVE_MIN hit the head.
const LIVE_SWINGS = 8, LIVE_MIN = 6, LIVE_DIST = 1.3;    // 0.6 s at 60 Hz: past H's 0.55 s, back to idle

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
// The impact feel (flail-impact.ts, spec §14.1) moves the camera, the FOV and the rig: off for every section
// that measures pixels or positions; the "impact" section (12) turns it on.
await evaluate('__sdfGame.flail.setImpactFx(false)');
// Flying flesh bits (flesh-bits.ts, v1.5b): extra live chunks on every hit — off so every section's chunk counts
// and pixels are the pre-flesh ones; section 14 turns them on.
await evaluate('__sdfGame.flail.setFleshBits(false)');
const st0 = await evaluate('__sdfGame.flail.state()');
if (!st0 || st0.phase !== 'idle') die(`flail not idle after the raise: ${JSON.stringify(st0)}`);
// A fresh flail is clean (flail-blood.ts): the rest photo's pixel measures below run at blood 0.
if (st0.blood === 0) pass('blood: a fresh flail starts clean (state().blood 0)');
else fail(`blood: a fresh flail starts at ${st0.blood} (expected 0)`);
if ((await evaluate('__sdfGame.dynamite()'))?.live !== 'flail') die('the live slot is not the flail');
// The FIRST render-locked capture of a session has come back with neither the level nor
// the flail drawn (seen twice: a dark frame, the zombie alone). Throw two away first, so
// the rest photo — and the crater's BEFORE crop — are real frames.
await capture(null); await capture(null);
console.log(`flail ready; canvas ${JSON.stringify(rect)}`);

// ---- The arena --------------------------------------------------------------------
const f2 = (v) => v.map((c) => c.toFixed(2)).join(', ');
let zombies = (await evaluate('__sdfGame.actorList()')).filter((a) => a.kind === 'zombie');
let byRoom = new Map();
for (const z of zombies) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
const ROOM = process.env.ROOM ? Number(process.env.ROOM)
  : [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
// TOP-UP (merge of main, 2026-09-29): the arena's first two slots became the juggernaut and the
// warbull (game-level.ts slotCharacter), leaving 6 zombies. Spawn the missing ones as debug
// zombies on free floor inside the arena (>= 2.4 m from every actor, 1 m off the walls), then
// re-read the pool. spawnDebugCharacter spawns into the player's room, so stand there first.
if ((byRoom.get(ROOM) ?? []).length < 8) {
  const r = (await evaluate('__sdfGame.rooms')).find((q) => q.id === ROOM);
  const b = r.bounds;
  await evaluate(`__sdfGame.placePlayer({ x: ${(b.minX + b.maxX) / 2}, z: ${(b.minZ + b.maxZ) / 2}, yaw: 0, pitch: 0 })`);
  await evaluate('__sdfGame.step(1, 1 / 60)');
  const taken = (await evaluate('__sdfGame.actorList()')).map((a) => a.pos);
  let need = 8 - (byRoom.get(ROOM) ?? []).length;
  for (let x = b.minX + 1; x <= b.maxX - 1 && need > 0; x += 0.8) {
    for (let z = b.minZ + 1; z <= b.maxZ - 1 && need > 0; z += 0.8) {
      if (taken.some((p) => Math.hypot(p[0] - x, p[2] - z) < 2.4)) continue;
      await evaluate(`__sdfGame.spawnDebugCharacter('zombie', [${x}, 0, ${z}])`);
      taken.push([x, 0, z]); need--;
    }
  }
  for (let i = 0; i < 4; i++) await evaluate('__sdfGame.step(1, 1 / 60)');
  zombies = (await evaluate('__sdfGame.actorList()')).filter((a) => a.kind === 'zombie');
  byRoom = new Map();
  for (const z of zombies) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  console.log(`room ${ROOM}: topped up to ${(byRoom.get(ROOM) ?? []).length} zombies (arena slots 0-1 are the juggernaut and warbull)`);
}
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
let tooFarZ = null;   // untouched here (the strike is refused): the LIVE section (11) reuses it
{
  const z = fresh();
  tooFarZ = z;
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
  const anchorErrs = [];
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
    // The struck region's crater is ANCHORED where it was first struck (spec §15 as built): on the side stand it
    // sits on the side of the head, by the strike, not at the region's fixed (front-of-face) centre ~10 cm away.
    // Hit 1 is printed only (a fresh head's first wound reconstructs cm off at read time — see above).
    const struckI = sh ? afterWL.findIndex((w) => w.headRegion === sh.near) : -1;
    const struckPos = struckI >= 0 ? afterWorld[struckI]?.pos ?? null : null;
    if (struckPos && strikePoint) {
      const d = distTo(struckPos, strikePoint);
      console.log(`  struck region ${sh.near}: its crater ${(d * 100).toFixed(1)} cm from the strike point`);
      if (hit >= 2) anchorErrs.push(d);
    }
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
  const anchorWorst = anchorErrs.length ? Math.max(...anchorErrs) : null;
  if (anchorWorst !== null && anchorWorst <= ANCHOR_MAX) pass(`the struck region's crater sits by the strike: worst ${(anchorWorst * 100).toFixed(1)} cm over head hits 2+ (<= ${ANCHOR_MAX * 100} cm)`);
  else fail(`the struck region's crater is not by the strike: worst ${anchorWorst === null ? '?' : (anchorWorst * 100).toFixed(1)} cm over head hits 2+ (<= ${ANCHOR_MAX * 100} cm)`);
  if (killHit !== null && killHit >= KILL_MIN && killHit <= KILL_MAX) pass(`head hits alone kill on hit ${killHit} (${KILL_MIN}–${KILL_MAX})`);
  else fail(`head hits alone: ${killHit === null ? `no kill within ${HEAD_HITS_MAX} hits` : `the kill came on hit ${killHit}`} (expected ${KILL_MIN}–${KILL_MAX})`);
}

// ---- 7. Hits to collapse ----------------------------------------------------------------
{
  const z = fresh();
  const woundList = (id) => evaluate(`__sdfGame.zombie(${id}).woundList()`);
  const posedOf = (id) => evaluate(`__sdfGame.zombie(${id}).posed()`);
  let hitsTaken = 0, finalPhase = 'standing';
  for (let clickNum = 1; clickNum <= COLLAPSE_CLICKS; clickNum++) {
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
// the reticle (game-weapon-rig.ts aimDir); the flail must too. The view looks at the torso;
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

// ---- 11. LIVE: an unfrozen zombie walks up, arms raised; the crosshair on its head hits the head -----
// Spec §13 (v1.4 playtest): aiming at the head, the strike ray passed 1–3 cm from the head centre but met
// the raised forearm first (a strike point 53 cm from the head), and the zombie lunges 13–28 cm between
// click and strike. The head magnet (flail-strike.ts, headMagnetR 0.18) lands such a strike on the head.
// Everything unfrozen, hit-stop on, free aim on with the reticle centred: before every click the player
// stands LIVE_DIST out from the zombie's CURRENT torso centre with the crosshair on its CURRENT head centre.
// Of LIVE_SWINGS swings at least LIVE_MIN must be head hits (lastStrike.headHits counts); printed per swing:
// the ray → head-centre distance at the click and at the strike, how far the head moved, where the hit
// landed (its distance from the head centre at the strike) and whether the magnet moved it.
{
  // untouched by section 2's refused strike: every other zombie has been hit. BUT (merge of main,
  // 2026-09-29) the arena now holds soldier-family enemies (the juggernaut and warbull, and room 5's
  // soldiers wander in): unfrozen, they shoot, and the chaingun/rockets gib the walking zombie. When
  // the arena has any, take an untouched zombie from a room with no soldier-family enemy instead.
  const all = await evaluate('__sdfGame.actorList()');
  const soldierRooms = new Set(all.filter((a) => a.kind !== 'zombie').map((a) => a.room));
  const quiet = all.find((a) => a.kind === 'zombie' && a.phase === 'standing' && !soldierRooms.has(a.room) && !used.has(a.id));
  const z = soldierRooms.has(ROOM) && quiet ? quiet : tooFarZ;
  if (z !== tooFarZ) console.log(`live: the arena has soldier-family enemies; zombie ${z.id} in quiet room ${z.room} walks up instead`);
  const headOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, 'head')`);
  const headState = (id) => evaluate(`__sdfGame.head.state(${id})`);
  const distTo = (p, o) => Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
  await evaluate('__sdfGame.freeze(false)');
  await evaluate('__sdfGame.flail.setHitStop(true)');
  await evaluate('__sdfGame.setFreeAim(true)');
  await evaluate('__sdfGame.setAimPoint(0, 0)');
  let pose = standOff(await torso(z.id), 5);
  if (z !== tooFarZ) {
    // The quiet room's own centre side, clamped 0.5 m inside its walls (standOff uses the arena's centre).
    const qb = (await evaluate('__sdfGame.rooms')).find((r) => r.id === z.room).bounds;
    const t0 = await torso(z.id), qc = [(qb.minX + qb.maxX) / 2, (qb.minZ + qb.maxZ) / 2];
    const ax = qc[0] - t0[0], az = qc[1] - t0[2], l = Math.hypot(ax, az) || 1;
    const x = Math.min(Math.max(t0[0] + (ax / l) * 5, qb.minX + 0.5), qb.maxX - 0.5);
    const zz = Math.min(Math.max(t0[2] + (az / l) * 5, qb.minZ + 0.5), qb.maxZ - 0.5);
    pose = { x, z: zz, yaw: yawOf(t0[0] - x, t0[2] - zz) };
  }
  await place(pose);
  let walkD = Infinity, walkF = 0;
  for (; walkF < 600 && walkD >= 1.6; walkF++) {
    await stepOne();
    const t = await torso(z.id);
    if (!t) die(`live: zombie ${z.id} is gone while walking up (frame ${walkF})`);
    walkD = Math.hypot(t[0] - pose.x, t[2] - pose.z);
  }
  console.log(`live: zombie ${z.id} walked to ${walkD.toFixed(2)} m in ${walkF} frames`);
  let headHitsLive = 0, swings = 0, killedAt = null;
  for (let n = 1; n <= LIVE_SWINGS; n++) {
    const t = await torso(z.id), head = await headOf(z.id);
    if (!t || !head) { console.error(`  live swing ${n}: no torso/head`); break; }
    const dx = t[0] - pose.x, dz = t[2] - pose.z, l = Math.hypot(dx, dz) || 1;
    pose = { x: t[0] - (dx / l) * LIVE_DIST, z: t[2] - (dz / l) * LIVE_DIST, yaw: yawOf(dx, dz) };
    const hd = Math.hypot(head[0] - pose.x, head[2] - pose.z);
    await evaluate(`__sdfGame.placePlayer({ x: ${pose.x}, z: ${pose.z}, yaw: ${yawOf(head[0] - pose.x, head[2] - pose.z)}, pitch: ${Math.atan2(head[1] - EYE_H, hd)} })`);
    await evaluate('__sdfGame.setAimPoint(0, 0)');
    const pre = await state();
    if (pre.phase !== 'idle') console.error(`  live swing ${n}: the flail is ${pre.phase}, not idle, at the click`);
    await evaluate('__sdfGame.flail.click()');
    let headAtStrike = null;
    for (let i = 0; i < 90 && !headAtStrike; i++) {
      await stepOne();
      const s = await state();
      if (s.strikes > pre.strikes) headAtStrike = s.lastStrike?.heads?.[z.id] ?? await headOf(z.id);
    }
    const post = await state();
    swings++;
    if (post.strikes !== pre.strikes + 1) { console.error(`  live swing ${n}: no strike`); continue; }
    const ls = post.lastStrike;
    const struck = ls.hits.includes(z.id);
    const isHead = struck && (ls.headHits?.[z.id] ?? 0) > (pre.lastStrike?.headHits?.[z.id] ?? 0);
    if (isHead) headHitsLive++;
    const pt = ls.points?.[z.id] ?? null;
    const rayHead = headAtStrike ? distToRay(ls.eye, ls.impact, headAtStrike) : null;
    const moved = headAtStrike ? distTo(headAtStrike, head) : null;
    const hs = await headState(z.id);
    if (hs?.dead) killedAt = n;
    console.log(`live swing ${n} [${ls.side}]: ray→head centre at the strike ` +
      `${rayHead === null ? '?' : (rayHead * 100).toFixed(1)} cm (head moved ${moved === null ? '?' : (moved * 100).toFixed(1)} cm); ` +
      `${struck ? `hit ${pt && headAtStrike ? (distTo(pt, headAtStrike) * 100).toFixed(0) : '?'} cm from the head centre` : 'MISS'}` +
      `${ls.magnet?.[z.id] ? ' (magnet)' : ''}; head hit ${isHead} (headHits ${ls.headHits?.[z.id] ?? 0}; model hits ${hs?.hits ?? '-'}, dead ${hs?.dead ?? '-'})`);
    // Back to idle (hit-stop on stretches the swing), then a short beat before the next click.
    for (let i = 0; i < 90 && (await state()).phase !== 'idle'; i++) await stepOne();
    await stepN(10);
    if (killedAt !== null) break;   // the head model killed: the zombie is going down, nothing left to aim at
  }
  // A kill (the head model's brain) ends the run early; the head hits must still reach LIVE_MIN.
  const ok = headHitsLive >= LIVE_MIN;
  const why = killedAt !== null ? `, the head model killed on swing ${killedAt}` : '';
  if (ok) pass(`live: ${headHitsLive}/${swings} swings at a walking zombie's head hit the head${why} (≥ ${LIVE_MIN} of ${LIVE_SWINGS})`);
  else fail(`live: ${headHitsLive}/${swings} swings at a walking zombie's head hit the head${why} (expected ≥ ${LIVE_MIN} of ${LIVE_SWINGS})`);
  await evaluate('__sdfGame.freeze(true)');
}

// ---- 12. IMPACT: the feel of a landed hit (flail-impact.ts, spec §14.1) ----------------------------
{
  const ImpactFrames = 40;   // 0.67 s at 60 Hz after the contact
  await evaluate('__sdfGame.freeze(true)');
  await evaluate('__sdfGame.flail.setHitStop(true)');
  await evaluate('__sdfGame.flail.setImpactFx(true)');
  await evaluate('__sdfGame.setFreeAim(true)');
  await evaluate('__sdfGame.setAimPoint(0, 0)');
  for (let i = 0; i < 90 && (await state()).phase !== 'idle'; i++) await stepOne();
  await stepN(40);   // past the combo window: the next click is R
  const dbg = () => evaluate('__sdfGame.flail.impactDebug()');
  // A standing zombie the crosshair can hit on the BODY: try the pool, 1.1 m out, aimed at the torso.
  let target = null;
  const traces = {};
  for (const z of pool) {
    const t = await torso(z.id);
    if (!t || t[1] < 0.7) continue;           // collapsed / gone
    const p = standOff(t, 1.1);
    const hd = Math.hypot(t[0] - p.x, t[2] - p.z);
    await place(p, Math.atan2(t[1] - EYE_H, hd));
    await evaluate('__sdfGame.setAimPoint(0, 0)');
    target = z; break;
  }
  if (!target) fail('impact: no standing zombie left to strike');
  else {
    const base = (await dbg()).cameraFov;
    // R, then L and H chained: click the next as soon as the trace is taken (inside the combo window).
    for (let n = 0; n < 3; n++) {
      const pre = await state();
      const d0 = await dbg();
      await evaluate('__sdfGame.flail.click()');
      let contactAt = null;
      const rows = [];
      for (let i = 0; i < 90; i++) {
        await stepOne();
        const d = await dbg();
        if (contactAt === null && d.contacts > d0.contacts) contactAt = i;
        if (contactAt !== null) {
          rows.push({ k: i - contactAt, scale: d.timeScale, pitch: d.pitch + d.recoilPitch, shake: d.shake, fov: d.cameraFov,
            rig: Math.hypot(...d.rig.pos), rigRot: Math.hypot(...d.rig.rot) });
          if (rows.length > ImpactFrames) break;
        }
      }
      const post = await state();
      const side = pre.nextSide;
      if (contactAt === null) { console.error(`  impact ${side}: no contact (strikes ${pre.strikes} → ${post.strikes}, hits ${JSON.stringify(post.lastStrike?.hits)})`); continue; }
      const head = (post.lastStrike?.headHits?.[target.id] ?? 0) > (pre.lastStrike?.headHits?.[target.id] ?? 0);
      traces[side] = { rows, head };
    }
    const summarise = (side) => {
      const tr = traces[side];
      if (!tr) return null;
      const r = tr.rows;
      const dtF = 1 / 60;
      const stopIdx = r.map((x, i) => (x.scale === 0.08 ? i : -1)).filter((i) => i >= 0);
      const firstSlow = stopIdx.length ? stopIdx[stopIdx.length - 1] + 1 : -1;
      const firstOne = r.findIndex((x, i) => i >= firstSlow && x.scale === 1);
      let mono = true;
      for (let i = firstSlow + 1; i <= firstOne && i < r.length; i++) if (r[i].scale < r[i - 1].scale) mono = false;
      const shakeMag = r.map((x) => Math.hypot(x.shake[0], x.shake[1]));
      const rollMag = r.map((x) => Math.abs(x.shake[2]));
      const late = (xs, sec) => Math.max(0, ...xs.filter((_, i) => r[i].k * dtF >= sec - 1e-9));
      return {
        side, head: tr.head,
        stopFrames: stopIdx.length, stopMs: stopIdx.length * dtF * 1000,
        slowStart: firstSlow >= 0 ? r[firstSlow]?.scale : null,
        slowSec: firstOne >= 0 && firstSlow >= 0 ? (firstOne - firstSlow) * dtF : null, mono,
        endScale: r[r.length - 1].scale,
        pitchPeak: Math.max(...r.map((x) => x.pitch)), pitchUnder: Math.min(...r.map((x) => x.pitch)),
        shakePeak: Math.max(...shakeMag), shakeLate: late(shakeMag, 0.35),
        rollPeak: Math.max(...rollMag), rollLate: late(rollMag, 0.35),
        fovMin: Math.min(...r.map((x) => x.fov)), fovLate: late(r.map((x) => Math.abs(x.fov - base)), 0.3),
        fovMinAt: r[r.map((x) => x.fov).indexOf(Math.min(...r.map((x) => x.fov)))].k * dtF,
        rigPeak: Math.max(...r.map((x) => x.rig)), rigRotPeak: Math.max(...r.map((x) => x.rigRot)),
        rigEnd: r[r.length - 1].rig, rigRotEnd: r[r.length - 1].rigRot,
        trace: r,
      };
    };
    const R = summarise('R'), Hs = summarise('H'), L = summarise('L');
    for (const m of [R, L, Hs]) {
      if (!m) continue;
      console.log(`impact ${m.side}${m.head ? ' (head)' : ''}: hit-stop ${m.stopFrames} frames (${m.stopMs.toFixed(1)} ms) at 0.08; ` +
        `slow tail from ${m.slowStart?.toFixed(3)} to 1.0 in ${m.slowSec?.toFixed(3)} s (monotone ${m.mono}); ` +
        `pitch kick peak ${m.pitchPeak.toFixed(4)} rad, overshoot ${m.pitchUnder.toFixed(4)}; ` +
        `judder peak ${(m.shakePeak * 1000).toFixed(2)} mm → ${(m.shakeLate * 1000).toFixed(3)} mm from 0.35 s; ` +
        `roll peak ${(m.rollPeak * 180 / Math.PI).toFixed(3)}° → ${(m.rollLate * 180 / Math.PI).toFixed(4)}°; ` +
        `FOV ${base.toFixed(2)}° → min ${m.fovMin.toFixed(3)}° at ${(m.fovMinAt * 1000).toFixed(0)} ms, |Δ| from 0.3 s ${m.fovLate.toFixed(4)}°; ` +
        `rig kick peak ${(m.rigPeak * 100).toFixed(2)} cm / ${(m.rigRotPeak * 180 / Math.PI).toFixed(2)}°, end ${(m.rigEnd * 1000).toFixed(3)} mm / ${(m.rigRotEnd * 180 / Math.PI).toFixed(4)}°`);
    }
    if (R) {
      console.log(`impact R per frame (k: scale pitch judder-mm fov rig-cm): ${R.trace.slice(0, 30).map((x) =>
        `${x.k}:${x.scale.toFixed(3)} ${x.pitch.toFixed(4)} ${(Math.hypot(x.shake[0], x.shake[1]) * 1000).toFixed(2)} ${x.fov.toFixed(2)} ${(x.rig * 100).toFixed(2)}`).join(' | ')}`);
      if (R.head) console.error('  impact: the R hit landed on the head (expected a body hit)');
      if (R.stopFrames >= 4 && R.stopFrames <= 5) pass(`impact: hit-stop at 0.08 for ${R.stopFrames} frames (${R.stopMs.toFixed(0)} ms; 70 ms asked)`);
      else fail(`impact: hit-stop ${R.stopFrames} frames at 0.08 (expected 4–5 for 70 ms)`);
      if (R.mono && R.endScale === 1 && R.slowSec !== null && R.slowSec <= 0.3 + 1 / 60 + 1e-9 && Math.abs(R.slowStart - 0.4) < 1e-9)
        pass(`impact: the slow tail steps to ${R.slowStart} and eases monotonically to exactly 1.0 in ${R.slowSec.toFixed(3)} s (≤ 0.3 s + a frame)`);
      else fail(`impact: slow tail start ${R.slowStart}, ${R.slowSec} s, monotone ${R.mono}, end ${R.endScale}`);
      if (R.pitchPeak >= 0.04) pass(`impact: camera pitch kick peak ${R.pitchPeak.toFixed(4)} rad (≥ 0.04)`);
      else fail(`impact: camera pitch kick peak ${R.pitchPeak.toFixed(4)} rad (< 0.04)`);
      if (R.shakePeak > 0 && R.shakeLate < 0.1 * R.shakePeak && R.rollLate < 0.1 * R.rollPeak)
        pass(`impact: the judder decays to ${(100 * R.shakeLate / R.shakePeak).toFixed(2)}% (roll ${(100 * R.rollLate / R.rollPeak).toFixed(2)}%) of its peak by 0.35 s (< 10%)`);
      else fail(`impact: judder ${R.shakeLate} of ${R.shakePeak}, roll ${R.rollLate} of ${R.rollPeak} from 0.35 s`);
      if (R.fovMin <= base - 2 && R.fovLate < 0.05) pass(`impact: FOV pinched to ${R.fovMin.toFixed(3)}° and back within ${R.fovLate.toFixed(4)}° of ${base}° by 0.3 s`);
      else fail(`impact: FOV min ${R.fovMin}, |Δ| from 0.3 s ${R.fovLate} (base ${base})`);
      if (R.rigPeak > 0.05 && R.rigEnd < 1e-3 && R.rigRotEnd < 0.2 * Math.PI / 180)
        pass(`impact: the rig kick (${(R.rigPeak * 100).toFixed(1)} cm peak) returns to rest (${(R.rigEnd * 1000).toFixed(3)} mm at ${(ImpactFrames / 60).toFixed(2)} s)`);
      else fail(`impact: rig kick peak ${R.rigPeak}, end ${R.rigEnd} m / ${R.rigRotEnd} rad`);
    } else fail('impact: the R swing made no contact');
    if (R && Hs) {
      const ok = Hs.pitchPeak > R.pitchPeak && Hs.fovMin < R.fovMin && Hs.rigPeak > R.rigPeak && Hs.stopFrames >= R.stopFrames;
      if (ok) pass(`impact: H > R (pitch ${Hs.pitchPeak.toFixed(4)} > ${R.pitchPeak.toFixed(4)}, FOV ${Hs.fovMin.toFixed(2)} < ${R.fovMin.toFixed(2)}, rig ${(Hs.rigPeak * 100).toFixed(1)} > ${(R.rigPeak * 100).toFixed(1)} cm, hit-stop ${Hs.stopFrames} ≥ ${R.stopFrames} frames)`);
      else fail(`impact: H not above R (H ${JSON.stringify({ p: Hs.pitchPeak, f: Hs.fovMin, r: Hs.rigPeak, s: Hs.stopFrames })}, R ${JSON.stringify({ p: R.pitchPeak, f: R.fovMin, r: R.rigPeak, s: R.stopFrames })})`);
    } else fail(`impact: no H contact to compare (sides traced: ${Object.keys(traces).join(', ')})`);
  }
  await evaluate('__sdfGame.flail.setImpactFx(false)');
  await evaluate('__sdfGame.flail.setHitStop(false)');
}

// ---- 13. BLOOD on the flail (flail-blood.ts, spec §14.1 item 7) ---------------------------------------
// Hit-stop and fx off (the other sections' state). From 0, three R body hits (a pause past the combo window
// between them, so each is R): +0.12 each (a head hit would add 0.156 and fails here), drying at a 120 s time
// constant over the ~3 s they take. Then set 1 and step 10 s of simulated time: exp(−10/120) = 0.920.
{
  await evaluate('__sdfGame.freeze(true)');
  await evaluate('__sdfGame.setFreeAim(true)');
  await evaluate('__sdfGame.setAimPoint(0, 0)');
  for (let i = 0; i < 90 && (await state()).phase !== 'idle'; i++) await stepOne();
  await stepN(30);
  let target = null;
  for (const z of pool) {
    const t = await torso(z.id);
    if (!t || t[1] < 0.7) continue;
    target = z; break;
  }
  if (!target) fail('blood: no standing zombie left to strike');
  else {
    await evaluate('__sdfGame.flail.setBlood(0)');
    const levels = [];
    let heads = 0, frames = 0;
    for (let n = 0; n < 3; n++) {
      const t = await torso(target.id);
      const p = standOff(t, 1.2);
      await place(p, Math.atan2(t[1] - EYE_H, Math.hypot(t[0] - p.x, t[2] - p.z)));
      await evaluate('__sdfGame.setAimPoint(0, 0)');
      frames++;
      const pre = await state();
      const samples = await swing(SWING_FRAMES);
      frames += SWING_FRAMES;
      const post = await state();
      if (!post.lastStrike?.hits?.includes(target.id)) console.error(`  blood: swing ${n + 1} (${samples.side}) missed #${target.id}`);
      if ((post.lastStrike?.headHits?.[target.id] ?? 0) > (pre.lastStrike?.headHits?.[target.id] ?? 0)) heads++;
      levels.push(post.blood);
      await stepN(30); frames += 30;   // > comboWindowSec: the next click is R again
    }
    const end = (await state()).blood;
    const secs = frames / 60;
    const lo = 0.36 * Math.exp(-secs / 120), hi = 0.36;
    console.log(`blood: after hits ${levels.map((v) => v.toFixed(4)).join(' → ')}; ${end.toFixed(4)} after ${secs.toFixed(2)} s (expected ${lo.toFixed(4)}–${hi.toFixed(4)}); head hits ${heads}`);
    const steps = levels.map((v, i) => v - (i ? levels[i - 1] : 0));
    if (heads === 0 && end >= lo - 1e-4 && end <= hi && steps.every((d) => d > 0.11 && d < 0.121))
      pass(`blood: 3 body hits raise it to ${end.toFixed(4)} (0.36 less ${secs.toFixed(1)} s of drying; steps ${steps.map((d) => d.toFixed(4)).join(', ')})`);
    else fail(`blood: 3 body hits → ${end.toFixed(4)} (steps ${steps.map((d) => d.toFixed(4)).join(', ')}, head hits ${heads}; expected ${lo.toFixed(4)}–${hi})`);
    await evaluate('__sdfGame.flail.setBlood(1)');
    for (let i = 0; i < 6; i++) await evaluate('__sdfGame.step(100, 1 / 60)', 300000);
    const dried = (await state()).blood;
    const want = Math.exp(-10 / 120);
    if (Math.abs(dried - want) < 0.003) pass(`blood: dries on simulated time: 1 → ${dried.toFixed(4)} over 10 s (exp(−10/120) = ${want.toFixed(4)})`);
    else fail(`blood: 1 → ${dried.toFixed(4)} over 10 s of simulated time (expected ${want.toFixed(4)})`);
    await evaluate('__sdfGame.flail.setBlood(0)');
  }
}

// ---- 14. FLESH: every hit throws wet flesh bits (flesh-bits.ts, v1.5b Task 32) ------------------------
{
  const FLESH_OUT = 'docs/dev-notes/2026-09-28-head-damage/flesh';
  const FLESH_CAP = 10;
  mkdirSync(FLESH_OUT, { recursive: true });
  const tags = async () => { const t = await evaluate('__sdfGame.flail.chunkTags()'); delete t.fleshAt; return t; };
  await evaluate('__sdfGame.freeze(true)');
  await evaluate('__sdfGame.setFreeAim(true)');
  await evaluate('__sdfGame.setAimPoint(0, 0)');
  await evaluate(`__sdfGame.setBleed(${process.env.FLESH_BLEED !== '0'})`);
  for (let i = 0; i < 90 && (await state()).phase !== 'idle'; i++) await stepOne();
  await stepN(30);
  const acts = await evaluate('__sdfGame.actorList()');
  const cands = [];
  for (const z of pool) {
    const a = acts.find((q) => q.id === z.id);
    const t = await torso(z.id);
    const hs = await evaluate(`__sdfGame.head.state(${z.id})`);
    if (!a || a.phase !== 'standing' || !t || t[1] < 0.7) continue;
    if ((await evaluate(`__sdfGame.flail.limbAlive(${z.id}, 'head')`)) <= 0 || hs?.dead) continue;
    cands.push({ z, hits: hs?.hits ?? 0 });
  }
  cands.sort((a, b) => a.hits - b.hits);
  const target = cands[0]?.z;
  if (!target) fail('flesh: no standing zombie with a head left');
  else {
    console.log(`flesh: zombie #${target.id} (${cands.length} candidates)`);
    await evaluate('__sdfGame.flail.setFleshBits(true)');
    /** One click at the torso or the head from `dist`, then an 8-frame strip (0.1 s apart) cropped round the hit. */
    const strike = async (what, dist, strip) => {
      const c = what === 'head' ? await evaluate(`__sdfGame.actorLimbCenter(${target.id}, 'head')`) : await torso(target.id);
      const p = standOff(c, dist);
      await place(p, Math.atan2(c[1] - EYE_H, dist));
      await evaluate('__sdfGame.setAimPoint(0, 0)');
      for (let i = 0; i < 40 && (await state()).phase !== 'idle'; i++) await stepOne();
      await stepN(24);   // past the combo window: the next click is R
      const t0 = await tags();
      const pre = await state();
      await evaluate('__sdfGame.flail.click()');
      let st = pre;
      for (let f = 0; f < 60 && st.strikes === pre.strikes; f++) { await stepOne(); st = await state(); }
      const t1 = await tags();
      const hit = st.lastStrike?.hits?.includes(target.id);
      const head = (st.lastStrike?.headHits?.[target.id] ?? 0) > (pre.lastStrike?.headHits?.[target.id] ?? 0);
      const at = st.lastStrike?.points?.[target.id] ?? c;
      const frames = [];
      if (strip) {
        const cp = await toPx(at);
        for (let k = 0; k < 8; k++) {
          if (k > 0) await stepN(6);
          frames.push(await capture(null));
        }
        // A 960x600 crop round the hit (wide: the bits fly ~0.5 m in 0.2 s), shown at 1/1.5 (640x400 tiles).
        const CW = 960, CH = 600, DS = 1.5, TW = CW / DS, TH = CH / DS;
        const cx = Math.round(Math.min(Math.max((cp?.[0] ?? W / 2) - CW / 2, 0), W - CW));
        const cy = Math.round(Math.min(Math.max((cp?.[1] ?? H / 2) - CH * 0.45, 0), H - CH));
        const SW = TW * 4, SH = TH * 2, rgba = new Uint8Array(SW * SH * 4);
        frames.forEach((img, k) => {
          const ox = (k % 4) * TW, oy = Math.floor(k / 4) * TH;
          for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
            const sx = cx + Math.round(x * DS), sy = cy + Math.round(y * DS);   // cp (toPx) is already in page px
            const q = px(img, Math.min(img.w - 1, sx), Math.min(img.h - 1, sy));
            const o = ((oy + y) * SW + ox + x) * 4;
            rgba[o] = q[0]; rgba[o + 1] = q[1]; rgba[o + 2] = q[2]; rgba[o + 3] = 255;
            if (x < 2 || y < 2) { rgba[o] = rgba[o + 1] = rgba[o + 2] = 0; }
          }
        });
        writeFileSync(`${FLESH_OUT}/${strip}${process.env.FLESH_SUFFIX ?? ''}.png`, writePng(SW, SH, rgba));
        console.log(`  shot ${FLESH_OUT}/${strip}.png (crop at ${cx},${cy}; hit px ${cp ? cp.map(Math.round).join(',') : 'off'})`);
      }
      return { side: pre.nextSide, hit, head, added: t1.flesh - t0.flesh, t0, t1 };
    };
    const body = await strike('body', 1.5, 'flesh-body-strip');
    console.log(`flesh: body hit (${body.side}) hit ${body.hit} head ${body.head}: flesh ${body.t0.flesh} -> ${body.t1.flesh}; ${JSON.stringify(body.t1)}`);
    const bodyRange = body.side === 'H' ? [5, 8] : [3, 5];
    if (body.hit && !body.head && body.added >= bodyRange[0] && body.added <= bodyRange[1]) pass(`flesh: an ${body.side} body hit throws ${body.added} flesh bits (${bodyRange.join('–')})`);
    else fail(`flesh: body hit (${body.side}, hit ${body.hit}, head ${body.head}) threw ${body.added} flesh bits (${bodyRange.join('–')})`);
    await stepN(30);
    const headR = await strike('head', 1.3, 'flesh-head-strip');
    console.log(`flesh: head hit (${headR.side}) hit ${headR.hit} head ${headR.head}: flesh ${headR.t0.flesh} -> ${headR.t1.flesh}; ${JSON.stringify(headR.t1)}`);
    const headRange = headR.side === 'H' ? [8, 11] : [5, 7];
    // Over the cap the oldest bits give way: the count can rise by less than was thrown, never past the cap.
    const headWant = Math.min(headRange[0], FLESH_CAP - headR.t0.flesh);
    if (headR.hit && headR.head && headR.added >= headWant && headR.added <= headRange[1] && headR.t1.flesh <= FLESH_CAP) pass(`flesh: an ${headR.side} head hit throws ${headR.added} more live flesh bits (${headRange.join('–')}, cap ${FLESH_CAP})`);
    else fail(`flesh: head hit (${headR.side}, hit ${headR.hit}, head ${headR.head}) added ${headR.added} flesh bits (${headRange.join('–')})`);
    // Ten more hits (the cap and the budget), then the cost with the bits live.
    await stepN(30);
    const c0 = await torso(target.id);
    await place(standOff(c0, 1.5), Math.atan2(c0[1] - EYE_H, 1.5));
    await evaluate('__sdfGame.setAimPoint(0, 0)');
    await stepN(3); await capture(null);
    const base1 = await evaluate('__sdfGame.timeDraws(120)', 300000);
    const base2 = await evaluate('__sdfGame.timeDraws(120)', 300000);
    const before = await tags();
    let maxFlesh = 0, maxViews = 0, hits10 = 0;
    for (let n = 0; n < 10; n++) {
      const r = await strike(n % 3 === 2 ? 'head' : 'body', 1.4, null);
      if (r.hit) hits10++;
      for (let k = 0; k < 12; k++) {
        const t = await tags();
        maxFlesh = Math.max(maxFlesh, t.flesh); maxViews = Math.max(maxViews, t.views);
        if (k === 0) console.log(`  flesh hit ${n + 1} (${r.side}, ${r.head ? 'head' : 'body'}${r.hit ? '' : ', MISS'}): ${JSON.stringify(t)}`);
        await stepOne();
      }
    }
    const after = await tags();
    console.log(`flesh: 10 hits (${hits10} landed): before ${JSON.stringify(before)}; after ${JSON.stringify(after)}; max live flesh ${maxFlesh}, max views ${maxViews}`);
    if (maxFlesh <= FLESH_CAP && after.flesh === FLESH_CAP) pass(`flesh: live flesh bits capped at ${FLESH_CAP} over 10 hits (max ${maxFlesh}, ${after.flesh} after)`);
    else fail(`flesh: live flesh max ${maxFlesh}, after ${after.flesh} (cap ${FLESH_CAP}, expected full)`);
    if (maxViews <= after.max) pass(`flesh: chunk views stay within the budget (max ${maxViews} <= ${after.max})`);
    else fail(`flesh: chunk views ${maxViews} over the budget ${after.max}`);
    await place(standOff(c0, 1.5), Math.atan2(c0[1] - EYE_H, 1.5));
    await evaluate('__sdfGame.setAimPoint(0, 0)');
    await stepN(3); await capture(null);
    const live = await tags();
    const with1 = await evaluate('__sdfGame.timeDraws(120)', 300000);
    const with2 = await evaluate('__sdfGame.timeDraws(120)', 300000);
    console.log(`flesh cost: draw time (median of 120, fenced) before ${base1.toFixed(2)} / ${base2.toFixed(2)} ms (noise ${Math.abs(base1 - base2).toFixed(2)}); with ${live.flesh} flesh bits live ${with1.toFixed(2)} / ${with2.toFixed(2)} ms; delta ${((with1 + with2) / 2 - (base1 + base2) / 2).toFixed(2)} ms`);
    // Life: 16 s of simulated time later every bit has shrunk away.
    for (let i = 0; i < 10; i++) await evaluate('__sdfGame.step(96, 1 / 60)', 300000);
    const gone = await tags();
    await place(standOff(c0, 1.5), Math.atan2(c0[1] - EYE_H, 1.5));
    await evaluate('__sdfGame.setAimPoint(0, 0)');
    await stepN(3); await capture(null);
    const after1 = await evaluate('__sdfGame.timeDraws(120)', 300000);
    const after2 = await evaluate('__sdfGame.timeDraws(120)', 300000);
    console.log(`flesh cost: the same stand after the bits are gone ${after1.toFixed(2)} / ${after2.toFixed(2)} ms; with vs after ${((with1 + with2) / 2 - (after1 + after2) / 2).toFixed(2)} ms`);
    if (gone.flesh === 0) pass(`flesh: every flesh bit is gone 16 s later (FLESH_BITS.lifeS 8): ${JSON.stringify(gone)}`);
    else fail(`flesh: ${gone.flesh} flesh bits still live 16 s later`);
    await evaluate('__sdfGame.flail.setFleshBits(false)');
  }
}

// ---- 10. Console -------------------------------------------------------------------------
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception' || e.type === 'assert');
if (errs.length === 0) pass('zero console errors or exceptions');
else fail(`console errors: ${JSON.stringify(errs).slice(0, 2000)}`);
const warns = consoleEvents.filter((e) => e.type === 'warning' && /flail/i.test(e.text));
if (warns.length) console.log(`flail warnings: ${JSON.stringify(warns).slice(0, 1000)}`);

console.log(failures === 0 ? 'GATE PASSED' : `GATE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
