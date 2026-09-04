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
 * awaits promises and returns by value; a page exception becomes a
 * StageFail (via `onFail`, default failHard).
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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, timeoutMs = 120_000) => {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
    });
    if (r.result?.exceptionDetails) fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
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

/**
 * The interleaved leg loop: rotate the starting leg each rep (so a thermal
 * ramp cannot alias onto one leg), fresh page per run, apply the leg, run
 * its bench, read the row.
 *
 * legs: { name: { wounds: boolean, flat: boolean } } — the leg table.
 * opts:
 *   url          full page URL (e.g. .../sdf-game.html?frozen=1)
 *   benchArgs    object handed to __sdfGame.bench({ ...opts, label: leg })
 *   onRow(row)   called per completed run; return value ignored. Throw to
 *                abort.
 *   settleFrames sim frames let to come to rest after wounding (default 600)
 * Returns { rows, stagingRecords }.
 */
export async function runInterleaved(legs, reps, opts, fail = failHard) {
  const { url, benchArgs, onRow } = opts;
  const settleFrames = opts.settleFrames ?? 600;
  const rows = [];
  const stagingRecords = [];
  // Rotate the starting leg each rep so a thermal ramp cannot alias onto one
  // leg (interleave discipline, inherited).
  const names = Object.keys(legs);
  const order = (rep) => names.map((_, i) => names[(i + rep) % names.length]);

  for (let rep = 0; rep < reps; rep++) {
    for (const leg of order(rep)) {
      const L = legs[leg];
      await bootCloseupPage({ ...opts, url, fail });
      await applyShipDefaults(opts.evaluate);
      const staging = await stageCloseUp(opts.evaluate, opts.stage, fail);
      stagingRecords.push({ rep, leg, ...staging });
      let woundInfo = null;
      if (L.wounds) {
        woundInfo = await stampFacingWounds(opts.evaluate, opts.wounds, fail);
        // Let viscera ropes and any settle-state physics come to rest BEFORE
        // the timing starts, or their settling drift lands inside the bench
        // chunks as cost drift (the 38% spread the first run showed).
        await opts.evaluate(`__sdfGame.step(${settleFrames})`);
      }
      await opts.evaluate(`__sdfGame.setFlatAlbedo(${L.flat})`);
      await opts.evaluate('__sdfGame.step(2)');
      const occ = await opts.evaluate('__sdfGame.occupancy()');
      await opts.evaluate(`__sdfGame.bench({ kind: 'closeup', mode: 'throughput', warmup: 120, chunkFrames: 10, closeupFrames: 240, label: ${JSON.stringify(leg)}, ...${JSON.stringify(benchArgs ?? {})} })`);
      const r = JSON.parse(await opts.evaluate('JSON.stringify(window.__gameBench)'));
      if (!r.valid) fail(`${leg} rep${rep}: ${r.hiddenSteps} hidden frames — INVALID`);
      const seg = r.segments.find((s) => s.name === 'closeup');
      const census = seg?.census?.last ?? seg?.census?.first ?? null;
      const row = {
        rep, leg,
        p50: seg.p50, p95: seg.p95, mean: seg.mean, max: seg.max,
        coverage: occ.hits / (occ.targetW * occ.targetH),
        dist: staging.d,
        wounds: woundInfo?.wounds ?? 0,
        bodies: census?.bodies ?? occ.bodiesOnScreen,
        meanStepsHit: occ.meanStepsHit, missStepShare: occ.missStepShare,
        uptime: await opts.evaluate('__sdfGame.uptime()'),
      };
      rows.push(row);
      if (onRow) await onRow(row, { staging, woundInfo });
    }
  }
  return { rows, stagingRecords };
}
