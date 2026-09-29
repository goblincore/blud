// scripts/head-damage-gate.mjs — melee head damage v2 (Task 18 of docs/superpowers/plans/2026-09-28-melee-head-damage.md;
// spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md §15: the flesh wears away, events follow).
// STATES, NOT HIT NUMBERS. ONE frozen zombie (the one whose face points most toward the room centre) takes REAL flail
// clicks, hit-stop off. Before every click the player stands 0.9 m in front of the face (along the head's forward)
// and the crosshair (free aim, reticle centred) is put on a REGION's world point — HEAD_REGIONS[region] (imported
// from the page's own head-damage.ts) through the head frame (__sdfGame.head.frame: centre + quat·(hs × axes)).
//   0. a body hit first (torso, 1.2 m); its wounds must all survive (step 5). The draw-time baseline (twice).
//      The painted-eye baseline photo (v2-before.png, bleed off): each eye's red-glow share, the left orbit's luma.
//   1. the LEFT ORBIT ('L' = image-left = hs.x < 0, the zombie's own right eye) until eyes.L is 'in-orbit':
//      - that took 1–3 hits (v1.5b bigger bites; 2–5 before); every one of them struck nearest the left orbit (the aim's control);
//      - (bleed off, the attached pieces hidden) the painted red-glow share at that eye dropped by >= 80%, and the
//        other eye keeps >= 50% of its baseline share (it still glows);
//      - a 3D eyeball is present: state().eyeball.L set, and showing the pieces changes >= 25% of the pixels in an
//        eyeball-radius circle there. Photos v2-orbit-exposed.png (blood) / -noblood.
//      THE FIRST ORBIT HIT is also the wobble and the dent (bleed off for it: its measures are geometric):
//      - peak |squash| >= 0.35 on the strike frame; a rebound (the opposite sign) of >= 0.12 within 10 frames;
//        |squash| < 0.0025 by 1.4 s (84 frames); photo v2-wobble-strip.png (8 frames, 2 apart, from the strike);
//      - no bone through intact flesh at the peak-squash frame (of frames 0–2): the face-crop bone-coloured share
//        outside every head crater's circle (radius + 2 cm) stays within the pre-hit share + 0.005 (v1's check);
//      - the dented side's pole moved in by >= 0.01 m (v1's pole probe; the dent is a side flattening).
//   2. one more orbit hit POPS the eye — and BOTH eyes (flail spec §14.1 item 8, v1.5a): eyes.L AND eyes.R 'dangling'
//      on the strike frame (the right one straight from painted). 40 frames on (bleed off):
//      - (pieces hidden) both painted glows are gone: each eye's red-glow share drops by >= 80% of its baseline;
//      - two attached pieces are drawn (state().draws 2: one dangling piece per eye, the plug rides in it);
//      - each iris faces the camera: the red-glow share in an eyeball-radius circle on each eyeball >= 0.08;
//      - the socket is a dark hole: the stalk emerges from it and covers the orbit circle, so the measure is the
//        plug's 1.8 cm disc with the stalk's projected footprint cut out (>= 15% of it left): its mean luma < 0.5 × the
//        painted-eye baseline, the snap's bar (the orbit circle, the traced socket point and the plug centre printed).
//      Photos v2-eye-pop.png (blood) / -noblood. Both dangling eyes' draw cost is timed here (step 6).
//   3. the next head hit (the first BROW hit) SNAPS BOTH: eyes.L and eyes.R 'gone' on the strike frame; 40 frames on (bleed off)
//      THE EYES FLY OFF (head-eye EYE_FLY; eyeFlight, sampled every frame for 4 s from the strike frame): each eye gib
//      arcs >= 0.8 m above its launch point, travels >= 2 m horizontally (or hits a wall), bounces >= 2 times, is still
//      live at 4 s, and the two part company (>= 0.6 m apart along the head's right axis).
//      the socket is still a dark hole (the same luma measure; photos v2-snapped.png / -noblood). Then the brow until dead:
//      - the skull was exposed (brow or crown flesh < skullExposed) on an earlier hit than the brain;
//      - the kill came at 5–10 total head hits (v1.5b bigger bites; v1.4 8–14; 5–9 before); exactly one brain MESH gib (head.brains()); live SDF chunks up by
//        >= 4 over the killing hit (lumps + chips);
//      - photos v2-skull.png (blood) / -noblood (settled, the hit that exposed it) and v2-brain.png (+3 frames).
//   4. thawed 3 frames: the zombie is out of 'standing'; the head is still on (limbAlive > 0).
//   5. every body wound from step 0 survives (within 1 mm; read before the thaw); at most 7 head wound slots
//      (Wound.headSlot) are used.
//   5b. 1.5 s after the kill the brain rests near the floor and has stopped (photo v2-brain-rest.png).
//   5c. FLESH NEVER EVICTS AN EYE (flesh-bits.ts fleshEviction): the two snapped eye gibs still live, flesh bits on, the chunk
//      budget (setDynamiteTuning maxchunks) cut to the views in use so every new piece must evict; 8 body hits on a fresh
//      zombie: both eye gibs (the same chunk ids) survive every hit, views stay within the budget, live flesh <= 24.
//   6. cost: median draw time (timeDraws, 120 frames, CPU+GPU fenced) with both eyes dangling vs the same stand before
//      any head hit: within 0.5 ms.
//   7. zero console errors / exceptions.
// BLOOD: setBleed(false) CLEARS the blood sim (droplets, splats) — not the goo blobs — so a with-blood photo is
// always shot before the no-blood one, and bleeding is switched back on before the next hit.
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
const STAND = 0.9;           // swing stand: horizontal distance from the head centre, m
const PHOTO_D = 0.55;        // face photo stand, m (camera lifted to the head centre's height)
// The plan's thresholds (do not loosen).
// v1.5b BIGGER BITES (owner: "too gradual"; strips 0.40 R/L, 0.55 H; skullPerHit 0.32): this gate's sequence (orbitL
// until exposed, the pop, then the brow) exposes the orbit on hit 1–3 and kills at 5–9 total head hits in the model
// across the jitter (v1.4, strips 0.20/0.28, skullPerHit 0.25: exposed 3–5, kill 9–14; v2: 5–9).
const ORBIT_HITS_MIN = 1, ORBIT_HITS_MAX = 3, KILL_HITS_MIN = 5, KILL_HITS_MAX = 10, MAX_HEAD_SLOTS = 7;
const GLOW_DROP_MIN = 0.8;
const SQUASH_PEAK_MIN = 0.35, REBOUND_MIN = 0.12, REBOUND_FRAMES = 10, SETTLE_FRAMES = 84, SQUASH_SETTLE_MAX = 0.0025;
const BONE_THRU_MAX = 0.005, CRATER_MARGIN = 0.02;
const DENT_MIN = 0.01, BRAIN_CHUNKS_MIN = 4, COST_MAX_MS = 0.5, BRAIN_REST_MAX_Y = 0.1;
// This gate's own measures (the plan names the measure, not the number).
const OTHER_GLOW_KEEP = 0.5;   // the other eye keeps >= this share of its baseline glow ("still glows")
const EYEBALL_R = 0.03;        // head-pop.ts EYEBALL_R (the popped eye's full, cartoon size); state().eyeR is the drawn one
const EYE_PRESENT_MIN = 0.25;  // share of an eyeball-radius circle the attached pieces change
const IRIS_RED_MIN = 0.08;     // red-glow share of the eyeball circle: a straight-on iris (r 0.5R, pupil 0.24R) is ~0.19
const SOCKET_DARK = 0.5;       // socket mean luma < this × the painted-eye baseline's
const SOCKET_LUMA_R = 0.015;   // m
// THE POP'S SOCKET MEASURE. While the eye dangles the stalk EMERGES FROM THE HOLE: its root (r 0.009, head-eye
// EYE_STALK.r0) sits on the socket point, and it hangs out and down across the orbit, so the pieces drew ~91-100% of
// the 1.5 cm orbit circle and its luma read the pink stalk, not the socket (105.7 vs baseline 38.5; with the pieces
// hidden — the bare crater — 21.0). A thin annulus round the stalk root is NOT a fair measure here: as drawn the stalk
// is wider than the orbit circle (cutting its projected footprint out of the 1.5 cm circle left 0-32% of it, and that
// remainder was still stalk flank). What the player sees of the hole is the PLUG's disc round the stalk: so the
// measure is a POP_DISC_R circle on the plug's projected centre with the stalk's screen footprint cut out (every pixel
// within STALK_DRAWN × its radius + STALK_PAD px of a projected stalk capsule — state().stalk, the rope nodes); at
// least POP_MIN_SHARE of the disc must remain, and its mean luma must pass the SNAP's bar: < SOCKET_DARK × the
// painted-eye baseline (the same pixels on the painted face are the eye's shadowed surround, luma ~9 — not a bar).
// STALK_DRAWN is MEASURED: the drawn stalk is fatter than its prims (the root's drawn half-width ~20 px where r0
// projects to ~16 px — the round cap plus the march's soft surface); POP_DISC_R stays inside the crater's lit lip.
const POP_DISC_R = 0.018;     // m
const STALK_DRAWN = 1.3;
const STALK_PAD = 3;          // px
const POP_MIN_SHARE = 0.15;
const STALK_R = [0.009, 0.006];   // head-eye EYE_STALK r0, r1
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
  // The impact feel (flail-impact.ts) moves the camera, FOV, rig and kicks the head: off for pixel measures.
  await evaluate("__sdfGame.flail.setImpactFx(false)");
  // Flying flesh bits (flesh-bits.ts, v1.5b): extra live chunks on every hit — off, so the brain's "live SDF chunks up
  // by >= 4" and every pixel measure are the pre-flesh ones; step 5c turns them on.
  await evaluate("__sdfGame.flail.setFleshBits(false)");
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
  // Attached pieces (the in-orbit eye, the dangling eye, the socket plug) are not drawn until the background gib
  // warm is ready (boot.attachPiece's gibDraw skip): wait for it, stepping now and then (the loop is stopped).
  let wb = null;
  for (let i = 0; i < 400; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" || wb.gib === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 1 / 60)"); }
  if (wb?.gib !== "ready") die(`[${label}] the background gib warm is ${JSON.stringify(wb)}: attached pieces would never draw`);
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

// ---- The snapped eyes' comic flight (head-eye EYE_FLY) ------------------------------------------------------
/** From the snap's strike frame, every frame for EYE_FLY_FRAMES (4 s): both eye gibs (__sdfGame.head.eyeGibs, spawnChunkPiece
 *  tag 'eye') must arc up >= EYE_PEAK_MIN above their launch point (the dangling eyeball before the strike, pre.eyeball),
 *  travel >= EYE_TRAVEL_MIN horizontally (or hit a wall first), bounce >= EYE_BOUNCES_MIN times (floor: vy − → +; wall:
 *  the horizontal velocity turns > 90° in one frame), still be live at 4 s (not evicted), and part company: the right
 *  eye ends up >= EYE_SEP_MIN to the right (the head's right axis) of the left one at some point. */
const EYE_FLY_FRAMES = 240, EYE_PEAK_MIN = 0.8, EYE_TRAVEL_MIN = 2, EYE_BOUNCES_MIN = 2, EYE_SEP_MIN = 0.6;
async function eyeFlight(fr, pre) {
  const rt = rightOf(fr);
  const series = [];
  for (let f = 0; f <= EYE_FLY_FRAMES; f++) {
    if (f > 0) await stepOne();
    series.push(await evaluate("__sdfGame.head.eyeGibs()"));
  }
  const ids = [...new Set(series.flatMap((s) => s.map((g) => g.id)))];
  const first = (gid) => series.find((s) => s.some((g) => g.id === gid)).find((g) => g.id === gid);
  const dotR = (p) => p[0] * rt[0] + p[2] * rt[2];
  // L is the one further toward the head's −right at spawn ('L' = hs.x < 0).
  const byside = [...ids].sort((a, b) => dotR(first(a).pos) - dotR(first(b).pos));
  check(ids.length === 2, `eye flight: the snap throws two eye gibs (${ids.length}: ids ${JSON.stringify(ids)})`);
  const res = {};
  for (const [side, gid] of [["L", byside[0]], ["R", byside[1]]]) {
    if (gid === undefined) continue;
    const launch = pre.eyeball?.[side] ?? first(gid).pos;
    let peak = -Infinity, travel = 0, floorB = 0, wallB = 0, prev = null;
    let alive = 0;
    for (let f = 0; f < series.length; f++) {
      const g = series[f].find((q) => q.id === gid);
      if (!g) { prev = null; continue; }
      alive = f;
      peak = Math.max(peak, g.pos[1] - launch[1]);
      travel = Math.max(travel, Math.hypot(g.pos[0] - launch[0], g.pos[2] - launch[2]));
      if (prev) {
        if (prev.vel[1] < -0.3 && g.vel[1] > 0.3) floorB++;
        const hp = Math.hypot(prev.vel[0], prev.vel[2]), hg = Math.hypot(g.vel[0], g.vel[2]);
        if (hp > 0.3 && hg > 0.1 && (prev.vel[0] * g.vel[0] + prev.vel[2] * g.vel[2]) / (hp * hg) < 0) wallB++;
      }
      prev = g;
    }
    const lastG = series.at(-1).find((q) => q.id === gid);
    res[side] = { id: gid, launch, peak, travel, floorB, wallB, aliveS: alive / 60, end: lastG?.pos ?? null };
    note(`eye flight ${side} (chunk ${gid}): launch ${f2(launch)}; peak +${peak.toFixed(2)} m; horizontal travel ${travel.toFixed(2)} m; bounces floor ${floorB} wall ${wallB}; live to ${(alive / 60).toFixed(2)} s; at 4 s ${lastG ? f2(lastG.pos) : "gone"}`);
    check(peak >= EYE_PEAK_MIN, `eye flight ${side}: arcs up ${peak.toFixed(2)} m above its launch point (>= ${EYE_PEAK_MIN})`);
    check(travel >= EYE_TRAVEL_MIN || wallB > 0, `eye flight ${side}: travels ${travel.toFixed(2)} m horizontally (>= ${EYE_TRAVEL_MIN}, or a wall first: ${wallB} wall bounces)`);
    check(floorB + wallB >= EYE_BOUNCES_MIN, `eye flight ${side}: bounces ${floorB + wallB} times (floor ${floorB}, wall ${wallB}; >= ${EYE_BOUNCES_MIN})`);
    check(!!lastG, `eye flight ${side}: still live after ${EYE_FLY_FRAMES / 60} s (not evicted, not baked away)`);
  }
  let sep = -Infinity;
  for (const s of series) {
    const L = s.find((q) => q.id === byside[0]), R = s.find((q) => q.id === byside[1]);
    if (L && R) sep = Math.max(sep, dotR(R.pos) - dotR(L.pos));
  }
  note(`eye flight: the right eye's greatest lead to the right of the left one (head right axis) ${sep.toFixed(2)} m`);
  check(sep >= EYE_SEP_MIN, `eye flight: the eyes fly to different sides — lateral separation grows to ${sep.toFixed(2)} m (>= ${EYE_SEP_MIN})`);
  out.eyeFlight = { ...res, sep };
}

// ---- The head frame and its regions ---------------------------------------------------------------
let HD = null;   // { regions: HEAD_REGIONS, orbitExposed, skullExposed } from the page's head-damage.ts
const frameOf = (id) => evaluate(`__sdfGame.head.frame(${id})`);
const regionWorld = (fr, hs, k = 1) => { const l = qRot(fr.quat, [hs[0] * fr.axes[0] * k, hs[1] * fr.axes[1] * k, hs[2] * fr.axes[2] * k]); return fr.centre.map((c, i) => c + l[i]); };
const hsOf = (fr, p) => { const l = qRot([-fr.quat[0], -fr.quat[1], -fr.quat[2], fr.quat[3]], p.map((v, i) => v - fr.centre[i])); return [l[0] / fr.axes[0], l[1] / fr.axes[1], l[2] / fr.axes[2]]; };
const nearestRegion = (hs) => { let best = null, bd = Infinity; for (const [r, c] of Object.entries(HD.regions)) { const d = (hs[0] - c[0]) ** 2 + (hs[1] - c[1]) ** 2 + (hs[2] - c[2]) ** 2; if (d < bd) { bd = d; best = r; } } return best; };
const fwdOf = (fr) => qRot(fr.quat, [0, 0, 1]);
const rightOf = (fr) => qRot(fr.quat, [1, 0, 0]);
/** The socket plug's centre (game-head-damage HEAD_LEAF.plug.inset in from the socket point, straight back
 *  along the head's −forward — the leaf's `inward`). */
const plugCentre = (fr, sock) => { const f = fwdOf(fr); return sock.map((v, i) => v - f[i] * PLUG_INSET); };
const PLUG_INSET = 0.034;   // game-head-damage HEAD_LEAF.plug.inset
const brains = () => evaluate("__sdfGame.head.brains()");
const setBleed = (on) => evaluate(`__sdfGame.setBleed(${on})`);

/** The swing stand: STAND m in front of the face (horizontal, along the head forward), the crosshair (reticle centred)
 *  nudged onto world point `p`. Returns p's NDC after centring. */
async function aimAt(fr, p) {
  const f = fwdOf(fr), fl = Math.hypot(f[0], f[2]) || 1;
  const x = fr.centre[0] + (f[0] / fl) * STAND, z = fr.centre[2] + (f[2] / fl) * STAND;
  await place({ x, z, yaw: yawOf(p[0] - x, p[2] - z) }, Math.atan2(p[1] - EYE_H, Math.hypot(p[0] - x, p[2] - z)));
  await evaluate("__sdfGame.setAimPoint(0, 0)");
  return centreOn(p);
}
/** The face photo stand: PHOTO_D m in front of the face, the camera at the head centre's height, looking at it. */
async function faceStand(fr) {
  const f = fwdOf(fr), fl = Math.hypot(f[0], f[2]) || 1;
  const x = fr.centre[0] + (f[0] / fl) * PHOTO_D, z = fr.centre[2] + (f[2] / fl) * PHOTO_D;
  await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yawOf(fr.centre[0] - x, fr.centre[2] - z)}, 0, ${fr.centre[1] - EYE_H})`);
  await stepOne();
  await centreOn(fr.centre);
}
/** Red-glow share (the painted eye / iris colour: r > 150, r > 2.2 g, r > 2.2 b) in a circle. */
const glowShare = (img, c, r) => { let n = 0, g = 0; for (let y = Math.round(c[1] - r); y < c[1] + r; y++) for (let x = Math.round(c[0] - r); x < c[0] + r; x++) { if (x < 0 || y < 0 || x >= img.w || y >= img.h || Math.hypot(x - c[0], y - c[1]) > r) continue; n++; const p = px(img, x, y); if (p[0] > 150 && p[0] > 2.2 * p[1] && p[0] > 2.2 * p[2]) g++; } return n ? g / n : 0; };
/** Mean luma in a circle, leaving out every pixel inside one of `caps` ({ a, b, r } screen capsules). Returns
 *  { luma, n, total }. */
const lumaOutside = (img, c, r, caps) => { let n = 0, s = 0, total = 0; for (let y = Math.round(c[1] - r); y < c[1] + r; y++) for (let x = Math.round(c[0] - r); x < c[0] + r; x++) { if (x < 0 || y < 0 || x >= img.w || y >= img.h || Math.hypot(x - c[0], y - c[1]) > r) continue; total++; if (caps.some((k) => segDist([x, y], k.a, k.b) <= k.r)) continue; n++; s += luma(px(img, x, y)); } return { luma: n ? s / n : 0, n, total }; };
const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const meanLuma = (img, c, r) => { let n = 0, s = 0; for (let y = Math.round(c[1] - r); y < c[1] + r; y++) for (let x = Math.round(c[0] - r); x < c[0] + r; x++) { if (x < 0 || y < 0 || x >= img.w || y >= img.h || Math.hypot(x - c[0], y - c[1]) > r) continue; n++; s += luma(px(img, x, y)); } return n ? s / n : 0; };
const boneIn = (img, c, r) => { let n = 0, b = 0; for (let y = Math.round(c[1] - r); y < c[1] + r; y++) for (let x = Math.round(c[0] - r); x < c[0] + r; x++) { if (x < 0 || y < 0 || x >= img.w || y >= img.h || Math.hypot(x - c[0], y - c[1]) > r) continue; n++; if (isBone(px(img, x, y))) b++; } return n ? b / n : 0; };
/** Share of a circle's pixels that differ (colour distance > 30) between two images. */
const diffShare = (a, b, c, r) => { let n = 0, d = 0; for (let y = Math.round(c[1] - r); y < c[1] + r; y++) for (let x = Math.round(c[0] - r); x < c[0] + r; x++) { if (x < 0 || y < 0 || x >= a.w || y >= a.h || Math.hypot(x - c[0], y - c[1]) > r) continue; n++; const p = px(a, x, y), q = px(b, x, y); if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 30) d++; } return n ? d / n : 0; };
/** Shoot the pieces-hidden twin of the current view (the painted face alone). */
async function captureNoPieces() {
  await evaluate("__sdfGame.setChunksVisible(false)");
  const img = await capture(null);
  await evaluate("__sdfGame.setChunksVisible(true)");
  return img;
}
/** Every head-region wound in the ring (Wound.headSlot set). */
const headSlots = async (id) => (await evaluate(`__sdfGame.zombie(${id}).woundList()`)).filter((w) => w.headSlot);
const fmtCraters = (st) => Object.entries(st.craters ?? {}).map(([k, v]) => `${k} r${v.radius.toFixed(3)} carve ${v.carveDepth?.toFixed(3) ?? "-"} skull ${v.skull?.toFixed(3) ?? "-"}`).join("; ");
const fmtFlesh = (st) => Object.entries(st.flesh).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" ");
/** The region the strike's own snapped hit point (lastStrike.points[id]) is nearest, in frame `fr`. */
async function struckRegion(id, fr) {
  const p = (await flail()).lastStrike?.points?.[id];
  return p ? { region: nearestRegion(hsOf(fr, p)), hs: hsOf(fr, p) } : { region: null, hs: null };
}

// ============================================================================================
const main = await boot("default", "");
const out = {};
try {
  if (main.diag.activeMode !== "mesh") die(`the shipped (default) skeleton path did not activate as mesh: ${JSON.stringify(main.diag)}`);
  HD = await evaluate(`import("/src/lab/sdf-zombie/head-damage.ts").then((m) => ({ regions: m.HEAD_REGIONS, orbitExposed: m.REGION_TUNING.orbitExposed, skullExposed: m.REGION_TUNING.skullExposed }))`);
  // The zombie whose face points most toward the room centre (the face stands must be inside the room).
  let pick = null;
  for (const z of pool) {
    const fr = await frameOf(z.id); if (!fr) continue;
    const f = fwdOf(fr), to = [centre[0] - fr.centre[0], centre[2] - fr.centre[2]];
    const c = (f[0] * to[0] + f[2] * to[1]) / ((Math.hypot(f[0], f[2]) || 1) * (Math.hypot(to[0], to[1]) || 1));
    if (!pick || c > pick.c) pick = { z, fr, c };
  }
  if (!pick) die("no zombie with a head frame");
  const id = pick.z.id; usedZ.add(id);
  const fr0 = pick.fr;
  console.log(`zombie ${id}: face-to-centre cos ${pick.c.toFixed(2)}; head frame centre (${f2(fr0.centre)}) axes (${f2(fr0.axes)})`);

  // -------- 0. body hit, cost baseline, painted-eye baseline
  const torso = await torsoOf(id);
  await place(standOff(torso, 1.2), Math.atan2(torso[1] - EYE_H, 1.2));
  await stepN(3);
  const w0 = await wounds(id);
  await clickStrike(id, 30);
  const bodyWounds = await wounds(id);
  check(bodyWounds.length > w0.length, `body hit adds a wound (${w0.length} -> ${bodyWounds.length})`);
  check((await hstate(id)) === null, `the body hit is not a head hit (head.state null)`);
  await aimAt(fr0, regionWorld(fr0, HD.regions.orbitL));
  await stepN(3); await capture(null);
  out.base1 = await evaluate("__sdfGame.timeDraws(120)", 300000);
  out.base2 = await evaluate("__sdfGame.timeDraws(120)", 300000);
  await setBleed(false);
  await faceStand(fr0);
  const img0 = await capture("v2-before");
  const ppm = await pxPerMAt(fr0.centre, rightOf(fr0));
  const eyePx = async (side) => toPx(regionWorld(fr0, HD.regions[side === "L" ? "orbitL" : "orbitR"]));
  const base = { eL: await eyePx("L"), eR: await eyePx("R") };
  base.gL = glowShare(img0, base.eL, 0.03 * ppm); base.gR = glowShare(img0, base.eR, 0.03 * ppm);
  base.lumaL = meanLuma(img0, base.eL, SOCKET_LUMA_R * ppm);
  base.img0 = img0;   // the pop measure's baseline (the painted face at the same stand)
  note(`painted-eye baseline (face stand ${PHOTO_D} m, ${ppm.toFixed(0)} px/m, bleed off): glow share L ${base.gL.toFixed(3)} R ${base.gR.toFixed(3)} (3 cm circles); left-orbit luma ${base.lumaL.toFixed(1)} (1.5 cm circle)`);
  await setBleed(true);

  // -------- 1. the left orbit until the eye is in the orbit (the first hit is the wobble and the dent)
  const orbitStruck = [];
  let n = 0, st = null;
  const strip = [];
  while (n < 8) {
    const fr = await frameOf(id);
    const target = regionWorld(fr, HD.regions.orbitL);
    await aimAt(fr, target);
    await stepN(2);
    let r;
    if (n === 0) {
      // Bleed off for the first hit: its checks are geometric (the goo blobs of the body hit stay).
      await setBleed(false);
      const polesB = await polesOf(id, fr);
      const flatB = [0, 0, 0, 0, 0, 0];
      const imgB = await capture(null);
      const headPxB = await toPx(fr.centre);
      const squash = [];
      const squashShots = [];
      r = await clickStrike(id, SETTLE_FRAMES, async (k, hs) => {
        squash.push(hs.squash);
        if (k <= 2 || (k % 2 === 0 && k <= 14)) {
          const img = await capture(null);
          if (k <= 2) squashShots.push({ k, s: Math.abs(hs.squash), img });
          if (k % 2 === 0 && k <= 14) { const c = await toPx(fr.centre); if (c) strip.push(cropRgb(img, c[0], c[1] - 10, 220, 260)); }
        }
      });
      const s0 = squash[0], sg = Math.sign(s0) || 1;
      const rebound = Math.max(...squash.slice(1, REBOUND_FRAMES + 1).map((s) => -sg * s));
      const settle = Math.abs(squash[SETTLE_FRAMES]);
      note(`orbit hit 1 wobble (strike after ${r.strikeFrame + 1} frames): squash frames 0..14 = ${squash.slice(0, 15).map((s) => s.toFixed(3)).join(" ")}; |squash| at +${SETTLE_FRAMES} ${settle.toExponential(2)}`);
      out.wobble = { peak: Math.abs(s0), rebound, settle };
      check(Math.abs(s0) >= SQUASH_PEAK_MIN, `wobble: peak |squash| ${Math.abs(s0).toFixed(3)} on the strike frame (>= ${SQUASH_PEAK_MIN})`);
      check(rebound >= REBOUND_MIN, `wobble: rebound ${rebound.toFixed(3)} (opposite sign) within ${REBOUND_FRAMES} frames (>= ${REBOUND_MIN})`);
      check(settle < SQUASH_SETTLE_MAX, `wobble: |squash| ${settle.toExponential(2)} at +${SETTLE_FRAMES} frames / 1.4 s (< ${SQUASH_SETTLE_MAX})`);
      if (strip.length === 8) {
        const sw = 220, sh = 260, buf = Buffer.alloc(sw * 8 * sh * 3);
        strip.forEach((f, i) => { for (let y = 0; y < sh; y++) f.copy(buf, (y * sw * 8 + i * sw) * 3, y * sw * 3, (y + 1) * sw * 3); });
        writeFileSync(`${OUT}/v2-wobble-strip.png`, encodePng(sw * 8, sh, buf));
        console.log(`  shot ${OUT}/v2-wobble-strip.png (frames +0,+2..+14 of orbit hit 1, bleed off, swing stand)`);
      } else fail(`wobble strip: only ${strip.length}/8 frames projectable`);
      // No bone through intact flesh at the peak-squash frame (craters excluded; the same mask on both images).
      const sq = squashShots.reduce((m, q) => (q.s > m.s ? q : m));
      const pxm = await pxPerMAt(fr.centre, rightOf(fr));
      const ex = await craterCircles(id, fr.centre, pxm);
      const half = Math.round(0.14 * pxm);
      const b0 = headPxB ? boneShareOutside(imgB, headPxB, half, ex) : null, b1 = headPxB ? boneShareOutside(sq.img, headPxB, half, ex) : null;
      note(`peak-squash frame +${sq.k} (|squash| ${sq.s.toFixed(3)}): face-crop bone share outside ${ex.length} crater circles ${b0?.toFixed(4)} -> ${b1?.toFixed(4)} (${2 * half}px crop)`);
      check(b0 !== null && b1 <= b0 + BONE_THRU_MAX, `wobble peak: no bone through intact flesh — face-crop bone share outside craters ${b0?.toFixed(4)} -> ${b1?.toFixed(4)} (<= pre-hit + ${BONE_THRU_MAX})`);
      // The dent: the pole on the side whose `flat` grew moved in.
      const hsD = await hstate(id);
      const grew = hsD.flat.map((x, i) => x - flatB[i]);
      const side = grew.reduce((m, g, i) => (g > grew[m] ? i : m), 0);
      const poleB = polesB[side];
      const rA = poleB ? await poleRadius(id, poleB) : null;
      const dent = poleB && rA !== null ? poleB.r - rA : null;
      const sideName = ["x+", "x-", "y+", "y-", "z+", "z-"][side];
      note(`dent: flat ${JSON.stringify(hsD.flat.map((x) => +x.toFixed(3)))}; side ${sideName}; pole radius ${poleB?.r.toFixed(4)} -> ${rA?.toFixed(4)}`);
      check(dent !== null && grew[side] > 0 && dent >= DENT_MIN, `dent: the dented side's pole (${sideName}) moved in by ${dent?.toFixed(4)} m (>= ${DENT_MIN})`);
      out.dent = dent;
      await setBleed(true);
    } else {
      r = await clickStrike(id, 0);
    }
    n++;
    const sr = await struckRegion(id, fr);
    orbitStruck.push(sr.region);
    st = await hstate(id);
    note(`orbit hit ${n} (${r.last?.side}): struck nearest ${sr.region} (hs ${sr.hs ? f2(sr.hs) : "?"}); flesh ${fmtFlesh(st)}; eyes ${JSON.stringify(st.eyes)}; craters ${fmtCraters(st)}`);
    if (st.eyes.L !== "painted") break;
    await stepN(20);
  }
  out.orbitHits = n;
  check(st.eyes.L === "in-orbit" && n >= ORBIT_HITS_MIN && n <= ORBIT_HITS_MAX, `orbit exposed: eyes.L ${st.eyes.L} after ${n} left-orbit hits (${ORBIT_HITS_MIN}–${ORBIT_HITS_MAX})`);
  check(orbitStruck.every((q) => q === "orbitL"), `aim control: every left-orbit click struck nearest orbitL (${JSON.stringify(orbitStruck)})`);
  {
    await stepN(60);
    const fr = await frameOf(id);
    await faceStand(fr);
    await capture("v2-orbit-exposed");
    await setBleed(false);
    const imgV = await capture("v2-orbit-exposed-noblood");
    const imgH = await captureNoPieces();
    const hs = await hstate(id);
    const eL = await eyePx("L"), eR = await eyePx("R");
    const gL = glowShare(imgH, eL, 0.03 * ppm), gR = glowShare(imgH, eR, 0.03 * ppm);
    const drop = base.gL > 0 ? 1 - gL / base.gL : null;
    const ebPx = hs.eyeball.L ? await toPx(hs.eyeball.L) : null;
    const inR = hs.eyeR?.L ?? EYEBALL_R;   // the in-orbit ball is life-size (head-eye ORBIT_EYE_R)
    const present = ebPx ? diffShare(imgV, imgH, ebPx, inR * ppm) : 0;
    const iris = ebPx ? glowShare(imgV, ebPx, inR * ppm) : 0;
    note(`orbit exposed (settled, bleed off): painted glow (pieces hidden) L ${base.gL.toFixed(3)} -> ${gL.toFixed(3)} (drop ${drop === null ? "?" : (100 * drop).toFixed(0)}%), R ${base.gR.toFixed(3)} -> ${gR.toFixed(3)}; in-orbit eyeball (r ${inR.toFixed(3)}; orbit crater r ${hs.craters?.orbitL?.radius?.toFixed(3) ?? "?"}): ${(100 * present).toFixed(0)}% of its circle changes with the pieces, iris red share ${iris.toFixed(3)}; draws ${hs.draws}`);
    out.glow = { L: [base.gL, gL], R: [base.gR, gR], present, irisInOrbit: iris, inR };
    check(base.gL > 0.02 && drop !== null && drop >= GLOW_DROP_MIN, `orbit exposed: the painted glow at that eye is gone — red share ${base.gL.toFixed(3)} -> ${gL.toFixed(3)} (drop >= ${100 * GLOW_DROP_MIN}%)`);
    check(base.gR > 0.02 && gR >= OTHER_GLOW_KEEP * base.gR, `orbit exposed: the other eye still glows — red share ${base.gR.toFixed(3)} -> ${gR.toFixed(3)} (>= ${OTHER_GLOW_KEEP} × baseline)`);
    check(!!hs.eyeball.L && hs.draws >= 1 && present >= EYE_PRESENT_MIN, `orbit exposed: a 3D eyeball is present (eyeball ${hs.eyeball.L ? f2(hs.eyeball.L) : "null"}, draws ${hs.draws}, ${(100 * present).toFixed(0)}% of its circle drawn by the pieces >= ${100 * EYE_PRESENT_MIN}%)`);
    await setBleed(true);
  }

  // -------- 2. the pop
  {
    const fr = await frameOf(id);
    await aimAt(fr, regionWorld(fr, HD.regions.orbitL));
    await stepN(2);
    const r = await clickStrike(id, 0);
    const sr = await struckRegion(id, fr);
    const hs = r.series[0].hs;
    const hsPop = hs;
    note(`pop hit (${r.last?.side}): struck nearest ${sr.region}; eyes ${JSON.stringify(hs.eyes)}; flesh ${fmtFlesh(hs)}`);
    check(hs.eyes.L === "dangling", `pop: one more orbit hit pops the eye (eyes.L ${hs.eyes.L}, struck nearest ${sr.region})`);
    check(hs.eyes.L === "dangling" && hs.eyes.R === "dangling", `pop: both eyes pop in the same hit (eyes ${JSON.stringify(hs.eyes)} on the strike frame)`);
    await stepN(3);
    out.withEye = await evaluate("__sdfGame.timeDraws(120)", 300000);
    await stepN(40);
    await faceStand(fr);
    await capture("v2-eye-pop");
    await setBleed(false);
    const img = await capture("v2-eye-pop-noblood");
    const imgH = await captureNoPieces();
    const h2 = await hstate(id);
    const ebPx = h2.eyeball.L ? await toPx(h2.eyeball.L) : null;
    const skPx = h2.socket.L ? await toPx(h2.socket.L) : null;
    const popR = h2.eyeR?.L ?? EYEBALL_R;   // grown to the cartoon EYEBALL_R by now (POP_GROW_S 0.15 s)
    const iris = ebPx ? glowShare(img, ebPx, popR * ppm) : 0;
    // BOTH EYES (v1.5a): the right eye's iris, both painted glows (pieces hidden, the baseline's circles), the draws.
    const ebPxR = h2.eyeball.R ? await toPx(h2.eyeball.R) : null;
    const popRR = h2.eyeR?.R ?? EYEBALL_R;
    const irisR = ebPxR ? glowShare(img, ebPxR, popRR * ppm) : 0;
    const eLn = await eyePx("L"), eRn = await eyePx("R");
    const pgL = glowShare(imgH, eLn, 0.03 * ppm), pgR = glowShare(imgH, eRn, 0.03 * ppm);
    const dropL = base.gL > 0 ? 1 - pgL / base.gL : null, dropR = base.gR > 0 ? 1 - pgR / base.gR : null;
    note(`both eyes dangling (+40 frames, bleed off): painted glow (pieces hidden) L ${base.gL.toFixed(3)} -> ${pgL.toFixed(3)} (drop ${dropL === null ? "?" : (100 * dropL).toFixed(0)}%), R ${base.gR.toFixed(3)} -> ${pgR.toFixed(3)} (drop ${dropR === null ? "?" : (100 * dropR).toFixed(0)}%); eyeballs L ${h2.eyeball.L ? f2(h2.eyeball.L) : "null"} (screen ${ebPx ? ebPx.map(Math.round).join(",") : "off"}) R ${h2.eyeball.R ? f2(h2.eyeball.R) : "null"} (screen ${ebPxR ? ebPxR.map(Math.round).join(",") : "off"}); iris red share L ${iris.toFixed(3)} R ${irisR.toFixed(3)}; eyes ${JSON.stringify(h2.eyes)}; draws ${h2.draws}; craters ${fmtCraters(h2)}`);
    check(dropL !== null && dropL >= GLOW_DROP_MIN && dropR !== null && dropR >= GLOW_DROP_MIN, `both eyes dangling: both painted glows are gone — L ${base.gL.toFixed(3)} -> ${pgL.toFixed(3)}, R ${base.gR.toFixed(3)} -> ${pgR.toFixed(3)} (each drop >= ${100 * GLOW_DROP_MIN}%)`);
    check(h2.draws === 2 && !!h2.stalk?.L && !!h2.stalk?.R, `both eyes dangling: two attached pieces, each on its own stalk (draws ${h2.draws}; stalks L ${h2.stalk?.L ? "yes" : "no"} R ${h2.stalk?.R ? "yes" : "no"})`);
    check(!!ebPxR && irisR >= IRIS_RED_MIN, `both eyes dangling: the right eye's iris faces the camera too — red share ${irisR.toFixed(3)} on its eyeball circle (>= ${IRIS_RED_MIN})`);
    out.both = { glowL: [base.gL, pgL], glowR: [base.gR, pgR], irisL: iris, irisR, draws: h2.draws };
    // The orbit circle: the SAME circle the painted-eye baseline was measured in (the orbit region's hs point, the
    // painted eye); the traced socket point and the plug's centre (1 cm / 2.4 cm in toward the head centre) printed.
    const sockL = meanLuma(img, base.eL, SOCKET_LUMA_R * ppm);
    const plugPx = h2.socket.L ? await toPx(plugCentre(fr, h2.socket.L)) : null;
    note(`pop: orbit-circle luma ${sockL.toFixed(1)} at the painted eye (${base.eL.map(Math.round).join(",")}); at the traced socket point (${skPx ? skPx.map(Math.round).join(",") : "off"}) ${skPx ? meanLuma(img, skPx, SOCKET_LUMA_R * ppm).toFixed(1) : "?"}; at the plug centre (${plugPx ? plugPx.map(Math.round).join(",") : "off"}) ${plugPx ? meanLuma(img, plugPx, SOCKET_LUMA_R * ppm).toFixed(1) : "?"}`);
    // Evidence for the socket measure: how much of that circle the attached pieces (stalk, eyeball, plug) draw, and
    // its luma with them hidden (the carved crater alone).
    const sockPieces = diffShare(img, imgH, base.eL, SOCKET_LUMA_R * ppm);
    const sockBare = meanLuma(imgH, base.eL, SOCKET_LUMA_R * ppm);
    note(`eye pop (+40 frames, bleed off): eyeball r ${popR.toFixed(3)} (in the orbit ${out.glow?.inR?.toFixed(3) ?? "?"}); eyeball ${h2.eyeball.L ? f2(h2.eyeball.L) : "null"} (screen ${ebPx ? ebPx.map(Math.round).join(",") : "off"}), ${h2.socket.L && h2.eyeball.L ? distTo(h2.socket.L, h2.eyeball.L).toFixed(3) : "?"} m from the socket; iris red share ${iris.toFixed(3)}; orbit-circle luma ${sockL.toFixed(1)} vs painted baseline ${base.lumaL.toFixed(1)} — the pieces draw ${sockPieces === null ? "?" : (100 * sockPieces).toFixed(0)}% of that circle, and with them hidden it is ${sockBare?.toFixed(1)}; draws ${h2.draws}`);
    // The orbit circle with the stalk's screen footprint cut out (STALK_PAD): each rope capsule projected, its
    // radius in px measured at its own depth (a node and the node + r along the head's right).
    const caps = [];
    const nodes = h2.stalk?.L ?? [];
    const rt = rightOf(fr);
    for (let k = 0; k + 1 < nodes.length; k++) {
      const t = k / (nodes.length - 2 || 1), rr = STALK_R[0] + (STALK_R[1] - STALK_R[0]) * t;
      const a = await toPx(nodes[k]), b = await toPx(nodes[k + 1]);
      const e = await toPx(nodes[k].map((v, i) => v + rt[i] * rr));
      if (a && b && e) caps.push({ a, b, r: STALK_DRAWN * Math.hypot(e[0] - a[0], e[1] - a[1]) + STALK_PAD });
    }
    const discPx = h2.socket.L ? await toPx(plugCentre(fr, h2.socket.L)) : null;
    const cut = discPx ? lumaOutside(img, discPx, POP_DISC_R * ppm, caps) : { luma: NaN, n: 0, total: 0 };
    const cutBase = discPx ? lumaOutside(base.img0, discPx, POP_DISC_R * ppm, caps) : { luma: NaN, n: 0, total: 0 };
    note(`pop: the plug's ${POP_DISC_R * 100} cm disc (${discPx ? discPx.map(Math.round).join(",") : "off"}) with the stalk cut out (${caps.length} capsules × ${STALK_DRAWN} + ${STALK_PAD} px): ${cut.n}/${cut.total} px left (${(100 * cut.n / (cut.total || 1)).toFixed(0)}%), luma ${cut.luma.toFixed(1)} vs the painted face's same pixels ${cutBase.luma.toFixed(1)} (the whole circle, stalk included: ${sockL.toFixed(1)})`);
    out.pop = { iris, sockL, cut: cut.luma, cutBase: cutBase.luma, cutShare: cut.n / (cut.total || 1), baseL: base.lumaL };
    const r0 = hsPop.eyeR?.L ?? null;
    check(r0 !== null && r0 < 0.022 && Math.abs(popR - EYEBALL_R) < 1e-4, `pop: the eye leaves the orbit life-size and swells to the cartoon size — r ${r0?.toFixed(4) ?? "?"} on the strike frame (< 0.022), ${popR.toFixed(4)} at +40 frames (= EYEBALL_R ${EYEBALL_R})`);
    check(!!ebPx && iris >= IRIS_RED_MIN, `pop: the dangling eye's iris faces the camera — red share ${iris.toFixed(3)} on the eyeball circle (>= ${IRIS_RED_MIN})`);
    check(cut.n >= POP_MIN_SHARE * cut.total && cut.luma < SOCKET_DARK * base.lumaL, `pop: the socket round the stalk is a dark hole — the plug's disc less the stalk's footprint (${(100 * cut.n / (cut.total || 1)).toFixed(0)}% of it, >= ${100 * POP_MIN_SHARE}%) has luma ${cut.luma.toFixed(1)} (< ${SOCKET_DARK} × painted baseline ${base.lumaL.toFixed(1)} = ${(SOCKET_DARK * base.lumaL).toFixed(1)}, the snap's bar)`);
    await setBleed(true);
  }

  // -------- 3. the snap (the first brow hit), then the brow until dead
  const brains0 = (await brains()).length;
  let exposedAt = null, exposedRegion = null, brainAt = null, killChunks = null;
  let lastHs = null;
  let fr = await frameOf(id);
  for (let k = 0; k < 12; k++) {
    fr = await frameOf(id);
    await aimAt(fr, regionWorld(fr, HD.regions.brow));
    await stepN(2);
    const pre = await hstate(id);
    const ch0 = await chunks();
    // The snap (k 0): the eyes' flight is sampled from the strike frame on (eyeFlight), so no frames are stepped past it here.
    const r = await clickStrike(id, k === 0 ? 0 : 2);
    const sr = await struckRegion(id, fr);
    const hs = r.series[0].hs;
    lastHs = hs;
    note(`brow hit ${k + 1} = head hit ${hs.hits} (${r.last?.side}): struck nearest ${sr.region}; flesh ${fmtFlesh(hs)}; skull brow ${hs.skull.brow.toFixed(2)} crown ${hs.skull.crown.toFixed(2)}; eyes ${JSON.stringify(hs.eyes)}; dead ${hs.dead}; craters ${fmtCraters(hs)}`);
    if (k === 0) {
      check(pre.eyes.L === "dangling" && hs.eyes.L === "gone", `snap: the next head hit snaps the eye (eyes.L ${pre.eyes.L} -> ${hs.eyes.L})`);
      check(pre.eyes.L === "dangling" && pre.eyes.R === "dangling" && hs.eyes.L === "gone" && hs.eyes.R === "gone", `snap: the next head hit snaps BOTH eyes (eyes ${JSON.stringify(pre.eyes)} -> ${JSON.stringify(hs.eyes)})`);
      await eyeFlight(fr, pre);
      // The hole after the snap: the plug alone (the stalk no longer crosses it). Same measure as the pop's.
      await stepN(40);
      await faceStand(fr);
      await capture("v2-snapped");
      await setBleed(false);
      const img = await capture("v2-snapped-noblood");
      const h3 = await hstate(id);
      const skPx = h3.socket.L ? await toPx(h3.socket.L) : null;
      const sockL = meanLuma(img, base.eL, SOCKET_LUMA_R * ppm);
      const plugPx = h3.socket.L ? await toPx(plugCentre(fr, h3.socket.L)) : null;
      note(`snapped (+40 frames, bleed off): orbit-circle luma ${sockL.toFixed(1)} vs painted baseline ${base.lumaL.toFixed(1)}; at the traced socket point ${skPx ? meanLuma(img, skPx, SOCKET_LUMA_R * ppm).toFixed(1) : "?"}; at the plug centre (${plugPx ? plugPx.map(Math.round).join(",") : "off"}) ${plugPx ? meanLuma(img, plugPx, SOCKET_LUMA_R * ppm).toFixed(1) : "?"}; draws ${h3.draws} (the two plugs)`);
      check(h3.draws === 2, `snap: both sockets keep their plug (draws ${h3.draws}, 2)`);
      out.snapSocket = sockL;
      check(sockL < SOCKET_DARK * base.lumaL, `snap: the orbit stays a dark hole — orbit-circle luma ${sockL?.toFixed(1)} (< ${SOCKET_DARK} × painted baseline = ${(SOCKET_DARK * base.lumaL).toFixed(1)})`);
      await setBleed(true);
    }
    if (exposedAt === null) {
      const reg = ["brow", "crown", "cheekL", "cheekR"].find((q) => hs.flesh[q] < HD.skullExposed) ?? null;
      if (reg) { exposedAt = hs.hits; exposedRegion = reg; }
    }
    if (hs.dead) {
      brainAt = hs.hits;
      let maxCh = Math.max(ch0, ...r.series.map((q) => q.chunks));
      // v2-brain.png: 3 frames after the strike, the view pitched up to halfway between the head and the brain.
      const b2 = (await brains()).at(-1);
      if (b2) {
        const pp = await evaluate("__sdfGame.pose()");
        const mid = [(fr.centre[0] + b2[0]) / 2, (fr.centre[1] + b2[1] + 0.08) / 2, (fr.centre[2] + b2[2]) / 2];
        const hz = Math.hypot(mid[0] - pp.pos[0], mid[2] - pp.pos[2]);
        await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw}, ${Math.atan2(mid[1] - EYE_H - pp.pos[1], hz)}, ${pp.pos[1]})`);
      }
      await stepOne();
      maxCh = Math.max(maxCh, await chunks());
      const img = await capture("v2-brain");
      const c = await toPx(fr.centre);
      note(`v2-brain (+3 frames): brain mesh at ${b2 ? f2(b2) : "none"}; red (blood) share in a 220 px crop on the head ${c ? (100 * redShare(img, c[0], c[1])).toFixed(1) : "?"}%`);
      for (let j = 3; j < 10; j++) { await stepOne(); maxCh = Math.max(maxCh, await chunks()); }
      killChunks = [ch0, maxCh];
      break;
    }
    if (exposedAt === hs.hits) {
      // v2-skull.png: the hit that exposed the skull, settled; the face stand (brow) or the crown stand from above.
      await stepN(60);
      let c = null;
      if (exposedRegion === "brow") { await faceStand(fr); c = await toPx(regionWorld(fr, HD.regions.brow)); }
      else { const cs = await crownStand(id); c = await toPx(cs.target); }
      await capture("v2-skull");
      await setBleed(false);
      const img = await capture("v2-skull-noblood");
      const b3 = c ? boneIn(img, c, 0.03 * ppm) : null;
      note(`skull exposed on head hit ${hs.hits} (${exposedRegion}${exposedRegion === "crown" ? ", photo from above" : ""}): bone-coloured share in a 3 cm circle on the ${exposedRegion} crater (bleed off) ${b3?.toFixed(3)} (the fat band is tan too — printed only); ${exposedRegion} crater ${JSON.stringify(hs.craters[exposedRegion])}`);
      await setBleed(true);
    }
    await stepN(20);
  }
  out.kill = brainAt; out.exposedAt = exposedAt;
  check(exposedAt !== null && brainAt !== null && exposedAt < brainAt, `skull before brain: the skull was exposed on head hit ${exposedAt} (${exposedRegion}), the brain came on head hit ${brainAt}`);
  check(brainAt !== null && brainAt >= KILL_HITS_MIN && brainAt <= KILL_HITS_MAX, `kill: dead on head hit ${brainAt ?? "never (" + lastHs?.hits + " hits)"} (${KILL_HITS_MIN}–${KILL_HITS_MAX})`);
  const brainsN = await brains();
  check(brainsN.length === brains0 + 1, `brain: exactly one brain mesh gib (${brains0} -> ${brainsN.length})`);
  check(!!killChunks && killChunks[1] >= killChunks[0] + BRAIN_CHUNKS_MIN, `brain: live SDF chunks up by ${killChunks ? killChunks[1] - killChunks[0] : "?"} over the killing hit (>= ${BRAIN_CHUNKS_MIN}: lumps + skull chips)`);

  // -------- 5. body wounds and head slots, read BEFORE the thaw
  const wFinal = await wounds(id);
  const missing = bodyWounds.filter((b) => !wFinal.some((w) => distTo(w.pos, b.pos) <= 1e-3));
  check(missing.length === 0, `body wounds survive: ${bodyWounds.length - missing.length}/${bodyWounds.length} still present within 1 mm`);
  const slots = await headSlots(id);
  out.slots = slots.length;
  note(`head wound slots: ${slots.length} — ${slots.map((w) => `${w.headRegion ?? "?"}/${w.headSlot} r${w.radius.toFixed(3)}`).join(", ")}`);
  check(slots.length <= MAX_HEAD_SLOTS, `head wound slots used: ${slots.length} (<= ${MAX_HEAD_SLOTS})`);
  // -------- 4. thaw 3 frames
  await evaluate("__sdfGame.freeze(false)");
  await stepN(3);
  const al = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id);
  await evaluate("__sdfGame.freeze(true)");
  const headAlive = await evaluate(`__sdfGame.flail.limbAlive(${id}, "head")`);
  check(al && al.phase !== "standing", `kill: the zombie collapses (phase ${al?.phase})`);
  check(headAlive > 0, `the head is still on (${headAlive} live head prims)`);
  // -------- 5b. the brain at rest, 1.5 s after the strike (13 frames so far)
  await stepN(90 - 13);
  const restA = await brains(); await stepN(6); const restB = await brains();
  const bA = restA.at(-1), bB = restB.at(-1);
  const moved = bA && bB ? distTo(bA, bB) : null;
  check(!!bB && bB[1] <= BRAIN_REST_MAX_Y && moved !== null && moved < 0.002, `brain +1.5 s: rests on the floor at ${bB ? f2(bB) : "none"} (y <= ${BRAIN_REST_MAX_Y}; moved ${moved?.toFixed(4)} m over 6 frames, < 0.002)`);
  if (bB) {
    const pp = await evaluate("__sdfGame.pose()");
    const ax = pp.pos[0] - bB[0], az = pp.pos[2] - bB[2], l = Math.hypot(ax, az) || 1;
    const x = bB[0] + (ax / l) * 0.45, z = bB[2] + (az / l) * 0.45;
    await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yawOf(bB[0] - x, bB[2] - z)}, ${Math.atan2(bB[1] - EYE_H, 0.45)}, 0)`);
    const fov0 = (await evaluate("__sdfGame.setRenderFov(NaN)")).renderFovDeg;
    await evaluate("__sdfGame.setRenderFov(20)");
    await stepOne();
    await centreOn(bB);
    await capture("v2-brain-rest");
    await evaluate(`__sdfGame.setRenderFov(${fov0})`);
  }
  // -------- 5c. flesh bits never evict an eye
  {
    const eyes0 = (await evaluate("__sdfGame.head.eyeGibs()")).map((g) => g.id).sort();
    const tags = () => evaluate("__sdfGame.flail.chunkTags()");
    const t0 = await tags();
    const maxc0 = (await evaluate("__sdfGame.dynamiteTuning()")).maxchunks;
    const budget = Math.max(1, t0.views - t0.spare);
    await evaluate(`__sdfGame.setDynamiteTuning({ maxchunks: ${budget} })`);
    await evaluate("__sdfGame.flail.setFleshBits(true)");
    const z2 = fresh();
    let eyesKept = true, maxViews = 0, maxFlesh = 0, thrown = 0, landed = 0;
    for (let n = 0; n < 8; n++) {
      const t = await torsoOf(z2.id);
      await place(standOff(t, 1.3), Math.atan2(t[1] - EYE_H, 1.3));
      await evaluate("__sdfGame.setAimPoint(0, 0)");
      await stepN(24);
      const a = await tags();
      const r = await clickStrike(z2.id, 6);
      if (r.last?.hits?.includes(z2.id)) landed++;
      const b = await tags();
      thrown += Math.max(0, b.flesh - a.flesh);
      const eyes = (await evaluate("__sdfGame.head.eyeGibs()")).map((g) => g.id).sort();
      if (JSON.stringify(eyes) !== JSON.stringify(eyes0)) eyesKept = false;
      maxViews = Math.max(maxViews, b.views); maxFlesh = Math.max(maxFlesh, b.flesh);
      note(`flesh hit ${n + 1} (${r.last?.side}): ${JSON.stringify(b)}; eye gibs ${JSON.stringify(eyes)}`);
    }
    await evaluate("__sdfGame.flail.setFleshBits(false)");
    await evaluate(`__sdfGame.setDynamiteTuning({ maxchunks: ${maxc0} })`);
    check(eyes0.length === 2 && eyesKept, `flesh: both snapped eye gibs (${JSON.stringify(eyes0)}) survive ${landed} flesh-throwing body hits with the chunk budget full (${budget} views)`);
    check(maxViews <= Math.max(budget, t0.views) && maxFlesh <= 24, `flesh: views stay within the budget (max ${maxViews}, budget ${budget}, ${t0.views} before) and live flesh <= 24 (max ${maxFlesh})`);
  }
  // -------- 6. cost
  const noise = Math.abs(out.base1 - out.base2);
  const delta = out.withEye - (out.base1 + out.base2) / 2;
  note(`draw time (median of 120, fenced): baseline ${out.base1.toFixed(2)} / ${out.base2.toFixed(2)} ms (noise ${noise.toFixed(2)}), both eyes dangling ${out.withEye.toFixed(2)} ms; delta ${delta.toFixed(2)} ms`);
  check(delta <= COST_MAX_MS, `cost: frame time with both eyes dangling ${delta.toFixed(2)} ms over the same stand before any head hit (<= ${COST_MAX_MS})`);
} finally { closeSession(S); }

// ---- 7. console
const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
const warns = consoleEvents.filter((e) => e.type === "warning" && /head-damage|sdf-game/.test(e.text));
for (const w of warns) note(`console warning [${w.label}]: ${w.text.slice(0, 200)}`);
check(errs.length === 0, `zero console errors or exceptions (${errs.length}${errs.length ? ": " + JSON.stringify(errs.slice(0, 3)) : ""})`);
console.log(`\nsummary: ${JSON.stringify(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
