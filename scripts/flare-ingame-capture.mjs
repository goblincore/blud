// scripts/flare-ingame-capture.mjs
//
// IN-GAME FLARE CAPTURE (2026-09-18 flare test harness). The flame lab could
// show the burning look; this proves it in the REAL game: the shipped
// renderer, the shipped lighting, the crowd path, real actors.
//
// What it establishes, in order:
//   0. COLD      the page boots with NO burn state, NO cards and NO burn
//                uniforms — the no-op contract, read from the seams.
//   1. ONE       slot 3 + fireFlare() ignites exactly the actor the eye ray
//                names (the fire = ignite-what-you-hit verb).
//   2. CROWD     igniteAll() sets every live actor alight; a couple of seconds
//                of frames later the fire is on screen.
//   3. OUT       extinguishAll() puts it out; the char stays.
//   4. COST      a rough wall-clock ms/frame with 0, 1 and many burning
//                bodies, measured on a FROZEN sim (step dt 0) so only the
//                render-side fire changes.
//
// The renderer-pipeline-error guard is flame-capture.mjs's: a failed pipeline
// draws nothing and logs via console.error, so a run that reported one FAILS
// rather than banking a black frame. Every shot is also decoded and refused if
// its luma is flat.
//
// Own vite + headless Chrome on an UNUSED port pair, own profile under
// .lab-tmp. Only what this script started is stopped.
//
// Usage: node scripts/flare-ingame-capture.mjs [vitePort] [cdpPort] [outDir]

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5486);
const CDP = Number(process.argv[3] ?? 9486);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-09-18-flare-ingame-test');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_LUMA_STD = 5;

const report = {
  branch: (() => { try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
  shots: {}, checks: {}, consoleErrors: [],
};
const consoleErrors = [];

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  try { writeFileSync(`${OUT}/flare-ingame-report.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });
setTimeout(() => { console.error('WATCHDOG: capture exceeded 12 minutes'); shutdown(9); }, 12 * 60 * 1000);
const fail = (msg) => { throw new Error(msg); };

// ---------------------------------------------------------------------------
// PNG decode + luma stats (flame-capture.mjs's flat-frame gate).
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

console.log(`starting headless chrome (WebGPU defaults, no unsafe flags) on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${LAB_TMP}/chrome-flare-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-flare-${CDP}`,
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
    consoleErrors.push(text);
    report.consoleErrors.push(text.slice(0, 300));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const text = JSON.stringify(m.params.exceptionDetails).slice(0, 300);
    consoleErrors.push(text);
    report.consoleErrors.push(text);
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
  // Wait for the warm gate's REAL outcome. A hidden loader is not success: the
  // gate also hides it (after 2.5 s) on 'warm-failed' and 'device-lost', so
  // keying on visibility captured failed boots as if they had worked — and a
  // gate that never settled used to fall through silently after 90 s.
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
  // Let the flare placeholder GLB settle (or prove absent and log once).
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
  writeFileSync(`${OUT}/${name}.png`, buf);
  const diag = await evaluate('window.__sdfGame.burning()').catch(() => null);
  const cards = await evaluate('window.__sdfGame.flameCards()').catch(() => null);
  report.shots[name] = { note, lumaStd: stats.std, burning: diag, cards };
  console.log(`  ${name}: luma std=${stats.std} burning=${diag ? diag.length : '?'} cards=${cards ? JSON.stringify(cards) : '?'}`);
  return report.shots[name];
}

/** Face a body framed at `prefer` metres (not point-blank, where one body's
 *  cards fill the frame). Returns the candidate it faced. */
const aimJs = (prefer) => `(() => {
  const g = window.__sdfGame;
  const eye = g.cameraWorld();
  const p = g.playerPos();
  const cands = [];
  for (const a of g.actorList()) {
    const z = g.zombie(a.id);
    if (!z) continue;
    const clusters = z.posed().clusters || [];
    const torso = clusters.find(c => (c.limb === 'torso') && c.center)
      || clusters.find(c => c.center);
    if (!torso || !torso.center) continue;
    const c = torso.center;
    const d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
    if (d >= 1.5 && d <= 14) cands.push({ id: a.id, c, d });
  }
  if (!cands.length) return null;
  cands.sort((x, y) => Math.abs(x.d - ${prefer}) - Math.abs(y.d - ${prefer}));
  const cand = cands[0];
  const yaw = Math.atan2(cand.c[0] - eye[0], -(cand.c[2] - eye[2]));
  const pitch = Math.atan2(cand.c[1] - eye[1],
    Math.hypot(cand.c[0] - eye[0], cand.c[2] - eye[2]));
  g.setPose(p[0], p[2], yaw, pitch, 0);
  return { id: cand.id, dist: +cand.d.toFixed(2), yaw, pitch };
})()`;

async function igniteOne() {
  await evaluate("window.__sdfGame.selectSlot('flare')");
  await evaluate('window.__sdfGame.step(30)');        // let the switch finish
  for (let attempt = 0; attempt < 6; attempt++) {
    const aim = await evaluate(aimJs(4));
    if (!aim) return null;
    await evaluate('window.__sdfGame.step(6)');
    const fired = await evaluate('window.__sdfGame.fireFlare()');
    await evaluate('window.__sdfGame.step(6)');
    const states = await evaluate('window.__sdfGame.burning()');
    const lit = states.filter((s) => s.burn > 0 || s.alight || s.dying);
    if (fired && lit.length > 0) return { aim, lit };
    await evaluate('window.__sdfGame.step(24)');      // cooldown, then retry
  }
  return null;
}

async function benchFrames(label, frames = 90) {
  const ms = await evaluate(`(async () => {
    const g = window.__sdfGame;
    const t0 = performance.now();
    for (let i = 0; i < ${frames}; i++) g.step(1, 0);
    await g.resolveGpu();
    return performance.now() - t0;
  })()`, 120000);
  const out = { frames, totalMs: +Number(ms).toFixed(1), msPerFrame: +(Number(ms) / frames).toFixed(3) };
  console.log(`  cost ${label}: ${out.msPerFrame} ms/frame`);
  return out;
}

try {
  // =======================================================================
  // BOOT + THE NO-OP CONTRACT
  // =======================================================================
  await bootGame('?crowd=1');
  const coldCards = await evaluate('window.__sdfGame.flameCards()');
  const coldBurning = await evaluate('window.__sdfGame.burning()');
  console.log('cold:', JSON.stringify(coldCards), 'burning:', JSON.stringify(coldBurning));
  if (coldCards.created) fail('flame cards were created without an ignite');
  if (coldBurning.length !== 0) fail('burn state existed without an ignite');
  report.checks.cold = { cards: coldCards, burning: coldBurning };

  await evaluate('window.__sdfGame.setBloodBlur(false)');   // keep the frame legible
  await evaluate('window.__sdfGame.teleport(4)');
  await evaluate('window.__sdfGame.step(20)');
  // Two debug bodies near the player, one of each kind, so both the zombie and
  // the soldier are on screen when igniteAll runs.
  const spawned = await evaluate(`(() => {
    const g = window.__sdfGame;
    const p = g.playerPos();
    const out = [];
    out.push(g.spawnDebugCharacter('soldier', [p[0] + 2.4, 0, p[2] + 0.4]));
    out.push(g.spawnDebugCharacter('zombie', [p[0] + 3.0, 0, p[2] - 0.8]));
    out.push(g.spawnDebugCharacter('zombie', [p[0] + 3.6, 0, p[2] + 1.0]));
    return out;
  })()`);
  report.checks.spawned = spawned;
  await evaluate('window.__sdfGame.step(20)');
  await capture('flare-00-cold', 'boot + spawned bodies, nothing burning');

  // =======================================================================
  // 1. ONE BURNING: slot 3's ignite-what-you-hit verb
  // =======================================================================
  console.log('\n=== one burning (slot 3 verb) ===');
  const one = await igniteOne();
  report.checks.one = one;
  console.log('igniteOne:', JSON.stringify(one));
  if (!one) fail('fireFlare() never ignited an actor');
  await evaluate('window.__sdfGame.step(60)');   // ~1 s of fire
  await capture('flare-10-one-burning', 'one actor ignited by fireFlare()');

  // =======================================================================
  // 2. CROWD BURNING: igniteAll
  // =======================================================================
  console.log('\n=== crowd burning (igniteAll) ===');
  const allCount = await evaluate('window.__sdfGame.igniteAll()');
  report.checks.igniteAll = allCount;
  console.log('igniteAll tracked:', allCount);
  await evaluate('window.__sdfGame.step(90)');   // ~1.5 s
  // Re-frame on a body ~7 m out, so the crowd reads as several burning bodies
  // rather than one close one's cards filling the frame.
  const crowdAim = await evaluate(aimJs(7));
  await evaluate('window.__sdfGame.step(20)');
  const crowdDiag = await evaluate('window.__sdfGame.burning()');
  report.checks.crowd = { aim: crowdAim, tracked: crowdDiag.length, active: crowdDiag.filter((s) => s.burn > 0 || s.dying).length };
  console.log('crowd burning:', JSON.stringify(report.checks.crowd));
  if (report.checks.crowd.active < 2) fail('igniteAll did not leave multiple bodies burning');
  await capture('flare-20-crowd-burning', 'igniteAll(): a room on fire');

  // =======================================================================
  // 3. EXTINGUISH: char stays, fire goes
  // =======================================================================
  console.log('\n=== extinguishAll ===');
  await evaluate('window.__sdfGame.extinguishAll()');
  await evaluate('window.__sdfGame.step(90)');
  const outDiag = await evaluate('window.__sdfGame.burning()');
  const stillActive = outDiag.filter((s) => s.burn > 0 || s.dying).length;
  report.checks.extinguished = { tracked: outDiag.length, active: stillActive, maxChar: Math.max(0, ...outDiag.map((s) => s.char)) };
  console.log('extinguished:', JSON.stringify(report.checks.extinguished));
  if (stillActive !== 0) fail(`extinguishAll left ${stillActive} bodies alight`);
  await capture('flare-30-extinguished', 'extinguishAll(): fire out, char remains');

  // =======================================================================
  // 4. ROUGH FRAME COST: ONE fixed camera, sim frozen, 0 vs 1 vs many burning.
  //    The pose is set once (a ~4 m body in frame) and never moved between the
  //    three benches, so the only thing that changes is the fire.
  // =======================================================================
  console.log('\n=== frame cost (frozen sim, render-side fire only) ===');
  await evaluate('window.__sdfGame.extinguishAll()');
  await evaluate('window.__sdfGame.step(60)');
  await evaluate("window.__sdfGame.selectSlot('flare')");
  await evaluate('window.__sdfGame.step(30)');
  const costAim = await evaluate(aimJs(4));
  await evaluate('window.__sdfGame.step(10)');
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  const costCold = await benchFrames('cold');
  // Exactly one: the body the camera is framed on.
  const firedOne = await evaluate('window.__sdfGame.fireFlare()');
  await evaluate('window.__sdfGame.step(30)');   // ramp (dt > 0 advances burn)
  const costOne = await benchFrames('one-burning');
  const oneState = await evaluate('window.__sdfGame.burning()');
  // Many: everything the game knows about.
  await evaluate('window.__sdfGame.igniteAll()');
  await evaluate('window.__sdfGame.step(30)');
  const costAll = await benchFrames('all-burning');
  const allState = await evaluate('window.__sdfGame.burning()');
  // COST BREAKDOWN with everything alight: switch the fire's parts off one at a
  // time, cumulatively, so each delta is that part's share. Restored after.
  const breakdown = {};
  const hasVolume = await evaluate('typeof window.__sdfGame.setVolume === "function"');
  if (hasVolume) {
    const vol0 = await evaluate('window.__sdfGame.volume()');
    const burn0 = await evaluate('window.__sdfGame.burnTuning()');
    const tongue0 = await evaluate('window.__sdfGame.tongue()');
    await evaluate('window.__sdfGame.setVolume({ steps: 0 })');
    breakdown.volumeMarchOff = await benchFrames('all, volume march off (steps 0)');
    await evaluate('window.__sdfGame.setTechnique("cards"); window.__sdfGame.setVolume({ cardsPerBody: 0 })');
    await evaluate('window.__sdfGame.setTongueTuning({ gain: 0 })');
    breakdown.volumeAndCardsOff = await benchFrames('all, + volume pass unbound, cards 0 gain');
    await evaluate('window.__sdfGame.setBurnTuning({ fireGain: 0, fireCoverage: 0 })');
    breakdown.surfaceFireOff = await benchFrames('all, + surface fire off');
    await evaluate('window.__sdfGame.setBurnTuning({ lightPeak: 0, lightGatherPeak: 0, lightMeshPeak: 0 })');
    breakdown.lightsOff = await benchFrames('all, + fire lights off');
    await evaluate(`window.__sdfGame.setTechnique("volume"); window.__sdfGame.setVolume(${JSON.stringify(vol0)}); window.__sdfGame.setBurnTuning(${JSON.stringify(burn0)}); window.__sdfGame.setTongueTuning(${JSON.stringify(tongue0)})`);
  }
  report.checks.cost = {
    pose: costAim, firedOne,
    activeOne: oneState.filter((s) => s.burn > 0 || s.dying).length,
    activeAll: allState.filter((s) => s.burn > 0 || s.dying).length,
    cold: costCold, one: costOne, all: costAll, breakdown,
  };
  console.log('cost:', JSON.stringify(report.checks.cost));

  // =======================================================================
  // GUARDS
  // =======================================================================
  const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
  if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);
  const realExceptions = consoleErrors.filter((t) => !/NotFoundError|setPointerCapture/.test(t) && /Error|error/.test(t));
  if (realExceptions.length > 0) console.warn('non-fatal console errors:', realExceptions.slice(0, 3));

  writeFileSync(`${OUT}/captures.json`, JSON.stringify(report, null, 2));
  console.log('\nDONE');
  shutdown(0);
} catch (err) {
  console.error('CAPTURE FAILED:', err?.message ?? err);
  report.failed = String(err?.message ?? err);
  try { writeFileSync(`${OUT}/flare-ingame-report.json`, JSON.stringify(report, null, 2)); } catch { /* best effort */ }
  shutdown(1);
}
