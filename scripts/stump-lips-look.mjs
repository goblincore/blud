// scripts/stump-lips-look.mjs — the lips a sever takes (damage.ts lipsAfterSever), photographed and measured.
//
// One boot of the bare ring page per scene (seed 1, a frozen cast, thawed for a moment after the sever so the body is
// drawn where it is). Every round is a real one unless a scene says "stamped" (__sdfGame.stampWoundAt: the same
// crater, with no shove and no sever check). The scenes:
//   float   slugs from 40 degrees round the head, the crosshair 6 cm under its centre (imprecise: ordinary slug
//           wounds on the neck), until the head comes off: the stump's bowl opens inside a slug's crater. The case
//           that left a cup of flesh over the stump.
//   chest   a stamped slug crater on the chest, 30 cm under the head's centre, then the same decapitation.
//   beside  a stamped slug crater on the top of one shoulder, beside where the stump will open, then pellet volleys
//           at the neck until the head comes off (no crater holds the bowl).
//   arm     a stamped slug crater on the chest beside the left shoulder, then slugs at that shoulder until the arm
//           comes off.
//   thin    no sever: pellet craters stamped on the left hand and wrist, where there is too little flesh behind a
//           hit for a lip (damage.ts rimScaleFor): the wounds a body has with a lip of nothing, or nearly.
// Each scene is photographed AS THE GAME SHIPS (the default post chain, VHS on) from 1.3 m at the player's eye
// height, from the front, both sides and the back, and CLEAN (VHS off) from 0.8 m; and MEASURED: a clean frame with
// the body drawn against the same frame with the body's flesh and bone meshes out of it gives the body's own pixels
// (a shadow leaving a lit wall is told apart by its colour), and `floatPx` counts those over the stump that are
// joined to nothing (floating). The same again with every lip's height at nothing says whether what floats is lip or
// flesh.
//
// Output: <out>/<scene>__<name>.png and <out>/<scene>.json (the wounds with their lips, the measures).
// Usage (own servers): SCENES=float,chest node scripts/stump-lips-look.mjs <vite port> <cdp port> <out dir>
//   LIPS=1     __sdfGame.head.stumpLips(1) at boot: every lip left as it was (the look before the rule)
//   QUERY=...  added to the page's query
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const VITE = Number(process.argv[2] ?? 5261), CDP = Number(process.argv[3] ?? 9261);
const OUT = process.argv[4] ?? ".lab-tmp/stump-lips-look";
const SCENES = (process.env.SCENES ?? "float,chest,beside,arm,thin").split(",");
const QUERY = process.env.QUERY ?? "";
const W = 1280, H = 800, EYE_H = 1.62, THAW = 14;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEADLINE = setTimeout(() => { console.error("FAIL: the run's deadline passed"); process.exit(2); }, 30 * 60 * 1000);
let S = null;
const errors = [];
async function open() {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), rect: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
    if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  };
  s.send = (method, params = {}) => new Promise((res) => { const id = ++s.seq; s.pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  S = s;
}
const close = () => { if (!S) return; try { S.ws.close(); } catch {} try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${S.tab.id}`], { stdio: "ignore" }); } catch {} S = null; };
process.on("exit", close);
const ev = async (expression, ms = 90000) => {
  const r = await Promise.race([S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT " + expression.slice(0, 60))), ms))]);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const J = JSON.stringify;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => mul(a, 1 / (Math.hypot(...a) || 1));
const qRot = (q, v) => { const [x, y, z, w] = q; const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]; };
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
const turnY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
const step = () => ev("__sdfGame.step(1, 1 / 60)");
const stepN = async (n) => { for (let i = 0; i < n; i++) await step(); };
function decodePng(buf) {
  let off = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++], row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null, cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
const differs = (a, b, x, y, t = 14) => { const i = (y * a.w + x) * a.ch; return Math.abs(a.data[i] - b.data[i]) > t || Math.abs(a.data[i + 1] - b.data[i + 1]) > t || Math.abs(a.data[i + 2] - b.data[i + 2]) > t; };

let pool = [], f = [0, 0, 1];
async function boot(query) {
  await open(); await S.send("Page.enable"); await S.send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${S.tab.id}`); await S.send("Page.bringToFront");
  await S.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await S.send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&loader=0${QUERY}${query}` });
  let be = null;
  for (let i = 0; i < 240 && !be; i++) { await sleep(500); try { be = await ev("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { be = null; } }
  if (be !== "webgpu") throw new Error(`backend ${be}`);
  for (let i = 0; i < 480; i++) { if (await ev("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  await ev("__sdfGame.setLoopRunning(false)");
  await ev(`(() => { for (const e of document.body.querySelectorAll("*")) { if (e.tagName !== "CANVAS" && !e.querySelector("canvas") && !e.closest("canvas")) e.style.visibility = "hidden"; } return 1; })()`);
  S.rect = await ev(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await ev("__sdfGame.freeze(true)"); await ev("__sdfGame.setFreeAim(true)"); await ev("__sdfGame.setAimPoint(0, 0)"); await ev("__sdfGame.setViewModelVisible(false)");
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await ev("__sdfGame.warmBackground()"); if (["gib", "crowd"].every((k) => wb[k] === "ready") || ["gib", "crowd"].some((k) => wb[k] === "failed")) break; await sleep(500); if (i % 10 === 0) await ev("__sdfGame.step(1, 0)"); }
  if (process.env.LIPS !== undefined) console.log(`stump lips: ${await ev(`__sdfGame.head.stumpLips(${Number(process.env.LIPS)})`)}`);
  await ev(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); return 1; })()`);
  await stepN(60);
  // The room with the most actors of the page's cast.
  const all = (await ev("__sdfGame.actorList()")).filter((z) => z.kind === "zombie");
  const byRoom = new Map();
  for (const z of all) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  pool = [...byRoom.values()].sort((a, b) => b.length - a.length)[0];
}
const frameOf = (id) => ev(`__sdfGame.head.frame(${id})`);
const ready = async () => { const frames = Math.ceil((await ev("__sdfGame.reloadTotalSec")) * 60) + 12; await ev("__sdfGame.refillShells()"); await stepN(frames); await ev("__sdfGame.refillShells()"); };
/** The crosshair on `target` (world) from `dist` m, `yawDeg` round it from the actor's front, at eye height; then one round. */
async function shoot(target, dist, yawDeg, round) {
  await ready();
  const eye = add(target, mul(turnY(f, yawDeg * Math.PI / 180), dist)); eye[1] = EYE_H;
  const d = sub(target, eye);
  await ev(`__sdfGame.placePlayer({ x: ${eye[0]}, z: ${eye[2]}, yaw: ${yawOf(d[0], d[2])}, pitch: ${Math.atan2(d[1], Math.hypot(d[0], d[2]))} })`);
  await step(); await ev("__sdfGame.setAimPoint(0, 0)");
  for (let i = 0; i < 6; i++) { await ev("__sdfGame.refillShells()"); if (await ev(round)) break; await stepN(90); }
  await stepN(40);
}
const limbOn = async (id, limb) => (await ev(`__sdfGame.flail.limbAlive(${id}, "${limb}")`)) > 0;
const thaw = async () => { await ev("__sdfGame.freeze(false)"); await stepN(THAW); await ev("__sdfGame.freeze(true)"); await stepN(2); };
/** The body's wounds as the ring holds them: where, how big, their lip's share, and which is a stump. */
const woundsOf = (id) => ev(`(async () => { const D = await import("/src/lab/sdf-zombie/damage.ts"); const a = __sdfGame.zombie(${id}), p = a.posed(), yaw = a.pose().yaw;
  return a.woundList().map((w) => ({ pos: D.woundWorldPos(p.prims, w, yaw).map((v) => +v.toFixed(3)), r: +w.radius.toFixed(3), type: w.type, shape: w.shape ?? "crater", limb: p.prims[w.primIdx]?.limb ?? null,
    lip: w.rimScale ?? 1, depth: w.carveDepth ?? null, stump: !!w.injuryIgnored, decal: !!w.decal, cloth: w.cloth ?? null, alive: !!p.clusters.find((c) => w.primIdx >= c.start && w.primIdx < c.start + c.count)?.alive && !p.prims[w.primIdx]?.dead })); })()`);
const fleshShown = (id, on) => ev(`(() => {
  const v = __sdfGame.zombie(${id}).view, k = (window.__lookHidden ??= new Map());
  if (${on}) { const s = k.get(${id}); if (s) { v.uniforms.bodyHalf.value.copy(s.half); v.object.scale.copy(s.scale); k.delete(${id}); } }
  else if (!k.has(${id})) { k.set(${id}, { half: v.uniforms.bodyHalf.value.clone(), scale: v.object.scale.clone() }); v.uniforms.bodyHalf.value.multiplyScalar(1e-4); v.object.scale.multiplyScalar(1e-4); }
  v.syncRecord(); return 1; })()`);
const toPx = async (p) => { const n = await ev(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h] : null; };
async function camAt(c, yawDeg, dist) {
  const eye = add(c, mul(turnY(f, yawDeg * Math.PI / 180), dist)); eye[1] = EYE_H;
  const d = sub(c, eye);
  await ev(`__sdfGame.setPose(${eye[0]}, ${eye[2]}, ${yawOf(d[0], d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, 0)`); await ev("__sdfGame.step(1, 0)");
  await ev("__sdfGame.refreshHull()");
}
async function grab(name) {
  await ev("__sdfGame.setRenderLock(true)"); for (let i = 0; i < 26; i++) await step();
  const s = await S.send("Page.captureScreenshot", { format: "png" });
  await ev("__sdfGame.setRenderLock(false)");
  const buf = Buffer.from(s.result.data, "base64");
  if (name) writeFileSync(`${OUT}/${name}.png`, buf);
  return decodePng(buf);
}
const VIEWS = [["front", 0], ["left", 90], ["back", 180], ["right", -90]];
const lum = (img, i) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
/** A pixel the BODY draws: it changes when the body is taken out of the frame, and the change is not the body's
 *  shadow leaving a lit surface (a shadow darkens every channel by one factor; flesh changes the colour). */
function bodyPixel(shown, hidden, x, y) {
  if (!differs(shown, hidden, x, y)) return false;
  const i = (y * shown.w + x) * shown.ch, ls = lum(shown, i), lh = lum(hidden, i);
  if (lh > 24 && ls < lh) {
    const k = ls / lh;
    if ([0, 1, 2].every((c) => Math.abs(shown.data[i + c] - hidden.data[i + c] * k) <= 10)) return false;
  }
  return true;
}
/** WHAT FLOATS OVER A POINT: in the window from 2 cm to 36 cm over `p0` (the point on screen) and 16 cm to either
 *  side, the body's pixels that are not joined, inside the window, to the body's pixels on the window's bottom or
 *  side edges. Returns their count, the body's pixels in the window, and how high over the point the highest
 *  floating one stands (cm). */
function floating(shown, hidden, p0, pxPerM) {
  const x0 = Math.max(0, Math.round(p0[0] - 0.16 * pxPerM)), x1 = Math.min(shown.w - 1, Math.round(p0[0] + 0.16 * pxPerM));
  const y0 = Math.max(0, Math.round(p0[1] - 0.36 * pxPerM)), y1 = Math.min(shown.h - 1, Math.round(p0[1] - 0.02 * pxPerM));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return { floatPx: 0, bodyPx: 0, topCm: 0 };
  const body = new Uint8Array(w * h), seen = new Uint8Array(w * h), stack = [];
  let bodyPx = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bodyPixel(shown, hidden, x0 + x, y0 + y)) { body[y * w + x] = 1; bodyPx++; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (body[y * w + x] && (y >= h - 3 || x === 0 || x === w - 1)) { seen[y * w + x] = 1; stack.push(y * w + x); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (body[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  let floatPx = 0, top = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (body[y * w + x] && !seen[y * w + x]) { floatPx++; top ??= (p0[1] - (y0 + y)) / pxPerM * 100; }
  return { floatPx, bodyPx, topCm: top === null ? 0 : +top.toFixed(1) };
}
/** The body's own pixels about `c` from each view (clean frames, 0.8 m): what of them floats over the point. */
async function measure(id, c, save) {
  const out = {};
  for (const [name, yaw] of VIEWS) {
    await camAt(c, yaw, 0.8);
    const shown = await grab(save ? `${save}-${name}` : null);
    await fleshShown(id, false); await ev("__sdfGame.meshSkeletonShow({ bones: false, eyes: false, organs: false })");
    const hidden = await grab(null);
    await fleshShown(id, true); await ev("__sdfGame.meshSkeletonShow({ bones: true, eyes: true, organs: true })");
    const p0 = await toPx(c), p1 = await toPx(add(c, [0, 0.1, 0]));
    if (!p0 || !p1) continue;
    const pxPerM = (p0[1] - p1[1]) / 0.1;
    // The old head's place: 7 cm to either side of the point and 8 to 24 cm over it. A headless body has nothing there.
    let overPx = 0;
    for (let y = Math.max(0, Math.round(p0[1] - 0.24 * pxPerM)); y <= Math.round(p0[1] - 0.08 * pxPerM); y++)
      for (let x = Math.max(0, Math.round(p0[0] - 0.07 * pxPerM)); x <= Math.min(shown.w - 1, Math.round(p0[0] + 0.07 * pxPerM)); x++) if (bodyPixel(shown, hidden, x, y)) overPx++;
    out[name] = { pxPerM: +pxPerM.toFixed(1), overPx, ...floating(shown, hidden, p0, pxPerM) };
  }
  return out;
}
/** Photograph actor `id` about the world point `c`, and measure what of the body floats over it: as it is, and with
 *  every lip of the body's wounds taken down to nothing (the lip height uniform): what still floats then is flesh. */
async function record(scene, id, c, manifest) {
  await ev("__sdfGame.setBleed(false)"); await stepN(3);
  for (const [name, yaw] of VIEWS) { await camAt(c, yaw, 1.3); await grab(`${scene}__ships-${name}`); }
  await ev("__sdfGame.setVhs(null)");
  manifest.views = await measure(id, c, `${scene}__clean`);
  // Every lip of this body's wounds to nothing: the ring's own wounds, then one pellet crater stamped on a shin (it
  // has no lip either), which makes the actor upload its wounds again.
  const shin = add(await ev(`__sdfGame.actorLimbCenter(${id}, "torso")`), [0, -0.75, 0]);
  await ev(`(() => { for (const w of __sdfGame.zombie(${id}).woundList()) w.rimScale = 0; return 1; })()`);
  for (const dx of [0.08, -0.08, 0.12, -0.12]) {
    const on = add(shin, mul([f[2], 0, -f[0]], dx)), from = add(on, mul(f, 0.8)), d = unit(sub(on, from));
    if (await ev(`!!__sdfGame.stampWoundAt(${from[0]}, ${from[1]}, ${from[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${id})`)) break;
  }
  await ev(`(() => { for (const w of __sdfGame.zombie(${id}).woundList()) w.rimScale = 0; return 1; })()`);
  await stepN(2);
  manifest.noLips = await measure(id, c, `${scene}__nolips`);
}

for (const scene of SCENES) {
  const manifest = { scene, query: QUERY, lips: null };
  try {
    await boot("");
    manifest.lips = await ev("__sdfGame.head.stumpLips()");
    const z = pool[scene === "float" ? 2 : 0], id = z.id;
    const fr = await frameOf(id);
    const f0 = qRot(fr.quat, [0, 0, 1]); f = unit([f0[0], 0, f0[2]]);
    const right = [f[2], 0, -f[0]];
    const stamp = (from, to, kind) => { const d = unit(sub(to, from)); return ev(`!!__sdfGame.stampWoundAt(${from[0]}, ${from[1]}, ${from[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "${kind}", ${id})`); };
    let limb = "head", about = null;
    if (scene === "float" || scene === "chest") {
      if (scene === "chest") { const on = add(fr.centre, [0, -0.3, 0]); manifest.stamped = await stamp(add(on, mul(f, 0.8)), on, "slug"); manifest.before = await woundsOf(id); }
      let n = 0;
      for (; n < 8 && await limbOn(id, "head"); n++) { const cur = (await frameOf(id)) ?? fr; await shoot(add(cur.centre, [0, -0.06, 0]), 2, 40, "__sdfGame.fireSlug()"); }
      manifest.rounds = n;
    } else if (scene === "beside") {
      // A slug's crater on the top of the right shoulder, 16 cm out from the neck (stamped from straight above).
      const on = add(fr.centre, add(mul(right, 0.16), [0, -0.22, 0]));
      manifest.stamped = await stamp(add(on, [0, 0.5, 0]), on, "slug");
      manifest.before = await woundsOf(id);
      // Both barrels at the neck from 1.2 m, until the head comes off.
      let n = 0;
      for (; n < 6 && await limbOn(id, "head"); n++) { const cur = (await frameOf(id)) ?? fr; await shoot(add(cur.centre, [0, -0.1, 0]), 1.2, 0, "__sdfGame.fire(2)"); }
      manifest.rounds = n;
    } else if (scene === "arm") {
      limb = "armL";
      const arm = await ev(`__sdfGame.actorLimbCenter(${id}, "armL")`), tc = await ev(`__sdfGame.actorLimbCenter(${id}, "torso")`);
      // A slug's crater on the chest, on the arm's side of the body's middle line and 12 cm over the torso's centre.
      const side = unit([arm[0] - tc[0], 0, arm[2] - tc[2]]);
      const on = add(tc, add(mul(side, 0.07), [0, 0.12, 0]));
      manifest.stamped = await stamp(add(on, mul(f, 0.8)), on, "slug");
      manifest.before = await woundsOf(id);
      // Slugs at the middle of the left arm until a piece of it comes off (a stump is stamped).
      let n = 0;
      for (; n < 8 && !(await woundsOf(id)).some((w) => w.stump); n++) await shoot(await ev(`__sdfGame.actorLimbCenter(${id}, "armL")`), 2, 20, "__sdfGame.fireSlug()");
      manifest.rounds = n;
    } else if (scene === "thin") {
      limb = null;
      // The left arm's far end (the hand), and craters stamped from in front along its last 12 cm.
      const tip = await ev(`(() => { const p = __sdfGame.zombie(${id}).posed(); const c = p.clusters.find((q) => q.limb === "armL"), t = p.clusters.find((q) => q.limb === "torso"); const o = p.prims.slice(c.start, c.start + c.count).filter((q) => !q.dead && q.op !== "sub");
        let best = null, bd = -1; for (const q of o) for (const e of [q.a, q.b]) { const d = Math.hypot(e[0] - t.center[0], e[1] - t.center[1], e[2] - t.center[2]); if (d > bd) { bd = d; best = [...e]; } } return best; })()`);
      const tc = await ev(`__sdfGame.actorLimbCenter(${id}, "armL")`), back = unit(sub(tc, tip));
      manifest.stamped = [];
      for (const k of [0, 0.04, 0.08, 0.12]) { const on = add(tip, mul(back, k)); manifest.stamped.push(await stamp(add(on, mul(f, 0.6)), on, "pellet")); }
      about = tip;
    }
    await stepN(60); await thaw();
    manifest.off = limb === "armL" ? (await woundsOf(id)).some((w) => w.stump) : limb ? !(await limbOn(id, limb)) : null;
    manifest.wounds = await woundsOf(id);
    const stump = [...manifest.wounds].reverse().find((w) => w.stump);
    about ??= stump ? stump.pos : (await ev(`__sdfGame.actorLimbCenter(${id}, "torso")`));
    manifest.about = about;
    console.log(`[${scene}] actor ${id}: ${limb ?? "nothing"} ${manifest.off ? "OFF" : "on"} after ${manifest.rounds ?? 0} rounds; wounds ${J(manifest.wounds.map((w) => [w.stump ? "STUMP" : `${w.type} ${w.shape}`, w.limb, w.alive ? "live" : "gone", w.r, `lip ${w.lip}`, w.pos]))}`);
    await record(scene, id, about, manifest);
    const line = (m) => Object.entries(m).map(([k, v]) => `${k} over ${v.overPx}, floating ${v.floatPx} px (top ${v.topCm} cm) of ${v.bodyPx}`).join("; ");
    console.log(`[${scene}] floating over the point: ${line(manifest.views)}`);
    console.log(`[${scene}] with every lip at nothing: ${line(manifest.noLips)}`);
  } catch (e) { console.error(`FAIL [${scene}]: ${e.stack ?? e}`); process.exitCode = 1; manifest.error = String(e); }
  finally { writeFileSync(`${OUT}/${scene}.json`, JSON.stringify(manifest, null, 1) + "\n"); close(); }
}
if (errors.length) console.error(`console errors: ${J(errors.slice(0, 5))}`);
clearTimeout(DEADLINE);
process.exit(process.exitCode ?? 0);
