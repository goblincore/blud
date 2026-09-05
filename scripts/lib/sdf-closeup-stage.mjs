// scripts/lib/sdf-closeup-stage.mjs — the close-up staging harness, as a
// library (close-up task 1b, 2026-09-04).
//
// WHY A LIBRARY. Every remaining task in the close-up program (2, 3, 4, 5)
// needs the same staged scene — one body filling the screen, ship defaults
// pinned, camera-facing wounds stamped — and right now each would re-derive
// it from the bench script, with the usual outcome: five copies, five subtle
// divergences, five uncomparable tables. This module is the one derivation.
//
// WHAT STAYS WITH THE CALLER: which legs to run and how to summarise them.
// This file owns everything a leg needs to be TRUSTWORTHY: the CDP
// connection and its tab teardown, the explicit ship-default pin, the
// coverage-search staging, the wound stamp with its loud assertions, and the
// interleaved fresh-page-per-run discipline.
//
// BEHAVIOUR CONTRACT: extracted verbatim from scripts/
// sdf-game-closeup-bench.mjs (task 1's harness, merged as 8da0bdd's
// follow-up). The bench is now a thin caller and its staging record
// ({ d, cov, body } + the wound stamp census) is byte-identical to the
// pre-extraction script's — proven by running both and diffing, not by
// reading the code.
//
//   import { connectGame, applyShipDefaults, stageCloseUp, stampFacingWounds,
//            bootCloseupPage, runInterleaved } from './lib/sdf-closeup-stage.mjs';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';

export class StageFail extends Error {
  constructor(msg) { super(msg); this.name = 'StageFail'; }
}

/** The script's fail(): print and die. connectGame's default; a caller that
 *  wants crash-retry passes its own (Step 2) — the messages stay identical. */
export const failHard = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

/**
 * Open a tab on the CDP browser, wire the evaluate/send channel, size the
 * page, and register the process-exit tab close. Every task must close its
 * tabs — this is where that stops being optional.
 *
 * Returns { tab, send, evaluate, ws }. `evaluate(expression, timeoutMs)`
 * awaits promises and returns by value; a page exception THROWS StageFail
 * (retriable upstream; the bench's top level prints FAIL and exits — same
 * visible behaviour as the pre-library script). A dead tab rejects every
 * pending send, which is what makes crash-retry possible at all.
 */
export async function connectGame({ vite, cdp, width = 1280, height = 800, onFail = failHard }) {
  const fail = onFail;
  const tab = await (
    await fetch(`http://localhost:${cdp}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const __closeTabUrl = `http://localhost:${cdp}/json/close/${tab.id}`;
  process.on('exit', () => {
    try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
  });

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
  };
  // A dead tab must REJECT, not hang: a page crash destroys the target, the
  // websocket closes, and every in-flight send would otherwise pend forever —
  // node then exits with an 'unsettled top-level await' and the crash-retry
  // never fires (measured 2026-09-04, killed a Question A run mid-rep).
  const hangup = (why) => {
    for (const [, p] of pending) p.reject(new StageFail(`CDP ${why} — page gone`));
    pending.clear();
  };
  ws.onclose = () => hangup('websocket closed');
  ws.onerror = () => hangup('websocket error');
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, timeoutMs = 120_000) => {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
    });
    if (r.result?.exceptionDetails) throw new StageFail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await fetch(`http://localhost:${cdp}/json/activate/${tab.id}`);
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  return { tab, send, evaluate };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fresh page per run — damage persists otherwise and every run would inherit
 * the previous run's craters (the 583%-spread lesson, inherited verbatim).
 * Waits for the WebGPU backend, settles first-use pipeline stalls, installs
 * the debug probe. `url` is the full page URL including any query params.
 */
export async function bootCloseupPage({ send, evaluate, url, fail = failHard }) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url });
  let backend = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (backend) break;
  }
  if (!backend) fail('game page never booted');
  if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
  await sleep(2500); // settle: first-use pipeline stalls are real
  await evaluate('__sdfGame.installDebugProbe()');
}

/**
 * Ship defaults, pinned so legs cannot inherit each other's state. Occluder
 * OFF (the shipped game state) and spillChance 0 (a static scene is the
 * instrument; the goo cost is task 4's question).
 *
 * Fourteen levers, EXPLICITLY — the value is that it does not trust the
 * page's boot state. If the page ships a new default, this pin holds the
 * scene fixed until the bench is consciously re-based.
 */
export async function applyShipDefaults(evaluate) {
  return evaluate(`(() => {
    __sdfGame.setOccluder(false);
    __sdfGame.setCone(false);
    __sdfGame.setFxaa(true);
    __sdfGame.setSdfScale(1.0);
    __sdfGame.setAdaptive(false);
    __sdfGame.setMarchSteps(96);
    __sdfGame.setShell(true);
    __sdfGame.setRelax(1.0);
    __sdfGame.setBleed(true);
    __sdfGame.setHullExitBound(false);
    __sdfGame.setDepthGate(false);
    __sdfGame.setHalfRate(false);
    __sdfGame.setFlatAlbedo(false);
    __sdfGame.setWoundTuning({ spillChance: 0 });
    return 1;
  })()`);
}

/** Default fill-screen staging: the distance ladder the coverage search
 *  walks, closest-first, keeping the BEST rung. */
export const CLOSEUP_LADDER = [1.6, 1.4, 1.25, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6];

/**
 * Stage the fill-screen scene. Returns the staging record the report quotes:
 * { d, cov, body } — the kept ladder rung, its flesh coverage (occupancy
 * mode-4 hits / SDF-target pixels), and which body was staged.
 *
 * Coverage = flesh pixels / SDF-target pixels. "One body filling the screen"
 * wants the closest framing that still renders, so the search walks the WHOLE
 * ladder and keeps the best — it does not stop at the first rung past a
 * threshold.
 */
export async function stageCloseUp(evaluate, opts = {}, fail = failHard) {
  const room = opts.room ?? 1;
  const eyeH = opts.eyeH ?? 1.62;
  const aimY = opts.aimY ?? 1.0;
  const ladder = opts.ladder ?? CLOSEUP_LADDER;
  const staged = await evaluate(`(async () => {
    __sdfGame.teleport(${room});
    const z = __sdfGame.zombies().find(q => q.room === ${room});
    if (!z) return { error: 'no body in room ${room}' };
    __sdfGame.freeze(true);
    const eyeH = ${eyeH}, aimY = ${aimY};
    const tryPose = (d, ang) => {
      const ex = z.pos[0] + Math.sin(ang) * d;
      const ez = z.pos[2] + Math.cos(ang) * d;
      const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
      const yaw = Math.atan2(dx, -dz);
      const pitch = Math.atan2(aimY - eyeH, Math.hypot(dx, dz));
      __sdfGame.setPose(ex, ez, yaw, pitch, 0);
      return { yaw, pitch };
    };
    // Coverage search: walk the whole distance ladder and KEEP THE BEST —
    // "one body filling the screen" wants the closest framing that still
    // renders, not the first rung past a threshold. Coverage = flesh pixels
    // / SDF-target pixels, from the occupancy counter (debug mode 4).
    let best = null;
    for (const d of ${JSON.stringify(ladder)}) {
      tryPose(d, 0);
      __sdfGame.step(2);
      const occ = await __sdfGame.occupancy();
      const cov = occ.hits / (occ.targetW * occ.targetH);
      if (!best || cov > best.cov) best = { d, cov, occ };
    }
    tryPose(best.d, 0);
    __sdfGame.step(2);
    return { d: best.d, cov: best.cov, body: z.id };
  })()`);
  if (staged.error) fail(staged.error);
  return staged;
}

/** slug/pellet mix: two blast craters (the wound-shadow lives near craters)
 *  and the rest pellets. [dyaw, dpitch, kind] camera-relative offsets. */
export const WOUND_OFFSETS = [
  [0, 0, 'slug'], [0.14, 0.06, 'slug'],
  [0.07, -0.08, 'pellet'], [-0.07, 0.1, 'pellet'], [-0.16, -0.04, 'pellet'],
];

/**
 * Stamp wounds on the camera-facing side from the staged pose, then assert
 * the staging is trustworthy — the three loud assertions:
 *   1. at least `minStamped` (3) wounds actually stamped;
 *   2. the blood sim is EMPTY (spillChance 0 set in applyShipDefaults);
 *   3. no stamp severed anything (chunks would add a marching cost the leg
 *      did not ask for).
 */
export async function stampFacingWounds(evaluate, opts = {}, fail = failHard) {
  const offsets = opts.offsets ?? WOUND_OFFSETS;
  const minStamped = opts.minStamped ?? 3;
  const r = await evaluate(`(async () => {
    const stamps = [];
    const offsets = ${JSON.stringify(offsets)};
    for (const [dyaw, dpitch, kind] of offsets) {
      const base = __sdfGame.pose();
      __sdfGame.setPose(base.pos[0], base.pos[2], base.yaw + dyaw, base.pitch + dpitch, 0);
      const p = __sdfGame.predictSlugHit();
      if (p.actorId < 0 || !p.hit) continue;
      const ok = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
        p.dir[0], p.dir[1], p.dir[2], kind, p.actorId);
      if (ok) stamps.push({ kind, actorId: p.actorId });
    }
    __sdfGame.step(5);
    const id = stamps[0]?.actorId;
    return {
      stamped: stamps.length,
      wounds: id !== undefined ? __sdfGame.zombie(id).woundList().length : null,
      bleed: __sdfGame.bleed,
      chunks: __sdfGame.chunkCount,
      bodies: __sdfGame.bodiesOnScreen,
    };
  })()`);
  if (r.stamped < minStamped) fail(`only ${r.stamped} wounds stamped — staging untrustworthy`);
  if (r.bleed.droplets !== 0 || r.bleed.splats !== 0) fail(`blood sim not empty: ${JSON.stringify(r.bleed)}`);
  if (r.chunks !== 0) fail(`${r.chunks} chunks in flight — a stamp severed something`);
  return r;
}

/** The leg rotation: rep 0 runs the legs in table order, rep 1 starts at the
 *  second leg, and so on — so a thermal ramp cannot alias onto one leg
 *  (interleave discipline, inherited). Pure so the discipline is testable
 *  without a browser. */
export function interleaveOrder(names, rep) {
  return names.map((_, i) => names[(i + rep) % names.length]);
}

/** The load gate, pure for the same reason. `row` needs { load1, load1Start }.
 *  gate null = everything passes (plain mode). A row passes only if the
 *  1-minute load average neither rose more than maxRise above its own
 *  leg-start sample nor exceeds maxAbs at read time. */
export function passesLoadGate(row, gate) {
  if (!gate) return true;
  const rise = row.load1 - row.load1Start;
  if (rise > gate.maxRise) return false;
  if (row.load1 > gate.maxAbs) return false;
  return true;
}

/**
 * The interleaved leg loop: rotate the starting leg each rep (so a thermal
 * ramp cannot alias onto one leg), fresh page per run, apply the leg, run
 * its bench, read the row.
 *
 * legs: { name: { wounds: boolean, flat: boolean } } — the leg table.
 * opts:
 *   url          full page URL (e.g. .../sdf-game.html?frozen=1)
 *   send/evaluate  an EXISTING connection (plain mode; no crash retry)
 *   benchArgs    object handed to __sdfGame.bench({ ...opts, label: leg })
 *   onRow(row)   called per completed run; return value ignored. Throw to
 *                abort.
 *   settleFrames sim frames let to come to rest after wounding (default 600)
 *
 * STABILITY MODE (task 1b Step 2) — pass instead of send/evaluate:
 *   vite, cdp, width, height
 *     runInterleaved owns the connection and can RE-BUILD it, which is what
 *     makes a crashed page survivable. A silent retry is how a bad table
 *     looks clean, so every recovery is counted:
 *   crashRetries   in-place re-connect + reload + re-stage per leg run
 *                  (default 0 = plain mode: a crash is fatal, as before)
 *   loadGate       { maxRise, maxAbs } on the 1-minute load average (node's
 *                  os.loadavg, quoted per row as `load1`). A row whose load1
 *                  ROSE more than maxRise above its own leg-start sample, or
 *                  whose load1 exceeds maxAbs, is rejected — not averaged
 *                  through. Rejected rows are re-run in makeup reps after
 *                  the main loop, until each leg holds minKept rows or
 *                  makeupCap makeup reps have run. Both counts are reported
 *                  in the returned block; neither is silent.
 * Returns { rows, stagingRecords, crashRetries, loadRejected, makeupReps }.
 */
export async function runInterleaved(legs, reps, opts, failParam = failHard) {
  const stable = !opts.evaluate;
  const maxCrashRetries = opts.crashRetries ?? 0;
  const gate = opts.loadGate ?? null;
  const minKept = opts.minKept ?? reps;
  const makeupCap = opts.makeupCap ?? 3;

  let conn = stable
    ? await connectGame({
        vite: opts.vite, cdp: opts.cdp, width: opts.width ?? 1280, height: opts.height ?? 800,
        // In stable mode a page exception is a RETRYABLE failure, not a
        // process exit — otherwise the crash-retry below could never fire.
        onFail: (msg) => { throw new StageFail(msg); },
      })
    : opts;
  const evaluate = () => conn.evaluate;
  // Same rule for the three loud assertions and boot timeouts inside a leg:
  // rethrow (retryable) in stable mode, hard-fail (as before) in plain mode.
  const fail = stable ? (msg) => { throw new StageFail(msg); } : failParam;

  const rows = [];
  const stagingRecords = [];
  let crashRetries = 0;
  let loadRejected = 0;
  let makeupReps = 0;
  const names = Object.keys(legs);
  const order = (rep) => interleaveOrder(names, rep);

  const runLeg = async (leg, rep) => {
    const L = legs[leg];
    const ev = evaluate();
    const loadStart = loadavg()[0];
    await bootCloseupPage({ send: conn.send, evaluate: ev, url: opts.url, fail });
    await applyShipDefaults(ev);
    if (L.exitBound !== undefined) await ev(`__sdfGame.setHullExitBound(${L.exitBound})`);
    // Generic per-leg seam application (close-up task 4): the BODY of an
    // async function with the page's seams in scope. Same class of hook as
    // exitBound above, for leg tables that need more than one seam each
    // (the goo A/B flips several perf levers per leg). Runs BEFORE staging,
    // so the staging search sees the leg's state.
    if (L.legJs) await ev(`(async () => { ${L.legJs} })()`);
    // Default staging: the room-1 fill-screen closeup. A caller can replace
    // it wholesale with stageJs — the BODY of an async function (wrapped
    // here, so a bare `return {...}` is legal) returning the staging record.
    const staging = opts.stageJs
      ? await ev(`(async () => { ${opts.stageJs} })()`)
      : await stageCloseUp(ev, opts.stage, fail);
    if (staging.error) fail(staging.error);
    stagingRecords.push({ rep, leg, ...staging });
    let woundInfo = null;
    if (L.wounds) {
      woundInfo = await stampFacingWounds(ev, opts.wounds, fail);
      // Let viscera ropes and any settle-state physics come to rest BEFORE
      // the timing starts, or their settling drift lands inside the bench
      // chunks as cost drift (the 38% spread the first run showed).
      await ev(`__sdfGame.step(${opts.settleFrames ?? 600})`);
    }
    await ev(`__sdfGame.setFlatAlbedo(${L.flat})`);
    await ev('__sdfGame.step(2)');
    const occ = await ev('__sdfGame.occupancy()');
    await ev(`__sdfGame.bench({ kind: 'closeup', mode: 'throughput', warmup: 120, chunkFrames: 10, closeupFrames: 240, label: ${JSON.stringify(leg)}, ...(L.benchArgs ?? ${JSON.stringify(opts.benchArgs ?? {})}) })`);
    const r = JSON.parse(await ev('JSON.stringify(window.__gameBench)'));
    if (!r.valid) fail(`${leg} rep${rep}: ${r.hiddenSteps} hidden frames — INVALID`);
    // Every segment, keyed by name (close-up task 4): the closeup scenario
    // has one, the firefight has walk/fire/gib — a driver that benches a
    // multi-segment scenario needs them all, not just the first.
    const segs = {};
    for (const s of r.segments) {
      segs[s.name] = { p50: s.p50, p95: s.p95, mean: s.mean, max: s.max, census: s.census ?? null };
    }
    const seg = r.segments.find((s) => s.name === 'closeup') ?? r.segments[0];
    const row = {
      rep, leg,
      p50: seg?.p50, p95: seg?.p95, mean: seg?.mean, max: seg?.max,
      segs,
      coverage: occ.hits / (occ.targetW * occ.targetH),
      dist: staging.d ?? null,
      wounds: woundInfo?.wounds ?? 0,
      bodies: segs[seg?.name]?.census?.last?.bodies ?? occ.bodiesOnScreen,
      meanStepsHit: occ.meanStepsHit, missStepShare: occ.missStepShare,
      uptime: await ev('__sdfGame.uptime()'),
      load1: loadavg()[0],
      load1Start: loadStart,
    };
    if (opts.onRow) await opts.onRow(row, { staging, woundInfo, evaluate: ev });
    return row;
  };

  const attemptLeg = async (leg, rep) => {
    // Crash retry: a page crash must not kill the rep silently, and a
    // retried row must not masquerade as a first-try row. Cap it.
    for (let attempt = 0; ; attempt++) {
      try {
        return await runLeg(leg, rep);
      } catch (e) {
        if (!stable || attempt >= maxCrashRetries) throw e;
        crashRetries++;
        console.warn(`  [retry ${crashRetries}] ${leg} rep${rep} failed (${String(e).slice(0, 120)}) — re-connecting and re-staging`);
        conn = await connectGame({ vite: opts.vite, cdp: opts.cdp, width: opts.width ?? 1280, height: opts.height ?? 800, onFail: fail });
      }
    }
  };

  const keep = (row) => {
    if (passesLoadGate(row, gate)) return true;
    const rise = row.load1 - row.load1Start;
    if (rise > gate.maxRise) { loadRejected++; console.warn(`  [load-reject] ${row.leg} rep${row.rep}: load1 rose ${rise.toFixed(1)} > ${gate.maxRise} during the leg`); }
    else { loadRejected++; console.warn(`  [load-reject] ${row.leg} rep${row.rep}: load1 ${row.load1.toFixed(1)} > ${gate.maxAbs}`); }
    return false;
  };

  const runRep = async (legsToRun, rep) => {
    for (const leg of legsToRun) {
      const row = await attemptLeg(leg, rep);
      if (keep(row)) rows.push(row);
    }
  };

  for (let rep = 0; rep < reps; rep++) await runRep(order(rep), rep);

  // Makeup reps: only the legs still short of minKept, still in rotation.
  const keptOf = (leg) => rows.filter((r) => r.leg === leg).length;
  while (makeupReps < makeupCap && names.some((l) => keptOf(l) < minKept)) {
    const deficient = order(makeupReps).filter((l) => keptOf(l) < minKept);
    await runRep(deficient, reps + makeupReps);
    makeupReps++;
  }

  return { rows, stagingRecords, crashRetries, loadRejected, makeupReps,
    kept: Object.fromEntries(names.map((l) => [l, keptOf(l)])) };
}
