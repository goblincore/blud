// scripts/censer-look.mjs — the censer's LOOK, measured (censer Task 9 look pass;
// docs/dev-notes/2026-09-26-censer/NOTES.md "Look pass").
//
// Headless, same page and arena as scripts/censer-gate.mjs. Every number is a
// DIFFERENCE shot on one frozen frame (render lock): the frame as drawn, then again
// with a part hidden (__sdfGame.censer.hide) or the swing blur off, so the part's own
// pixels are isolated from the room behind it.
//   rest   — standing 2.3 m from a zombie (out of reach, so no stroke lands): the head's clipped fraction (max channel
//            >= 245) and mean luma over its own pixels; the hand's (arm + bracer)
//            share of the frame and its bounding box.
//   tap    — frames of a tap stroke, blur ON vs OFF vs the censer hidden: how much of
//            the haft's and the chain's contrast against the room survives the blur
//            at their own pixels (see retention()).
//   heavy  — the same for the chain through a heavy stroke's recover.
//   smoke  — mid-spin and after the stroke: the smoke's own pixels (smoke hidden →
//            difference), its mean contrast, and each puff's elongation (the long/short
//            axis ratio of a connected blob).
//
// Usage (vite + a WebGPU Chrome already listening — bash, scripts/lab-servers.sh):
//   node scripts/censer-look.mjs <vitePort> <cdpPort>
// Env: OUT (docs/dev-notes/2026-09-26-censer/look), TAG (a label for the JSON).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5233);
const CDP = Number(process.argv[3] ?? 9223);
const OUT = process.env.OUT ?? 'docs/dev-notes/2026-09-26-censer/look';
const TAG = process.env.TAG ?? 'look';
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const E = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
mkdirSync(OUT, { recursive: true });

function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('unsupported png');
  const ch = colorType === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(idat)); const stride = w * ch;
  const out = Buffer.alloc(w * h * ch); let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++]; const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null; const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = x >= ch && prev ? prev[x - ch] : 0; let v = row[x];
      if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255; else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
/** Lock the sim, re-render twice (screenshots lag hand-stepped frames by one), shoot. */
async function frame(name) {
  await E('__sdfGame.step(2, 1 / 60)');
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  if (name) writeFileSync(`${OUT}/${name}.png`, buf);
  return decodePng(buf);
}
const px = (ndc) => [(ndc[0] + 1) * 0.5 * W, (1 - ndc[1]) * 0.5 * H];
const at = (img, x, y) => { const i = (Math.round(y) * img.w + Math.round(x)) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const dmax = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** How much of a part's contrast against the room SURVIVES the blur, at the part's
 *  own pixels: the part's pixels are those within `halfW` px of a polyline (NDC
 *  points; `from`..`to` of its length) that differ from the room (bg, the censer
 *  hidden) by > 20 in the sharp frame (ref, blur OFF); retention = the mean, over
 *  them, of |on − bg| / |off − bg| (each clipped to 1). 1 = drawn as sharp as without
 *  blur; 0.2 = a fifth of it is left — the part has smeared into the room. */
function retention(on, bg, ref, pts, { halfW = 5, from = 0, to = 1, exclude = null } = {}) {
  const ps = pts.map(px);
  const segs = [];
  let total = 0;
  for (let i = 0; i + 1 < ps.length; i++) { const l = Math.hypot(ps[i + 1][0] - ps[i][0], ps[i + 1][1] - ps[i][1]); segs.push(l); total += l; }
  if (!(total > 4)) return { retention: null, pixels: 0 };
  const lo = from * total, hi = to * total;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const p of ps) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  let sum = 0, n = 0;
  for (let y = Math.max(0, Math.floor(y0 - halfW)); y <= Math.min(H - 1, Math.ceil(y1 + halfW)); y++) {
    for (let x = Math.max(0, Math.floor(x0 - halfW)); x <= Math.min(W - 1, Math.ceil(x1 + halfW)); x++) {
      // Distance to the polyline, and the arc length at the nearest point.
      let best = Infinity, arc = 0, acc = 0;
      for (let i = 0; i < segs.length; i++) {
        const [ax, ay] = ps[i], [bx, by] = ps[i + 1]; const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
        if (d < best) { best = d; arc = acc + t * segs[i]; }
        acc += segs[i];
      }
      if (best > halfW || arc < lo || arc > hi) continue;
      if (exclude && exclude[y * W + x]) continue;
      const r = dmax(at(ref, x, y), at(bg, x, y));
      if (r <= 20) continue;
      sum += Math.min(1, dmax(at(on, x, y), at(bg, x, y)) / r); n++;
    }
  }
  return n ? { retention: sum / n, pixels: n } : { retention: null, pixels: 0 };
}

// ---- Boot, the arena, the censer ------------------------------------------------------
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`); await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off&loader=0` });
for (let i = 0; i < 480; i++) { await sleep(500); try { if ((await E('window.__warmGate ? window.__warmGate.phase : null')) === 'ready') break; } catch {} }
if ((await E('__sdfGame.backend')) !== 'webgpu') die('not webgpu');
await E('__sdfGame.setLoopRunning(false)'); await E('__sdfGame.freeze(true)'); await E('__sdfGame.censer.setHitStop(false)');
for (const p of ['woundPanel', 'gooPanel', 'vhsPanel']) await E(`typeof __sdfGame.${p} === "function" ? (__sdfGame.${p}(false), 1) : 0`);
if (!(await E(`__sdfGame.selectSlot('censer')`))?.ok) die('no censer slot');
for (let i = 0; i < 40; i++) await E('__sdfGame.step(1, 1 / 60)');
for (let i = 0; i < 900; i++) { if ((await E('__sdfGame.censer.state().blurWarm')) === 'done') break; await E('__sdfGame.step(1, 1 / 60)'); await sleep(20); }
const zs = (await E('__sdfGame.actorList()')).filter((a) => a.kind === 'zombie');
const byRoom = new Map(); for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
const [, pool] = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0];
const zombie = pool[6] ?? pool[0];
const t = await E(`__sdfGame.actorLimbCentre(${zombie.id}, 'torso')`);
const room = (await E('__sdfGame.rooms')).find((r) => r.id === zombie.room);
const cx = (room.bounds.minX + room.bounds.maxX) / 2, cz = (room.bounds.minZ + room.bounds.maxZ) / 2;
const ax = cx - t[0], az = cz - t[2], al = Math.hypot(ax, az);
// yaw 0 looks −z and π/2 looks +x (read off the camera by censer-gate.mjs): face the
// zombie from the room side.
const yaw = Math.atan2(-ax / al, az / al);
const stand = async () => {
  await E(`__sdfGame.placePlayer({ x: ${t[0] + (ax / al) * 2.3}, z: ${t[2] + (az / al) * 2.3}, yaw: ${yaw}, pitch: -0.2 })`);
};
const settle = async (n) => {
  for (let i = 0; i < 240; i++) { if ((await E('__sdfGame.censer.state().phase')) === 'idle') break; await E('__sdfGame.step(1, 1 / 60)'); }
  for (let i = 0; i < n; i++) await E('__sdfGame.step(1, 1 / 60)');
};
const metrics = { tag: TAG };

// ---- REST ---------------------------------------------------------------------------------
await stand(); await settle(120);
{
  await E('__sdfGame.setRenderLock(true)');
  const st = await E('__sdfGame.censer.state()');
  const rest = await frame(`${TAG}-rest`);
  await E(`__sdfGame.censer.hide('all')`); const bg = await frame(null);
  await E(`__sdfGame.censer.hide('hand')`); const noHand = await frame(null);
  await E('__sdfGame.censer.hide(null)'); await frame(null);
  await E('__sdfGame.setRenderLock(false)');
  const [hx, hy] = px(st.headNdc);
  let headPx = 0, clipped = 0, lsum = 0, handPx = 0;
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(rest, x, y);
    if (dmax(c, at(noHand, x, y)) > 24) {
      handPx++; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
    }
    if (Math.hypot(x - hx, y - hy) < 70 && dmax(c, at(bg, x, y)) > 24 && dmax(c, at(noHand, x, y)) <= 24) {
      headPx++; lsum += luma(c); if (Math.max(...c) >= 245) clipped++;
    }
  }
  metrics.rest = {
    headNdc: st.headNdc.map((v) => +v.toFixed(3)), knotNdc: st.knotNdc.map((v) => +v.toFixed(3)),
    headPixels: headPx, headMeanLuma: +(lsum / Math.max(1, headPx)).toFixed(1), headClippedFrac: +(clipped / Math.max(1, headPx)).toFixed(3),
    handFrameFrac: +(handPx / (W * H)).toFixed(4), handBox: [bx0, by0, bx1, by1],
  };
  console.log('rest', JSON.stringify(metrics.rest));
}

// ---- One measured frame of a stroke: blur ON vs OFF vs the censer hidden -------------------
async function blurFrame(name, save) {
  await E('__sdfGame.setRenderLock(true)');
  const st = await E('__sdfGame.censer.state()');
  const on = await frame(save ? `${TAG}-${name}-on` : null);
  await E('__sdfGame.setGibBlur(false)'); const off = await frame(save ? `${TAG}-${name}-off` : null);
  await E(`__sdfGame.censer.hide('hand')`); const offNoHand = await frame(null);
  await E(`__sdfGame.censer.hide('all')`); const bg = await frame(null);
  await E('__sdfGame.censer.hide(null)'); await E('__sdfGame.setGibBlur(true)'); await frame(null);
  await E('__sdfGame.setRenderLock(false)');
  // The hand's own pixels (sharp frame) are not the haft's.
  const handMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dmax(at(off, x, y), at(offNoHand, x, y)) > 20) handMask[y * W + x] = 1;
  const haft = retention(on, bg, off, [st.gripNdc, st.knotNdc], { halfW: 7, exclude: handMask });
  const chain = st.chainNdc.length > 1 ? retention(on, bg, off, st.chainNdc, { halfW: 5, exclude: handMask }) : { retention: null, pixels: 0 };
  const r2 = (v) => (v === null ? null : +v.toFixed(2));
  const row = { name, phase: st.phase, speed: +st.headSpeed.toFixed(1), offered: st.blurOffered,
    haft: r2(haft.retention), haftPx: haft.pixels, chain: r2(chain.retention), chainPx: chain.pixels };
  console.log('  ', JSON.stringify(row));
  return row;
}

// ---- TAP: the haft mid-stroke ----------------------------------------------------------------
metrics.tap = [];
for (const f of [4, 5, 6, 7, 8]) {
  await stand(); await settle(60);
  await E('__sdfGame.censer.setAim(0, 0)');
  await E('__sdfGame.censer.press()'); for (let i = 0; i < 3; i++) await E('__sdfGame.step(1, 1 / 60)');
  await E('__sdfGame.censer.release()');
  for (let i = 0; i <= f; i++) await E('__sdfGame.step(1, 1 / 60)');
  metrics.tap.push(await blurFrame(`tap-f${f}`, f === 5 || f === 7));
}

// ---- HEAVY: the chain in the recover -----------------------------------------------------------
metrics.heavy = [];
for (const f of [6, 8, 18, 22, 26]) {
  await stand(); await settle(60);
  await E('__sdfGame.censer.setAim(0, 0)');
  await E('__sdfGame.censer.press()'); for (let i = 0; i < 80; i++) await E('__sdfGame.step(1, 1 / 60)');
  await E('__sdfGame.censer.release()');
  for (let i = 0; i <= f; i++) await E('__sdfGame.step(1, 1 / 60)');
  metrics.heavy.push(await blurFrame(`heavy-f${f}`, f === 8 || f === 22));
}

// ---- SMOKE ---------------------------------------------------------------------------------------
/** The smoke's own pixels (smoke hidden → difference), their mean contrast, and blobs' elongation. */
function smokeStats(img, bg) {
  const mask = new Uint8Array(W * H); let n = 0, sum = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = dmax(at(img, x, y), at(bg, x, y)); if (d > 6) { mask[y * W + x] = 1; n++; sum += d; }
  }
  const seen = new Uint8Array(W * H); const blobs = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i]; seen[i] = 1; const pts = [];
    while (stack.length) {
      const j = stack.pop(); pts.push(j); const x = j % W, y = (j / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (!inside(X, Y)) continue; const k = Y * W + X;
        if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    if (pts.length < 60) continue;
    let mx = 0, my = 0; for (const j of pts) { mx += j % W; my += (j / W) | 0; } mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const j of pts) { const dx = (j % W) - mx, dy = ((j / W) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    blobs.push({ px: pts.length, elong: Math.sqrt((tr / 2 + disc) / Math.max(1e-6, tr / 2 - disc)) });
  }
  blobs.sort((a, b) => b.px - a.px);
  const top = blobs.slice(0, 8);
  return { pixels: n, meanContrast: +(sum / Math.max(1, n)).toFixed(1), blobs: blobs.length,
    medianElong: top.length ? +top.map((b) => b.elong).sort((a, b) => a - b)[top.length >> 1].toFixed(2) : null };
}
async function smokeShot(name) {
  await E('__sdfGame.setRenderLock(true)');
  const img = await frame(`${TAG}-${name}`);
  await E(`__sdfGame.censer.hide('smoke')`); const bg = await frame(null);
  await E('__sdfGame.censer.hide(null)'); await frame(null);
  await E('__sdfGame.setRenderLock(false)');
  const s = smokeStats(img, bg);
  console.log(`  smoke ${name}`, JSON.stringify(s));
  return s;
}
metrics.smoke = {};
await stand(); await settle(60);
// At rest (the coal smoulders): 3 s of trail.
for (let i = 0; i < 180; i++) await E('__sdfGame.step(1, 1 / 60)');
metrics.smoke.rest = await smokeShot('smoke-rest');
await E('__sdfGame.censer.setAim(0, 0)');
await E('__sdfGame.censer.press()'); for (let i = 0; i < 70; i++) await E('__sdfGame.step(1, 1 / 60)');
metrics.smoke.spin = await smokeShot('smoke-spin');
await E('__sdfGame.censer.release()'); for (let i = 0; i < 30; i++) await E('__sdfGame.step(1, 1 / 60)');
metrics.smoke.after = await smokeShot('smoke-after');

writeFileSync(`${OUT}/${TAG}-metrics.json`, JSON.stringify(metrics, null, 2));
console.log(errors.length ? `console errors: ${errors.slice(0, 3).join(' | ')}` : 'no console errors');
process.exit(0);
