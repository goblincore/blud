// scripts/earlyz-smoke.mjs — early-Z stage 1 boot smoke (plan 2026-10-01 Task 11). NOT a perf gate.
// Usage: scripts/earlyz-run.sh smoke [--on | --off]
//
// Two boots on one tab, the pack scene staged in each:
//   on   ?frozen=1&earlyz=1  the six plan checks (flag, patch + detection, patch hits, seed, front
//                            batch, no uncaptured GPU errors).
//   off  ?frozen=1           the shipped boot: flag false, nothing patched, no seed, no front batch.
// `--on` / `--off` runs one phase only. Exit 0 only when every check of every phase run passes.
//
// CONSOLE. connectGame's websocket only answers its own requests, so a second CDP client on the
// same target collects Runtime.consoleAPICalled / Runtime.exceptionThrown / Log.entryAdded. The
// full log of each phase is written to $LAB_TMP/earlyz-smoke-<phase>.console.log; the `[earlyz]`
// lines and every warning/error are echoed here, so a failing check arrives with its evidence.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectGame, bootCloseupPage, applyShipDefaults, sleep } from './lib/sdf-closeup-stage.mjs';
import { STAGES } from './lib/earlyz-scenes.mjs';

const [, , VITE, CDP, ...ARGS] = process.argv;
const PHASES = ARGS.includes('--on') ? ['on'] : ARGS.includes('--off') ? ['off'] : ['on', 'off'];
const TMP = process.env.LAB_TMP ?? '/tmp';
mkdirSync(TMP, { recursive: true });

const { tab, send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });

// ---- console collector (second CDP client on the same target) ---------------------------------
let phase = 'connect';
const logs = { connect: [] };
const push = (level, text) => { (logs[phase] ??= []).push({ t: Date.now(), level, text }); };
const cws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { cws.onopen = ok; cws.onerror = err; });
const argText = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value))
  : a.description ?? a.unserializableValue ?? a.type);
cws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') push(m.params.type, (m.params.args ?? []).map(argText).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    push('exception', d.exception?.description ?? d.text);
  } else if (m.method === 'Log.entryAdded') push(`log:${m.params.entry.level}`, `${m.params.entry.source}: ${m.params.entry.text}`);
};
let cseq = 0;
const csend = (method) => cws.send(JSON.stringify({ id: ++cseq, method }));
csend('Runtime.enable');
csend('Log.enable');

const isLoud = (l) => /earlyz/i.test(l.text) || /warn|error|exception/.test(l.level);
function dumpConsole(p) {
  const lines = logs[p] ?? [];
  const file = join(TMP, `earlyz-smoke-${p}.console.log`);
  writeFileSync(file, lines.map((l) => `${l.level}\t${l.text}`).join('\n') + '\n');
  // Repeats fold into one row with a count (three prints some warnings once per material).
  const loud = new Map();
  for (const l of lines.filter(isLoud)) {
    const k = `${l.level}\t${l.text.slice(0, 600)}`;
    loud.set(k, (loud.get(k) ?? 0) + 1);
  }
  console.log(`console[${p}] ${lines.length} lines -> ${file}; ${loud.size} distinct earlyz/warn/error:`);
  for (const [k, n] of [...loud].slice(0, 60)) console.log(`  ${n > 1 ? `x${n} ` : ''}${k}`);
  if (loud.size > 60) console.log(`  ... ${loud.size - 60} more in ${file}`);
}

/** Inside the run every failure THROWS (bootCloseupPage calls its `fail` synchronously and expects
 *  it not to return); the top level catches it and prints the evidence before exiting. */
const die = (msg) => { throw new Error(msg); };

/** Print whatever evidence the page still answers, then exit 1. */
async function fail(msg) {
  console.error(`FAIL: ${msg}`);
  try {
    const ev = await evaluate(`JSON.stringify({
      earlyz: __sdfGame.earlyzInfo?.() ?? null,
      gate: window.__warmGate ?? null, bg: __sdfGame.warmBackground?.() ?? null,
    })`, 10_000);
    console.error('page state', ev);
  } catch (e) { console.error('page state unavailable:', String(e)); }
  dumpConsole(phase);
  process.exit(1);
}

/** Boot a fresh page, wait for the loader gate AND the background crowd job; returns timings. */
async function bootAndWarm(query) {
  const t0 = Date.now();
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?${query}`, fail: die });
  for (let i = 0; ; i++) {
    const s = JSON.parse(await evaluate(`JSON.stringify({ gate: window.__warmGate?.phase ?? null, bg: __sdfGame.warmBackground?.() ?? null })`));
    if (s.gate === 'ready' && s.bg?.crowd === 'ready') break;
    if (s.bg?.crowd === 'failed') die(`crowd warm job failed under ?${query}`);
    if (i > 1440) die(`not ready after 12 min: ${JSON.stringify(s)}`); // first boot pays the cold march compile
    await sleep(500);
  }
  const readyMs = Date.now() - t0;
  const warm = JSON.parse(await evaluate(`JSON.stringify((() => {
    const w = __sdfGame.warmDone();
    return w ? { ms: w.ms, bootBeforeWarmMs: w.bootBeforeWarmMs, drawOnce: Math.round(w.phases?.drawOnce ?? -1),
      precompile: Math.round(w.phases?.precompile ?? -1), backgroundDone: w.phases?.backgroundDone ?? null, error: w.error ?? null } : null;
  })())`));
  return { readyMs, warm };
}

/** Stage the pack (6 bodies 0.7 m apart, ~3 m ahead) and settle a few frames. */
async function stagePack() {
  await applyShipDefaults(evaluate);
  const staged = await STAGES.pack.stage(evaluate);
  console.log('staged', JSON.stringify(staged));
  if (staged.spawned !== 6) die(`pack staged ${staged.spawned} bodies, wanted 6`);
  await evaluate('(() => { __sdfGame.step(6); return 1; })()');
  await sleep(300);
}

async function readState() {
  const info = JSON.parse(await evaluate('JSON.stringify(__sdfGame.earlyzInfo())'));
  const crowd = JSON.parse(await evaluate(`JSON.stringify((() => {
    const c = __sdfGame.crowdInfo();
    return { on: c.on, dispatch: c.dispatch, tilesOn: c.tilesOn, fallbackReason: c.fallbackReason,
      types: c.types.filter(t => t.attached > 0 || t.visible > 0).map(t => ({ name: t.name, attached: t.attached,
        visible: t.visible, meanDistance: +t.meanDistance.toFixed(2), dispatch: t.dispatch })),
      pose: __sdfGame.pose() };
  })())`));
  return { info, crowd };
}

function report(name, checks) {
  let bad = 0;
  for (const [n, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  [${name}] ${n}`); if (!ok) bad++; }
  return bad;
}

/** One boot + the pack + its checks; returns the failed-check count. */
async function runPhase(p) {
  phase = p;
  logs[p] = [];
  console.log(`--- phase ${p} ---`);
  const boot = await bootAndWarm(p === 'on' ? 'frozen=1&earlyz=1' : 'frozen=1');
  console.log('boot', JSON.stringify(boot));
  await stagePack();
  const { info, crowd } = await readState();
  console.log('earlyzInfo', JSON.stringify(info));
  console.log('crowdInfo', JSON.stringify(crowd));
  const fronts = Object.values(info.batches).map((b) => b.front);
  const checks = p === 'on' ? [
    ['flag on', info.flag === true],
    ['patched + detected', info.on === true],
    ['patch emitted frag_depth greater', info.patchHits > 0],
    ['seed drew', info.seed.on === true],
    ['a front batch drew', fronts.some((f) => f > 0)],
    ['no uncaptured GPU errors', info.gpuErrors.length === 0],
  ] : [
    ['flag off', info.flag === false],
    ['earlyz not on', info.on === false],
    ['no front batch (every type front === 0)', fronts.length > 0 && fronts.every((f) => f === 0)],
    ['no seed built', info.seed.built === false && info.seed.on === false],
    ['patch never emitted', info.patchHits === 0],
  ];
  const bad = report(p, checks);
  dumpConsole(p);
  return bad;
}

let bad = 0;
try {
  for (const p of PHASES) bad += await runPhase(p);
} catch (e) {
  await fail(e?.message ?? String(e));
}
cws.close();
process.exit(bad ? 1 : 0);
