// scripts/head-burst-gate.mjs — slug head burst (plan docs/superpowers/plans/2026-10-02-slug-head-burst.md Task 10).
// REAL slugs through __sdfGame.fireSlug() on the bare ring page (/sdf-game.html, no ?level), frozen zombies:
//   A. a dead-centre slug is LETHAL: head dead, burst kind lethal with offset < 0.35, a burst-exit crater, the swell
//      peaks (bu.b >= 0.2 within 8 frames) and settles to rest, chunks thrown, flaps drawn, the head still on, the
//      zombie collapses when thawed.
//   S. SPLIT: with lethal OFF (the default) a centred slug opens the head through and the zombie lives, no flaps, and survives
//      the third slug.
//   B. an off-centre slug is GLANCING: not dead, kind glancing with offset >= 0.35, brainLeak, skull cracked >= 0.8, no
//      exit crater, flaps drawn, still standing when thawed; a SECOND slug at the same spot then kills.
//   C. cost: the flaps of a head share ONE attached piece (draws === 1). Frame time is reported, not gated: the debris
//      chunks confound it and this environment's draw timer spreads by milliseconds between identical runs.
//   P. the DEBUG defaults (anyWeapon, alwaysSplit): a pellet volley on a head splits it, once per shot.
//   D. the OFF switch: burstTune({ on: false }) leaves the head with no burst state (the ordinary slug path).
//   E. zero console errors / exceptions.
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
async function boot(label) {
  const s = await openSession(label);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off&loader=0` });
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
try {
  await boot("burst");
  // -------- P. (FIRST, on the fresh page: run after the slug scenarios, the same volley landed on no actor at all — harness
  // state, not the effect; a fresh-page pellet test split the head.) The DEBUG default (owner: "trigger it all the time"): a plain PELLET volley on a head splits it, once per shot.
  await evaluate("__sdfGame.head.burstTune({ on: true, anyWeapon: true, alwaysSplit: true, centreFrac: 1.25, lethal: false, flapCount: -1, repeatStep: 0.04 })");
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
  check(hsP?.burst?.outcome === "split" && hsP.dead === false, `P: a pellet volley on the head splits it with the debug defaults (outcome ${hsP?.burst?.outcome})`);
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
  const S = fresh();
  await stand(S.id, PHOTO_D); await capture("S-before");
  await aimLine(S.id, SHOT_D, 0);
  const ss = await slug(S.id, 8);
  const hsS = ss[ss.length - 1];
  note(`S: burst ${JSON.stringify(hsS?.burst)}, craters ${Object.keys(hsS?.craters ?? {}).join(",")}, bu ${JSON.stringify(hsS?.bu)}, flaps ${hsS?.flaps}, draws ${hsS?.draws}`);
  check(hsS?.burst?.outcome === "split" && hsS.dead === false, `S: a centred slug with lethal off SPLITS the head (outcome ${hsS?.burst?.outcome}) and the zombie lives`);
  check(!!hsS?.craters?.["burst-exit"], "S: it opens the head through (a burst-exit crater)");
  check(hsS?.flaps === 0 && hsS?.draws === 0, `S: no flaps by default (${hsS?.flaps} flaps, ${hsS?.draws} draws)`);
  await stepN(8); await stand(S.id, PHOTO_D); await capture("S-after-8f");
  await stepN(120); await stand(S.id, PHOTO_D); await capture("S-settled");
  await evaluate("__sdfGame.freeze(false)"); await stepN(3);
  const alS = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === S.id);
  check(alS && alS.phase === "standing", `S: the split zombie is still standing when thawed (phase ${alS?.phase})`);
  await evaluate("__sdfGame.freeze(true)");
  let nS = 1, deadS = false;
  for (; nS < 12 && !deadS; nS++) {
    await aimLine(S.id, SHOT_D, 0);
    const r = await slug(S.id, 4);
    deadS = r[r.length - 1]?.dead === true;
    if (nS === 2) check(!deadS, "S: it survives the third slug (much harder to kill)");
  }
  note(`S: died after ${deadS ? nS : "(not within 12)"} slugs at the same aim`);
  await stepN(8); await stand(S.id, PHOTO_D); await capture("S-final");

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
} finally { closeSession(S); }

const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
check(errs.length === 0, `E: zero console errors or exceptions (${errs.length}${errs.length ? ": " + JSON.stringify(errs.slice(0, 3)) : ""})`);
console.log(`\nsummary: ${JSON.stringify(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
