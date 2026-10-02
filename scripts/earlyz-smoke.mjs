// scripts/earlyz-smoke.mjs — early-Z stage 1 boot smoke (plan 2026-10-01 Task 11). NOT a perf gate.
// Usage: scripts/earlyz-run.sh smoke [--on | --off]
//
// Two boots on one tab, the pack scene staged in each:
//   off  ?frozen=1           the shipped boot, FIRST: flag false, nothing patched, no seed, no front
//                            batch, the pack visible (positive control), and the GPU baseline
//                            (device not lost, uncaptured-error count) the flag-on boot is held to.
//   on   ?frozen=1&earlyz=1  the plan checks (flag, patch + detection, patch hits, seed, the pack in
//                            the front batch, no uncaptured GPU errors), the same GPU baseline, then
//                            the melee scene: the near body's type must draw a back batch (the
//                            camera-inside fallback) with no new GPU errors.
// `--on` / `--off` runs one phase only (`--on` alone holds the uncaptured count to 0). Exit 0 only
// when every check of every phase run passes.
//
// CONSOLE. connectGame's websocket only answers its own requests, so a second CDP client on the
// same target collects Runtime.consoleAPICalled / Runtime.exceptionThrown / Log.entryAdded. The
// full log of each phase is written to $LAB_TMP/earlyz-smoke-<phase>.console.log; the `[earlyz]`
// lines and every warning/error are echoed here, so a failing check arrives with its evidence.
//
// BOUNDED. A watchdog ends the run after WATCHDOG_MIN whatever is hanging (the first boot after a
// shader change pays a cold compile, so each boot alone may take up to 12 minutes), and fail()
// gives the page 10 s to answer its diagnostic read before the console dump runs anyway.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectGame, bootCloseupPage, applyShipDefaults, sleep } from './lib/sdf-closeup-stage.mjs';
import { STAGES } from './lib/earlyz-scenes.mjs';

const USAGE = 'usage: scripts/earlyz-run.sh smoke [--on | --off]';
const [, , VITE, CDP, ...ARGS] = process.argv;
const unknown = ARGS.filter((a) => a !== '--on' && a !== '--off');
if (unknown.length || ARGS.length > 1) {
  console.error(`earlyz-smoke: bad arguments ${JSON.stringify(ARGS)}\n${USAGE}`);
  process.exit(2);
}
const PHASES = ARGS[0] === '--on' ? ['on'] : ARGS[0] === '--off' ? ['off'] : ['off', 'on'];
const TMP = process.env.LAB_TMP ?? '/tmp';
mkdirSync(TMP, { recursive: true });
/** The pack's crowd type. spawnDebugCharacter files a body under the PLAYER's room, and crowdTypeFor
 *  keys types `${name}@${roomId}`: the pack is spawned with the player in room 1, so it is `zombie@1`
 *  (the ring's room 1 has no zombie of its own, so this type holds exactly the pack). */
const PACK_TYPE = 'zombie@1';
const WATCHDOG_MIN = 35;

// ---- console collector state (the watchdog dumps it, so it exists before anything can hang) ----
let phase = 'connect';
const logs = { connect: [] };
const push = (level, text) => { (logs[phase] ??= []).push({ t: Date.now(), level, text }); };
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
const exceptionsIn = (p) => (logs[p] ?? []).filter((l) => l.level === 'exception');

// Ref'd on purpose: it must fire even if every other handle is gone. Every exit path calls
// process.exit, so it never holds a finished run open.
setTimeout(() => {
  console.error(`FAIL: watchdog ${WATCHDOG_MIN} min (phase ${phase})`);
  try { dumpConsole(phase); } catch (e) { console.error('console dump failed:', String(e)); }
  process.exit(1);
}, WATCHDOG_MIN * 60_000);

const { tab, send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });

// ---- console collector (second CDP client on the same target) ---------------------------------
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

/** Inside the run every failure THROWS (bootCloseupPage calls its `fail` synchronously and expects
 *  it not to return); the top level catches it and prints the evidence before exiting. */
const die = (msg) => { throw new Error(msg); };

/** Print whatever evidence the page still answers (10 s at most), then exit 1. */
async function fail(msg) {
  console.error(`FAIL: ${msg}`);
  const read = evaluate(`JSON.stringify({
    earlyz: window.__sdfGame?.earlyzInfo?.() ?? null,
    gpu: window.__sdfGame?.gpuDiagnostics?.() ?? null,
    gate: window.__warmGate ?? null, bg: window.__sdfGame?.warmBackground?.() ?? null,
  })`, 10_000).catch((e) => `unavailable: ${String(e)}`);
  const timeout = new Promise((ok) => setTimeout(() => ok('unavailable: no answer in 10 s'), 10_000));
  console.error('page state', await Promise.race([read, timeout]));
  dumpConsole(phase);
  process.exit(1);
}

/** Boot a fresh page, wait for the loader gate AND the background crowd job; returns timings. */
async function bootAndWarm(query) {
  const t0 = Date.now();
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?${query}`, fail: die });
  for (let i = 0; ; i++) {
    const s = JSON.parse(await evaluate(`JSON.stringify({ gate: window.__warmGate?.phase ?? null, bg: __sdfGame.warmBackground?.() ?? null })`));
    // __warmGate is written once, when the gate settles: anything but 'ready' is final.
    if (s.gate !== null && s.gate !== 'ready') die(`loader gate settled '${s.gate}', not 'ready', under ?${query}`);
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

const settle = async () => { await evaluate('(() => { __sdfGame.step(6); return 1; })()'); await sleep(300); };

/** Stage the pack (6 bodies 0.7 m apart, ~3.5 m ahead) and settle a few frames. The prelude
 *  itself throws unless all 6 landed. */
async function stagePack() {
  await applyShipDefaults(evaluate);
  const staged = await STAGES.pack.stage(evaluate, die);
  console.log('staged', JSON.stringify(staged));
  await settle();
  return staged;
}

const readEarlyz = async () => JSON.parse(await evaluate('JSON.stringify(__sdfGame.earlyzInfo())'));
const readGpu = async () => JSON.parse(await evaluate('JSON.stringify(__sdfGame.gpuDiagnostics())'));

/** Crowd census for the report and the visibility checks. A failed read is recorded, not thrown:
 *  the checks that need it then fail by name instead of the run aborting before the rest report. */
async function readCrowd() {
  try {
    return JSON.parse(await evaluate(`JSON.stringify((() => {
      const c = __sdfGame.crowdInfo();
      return { on: c.on, dispatch: c.dispatch, tilesOn: c.tilesOn, fallbackReason: c.fallbackReason,
        types: c.types.filter(t => t.attached > 0 || t.visible > 0).map(t => ({ name: t.name, attached: t.attached,
          visible: t.visible, meanDistance: +t.meanDistance.toFixed(2), dispatch: t.dispatch })),
        pose: __sdfGame.pose() };
    })())`));
  } catch (e) {
    return { error: String(e), types: [] };
  }
}
const visibleOf = (crowd, key) => crowd.types.find((t) => t.name === key)?.visible ?? 0;

/** Melee scene on the current page: returns the near body, its crowd type and the batches. */
async function stageMelee() {
  const staged = await STAGES.melee.stage(evaluate, die);
  console.log('melee staged', JSON.stringify(staged));
  await settle();
  const near = JSON.parse(await evaluate(`JSON.stringify((() => {
    const id = ${JSON.stringify(staged.body)};
    const hit = Object.entries(__sdfGame.crowdSlotDump()).find(([, rows]) => rows.some(r => r.actor === id));
    const z = __sdfGame.zombies().find(q => q.id === id);
    return { body: id, type: hit ? hit[0] : null, bodyPos: z ? z.pos : null, pose: __sdfGame.pose() };
  })())`));
  const info = await readEarlyz();
  const gpu = await readGpu();
  return { staged, near, info, gpu };
}

function report(name, checks) {
  let bad = 0;
  for (const [n, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  [${name}] ${n}`); if (!ok) bad++; }
  return bad;
}

/** Flag-off uncaptured-error count, the bar the flag-on boot is held to (0 when off did not run). */
let gpuBaseline = null;

/** One boot + the pack (+ melee when on) + its checks; returns the failed-check count. */
async function runPhase(p) {
  phase = p;
  logs[p] = [];
  console.log(`--- phase ${p} ---`);
  const boot = await bootAndWarm(p === 'on' ? 'frozen=1&earlyz=1' : 'frozen=1');
  console.log('boot', JSON.stringify(boot));
  const staged = await stagePack();
  const info = await readEarlyz();
  const gpu = await readGpu();
  const crowd = await readCrowd();
  console.log('earlyzInfo', JSON.stringify(info));
  console.log('gpuDiagnostics', JSON.stringify(gpu));
  console.log('crowdInfo', JSON.stringify(crowd));
  const fronts = Object.values(info.batches).map((b) => b.front);
  const pack = info.batches[PACK_TYPE] ?? { front: -1, back: -1 };
  const packVisible = [`the pack is visible (${PACK_TYPE} visible >= ${staged.spawned})`,
    !crowd.error && visibleOf(crowd, PACK_TYPE) >= staged.spawned];
  let checks;
  if (p === 'off') {
    gpuBaseline = gpu.uncapturedCount;
    console.log(`gpu baseline: ${gpuBaseline} uncaptured GPU errors with the flag off`);
    checks = [
      ['flag off', info.flag === false],
      ['earlyz not on', info.on === false],
      packVisible,
      ['no front batch (every type front === 0)', fronts.length > 0 && fronts.every((f) => f === 0)],
      ['no seed built', info.seed.built === false && info.seed.on === false],
      ['patch never emitted', info.patchHits === 0],
      ['GPU device not lost', gpu.lost === null],
    ];
  } else {
    const bar = gpuBaseline ?? 0;
    const melee = await stageMelee();
    const nearB = melee.near.type ? melee.info.batches[melee.near.type] : null;
    console.log('melee near', JSON.stringify({ ...melee.near, batches: nearB }));
    console.log('melee earlyzInfo', JSON.stringify(melee.info));
    console.log('melee gpuDiagnostics', JSON.stringify(melee.gpu));
    checks = [
      ['flag on', info.flag === true],
      ['patched + detected', info.on === true],
      ['patch emitted frag_depth greater', info.patchHits > 0],
      ['seed drew', info.seed.on === true],
      [`the pack drew as front batches (${PACK_TYPE} front === ${staged.spawned}, back === 0)`,
        pack.front === staged.spawned && pack.back === 0],
      packVisible,
      ['no uncaptured GPU errors (earlyz listener)', info.gpuErrors.length === 0],
      ['GPU device not lost', gpu.lost === null],
      [`uncaptured GPU error count ${gpu.uncapturedCount} <= flag-off baseline ${bar}${gpuBaseline === null ? ' (off did not run)' : ''}`,
        gpu.uncapturedCount <= bar],
      [`melee: the near body's type (${melee.near.type}) drew a back batch (back >= 1)`, !!nearB && nearB.back >= 1],
      ['melee: no new GPU errors, device not lost',
        melee.gpu.uncapturedCount === gpu.uncapturedCount && melee.gpu.lost === null && melee.info.gpuErrors.length === 0],
    ];
  }
  const ex = exceptionsIn(p);
  checks.push([`no page exceptions (${ex.length})`, ex.length === 0]);
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
