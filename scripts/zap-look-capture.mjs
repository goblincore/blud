// scripts/zap-look-capture.mjs
//
// ZAP LOOK SPIKE CAPTURE (docs/dev-notes/2026-11-18-zap-look-spike/NOTES.md). For each character and each look
// variant (zap-look.ts: a the baseline, b, c) it boots the test arena, puts the arc on the body and saves the two
// strobe states (the positive frame and the negative frame of a jolt), from far enough to see the whole body; for
// the characters in ZAP_LOOK_CLOSE also from 1 m on the head, where it measures whether the skull's features read:
// the same instant is drawn with the bones shown and hidden (`meshSkeletonShow`, under `setRenderLock`), the pixels
// that differ are the skeleton, and the luminance spread and the mean gradient INSIDE that mask (its rim eroded
// away) are the features. The crawl arcs are off for that measurement and on for every saved look frame.
//
// It also reads the strobe from the running game (jolts a second over 3 s of sim time, body-box luminance in both
// states) and the pipeline count before and after each variant's first zap.
//
// The harness is scripts/zap-trace.mjs's: own vite + headless Chrome on an unused port pair, the real page, the
// `window.__warmGate.phase === 'ready'` gate, a flat-frame gate and a renderer-pipeline-error guard.
//
// Usage: node scripts/zap-look-capture.mjs [vitePort] [cdpPort] [outDir]
//   ZAP_LOOK_CHARS=zombie,teratoma   characters (default zombie)
//   ZAP_LOOK_VARIANTS=a,b,c          look variants (default a,b,c)
//   ZAP_LOOK_CLOSE=zombie            characters that also get the close look and the skull numbers
//   ZAP_LOOK_TAG=main                the contact sheet's and the report's name

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5551);
const CDP = Number(process.argv[3] ?? 9551);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-11-18-zap-look-spike');
const CHARS = (process.env.ZAP_LOOK_CHARS ?? 'zombie').split(',').filter(Boolean);
const VARIANTS = (process.env.ZAP_LOOK_VARIANTS ?? 'a,b,c').split(',').filter(Boolean);
const CLOSE = (process.env.ZAP_LOOK_CLOSE ?? 'zombie').split(',').filter(Boolean);
const TAG = process.env.ZAP_LOOK_TAG ?? 'main';
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DT = 1 / 60;
const MIN_LUMA_STD = 4;

const report = { tag: TAG, characters: {}, consoleErrors: [] };
const consoleErrors = [];
const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  try { writeFileSync(`${OUT}/zap-look-${TAG}.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });
setTimeout(() => { console.error('WATCHDOG: capture exceeded 40 minutes'); shutdown(9); }, 40 * 60 * 1000);
const fail = (msg) => { throw new Error(msg); };

function decodePng(png) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'PLTE') plte = Buffer.from(data);
    if (type === 'tRNS') trns = Buffer.from(data);
    if (type === 'IEND') break;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || ![2, 3, 6].includes(colorType)) return { unsupported: true };
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 3 ? 1 : colorType === 6 ? 4 : 3;
  const unfilter = (stride) => {
    const out = Buffer.alloc(h * stride);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const cur = out.subarray(y * stride, (y + 1) * stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (f === 1) v = (v + a) & 0xff;
        else if (f === 2) v = (v + b) & 0xff;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        cur[i] = v;
      }
      prev = cur;
    }
    return out;
  };
  if (colorType === 3) {
    const idx = unfilter(w);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const p = idx[i];
      rgba[i * 4] = plte[p * 3]; rgba[i * 4 + 1] = plte[p * 3 + 1]; rgba[i * 4 + 2] = plte[p * 3 + 2];
      rgba[i * 4 + 3] = trns && p < trns.length ? trns[p] : 255;
    }
    return { w, h, rgba };
  }
  const chans = colorType === 6 ? 4 : 3;
  const out = unfilter(w * chans);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = out[i * chans]; rgba[i * 4 + 1] = out[i * chans + 1]; rgba[i * 4 + 2] = out[i * chans + 2];
    rgba[i * 4 + 3] = chans === 4 ? out[i * chans + 3] : 255;
  }
  return { w, h, rgba };
}

const lumaAt = (d, i) => 0.299 * d.rgba[i] + 0.587 * d.rgba[i + 1] + 0.114 * d.rgba[i + 2];
function boxOf(d, box) {
  return [Math.round(d.w * box[0]), Math.round(d.w * box[1]), Math.round(d.h * box[2]), Math.round(d.h * box[3])];
}
/** Mean and standard deviation of a box's luminance (0..255), and its mean blue - red. */
function boxStats(png, box = [0, 1, 0, 1]) {
  const d = decodePng(png);
  const [x0, x1, y0, y1] = boxOf(d, box);
  let n = 0, s = 0, s2 = 0, br = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * d.w + x) * 4, l = lumaAt(d, i);
    n++; s += l; s2 += l * l; br += d.rgba[i + 2] - d.rgba[i];
  }
  const mean = s / n;
  return { mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(2), blueMinusRed: +(br / n).toFixed(1) };
}
/**
 * THE SKULL'S FEATURES. The skeleton's pixels in `box` are those that differ between the bones-shown and the
 * bones-hidden draw of one instant by more than 40 of 255 (in luminance). Inside that mask with its rim eroded by
 * 3 px (so the silhouette edge is not counted as a feature): the luminance's standard deviation (contrast), its
 * 5th-to-95th percentile spread, and the mean Sobel gradient magnitude (edges). A flat silhouette scores near 0.
 */
function skullFeatures(pngShown, pngHidden, box) {
  const a = decodePng(pngShown), b = decodePng(pngHidden);
  const [x0, x1, y0, y1] = boxOf(a, box);
  const w = x1 - x0, h = y1 - y0;
  const mask = new Uint8Array(w * h), L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y + y0) * a.w + (x + x0)) * 4;
    L[y * w + x] = lumaAt(a, i);
    mask[y * w + x] = Math.abs(lumaAt(a, i) - lumaAt(b, i)) > 40 ? 1 : 0;
  }
  let inner = mask;
  for (let k = 0; k < 3; k++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const j = y * w + x;
      next[j] = inner[j] && inner[j - 1] && inner[j + 1] && inner[j - w] && inner[j + w] ? 1 : 0;
    }
    inner = next;
  }
  let n = 0, s = 0, s2 = 0, g = 0, gn = 0;
  const vals = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const j = y * w + x;
    if (!inner[j]) continue;
    n++; s += L[j]; s2 += L[j] * L[j]; vals.push(L[j]);
    const gx = (L[j - w + 1] + 2 * L[j + 1] + L[j + w + 1]) - (L[j - w - 1] + 2 * L[j - 1] + L[j + w - 1]);
    const gy = (L[j + w - 1] + 2 * L[j + w] + L[j + w + 1]) - (L[j - w - 1] + 2 * L[j - w] + L[j - w + 1]);
    g += Math.hypot(gx, gy) / 4; gn++;
  }
  if (n < 50) return { pixels: n, contrast: 0, spread: 0, edge: 0 };
  vals.sort((p, q) => p - q);
  const mean = s / n;
  return {
    pixels: n, mean: +mean.toFixed(1),
    contrast: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(2),
    spread: +(vals[Math.floor(n * 0.95)] - vals[Math.floor(n * 0.05)]).toFixed(1),
    edge: +(g / Math.max(1, gn)).toFixed(2),
  };
}

async function waitFor(url, what, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error(`${what} never came up at ${url}`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(`${LAB_TMP}/tmp-${CDP}`, { recursive: true });
for (const [port, what] of [[VITE, 'vite'], [CDP, 'chrome']]) {
  try {
    const r = await fetch(`http://localhost:${port}/`);
    if (r.status >= 0) { console.error(`port ${port} (${what}) is already answering — choose another`); process.exit(2); }
  } catch { /* connection refused = free */ }
}
console.log(`starting vite on ${VITE}`);
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE), '--strictPort'], { stdio: 'ignore', detached: true });
children.push(vite);
await waitFor(`http://localhost:${VITE}/`, 'vite');
console.log(`starting headless chrome on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${LAB_TMP}/chrome-zaplook-${CDP}`,
  '--no-first-run', '--no-default-browser-check', '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-zaplook-${CDP}`,
  '--window-size=960,600', 'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-${CDP}` } });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, 'chrome debug port');

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleErrors.push(text); report.consoleErrors.push(text.slice(0, 300));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const text = JSON.stringify(m.params.exceptionDetails).slice(0, 300);
    consoleErrors.push(text); report.consoleErrors.push(text);
  }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, timeoutMs = 30000) => {
  const reply = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (reply.__timeout) throw new Error(`Runtime.evaluate timed out after ${timeoutMs}ms: ${expression.slice(0, 90)}`);
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
  return reply.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });

async function bootGame(query) {
  const q = new URLSearchParams(query);
  if (!q.has('seed')) q.set('seed', '20261118');
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) { await sleep(500); ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false); }
  if (!ok) throw new Error(`__sdfGame never booted (${query})`);
  let gate = null;
  for (let i = 0; i < 240 && !gate; i++) { gate = await evaluate('window.__warmGate ?? null').catch(() => null); if (!gate) await sleep(500); }
  if (!gate) throw new Error(`warm gate never settled (${query})`);
  if (gate.phase !== 'ready') throw new Error(`boot did not reach READY (${query}): warm gate phase '${gate.phase}'`);
  await sleep(1500);
  await evaluate(`(() => { const g = window.__sdfGame;
    for (const fn of ['shutterPanel','gooPanel','vhsPanel','dynamitePanel','woundPanel']) { try { if (typeof g[fn] === 'function') g[fn](false); } catch {} }
    try { g.setBloodBlur(false); } catch {}
    return true; })()`);
  // The title card fades over the first seconds: wait it out, or it is in the first frame saved.
  await sleep(6000);
}
const tiles = [];
async function capture(name, label) {
  const shot = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(20000).then(() => ({ __timeout: true }))]);
  if (shot.__timeout) fail(`Page.captureScreenshot timed out for ${name}`);
  const buf = Buffer.from(shot.result.data, 'base64');
  const st = boxStats(buf);
  if (st.std < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${st.std} < ${MIN_LUMA_STD}) — nothing rendered`);
  writeFileSync(`${OUT}/${name}.png`, buf);
  if (label) tiles.push({ label, b64: shot.result.data });
  return buf;
}
const step = (frames) => evaluate(`window.__sdfGame.step(${frames}, ${DT})`, 180000);
const pipelineGuard = (where) => {
  const errs = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t) || /WGSL|shader module|CreateShaderModule|CreateRenderPipeline/i.test(t));
  if (errs.length > 0) fail(`renderer pipeline error (${where}): ${errs[0].slice(0, 400)}`);
};

/** The body box's fractions of the frame the luminance is read in, with the camera framed by `frame`. */
const BODY = [0.3, 0.7, 0.08, 0.92];
/** The head from 1 m, level: the skull and its jaw. */
const SKULL = [0.36, 0.64, 0.14, 0.62];

/** A fresh body, the player `dist` from it looking at the middle of its box (or at `aimY`), nothing zapped. */
let home = null;
async function fresh(dist, aimY) {
  // Back to where the boot stood the player, so every respawned body walks the same way before it is framed.
  home ??= await evaluate('window.__sdfGame.pose()');
  await evaluate(`window.__sdfGame.unzapActor(); window.__sdfGame.setPose(${home.pos[0]}, ${home.pos[2]}, ${home.yaw}, 0); window.__sdfGame.arena(0)`);
  let id = null;
  for (let i = 0; i < 400 && id === null; i++) {
    await step(2);
    id = await evaluate(`(() => { const g = window.__sdfGame; const t = g.actorTrace(); return t.length === 1 && g.zaps().length === 0 ? t[0].id : null; })()`);
    if (id === null) await sleep(250);
  }
  if (id === null) fail('the arena never held one fresh body');
  await step(20);
  const placed = await evaluate(`(() => {
    const g = window.__sdfGame, p = g.playerPos(), a = g.actorTrace().find(x => x.id === ${id}), box = g.zapBox(${id});
    const c = box ? box.center : [a.pos[0], a.pos[1] + 1, a.pos[2]], half = box ? box.half : [0.4, 0.9, 0.4];
    let dx = c[0] - p[0], dz = c[2] - p[2]; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    // The box is the body at rest: the star raises the arms over it, so the frame leaves room above.
    const top = c[1] + half[1], wide = Math.max(half[0], half[2]);
    const dist = ${dist ?? 'null'} ?? Math.max(2.6, 1.75 * Math.max(top * 1.15, 2.4 * wide));
    const aimY = ${aimY ?? 'null'} ?? 0.6 * top;
    const eyeY = 1.6;
    g.setPose(c[0] - dx * dist, c[2] - dz * dist, Math.atan2(dx, -dz), Math.atan2(aimY - eyeY, dist));
    return { dist: +dist.toFixed(2), box, eye: g.playerPos() };
  })()`);
  await step(2);
  return { id, ...placed };
}

/** Step until the body's strobe state is `invert`, at least `minFrames` in; null if it never is within `maxFrames`. */
async function untilState(id, invert, minFrames, maxFrames) {
  for (let f = 0; f < maxFrames; f++) {
    await step(1);
    const z = (await evaluate('window.__sdfGame.zaps()')).find((x) => x.id === id);
    if (!z || z.phase !== 'zapped') return null;
    if (f + 1 >= minFrames && z.invert === invert) return { frames: f + 1, glow: z.glow, char: z.char };
  }
  return null;
}

/** One instant drawn with the bones shown and hidden, arcs off: the skull's features. */
async function skullPair(name) {
  await evaluate('window.__sdfGame.zapFxArcs(false); window.__sdfGame.setRenderLock(true)');
  await step(2);
  const shown = await capture(`${name}-bones`, null);
  await evaluate('window.__sdfGame.meshSkeletonShow({ bones: false, eyes: false })');
  await step(2);
  const hidden = await capture(`${name}-nobones`, null);
  await evaluate('window.__sdfGame.meshSkeletonShow({ bones: true, eyes: true }); window.__sdfGame.zapFxArcs(true); window.__sdfGame.setRenderLock(false)');
  return { features: skullFeatures(shown, hidden, SKULL), skullBox: boxStats(shown, SKULL) };
}

try {
  for (const ch of CHARS) {
    console.log(`\n=== ${ch} ===`);
    home = null;
    try { await bootGame(`level=arena&spawn=${ch}`); }
    catch (e) {
      // A character the arena cannot spawn is a finding, not the end of the run.
      const boot = consoleErrors.filter((t) => /bootstrap failed/.test(t)).pop() ?? '';
      report.characters[ch] = { bootFailed: String(e?.message ?? e), bootError: boot.slice(0, 200) };
      console.log(`  ${ch}: BOOT FAILED ${String(e?.message ?? e)} ${boot.slice(0, 160)}`);
      consoleErrors.length = 0;
      continue;
    }
    pipelineGuard(`${ch} boot`);
    const rec = report.characters[ch] = { variants: {} };
    for (const v of VARIANTS) {
      const out = rec.variants[v] = {};
      // ---- the whole body, both strobe states ----------------------------------------------------------------
      const f = await fresh();
      out.distance = f.dist; out.box = f.box;
      const look = await evaluate(`window.__sdfGame.zapLook('${v}')`);
      if (look.id !== v) fail(`zapLook('${v}') left the look at '${look.id}'`);
      const pipesBefore = await evaluate('window.__sdfGame.pipelineLog().totalPipelines');
      const started = await evaluate(`window.__sdfGame.zapActor(${f.id})`);
      out.zapStarted = started;
      if (started !== 1) { console.log(`  ${ch}/${v}: zapActor refused`); continue; }
      const pos = await untilState(f.id, false, 10, 40);
      if (pos) { const png = await capture(`${ch}-${v}-body-pos`, `${ch} ${v} positive`); out.bodyPos = { ...pos, body: boxStats(png, BODY) }; }
      const neg = await untilState(f.id, true, 1, 70);
      if (neg) { const png = await capture(`${ch}-${v}-body-neg`, `${ch} ${v} negative`); out.bodyNeg = { ...neg, body: boxStats(png, BODY) }; }
      else console.log(`  ${ch}/${v}: no negative frame before the body cooked`);
      await step(3);
      out.pipelines = { before: pipesBefore, after: await evaluate('window.__sdfGame.pipelineLog().totalPipelines') };
      out.fx = (await evaluate('window.__sdfGame.zapLook()')).fx;
      out.bones = await evaluate(`(window.__sdfGame.boneZap(${f.id}) ?? []).length`);
      pipelineGuard(`${ch}/${v}`);
      console.log(`  ${ch}/${v}: ${JSON.stringify(out)}`);

      // ---- the strobe as the game runs it: 3 s of sim time on a fresh body -----------------------------------
      if (ch === CHARS[0]) {
        const g = await fresh();
        await evaluate(`window.__sdfGame.zapActor(${g.id})`);
        const seq = await evaluate(`(() => { const g = window.__sdfGame, out = [];
          for (let i = 0; i < 96; i++) { g.step(1, ${DT}); const z = g.zaps().find(x => x.id === ${g.id}); out.push(z && z.phase === 'zapped' ? (z.invert ? 1 : 0) : -1); }
          return out; })()`, 120000);
        const live = seq.filter((s) => s >= 0);
        let jolts = 0; for (let i = 1; i < live.length; i++) if (live[i] === 1 && live[i - 1] === 0) jolts++;
        out.strobe = { seconds: +(live.length * DT).toFixed(2), jolts, joltsPerSec: +(jolts / (live.length * DT)).toFixed(2), negativeShare: +(live.filter((s) => s === 1).length / live.length).toFixed(3) };
        console.log(`  ${ch}/${v} strobe: ${JSON.stringify(out.strobe)}`);
      }

      // ---- the head from 1 m: do the skull's features read? --------------------------------------------------
      if (CLOSE.includes(ch)) {
        // The arc first, from far off (a body this near lunges before it is zapped), then the camera goes in.
        const c = await fresh();
        await evaluate(`window.__sdfGame.zapActor(${c.id})`);
        await step(2);
        await evaluate(`(() => { const g = window.__sdfGame, p = g.playerPos(), a = g.actorTrace().find(x => x.id === ${c.id});
          let dx = a.pos[0] - p[0], dz = a.pos[2] - p[2]; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
          g.setPose(a.pos[0] - dx * 1.0, a.pos[2] - dz * 1.0, Math.atan2(dx, -dz), 0.02); })()`);
        const cp = await untilState(c.id, false, 10, 40);
        if (cp) { await capture(`${ch}-${v}-skull-pos`, `${ch} ${v} skull positive`); out.skullPos = await skullPair(`${ch}-${v}-skull-pos`); }
        const cn = await untilState(c.id, true, 1, 70);
        if (cn) { await capture(`${ch}-${v}-skull-neg`, `${ch} ${v} skull negative`); out.skullNeg = await skullPair(`${ch}-${v}-skull-neg`); }
        console.log(`  ${ch}/${v} skull: pos ${JSON.stringify(out.skullPos?.features)} neg ${JSON.stringify(out.skullNeg?.features)}`);
        pipelineGuard(`${ch}/${v} close`);
      }
    }
    await evaluate(`window.__sdfGame.zapLook('a')`);
  }

  // ---- the contact sheet: a row a character and state, a column a variant is not forced; tiles in capture order
  await evaluate('window.__sheet = []');
  for (const t of tiles) await evaluate(`window.__sheet.push(${JSON.stringify(t)})`);
  const cols = Number(process.env.ZAP_LOOK_COLS ?? 4);
  const dataUrl = await evaluate(`(async () => {
    const tiles = window.__sheet;
    const imgs = await Promise.all(tiles.map(t => new Promise((ok, err) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = () => err(new Error('decode'));
      im.src = 'data:image/png;base64,' + t.b64;
    })));
    const k = 0.5, cw = imgs[0].naturalWidth * k, ch = imgs[0].naturalHeight * k, lh = 22;
    const cols = ${cols}, rows = Math.ceil(imgs.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * cw; cv.height = rows * (ch + lh);
    const g = cv.getContext('2d');
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, cv.width, cv.height);
    tiles.forEach((t, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lh);
      g.drawImage(imgs[i], x, y + lh, cw, ch);
      g.fillStyle = '#e8e8e8'; g.font = 'bold 14px monospace'; g.textBaseline = 'top';
      g.fillText(t.label, x + 6, y + 4);
      g.strokeStyle = '#444'; g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch + lh - 1);
    });
    return cv.toDataURL('image/png');
  })()`, 60000);
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
    writeFileSync(`${OUT}/zap-look-sheet-${TAG}.png`, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
    console.log(`contact sheet: ${OUT}/zap-look-sheet-${TAG}.png`);
  } else console.log('WARNING: contact sheet composition returned nothing');
  pipelineGuard('end');
  console.log('\nDONE');
  shutdown(0);
} catch (err) {
  console.error('CAPTURE FAILED:', err?.message ?? err);
  report.failed = String(err?.message ?? err);
  shutdown(1);
}
