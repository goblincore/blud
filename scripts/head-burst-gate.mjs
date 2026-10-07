// scripts/head-burst-gate.mjs — what a gun round does to a zombie's head (head-burst.ts headShotRule,
// decapitationRule; webgpu/game-head-shot.ts; the actor's pop). REAL rounds through __sdfGame.fire() and fireSlug()
// on the bare ring page (/sdf-game.html, no ?level), frozen zombies, three boots.
//
// BOOT 1, the shipped rules (the default skull, the anatomical one):
//   NP. pellet volleys on a head never open or split it: ordinary craters, no split, no head-leaf state, the head on.
//   AIM. a slug fired with the crosshair on the head (no stance solving) is CENTRED by the shipped splitFrac and
//       splits the head.
//   O.  (splitFrac 0.35 from here, so "off centre" can be staged) an off-centre slug is an ORDINARY slug wound.
//   S.  a centred slug SPLITS the head: the head split's state at the preset's full angle (both halves, or the one
//       the slug landed on: the split's own rule), the pose's split turned that far, the skull drawn as clipped
//       copies, the field open where a half was, its cut faces, the zombie alive.
//   X.  a second centred slug on the split head POPS it.
//   OFF. burstTune({ on: false }): a centred slug is an ordinary wound.
// BOOT 1b, the pop on a page of its own:
//   D.  slugs at the neck until the head comes off: the head SWELLS for popSwellS and bursts, no flying head; the
//       anatomical skull's fourteen plates are all released as fragments, the head segment and its eyes are not
//       drawn, and 2.5 s on nothing is left at the old head position.
//   D0. popSwellS 0 bursts with no swell frame.
// BOOT 2, the OPENING switched on by tuning (the slug head burst of 2026-10-02, not shipped): the scenarios this
// gate had before 2026-10-07, unchanged but for `opening: true` in their tuning:
//   P. with anyWeapon and alwaysSplit a pellet volley on a head opens it, once per shot.
//   A. a dead-centre slug is LETHAL (lethal on): head dead, verdict lethal with offset < 0.35, a burst-exit crater,
//      the swell peaks (bu.b >= 0.2 within 8 frames) and settles to rest, chunks thrown, flaps drawn, the head still
//      on, the zombie collapses when thawed.
//   B. an off-centre slug is GLANCING: not dead, offset >= 0.35, a skull region cracked >= 0.8, no exit crater, flaps
//      drawn, still standing when thawed; a SECOND slug at the same spot then kills.
//   S. with lethal off a centred slug opens the head through and the zombie lives, no flaps, and survives the third.
//   D. burstTune({ on: false }) leaves the head with no burst state.
//   C. the flaps of a head share ONE attached piece (draws === 1). Frame time is reported, not gated.
// BOOT 3, the SCULPTED skull (`?sculpt=full`):
//   DS. the decapitating slug pops the head: the sculpted head mesh is thrown as ten fragments (sculpt-fragments.ts),
//       the head segment and its eyes are not drawn, nothing is left at the old head position.
// E. zero console errors / exceptions, over all three.
// Photos are written to OUT for the look loop. Usage:
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   node scripts/head-burst-gate.mjs 5241 9241
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const OUT = process.env.OUT ?? "docs/dev-notes/2026-10-02-head-burst/gate";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62, STAND = 0.9, PHOTO_D = 0.55, SHOT_D = 2;
const CENTRE_FRAC = 0.35, SWELL_PEAK_MIN = 0.2, SHARD_CHUNKS_MIN = 8, GLANCE_SHIFT = 0.07;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const results = [];
const fail = (msg) => { console.error(`FAIL: ${msg}`); results.push(`FAIL: ${msg}`); failures++; };
const pass = (msg) => { console.log(`PASS: ${msg}`); results.push(`PASS: ${msg}`); };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const note = (msg) => console.log(`  measure: ${msg}`);
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
const f2 = (v) => v.map((c) => c.toFixed(3)).join(", ");
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
mkdirSync(OUT, { recursive: true });

// ---- A CDP session (a tab), one at a time ---------------------------------------------
let S = null;
const consoleEvents = [];
async function openSession(label) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), label, rect: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      consoleEvents.push({ label, type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
    }
    if (m.method === "Runtime.exceptionThrown") consoleEvents.push({ label, type: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  };
  s.send = (method, params = {}) => new Promise((resolve) => { const id = ++s.seq; s.pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  S = s;
  return s;
}
function closeSession(s) {
  try { s.ws.close(); } catch {}
  try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${s.tab.id}`], { stdio: "ignore" }); } catch {}
}
process.on("exit", () => { if (S) closeSession(S); });
const send = (m, p) => S.send(m, p);
const evaluate = async (expression, ms = 90000) => {
  const r = await withTimeout(S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// ---- PNG decode / encode ----------------------------------------------------------------
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8);
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
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function encodePng(w, h, rgb) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** A w x h RGB crop of `img` centred on (cx, cy) (out-of-frame pixels black). */
function cropRgb(img, cx, cy, w, h) {
  const out = Buffer.alloc(w * h * 3); const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
    const c = px(img, sx, sy); const o = (y * w + x) * 3; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  }
  return out;
}

const ndcPx = (n) => [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h];
/** Screenshots lag hand-stepped frames by one: lock the sim, re-render twice, then shoot. The lock keeps the sim
 *  still (renderLock), so a capture never advances a frame. */
async function capture(name) {
  await evaluate("__sdfGame.setRenderLock(true)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  const s = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const buf = Buffer.from(s.result.data, "base64");
  if (name) { writeFileSync(`${OUT}/${name}.png`, buf); console.log(`  shot ${OUT}/${name}.png`); }
  return Object.assign(decodePng(buf), { buf });
}
// ---- Boot the bare ring page, frozen zombies -----------------------------------------------------------
let centre = [0, 0, 0], pool = [], usedZ = new Set();
async function boot(label, query = "") {
  usedZ = new Set();
  const s = await openSession(label);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off&loader=0${query}` });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") die(`[${label}] backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") die(`[${label}] warm gate never reached ready`);
  await evaluate("__sdfGame.setLoopRunning(false)");
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  await evaluate("__sdfGame.setFreeAim(true)");
  await evaluate("__sdfGame.setAimPoint(0, 0)");
  for (let i = 0; i < 90; i++) await evaluate("__sdfGame.step(1, 1 / 60)");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie");
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM);
  const room = (await evaluate("__sdfGame.rooms")).find((r) => r.id === ROOM);
  centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
  // Attached pieces (the flaps) are not drawn until the background gib warm is ready: wait for it.
  let wb = null;
  for (let i = 0; i < 400; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" || wb.gib === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 1 / 60)"); }
  if (wb?.gib !== "ready") die(`[${label}] the background gib warm is ${JSON.stringify(wb)}: attached pieces would never draw`);
  console.log(`[${label}] ready; room ${ROOM} (${pool.length} zombies)`);
}
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
const headOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "head")`);
const hstate = (id) => evaluate(`__sdfGame.head.state(${id})`);
function fresh() { const z = pool.find((q) => !usedZ.has(q.id)); if (!z) die("ran out of fresh zombies"); usedZ.add(z.id); return z; }
/** PHOTO stance: `dist` m in front of the head toward the room centre (no aim solving). */
async function stand(id, dist, shift = 0) {
  const fr = await evaluate(`__sdfGame.head.frame(${id})`);
  const head = fr.centre;
  const ax = centre[0] - head[0], az = centre[2] - head[2], l = Math.hypot(ax, az) || 1;
  const fx = ax / l, fz = az / l;
  const x = head[0] + fx * dist + fz * shift, z = head[2] + fz * dist - fx * shift;
  await evaluate(`__sdfGame.placePlayer({ x: ${x}, z: ${z}, yaw: ${yawOf(-fx, -fz)}, pitch: ${Math.atan2(head[1] - EYE_H, dist)} })`);
  await stepOne();
  await evaluate("__sdfGame.setAimPoint(0, 0)");
  return head;
}
/** SHOT stance. The muzzle sits ~0.6 m right of the aim axis, the slug converges on what the crosshair hits, and it DROPS
 *  under SLUG.gravity (-6 m/s^2 at 30 m/s: ~1.3 cm over 2 m), so the stance is SOLVED, not assumed: from `dist` m in front
 *  of the head, slide sideways and tilt the pitch until the slug's real line (predictSlugHit: muzzle, convergence, trace;
 *  plus the analytic drop) passes `off` m beside the head centre (sideways = horizontal, perpendicular to the view) at the
 *  head's height. Only the sideways slide and the pitch move: moving along the view changes the line's obliqueness.
 *  Returns the head centre and the line's offset as a share of the head radius (head-burst.ts's own measure). */
const SLUG_SPEED = 30, SLUG_GRAVITY = 6;
async function aimLine(id, dist, off = 0) {
  await ready();
  const fr = await evaluate(`__sdfGame.head.frame(${id})`);
  const head = fr.centre, R = Math.cbrt(fr.axes[0] * fr.axes[1] * fr.axes[2]);
  const ax = centre[0] - head[0], az = centre[2] - head[2], l = Math.hypot(ax, az) || 1;
  const fx = ax / l, fz = az / l;
  const side = [fz, 0, -fx];
  const yaw = yawOf(-fx, -fz);
  let slide = off, pitch = Math.atan2(head[1] - EYE_H, dist), cp = [0, 0, 0], pr = null, errSide = 1, errUp = 1;
  for (let i = 0; i < 12; i++) {
    const x = head[0] + fx * dist + side[0] * slide, z = head[2] + fz * dist + side[2] * slide;
    await evaluate(`__sdfGame.placePlayer({ x: ${x}, z: ${z}, yaw: ${yaw}, pitch: ${pitch} })`);
    await stepOne();
    await evaluate("__sdfGame.setAimPoint(0, 0)");
    pr = await evaluate("__sdfGame.predictSlugHit()");
    const o = pr.origin, d = pr.dir;
    const t = (head[0] - o[0]) * d[0] + (head[1] - o[1]) * d[1] + (head[2] - o[2]) * d[2];
    const drop = 0.5 * SLUG_GRAVITY * (Math.max(0, t) / SLUG_SPEED) ** 2;
    cp = [o[0] + d[0] * t, o[1] + d[1] * t - drop, o[2] + d[2] * t];
    const perp = [cp[0] - head[0], cp[1] - head[1], cp[2] - head[2]];
    errSide = off - (perp[0] * side[0] + perp[2] * side[2]);
    errUp = -perp[1];
    if (process.env.DEBUG_AIM) console.log(`  aim it ${i}: slide ${slide.toFixed(3)} pitch ${pitch.toFixed(3)} t ${t.toFixed(2)} drop ${drop.toFixed(3)} errSide ${errSide.toFixed(4)} errUp ${errUp.toFixed(4)}`);
    if (Math.abs(errSide) < 0.003 && Math.abs(errUp) < 0.003) break;
    slide += errSide; pitch += errUp / Math.max(0.5, t);
  }
  const perpLen = Math.hypot(cp[0] - head[0], cp[1] - head[1], cp[2] - head[2]);
  const offset = perpLen / R;
  note(`aimLine off ${off} m at ${dist} m: the slug's line (drop included) passes ${offset.toFixed(3)} head radii from the head centre; would hit actor ${pr.actorId}`);
  if (Math.abs(errSide) > 0.006 || Math.abs(errUp) > 0.006) fail(`aim control: aimLine did not converge for actor ${id} (off ${off}): side ${errSide.toFixed(4)} up ${errUp.toFixed(4)}`);
  if (pr.actorId !== id) fail(`aim control: the slug would hit actor ${pr.actorId}, not ${id}`);
  return { head, offset };
}
/** One REAL slug; retries across a reload (the magazine may be empty). Returns the head state a few frames on. */
async function slug(id, frames, perFrame) {
  let fired = false;
  for (let i = 0; i < 4 && !fired; i++) {
    fired = await evaluate("__sdfGame.fireSlug()");
    if (!fired) await stepN(90);
  }
  if (!fired) die("fireSlug() never fired (reload?)");
  const series = [];
  for (let k = 0; k < frames; k++) {
    await stepOne();
    const hs = await hstate(id);
    series.push(hs);
    await perFrame?.(k, hs);
  }
  return series;
}
const chunks = () => evaluate("__sdfGame.chunkCount");

const out = {};
const tune = (o) => evaluate(`__sdfGame.head.burstTune(${JSON.stringify(o)})`);
const TUNING_DEFAULTS = {};
/** The player `dist` m in front of actor `id`'s head with the crosshair `aim` from its centre: an aimed shot, the
 *  stance not solved. Returns where a slug fired now would go (its line's offset in head radii, drop included). */
async function crosshairOn(id, dist, aim = [0, 0, 0], yawDeg = null) {
  await ready();
  const fr = await evaluate(`__sdfGame.head.frame(${id})`);
  const head = fr.centre, R = Math.cbrt(fr.axes[0] * fr.axes[1] * fr.axes[2]);
  let ax = centre[0] - head[0], az = centre[2] - head[2];
  if (yawDeg !== null) {
    // `yawDeg` round the head from straight in front of its face (the head frame's forward), not from the room.
    const [qx, qy, qz, qw] = fr.quat, f = [2 * (qx * qz + qw * qy), 0, 1 - 2 * (qx * qx + qy * qy)], a = yawDeg * Math.PI / 180;
    ax = f[0] * Math.cos(a) + f[2] * Math.sin(a); az = -f[0] * Math.sin(a) + f[2] * Math.cos(a);
  }
  const l = Math.hypot(ax, az) || 1;
  const fx = ax / l, fz = az / l;
  const t = [head[0] + aim[0], head[1] + aim[1], head[2] + aim[2]];
  await evaluate(`__sdfGame.placePlayer({ x: ${t[0] + fx * dist}, z: ${t[2] + fz * dist}, yaw: ${yawOf(-fx, -fz)}, pitch: ${Math.atan2(t[1] - EYE_H, dist)} })`);
  await stepOne();
  await evaluate("__sdfGame.setAimPoint(0, 0)");
  const pr = await evaluate("__sdfGame.predictSlugHit()");
  const o = pr.origin, d = pr.dir;
  const tt = (head[0] - o[0]) * d[0] + (head[1] - o[1]) * d[1] + (head[2] - o[2]) * d[2];
  const drop = 0.5 * SLUG_GRAVITY * (Math.max(0, tt) / SLUG_SPEED) ** 2;
  const cp = [o[0] + d[0] * tt, o[1] + d[1] * tt - drop, o[2] + d[2] * tt];
  return { head, offset: Math.hypot(cp[0] - head[0], cp[1] - head[1], cp[2] - head[2]) / R, actor: pr.actorId };
}
const headOn = async (id) => (await evaluate(`__sdfGame.flail.limbAlive(${id}, "head")`)) > 0;
const shotOf = (id) => evaluate(`__sdfGame.head.shot(${id})`);
const splitOf = (id) => evaluate(`__sdfGame.headSplit(${id})`);
const headWounds = async (id) => (await evaluate(`__sdfGame.actorWounds(${id})`)).filter((w) => w.limb === "head");
const fragments = () => evaluate("__sdfGame.skullFragments().length");
/** What is drawn within `r` m of `c` that belongs to a head: actor `id`'s bone and eye instances at or over the
 *  chin's height (the collar bones sit lower), attached pieces, flying and settled chunks, mesh gibs, head flesh. */
async function nearHead(id, c, r = 0.25) {
  const n = await evaluate(`__sdfGame.head.drawnNear(${c[0]}, ${c[1]}, ${c[2]}, ${r})`);
  const up = (q) => q.pos[1] > c[1] - 0.12;
  return { bones: n.bones.filter((b) => b.owner === id && !b.eye && up(b)).length, eyes: n.bones.filter((b) => b.owner === id && b.eye).length,
    attached: n.attached.length, chunks: n.chunks.length, baked: n.baked.length, meshGibs: n.meshGibs.length, flesh: n.flesh.filter((f) => f.actor === id).length };
}
/** THE GUN IS READY before a shot is aimed: full shells (no reload) and the last shot's kick played out. A stance is
 *  solved for where the muzzle is NOW; a slug fired out of a reload or a kick leaves from somewhere else (a third
 *  slug fired after a reload ran 0.49 head radii off a line solved to 0.03). */
async function ready() {
  // A reload in progress refuses fire() even with full shells: wait one out (its length is the game's own number).
  const frames = Math.ceil((await evaluate("__sdfGame.reloadTotalSec")) * 60) + 12;
  await evaluate("__sdfGame.refillShells()"); await stepN(frames); await evaluate("__sdfGame.refillShells()");
}
/** One REAL slug at actor `id`, watched for `frames` frames: on which frames its head was swelling, when it left, and
 *  the most skull fragments in the air. */
async function watchSlug(id, frames) {
  const fired = await evaluate("__sdfGame.fireSlug()");
  if (!fired) die("fireSlug() did not fire at once: the stance was solved for a gun that was not ready");
  const f0 = await fragments();
  const swell = []; let off = -1, limbChunks = 0;
  for (let k = 0; k < frames; k++) {
    await stepOne();
    if (await evaluate(`__sdfGame.head.popping(${id})`)) swell.push(k);
    if (off < 0 && !(await headOn(id))) off = k;
  }
  return { swell, off, fragments: (await fragments()) - f0, limbChunks };
}
/** THE POP's checks on actor `id` after slugs at its neck (the crosshair 6 cm under the head's centre, from 40 degrees
 *  to one side of its face: one to four slugs cut a frozen zombie's neck from there). `want`: the
 *  skull fragments the pop must throw (null: only "some"). */
async function popByNeckSlugs(tag, id, want, bonesWhole) {
  const swellS = (await evaluate("__sdfGame.head.burstTuning()")).popSwellS;
  let r = null, n = 0, centreAt = null;
  const flying0 = await evaluate("__sdfGame.chunkStats().livePieces.length");
  for (n = 1; n <= 8; n++) {
    const aim = await crosshairOn(id, SHOT_D, [0, -0.06, 0], 40);
    if (aim.actor !== id) fail(`${tag}: aim control: the slug would hit actor ${aim.actor}, not ${id}`);
    centreAt = aim.head;
    r = await watchSlug(id, 24);
    if (r.off >= 0 || r.swell.length) break;
    const v = await shotOf(id);
    if (v && v.took) fail(`${tag}: slug ${n} at the neck was taken by a head rule (${JSON.stringify(v)}): it must be an ordinary wound`);
  }
  note(`${tag}: slug ${n} of at most 8 cut the head off; swell on frames ${JSON.stringify(r.swell)}, the head left on frame ${r.off}, ${r.fragments} skull fragments thrown`);
  check(r.off >= 0, `${tag}: slugs at the neck take the head off (slug ${n})`);
  const want60 = swellS * 60;
  check(r.swell.length >= want60 - 2 && r.swell.length <= want60 + 1, `${tag}: the head swells for popSwellS first: ${r.swell.length} frames at 60 fps for ${swellS} s (${(want60 - 2).toFixed(0)} to ${(want60 + 1).toFixed(0)})`);
  check(r.swell.length > 0 && r.off === r.swell[r.swell.length - 1] + 1, `${tag}: it holds through the swell and leaves on the frame after it (swell to frame ${r.swell[r.swell.length - 1]}, off on ${r.off})`);
  check(want === null ? r.fragments >= 1 : r.fragments === want, `${tag}: the skull comes apart: ${r.fragments} fragments are live gibs${want === null ? "" : ` (${want})`}`);
  if (bonesWhole !== undefined) {
    const st = await evaluate(`__sdfGame.skullState(${id})`);
    check(st.pieces.length === bonesWhole, `${tag}: every plate of the anatomical skull is released (${st.pieces.length} of ${bonesWhole} missing)`);
  }
  // No flying head: the ordinary decapitation spawns the head as one limb chunk; the pop's debris are gobs.
  const kinds = await evaluate(`__sdfGame.head.drawnNear(${centreAt[0]}, ${centreAt[1]}, ${centreAt[2]}, 3).chunks.map((c) => c.kind)`);
  check(!kinds.includes("limb"), `${tag}: no flying head: no limb chunk among the ${kinds.length} flying pieces (${[...new Set(kinds)].join(", ")}; ${flying0} before)`);
  await stepOne(); await stepOne();
  const now = await nearHead(id, centreAt);
  check(now.bones === 0 && now.eyes === 0 && now.flesh === 0, `${tag}: the head segment, its eyes and its flesh are not drawn (bone instances ${now.bones}, eyes ${now.eyes}, head flesh prims ${now.flesh})`);
  await stepN(150);
  const later = await nearHead(id, centreAt);
  check(Object.values(later).every((v) => v === 0), `${tag}: 2.5 s on nothing is left at the old head position: ${JSON.stringify(later)}`);
  return centreAt;
}
try {
  // ======== BOOT 1: the shipped rules ========
  await boot("rules");
  Object.assign(TUNING_DEFAULTS, await evaluate("__sdfGame.head.burstTuning()"));
  check(TUNING_DEFAULTS.opening === false && TUNING_DEFAULTS.anyWeapon === false && TUNING_DEFAULTS.alwaysSplit === false && TUNING_DEFAULTS.slugSplit === true && TUNING_DEFAULTS.slugPop === true,
    `the shipped tuning: the opening off, the slug's split and pop on (${JSON.stringify(TUNING_DEFAULTS)})`);

  // -------- NP. (FIRST, on the fresh page, as the opening's pellet scenario is.) Pellets are ordinary.
  const NP = fresh();
  for (let v = 0; v < 2; v++) {
    const aim = await crosshairOn(NP.id, SHOT_D, [0, 0.06, 0]);
    if (aim.actor !== NP.id) fail(`NP: aim control: the crosshair is on actor ${aim.actor}, not ${NP.id}`);
    let fired = false;
    for (let i = 0; i < 6 && !fired; i++) { await evaluate("__sdfGame.refillShells()"); fired = await evaluate("__sdfGame.fire(2)"); if (!fired) await stepN(90); }
    if (!fired) fail("NP: fire(2) never fired (reload?)");
    await stepN(30);
  }
  const npWounds = await headWounds(NP.id), npShot = await shotOf(NP.id);
  note(`NP: ${npWounds.length} wounds on the head (${npWounds.map((w) => `${w.type} r${w.radius.toFixed(3)}`).join(", ")}); last verdict ${JSON.stringify(npShot)}`);
  check(npWounds.length >= 3, `NP: two double-barrel volleys landed pellets on the head (${npWounds.length} head wounds)`);
  check(npWounds.every((w) => w.type === "pellet" && w.shape === "crater" && w.headRegion === null), "NP: every one is an ordinary pellet crater (no region crater, no cut)");
  check(npShot !== null && npShot.rule === "ordinary" && npShot.kind === "pellet" && npShot.took === false, `NP: the head-shot leaf judged a pellet on the head ordinary and did not take it (${JSON.stringify(npShot)})`);
  check((await splitOf(NP.id)) === null && (await hstate(NP.id)) === null, "NP: no split, and the head leaf holds nothing for it (no opening, no deform)");
  check(await headOn(NP.id), "NP: the head is still on");
  await stand(NP.id, 0.8); await capture("NP-pellets");

  // -------- AIM. An aimed slug is centred by the shipped threshold.
  const AIM = fresh();
  const aimed = await crosshairOn(AIM.id, SHOT_D, [0, 0, 0]);
  note(`AIM: crosshair on the head's centre from ${SHOT_D} m: the slug's line passes ${aimed.offset.toFixed(3)} head radii from it (splitFrac ${TUNING_DEFAULTS.splitFrac}); it would hit actor ${aimed.actor}`);
  if (aimed.actor !== AIM.id) fail(`AIM: aim control: the slug would hit actor ${aimed.actor}, not ${AIM.id}`);
  await watchSlug(AIM.id, 8);
  const aimShot = await shotOf(AIM.id);
  check(!!aimShot && aimShot.offset > 0.5 && aimShot.offset < TUNING_DEFAULTS.splitFrac, `AIM: the aimed slug's line ran ${aimShot?.offset?.toFixed(3)} head radii off centre: far from dead centre (the slug lands under the crosshair), and inside the shipped splitFrac ${TUNING_DEFAULTS.splitFrac}`);
  check(aimShot?.rule === "split" && aimShot.took === true && (await splitOf(AIM.id)) !== null, `AIM: it splits the head (${JSON.stringify(aimShot)})`);

  // -------- O. an off-centre slug is ordinary (splitFrac 0.35, so a slug on the head can be off centre).
  await tune({ splitFrac: CENTRE_FRAC });
  const O = fresh();
  const oAim = await aimLine(O.id, SHOT_D, GLANCE_SHIFT);
  await watchSlug(O.id, 8);
  const oShot = await shotOf(O.id), oWounds = await headWounds(O.id);
  note(`O: verdict ${JSON.stringify(oShot)}; head wounds ${oWounds.map((w) => `${w.type} r${w.radius.toFixed(3)} ${w.shape}`).join(", ")}`);
  check(oShot?.rule === "ordinary" && oShot.kind === "slug" && oShot.took === false && oShot.offset >= CENTRE_FRAC, `O: a slug ${oAim.offset.toFixed(3)} radii off centre is ordinary (offset ${oShot?.offset?.toFixed(3)} >= ${CENTRE_FRAC})`);
  check(oWounds.length === 1 && oWounds[0].type === "blast" && oWounds[0].shape === "crater" && oWounds[0].headRegion === null && Math.abs(oWounds[0].radius - 0.16) < 1e-6, "O: it left one ordinary slug crater on the head (radius 0.16 m, no region, no cut)");
  check((await splitOf(O.id)) === null && (await hstate(O.id)) === null && await headOn(O.id), "O: no split, no head-leaf state, the head on");
  await stand(O.id, PHOTO_D); await capture("O-off-centre");

  // -------- S. a centred slug splits the head, to the full angle.
  const S1 = fresh();
  await stand(S1.id, PHOTO_D); await capture("S-before");
  const sAim = await aimLine(S1.id, SHOT_D, 0);
  await watchSlug(S1.id, 8);
  const sShot = await shotOf(S1.id);
  check(sShot?.rule === "split" && sShot.took === true && sShot.offset < CENTRE_FRAC, `S: a slug ${sAim.offset.toFixed(3)} radii off centre splits (verdict ${JSON.stringify(sShot)})`);
  await stepN(150);   // the split's spring settles (the head-split gate: within about 60 frames)
  const st = await splitOf(S1.id);
  // The preset's full angle for what the slug opened: both halves when it landed on the head's middle line, one half
  // when it landed to a side of it (head-split.ts choosePreset, the axe's own rule).
  const presets = await evaluate(`import("/src/lab/sdf-zombie/head-split.ts").then((m) => m.HEAD_SPLIT.presets.middle)`);
  const full = st ? (st.sides === 0 ? presets.maxBoth : presets.maxOne) : NaN;
  check(st?.preset === "middle" && Math.abs(st.target - full * TUNING_DEFAULTS.splitOpen) < 1e-12 && st.angle === st.target && st.vel === 0,
    `S: the head split's state: the middle preset (a slug from the front parts the head left and right), at the preset's full angle and at rest (${st ? `${st.preset} sides ${st.sides} angle ${st.angle} target ${st.target} of ${full}` : null})`);
  const warp = await evaluate(`(() => { const w = __sdfGame.zombie(${S1.id}).posed().split; return w ? { thetaP: w.thetaP, thetaM: w.thetaM, n: [...w.n] } : null; })()`);
  const wantP = st && st.sides >= 0 ? st.angle : 0, wantM = st && st.sides <= 0 ? -st.angle : 0;
  check(!!warp && warp.thetaP === wantP && warp.thetaM === wantM, `S: the pose's split turns ${st?.sides === 0 ? "both halves" : "the struck half"} that far (${warp ? `${warp.thetaP.toFixed(4)} / ${warp.thetaM.toFixed(4)}` : null}; wanted ${wantP} / ${wantM})`);
  await evaluate("__sdfGame.step(1, 0)");
  const drawn = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${S1.id}); return d ? { bones: d.copies.filter((c) => !c.eye).length, eyes: d.copies.filter((c) => c.eye).length, pieces: [...new Set(d.copies.filter((c) => !c.eye).map((c) => c.piece))].sort() } : null; })()`);
  const turned = st ? (st.sides === 0 ? [1, 2] : st.sides > 0 ? [1] : [2]) : [];
  check(!!drawn && drawn.pieces.includes(0) && turned.every((p) => drawn.pieces.includes(p)), `S: the skull is drawn broken with the split: clipped copies for the rest and for each half that turned (${JSON.stringify(drawn)})`);
  // The field where a turned half used to be: 3.5 cm to that half's side of the plane, 6 cm over the head's centre.
  // Flesh on the closed head; empty now that the half has swung away.
  const side = st && st.sides > 0 ? 1 : -1;
  const there = await evaluate(`(async () => { const V = await import("/src/lab/sdf-zombie/validate.ts"); const f = __sdfGame.head.frame(${S1.id}), w = __sdfGame.zombie(${S1.id}).posed().split, b = __sdfGame.zombie(${S1.id}).posed();
    const q = [f.centre[0] + w.n[0] * ${side} * 0.035, f.centre[1] + 0.06, f.centre[2] + w.n[2] * ${side} * 0.035];
    return { open: V.sdBody(q, b), closed: V.sdBodyClosed(q, b) }; })()`);
  check(there.closed < 0 && there.open > 0, `S: the field is open where the half was: ${(there.open * 1000).toFixed(1)} mm clear of any flesh, at a point ${(-there.closed * 1000).toFixed(1)} mm inside the closed head`);
  const faces = (await headWounds(S1.id)).filter((w) => w.shape === "cut" && (w.headRegion === "split+" || w.headRegion === "split-"));
  check(faces.length === (st?.sides === 0 ? 2 : 1) && (await hstate(S1.id)) === null, `S: the slug's wound is the split's cut face${st?.sides === 0 ? "s" : ""} (${faces.length}), and the head leaf holds nothing for it (no opening)`);
  await stand(S1.id, PHOTO_D); await capture("S-split");
  await evaluate("__sdfGame.freeze(false)"); await stepN(3);
  const alS1 = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === S1.id);
  check(alS1?.phase === "standing" && await headOn(S1.id), `S: the zombie lives, its head on (thawed 3 frames: phase ${alS1?.phase})`);
  await evaluate("__sdfGame.freeze(true)");

  // -------- X. a second centred slug on the split head pops it.
  const xAim = await aimLine(S1.id, SHOT_D, 0);
  const f0 = await fragments();
  const x = await watchSlug(S1.id, 24);
  const xShot = await shotOf(S1.id);
  note(`X: line ${xAim.offset.toFixed(3)} radii off; verdict ${JSON.stringify(xShot)}; swell frames ${JSON.stringify(x.swell)}, head off on frame ${x.off}, ${(await fragments()) - f0} fragments`);
  check(xShot?.rule === "pop" && xShot.took === true, `X: a centred slug on the split head is the pop's (${JSON.stringify(xShot)})`);
  check(x.swell.length > 0 && x.off === x.swell[x.swell.length - 1] + 1 && !(await headOn(S1.id)), `X: the open head swells and bursts (swell on ${x.swell.length} frames, off on frame ${x.off})`);
  check((await fragments()) - f0 >= 10, `X: the split skull's plates are thrown (${(await fragments()) - f0} fragments)`);
  await tune({ splitFrac: TUNING_DEFAULTS.splitFrac });

  // -------- OFF. the master switch.
  await tune({ on: false });
  const OFF = fresh();
  await aimLine(OFF.id, SHOT_D, 0);
  await watchSlug(OFF.id, 8);
  check((await splitOf(OFF.id)) === null && (await hstate(OFF.id)) === null && (await headWounds(OFF.id)).some((w) => w.type === "blast" && w.shape === "crater"),
    "OFF: with burstTune({ on: false }) a centred slug is an ordinary slug crater: no split, no opening");
  await tune({ on: true });
  closeSession(S);

  // ======== BOOT 1b: the pop, on a page of its own. How many slugs cut a neck depends on the zombie and on what
  // the cast has been through; the first zombie of a fresh page loses its head to the first.
  await boot("pop");
  // -------- D. the decapitating slug pops (the anatomical skull: fourteen plates).
  const D1 = fresh();
  await stand(D1.id, PHOTO_D); await capture("D-before");
  const dAt = await popByNeckSlugs("D", D1.id, null, 14);
  await evaluate(`__sdfGame.placePlayer({ x: ${dAt[0] + (centre[0] - dAt[0]) * 0.3}, z: ${dAt[2] + (centre[2] - dAt[2]) * 0.3}, yaw: ${yawOf(dAt[0] - centre[0], dAt[2] - centre[2])}, pitch: 0 })`);
  await stepOne(); await capture("D-popped");

  // -------- D0. popSwellS 0: no swell frame.
  await tune({ popSwellS: 0 });
  const D0 = fresh();
  const d0 = await evaluate(`(() => { const ok = __sdfGame.head.pop(${D0.id}, 0, 0, -1); return { ok, popping: __sdfGame.head.popping(${D0.id}), on: __sdfGame.flail.limbAlive(${D0.id}, "head") > 0 }; })()`);
  check(d0.ok && !d0.popping && !d0.on, `D0: with popSwellS 0 the head bursts at once: no swell, the head off in the same call (${JSON.stringify(d0)})`);
  await tune({ popSwellS: TUNING_DEFAULTS.popSwellS });
  closeSession(S);

  // ======== BOOT 2: the opening, switched on by tuning ========
  await boot("opening");
  // -------- P. (FIRST, on the fresh page: run after the slug scenarios, the same volley landed on no actor at all — harness
  // state, not the effect; a fresh-page pellet test opened the head.) The opening with its two debug switches (anyWeapon, alwaysSplit): a plain PELLET volley on a head opens it, once per shot.
  await evaluate("__sdfGame.head.burstTune({ on: true, opening: true, slugSplit: false, slugPop: false, popOnSplit: false, anyWeapon: true, alwaysSplit: true, centreFrac: 1.25, lethal: false, flapCount: -1, repeatStep: 0.04 })");
  const P = fresh();
  await aimLine(P.id, SHOT_D, 0);   // checked stance: the predicted line must hit THIS zombie
  // A reload left over from S's slugs refuses fire() even with full shells: wait it out, as slug() does.
  let firedP = false;
  for (let i = 0; i < 6 && !firedP; i++) {
    await evaluate("__sdfGame.refillShells()");
    firedP = await evaluate("__sdfGame.fire(1)");
    if (!firedP) await stepN(90);
  }
  if (!firedP) fail("P: fire(1) never fired (reload?)");
  await stepN(30);   // pellets are slower than slugs
  const hsP = await hstate(P.id);
  note(`P: wounds on P ${(await evaluate(`__sdfGame.actorWounds(${P.id})`))?.length}`);
  note(`P: burst ${JSON.stringify(hsP?.burst)}, craters ${Object.keys(hsP?.craters ?? {}).join(",")}`);
  check(hsP?.burst?.outcome === "split" && hsP.dead === false, `P: with the opening on (anyWeapon, alwaysSplit) a pellet volley on the head opens it (outcome ${hsP?.burst?.outcome})`);
  check(hsP?.hits === 1, `P: once per shot, not once per pellet (head hits ${hsP?.hits})`);
  await stand(P.id, 0.8); await capture("P-pellets");

  // A and B test the KILL path and the flaps (both OFF by default now): lethal on, three flaps, a repeat step that kills in one.
  await evaluate("__sdfGame.head.burstTune({ on: true, anyWeapon: false, alwaysSplit: false, centreFrac: 0.35, swell: 0.4, shardScale: 1, flapCount: 3, lethal: true, repeatStep: 0.32, craterScale: 1, splay: 0.1 })");

  // -------- C0. the draw-time baseline (twice), before any slug
  const base = fresh();
  await stand(base.id, STAND);
  out.base1 = await evaluate("__sdfGame.timeDraws(120)", 300000);
  out.base2 = await evaluate("__sdfGame.timeDraws(120)", 300000);

  // -------- A. dead-centre: lethal
  const A = fresh();
  await stand(A.id, PHOTO_D); await capture("A-before");
  await aimLine(A.id, SHOT_D, 0);
  const c0 = await chunks();
  let peak = 0;
  const sa = await slug(A.id, 8, (k, hs) => { if (hs?.bu) peak = Math.max(peak, hs.bu.b); });
  const hsA = sa[sa.length - 1];
  note(`A: burst ${JSON.stringify(hsA?.burst)}, peak b ${peak.toFixed(3)}, craters ${Object.keys(hsA?.craters ?? {}).join(",")}, flaps ${hsA?.flaps}, draws ${hsA?.draws}`);
  check(hsA?.dead === true, "A: a dead-centre slug kills (head model dead)");
  check(hsA?.burst?.kind === "lethal" && hsA.burst.offset < CENTRE_FRAC, `A: verdict lethal with offset ${hsA?.burst?.offset?.toFixed(3)} < ${CENTRE_FRAC}`);
  check(!!hsA?.craters?.["burst-exit"], "A: a burst-exit crater was stamped");
  check(peak >= SWELL_PEAK_MIN, `A: the swell peaked at ${peak.toFixed(3)} (>= ${SWELL_PEAK_MIN}) within 8 frames`);
  check((await chunks()) - c0 >= SHARD_CHUNKS_MIN, `A: >= ${SHARD_CHUNKS_MIN} chunks thrown (shards + lumps): +${(await chunks()) - c0}`);
  check((hsA?.flaps ?? 0) >= 1 && (hsA?.draws ?? 0) >= 1, `A: ${hsA?.flaps} flaps drawn as ${hsA?.draws} piece(s)`);
  await stepN(8); await stand(A.id, PHOTO_D); await capture("A-after-8f");
  await stepN(120);
  const settledA = await hstate(A.id);
  check(Math.abs(settledA.bu.b - settledA.bu.rest) < 0.002, `A: the swell settled to its lasting rest (${settledA.bu.b.toFixed(4)} vs ${settledA.bu.rest.toFixed(4)})`);
  await stand(A.id, PHOTO_D); await capture("A-settled");
  await evaluate("__sdfGame.freeze(false)"); await stepN(3);
  const alA = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === A.id);
  check(alA && alA.phase !== "standing", `A: the zombie collapses (phase ${alA?.phase})`);
  check((await evaluate(`__sdfGame.flail.limbAlive(${A.id}, "head")`)) > 0, "A: the head is still on the body");
  await evaluate("__sdfGame.freeze(true)");

  // -------- B. glancing, then a second slug
  const B = fresh();
  await stand(B.id, PHOTO_D, GLANCE_SHIFT); await capture("B-before");
  await aimLine(B.id, SHOT_D, GLANCE_SHIFT);
  const sb = await slug(B.id, 8);
  const hsB = sb[sb.length - 1];
  note(`B: burst ${JSON.stringify(hsB?.burst)}, skull ${JSON.stringify(hsB?.skull)}, craters ${Object.keys(hsB?.craters ?? {}).join(",")}, flaps ${hsB?.flaps}`);
  check(hsB?.dead === false, "B: a glancing slug does not kill");
  check(hsB?.burst?.kind === "glancing" && hsB.burst.offset >= CENTRE_FRAC, `B: verdict glancing with offset ${hsB?.burst?.offset?.toFixed(3)} >= ${CENTRE_FRAC} (shift ${GLANCE_SHIFT} m)`);
  check(Math.max(...Object.values(hsB?.skull ?? { x: 0 })) >= 0.8, "B: a skull region is cracked to >= 0.8");
  check(!hsB?.craters?.["burst-exit"], "B: no exit crater");
  check((hsB?.flaps ?? 0) >= 1, `B: ${hsB?.flaps} flaps drawn`);
  await stepN(8); await stand(B.id, PHOTO_D); await capture("B-after");
  await evaluate("__sdfGame.freeze(false)"); await stepN(3);
  const alB = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === B.id);
  check(alB && alB.phase === "standing", `B: the zombie is still standing when thawed (phase ${alB?.phase})`);
  await evaluate("__sdfGame.freeze(true)");
  await aimLine(B.id, SHOT_D, GLANCE_SHIFT);
  const sb2 = await slug(B.id, 6);
  check(sb2[sb2.length - 1]?.dead === true, "B: a second slug at the same spot kills");

  // -------- S. SPLIT: with lethal OFF (the default) a centred slug opens the head wide and the zombie LIVES; repeats creep up.
  await evaluate("__sdfGame.head.burstTune({ lethal: false, flapCount: 0, repeatStep: 0.04, alwaysSplit: true, centreFrac: 1.25 })");
  const SO = fresh();
  await stand(SO.id, PHOTO_D); await capture("S-before");
  await aimLine(SO.id, SHOT_D, 0);
  const ss = await slug(SO.id, 8);
  const hsS = ss[ss.length - 1];
  note(`S: burst ${JSON.stringify(hsS?.burst)}, craters ${Object.keys(hsS?.craters ?? {}).join(",")}, bu ${JSON.stringify(hsS?.bu)}, flaps ${hsS?.flaps}, draws ${hsS?.draws}`);
  check(hsS?.burst?.outcome === "split" && hsS.dead === false, `S: a centred slug with lethal off SPLITS the head (outcome ${hsS?.burst?.outcome}) and the zombie lives`);
  check(!!hsS?.craters?.["burst-exit"], "S: it opens the head through (a burst-exit crater)");
  check(hsS?.flaps === 0 && hsS?.draws === 0, `S: no flaps by default (${hsS?.flaps} flaps, ${hsS?.draws} draws)`);
  await stepN(8); await stand(SO.id, PHOTO_D); await capture("S-after-8f");
  await stepN(120); await stand(SO.id, PHOTO_D); await capture("S-settled");
  await evaluate("__sdfGame.freeze(false)"); await stepN(3);
  const alS = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === SO.id);
  check(alS && alS.phase === "standing", `S: the split zombie is still standing when thawed (phase ${alS?.phase})`);
  await evaluate("__sdfGame.freeze(true)");
  let nS = 1, deadS = false;
  for (; nS < 12 && !deadS; nS++) {
    await aimLine(SO.id, SHOT_D, 0);
    const r = await slug(SO.id, 4);
    deadS = r[r.length - 1]?.dead === true;
    if (nS === 2) check(!deadS, "S: it survives the third slug (much harder to kill)");
  }
  note(`S: died after ${deadS ? nS : "(not within 12)"} slugs at the same aim`);
  await stepN(8); await stand(SO.id, PHOTO_D); await capture("S-final");

  // -------- D. the off switch
  await evaluate("__sdfGame.head.burstTune({ on: false })");
  const D = fresh();
  await aimLine(D.id, SHOT_D, 0);
  const sd = await slug(D.id, 4);
  check(!sd[sd.length - 1] || !sd[sd.length - 1].burst, "D: with burst off the head has no burst state (ordinary slug path)");
  await evaluate("__sdfGame.head.burstTune({ on: true })");

  // -------- C. cost. The HARD check is structural: every flap of a head shares ONE attached piece (one draw). The timing is
  // reported, not gated: after a burst the scene also holds the debris (shards, lumps, brain) as live chunk views, so a
  // frame-time delta cannot isolate the flaps, and this environment's draw timer spreads by milliseconds between identical
  // runs (see the two baselines).
  await stand(A.id, STAND);
  const hsC = await hstate(A.id);
  check(hsC.draws === 1 && hsC.flaps === 3, `C: ${hsC.flaps} flaps on a lethal head cost ${hsC.draws} draw (all flaps share one attached piece)`);
  out.withBurst = await evaluate("__sdfGame.timeDraws(120)", 300000);
  const delta = out.withBurst - (out.base1 + out.base2) / 2;
  note(`draw time (UNGATED, confounded by ${(await chunks()) - 0} live chunks of debris): baseline ${out.base1.toFixed(2)} / ${out.base2.toFixed(2)} ms (spread ${Math.abs(out.base1 - out.base2).toFixed(2)}), after the bursts ${out.withBurst.toFixed(2)} ms; delta ${delta.toFixed(2)} ms`);
  closeSession(S);

  // ======== BOOT 3: the sculpted skull ========
  await boot("sculpt", "&sculpt=full");
  const sk = await evaluate("__sdfGame.skeletonDiagnostics().skull");
  check(sk === "sculpt", `DS: this boot draws the sculpted skull (${sk})`);
  const DS = fresh();
  await stand(DS.id, PHOTO_D); await capture("DS-before");
  const dsAt = await popByNeckSlugs("DS", DS.id, 10);
  const cuts = await evaluate("__sdfGame.skullFragmentCuts()");
  note(`DS: the sculpted head mesh was cut into fragments ${cuts.meshes} time(s); the cut took ${cuts.lastMs.toFixed(1)} ms`);
  check(cuts.meshes === 1, `DS: the fragments were cut once, at the first pop (${cuts.meshes})`);
  const names = await evaluate("__sdfGame.skullFragments().map((f) => f.plate)");
  check(names.length === 10 && new Set(names).size === 10 && names.includes("mandible") && names.includes("frontal"), `DS: the ten named fragments are the gibs (${names.join(", ")})`);
  await evaluate(`__sdfGame.placePlayer({ x: ${dsAt[0] + (centre[0] - dsAt[0]) * 0.3}, z: ${dsAt[2] + (centre[2] - dsAt[2]) * 0.3}, yaw: ${yawOf(dsAt[0] - centre[0], dsAt[2] - centre[2])}, pitch: 0 })`);
  await stepOne(); await capture("DS-popped");
} finally { if (S) closeSession(S); }

const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
check(errs.length === 0, `E: zero console errors or exceptions (${errs.length}${errs.length ? ": " + JSON.stringify(errs.slice(0, 3)) : ""})`);
console.log(`\nsummary: ${JSON.stringify(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
