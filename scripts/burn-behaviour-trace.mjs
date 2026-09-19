// scripts/burn-behaviour-trace.mjs
//
// BURN-BEHAVIOUR TRACE (2026-09-18 burning-feedback pass, Task 2). Proves the
// in-game panic override with NUMBERS, not adjectives:
//
//   * a burning SOLDIER flees the player (distance grows), runs faster than
//     its unburnt cruise, and never fires;
//   * a burning ZOMBIE keeps chasing (distance shrinks) and runs faster;
//   * both STUMBLE at least twice in the 6 s burn window.
//
// The harness is scripts/flare-ingame-capture.mjs's: own vite + headless
// Chrome on an unused port pair, the real page, the real renderer, the
// `window.__warmGate.phase === 'ready'` gate, a flat-frame luma gate and a
// renderer-pipeline-error guard. It also saves a 4-frame contact sheet.
//
// Usage: node scripts/burn-behaviour-trace.mjs [vitePort] [cdpPort] [outDir]

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5531);
const CDP = Number(process.argv[3] ?? 9531);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-09-18-burning-feedback');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_LUMA_STD = 5;
const DT = 1 / 30;
/** Stumble frames the burn-window recorder expects at minimum (2 in 6 s). */
const MIN_STUMBLES = 2;

const report = {
  branch: (() => { try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
  checks: {}, consoleErrors: [],
};
const consoleErrors = [];

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  try { writeFileSync(`${OUT}/burn-behaviour-trace.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });
setTimeout(() => { console.error('WATCHDOG: trace exceeded 14 minutes'); shutdown(9); }, 14 * 60 * 1000);
const fail = (msg) => { throw new Error(msg); };

// ---------------------------------------------------------------------------
// PNG decode + luma stats (flare-ingame-capture.mjs's flat-frame gate).
// ---------------------------------------------------------------------------
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
function pngStats(png) {
  const d = decodePng(png);
  if (d.unsupported) return d;
  const { w, h, rgba } = d;
  let n = 0, s = 0, s2 = 0;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const i = (y * w + x) * 4;
      const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      n++; s += l; s2 += l * l;
    }
  }
  const mean = s / n;
  return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
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
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE), '--strictPort'], {
  stdio: 'ignore', detached: true,
});
children.push(vite);
await waitFor(`http://localhost:${VITE}/`, 'vite');

console.log(`starting headless chrome on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${LAB_TMP}/chrome-burntrace-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-burntrace-${CDP}`,
  '--window-size=960,600',
  'about:blank',
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
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
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

/** Boot the game and wait for the REAL warm outcome (phase === 'ready'). */
async function bootGame(query = '') {
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  if (!q.has('seed')) q.set('seed', '20260918');
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${q.toString()}` });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    await sleep(500);
    ok = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
  }
  if (!ok) throw new Error(`__sdfGame never booted (${query || 'no query'})`);
  let gate = null;
  for (let i = 0; i < 180 && !gate; i++) {
    gate = await evaluate('window.__warmGate ?? null').catch(() => null);
    if (!gate) await sleep(500);
  }
  if (!gate) {
    const loader = await evaluate(`document.getElementById('loader')?.textContent?.trim() ?? ''`).catch(() => '?');
    throw new Error(`warm gate never settled after 90 s (${query || 'no query'}); loader says: ${loader.slice(0, 120)}`);
  }
  if (gate.phase !== 'ready') {
    throw new Error(`boot did not reach READY (${query || 'no query'}): warm gate phase '${gate.phase}'`
      + (gate.phase === 'device-lost' ? ' — often GPU contention from another WebGPU page or capture running at the same time' : ''));
  }
  await sleep(1500);
  await evaluate(`(() => {
    const g = window.__sdfGame;
    for (const fn of ['shutterPanel','gooPanel','vhsPanel','dynamitePanel','woundPanel']) {
      try { if (typeof g[fn] === 'function') g[fn](false); } catch {}
    }
    return true;
  })()`);
  await sleep(2500);
}

async function capture(name, note = '') {
  const shot = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    sleep(20000).then(() => ({ __timeout: true })),
  ]);
  if (shot.__timeout) fail(`Page.captureScreenshot timed out for ${name}`);
  const buf = Buffer.from(shot.result.data, 'base64');
  const stats = pngStats(buf);
  if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
  if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
  writeFileSync(`${OUT}/burn-behaviour-${name}.png`, buf);
  console.log(`  ${name}: luma std=${stats.std} mean=${stats.mean}`);
  return { name, note, b64: shot.result.data, lumaStd: stats.std, lumaMean: stats.mean };
}

/** Record `frames` sim frames at DT, returning per-frame traces + player pos. */
async function record(frames) {
  return evaluate(`(() => {
    const g = window.__sdfGame;
    const out = [];
    for (let i = 0; i < ${frames}; i++) {
      g.step(1, ${DT});
      out.push({ actors: g.actorTrace(), player: g.playerPos() });
    }
    return out;
  })()`, 180000);
}

/** The player does not move, but turns to keep both subjects in frame (the
 *  flee/chase targets depend on the player POSITION, which setPose preserves). */
async function frameOn(ids) {
  await evaluate(`(() => {
    const g = window.__sdfGame;
    const p = g.playerPos();
    const tr = g.actorTrace().filter(a => ${JSON.stringify(ids)}.includes(a.id));
    if (!tr.length) return;
    let x = 0, z = 0;
    for (const a of tr) { x += a.pos[0]; z += a.pos[2]; }
    x /= tr.length; z /= tr.length;
    const yaw = Math.atan2(x - p[0], -(z - p[2]));
    g.setPose(p[0], p[2], yaw, 0);
  })()`);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Split a frame list into per-actor arrays and derive the trace numbers.
 *  Stumbles come from the actor's `stumbles` COUNTER (burnStumbles), not from
 *  pose `staggerKind`: the arm-flail shudder also shows up in staggerKind, so
 *  the counter is the only unambiguous stumble oracle. */
function analyse(raw, id) {
  const speeds = [], dists = [], shots = [], kinds = [];
  let stumbleMin = Infinity, stumbleMax = -Infinity;
  let holdMax = 0, targetNullFrames = 0;
  const mindStates = {};
  for (const f of raw) {
    const a = f.actors.find((x) => x.id === id);
    if (!a) continue;
    const p = f.player;
    const d = Math.hypot(a.pos[0] - p[0], a.pos[2] - p[2]);
    speeds.push(a.speed); dists.push(d); kinds.push(a.staggerKind);
    if (a.firing) shots.push(1);
    const s = a.stumbles ?? 0;
    stumbleMin = Math.min(stumbleMin, s);
    stumbleMax = Math.max(stumbleMax, s);
    holdMax = Math.max(holdMax, a.holdSecs ?? 0);
    if (!a.target) targetNullFrames++;
    mindStates[a.mindState ?? '?'] = (mindStates[a.mindState ?? '?'] ?? 0) + 1;
  }
  const n = speeds.length;
  const head = dists.slice(0, Math.max(1, Math.round(n * 0.15)));
  const tail = dists.slice(-Math.max(1, Math.round(n * 0.15)));
  return {
    frames: n,
    meanSpeed: +mean(speeds).toFixed(3),
    maxSpeed: +Math.max(0, ...speeds).toFixed(3),
    meanDistHead: +mean(head).toFixed(3),
    meanDistTail: +mean(tail).toFixed(3),
    distDelta: +(mean(tail) - mean(head)).toFixed(3),
    shots: shots.length,
    stumbles: Number.isFinite(stumbleMax) ? stumbleMax - stumbleMin : 0,
    staggerLurches: kinds.filter((k) => k === 'lurch').length,
    shudderFrames: kinds.filter((k) => k === 'shudder').length,
    holdMax: +holdMax.toFixed(4),
    targetNullFrames,
    mindStates,
  };
}

try {
  await bootGame('?crowd=1');
  report.checks.warmGate = 'ready';

  await evaluate('window.__sdfGame.setBloodBlur(false)');
  await evaluate('window.__sdfGame.teleport(4)');
  await evaluate('window.__sdfGame.step(20)');
  // Spawn the two subjects on either side of the player (room4 centre): far
  // enough to have closing/fleeing room, >6 m apart so they do not crowd, and
  // both inside the room's 4 m-half interior. Picking the SPAWNED ids (not the
  // nearest kind) avoids tracing a pre-existing body already at melee range.
  const spawned = await evaluate(`(() => {
    const g = window.__sdfGame;
    const p = g.playerPos();
    const out = [];
    out.push(g.spawnDebugCharacter('soldier', [p[0] + 3.2, 0, p[2] + 3.2]));
    out.push(g.spawnDebugCharacter('zombie', [p[0] - 3.2, 0, p[2] + 3.2]));
    return out;
  })()`);
  report.checks.spawned = spawned;
  await evaluate('window.__sdfGame.step(5)');

  const ids = [spawned[0].id, spawned[1].id];
  const wantKind = ['soldier', 'zombie'];
  await frameOn(ids);
  // ONE PLAYER SHOT makes every actor within 12 m "known": the encounter
  // director's gunshot memory marks them visible even when the spawn heading
  // faced away, which the burn flee/chase target needs. Fired straight down at
  // the floor so the flare cannot ignite a subject. Kept SHORT: every visible
  // frame before ignition spends the zombie's approach room.
  await evaluate("window.__sdfGame.selectSlot('flare')");
  await evaluate('window.__sdfGame.step(10)');
  await evaluate(`(() => { const g = window.__sdfGame; const p = g.playerPos(); g.setPose(p[0], p[2], 0, -1.4); })()`);
  await evaluate('window.__sdfGame.fireFlare()');
  await evaluate('window.__sdfGame.step(10)');

  let picked = null;
  for (let i = 0; i < 8 && !picked; i++) {
    const state = await evaluate(`(() => {
      const g = window.__sdfGame;
      const p = g.playerPos();
      const out = [];
      for (const id of ${JSON.stringify(ids)}) {
        const a = g.actorTrace().find(x => x.id === id);
        out.push(a ? { id: a.id, kind: a.kind, alerted: a.alerted,
          dist: +Math.hypot(a.pos[0] - p[0], a.pos[2] - p[2]).toFixed(2) } : null);
      }
      return out;
    })()`);
    if (state.every((s, k) => s && s.kind === wantKind[k] && s.alerted)) picked = state;
    else await evaluate('window.__sdfGame.step(10)');
  }
  report.checks.picked = picked;
  console.log('picked:', JSON.stringify(picked));
  if (!picked) fail('spawned soldier + zombie never both became alerted/visible');
  const soldierId = picked[0].id;
  const zombieId = picked[1].id;

  // ---- 1.5 s UNBURNT (short: the zombie must still have room to close) ----
  await frameOn(ids);
  const before = await record(45);
  const beforeShot = await capture('00-unburnt');

  // ---- IGNITE BOTH -------------------------------------------------------
  const litS = await evaluate(`window.__sdfGame.igniteActor(${soldierId})`);
  const litZ = await evaluate(`window.__sdfGame.igniteActor(${zombieId})`);
  console.log('igniteActor:', litS, litZ);
  if (!litS || !litZ) fail('igniteActor refused an id');

  // ---- 6 s BURNING, in three 2 s chunks so the sheet frames the motion ----
  const burn = [];
  const chunkFrames = [];
  for (let c = 0; c < 3; c++) {
    await frameOn(ids);
    const chunk = await record(60);
    burn.push(...chunk);
    const snap = await capture(`0${c + 1}-burning-${(c + 1) * 2}s`, `burn second ${c * 2}-${c * 2 + 2}`);
    chunkFrames.push(snap);
  }

  // ---- NUMBERS -----------------------------------------------------------
  const sBefore = analyse(before, soldierId);
  const sAfter = analyse(burn, soldierId);
  const zBefore = analyse(before, zombieId);
  const zAfter = analyse(burn, zombieId);
  report.checks.soldier = { before: sBefore, burning: sAfter };
  report.checks.zombie = { before: zBefore, burning: zAfter };
  console.log('soldier:', JSON.stringify(report.checks.soldier));
  console.log('zombie:', JSON.stringify(report.checks.zombie));

  // A zero unburnt baseline (a soldier standing/firing) makes a RATIO
  // meaningless, so report it as null and prove the panic with absolute speed
  // plus the distance trend. The 1.4x/1.25x multipliers themselves are pinned
  // by burn-behaviour.test.ts and the cruiseScale motion tests.
  const speedGain = (b, a) => (b.meanSpeed > 0.1 ? +(a.meanSpeed / b.meanSpeed).toFixed(2) : null);
  report.checks.speedGain = { soldier: speedGain(sBefore, sAfter), zombie: speedGain(zBefore, zAfter) };
  console.log('speed gain vs unburnt:', JSON.stringify(report.checks.speedGain));

  if (sAfter.shots !== 0) fail(`burning soldier fired ${sAfter.shots} frame(s)`);
  if (!(sAfter.distDelta > 0.5)) fail(`soldier did not flee the player (dist delta ${sAfter.distDelta} m)`);
  if (!(zAfter.distDelta < -0.3)) fail(`zombie did not close on the player (dist delta ${zAfter.distDelta} m)`);
  if (sAfter.stumbles < MIN_STUMBLES) fail(`soldier stumbled ${sAfter.stumbles} time(s), expected >= ${MIN_STUMBLES}`);
  if (zAfter.stumbles < MIN_STUMBLES) fail(`zombie stumbled ${zAfter.stumbles} time(s), expected >= ${MIN_STUMBLES}`);
  if (!(sAfter.meanSpeed > 1.0)) fail(`burning soldier mean speed ${sAfter.meanSpeed} m/s <= 1.0`);
  if (!(zAfter.meanSpeed > 0.4)) fail(`burning zombie mean speed ${zAfter.meanSpeed} m/s <= 0.4`);

  // ---- CONTACT SHEET -----------------------------------------------------
  const tiles = [beforeShot, ...chunkFrames].map((s, i) => ({ label: ['unburnt', 'burn 2s', 'burn 4s', 'burn 6s'][i], b64: s.b64 }));
  await evaluate('window.__sheet = []');
  for (const t of tiles) await evaluate(`window.__sheet.push(${JSON.stringify(t)})`);
  const dataUrl = await evaluate(`(async () => {
    const tiles = window.__sheet;
    const imgs = await Promise.all(tiles.map(t => new Promise((ok, err) => {
      const im = new Image(); im.onload = () => ok(im); im.onerror = () => err(new Error('decode'));
      im.src = 'data:image/png;base64,' + t.b64;
    })));
    const cw = imgs[0].naturalWidth, ch = imgs[0].naturalHeight, lh = 26;
    const cols = 2, rows = Math.ceil(imgs.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * cw; cv.height = rows * (ch + lh);
    const g = cv.getContext('2d');
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, cv.width, cv.height);
    tiles.forEach((t, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lh);
      g.drawImage(imgs[i], x, y + lh);
      g.fillStyle = '#e8e8e8'; g.font = 'bold 16px monospace'; g.textBaseline = 'top';
      g.fillText(t.label, x + 8, y + 5);
      g.strokeStyle = '#444'; g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch + lh - 1);
    });
    return cv.toDataURL('image/png');
  })()`, 30000);
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
    writeFileSync(`${OUT}/burn-behaviour-contact-sheet.png`, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
    console.log(`contact sheet: ${OUT}/burn-behaviour-contact-sheet.png`);
  } else {
    console.log('WARNING: contact sheet composition returned nothing');
  }

  // ---- GUARDS ------------------------------------------------------------
  const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
  if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);

  writeFileSync(`${OUT}/burn-behaviour-trace.json`, JSON.stringify(report, null, 2));
  console.log('\nDONE');
  shutdown(0);
} catch (err) {
  console.error('TRACE FAILED:', err?.message ?? err);
  report.failed = String(err?.message ?? err);
  try { writeFileSync(`${OUT}/burn-behaviour-trace.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  shutdown(1);
}
