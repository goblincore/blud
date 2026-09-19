// scripts/boot-time.mjs — the cold-boot timing gate for the march.wgsl.ts
// split (spec 2026-09-18, Task 1 Step 2).
//
// Starts its OWN vite + headless Chrome, each run with a FRESH Chrome profile
// (a warm profile caches compiled shaders and makes the cold number a lie),
// loads /sdf-game.html, waits for the warm gate to settle READY, and prints
// one JSON line with the two cold-boot numbers:
//
//   { drawOnce, warmMs }
//
//   drawOnce  __warmDone.phases.drawOnce — the first real march draw's
//             wall-clock ms. This is the number the split must hold.
//   warmMs    __warmDone.ms — the whole warm-up, reported alongside so a
//             shifted drawOnce can be told apart from a shifted compile phase.
//
// Shader text is byte-identical across the split, so drawOnce must stay within
// run-to-run noise of the base. Run it twice and record both lines.
//
// Usage: node scripts/boot-time.mjs [vitePort] [cdpPort] [query]
// Only what this script started is stopped.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const QUERY = process.argv[4] ?? 'seed=20260918';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LAB_TMP = resolve('.lab-tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); shutdown(1); };

mkdirSync(LAB_TMP, { recursive: true });
// Fresh profile EVERY run: the compile cache lives here, so a reused profile
// would report a warm boot as cold and make the gate meaningless.
const profile = mkdtempSync(join(LAB_TMP, 'boot-profile-'));

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  }
  // Give the children a beat, then make sure; remove the profile only after.
  setTimeout(() => {
    for (const c of children) {
      try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ }
    }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(code);
  }, 800);
}
process.on('exit', () => {
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }
});
setTimeout(() => fail('watchdog 8 min'), 8 * 60 * 1000);

// ---------------------------------------------------------------------------
// Own servers
// ---------------------------------------------------------------------------
async function waitFor(url, what, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  fail(`${what} never came up at ${url}`);
}

const viteLog = join(LAB_TMP, `boot-vite-${VITE}.log`);
const vite = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], {
  cwd: resolve('.'),
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
});
children.push(vite);
await waitFor(`http://localhost:${VITE}/sdf-game.html`, `vite dev server`);

const chromeLog = join(LAB_TMP, `boot-chrome-${CDP}.log`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  '--enable-unsafe-webgpu',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-crash-reporter',
  `--crash-dumps-dir=${join(LAB_TMP, `boot-crashpad-${CDP}`)}`,
  `--window-size=1380,820`,
  'about:blank',
], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, `chrome debug port`);

// ---------------------------------------------------------------------------
// Minimal CDP client (same shape as scripts/lib/sdf-closeup-stage.mjs)
// ---------------------------------------------------------------------------
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('cdp websocket failed')); });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 30000) => {
  const reply = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ __timeout: true })),
  ]);
  if (reply.__timeout) throw new Error(`Runtime.evaluate timed out: ${expression.slice(0, 80)}`);
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
  return reply.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

const url = `http://localhost:${VITE}/sdf-game.html?${QUERY.replace(/^\?/, '')}`;
await send('Page.navigate', { url });

// Boot is slow here (cold pipeline compile can run past a minute) — poll wide.
let booted = false;
for (let i = 0; i < 300 && !booted; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
}
if (!booted) fail('__sdfGame never booted');

let gate = null;
for (let i = 0; i < 480 && !gate; i++) {
  gate = await evaluate('window.__warmGate ?? null').catch(() => null);
  if (!gate) await sleep(500);
}
if (!gate) fail('warm gate never settled after 240 s');
if (gate.phase !== 'ready') fail(`warm gate phase '${gate.phase}', not ready`);

const warm = await evaluate('window.__warmDone ?? null');
if (!warm) fail('__warmDone missing after READY');
if (warm.error) fail(`warm-up recorded an error: ${warm.error}`);
const drawOnce = warm.phases?.drawOnce;
if (typeof drawOnce !== 'number') fail(`no phases.drawOnce in __warmDone: ${JSON.stringify(warm.phases)}`);

console.log(JSON.stringify({ drawOnce: Math.round(drawOnce * 100) / 100, warmMs: warm.ms }));
shutdown(0);
