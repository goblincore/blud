// scripts/head-damage-gate.mjs — melee head damage (Task 7 of docs/superpowers/plans/2026-09-28-melee-head-damage.md;
// spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md §11). ONE frozen zombie takes four REAL
// flail clicks with the crosshair on its head (0.9 m out, re-aimed before every click, hit-stop off):
//   0. a body hit first (torso, 1.2 m); its wounds are recorded and must all survive (step 6).
//   1. hit 1, the eye: an eye dangles; the wobble's peak |squash| over the 10 frames from the strike is >= 0.15;
//      30 frames on the eyeball hangs >= 0.08 m below the socket; 48 frames on |squash| < 0.0025; a new
//      radius-0.028 crater exists. Photo head-1-eye.png and an 8-shot strip of the swinging eye.
//   1b. (Task 10) hit 1's peak-squash frame (the strike frame or the next two, whichever squashes most; photo
//      head-1-squash[-procedural].png): the bone-coloured pixel share in a face crop, OUTSIDE a circle around each
//      crater, stays within the pre-hit share + 0.005 — the skull squashes WITH the flesh, so no bone shows through
//      intact flesh (mesh path asserted; procedural printed).
//   2. hit 2, cave and snap: eye.state is gone; live chunks went up; the dented side's POLE moved in by >= 0.01.
//      WHY THE POLE (plan decision 1; spec §13): a dent is a SIDE FLATTENING along the head axis nearest the
//      blow — that side's surface moves in by the full depth at its pole (the head frame centre ± that axis ×
//      the half-extent) and by less toward the rim, and the opposite side stays put. It is not a point dent,
//      so a ring sampled 0.085 m off the blow reads a fraction of the depth (0.006 at Task 7) and tests the
//      model where it promises nothing. The probe: trace the surface inward along the axis through the (un-
//      deformed) frame centre, all six poles before the hit, and again after on the side whose `flat` grew; the
//      surface must move in by >= 0.01. (sdBody 2 mm outside the old surface is printed too, not asserted: the
//      face pole is the nose, an anisotropic ellipsoid whose SDF under-reads off-axis — 0.005 for a 0.019 move.) And (Task 10) the face-crop bone share
//      outside the craters after the hit stays within the pre-hit-2 share + 0.005 (mesh asserted). Photo
//      head-2-cave[-procedural].png.
//   3. hit 3, the scalp: two new radius-0.05 craters within 0.03 m of the crown; the bone-coloured pixel share in
//      a crown crop, photographed from above (a photo stand, not the swing stand), rises — on the shipped
//      skeleton path (mesh) AND on ?skeleton=procedural (a second boot; hits 1-3 only). Photo head-3-scalp.png.
//   4. hit 4, the brain: live SDF chunks up by >= 4 (3 brain lumps + 3 skull chips); a brain MESH gib exists
//      (__sdfGame.head.brains(), Task 11) — photo head-4-brain.png 3 frames after the strike, from the swing stand;
//      thawed 3 frames the zombie is out of "standing" and limbAlive(id, "head") > 0; 1.5 s after the strike the
//      brain rests near the floor (y <= BRAIN_REST_MAX_Y: its support sits it 0.03-0.06 m up) and stopped moving
//      — photo brain-rest.png, a close-up on it; head-4-brain-apex.png (+15 frames) shows it near the top of its arc.
//   6. every body wound from step 0 is still in actorWounds (within 1 mm) — read before the thaw.
//   7. cost: median draw time (timeDraws, 120 frames, CPU+GPU fenced) with a dangling eye vs the same scene
//      before any head hit: within 0.5 ms. (Baseline is measured twice to print the noise floor.)
//   8. zero console errors / exceptions.
// Measured, PRINTED (not asserted) — the Task 6 smoke looked wrong here and this gate must not hide it:
//   * the change in the head surface after hit 1 over a 15x15 grid of face rays (sdBody march before vs after):
//     how many rays moved, how far from the socket, and the same as a pixel diff over the face crop outside a
//     small circle around the socket/eye; the red-blood pixel share per stage photo (blood hiding stages 2-4).
// Usage (from bash):
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   node scripts/head-damage-gate.mjs 5241 9241
// Env: OUT (docs/dev-notes/2026-09-28-head-damage/gate), W/H (1280x800).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const OUT = process.env.OUT ?? "docs/dev-notes/2026-09-28-head-damage/gate";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62;          // PLAYER.eye
const STAND = 0.9;           // head stand-off, m
// The plan's thresholds (do not loosen).
const SQUASH_PEAK_MIN = 0.15, EYE_DROP_MIN = 0.08, SQUASH_SETTLE_MAX = 0.0025;
const DENT_MIN = 0.01, CROWN_NEAR = 0.03, BRAIN_CHUNKS_MIN = 4, COST_MAX_MS = 0.5;
const BONE_THRU_MAX = 0.005;  // face-crop bone share outside craters may rise at most this over the pre-hit share
const CRATER_MARGIN = 0.02;   // the exclusion circle around a crater: its radius + this, m
const SOCKET_R = 0.028, SCALP_R = 0.05, R_TOL = 0.005;
const BRAIN_REST_MAX_Y = 0.1;   // the resting brain's origin height, m (floor 0)

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

// ---- Boot a page and pick a frozen zombie pool ---------------------------------------------
let centre = [0, 0, 0];
let pool = [];
async function boot(label, query) {
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
  await evaluate(`(() => { for (const e of document.body.children) { if (/TUNING|DYNAMITE \\/ GIB|BLOOD \\+ GIB BLUR|Record \\[F8\\]/.test(e.innerText || "")) e.style.display = "none"; } return 1; })()`);
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  const sel = await evaluate(`__sdfGame.selectSlot("flail")`);
  if (!sel?.ok) die(`[${label}] selectSlot("flail") refused: ${JSON.stringify(sel)}`);
  for (let i = 0; i < 90; i++) await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.flail.setHitStop(false)");
  await evaluate("__sdfGame.setFreeAim(true)");
  await evaluate("__sdfGame.setAimPoint(0, 0)");
  const st0 = await evaluate("__sdfGame.flail.state()");
  if (!st0 || st0.phase !== "idle") die(`[${label}] flail not idle after the raise: ${JSON.stringify(st0)}`);
  await capture(null); await capture(null);
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie");
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM);
  const room = (await evaluate("__sdfGame.rooms")).find((r) => r.id === ROOM);
  centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
  usedZ = new Set();
  const diag = await evaluate("__sdfGame.skeletonDiagnostics()");
  console.log(`[${label}] ready; room ${ROOM} (${pool.length} zombies); skeleton requested ${diag.requestedMode}, active ${diag.activeMode}`);
  return { diag };
}

// ---- Stands, aim, clicks ------------------------------------------------------------------------
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
function standOff(target, dist) {
  const ax = centre[0] - target[0], az = centre[2] - target[2], l = Math.hypot(ax, az) || 1;
  const x = target[0] + (ax / l) * dist, z = target[2] + (az / l) * dist;
  return { x, z, yaw: yawOf(target[0] - x, target[2] - z) };
}
async function place(p, pitch = 0) { await evaluate(`__sdfGame.placePlayer({ x: ${p.x}, z: ${p.z}, yaw: ${p.yaw}, pitch: ${pitch} })`); await stepOne(); }
const flail = () => evaluate("__sdfGame.flail.state()");
const headOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "head")`);
const torsoOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "torso")`);
const wounds = (id) => evaluate(`__sdfGame.actorWounds(${id})`);
const hstate = (id) => evaluate(`__sdfGame.head.state(${id})`);
const chunks = () => evaluate("__sdfGame.chunkCount");
let usedZ = new Set();
function fresh() { const z = pool.find((q) => !usedZ.has(q.id)); if (!z) die("ran out of fresh zombies"); usedZ.add(z.id); return z; }
/** Crosshair on the head centre, 0.9 m out (free aim, reticle centred). Returns the head centre and the stand. */
async function aimHead(id) {
  const head = await headOf(id);
  const pose = standOff(head, STAND);
  await place(pose, Math.atan2(head[1] - EYE_H, STAND));
  await evaluate("__sdfGame.setAimPoint(0, 0)");
  return { head, pose };
}
/** One REAL click, frame by frame until the strike lands (strikes +1). `perFrame(k, hs)` gets k = frames since
 *  the strike frame (0 = the strike frame itself) and that frame's head state, for `after` frames past it. */
async function clickStrike(id, after, perFrame) {
  const pre = await flail();
  await evaluate("__sdfGame.flail.click()");
  let st = null, f = 0;
  const series = [];
  for (; f < 60; f++) {
    await stepOne();
    st = await flail();
    if (st.strikes > pre.strikes) break;
  }
  if (!st || st.strikes !== pre.strikes + 1 || st.lastStrike?.side !== pre.nextSide) fail(`click control: strikes ${pre.strikes} -> ${st?.strikes}, side ${st?.lastStrike?.side} (expected ${pre.nextSide})`);
  const strikeFrame = f;
  for (let k = 0; k <= after; k++) {
    if (k > 0) await stepOne();
    const hs = await hstate(id);
    series.push({ k, hs, chunks: await chunks() });
    await perFrame?.(k, hs);
  }
  return { strikeFrame, series, last: st.lastStrike };
}
const distTo = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---- pixel helpers ------------------------------------------------------------------------------------
const redShare = (img, cx, cy, size = 220) => {
  let n = 0, red = 0;
  for (let y = Math.max(0, (cy - size / 2) | 0); y < Math.min(img.h, cy + size / 2); y++) for (let x = Math.max(0, (cx - size / 2) | 0); x < Math.min(img.w, cx + size / 2); x++) {
    const c = px(img, x, y); n++; if (c[0] > 90 && c[0] > 1.6 * c[1] && c[0] > 1.6 * c[2]) red++;
  }
  return n ? red / n : 0;
};
/** Bone-coloured: ivory / tan (this skull is tan): r >= 120, g/r 0.62-0.92, b/g 0.45-0.85. Excludes the pink lit flesh
 *  (b ~ g), blood (g/r < 0.5) and the dark. */
const isBone = (c) => { const [r, g, b] = c; return r >= 120 && g / r >= 0.62 && g / r <= 0.92 && b / (g || 1) >= 0.45 && b / (g || 1) <= 0.85; };
const boneShare = (img, cx, cy, size = 200) => {
  let n = 0, b = 0;
  for (let y = Math.max(0, (cy - size / 2) | 0); y < Math.min(img.h, cy + size / 2); y++) for (let x = Math.max(0, (cx - size / 2) | 0); x < Math.min(img.w, cx + size / 2); x++) { n++; if (isBone(px(img, x, y))) b++; }
  return n ? b / n : 0;
};
/** Bone-coloured share of a square face crop (centre `c` px, half-side `half` px), skipping pixels inside any
 *  exclusion circle `ex` ({ x, y, r } px). */
const boneShareOutside = (img, c, half, ex) => {
  let n = 0, b = 0;
  for (let y = Math.max(0, Math.round(c[1] - half)); y < Math.min(img.h, c[1] + half); y++) for (let x = Math.max(0, Math.round(c[0] - half)); x < Math.min(img.w, c[0] + half); x++) {
    if (ex.some((e) => Math.hypot(x - e.x, y - e.y) < e.r)) continue;
    n++; if (isBone(px(img, x, y))) b++;
  }
  return n ? b / n : 0;
};
/** Pixels per metre at the head (screen distance of a 0.1 m sideways step), for crop and circle sizes. */
async function pxPerMAt(head, right) {
  const a = await toPx(head), b = await toPx([head[0] - right[0] * 0.1, head[1], head[2] - right[2] * 0.1]);
  return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.1 : 400;
}
/** Exclusion circles (px) around every wound within 0.3 m of the head: radius + CRATER_MARGIN. */
async function craterCircles(id, head, pxPerM) {
  const out = [];
  for (const w of await wounds(id)) {
    if (distTo(w.pos, head) > 0.3) continue;
    const c = await toPx(w.pos);
    if (c) out.push({ x: c[0], y: c[1], r: (w.radius + CRATER_MARGIN) * pxPerM });
  }
  return out;
}
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
/** The surface's distance from `pole.c` along `pole.d` (the outermost crossing: sphere-trace inward from
 *  `pole.ext` + 0.15 m out, then bisect the last step to 0.1 mm). Null when the line misses the head. */
const poleRadius = (id, pole) => evaluate(`(() => { const c = ${JSON.stringify(pole.c)}, d = ${JSON.stringify(pole.d)}, R = ${pole.ext + 0.15};
  const at = (r) => __sdfGame.head.surfaceAt(${id}, c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r);
  let r = R, prev = R;
  for (let i = 0; i < 400 && r > 0; i++) { const s = at(r); if (s < 0) { let lo = r, hi = prev; while (hi - lo > 1e-4) { const m = (lo + hi) / 2; if (at(m) < 0) lo = m; else hi = m; } return lo; } prev = r; r -= Math.max(s, 0.001); }
  return null; })()`);
/** The six head poles (index = the `flat` side: x+, x−, y+, y−, z+, z−) of the leaf's UN-deformed head frame: the
 *  line from the frame centre along ±that axis, the surface's radius on it, and a probe point 2 mm outside it. */
async function polesOf(id, frame) {
  const out = [];
  for (let k = 0; k < 3; k++) for (const sg of [1, -1]) {
    const u = [0, 0, 0]; u[k] = sg;
    const pole = { c: frame.centre, d: qRot(frame.quat, u), ext: frame.axes[k] };
    const r = await poleRadius(id, pole);
    if (r === null) { out.push(null); continue; }
    const p = pole.c.map((v, i) => v + pole.d[i] * (r + 0.002));
    out.push({ ...pole, r, p, s: await evaluate(`__sdfGame.head.surfaceAt(${id}, ${p[0]}, ${p[1]}, ${p[2]})`) });
  }
  return out;
}
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? ndcPx(n) : null; };

// ---- In-page face grid: march rays at the head face, before vs after ------------------------------
async function faceGrid(id, head, pose) {
  const d = [head[0] - pose.x, 0, head[2] - pose.z]; const dl = Math.hypot(d[0], d[2]); d[0] /= dl; d[2] /= dl;
  const right = [-d[2], 0, d[0]];
  return { d, right, head, t: await evaluate(`(() => {
    const id = ${id}, c = ${JSON.stringify(head)}, d = ${JSON.stringify(d)}, r = ${JSON.stringify(right)};
    const out = [];
    for (let iv = -7; iv <= 7; iv++) for (let iu = -7; iu <= 7; iu++) {
      const u = iu * 0.02, v = iv * 0.02;
      const o = [c[0] - d[0] * 0.5 + r[0] * u, c[1] + v, c[2] - d[2] * 0.5 + r[2] * u];
      let t = 0, hit = null;
      for (let i = 0; i < 80 && t < 0.9; i++) {
        const p = [o[0] + d[0] * t, o[1], o[2] + d[2] * t];
        const s = __sdfGame.head.surfaceAt(id, p[0], p[1], p[2]);
        if (s < 0.001) { hit = t; break; }
        t += Math.max(s, 0.002);
      }
      out.push({ u, v, t: hit });
    }
    return out; })()`) };
}
function reportFaceChange(before, after, socket) {
  const b = before.t, a = after.t;
  const su = (socket[0] - before.head[0]) * before.right[0] + (socket[2] - before.head[2]) * before.right[2];
  const sv = socket[1] - before.head[1];
  let hit0 = 0, moved = 0, thru = 0, outside = 0, maxOut = 0, maxDepth = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i].t === null) continue; hit0++;
    const dt = a[i].t === null ? Infinity : a[i].t - b[i].t;
    if (dt > 0.01) {
      moved++; if (a[i].t === null) thru++;
      const rs = Math.hypot(b[i].u - su, b[i].v - sv);
      if (dt !== Infinity) maxDepth = Math.max(maxDepth, dt);
      if (rs > 0.05) { outside++; maxOut = Math.max(maxOut, rs); }
    }
  }
  note(`hit-1 face change (15x15 rays, 0.02 m spacing, ${hit0} hit the face): ${moved} rays moved in by > 1 cm (${thru} went clean through), ` +
    `${outside} of them farther than 0.05 m from the socket (out to ${maxOut.toFixed(3)} m); deepest finite change ${maxDepth.toFixed(3)} m; socket at grid (${su.toFixed(3)}, ${sv.toFixed(3)}); ` +
    `a 0.028 m socket alone would cover ~${Math.round(Math.PI * 0.028 * 0.028 / 0.0004)} grid rays`);
  return { moved, outside, maxOut };
}

/** Nudge the view (yaw, pitch) until world point `t` sits at the screen centre: the camera is not at the player's
 *  pos line (lateral offset, fisheye), so the analytic yaw leaves the target off to one side. */
async function centreOn(t, iters = 8) {
  let n = null;
  for (let i = 0; i < iters; i++) {
    n = await evaluate(`__sdfGame.flail.toScreen(${t[0]}, ${t[1]}, ${t[2]})`);
    if (!n || (Math.abs(n[0]) < 0.02 && Math.abs(n[1]) < 0.02)) break;
    const pp = await evaluate("__sdfGame.pose()");
    await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw + 0.45 * n[0]}, ${pp.pitch + 0.45 * n[1]}, ${pp.pos[1]})`);
    await stepOne();
  }
  return n;
}
/** The crown photo stand: above and in front of the head, looking down at the crown. */
async function crownStand(id) {
  const head = await headOf(id);
  const pose = standOff(head, 0.12);
  const eyeY = head[1] + 0.55, y = eyeY - EYE_H;
  const target = [head[0], head[1] + 0.19, head[2] - 0.0];
  const pitch = Math.atan2(target[1] - eyeY, 0.12);
  await evaluate(`__sdfGame.setPose(${pose.x}, ${pose.z}, ${pose.yaw}, ${pitch}, ${y})`);
  await stepOne();
  const n = await centreOn(target);
  const pp = await evaluate("__sdfGame.pose()");
  return { pose, target, y, ppos: pp.pos, ndc: n };
}
async function crownShot(id, name) {
  const cs = await crownStand(id);
  const img = await capture(name);
  const c = await toPx(cs.target);
  return { img, c, share: c ? boneShare(img, c[0], c[1], 200) : null, cs };
}
/** The crown: the HIGHEST point of the head surface — a 0.01 m grid of downward marches within 0.12 m of the head
 *  centre (independent of the leaf's own crown trace along the head's up axis). */
async function crownPoint(id, head) {
  return evaluate(`(() => { const c = ${JSON.stringify(head)}; let best = null;
    for (let dx = -0.12; dx <= 0.1201; dx += 0.01) for (let dz = -0.12; dz <= 0.1201; dz += 0.01) {
      let y = c[1] + 0.6;
      for (let i = 0; i < 200 && y > c[1] - 0.2; i++) { const s = __sdfGame.head.surfaceAt(${id}, c[0] + dx, y, c[2] + dz); if (s < 0.001) { if (!best || y > best[1]) best = [c[0] + dx, y, c[2] + dz]; break; } y -= Math.max(s, 0.002); }
    }
    return best; })()`);
}
const stagePhoto = async (id, name, tag) => {
  const { head } = await aimHead(id);
  const img = await capture(name);
  const c = await toPx(head);
  if (c) note(`${tag}: red (blood-coloured) pixel share in a 220 px crop on the head ${(100 * redShare(img, c[0], c[1])).toFixed(1)}%`);
  return img;
};

async function ladder(label, full) {
  const z = fresh(); const id = z.id;
  const out = { label };
  // -------- 0. body hit
  const torso = await torsoOf(id);
  await place(standOff(torso, 1.2), Math.atan2(torso[1] - EYE_H, 1.2));
  await stepN(3);
  const w0 = await wounds(id);
  await clickStrike(id, 30);
  const bodyWounds = await wounds(id);
  if (bodyWounds.length <= w0.length) fail(`[${label}] body hit added no wound (${w0.length} -> ${bodyWounds.length})`);
  if (full) {
    // baseline draw cost (twice: the noise floor), from the head stand
    await aimHead(id);
    await stepN(3); await capture(null);
    out.base1 = await evaluate("__sdfGame.timeDraws(120)", 300000);
    out.base2 = await evaluate("__sdfGame.timeDraws(120)", 300000);
  }
  // -------- 1. the eye
  let { head, pose } = await aimHead(id);
  await stepN(3);
  const woundsPre1 = await wounds(id);
  const gridB = await faceGrid(id, head, pose);
  const imgB = await capture(null);
  const headPxB = await toPx(head);
  const stripFrames = [];
  const peakSeries = [];
  const squashShots = [];
  let r = await clickStrike(id, 10, async (k, hs) => {
    peakSeries.push(hs.squash);
    if (k <= 2) squashShots.push({ k, s: Math.abs(hs.squash), img: await capture(null) });
  });
  const peak = Math.max(...peakSeries.map(Math.abs));
  {
    // 1b. the peak-squash frame: no bone through intact flesh (craters excluded; the same mask on both images).
    const sq = squashShots.reduce((m, q) => (q.s > m.s ? q : m));
    const name = `head-1-squash${full ? "" : "-procedural"}`;
    writeFileSync(`${OUT}/${name}.png`, sq.img.buf); console.log(`  shot ${OUT}/${name}.png (frame +${sq.k}, |squash| ${sq.s.toFixed(3)})`);
    const ppm = await pxPerMAt(head, gridB.right);
    const ex = await craterCircles(id, head, ppm);
    const half = Math.round(0.14 * ppm);
    const b0 = headPxB ? boneShareOutside(imgB, headPxB, half, ex) : null, b1 = headPxB ? boneShareOutside(sq.img, headPxB, half, ex) : null;
    note(`[${label}] hit 1 peak squash (frame +${sq.k}): face-crop bone share outside ${ex.length} crater circles ${b0?.toFixed(4)} -> ${b1?.toFixed(4)} (rise ${b0 !== null ? (b1 - b0).toFixed(4) : "?"}; ${2 * half}px crop)`);
    out.boneSquash = { before: b0, after: b1 };
    if (full) check(b0 !== null && b1 <= b0 + BONE_THRU_MAX, `hit 1 peak squash: no bone through intact flesh — face-crop bone share outside craters ${b0?.toFixed(4)} -> ${b1?.toFixed(4)} (<= pre-hit + ${BONE_THRU_MAX})`);
  }
  note(`[${label}] hit 1 (strike after ${r.strikeFrame + 1} frames): squash frames 0..10 = ${peakSeries.map((s) => s.toFixed(3)).join(" ")}; peak |squash| ${peak.toFixed(3)}`);
  const s1 = r.series[0].hs;
  const eyeOk = s1?.eye?.state === "dangling";
  // frames so far past the strike: 10. The strip: 8 captures, 3 frames apart (captures do not advance the sim).
  let past = 10;
  for (let k = 0; k < 8; k++) {
    const hs = await hstate(id);
    const img = await capture(null);
    const c = await toPx(hs?.eyeball ?? hs?.socket ?? head);
    if (c) stripFrames.push(cropRgb(img, c[0], c[1] + 20, 200, 240));
    if (k < 7) { await stepN(3); past += 3; }
  }
  await stepN(Math.max(0, 30 - past)); past = Math.max(past, 30);
  const hs30 = await hstate(id);
  const drop = hs30.socket && hs30.eyeball ? hs30.socket[1] - hs30.eyeball[1] : null;
  note(`[${label}] hit 1, ${past} frames on: socket (${hs30.socket && f2(hs30.socket)}) eyeball (${hs30.eyeball && f2(hs30.eyeball)}) drop ${drop?.toFixed(3)} m (distance ${hs30.socket && hs30.eyeball ? distTo(hs30.socket, hs30.eyeball).toFixed(3) : "?"})`);
  if (full) await stagePhoto(id, "head-1-eye", "head-1-eye");
  await stepN(Math.max(0, 48 - past)); past = Math.max(past, 48);
  const hs48 = await hstate(id);
  const wAfter1 = await wounds(id);
  const newW1 = wAfter1.filter((w) => !woundsPre1.some((o) => distTo(o.pos, w.pos) < 1e-3 && Math.abs(o.radius - w.radius) < 1e-4));
  const socketW = newW1.find((w) => Math.abs(w.radius - SOCKET_R) <= R_TOL);
  ({ head, pose } = await aimHead(id));
  const gridA = await faceGrid(id, head, pose);
  const imgA = await capture(null);
  if (full) {
    check(eyeOk, `hit 1: an eye dangles (state ${JSON.stringify(s1?.eye)})`);
    check(peak >= SQUASH_PEAK_MIN, `hit 1: wobble peak |squash| ${peak.toFixed(3)} >= ${SQUASH_PEAK_MIN}`);
    check(drop !== null && drop >= EYE_DROP_MIN, `hit 1: eyeball ${drop?.toFixed(3)} m below the socket at +30 frames (>= ${EYE_DROP_MIN})`);
    check(Math.abs(hs48.squash) < SQUASH_SETTLE_MAX, `hit 1: |squash| ${Math.abs(hs48.squash).toExponential(2)} < ${SQUASH_SETTLE_MAX} at +48 frames (settled)`);
    check(!!socketW, `hit 1: a socket crater exists (radius ${SOCKET_R}); new wounds ${JSON.stringify(newW1.map((w) => +w.radius.toFixed(3)))}`);
    out.peak = peak; out.drop = drop; out.settle = Math.abs(hs48.squash);
    if (stripFrames.length === 8) {
      const sw = 200, sh = 240, buf = Buffer.alloc(sw * 8 * sh * 3);
      stripFrames.forEach((f, i) => { for (let y = 0; y < sh; y++) f.copy(buf, (y * sw * 8 + i * sw) * 3, y * sw * 3, (y + 1) * sw * 3); });
      writeFileSync(`${OUT}/eye-swing-strip.png`, encodePng(sw * 8, sh, buf));
      console.log(`  shot ${OUT}/eye-swing-strip.png (8 crops, 3 frames apart from +10 frames past the strike, centred on the eyeball)`);
    } else fail(`eye strip: only ${stripFrames.length}/8 frames had a projectable eyeball`);
    out.faceChange = reportFaceChange(gridB, gridA, hs48.socket ?? head);
    // ...and as pixels: over the head crop, outside the socket->eyeball capsule
    if (headPxB) {
      const sp = await toPx(hs48.socket), ep = await toPx(hs48.eyeball);
      const a = await toPx(head), b = await toPx([head[0] - gridB.right[0] * 0.1, head[1], head[2] - gridB.right[2] * 0.1]);
      const pxPerM = a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.1 : 400;
      const rEx = 0.05 * pxPerM;
      const distSeg = (x, y, p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy || 1; let t = ((x - p[0]) * dx + (y - p[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy); };
      let n = 0, ch = 0, chAll = 0;
      const half = Math.round(0.14 * pxPerM);
      for (let y = Math.round(headPxB[1] - half); y < headPxB[1] + half; y++) for (let x = Math.round(headPxB[0] - half); x < headPxB[0] + half; x++) {
        if (x < 0 || y < 0 || x >= imgA.w || y >= imgA.h) continue;
        const cb = px(imgB, x, y), ca = px(imgA, x, y);
        const diff = Math.hypot(cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]);
        n++; if (diff > 40) chAll++;
        const near = sp && ep ? distSeg(x, y, sp, ep) < rEx : (sp ? Math.hypot(x - sp[0], y - sp[1]) < rEx : false);
        if (!near && diff > 40) ch++;
      }
      note(`hit-1 face crop (${2 * half}px square, ${pxPerM.toFixed(0)} px/m): ${(100 * chAll / n).toFixed(1)}% of pixels changed (colour distance > 40); ` +
        `${(100 * ch / n).toFixed(1)}% changed OUTSIDE a 0.05 m circle/stalk capsule around the socket->eyeball`);
    }
    // cost with the dangling eye
    await stepN(3);
    await aimHead(id);
    out.withEye = await evaluate("__sdfGame.timeDraws(120)", 300000);
  }
  // -------- 2. hit 2, cave and snap
  ({ head, pose } = await aimHead(id));
  await stepN(3);
  const bd = [head[0] - pose.x, 0, head[2] - pose.z]; { const l = Math.hypot(bd[0], bd[2]); bd[0] /= l; bd[2] /= l; }
  const right = [-bd[2], 0, bd[0]];
  const hsPre2 = await hstate(id);
  const flatB = hsPre2.flat;
  const polesB = hsPre2.frame ? await polesOf(id, hsPre2.frame) : [];
  const img2B = await capture(null);
  const head2Px = await toPx(head);
  const chunks2 = await chunks();
  let maxChunks2 = chunks2;
  r = await clickStrike(id, 10);
  for (const q of r.series) maxChunks2 = Math.max(maxChunks2, q.chunks);
  const hs2 = r.series[r.series.length - 1].hs;
  await stepN(60);   // let the wobble die
  const hs2b = await hstate(id);
  // The dented side: the `flat` entry that grew (x+, x−, y+, y−, z+, z−).
  const grew = hs2b.flat.map((x, i) => x - (flatB[i] ?? 0));
  const side = grew.reduce((m, g, i) => (g > grew[m] ? i : m), 0);
  const poleB = polesB[side];
  const poleA = poleB ? await evaluate(`__sdfGame.head.surfaceAt(${id}, ${poleB.p[0]}, ${poleB.p[1]}, ${poleB.p[2]})`) : null;
  const rA = poleB ? await poleRadius(id, poleB) : null;
  // The asserted number is the surface's own move along the pole line (radius before − after). The sdBody rise at
  // the probe is PRINTED only: the zombie's face pole is its nose, a strongly anisotropic ellipsoid whose SDF is a
  // lower bound off its axes, so the rise reads ~1/3 of a real 19 mm move (head-deform probe, Task 10).
  const dentRise = poleB && rA !== null ? poleB.r - rA : null;
  const sideName = ["x+", "x-", "y+", "y-", "z+", "z-"][side];
  note(`[${label}] hit 2: dent flat before ${JSON.stringify(flatB.map((x) => +x.toFixed(3)))} after ${JSON.stringify(hs2b.flat.map((x) => +x.toFixed(3)))}; dented side ${sideName}; pole line surface radius ${poleB?.r.toFixed(4)} -> ${rA?.toFixed(4)} m (moved in ${dentRise?.toFixed(4)}); sdBody 2 mm outside (${poleB ? f2(poleB.p) : "none"}) ${poleB?.s.toFixed(4)} -> ${poleA?.toFixed(4)} (rise ${poleB && poleA !== null ? (poleA - poleB.s).toFixed(4) : "?"}); chunks ${chunks2} -> max ${maxChunks2}`);
  if (full) {
    check(hs2.eye?.state === "gone", `hit 2: eye.state ${JSON.stringify(hs2.eye)} (expected gone)`);
    check(maxChunks2 > chunks2, `hit 2: live chunk count went up (${chunks2} -> ${maxChunks2})`);
    check(dentRise !== null && grew[side] > 0 && dentRise >= DENT_MIN, `hit 2: the dented side's pole (${sideName}) moved in by ${dentRise?.toFixed(4)} m (>= ${DENT_MIN})`);
    out.dent = dentRise; out.chunks2 = [chunks2, maxChunks2];
    await aimHead(id);
    out.afterSnap = await evaluate("__sdfGame.timeDraws(120)", 300000);
  }
  {
    // 2b. no bone through intact flesh after the dent (craters excluded; the same mask on both images).
    const img2A = await stagePhoto(id, `head-2-cave${full ? "" : "-procedural"}`, "head-2-cave");
    const ppm = await pxPerMAt(head, right);
    const ex = await craterCircles(id, head, ppm);
    const half = Math.round(0.14 * ppm);
    const b0 = head2Px ? boneShareOutside(img2B, head2Px, half, ex) : null, b1 = head2Px ? boneShareOutside(img2A, head2Px, half, ex) : null;
    note(`[${label}] hit 2 settled: face-crop bone share outside ${ex.length} crater circles ${b0?.toFixed(4)} -> ${b1?.toFixed(4)} (rise ${b0 !== null ? (b1 - b0).toFixed(4) : "?"}; ${2 * half}px crop)`);
    out.boneDent = { before: b0, after: b1 };
    if (full) check(b0 !== null && b1 <= b0 + BONE_THRU_MAX, `hit 2: no bone through intact flesh — face-crop bone share outside craters ${b0?.toFixed(4)} -> ${b1?.toFixed(4)} (<= pre-hit + ${BONE_THRU_MAX})`);
  }
  // -------- 3. hit 3, the scalp
  head = await headOf(id);
  const crown = await crownPoint(id, head);
  const before3 = await crownShot(id, `head-3-scalp-before${full ? "" : "-procedural"}`);
  const w3pre = await wounds(id);
  ({ head, pose } = await aimHead(id)); await stepN(3);
  r = await clickStrike(id, 20);
  const w3 = await wounds(id);
  const new3 = w3.filter((w) => !w3pre.some((o) => distTo(o.pos, w.pos) < 1e-3 && Math.abs(o.radius - w.radius) < 1e-4));
  const scalps = new3.filter((w) => Math.abs(w.radius - SCALP_R) <= R_TOL);
  const scalpD = crown ? scalps.map((w) => distTo(w.pos, crown)) : [];
  note(`[${label}] hit 3: head centre ${f2(head)}; craters at ${JSON.stringify(new3.map((w) => w.pos.map((v) => +v.toFixed(3))))}; crown (highest head-surface point, independent grid march) ${crown && f2(crown)}; new wounds ${JSON.stringify(new3.map((w) => ({ r: +w.radius.toFixed(3), d: crown ? +distTo(w.pos, crown).toFixed(3) : null })))}`);
  const after3 = await crownShot(id, full ? "head-3-scalp" : `head-3-scalp-${label}`);
  out.bone3 = { before: before3.share, after: after3.share };
  note(`[${label}] hit 3 crown crop bone share ${before3.share?.toFixed(4)} -> ${after3.share?.toFixed(4)} (camera feet y ${after3.cs.ppos[1].toFixed(2)}, crown NDC after centring ${after3.cs.ndc && f2(after3.cs.ndc)})`);
  check(scalps.length >= 2 && scalpD.length >= 2 && scalpD.every((d) => d <= CROWN_NEAR), `[${label}] hit 3: two new radius-${SCALP_R} craters within ${CROWN_NEAR} m of the crown (found ${scalps.length}; distances ${JSON.stringify(scalpD.map((d) => +d.toFixed(3)))})`);
  check(before3.share !== null && after3.share !== null && after3.share > before3.share, `[${label}] hit 3: crown-crop bone-coloured pixel share rises (${before3.share?.toFixed(4)} -> ${after3.share?.toFixed(4)})`);
  if (!full) return out;
  // -------- 4. hit 4, the brain
  ({ head, pose } = await aimHead(id)); await stepN(3);
  const chunks4 = await chunks();
  let maxChunks4 = chunks4;
  const brains0 = (await evaluate("__sdfGame.head.brains()")).length;
  r = await clickStrike(id, 2);
  for (const q of r.series) maxChunks4 = Math.max(maxChunks4, q.chunks);
  {
    // head-4-brain.png: 3 frames after the strike, from the swing stand, the view pitched up to halfway between the
    // head and the flying brain (the pose takes effect on the next step: re-aim at +2, step to +3, shoot).
    const b2 = (await evaluate("__sdfGame.head.brains()")).at(-1);
    if (b2) {
      const pp = await evaluate("__sdfGame.pose()");
      const mid = [(head[0] + b2[0]) / 2, (head[1] + b2[1] + 0.08) / 2, (head[2] + b2[2]) / 2];
      const hz = Math.hypot(mid[0] - pp.pos[0], mid[2] - pp.pos[2]);
      await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw}, ${Math.atan2(mid[1] - EYE_H - pp.pos[1], hz)}, ${pp.pos[1]})`);
    }
    await stepOne();
    maxChunks4 = Math.max(maxChunks4, await chunks());
  }
  const brains3 = await evaluate("__sdfGame.head.brains()");
  {
    const img = await capture("head-4-brain");
    const c = await toPx(head);
    const bp = brains3.length ? await toPx(brains3[brains3.length - 1]) : null;
    note(`head-4-brain (+3 frames): brain mesh at ${brains3.length ? f2(brains3[brains3.length - 1]) : "none"} (screen ${bp ? bp.map((v) => v.toFixed(0)).join(", ") : "off"}); red (blood-coloured) pixel share in a 220 px crop on the head ${c ? (100 * redShare(img, c[0], c[1])).toFixed(1) : "?"}%`);
  }
  for (let k = 3; k < 10; k++) { await stepOne(); maxChunks4 = Math.max(maxChunks4, await chunks()); }
  {
    // head-4-brain-apex.png (+15 frames, ~0.25 s): the brain near the top of its arc, clear of the lumps, chips and
    // spray it left the skull with (at +3 it is still inside them). Re-aimed at +14 onto the brain, step, shoot.
    await stepN(4);
    const b14 = (await evaluate("__sdfGame.head.brains()")).at(-1);
    if (b14) {
      const pp = await evaluate("__sdfGame.pose()");
      const hz = Math.hypot(b14[0] - pp.pos[0], b14[2] - pp.pos[2]);
      await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${yawOf(b14[0] - pp.pos[0], b14[2] - pp.pos[2])}, ${Math.atan2(b14[1] - EYE_H - pp.pos[1], hz)}, ${pp.pos[1]})`);
    }
    await stepOne();
    await capture("head-4-brain-apex");
    note(`head-4-brain-apex (+15 frames): brain at ${b14 ? f2(b14) : "none"} (at +14)`);
  }
  const brainW = (await wounds(id)).filter((w) => Math.abs(w.radius - 0.08) <= R_TOL);
  out.chunks4 = [chunks4, maxChunks4];
  check(maxChunks4 >= chunks4 + BRAIN_CHUNKS_MIN, `hit 4: live SDF chunks up by ${maxChunks4 - chunks4} (${chunks4} -> ${maxChunks4}; >= ${BRAIN_CHUNKS_MIN}: lumps + skull chips); brain cavity wounds ${brainW.length}`);
  check(brains3.length === brains0 + 1, `hit 4: a brain mesh gib exists (${brains0} -> ${brains3.length})`);
  // -------- 6. body wounds, read BEFORE the thaw (a collapsing actor moves)
  const wFinal = await wounds(id);
  const missing = bodyWounds.filter((b) => !wFinal.some((w) => distTo(w.pos, b.pos) <= 1e-3));
  check(missing.length === 0, `body wounds survive: ${bodyWounds.length - missing.length}/${bodyWounds.length} of the pre-head wounds still present within 1 mm`);
  // thaw 3 frames: phase / limbAlive refresh
  await evaluate("__sdfGame.freeze(false)");
  await stepN(3);
  const al = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id);
  await evaluate("__sdfGame.freeze(true)");
  const headAlive = await evaluate(`__sdfGame.flail.limbAlive(${id}, "head")`);
  check(al && al.phase !== "standing", `hit 4: the zombie collapses (phase ${al?.phase}, meter ${al?.meter?.toFixed?.(3)})`);
  check(headAlive > 0, `hit 4: the head is still on (${headAlive} live head prims)`);
  // -------- 4b. the brain at rest, 1.5 s after the strike (15 + 3 frames so far)
  await stepN(90 - 18);
  const restA = await evaluate("__sdfGame.head.brains()");
  await stepN(6);
  const restB = await evaluate("__sdfGame.head.brains()");
  const bA = restA[restA.length - 1], bB = restB[restB.length - 1];
  const moved = bA && bB ? distTo(bA, bB) : null;
  check(!!bB && bB[1] <= BRAIN_REST_MAX_Y && moved !== null && moved < 0.002,
    `hit 4 +1.5 s: the brain rests on the floor at ${bB ? f2(bB) : "none"} (y <= ${BRAIN_REST_MAX_Y}; moved ${moved?.toFixed(4)} m over 6 frames, < 0.002)`);
  if (bB) {
    // brain-rest.png: a low close-up — 0.4 m off the brain on the side facing the swing stand, eye 0.3 m up.
    const ax = pose.x - bB[0], az = pose.z - bB[2], l = Math.hypot(ax, az) || 1;
    // The player stands on the floor (eye 1.62 m), so the close-up is a 0.45 m stand-off looking down with the
    // render FOV narrowed to 20 degrees (restored after).
    const x = bB[0] + (ax / l) * 0.45, z = bB[2] + (az / l) * 0.45;
    await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yawOf(bB[0] - x, bB[2] - z)}, ${Math.atan2(bB[1] - EYE_H, 0.45)}, 0)`);
    const fov0 = (await evaluate("__sdfGame.setRenderFov(NaN)")).renderFovDeg;   // NaN: report only
    await evaluate("__sdfGame.setRenderFov(20)");
    await stepOne();
    const n = await centreOn(bB);
    await capture("brain-rest");
    await evaluate(`__sdfGame.setRenderFov(${fov0})`);
    note(`brain-rest: camera at (${x.toFixed(2)}, ${z.toFixed(2)}) eye 1.62, FOV 20 (restored to ${fov0}), brain NDC after centring ${n ? f2(n) : "off"}`);
  }
  return out;
}

// ============================================================================================
const main = await boot("default", "");
let A = null;
try {
  if (main.diag.activeMode !== "mesh") die(`the shipped (default) skeleton path did not activate as mesh: ${JSON.stringify(main.diag)} — cannot exercise it headlessly`);
  A = await ladder("mesh", true);
  // ---- 7. cost
  const noise = Math.abs(A.base1 - A.base2);
  const delta = A.withEye - (A.base1 + A.base2) / 2;
  note(`draw time (median of 120, fenced): baseline ${A.base1.toFixed(2)} / ${A.base2.toFixed(2)} ms (noise ${noise.toFixed(2)}), dangling eye ${A.withEye.toFixed(2)} ms; delta ${delta.toFixed(2)} ms; after the snap (no eye, hit-1 and hit-2 craters and blood remain, ${A.chunks2?.[1]} live chunks) ${A.afterSnap.toFixed(2)} ms`);
  check(delta <= COST_MAX_MS, `cost: frame time with a dangling eye ${delta.toFixed(2)} ms over the same scene without (<= ${COST_MAX_MS})`);
} finally { closeSession(S); }
// ---- second boot: the procedural skeleton, hits 1-3 only
const proc = await boot("procedural", "&skeleton=procedural");
if (proc.diag.activeMode !== "procedural") die(`?skeleton=procedural did not activate procedural bones: ${JSON.stringify(proc.diag)}`);
await ladder("procedural", false);
closeSession(S);

// ---- 8. console
const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
const warns = consoleEvents.filter((e) => e.type === "warning" && /head-damage|sdf-game/.test(e.text));
for (const w of warns) note(`console warning [${w.label}]: ${w.text.slice(0, 200)}`);
check(errs.length === 0, `zero console errors or exceptions (${errs.length}${errs.length ? ": " + JSON.stringify(errs.slice(0, 3)) : ""})`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
