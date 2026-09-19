// scripts/defer-compile-probe.mjs — BOOT-TIME + MID-GAME STALL PROBE
// (defer-compile task, 2026-09-19).
//
// WHAT IT MEASURES, per cold boot:
//   readyWallMs   wall clock from navigation to `__warmGate.phase === 'ready'`
//                 (the loader-hidden gate the plan targets at ~50 s cold);
//   warmMs        __warmDone.ms — the awaited warm's own steps;
//   bgAtReady     __sdfGame.warmBackground() right after ready (gib/crowd jobs);
//   bgSettled     the same once each background job settles
//                 (__warmDone.phases.backgroundDone);
//   frameBefore   the LONGEST rAF callback duration around a real dismemberment
//                 fired while the gib/chunk program is still compiling — it
//                 MUST stay < 100 ms (a synchronous march compile is ~48 s);
//   frameAfter    the same once the gib program is ready;
//   longFrames    pipelineLog().frames (>= 100 ms) for the whole session;
//   syncMarch     pipelineCensus() entries that are (a) NOT async and (b) a
//                 >=100 KB march-family fragment module, started after the warm
//                 (`warm-finally` boot mark) — the census proof that nothing
//                 compiled the march synchronously mid-game.
//
// A FRESH --user-data-dir IS NOT A COLD BOOT: the Metal shader cache is
// machine-global. Produce cold boots by transiently changing a march constant
// (see docs/dev-notes/2026-09-19-shader-compile/NOTES.md): edit
// `march/math.wgsl.ts` hash13 `0.1031` -> a unique value per run, run this
// probe, then REVERT and confirm `git diff -- src/lab/sdf-zombie/webgpu/march/`
// is empty. Never commit the edit.
//
// Usage:
//   node scripts/defer-compile-probe.mjs [--runs N] [--out path] [--label text]
//     [--gate-timeout ms] [--bg-timeout ms] [--no-detonate]

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const DEFAULTS = {
  vite: 5397,
  cdp: 9397,
  out: 'docs/dev-notes/2026-09-19-defer-compile/probe.json',
  query: 'pipelinelog=1&seed=20260919',
  gateTimeoutMs: 360000,
  bgTimeoutMs: 300000,
};
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LAB_TMP = resolve('.lab-tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const hasFlag = (name) => args.includes(name);
const RUNS = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const OUT = resolve(getOpt('--out', DEFAULTS.out));
const LABEL = getOpt('--label', '');
const GATE_TIMEOUT = Number(getOpt('--gate-timeout', DEFAULTS.gateTimeoutMs));
const BG_TIMEOUT = Number(getOpt('--bg-timeout', DEFAULTS.bgTimeoutMs));
const DETONATE = !hasFlag('--no-detonate');

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }
  process.exit(code);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });

mkdirSync(LAB_TMP, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

async function waitFor(url, what, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await sleep(300);
  }
  throw new Error(`${what} never came up at ${url}`);
}

/** Longest rAF callback duration, installed before any page script. */
const FRAME_PROBE = `(() => {
  const orig = window.requestAnimationFrame.bind(window);
  window.__frameProbe = { max: 0, count: 0 };
  window.requestAnimationFrame = function (cb) {
    return orig(function (t) {
      const s = performance.now();
      try { return cb(t); }
      finally {
        const d = performance.now() - s;
        window.__frameProbe.count++;
        if (d > window.__frameProbe.max) window.__frameProbe.max = d;
      }
    });
  };
})();`;

async function bootOnce(index) {
  const profile = mkdtempSync(join(LAB_TMP, `defer-probe-${index}-`));
  const port = DEFAULTS.cdp + index;
  const wallStart = new Date().toISOString();
  const result = {
    index, wallStart, label: LABEL,
    gate: { phase: null, timedOut: false }, warm: null, warmMs: null,
    bgAtReady: null, bgSettled: null,
    frameBefore: null, frameAfter: null, detonateBefore: null, detonateAfter: null,
    longFrames: [], syncMarchAfterWarm: [], bootMarks: null, censusCount: null,
    readyWallMs: null, error: null,
  };
  let chrome = null, ws = null;
  try {
    chrome = spawn(CHROME, [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--enable-unsafe-webgpu',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crash-reporter',
      `--crash-dumps-dir=${join(LAB_TMP, `defer-probe-crash-${index}`)}`,
      '--window-size=1380,820',
      'about:blank',
    ], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(chrome);
    await waitFor(`http://localhost:${port}/json/version`, `chrome debug port ${port}`);

    const tab = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(tab.webSocketDebuggerUrl);
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
      if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 300));
      return reply.result?.result?.value;
    };
    const evalJson = async (expression, timeoutMs = 60000) => {
      const s = await evaluate(expression, timeoutMs);
      return s == null ? null : JSON.parse(s);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FRAME_PROBE });
    const url = `http://localhost:${DEFAULTS.vite}/sdf-game.html?${DEFAULTS.query}`;
    const tNav = Date.now();
    await send('Page.navigate', { url });

    let booted = false;
    for (let i = 0; i < 240 && !booted; i++) {
      await sleep(500);
      booted = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
    }
    if (!booted) throw new Error('__sdfGame never booted within 120 s');

    let gate = null;
    const deadline = Date.now() + GATE_TIMEOUT;
    while (Date.now() < deadline && gate === null) {
      gate = await evaluate('window.__warmGate ?? null').catch(() => null);
      if (gate === null) await sleep(500);
    }
    result.readyWallMs = Date.now() - tNav;
    if (gate === null) {
      result.gate = { phase: null, timedOut: true, note: 'gate never settled' };
    } else {
      result.gate = { phase: gate.phase, timedOut: Boolean(gate.timedOut) };
      result.warm = await evalJson('window.__warmDone ? JSON.stringify(window.__warmDone) : null').catch(() => null);
      result.warmMs = result.warm?.ms ?? null;
      result.bgAtReady = await evalJson('window.__sdfGame.warmBackground ? JSON.stringify(window.__sdfGame.warmBackground()) : null').catch(() => null);
    }

    const snapshot = () => evalJson('window.__sdfGame.warmBackground ? JSON.stringify(window.__sdfGame.warmBackground()) : null').catch(() => null);

    if (DETONATE && gate?.phase === 'ready') {
      const actors = await evalJson('JSON.stringify(window.__sdfGame.actorList())').catch(() => null);
      const pick = (actors && actors.find((a) => a.pos)) || null;
      if (pick) {
        // (a) BEFORE the gib program is ready: fire immediately after ready.
        await evaluate('window.__frameProbe.max = 0; window.__frameProbe.count = 0; 1');
        // A DIRECT chunk (spawnTestChunk) guarantees a live chunk in the draw
        // list regardless of the blast's tear timing; detonate then exercises
        // the real dismemberment path on top of it.
        result.spawnBefore = await evalJson(
          `JSON.stringify(window.__sdfGame.spawnTestChunk(${pick.pos[0]}, ${pick.pos[1] + 0.6}, ${pick.pos[2]}))`,
        ).catch((e) => ({ error: String(e) }));
        result.detonateBefore = await evalJson(
          `JSON.stringify(window.__sdfGame.detonate(${pick.pos[0]}, ${pick.pos[1] + 0.6}, ${pick.pos[2]}))`,
        ).catch((e) => ({ error: String(e) }));
        await sleep(3000);
        result.frameBefore = await evalJson('JSON.stringify(window.__frameProbe)').catch(() => null);
        result.phaseBefore = await snapshot();

        // Wait for the gib job to settle, if this build defers it.
        const bgStart = result.warm?.phases?.backgroundStart;
        if (bgStart && bgStart.gib !== undefined) {
          const bgDeadline = Date.now() + BG_TIMEOUT;
          let state = await snapshot();
          while (Date.now() < bgDeadline && state && (state.gib === 'pending' || state.gib === 'compiling')) {
            await sleep(1000);
            state = await snapshot();
          }
          result.bgSettled = state;
        }

        // (b) AFTER: a second dismemberment on another body.
        const pick2 = (actors && actors[Math.min(5, actors.length - 1)]) || pick;
        await evaluate('window.__frameProbe.max = 0; window.__frameProbe.count = 0; 1');
        result.spawnAfter = await evalJson(
          `JSON.stringify(window.__sdfGame.spawnTestChunk(${pick2.pos[0]}, ${pick2.pos[1] + 0.6}, ${pick2.pos[2]}))`,
        ).catch((e) => ({ error: String(e) }));
        result.detonateAfter = await evalJson(
          `JSON.stringify(window.__sdfGame.detonate(${pick2.pos[0]}, ${pick2.pos[1] + 0.6}, ${pick2.pos[2]}))`,
        ).catch((e) => ({ error: String(e) }));
        await sleep(3000);
        result.frameAfter = await evalJson('JSON.stringify(window.__frameProbe)').catch(() => null);
        result.phaseAfter = await snapshot();
      }
    }

    result.bootMarks = await evalJson('JSON.stringify(window.__sdfGame.bootMarks())').catch(() => null);
    const log = await evalJson('JSON.stringify(window.__sdfGame.pipelineLog())', 60000).catch(() => null);
    result.longFrames = (log?.frames ?? []).map((f) => ({
      frame: f.frame, ms: f.ms, t0: f.t0,
      pipelines: (f.pipelines ?? []).map((p) => ({ name: p.name, async: p.async, fragmentShaderBytes: p.fragmentShaderBytes })),
    }));
    const warmFinally = (result.bootMarks ?? []).find((m) => m.n === 'warm-finally')?.t ?? null;
    result.warmFinallyT = warmFinally;
    const census = await evalJson('JSON.stringify(window.__sdfGame.pipelineCensus())', 120000).catch(() => null);
    result.censusCount = census?.count ?? null;
    if (census && warmFinally !== null) {
      result.syncMarchAfterWarm = census.entries
        .filter((e) => !e.async && e.fragmentShaderBytes >= 100000 && e.t > warmFinally)
        .map((e) => ({ t: e.t, endT: e.endT, ms: e.ms, name: e.name, fragmentShaderBytes: e.fragmentShaderBytes }));
    }
    return result;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    return result;
  } finally {
    try { ws?.close(); } catch { /* gone */ }
    if (chrome) {
      try { process.kill(-chrome.pid, 'SIGKILL'); } catch { try { chrome.kill('SIGKILL'); } catch { /* gone */ } }
      const i = children.indexOf(chrome); if (i >= 0) children.splice(i, 1);
    }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

console.log(`defer-compile probe: ${RUNS} run(s), out ${OUT}`);
const vite = spawn('npx', ['vite', '--port', String(DEFAULTS.vite), '--strictPort'], {
  cwd: resolve('.'), detached: true, stdio: ['ignore', 'ignore', 'ignore'],
});
children.push(vite);
await waitFor(`http://localhost:${DEFAULTS.vite}/sdf-game.html`, 'vite dev server', 60000);

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  process.stdout.write(`run ${i}/${RUNS} @ ${new Date().toISOString()} ... `);
  const r = await bootOnce(i);
  runs.push(r);
  const bg = r.bgSettled ?? r.bgAtReady;
  console.log(r.error
    ? `ERROR ${r.error}`
    : `phase=${r.gate.phase} readyWall=${r.readyWallMs}ms warmMs=${r.warmMs} bg=${JSON.stringify(bg)} `
      + `frameBefore=${r.frameBefore?.max ?? '-'} frameAfter=${r.frameAfter?.max ?? '-'} `
      + `longFrames=${r.longFrames.length} syncMarchAfterWarm=${r.syncMarchAfterWarm.length}`);
}

const payload = {
  task: 'defer-compile task 1',
  createdAt: new Date().toISOString(),
  host: process.env.HOSTNAME ?? '',
  label: LABEL,
  page: `/sdf-game.html?${DEFAULTS.query}`,
  runs,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`\nwrote ${OUT}`);
shutdown(0);
