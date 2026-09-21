// scripts/sdf-game-melee-bench.mjs — the melee close-up perf harness
// (2026-09-21). Reproduces, on demand, the ONE scenario the owner's
// telemetry says is genuinely GPU-bound: SEVERAL bodies close to the camera
// (telemetry episode: 8 bodies, nearest 1.6 m, coverage 1.0), wounded, with
// FX running — `sdf:march` 28-38 ms there. The single-body close-up benches
// stage a different scene (one body, ~27% of the march target, all wounds on
// one hip) and cannot judge an optimisation against the episode.
//
// THIS IS AN INSTRUMENT, NOT AN OPTIMISATION: it measures; it changes no
// shipped default. No file under src/ is touched.
//
// Scene: /sdf-game.html?frozen=1&seed=1, arena (room 6, the 16x16 horde
// room), MELEE_BODIES (6) in a staggered arc, nearest row ~MELEE_NEAREST
// (1.4 m), ladder-searched for the highest settled coverage. Phases are
// SEQUENTIAL in ONE page — wounds are irreversible, and one page is the only
// place GPU ms are comparable (Apple GPU downclocks under the 30 fps cap;
// identical work read 1.5x different across page loads, so setFrameCap(0)
// and every comparison here is between block medians INSIDE one boot):
//
//   1. clean        — staged, unwounded, spillChance 0
//   2. wounded      — stampMeleeWounds' plan: craters on chest/head/arm/thigh
//   3. wounded+fire — igniteAll() + ~60 stepped frames for the fire to take
//
// Legs alternate INSIDE each phase in rotating order (interleaveOrder — a
// thermal ramp must not alias onto one leg), MELEE_REPS (3) blocks of
// MELEE_FRAMES (60) frames each. Every leg first RESTORES the ship levers
// snapshotted at boot, then applies its own seam:
//
//   ship      — nothing (the restored frame)
//   flat      — setFlatAlbedo(true): the march walk with shading skipped
//   refoldOff — setOwnerRefold(false): prices the owner re-fold; wounded
//               phases only, renders a wrong frame on purpose
//   extra     — MELEE_LEGS='name=<page js>;name2=<page js>' lets a later
//               branch A/B a new seam WITHOUT editing this script. A leg
//               whose JS throws (a seam this branch does not have, e.g.
//               setOwnerRefoldGate) is SKIPPED with a warning, not fatal.
//               No ';' inside the JS (it is the separator).
//
// Per phase, AFTER the timed blocks (captures must not contaminate timing):
// a PNG screenshot, the mode-4 march-target census (censusFromTarget), the
// per-body wound rows, and crowdInfo().
//
// THE LOAD RULE: every row records os.loadavg()[0]; any block over 4.0 marks
// the run loadSuspect — the numbers then say what the machine did under that
// load, and nothing more. This run's honest load is stated in melee.md.
//
// Usage:
//   LAB_TMP=.lab-tmp LAB_VITE_PORT=5412 LAB_CDP_PORT=9412 \
//     scripts/sdf-game-melee-bench.sh
// Env: MELEE_BODIES (6), MELEE_NEAREST (1.4 — the nearest BODY ROW's
//      distance; the framing ladder then moves the CAMERA 1.5..0.9 m out),
//      MELEE_SPACING (0.65 — a crush; bodies overlap on screen),
//      MELEE_ROOM (6 — arena), MELEE_CHARACTER ('zombie'; see below),
//      MELEE_REPS (3), MELEE_FRAMES (60), MELEE_LEGS, MELEE_SETTLE_TRIES
//      (30; 2400 for the FIRST cold-cache boot — it can cost minutes),
//      MELEE_PLAYER_X/Z/YAW (default: the arena's north-spawn-band anchor
//      (27.5, -7.4) facing -z — the boot cast sits within short nudge
//      range of an arc there), BENCH_OUT (/tmp/sdf-melee),
//      MELEE_WATCHDOG_MIN (25).
//
// BODIES COME FROM THE BOOT CAST, moved into the arc with verified short
// zombieNudge hops. Two measured page facts force this (probes recorded in
// docs/dev-notes/2026-09-21-melee-harness/NOTES.md): (1) a body added after
// boot via spawnDebugCharacter never marches flesh AND zeroes the flesh
// hits of every body already marching; (2) each crowd type's colour atlas
// flushes lazily, so reads before the flush show proxies with zero hits —
// staging waits for every attached type to flush before measuring.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import {
  connectGame, bootCloseupPage, sleep, interleaveOrder, failHard,
} from './lib/sdf-closeup-stage.mjs';
import {
  stageMelee, stampMeleeWounds, woundPlan, pelletsOnly,
  summariseBlocks, renderMarkdown, censusFromTarget, assertMeleeWounds,
  LOAD_SUSPECT_LIMIT,
} from './lib/sdf-melee-stage.mjs';

const VITE = Number(process.argv[2] ?? 5421);
const CDP = Number(process.argv[3] ?? 9421);
const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-melee';
const N_BODIES = Number(process.env.MELEE_BODIES ?? 6);
const GATHER_RADIUS = Number(process.env.MELEE_GATHER_RADIUS ?? 3.0);
const GATHER_FRAMES = Number(process.env.MELEE_GATHER_FRAMES ?? 2400);
const ROOM = Number(process.env.MELEE_ROOM ?? 6);
const CHARACTER = process.env.MELEE_CHARACTER ?? 'zombie';
if (CHARACTER !== 'zombie') {
  console.warn('  WARNING: MELEE_CHARACTER=' + CHARACTER + ' cannot be honored — bodies added after boot do not march flesh (measured 2026-09-21); the scene uses the room\'s BOOT cast (arena: zombies).');
}
const REPS = Number(process.env.MELEE_REPS ?? 3);
const FRAMES = Number(process.env.MELEE_FRAMES ?? 60);
const WARMUP = Number(process.env.MELEE_WARMUP ?? 60);
const SETTLE_TRIES = Number(process.env.MELEE_SETTLE_TRIES ?? 30);
const W = 1280, H = 800;
// MELEE_QS appends page flags, e.g. "&limbs" to compile mode 4 in for a gate/limbs A/B.
const URL_ = `http://localhost:${VITE}/sdf-game.html?frozen=1&seed=1${process.env.MELEE_QS ?? ""}`;

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const WATCHDOG_MIN = Number(process.env.MELEE_WATCHDOG_MIN ?? 25);
setTimeout(() => { console.error(`FAIL: watchdog (${WATCHDOG_MIN} min)`); process.exit(3); }, WATCHDOG_MIN * 60_000).unref();

// Extra legs from the environment: 'name=<page js>;name2=<page js>'. The
// first '=' splits name from JS (the JS may contain '='; it may NOT contain
// ';' — that is the leg separator).
const extraLegs = Object.fromEntries(
  (process.env.MELEE_LEGS ?? '')
    .split(';').filter((s) => s.trim())
    .map((s) => {
      const eq = s.indexOf('=');
      if (eq <= 0) return null;
      return [s.slice(0, eq).trim(), s.slice(eq + 1).trim()];
    }).filter(Boolean),
);

// env-num helper: MELEE_PLAYER_YAW accepts a number or 'PI'/'-PI/2' style
// simple expressions (evaluated narrowly, digits + operators only).
const envNum = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  if (!/^-?[0-9./()*PIE\s]+$/i.test(raw)) fail(`${name}="${raw}" is not a number`);
  return Function(`"use strict"; return (${raw});`)();
};

// The wound plan is built node-side ONCE (it is pure), then bound to the
// staged bodies' actor ids after staging.
const FIRE_FRAMES = Number(process.env.MELEE_FIRE_FRAMES ?? 45);
const PER_BODY = Number(process.env.MELEE_WOUNDS_PER_BODY ?? 6);
const PLAN = woundPlan(N_BODIES, PER_BODY);

mkdirSync(OUT, { recursive: true });

console.log(`melee-bench ${URL_}`);
console.log(`  bodies ${N_BODIES}  gather radius ${GATHER_RADIUS} m  max ${GATHER_FRAMES} sim frames  room ${ROOM}`);
console.log(`  reps ${REPS} x ${FRAMES} frames  legs ship/flat/refoldOff${Object.keys(extraLegs).length ? '+' + Object.keys(extraLegs).join('+') : ''}`);
console.log(`  out ${OUT}`);

// ---------------------------------------------------------------------------
// Boot ONE page and hold it for all three phases.
// ---------------------------------------------------------------------------
const conn = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
const { send, evaluate: ev } = conn;

// Boot-state snapshot for the leg restore (rule 2: a leg must first RESTORE
// the ship state it read at boot, then apply its own seam — an env leg may
// touch levers applyShipDefaults does not pin, so the snapshot, not the pin
// list, is the restore).
const SNAPSHOT_JS = `(() => {
  const g = __sdfGame;
  return {
    flatAlbedo: g.flatAlbedo, ownerRefold: g.ownerRefold,
    hullExitBound: g.hullExitBound, woundEarlyOut: g.woundEarlyOut,
    woundListOn: g.woundList, marchSteps: g.marchSteps,
    sdfScale: g.sdfScale, adaptive: g.adaptive, halfRate: g.halfRate,
    depthGate: g.depthGate, occluder: g.occluder, cone: g.cone,
    shell: g.shell, relax: g.relax,
    bleedEnabled: g.bleed.enabled, spillChance: g.woundTuning.spillChance,
    frameCap: g.frameCap,
  };
})()`;
const RESTORE_JS = (snap) => `(() => {
  const snap = ${JSON.stringify(snap)};
  window.__meleeShipRestore = () => {
    const g = __sdfGame;
    g.setFlatAlbedo(snap.flatAlbedo);
    g.setOwnerRefold(snap.ownerRefold);
    g.setHullExitBound(snap.hullExitBound);
    g.setWoundEarlyOut(snap.woundEarlyOut);
    g.setWoundList(snap.woundListOn);
    g.setMarchSteps(snap.marchSteps);
    g.setSdfScale(snap.sdfScale);
    g.setAdaptive(snap.adaptive);
    g.setHalfRate(snap.halfRate);
    g.setDepthGate(snap.depthGate);
    g.setOccluder(snap.occluder);
    g.setCone(snap.cone);
    g.setShell(snap.shell);
    g.setRelax(snap.relax);
    g.setBleed(snap.bleedEnabled);
    g.setWoundTuning({ spillChance: snap.spillChance });
    g.setFrameCap(0);
    return 1;
  };
  return 1;
})()`;

// ---------------------------------------------------------------------------
// Staging (and re-staging after a severed-stamp reload).
// ---------------------------------------------------------------------------

async function bootAndStage({ firstBoot = false } = {}) {
  await bootCloseupPage({ send, evaluate: ev, url: URL_, fail });
  // NOT applyShipDefaults: that pin predates the upscaler (it sets the march scale to 1.0
  // and turns the hull exit bound OFF) and is not what the game ships. The boot state IS
  // the ship state; the only departure is an empty blood sim for the first two phases.
  await ev('__sdfGame.setWoundTuning({ spillChance: 0 }); 1');
  let up = null;
  for (let i = 0; i < (firstBoot ? 120 : 24); i++) {
    up = await ev('window.__sdfGame.upscaleInfo()');
    if (up?.on) break;
    await sleep(500);
  }
  if (!up?.on) fail(`shipped upscaler never came on: ${JSON.stringify(up)}`);
  await ev('__sdfGame.setFrameCap(0)');
  const snap = await ev(SNAPSHOT_JS);
  await ev(RESTORE_JS(snap));
  const stg = await stageMelee(ev, {
    room: ROOM, n: N_BODIES, gatherRadius: GATHER_RADIUS, maxFrames: GATHER_FRAMES,
    settleTries: SETTLE_TRIES,
  }, fail);
  return { snap, up, stg };
}

let { snap: bootSnap, up, stg: staging } = await bootAndStage({ firstBoot: true });
console.log(`  upscaler on: model ${up.model} ${JSON.stringify(up.inSize)}->${JSON.stringify(up.outSize)}`);
console.log(`  staged: ${staging.gathered}/${staging.n} bodies within ${GATHER_RADIUS} m after ${staging.frames} sim frames,`
  + ` nearest ${staging.nearest} m, distances ${staging.distances.join(' ')}`);
console.log(`  framing: coverage ${(staging.coverage * 100).toFixed(1)}%`
  + ` rasterised ${(staging.rasterised * 100).toFixed(1)}%`
  + ` bodiesOnScreen ${staging.bodiesOnScreen} yaw ${staging.pose.yaw.toFixed(2)} pitch ${staging.pose.pitch.toFixed(2)}`);
if (staging.gathered < staging.n) {
  console.warn(`  WARNING: only ${staging.gathered} of ${staging.n} bodies reached ${GATHER_RADIUS} m — raise MELEE_GATHER_FRAMES`);
}

// ---------------------------------------------------------------------------
// Legs, phases, timing blocks.
// ---------------------------------------------------------------------------

const BASE_LEG_JS = {
  ship: null,
  flat: '__sdfGame.setFlatAlbedo(true);',
};
const WOUNDED_LEG_JS = {
  ...BASE_LEG_JS,
  refoldOff: '__sdfGame.setOwnerRefold(false);',
};
const legNames = (phase) => [
  ...Object.keys(phase === 'clean' ? BASE_LEG_JS : WOUNDED_LEG_JS),
  ...Object.keys(extraLegs),
];
const legJs = (phase, leg) =>
  (phase === 'clean' ? BASE_LEG_JS : WOUNDED_LEG_JS)[leg] ?? extraLegs[leg];

/** Rule 2, per leg: RESTORE the boot state first, then apply the seam. An
 *  env leg whose seam this page does not have throws in-page; that leg is
 *  SKIPPED with a warning (never fatal — other branches add seams), and the
 *  restore runs again so the skip cannot leak state into the next leg. */
async function applyLeg(leg, js) {
  await ev('__meleeShipRestore()');
  if (js == null) return true; // ship: the restored frame is the leg
  try {
    await ev(`(async () => { ${js} })()`);
    return true;
  } catch (e) {
    console.warn(`  [skip leg] ${leg}: seam missing or threw: ${String(e).slice(0, 160)}`);
    await ev('__meleeShipRestore()');
    return false;
  }
}

/** The settled occupancy read (close-up bistability fix): wait for two
 *  consecutive agreeing LIVE reads 250 ms apart before believing a number. */
const SETTLED_OCC_JS = (tries) => `(async () => {
  let occ = await __sdfGame.occupancy();
  let prevSig = null;
  for (let t = 0; t < ${tries} && !(occ.rasterised > 0 && occ.hits + ':' + occ.rasterised === prevSig); t++) {
    prevSig = occ.hits + ':' + occ.rasterised;
    await new Promise((r) => setTimeout(r, 250));
    occ = await __sdfGame.occupancy();
  }
  return occ;
})()`;

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  return file;
}

/** Per-phase captures, taken AFTER the phase's timed blocks: PNG (the real
 *  look), mode-4 census (buffer read + censusFromTarget), per-body wound
 *  rows, crowdInfo. Mode 4 changes what the march renders, so it is enabled
 *  strictly inside here and restored before returning. */
async function capturePhase(phase, withWounds) {
  await applyLeg('ship', null);
  await ev('__sdfGame.step(2)');
  const shotFile = await screenshot(phase.replaceAll('+', '-'));
  let census = null, occ = null;
  await ev('__sdfGame.setMarchDebugMode(4)');
  try {
    occ = await ev(SETTLED_OCC_JS(SETTLE_TRIES));
    const buf = await ev('__sdfGameDebug.readMarchTarget()');
    const bytes = Buffer.from(buf.rgba32f, 'base64');
    census = censusFromTarget(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2), buf.w, buf.h);
  } finally {
    await ev('__sdfGame.setMarchDebugMode(0)');
  }
  const bodies = withWounds
    ? await ev(`(() => {
        const ids = ${JSON.stringify(staging.ids)};
        return ids.map((id) => {
          const z = __sdfGame.zombie(id);
          if (!z) return { id, gone: true };
          const wounds = z.woundList();
          const prims = z.posed().prims;
          return { id,
            woundRows: wounds.length,
            visualRows: z.visualWoundList().length,
            limbs: [...new Set(wounds.map((w) => prims[w.primIdx]?.limb ?? '?'))] };
        });
      })()`)
    : null;
  const crowd = await ev('__sdfGame.crowdInfo()');
  if (!occ || !(occ.rasterised > 0)) fail(`${phase}: occupancy never went live for the census`);
  // A census with rasterised pixels and ZERO hits is not a scene with no flesh, it is a
  // readback that did not see the debug counters (seen in the fire phase 2026-09-21: every
  // rasterised pixel read steps 1 / hit 0 while the screenshot is full of burning bodies).
  // Say so instead of printing a confident 0 %.
  if (census && census.rasterised > 0 && census.hits === 0) {
    console.warn(`  WARNING: ${phase} census read 0 hits over ${census.rasterised} rasterised pixels — debug mode 4 did not reach this phase's march path; census marked unreliable`);
    census = { ...census, unreliable: true };
  }
  return { screenshot: shotFile, census, occupancy: occ, bodies, crowd };
}

/** Wound the crowd; on a SEVER (chunks > 0 — a stamp cut a limb and gib cost
 *  just joined the scene), reload, re-stage and retry PELLETS ONLY, twice.
 *  Non-sever problems are warned (the report quotes them); the caller fails
 *  the run if the final record still violates the loud checks. */
async function stampWithRetry() {
  let plan = PLAN;
  for (let attempt = 1; ; attempt++) {
    const rec = await stampMeleeWounds(ev, plan, { ids: staging.ids, playerPose: staging.pose }, fail);
    const problems = assertMeleeWounds(rec, { minLandedFrac: Number(process.env.MELEE_MIN_LANDED ?? 0.6) });
    if (rec.chunks === 0) {
      for (const p of problems) console.warn(`  WARNING: ${p}`);
      return { rec, plan, problems };
    }
    console.warn(`  [sever] chunks ${rec.chunks} after stamping — reload, re-stage, retry PELLETS ONLY (attempt ${attempt})`);
    if (attempt >= 2) return { rec, plan, problems };
    ({ stg: staging } = await bootAndStage());
    console.log(`  re-staged: coverage ${(staging.coverage * 100).toFixed(1)}%, ids ${staging.ids.join(',')}`);
    plan = pelletsOnly(plan);
  }
}

const rows = [];
const phasesOut = {};
let woundRec = null;
for (const phase of ['clean', 'wounded', 'wounded+fire']) {
  if (phase === 'wounded') {
    console.log('\n=== stamping the crowd ===');
    const { rec, plan, problems } = await stampWithRetry();
    if (problems.length) fail(`wound staging untrustworthy: ${problems.join(' ; ')}`);
    console.log(`  stamped ${rec.landed}/${rec.planned} planned stamps`
      + ` (plan ${plan === PLAN ? 'mixed' : 'pellets-only'}), chunks ${rec.chunks},`
      + ` blood ${JSON.stringify(rec.bleed)}`);
    for (const b of rec.perBody) {
      console.log(`   body ${b.id}: stamps ${b.landed}/${b.planned} woundRows ${b.woundRows} visualRows ${b.visualRows} limbs [${b.limbs.join(', ')}]`);
    }
    if (rec.skips.length) console.log(`  skips: ${JSON.stringify(rec.skips)}`);
    // Settle the stamps before the phase's first timed block.
    await ev('__sdfGame.step(120)');
    woundRec = rec;
  }
  if (phase === 'wounded+fire') {
    console.log('\n=== igniting the crowd ===');
    // FIRE NEEDS THE SIM RUNNING (measured 2026-09-21): igniteAll() on a frozen cast marks
    // 23 bodies burning but no `post:fire-march` pass ever appears; after a thaw it does
    // (2 ms at one body) and it survives the re-freeze. So thaw briefly, holding the player
    // where they stand, then re-freeze and put the camera back on the staged framing. The
    // thaw is short on purpose: burning zombies panic and run.
    await ev(`(() => {
      const p = ${JSON.stringify(staging.pose)};
      __sdfGame.igniteAll();
      __sdfGame.freeze(false);
      for (let i = 0; i < ${FIRE_FRAMES}; i += 5) {
        __sdfGame.step(5);
        __sdfGame.placePlayer({ x: p.pos[0], z: p.pos[2], yaw: p.yaw, pitch: p.pitch });
      }
      __sdfGame.freeze(true);
      __sdfGame.setPose(p.pos[0], p.pos[2], p.yaw, p.pitch, 0);
      __sdfGame.step(3);
      return 1;
    })()`);
    console.log(`  burning: ${JSON.stringify(await ev('__sdfGame.burning().length'))} bodies tracked`);
  }

  console.log(`\n=== ${phase} ===`);
  const names = legNames(phase);
  for (let rep = 0; rep < REPS; rep++) {
    for (const leg of interleaveOrder(names, rep)) {
      const load1Start = loadavg()[0];
      if (!(await applyLeg(leg, legJs(phase, leg)))) continue;
      await ev('__sdfGame.step(2)');
      await ev(`__sdfGame.bench({ kind: 'closeup', mode: 'passes', closeupFrames: ${FRAMES},`
        + ` warmup: ${WARMUP}, holdPlayer: true, label: ${JSON.stringify(`${phase}/${leg}`)} })`);
      const r = JSON.parse(await ev('JSON.stringify(window.__gameBench)'));
      if (!r.valid) fail(`${phase}/${leg} rep${rep}: ${r.hiddenSteps} hidden frames — INVALID`);
      const labels = Object.fromEntries(
        Object.entries(r.passes?.overall?.labels ?? {}).map(([k, v]) => [k, { p50: v.p50, mean: v.mean }]),
      );
      const row = {
        phase, leg, rep,
        valid: r.valid, hiddenSteps: r.hiddenSteps,
        p50: r.overall.p50, p95: r.overall.p95, mean: r.overall.mean,
        spanP50: r.passes?.overall?.span?.p50 ?? null,
        passFrames: r.passes?.overall?.frames ?? 0,
        labels,
        load1: loadavg()[0], load1Start,
      };
      rows.push(row);
      const march = labels['sdf:march'] ? ` march ${labels['sdf:march'].p50.toFixed(2)}` : ' (no pass samples)';
      process.stdout.write(`  rep${rep} ${leg}: frame p50 ${row.p50.toFixed(2)} ms,${march}`
        + ` load ${load1Start.toFixed(1)}->${row.load1.toFixed(1)}\n`);
    }
  }
  phasesOut[phase] = await capturePhase(phase, phase !== 'clean');
  const c = phasesOut[phase].census;
  console.log(`  census: coverage ${(c.coverage * 100).toFixed(1)}% occupancy ${(c.occupancy * 100).toFixed(1)}%`
    + ` steps/hit ${c.meanStepsHit.toFixed(1)} missStepShare ${(c.missStepShare * 100).toFixed(1)}%`);
  if (phasesOut[phase].bodies) {
    for (const b of phasesOut[phase].bodies) {
      console.log(`   body ${b.id}: woundRows ${b.woundRows} visualRows ${b.visualRows} limbs [${(b.limbs ?? []).join(', ')}]`);
    }
  }
}
if (woundRec) phasesOut.wounded.woundRecord = woundRec;

// ---------------------------------------------------------------------------
// Summarise + write melee.json / melee.md.
// ---------------------------------------------------------------------------
const summary = summariseBlocks(rows);
const maxLoad = Math.max(...rows.map((r) => r.load1));

const md = [];
md.push(`# Melee close-up bench — ${new Date().toISOString()}`);
md.push('');
md.push(`Scenario: the room's own cast WALKED to the player (${staging.gathered}/${staging.n} within ${GATHER_RADIUS} m after ${staging.frames} sim frames, nearest ${staging.nearest} m), room ${ROOM}, then frozen; one page, frame cap off.`);
md.push('');
md.push('Staged coverage is a settled mode-4 occupancy read (two agreeing live frames). The wound plan stamps chest/head/arm/thigh per body; a slug never stamps off the chest (SLUG.severRadius 0.13 severs a limb in one hit).');
md.push('');
md.push(renderMarkdown(summary, staging));
md.push(`Machine load: max 1-minute average across all timed blocks **${maxLoad.toFixed(2)}**`
  + `${summary.loadSuspect ? ` — **loadSuspect** (above ${LOAD_SUSPECT_LIMIT}, cross-leg deltas are indicative only)` : ' (quiet)'}.`);
md.push('');
md.push('## Per-phase census + scene');
md.push('');
for (const phase of ['clean', 'wounded', 'wounded+fire']) {
  const p = phasesOut[phase];
  if (!p) continue;
  const c = p.census;
  md.push(`### ${phase}`); 
  md.push('');
  md.push(`Screenshot: ${p.screenshot}`); 
  md.push('');
  md.push(`| coverage | rasterised | occupancy | steps/hit | steps/miss | miss step share | mean clip depth (hit) | bodies on screen |`);
  md.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  md.push(`| ${(c.coverage * 100).toFixed(1)}% | ${(c.rasterisedFrac * 100).toFixed(1)}% | ${(c.occupancy * 100).toFixed(1)}% | ${c.meanStepsHit.toFixed(1)} | ${c.meanStepsMiss.toFixed(1)} | ${(c.missStepShare * 100).toFixed(1)}% | ${c.meanClipDepthOnHit.toFixed(3)} | ${p.occupancy.bodiesOnScreen} |`);
  md.push('');
  if (p.bodies) {
    md.push('| body id | wound rows | visual rows | owner limbs |');
    md.push('| --- | --- | --- | --- |');
    for (const b of p.bodies) {
      md.push(`| ${b.id} | ${b.woundRows} | ${b.visualRows} | ${(b.limbs ?? []).join(', ') || '—'} |`);
    }
    md.push('');
    md.push('`visualRows` is `visualWoundList().length` — the uploaded ROW count, larger than the stamp count, and what the shader pays for per-ray.');
    md.push('');
  }
}

const doc = {
  meta: {
    when: new Date().toISOString(), url: URL_, W, H,
    env: {
      MELEE_BODIES: N_BODIES, MELEE_GATHER_RADIUS: GATHER_RADIUS, MELEE_GATHER_FRAMES: GATHER_FRAMES,
      MELEE_ROOM: ROOM, MELEE_CHARACTER: CHARACTER, MELEE_REPS: REPS,
      MELEE_FRAMES: FRAMES, MELEE_WARMUP: WARMUP, MELEE_LEGS: process.env.MELEE_LEGS ?? '',
      MELEE_SETTLE_TRIES: SETTLE_TRIES,
    },
  },
  boot: { snapshot: bootSnap, upscaler: { model: up.model, inSize: up.inSize, outSize: up.outSize } },
  staging,
  phases: phasesOut,
  rows,
  summary,
  loadSuspect: summary.loadSuspect,
  maxLoad,
};
writeFileSync(`${OUT}/melee.json`, JSON.stringify(doc, null, 2));
writeFileSync(`${OUT}/melee.md`, md.join('\n'));
console.log('\n' + md.join('\n'));
console.log(`\nwrote ${OUT}/melee.json and ${OUT}/melee.md`);
process.exit(0);

