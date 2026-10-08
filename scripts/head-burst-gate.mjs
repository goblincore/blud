// scripts/head-burst-gate.mjs — what a gun round does to a zombie's head (head-burst.ts headShotRule,
// decapitationRule; webgpu/game-head-shot.ts; the actor's pop). REAL rounds through __sdfGame.fire() and fireSlug()
// on the bare ring page (/sdf-game.html, no ?level), frozen zombies, nine boots. Seven draw the default skull (no
// skull parameter: the sculpted skull, `full`); the two whose checks are the anatomical skull's ask for it
// (`?skull=anatomical`). Each boot checks that it draws the skull it means to.
//
// WHAT IS ON SCREEN IS CHECKED IN PIXELS, not only in the CPU's lists: a frame as the game draws it against the same
// frame with one thing taken out (a body's flesh, the skull's fragment gibs) says where that thing is on screen. The
// flesh is drawn by the march and is in no list: a lip left standing over a stump shows nowhere else.
//
// A SLUG IS AIMED, NOT LAID. The split is a reward for a precise AIM from close to medium range: the rule reads the
// crosshair's ray recorded as the gun fired (how far it passes from the head's centre, and from how far), not where
// the slug lands, which is about 10 cm under the crosshair. So the split's scenarios lay the CROSSHAIR
// (crosshairOn: the player placed in front of the face and turned so the reticle is on a point of the head; no
// stance is solved for the slug), and each checks the aim the leaf recorded against the crosshair's ray read off the
// page before the shot.
//
// BOOT 1, the shipped rules (the default skull), all on the shipped tuning:
//   NP. pellet volleys on a head never open or split it: ordinary craters, no split, no head-leaf state, the head on.
//   AIM. a slug fired with the crosshair on the head's centre from 2 m is PRECISE (its recorded aim passes through
//       the centre, its range is 2 m) though its own line runs most of a head radius off, and it splits the head,
//       BOTH halves. The aim a slug records is the crosshair ON SCREEN: its ray, drawn through the frame's camera
//       and lens, is at the picture's centre.
//   O.  an IMPRECISE slug (the crosshair 6 cm over the head's centre, twice the precise zone's radius; the slug still
//       lands on the head) is an ORDINARY slug wound.
//   FAR. a PRECISE slug from beyond splitRangeM (the crosshair on the head's centre from 6 m) is an ORDINARY slug
//       wound.
//   S.  a precise slug whose crosshair is 2 cm to one side of the centre (inside the precise zone; an axe chop that
//       far off the middle line peels one half) SPLITS the head, BOTH HALVES: the head split's state at the middle
//       preset's two-sided full angle on the head's middle line, the pose's split turned that far both ways, the
//       skull drawn as clipped copies for the rest and each half, the field open where each half was, its two cut
//       faces, the zombie alive. The splitting slug is not an ordinary hit on the skull: no eye is knocked out. ON
//       SCREEN the head's middle line is flesh before the shot and the room behind it after, with a half of flesh
//       to each side.
//   X.  a slug on the split head POPS it WITHOUT precision (the crosshair 6 cm off the centre, in range): the
//       sculpted skull's ten fragments are thrown, and are ON SCREEN (the frame changes where they are when they
//       are taken out of it).
//   OFF. burstTune({ on: false }): a precise slug is an ordinary wound.
// BOOT 1a, THE RANGES:
//   R.  the crosshair on the head's centre from 1, 2, 4 and 4.9 m, and once 3 cm under it from 2 m: each aimed slug
//       splits the head. Where the slug lands (about 10 cm under the crosshair) decides nothing.
// BOOT 1b, the ANATOMICAL skull (`?skull=anatomical`), the pop on a page of its own:
//   D.  slugs at the neck until the head comes off: the head SWELLS for popSwellS and bursts, no flying head; the
//       anatomical skull's fourteen plates are all released as fragments, the head segment and its eyes are not
//       drawn, and 2.5 s on nothing is left at the old head position.
//   D0. popSwellS 0 bursts with no swell frame.
// BOOT 1c, the ANATOMICAL skull again, the split and its pop on a page of their own:
//   SA, XA. S's skull and X, on the plates: a precise slug splits the head and the skull is drawn as clipped
//       copies on the plates' split material, no plate broken and no eye knocked out by the slug that split it; a
//       second slug pops it and the split skull's plates are thrown.
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
// BOOT 3, the pop on the default skull, on a page of its own:
//   DS. the decapitating slug pops the head: the sculpted head mesh is thrown as ten fragments (sculpt-fragments.ts),
//       the head segment and its eyes are not drawn, nothing is left at the old head position; and NOTHING FLOATS
//       OVER THE STUMP: from four sides the old head's place on screen holds none of the body's flesh.
// BOOT 3a, the flying heads:
//   FS. with slugPop off the same slugs send the head flying, and nothing floats over the stump.
//   FP. pellet volleys at the neck take the head off. What stands in the old head's place then is measured and not
//       held: the neck's base is left on the shoulders, a collar of real flesh.
// BOOT 3b, the lip rule switched off (`__sdfGame.head.stumpLips(false)`), the floating check's control:
//   FL0. the same decapitation leaves the stump's lip standing in the slug's crater, and the check SEES it.
// BOOT 4, the cultist (`?spawn=cultist`: every zombie slot a cultist), on the default skull. He is one of the eight
// humanoids whose head bone is a few balls, and draws the ANATOMICAL skull fitted to his own flesh (skeleton-spike/
// skull-cast.ts), while the page's skull stays the sculpted one:
//   CU. the page lists him among the characters that draw the plates, under his fit, and the fit was made as he was
//       spawned; his skull's box fills the share of his head the table states (0.8 or more each way); its orbits
//       are level with his ember eyes and his eyes are drawn seated in them, sized from them; his head is drawn on
//       the plates' material; real pellets at his face break a plate off; his head's pop releases all fourteen
//       plates, and the sculpted skull's fragments are never cut.
// E. zero console errors / exceptions, over all nine.
// Photos are written to OUT for the look loop. Usage:
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   node scripts/head-burst-gate.mjs 5241 9241
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const OUT = process.env.OUT ?? "docs/dev-notes/2026-10-02-head-burst/gate";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62, STAND = 0.9, PHOTO_D = 0.55, SHOT_D = 2;
const CENTRE_FRAC = 0.35, SWELL_PEAK_MIN = 0.2, SHARD_CHUNKS_MIN = 8, GLANCE_SHIFT = 0.07;
// The crosshair's places: off the centre by twice the precise zone's radius (imprecise), a little to one side of it
// (precise, and past the 15% of the half-width inside which an axe chop opens both halves), and the far stance.
const IMPRECISE_M = 0.06, PRECISE_SIDE_M = 0.02, FAR_D = 6;
// The split's and the pop's slugs are fired from straight in front of the face (0 degrees round the head from its
// own forward): the split's plane holds the shot and the head's up axis, so that is the shot that parts the head
// left and right. FAR's is fired from toward the room's centre, where there is room to stand 6 m off.
const FRONT = 0;
// ONLY=rules,pop runs those boots alone (for a look at one scenario; the gate is the whole run, and says which boots
// it ran). The boots: rules, ranges, anatomical, anatomical-split, opening, pop, flying, lips-off, cultist.
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const runs = (boot) => !ONLY || ONLY.has(boot);
const ran = [];
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
/** The pixel differs between two frames by more than `t` in some channel. */
const differs = (a, b, x, y, t = 14) => { const i = (y * a.w + x) * a.ch; return Math.abs(a.data[i] - b.data[i]) > t || Math.abs(a.data[i + 1] - b.data[i + 1]) > t || Math.abs(a.data[i + 2] - b.data[i + 2]) > t; };
const lum = (img, i) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
/** A pixel the BODY draws: it changes when the body's flesh is taken out of the frame, and the change is not the
 *  body's shadow leaving a lit surface (a shadow darkens every channel by one factor; flesh changes the colour). */
function bodyPixel(shown, hidden, x, y) {
  if (x < 0 || y < 0 || x >= shown.w || y >= shown.h || !differs(shown, hidden, x, y)) return false;
  const i = (y * shown.w + x) * shown.ch, ls = lum(shown, i), lh = lum(hidden, i);
  if (lh > 24 && ls < lh) {
    const k = ls / lh;
    if ([0, 1, 2].every((c) => Math.abs(shown.data[i + c] - hidden.data[i + c] * k) <= 10)) return false;
  }
  return true;
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
/** A still frame for a pixel pair: the sim locked, re-rendered until the post chain's frames agree, then shot. */
async function still(name) {
  await evaluate("__sdfGame.setRenderLock(true)");
  for (let i = 0; i < 8; i++) await evaluate("__sdfGame.step(1, 1 / 60)");
  const s = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const buf = Buffer.from(s.result.data, "base64");
  if (name) { writeFileSync(`${OUT}/${name}.png`, buf); console.log(`  shot ${OUT}/${name}.png`); }
  return decodePng(buf);
}
/** Take actor `id`'s flesh out of the frame (its proxy box shrunk to nothing; its bone meshes stay), or put it back. */
const fleshShown = (id, on) => evaluate(`(() => {
  const v = __sdfGame.zombie(${id}).view, k = (window.__gateHidden ??= new Map());
  if (${on}) { const s = k.get(${id}); if (s) { v.uniforms.bodyHalf.value.copy(s.half); v.object.scale.copy(s.scale); k.delete(${id}); } }
  else if (!k.has(${id})) { k.set(${id}, { half: v.uniforms.bodyHalf.value.clone(), scale: v.object.scale.clone() }); v.uniforms.bodyHalf.value.multiplyScalar(1e-4); v.object.scale.multiplyScalar(1e-4); }
  v.syncRecord(); return 1; })()`);
/** THE SAME FRAME WITH AND WITHOUT A BODY'S FLESH: `shown` as the game draws it, `hidden` with actor `id`'s flesh
 *  out. bodyPixel() of the two says where that body's flesh is on screen. `bare`: every bone mesh and eye is out of
 *  BOTH frames (the pair then says where the flesh alone is, with no bone behind it to stand in for it). */
async function fleshPair(id, name, bare = false) {
  if (bare) await evaluate("__sdfGame.meshSkeletonShow({ bones: false, eyes: false, organs: false })");
  const shown = await still(name);
  await fleshShown(id, false);
  const hidden = await still(null);
  await fleshShown(id, true);
  if (bare) await evaluate("__sdfGame.meshSkeletonShow({ bones: true, eyes: true, organs: true })");
  return { shown, hidden };
}
// ---- Boot the bare ring page, frozen zombies -----------------------------------------------------------
let centre = [0, 0, 0], pool = [], usedZ = new Set();
/** The shipped tuning, read off the first page booted. */
const TUNING_DEFAULTS = {};
async function boot(label, query = "", character = null) {
  usedZ = new Set(); ran.push(label);
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
  // The cast: the zombies, or (a `?spawn=` boot) the actors whose skeleton was built as `character`.
  const zs = character === null ? (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie")
    : await evaluate(`__sdfGame.actorList().filter((z) => __sdfGame.skullDrawn(z.id)?.character === ${JSON.stringify(character)})`);
  if (!zs.length) die(`[${label}] no ${character ?? "zombie"} in the cast`);
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM);
  const room = (await evaluate("__sdfGame.rooms")).find((r) => r.id === ROOM);
  centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
  s.room = room.bounds;
  // Attached pieces (the flaps) are not drawn until the background gib warm is ready: wait for it.
  let wb = null;
  for (let i = 0; i < 400; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" || wb.gib === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 1 / 60)"); }
  if (wb?.gib !== "ready") die(`[${label}] the background gib warm is ${JSON.stringify(wb)}: attached pieces would never draw`);
  if (!("on" in TUNING_DEFAULTS)) Object.assign(TUNING_DEFAULTS, await evaluate("__sdfGame.head.burstTuning()"));
  console.log(`[${label}] ready; room ${ROOM} (${pool.length} ${character ?? "zombie"}s)`);
  await skullCheck(label, /skull=anatomical/.test(query) ? "anatomical" : "sculpt");
}
/** THE SKULL A BOOT DRAWS (__sdfGame.skeletonDiagnostics): the anatomical plates on the boot that asks for them, the
 *  sculpted skull in its default variant (`full`: the second sculpt, a 5 mm head cell, the second paint) on every
 *  other. A page that asked for the plates and did not get them falls back to the sculpted skull: that fails here. */
async function skullCheck(label, want) {
  const d = await evaluate("__sdfGame.skeletonDiagnostics()");
  const recipe = JSON.stringify(d.sculpt);
  if (want === "anatomical") check(d.skull === "anatomical", `[${label}] this boot asks for the anatomical skull and draws it (${d.skull})`);
  else check(d.skull === "sculpt" && d.sculptVariant === "full" && d.sculpt.shape === 2 && d.sculpt.headCell === 0.005 && d.sculpt.paint === 2,
    `[${label}] this boot names no skull and draws the default: the sculpted skull, full (${d.skull}, ${d.sculptVariant}, ${recipe})`);
}
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
/** A world point on the screenshot (the lens included), or null behind the camera. */
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? ndcPx(n) : null; };
/** The camera `dist` m from the world point `c`, `yawDeg` round it from the direction `front` (a unit vector on the
 *  floor), at the player's eye height, looking at it. The player is not moved. */
async function camAbout(c, front, yawDeg, dist) {
  const a = yawDeg * Math.PI / 180, d = [front[0] * Math.cos(a) + front[2] * Math.sin(a), 0, -front[0] * Math.sin(a) + front[2] * Math.cos(a)];
  const e = [c[0] + d[0] * dist, EYE_H, c[2] + d[2] * dist], v = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
  await evaluate(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${yawOf(v[0], v[2])}, ${Math.atan2(v[1], Math.hypot(v[0], v[2]))}, 0)`);
  await evaluate("__sdfGame.step(1, 0)");
  await evaluate("__sdfGame.refreshHull()");
}
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
  // The crosshair's own ray, as a slug fired now would record it (__sdfGame.aimRay): how far it passes from the
  // head's centre, in head radii, and how far the eye is from the head. The gate's own arithmetic, not the leaf's.
  const ray = await evaluate("__sdfGame.aimRay()");
  const ta = Math.max(0, (head[0] - ray.eye[0]) * ray.dir[0] + (head[1] - ray.eye[1]) * ray.dir[1] + (head[2] - ray.eye[2]) * ray.dir[2]);
  const ap = [ray.eye[0] + ray.dir[0] * ta, ray.eye[1] + ray.dir[1] * ta, ray.eye[2] + ray.dir[2] * ta];
  const inRoom = S.room ? ray.eye[0] > S.room.minX && ray.eye[0] < S.room.maxX && ray.eye[2] > S.room.minZ && ray.eye[2] < S.room.maxZ : null;
  return { head, R, quat: fr.quat, ray, front: [fx, 0, fz], offset: Math.hypot(cp[0] - head[0], cp[1] - head[1], cp[2] - head[2]) / R, actor: pr.actorId,
    aimOffset: Math.hypot(ap[0] - head[0], ap[1] - head[1], ap[2] - head[2]) / R, rangeM: Math.hypot(ray.eye[0] - head[0], ray.eye[1] - head[1], ray.eye[2] - head[2]), inRoom };
}
/** The leaf's verdict carries the aim the slug was fired with: the same numbers the gate read off the crosshair
 *  before the shot (to 0.02 head radii and 2 cm: the head does not move, the cast is frozen). */
const aimKept = (v, aim) => !!v && v.aimOffset !== null && v.rangeM !== null && Math.abs(v.aimOffset - aim.aimOffset) < 0.02 && Math.abs(v.rangeM - aim.rangeM) < 0.02;
const aimSays = (v) => (v ? `aim ${v.aimOffset === null ? null : v.aimOffset.toFixed(3)} head radii off centre from ${v.rangeM === null ? null : v.rangeM.toFixed(2)} m, the slug's own line ${v.offset.toFixed(3)}` : "no verdict");
/** A unit vector of the head's own frame in the world (its right is [1, 0, 0]). */
const headAxis = (q, v) => { const [x, y, z, w] = q, [a, b, c] = v, tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a); return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx]; };
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
  const swell = []; let off = -1;
  for (let k = 0; k < frames; k++) {
    await stepOne();
    if (await evaluate(`__sdfGame.head.popping(${id})`)) swell.push(k);
    if (off < 0 && !(await headOn(id))) off = k;
  }
  return { swell, off, fragments: (await fragments()) - f0 };
}
/** THE RECORDED AIM IS THE ON-SCREEN CROSSHAIR. `aim` is crosshairOn's answer: the page's own aim ray (what a slug
 *  fired now records), which the stance laid through the head. Where that ray is at the head's range, drawn through
 *  the frame's camera and lens, against the crosshair's pixel: the picture's centre (the reticle is held at the aim
 *  point 0, 0). Returns the distance in screenshot pixels, and the precise zone's radius there for scale. */
async function aimOnScreen(aim) {
  await evaluate("__sdfGame.step(1, 0)");
  const at = [aim.ray.eye[0] + aim.ray.dir[0] * aim.rangeM, aim.ray.eye[1] + aim.ray.dir[1] * aim.rangeM, aim.ray.eye[2] + aim.ray.dir[2] * aim.rangeM];
  const p = await toPx(at), edge = await toPx([at[0], at[1] + TUNING_DEFAULTS.splitFrac * aim.R, at[2]]);
  const cx = S.rect.x + S.rect.w / 2, cy = S.rect.y + S.rect.h / 2;
  return { px: p ? Math.hypot(p[0] - cx, p[1] - cy) : Infinity, zonePx: p && edge ? Math.hypot(edge[0] - p[0], edge[1] - p[1]) : 0 };
}
/** Actor `id`'s seated eyes: how many a round has knocked out (the bone renderer's own count), and how many are drawn. */
const eyesOf = (id) => evaluate(`(() => { const e = __sdfGame.meshEyeState(${id}), d = __sdfGame.skullDrawn(${id}); return { missing: e ? e.missing.length : -1, debris: e ? e.debris : -1, drawn: d ? d.copies.filter((c) => c.eye).length + d.whole.filter((c) => c.eye).length : 0 }; })()`);
/** The stump wound of actor `id`'s last sever, in the world (null: none). */
const stumpOf = (id) => evaluate(`(async () => { const D = await import("/src/lab/sdf-zombie/damage.ts"); const a = __sdfGame.zombie(${id}), p = a.posed(), ws = a.woundList().filter((w) => w.injuryIgnored);
  const w = ws[ws.length - 1]; return w ? { pos: D.woundWorldPos(p.prims, w, a.pose().yaw), radius: w.radius, lip: w.rimScale ?? 1 } : null; })()`);
const OVER_VIEWS = [["front", 0], ["left", 90], ["back", 180], ["right", -90]];
/** NOTHING FLOATS OVER THE STUMP. The body is thawed for a moment (a frozen body a shot has moved is drawn clipped
 *  to where it stood) and frozen again; then, from four sides at 0.8 m, the frame as drawn against the same frame
 *  with the body's flesh out of it. The count is the body's flesh pixels in THE OLD HEAD'S PLACE on screen: 7 cm to
 *  either side of the stump's centre and from 8 to 24 cm over it, where a headless body has nothing. That flesh is
 *  drawn by the march and is in no CPU list: a lip left standing in a crater's hole shows here and nowhere else.
 *  `thaw` false: the cast has been thawed since the sever already. Returns the count from each side and the largest. */
async function overStump(tag, id, front, thaw = true) {
  if (thaw) { await evaluate("__sdfGame.freeze(false)"); await stepN(14); await evaluate("__sdfGame.freeze(true)"); await stepN(2); }
  const stump = await stumpOf(id);
  if (!stump) { fail(`${tag}: no stump wound on actor ${id}`); return { max: Infinity, views: {}, stump: null }; }
  const c = stump.pos, views = {};
  for (const [name, yaw] of OVER_VIEWS) {
    await camAbout([c[0], c[1] + 0.08, c[2]], front, yaw, 0.8);
    const { shown, hidden } = await fleshPair(id, `${tag}-over-${name}`);
    const p0 = await toPx(c), p1 = await toPx([c[0], c[1] + 0.1, c[2]]);
    if (!p0 || !p1) { views[name] = Infinity; continue; }
    const m = (p0[1] - p1[1]) / 0.1;
    let n = 0;
    for (let y = Math.round(p0[1] - 0.24 * m); y <= Math.round(p0[1] - 0.08 * m); y++) for (let x = Math.round(p0[0] - 0.07 * m); x <= Math.round(p0[0] + 0.07 * m); x++) if (bodyPixel(shown, hidden, x, y)) n++;
    views[name] = n;
  }
  return { max: Math.max(...Object.values(views)), views, stump };
}
/** Rounds at actor `id`'s neck until its head is off: the crosshair `under` m under the head's centre from `dist` m,
 *  `yawDeg` round it from its face. Returns how many it took (0: the head held), where the head was and its front. */
async function takeHeadOff(tag, id, round, under, dist, yawDeg, most = 8) {
  let at = null, front = null;
  for (let n = 1; n <= most; n++) {
    const aim = await crosshairOn(id, dist, [0, -under, 0], yawDeg);
    if (aim.actor !== id) fail(`${tag}: aim control: the round would hit actor ${aim.actor}, not ${id}`);
    at = aim.head; front ??= headAxis(aim.quat, [0, 0, 1]);
    let fired = false;
    for (let i = 0; i < 6 && !fired; i++) { await evaluate("__sdfGame.refillShells()"); fired = await evaluate(round); if (!fired) await stepN(90); }
    if (!fired) fail(`${tag}: ${round} never fired`);
    await stepN(40);
    if (!(await headOn(id))) return { rounds: n, at, front };
  }
  return { rounds: 0, at, front };
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
/** THE HEAD ACROSS, ON SCREEN: from 0.6 m straight in front of the face, with every bone mesh out of the frame, which
 *  points of three lines across the head (3, 5 and 7 cm over its centre, every centimetre from 14 cm left to 14 cm
 *  right of its middle line) are the body's flesh. `mid`: of the nine points within 1 cm of the middle line; `left`
 *  and `right`: of the 33 points 4 to 14 cm to each side. A closed head has flesh on the middle line; a head parted
 *  left and right has the room behind it there, and a half to each side. */
async function acrossHead(id, frame, name) {
  const f = headAxis(frame.quat, [0, 0, 1]), l = Math.hypot(f[0], f[2]) || 1;
  await camAbout(frame.centre, [f[0] / l, 0, f[2] / l], 0, 0.6);
  const { shown, hidden } = await fleshPair(id, name, true);
  const r = headAxis(frame.quat, [1, 0, 0]), u = headAxis(frame.quat, [0, 1, 0]), c = frame.centre;
  const got = { mid: 0, midN: 0, left: 0, right: 0, sideN: 0 };
  for (const t of [0.03, 0.05, 0.07]) for (let k = -14; k <= 14; k++) {
    const p = await toPx([c[0] + r[0] * k * 0.01 + u[0] * t, c[1] + r[1] * k * 0.01 + u[1] * t, c[2] + r[2] * k * 0.01 + u[2] * t]);
    const on = !!p && bodyPixel(shown, hidden, Math.round(p[0]), Math.round(p[1]));
    if (Math.abs(k) <= 1) { got.midN++; if (on) got.mid++; }
    else if (Math.abs(k) >= 4) { if (k < 0) { got.sideN++; if (on) got.left++; } else if (on) got.right++; }
  }
  return got;
}
// THE PIXEL CHECKS' BOUNDS, each beside the value this gate measured when it was set (screenshot pixels, 1280 x 800).
//   the aim on screen: the recorded aim's ray, drawn, within AIM_PX_MOST of the crosshair's pixel;
//   the split's halves: at least HALF_MIN of a side's 33 points are flesh;
//   the pop's fragments: at least FRAGMENT_PX_MIN pixels change when the fragments are taken out of the frame;
//   the old head's place (about 21,000 pixels from 0.8 m): at most OVER_MOST of them the body's flesh after a
//   decapitation, and at least OVER_SEEN with the lip rule off (the floating piece, seen).
// Measured when set: the aim 0.00 px off; 24 and 25 of 33 points a side; 5,422 pixels of fragments; 0 pixels in the old
// head's place after the pop and after the slug's flying head; 1,388 to 2,614 with the rule off.
const AIM_PX_MOST = 2, HALF_MIN = 12, FRAGMENT_PX_MIN = 1500, OVER_MOST = 40, OVER_SEEN = 1000;

try {
  // ======== BOOT 1: the shipped rules ========
  if (runs("rules")) {
  await boot("rules");
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

  // -------- AIM. A slug fired with the crosshair on the head's centre is precise, and splits the head, both halves.
  check(TUNING_DEFAULTS.splitAim === "crosshair" && TUNING_DEFAULTS.splitFrac > 0.15 && TUNING_DEFAULTS.splitFrac <= 0.4 && TUNING_DEFAULTS.splitRangeM >= 3 && TUNING_DEFAULTS.splitRangeM <= 6 && TUNING_DEFAULTS.popPrecise === false,
    `the shipped tuning: precision is the crosshair's (splitAim ${TUNING_DEFAULTS.splitAim}), within ${TUNING_DEFAULTS.splitFrac} head radii, from no farther than ${TUNING_DEFAULTS.splitRangeM} m; the pop of a split head needs no precision (popPrecise ${TUNING_DEFAULTS.popPrecise})`);
  const presets = await evaluate(`import("/src/lab/sdf-zombie/head-split.ts").then((m) => m.HEAD_SPLIT.presets.middle)`);
  const AIM = fresh();
  const aimed = await crosshairOn(AIM.id, SHOT_D, [0, 0, 0], FRONT);
  note(`AIM: crosshair on the head's centre from ${SHOT_D} m: its ray passes ${aimed.aimOffset.toFixed(3)} head radii from the centre (splitFrac ${TUNING_DEFAULTS.splitFrac}), the eye ${aimed.rangeM.toFixed(2)} m from the head; the slug's own line would pass ${aimed.offset.toFixed(3)} radii from it; it would hit actor ${aimed.actor}`);
  if (aimed.actor !== AIM.id) fail(`AIM: aim control: the slug would hit actor ${aimed.actor}, not ${AIM.id}`);
  const onScreen = await aimOnScreen(aimed);
  check(onScreen.px <= AIM_PX_MOST, `AIM: the aim a slug records is the crosshair on screen: its ray at the head's range is drawn ${onScreen.px.toFixed(2)} px from the picture's centre (<= ${AIM_PX_MOST}; the precise zone is ${onScreen.zonePx.toFixed(1)} px in radius there)`);
  await watchSlug(AIM.id, 8);
  const aimShot = await shotOf(AIM.id);
  check(aimKept(aimShot, aimed) && aimShot.aimOffset < TUNING_DEFAULTS.splitFrac && aimShot.rangeM <= TUNING_DEFAULTS.splitRangeM,
    `AIM: the slug carried the crosshair's ray it was fired with: ${aimSays(aimShot)} (the page's crosshair before the shot: ${aimed.aimOffset.toFixed(3)} radii, ${aimed.rangeM.toFixed(2)} m); precise (< ${TUNING_DEFAULTS.splitFrac}) and in range (<= ${TUNING_DEFAULTS.splitRangeM} m)`);
  check(!!aimShot && aimShot.offset > 0.5, `AIM: the slug itself landed far from where the crosshair was: its own line ran ${aimShot?.offset?.toFixed(3)} head radii off centre (> 0.5; the slug lands under the crosshair), which no longer decides anything`);
  const aimSt = await splitOf(AIM.id);
  check(aimShot?.rule === "split" && aimShot.took === true && aimSt !== null, `AIM: it splits the head (${JSON.stringify(aimShot)})`);
  check(aimSt?.preset === "middle" && aimSt.sides === 0 && aimSt.offset === 0 && Math.abs(aimSt.target - presets.maxBoth * TUNING_DEFAULTS.splitOpen) < 1e-12,
    `AIM: both halves open, on the head's middle line: the middle preset, both sides, the plane through the head's centre, toward the two-sided full angle (${aimSt ? `${aimSt.preset} sides ${aimSt.sides} offset ${aimSt.offset} target ${aimSt.target} of ${presets.maxBoth}` : null})`);

  // -------- O. an imprecise slug is ordinary: the crosshair IMPRECISE_M over the head's centre. The slug lands on
  // the face (about 10 cm under the crosshair), nearer the centre than AIM's did.
  const O = fresh();
  const oAim = await crosshairOn(O.id, SHOT_D, [0, IMPRECISE_M, 0], FRONT);
  if (oAim.actor !== O.id) fail(`O: aim control: the slug would hit actor ${oAim.actor}, not ${O.id}`);
  await watchSlug(O.id, 8);
  const oShot = await shotOf(O.id), oWounds = await headWounds(O.id);
  note(`O: verdict ${JSON.stringify(oShot)}; head wounds ${oWounds.map((w) => `${w.type} r${w.radius.toFixed(3)} ${w.shape}`).join(", ")}`);
  check(aimKept(oShot, oAim) && oShot.aimOffset >= TUNING_DEFAULTS.splitFrac && oShot.rangeM <= TUNING_DEFAULTS.splitRangeM,
    `O: the crosshair was ${(IMPRECISE_M * 100).toFixed(0)} cm over the head's centre: ${aimSays(oShot)}; imprecise (>= ${TUNING_DEFAULTS.splitFrac}), in range`);
  check(oShot?.rule === "ordinary" && oShot.kind === "slug" && oShot.took === false, `O: an imprecise slug on the head is ordinary, though its own line ran nearer the centre than AIM's (${oShot?.offset?.toFixed(3)} against ${aimShot?.offset?.toFixed(3)} radii)`);
  check(oWounds.length === 1 && oWounds[0].type === "blast" && oWounds[0].shape === "crater" && oWounds[0].headRegion === null && Math.abs(oWounds[0].radius - 0.16) < 1e-6, "O: it left one ordinary slug crater on the head (radius 0.16 m, no region, no cut)");
  check((await splitOf(O.id)) === null && (await hstate(O.id)) === null && await headOn(O.id), "O: no split, no head-leaf state, the head on");
  await stand(O.id, PHOTO_D); await capture("O-imprecise");

  // -------- FAR. a precise slug from beyond the range is ordinary: the crosshair on the head's centre from FAR_D.
  const FAR = fresh();
  const farAim = await crosshairOn(FAR.id, FAR_D, [0, 0, 0]);
  if (farAim.actor !== FAR.id) fail(`FAR: aim control: the slug would hit actor ${farAim.actor}, not ${FAR.id}`);
  if (farAim.inRoom !== true) fail(`FAR: stance control: ${FAR_D} m from the head toward the room's centre puts the eye outside the room`);
  await watchSlug(FAR.id, Math.ceil(FAR_D / SLUG_SPEED * 60) + 8);
  const farShot = await shotOf(FAR.id), farWounds = await headWounds(FAR.id);
  note(`FAR: verdict ${JSON.stringify(farShot)}; head wounds ${farWounds.map((w) => `${w.type} r${w.radius.toFixed(3)} ${w.shape}`).join(", ")}`);
  check(aimKept(farShot, farAim) && farShot.aimOffset < TUNING_DEFAULTS.splitFrac && farShot.rangeM > TUNING_DEFAULTS.splitRangeM,
    `FAR: the crosshair was on the head's centre from ${FAR_D} m: ${aimSays(farShot)}; precise (< ${TUNING_DEFAULTS.splitFrac}) and out of range (> ${TUNING_DEFAULTS.splitRangeM} m)`);
  check(farShot?.rule === "ordinary" && farShot.kind === "slug" && farShot.took === false, `FAR: a precise slug from beyond the range is ordinary (${JSON.stringify(farShot)})`);
  check(farWounds.length === 1 && farWounds[0].type === "blast" && farWounds[0].shape === "crater" && farWounds[0].headRegion === null
    && (await splitOf(FAR.id)) === null && (await hstate(FAR.id)) === null && await headOn(FAR.id), "FAR: it left one ordinary slug crater on the head: no split, no head-leaf state, the head on");

  // -------- S. a precise slug splits the head, both halves, to the full angle. The crosshair is PRECISE_SIDE_M to
  // the head's own right of its centre: inside the precise zone, and farther off the middle line than the split's
  // own rule opens both halves for (head-split.ts choosePreset, bothFrac of the half-width): handed that point, or
  // the slug's impact, the split would peel one half.
  const S1 = fresh();
  await stand(S1.id, PHOTO_D); await capture("S-before");
  const sFrame = await evaluate(`__sdfGame.head.frame(${S1.id})`);
  // The closed head from the front, in pixels: flesh on its middle line.
  const sClosed = await acrossHead(S1.id, sFrame, "S-closed-front");
  check(sClosed.mid === sClosed.midN, `S: before the shot the head's middle line is flesh on screen: ${sClosed.mid} of ${sClosed.midN} points (${sClosed.left} and ${sClosed.right} of ${sClosed.sideN} to each side)`);
  const sRight = headAxis(sFrame.quat, [1, 0, 0]), bothFrac = await evaluate(`import("/src/lab/sdf-zombie/head-split.ts").then((m) => m.HEAD_SPLIT.bothFrac)`);
  const sAim = await crosshairOn(S1.id, SHOT_D, [sRight[0] * PRECISE_SIDE_M, sRight[1] * PRECISE_SIDE_M, sRight[2] * PRECISE_SIDE_M], FRONT);
  if (sAim.actor !== S1.id) fail(`S: aim control: the slug would hit actor ${sAim.actor}, not ${S1.id}`);
  await watchSlug(S1.id, 8);
  const sShot = await shotOf(S1.id);
  check(aimKept(sShot, sAim) && sShot.aimOffset < TUNING_DEFAULTS.splitFrac && sShot.aimOffset * sAim.R > bothFrac * sFrame.axes[0],
    `S: the crosshair was ${(PRECISE_SIDE_M * 100).toFixed(0)} cm to one side of the head's centre: ${aimSays(sShot)}; precise (< ${TUNING_DEFAULTS.splitFrac}), and ${(sShot?.aimOffset * sAim.R * 1000).toFixed(1)} mm off the middle line, past the ${(bothFrac * sFrame.axes[0] * 1000).toFixed(1)} mm inside which a chop opens both halves`);
  check(sShot?.rule === "split" && sShot.took === true, `S: a precise slug splits (verdict ${JSON.stringify(sShot)})`);
  await stepN(150);   // the split's spring settles (the head-split gate: within about 60 frames)
  const st = await splitOf(S1.id);
  // The two-sided full angle: a precise slug from the front always opens both halves.
  const full = presets.maxBoth;
  check(st?.preset === "middle" && st.sides === 0 && st.offset === 0 && Math.abs(st.target - full * TUNING_DEFAULTS.splitOpen) < 1e-12 && st.angle === st.target && st.vel === 0,
    `S: the head split's state: the middle preset (a slug from the front parts the head left and right), BOTH halves, on the head's middle line, at the two-sided full angle and at rest (${st ? `${st.preset} sides ${st.sides} offset ${st.offset} angle ${st.angle} target ${st.target} of ${full}` : null})`);
  const warp = await evaluate(`(() => { const w = __sdfGame.zombie(${S1.id}).posed().split; return w ? { thetaP: w.thetaP, thetaM: w.thetaM, n: [...w.n] } : null; })()`);
  check(!!warp && !!st && st.angle > 0 && warp.thetaP === st.angle && warp.thetaM === -st.angle, `S: the pose's split turns both halves that far, opposite ways (${warp ? `${warp.thetaP.toFixed(4)} / ${warp.thetaM.toFixed(4)}` : null}; wanted ${st?.angle} / ${st ? -st.angle : null})`);
  await evaluate("__sdfGame.step(1, 0)");
  const drawn = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${S1.id}); return d ? { bones: d.copies.filter((c) => !c.eye).length, eyes: d.copies.filter((c) => c.eye).length, pieces: [...new Set(d.copies.filter((c) => !c.eye).map((c) => c.piece))].sort() } : null; })()`);
  check(!!drawn && [0, 1, 2].every((p) => drawn.pieces.includes(p)), `S: the skull is drawn broken with the split: clipped copies for the rest and for BOTH halves (${JSON.stringify(drawn)})`);
  // The slug that split the head never reached the skull's own hit path: no eye was knocked out, and both are drawn
  // in the split's copies.
  const sEyes = await eyesOf(S1.id);
  check(sEyes.missing === 0 && sEyes.debris === 0 && drawn?.eyes >= 2, `S: the splitting slug knocked no eye out: ${sEyes.missing} missing, ${sEyes.debris} flying, ${drawn?.eyes} eye copies drawn in the split head (2 or more)`);
  // THE GAP IS OPEN ON SCREEN, and both halves are there: the same points as before the shot.
  const sOpen = await acrossHead(S1.id, sFrame, "S-split-front");
  check(sOpen.mid <= 1, `S: the gap is open on screen: ${sOpen.mid} of ${sOpen.midN} points of the middle line are flesh now (at most 1; ${sClosed.mid} on the closed head)`);
  check(sOpen.left >= HALF_MIN && sOpen.right >= HALF_MIN, `S: both halves are on screen, one to each side of the gap: ${sOpen.left} and ${sOpen.right} of ${sOpen.sideN} points are flesh (${HALF_MIN} or more each)`);
  // The default skull's copies: the sculpted head's own mesh, on the bone's split material, under the second paint.
  const sCopies = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${S1.id}), c = d ? d.copies.filter((q) => !q.eye) : []; return { n: c.length, heads: c.filter((q) => q.head).length, materials: [...new Set(c.map((q) => q.material))], paints: [...new Set(c.map((q) => q.paint))] }; })()`);
  check(sCopies.n > 0 && sCopies.heads === sCopies.n && sCopies.materials.length === 1 && sCopies.materials[0] === "skeleton-bone-split" && sCopies.paints.length === 1 && sCopies.paints[0] === 2,
    `S: every copy is the sculpted head's mesh, on the bone's split material under the second paint (${sCopies.heads} of ${sCopies.n} copies the head; ${sCopies.materials.join(", ")}; paint ${sCopies.paints.join(", ")})`);
  // The field where each half used to be: 6 cm over the head's centre and 3.5 cm to each side of the split's plane,
  // which runs through the head's centre. Flesh on the closed head; empty now that both halves have swung away.
  const past = 0.035;
  const thereOf = (side) => evaluate(`(async () => { const V = await import("/src/lab/sdf-zombie/validate.ts"); const f = __sdfGame.head.frame(${S1.id}), w = __sdfGame.zombie(${S1.id}).posed().split, b = __sdfGame.zombie(${S1.id}).posed();
    const c = [f.centre[0], f.centre[1] + 0.06, f.centre[2]];
    const s = w.d0 - (w.n[0] * c[0] + w.n[1] * c[1] + w.n[2] * c[2]) + ${side} * ${past};
    const q = [c[0] + w.n[0] * s, c[1] + w.n[1] * s, c[2] + w.n[2] * s];
    return { open: V.sdBody(q, b), closed: V.sdBodyClosed(q, b), offset: w.d0 - (w.n[0] * f.centre[0] + w.n[1] * f.centre[1] + w.n[2] * f.centre[2]) }; })()`);
  for (const side of [1, -1]) {
    const there = await thereOf(side);
    check(there.closed < 0 && there.open > 0, `S: the field is open where the ${side > 0 ? "+" : "-"} half was: ${(there.open * 1000).toFixed(1)} mm clear of any flesh, at a point ${(-there.closed * 1000).toFixed(1)} mm inside the closed head (${(past * 1000).toFixed(0)} mm to that side of the split's plane, which is ${(there.offset * 1000).toFixed(1)} mm off the head's centre)`);
  }
  const faces = (await headWounds(S1.id)).filter((w) => w.shape === "cut" && (w.headRegion === "split+" || w.headRegion === "split-"));
  check(faces.length === 2 && new Set(faces.map((w) => w.headRegion)).size === 2 && (await hstate(S1.id)) === null, `S: the slug's wound is the split's two cut faces, one per half (${faces.map((w) => w.headRegion).join(", ")}), and the head leaf holds nothing for it (no opening)`);
  await stand(S1.id, PHOTO_D); await capture("S-split");
  await evaluate("__sdfGame.freeze(false)"); await stepN(3);
  const alS1 = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === S1.id);
  check(alS1?.phase === "standing" && await headOn(S1.id), `S: the zombie lives, its head on (thawed 3 frames: phase ${alS1?.phase})`);
  await evaluate("__sdfGame.freeze(true)");

  // -------- X. a slug on the split head pops it, and needs no precision: the crosshair IMPRECISE_M over the
  // centre again, where O's slug was an ordinary wound on a closed head.
  const xAim = await crosshairOn(S1.id, SHOT_D, [0, IMPRECISE_M, 0], FRONT);
  if (xAim.actor !== S1.id) fail(`X: aim control: the slug would hit actor ${xAim.actor}, not ${S1.id}`);
  const f0 = await fragments();
  const x = await watchSlug(S1.id, 24);
  const xShot = await shotOf(S1.id);
  note(`X: ${aimSays(xShot)}; verdict ${JSON.stringify(xShot)}; swell frames ${JSON.stringify(x.swell)}, head off on frame ${x.off}, ${(await fragments()) - f0} fragments`);
  check(aimKept(xShot, xAim) && xShot.aimOffset >= TUNING_DEFAULTS.splitFrac && xShot.rangeM <= TUNING_DEFAULTS.splitRangeM,
    `X: the crosshair was ${(IMPRECISE_M * 100).toFixed(0)} cm over the split head's centre: ${aimSays(xShot)}; imprecise (>= ${TUNING_DEFAULTS.splitFrac}), in range`);
  check(xShot?.rule === "pop" && xShot.took === true, `X: a slug on the split head is the pop's, precise or not (${JSON.stringify(xShot)})`);
  check(x.swell.length > 0 && x.off === x.swell[x.swell.length - 1] + 1 && !(await headOn(S1.id)), `X: the open head swells and bursts (swell on ${x.swell.length} frames, off on frame ${x.off})`);
  check((await fragments()) - f0 >= 10, `X: the split skull's pieces are thrown (${(await fragments()) - f0} fragments)`);
  // THE FRAGMENTS ARE ON SCREEN: the frame as drawn against the same frame with the fragment gibs out of it.
  {
    await camAbout(xAim.head, xAim.front, 0, 1.8);
    const with_ = await still("X-fragments");
    const hid = await evaluate("__sdfGame.skullFragmentsShow(false)");
    const without = await still(null);
    await evaluate("__sdfGame.skullFragmentsShow(true)");
    let changed = 0;
    for (let y = 0; y < with_.h; y++) for (let x = 0; x < with_.w; x++) if (differs(with_, without, x, y)) changed++;
    check(hid >= 10 && changed >= FRAGMENT_PX_MIN, `X: the skull's fragments are on screen: ${changed} pixels change when the ${hid} fragment gibs are taken out of the frame (${FRAGMENT_PX_MIN} or more)`);
  }

  // -------- OFF. the master switch.
  await tune({ on: false });
  const OFF = fresh();
  const offAim = await crosshairOn(OFF.id, SHOT_D, [0, 0, 0], FRONT);
  if (offAim.actor !== OFF.id) fail(`OFF: aim control: the slug would hit actor ${offAim.actor}, not ${OFF.id}`);
  await watchSlug(OFF.id, 8);
  check((await splitOf(OFF.id)) === null && (await hstate(OFF.id)) === null && (await headWounds(OFF.id)).some((w) => w.type === "blast" && w.shape === "crater"),
    "OFF: with burstTune({ on: false }) a precise slug is an ordinary slug crater: no split, no opening");
  await tune({ on: true });
  closeSession(S);
  }

  // ======== BOOT 1a: THE RANGES. An aimed slug splits the head from anywhere inside splitRangeM: the crosshair on the
  // head's centre from 1, 2, 4 and 4.9 m, each on a fresh zombie, and once low in the precise zone. The slug lands
  // about 10 cm under the crosshair, at the edge of the head ellipsoid's old reach: where it lands decides nothing.
  if (runs("ranges")) {
  await boot("ranges");
  for (const [d, aimAt, tag] of [[1, [0, 0, 0], "R1"], [2, [0, 0, 0], "R2"], [4, [0, 0, 0], "R4"], [4.9, [0, 0, 0], "R4.9"], [2, [0, -0.03, 0], "RL"]]) {
    const R = fresh();
    // From in front of the face where the room allows it, else from toward the room's centre.
    let aim = await crosshairOn(R.id, d, aimAt, FRONT);
    if (aim.inRoom !== true || aim.actor !== R.id || Math.abs(aim.rangeM - d) > 0.05) aim = await crosshairOn(R.id, d, aimAt);
    if (aim.actor !== R.id) fail(`${tag}: aim control: the slug would hit actor ${aim.actor}, not ${R.id}`);
    if (aim.inRoom !== true) fail(`${tag}: stance control: ${d} m from the head puts the eye outside the room`);
    await watchSlug(R.id, Math.ceil(d / SLUG_SPEED * 60) + 8);
    const v = await shotOf(R.id), st = await splitOf(R.id);
    check(aimKept(v, aim) && v.aimOffset < TUNING_DEFAULTS.splitFrac && Math.abs(v.rangeM - d) < 0.06 && v.rangeM <= TUNING_DEFAULTS.splitRangeM,
      `${tag}: the crosshair ${aimAt[1] ? `${(-aimAt[1] * 100).toFixed(0)} cm under` : "on"} the head's centre from ${d} m: ${aimSays(v)}; precise and in range`);
    check(v?.rule === "split" && v.took === true && st !== null && (await headOn(R.id)), `${tag}: the aimed slug from ${d} m splits the head (${JSON.stringify(v)}; split ${st ? `${st.preset} sides ${st.sides}` : null})`);
  }
  closeSession(S);
  }

  // ======== BOOT 1b (?skull=anatomical): the pop, on a page of its own. How many slugs cut a neck depends on the
  // zombie and on what the cast has been through; the first zombie of a fresh page loses its head to the first.
  if (runs("anatomical")) {
  await boot("anatomical", "&skull=anatomical");
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
  }

  // ======== BOOT 1c (?skull=anatomical): the split and its pop on the plates, on a page of their own (at most 32
  // skull fragments are live at once, and D and D0 have thrown 28: a third pop on their page would count 4 new ones).
  if (runs("anatomical-split")) {
  await boot("anatomical-split", "&skull=anatomical");
  // -------- SA, XA. S's skull and X on the plates (boot 1 makes them on the default skull): the split head's skull
  // is drawn as clipped copies, and the pop of a split head throws its plates.
  const SA = fresh();
  const saAim = await crosshairOn(SA.id, SHOT_D, [0, 0, 0], FRONT);
  if (saAim.actor !== SA.id) fail(`SA: aim control: the slug would hit actor ${saAim.actor}, not ${SA.id}`);
  await watchSlug(SA.id, 8);
  const saShot = await shotOf(SA.id);
  check(saShot?.rule === "split" && saShot.took === true && aimKept(saShot, saAim) && saShot.aimOffset < TUNING_DEFAULTS.splitFrac, `SA: a precise slug splits: ${aimSays(saShot)} (verdict ${JSON.stringify(saShot)})`);
  await stepN(150);
  const saSt = await splitOf(SA.id);
  await evaluate("__sdfGame.step(1, 0)");
  const saDrawn = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${SA.id}); return d ? { bones: d.copies.filter((c) => !c.eye).length, eyes: d.copies.filter((c) => c.eye).length, pieces: [...new Set(d.copies.filter((c) => !c.eye).map((c) => c.piece))].sort(),
    materials: [...new Set(d.copies.filter((c) => !c.eye).map((c) => c.material))], heads: d.copies.filter((c) => !c.eye && c.head).length, paints: [...new Set(d.copies.filter((c) => !c.eye).map((c) => c.paint))] } : null; })()`);
  check(saSt?.sides === 0 && !!saDrawn && [0, 1, 2].every((q) => saDrawn.pieces.includes(q)), `SA: both halves open (sides ${saSt?.sides}) and the skull is drawn broken with the split: clipped copies for the rest and for both halves (${JSON.stringify(saDrawn)})`);
  check(!!saDrawn && saDrawn.bones > 0 && saDrawn.heads === saDrawn.bones && saDrawn.materials.length === 1 && saDrawn.materials[0] === "skeleton-plate-split" && saDrawn.paints.length === 1 && saDrawn.paints[0] === null,
    `SA: every copy is the anatomical skull's, on the plates' split material and under neither of the sculpted skull's paints (${saDrawn?.heads} of ${saDrawn?.bones} copies the head; ${saDrawn?.materials.join(", ")})`);
  // The splitting slug was not an ordinary hit on the skull: no plate is missing, and no eye was knocked out.
  const saPlates = await evaluate(`__sdfGame.skullState(${SA.id})`), saEyes = await eyesOf(SA.id);
  check(saPlates.pieces.length === 0 && saEyes.missing === 0 && saEyes.debris === 0 && saDrawn?.eyes >= 2,
    `SA: the splitting slug broke no plate and knocked no eye out: ${saPlates.pieces.length} plates missing (${saPlates.pieces.join(", ") || "none"}), ${saEyes.missing} eyes missing, ${saDrawn?.eyes} eye copies drawn (2 or more)`);
  await stand(SA.id, PHOTO_D); await capture("SA-split");
  const xaAim = await crosshairOn(SA.id, SHOT_D, [0, IMPRECISE_M, 0], FRONT);
  if (xaAim.actor !== SA.id) fail(`XA: aim control: the slug would hit actor ${xaAim.actor}, not ${SA.id}`);
  const fa0 = await fragments();
  const xa = await watchSlug(SA.id, 24);
  const xaShot = await shotOf(SA.id);
  note(`XA: ${aimSays(xaShot)}; verdict ${JSON.stringify(xaShot)}; swell frames ${JSON.stringify(xa.swell)}, head off on frame ${xa.off}, ${(await fragments()) - fa0} fragments`);
  check(xaShot?.rule === "pop" && xaShot.took === true && xaShot.aimOffset >= TUNING_DEFAULTS.splitFrac, `XA: a slug on the split head is the pop's, precise or not (${JSON.stringify(xaShot)})`);
  check(xa.swell.length > 0 && xa.off === xa.swell[xa.swell.length - 1] + 1 && !(await headOn(SA.id)), `XA: the open head swells and bursts (swell on ${xa.swell.length} frames, off on frame ${xa.off})`);
  check((await fragments()) - fa0 >= 10, `XA: the split skull's plates are thrown (${(await fragments()) - fa0} fragments)`);
  closeSession(S);
  }

  // ======== BOOT 2: the opening, switched on by tuning ========
  if (runs("opening")) {
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
  }

  // ======== BOOT 3: the pop on the default skull, on a page of its own ========
  if (runs("pop")) {
  await boot("pop");
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
  const fragPaints = await evaluate("__sdfGame.skullFragments().map((f) => f.paint)");
  check(fragPaints.length === 10 && fragPaints.every((q) => q === 2), `DS: every fragment keeps the head's paint, the second (${fragPaints.join(", ")})`);
  await evaluate(`__sdfGame.placePlayer({ x: ${dsAt[0] + (centre[0] - dsAt[0]) * 0.3}, z: ${dsAt[2] + (centre[2] - dsAt[2]) * 0.3}, yaw: ${yawOf(dsAt[0] - centre[0], dsAt[2] - centre[2])}, pitch: 0 })`);
  await stepOne(); await capture("DS-popped");
  // NOTHING FLOATS OVER THE STUMP after the pop: the old head's place on screen is the room's, from four sides.
  const dsFront = headAxis((await evaluate(`__sdfGame.head.frame(${DS.id})`))?.quat ?? [0, 0, 0, 1], [0, 0, 1]);
  const dsOver = await overStump("DS", DS.id, dsFront);
  note(`DS: the stump is ${dsOver.stump ? `${(dsOver.stump.radius * 100).toFixed(1)} cm, its lip ${dsOver.stump.lip}` : null}; the body's flesh in the old head's place: ${JSON.stringify(dsOver.views)} px`);
  check(dsOver.max <= OVER_MOST, `DS: nothing floats over the stump after the pop: at most ${dsOver.max} px of the old head's place are the body's flesh, from any of four sides (<= ${OVER_MOST}; ${JSON.stringify(dsOver.views)})`);
  closeSession(S);
  }

  // ======== BOOT 3a: THE FLYING HEADS, on a page of their own (a page's first zombie loses its head to the first
  // slug at its neck; how many a later one takes depends on what the cast has been through).
  if (runs("flying")) {
  await boot("flying");
  // -------- FS. the slug's flying head (slugPop off): the pop boot's decapitation with no pop.
  await tune({ slugPop: false });
  const FS = fresh();
  const fs = await takeHeadOff("FS", FS.id, "__sdfGame.fireSlug()", 0.06, SHOT_D, 40);
  const fsKinds = fs.at ? await evaluate(`__sdfGame.head.drawnNear(${fs.at[0]}, ${fs.at[1]}, ${fs.at[2]}, 3).chunks.map((c) => c.kind)`) : [];
  check(fs.rounds > 0 && fsKinds.includes("limb"), `FS: with slugPop off, slugs at the neck send the head flying (slug ${fs.rounds}; a limb chunk among the ${fsKinds.length} flying pieces)`);
  await tune({ slugPop: TUNING_DEFAULTS.slugPop });
  // -------- FP. a decapitation by PELLETS: both barrels at the neck from 1.2 m.
  const FP = fresh();
  const fp = await takeHeadOff("FP", FP.id, "__sdfGame.fire(2)", 0.1, 1.2, 0, 8);
  check(fp.rounds > 0, `FP: pellet volleys at the neck take the head off (volley ${fp.rounds})`);
  await stepN(150);
  // One thaw for both bodies, then the old head's place over each stump.
  const fsOver = await overStump("FS", FS.id, fs.front ?? [0, 0, 1]);
  check(fsOver.max <= OVER_MOST, `FS: nothing floats over the stump after the slug's flying head: at most ${fsOver.max} px of the old head's place are the body's flesh (<= ${OVER_MOST}; ${JSON.stringify(fsOver.views)}; the stump's lip ${fsOver.stump?.lip})`);
  // The pellets' decapitation is MEASURED, NOT HELD: their small craters cut the neck through and leave the neck's
  // base standing on the shoulders, a collar of real flesh that reaches into the old head's place
  // (docs/dev-notes/2026-10-07-sculpt-skull-2/NOTES.md). It is attached to the shoulders, and it is not a lip.
  if (fp.rounds > 0) {
    const fpOver = await overStump("FP", FP.id, fp.front ?? [0, 0, 1], false);
    note(`FP (NOT HELD): after a decapitation by pellets the body's flesh in the old head's place: ${JSON.stringify(fpOver.views)} px (the neck's base, left standing; the stump's lip ${fpOver.stump?.lip})`);
  }
  closeSession(S);
  }

  // ======== BOOT 3b: THE LIP RULE SWITCHED OFF (__sdfGame.head.stumpLips(false)), the control of the check above:
  // the same decapitation on the same zombie of a fresh page leaves the stump's lip standing in the slug's crater, a
  // piece of flesh attached to nothing over the neck. The check must SEE it.
  if (runs("lips-off")) {
  await boot("lips-off");
  check((await evaluate("__sdfGame.head.stumpLips(false)")) === 1, "FL0: the lip rule is off for this boot (stumpLips 1: every lip is left as it was)");
  await tune({ slugPop: false });
  const FL = fresh();
  const fl = await takeHeadOff("FL0", FL.id, "__sdfGame.fireSlug()", 0.06, SHOT_D, 40);
  check(fl.rounds > 0, `FL0: slugs at the neck take the head off (slug ${fl.rounds})`);
  await stepN(150);
  const flOver = await overStump("FL0", FL.id, fl.front ?? [0, 0, 1]);
  check(flOver.max >= OVER_SEEN && flOver.stump?.lip === 1, `FL0: with the rule off the stump keeps its lip (${flOver.stump?.lip}) and a piece of flesh stands in the old head's place: ${flOver.max} px at the most (>= ${OVER_SEEN}; ${JSON.stringify(flOver.views)}). The check sees the floating piece.`);
  await evaluate("__sdfGame.head.stumpLips(true)");
  closeSession(S);
  }

  // ======== BOOT 4: the cultist, who draws a fitted anatomical skull on the default page ========
  if (runs("cultist")) {
  await boot("cultist", "&spawn=cultist", "cultist");
  {
    const diag = await evaluate("__sdfGame.skeletonDiagnostics()");
    const table = await evaluate(`import("/src/lab/sdf-zombie/webgpu/skeleton-spike/skull-cast.ts").then((m) => ({ heads: Object.keys(m.BALL_HEADS), cultist: m.BALL_HEADS.cultist }))`);
    const pieces = await evaluate(`import("/src/lab/sdf-zombie/webgpu/skeleton-spike/anatomical-skull.ts").then((m) => [...m.SKULL_PIECES])`);
    check(JSON.stringify(Object.keys(diag.anatomical)) === JSON.stringify(table.heads) && diag.anatomical.cultist === table.cultist.spec.fit && diag.anatomical.zombie === undefined,
      `CU: the default page draws the anatomical skull on the eight ball-headed humanoids and on nobody else, the cultist under his fit (${JSON.stringify(diag.anatomical)})`);
    const made = diag.skullFits.filter((f) => f.character === "cultist");
    check(made.length === 1 && made[0].fit === table.cultist.spec.fit, `CU: his skull was fitted once, as the cast was spawned and before any bone was drawn (${JSON.stringify(diag.skullFits)})`);
    note(`CU: the fit took ${made[0]?.ms.toFixed(0)} ms, once for the six cultists of this boot`);
    note(`CU: the boot waited ${diag.skullAssetMs?.toFixed(0)} ms for the plates' asset (public/assets/lab/anatomical-skull.glb, 1.3 MB)`);
    check(typeof diag.skullAssetMs === "number" && diag.skullAssetMs < 8000, `CU: the plates' asset was loaded for this page, inside the boot's wait for it (${diag.skullAssetMs?.toFixed(0)} ms of at most 8000)`);
    const CU = fresh();
    const fit = await evaluate(`__sdfGame.skullFit(${CU.id})`);
    const size = fit ? [0, 1, 2].map((k) => fit.max[k] - fit.min[k]) : [0, 0, 0];
    const wide = fit ? size[0] / (2 * fit.flesh.half) : 0, deep = fit ? size[2] / (fit.flesh.front + fit.flesh.back) : 0;
    check(!!fit && fit.name === "snug" && fit.skin === true && fit.eyeHs === table.cultist.spec.eyeHs && fit.shrunk === 1,
      `CU: his skull is fitted to his skin under ${fit?.name}, its orbits held on his ember eyes' line (eyeHs ${fit?.eyeHs}; the table's ${table.cultist.spec.eyeHs})`);
    check(wide >= 0.8 && deep >= 0.8 && Math.abs(wide - table.cultist.fill.wide) < 0.02 && Math.abs(deep - table.cultist.fill.deep) < 0.02,
      `CU: its box fills the stated share of his head: ${(size[0] * 1000).toFixed(0)} x ${(size[1] * 1000).toFixed(0)} x ${(size[2] * 1000).toFixed(0)} mm, ${wide.toFixed(3)} of the head across and ${deep.toFixed(3)} front to back (the table: ${table.cultist.fill.wide} and ${table.cultist.fill.deep}; both 0.8 or more)`);
    const orbitY = fit ? (fit.orbits[0].centre[1] + fit.orbits[1].centre[1]) / 2 : NaN;
    check(!!fit && fit.orbits.length === 2 && fit.eyeLine !== null && Math.abs(orbitY - fit.eyeLine) <= 0.002,
      `CU: its orbits are level with his ember eyes: ${((orbitY - fit?.eyeLine) * 1000).toFixed(2)} mm from their line (within 2 mm)`);
    // The bones are drawn once something is exposed: a torso wound.
    const fr = await evaluate(`__sdfGame.head.frame(${CU.id})`), f = headAxis(fr.quat, [0, 0, 1]);
    let hit = false;
    for (const drop of [0.45, 0.35, 0.55, 0.25, 0.7]) { hit = await evaluate(`__sdfGame.stampWoundAt(${fr.centre[0] + f[0] * 1.5}, ${fr.centre[1] - drop}, ${fr.centre[2] + f[2] * 1.5}, ${-f[0]}, 0, ${-f[2]}, "pellet", ${CU.id})`); if (hit) break; }
    if (!hit) fail("CU: no torso wound landed");
    await stand(CU.id, 0.8); await stepN(3);
    const drawnCu = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${CU.id}); const h = d ? d.whole.filter((q) => !q.eye && q.head) : []; return { heads: h.length, materials: [...new Set(h.map((q) => q.material))], paints: [...new Set(h.map((q) => q.paint))] }; })()`);
    check(drawnCu.heads >= 1 && drawnCu.materials.length === 1 && drawnCu.materials[0] === "skeleton-plate" && drawnCu.paints[0] === null,
      `CU: his head is drawn as the anatomical skull's plates, under neither of the sculpted skull's paints (${JSON.stringify(drawnCu)})`);
    const eyes = await evaluate(`__sdfGame.meshEyes(${CU.id})`);
    const eyeOk = !!fit && eyes?.length === 2 && eyes.every((e, i) => Math.hypot(e.centre[0] - fit.world.eyes[i][0], e.centre[1] - fit.world.eyes[i][1], e.centre[2] - fit.world.eyes[i][2]) < 1e-5 && Math.abs(e.radius - fit.eyes[i].radius) < 1e-6);
    const inOrbit = !!fit && fit.eyes.length === 2 && fit.eyes.every((e, i) => Math.hypot(e.center[0] - fit.orbits[i].centre[0], e.center[1] - fit.orbits[i].centre[1]) < 0.25 * fit.orbits[i].radius && e.center[2] + e.radius < fit.orbits[i].centre[2]);
    const sized = !!fit && fit.eyes.every((e) => Math.abs(e.radius / ((fit.orbits[0].radius + fit.orbits[1].radius) / 2) - 1.13) < 1e-6);
    check(eyeOk && inOrbit && sized, `CU: his two eyes are drawn at the fitted skull's own seats, each within a quarter of its orbit's radius of the orbit's centre and behind its rim, and sized from the orbits (eye radius ${(fit?.eyes[0]?.radius * 1000).toFixed(1)} mm in orbits of ${fit?.orbits.map((o) => (o.radius * 1000).toFixed(1)).join(" and ")} mm; drawn ${JSON.stringify(eyes?.map((e) => e.centre.map((v) => +v.toFixed(3))))})`);
    await capture("CU-fitted");
    // A plate can be shot off: real pellet volleys at his face from 2 m (the crosshair 8 cm over the head's centre:
    // a volley lands under it), until one breaks.
    const frag0 = await fragments();
    let volleys = 0, broken = [];
    for (; volleys < 4 && broken.length === 0; volleys++) {
      const aim = await crosshairOn(CU.id, SHOT_D, [0, 0.08, 0], FRONT);
      if (aim.actor !== CU.id) fail(`CU: aim control: the volley is on actor ${aim.actor}, not ${CU.id}`);
      let fired = false;
      for (let i = 0; i < 6 && !fired; i++) { await evaluate("__sdfGame.refillShells()"); fired = await evaluate("__sdfGame.fire(1)"); if (!fired) await stepN(90); }
      if (!fired) fail("CU: fire(1) never fired");
      await stepN(30);
      broken = (await evaluate(`__sdfGame.skullState(${CU.id})`)).pieces;
    }
    const flying = await evaluate("__sdfGame.skullFragments().map((q) => q.plate)");
    check(broken.length >= 1 && broken.every((n) => pieces.includes(n)) && (await fragments()) - frag0 >= broken.length && flying.every((n) => pieces.includes(n)),
      `CU: pellets at his face break a plate off his fitted skull: ${broken.join(", ")} after ${volleys} volley(s), thrown as ${(await fragments()) - frag0} fragment(s) (${flying.join(", ")})`);
    check(await headOn(CU.id), "CU: his head is still on");
    await stand(CU.id, 0.8); await capture("CU-plate-off");
    // His pop (the soft target's own) releases every plate, and the sculpted skull's fragments are never cut.
    const CP = fresh();
    await stand(CP.id, 0.9);
    const cp0 = await fragments();
    const popped = await evaluate(`__sdfGame.head.pop(${CP.id}, 0, 0, -1)`);
    let offAt = -1;
    for (let k = 0; k < 30 && offAt < 0; k++) { await stepOne(); if (!(await headOn(CP.id))) offAt = k; }
    const cpState = await evaluate(`__sdfGame.skullState(${CP.id})`), cpNames = await evaluate("__sdfGame.skullFragments().map((q) => q.plate)");
    const cuts = await evaluate("__sdfGame.skullFragmentCuts()");
    check(popped === true && offAt >= 0 && cpState.pieces.length === 14 && (await fragments()) - cp0 === 14,
      `CU: his head's pop releases all fourteen plates of the fitted skull (popped ${popped}, the head off on frame ${offAt}; ${cpState.pieces.length} plates missing, ${(await fragments()) - cp0} fragments thrown)`);
    check(cpNames.every((n) => pieces.includes(n)) && cuts.meshes === 0, `CU: every fragment is a plate, and the sculpted skull's fragments were never cut for him (${cuts.meshes} meshes cut)`);
    await stepN(6); await capture("CU-popped");
  }
  }
} finally { if (S) closeSession(S); }

const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
check(errs.length === 0, `E: zero console errors or exceptions (${errs.length}${errs.length ? ": " + JSON.stringify(errs.slice(0, 3)) : ""})`);
console.log(`\nsummary: ${JSON.stringify(out)}`);
console.log(`\nboots run: ${ran.join(", ")}${ONLY ? " (ONLY: a part of the gate, not the gate)" : ""}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
