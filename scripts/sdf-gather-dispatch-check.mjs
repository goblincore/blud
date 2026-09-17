// scripts/sdf-gather-dispatch-check.mjs — the R1 gather-dispatch evidence tool.
//
// WHY THIS EXISTS. R1 (docs/dev-notes/2026-09-10-r1-gather-dispatch-design.md)
// rewrote the probe gather from one thread per probe to one thread per
// (probe, ray) with a workgroup-local reduction. The gather feeds the game's
// indirect lighting, so "the numbers look about right" is not a verdict: the
// failure modes are a MIS-REDUCED probe (a wrong divisor, a group folded twice)
// and a RACE between the scratch write and the fold. Neither is visible to any
// CPU test — nothing here compiles WGSL — so this tool measures the gather's
// own output buffer, which is what the march actually reads.
//
// WHAT IT ESTABLISHES, per ray count (the RAYS sweep, default the shipped 32
// plus every padding path the reduction has):
//
//   readback digest   the FNV-1a of the f32 bit patterns of the whole dynamic
//                     layer (400 probes x 16 floats, untrimmed tail). The
//                     AUTHORITY for "same build, same input, same bytes".
//   repeatability     the same reading taken again after two more frames at a
//                     frozen state. The blend makes the record move toward the
//                     new estimate, so a DIFFERENCE here is expected and is not
//                     a failure; what matters is whether it is reproducible.
//   gates             the gather's own input readout (capsules, lights, room) so
//                     "the inputs differed" can never be confused with "the
//                     gather diverged on identical inputs".
//   floats            the raw buffer, dumped to --out for the numeric diff that
//                     a digest cannot give (an ulp-level change hashes as loud
//                     as a dropped probe).
//
// THE TRAPS THIS TOOL ENCODES, each of which produced a confident, meaningless
// answer on an earlier tool in this repo:
//
//   1. FRESH PAGE PER SWEEP POINT is NOT needed here — the sweep points differ
//      only in a uniform the gather re-reads every dispatch — but the page IS
//      frozen from boot (`?frozen=1`, then setRenderLock + freeze) so the
//      capsules, the light list and the ray seed cannot drift under the
//      measurement. `setDemoHold(true)` pins the ray-set rotation; without it
//      every dispatch estimates a different ray set and nothing is comparable.
//   2. THE READS ARE RETURNED IN-PAGE. A Float32Array does not survive CDP
//      returnByValue; `Array.from(...)` in the page does. (Same convention as
//      `scripts/sdf-game-bench.mjs` and the frame hash.)
//   3. A DIGEST IS NOT A MEASUREMENT. Equal digests prove bit-equality; unequal
//      digests prove NOTHING about magnitude — a 1-ulp FMA difference and a
//      lost probe both just "differ". Two builds are therefore compared on the
//      dumped floats (max abs / max rel / counts), never on the digest alone.
//   4. STAY IN ONE BOOT for any claim about identity. Two boots disagree for
//      reasons that have nothing to do with this change (the two-state branch,
//      2026-09-10). Cross-boot comparisons below are labelled as such and are
//      only sound because the INPUT hash is checked alongside them.
//
// Usage:
//   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-gather-dispatch-check.mjs
//   ... --out /tmp/gather-new.json --label r1-new
//   ... --rays 32            (single ray count; default is the sweep)
//   ... --compare /tmp/gather-old.json
// Requires servers; `scripts/lab-servers.sh` owns them (see sdf-demo-hash.sh for
// the wrapper pattern).
import { writeFileSync, readFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9277);
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
// The sweep covers every threads-per-probe the reduction can take — 1, 2, 4, 8,
// 16, 32, 64 — including the two PADDED cases (3 rays -> tpp 4, 47 rays -> tpp
// 64) where more lanes exist than rays, and the `?dynrays=0` control, which must
// still dispatch one thread per probe and write the decayed record.
const RAYS = argOf('rays', '0,1,2,3,5,8,16,31,32,47,64').split(',').map(Number);
const OUT = argOf('out', '');
const LABEL = argOf('label', 'run');
// Same-boot exact output gate for the capsule/visibility/cone optimization.
const OPTIMIZATION_AB = argv.includes('--optimization-ab');
const ROOM = argOf('room', '1');
const FLASH = argv.includes('--flash');
const CROWD = Number(argOf('crowd', '0'));
if (!Number.isInteger(CROWD) || CROWD < 0 || CROWD > 12) throw new Error('--crowd must be 0..12');
const COMPARE = argOf('compare', '');
// --diff OLD.json NEW.json: OFFLINE, no browser and no GPU. Two runs are
// compared as files, which is what makes the evidence re-checkable by anyone
// without re-running the whole measurement.
const DIFF = argv.includes('--diff') ? [argv[argv.indexOf('--diff') + 1], argv[argv.indexOf('--diff') + 2]] : null;
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

if (DIFF) {
  const [oldPath, newPath] = DIFF;
  const oldP = JSON.parse(readFileSync(oldPath, 'utf8'));
  const newP = JSON.parse(readFileSync(newPath, 'utf8'));
  console.log(`old: ${oldPath}  label=${oldP.label}  at=${oldP.at}  dispatch frames ${oldP.dispatchFrames?.join(',')}`);
  console.log(`new: ${newPath}  label=${newP.label}  at=${newP.at}  dispatch frames ${newP.dispatchFrames?.join(',')}`);
  console.log(`old console problems: ${oldP.consoleProblems?.length ?? 0}  new: ${newP.consoleProblems?.length ?? 0}\n`);
  diffPayloads(oldP, newP, oldPath, newPath);
  process.exit(newP.consoleProblems?.length ? 2 : 0);
}

setTimeout(() => { console.error('FAIL: watchdog 30 min'); process.exit(3); }, 30 * 60_000).unref();

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;

// TRAP 1: THE CONSOLE AT LOAD. A WGSL/Tint pipeline failure is reported HERE and
// nowhere else — it does not throw into JS, it logs and the pass renders
// nothing. The 2026-09-10 session lost an afternoon to a pipeline that had been
// printing its own cause on every page load. The hook is installed with
// `addScriptToEvaluateOnNewDocument` so it runs BEFORE any page script on every
// navigation: a hook installed after the boot would miss exactly the first
// dispatch that a broken shader fails on. (connectGame does not expose the CDP
// socket, so the `Runtime.consoleAPICalled` event route is not available here.)
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__gatherConsole = [];
    const push = (k, a) => window.__gatherConsole.push([k, a.map(x => {
      try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
    }).join(' ')]);
    const e = console.error, w = console.warn;
    console.error = (...a) => { push('error', a); e(...a); };
    console.warn = (...a) => { push('warning', a); w(...a); };
    window.addEventListener('error', (ev) => window.__gatherConsole.push(['uncaught', String(ev.message)]));
    window.addEventListener('unhandledrejection', (ev) => window.__gatherConsole.push(['unhandled', String(ev.reason)]));
  })()`,
});

await send('Page.bringToFront');
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&simidle=1&seed=4242&res=800`, fail });
await applyShipDefaults(evaluate);
await evaluate(`__sdfGame.teleport(${JSON.stringify(Number(ROOM))})`);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); return 1; })()');
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
// The fire flicker runs off wall-clock performance.now() INSIDE the draw path,
// which the render lock does not freeze (sdf-demo-hash.mjs:139-144). Pin it, or
// two runs of a frozen scene differ at sub-LSB level for a reason that has
// nothing to do with the gather.
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
// The static probe grid bakes in a worker; measuring before it lands captures a
// different lighting state entirely.
let probesReady = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { probesReady = true; break; }
  await sleep(500);
}
if (!probesReady) fail('roomProbesReady never landed');
// Settle transients with the sim LIVE (~90 frames for head-bob and the weapon
// spring), THEN lock: with simLocked, tick() mutates nothing (game-main.ts
// :4344) while the draw — and therefore the gather — still runs, so every
// dispatch below reads identical inputs and the only thing moving is the
// afterglow blend. `?frozen=1` already froze the wanderers from frame 0, which
// is what makes the settled state itself reproducible.
await evaluate('(() => { __sdfGame.step(90); return 1; })()');
if (CROWD > 0) await evaluate(`__sdfGame.spawnCrowd('zombie', ${CROWD}, { spacing: 1.2 })`);
if (FLASH) {
  const fired = await evaluate(`(() => {
    __sdfGame.setRenderLock(false);
    const fired = __sdfGame.fire(1);
    __sdfGame.step(1);
    return fired;
  })()`);
  if (!fired) fail('requested muzzle flash did not fire');
}
await evaluate('(() => { __sdfGame.freeze(true); __sdfGame.setRenderLock(true); return __sdfGame.renderLock; })()');
// TRAP 5, for the gather: THE AFTERGLOW MAKES A CROSS-BOOT READING MEANINGLESS.
// With the shipped blend (0.6) each record is `mix(previous record, this
// frame's estimate, rate)`, so the buffer depends on HOW MANY FRAMES the run
// dispatched before the read — which is boot timing, not the gather. Two boots
// of the SAME build therefore disagree for a legitimate reason (measured: the
// first two runs of this tool differed at every ray count). With blend 1 the
// record IS this frame's estimate: a pure function of the frame's inputs, so
// two runs at the same state must agree byte for byte, which is what makes a
// mis-reduced probe or a scratch/fold race measurable at all.
await evaluate('(() => { __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
const pinned = await evaluate('(() => __sdfGame.probeCostSplit)()');
if (pinned?.blend !== 1 || pinned?.fall !== 1) {
  fail(`the afterglow is still in the measurement (blend=${pinned?.blend} fall=${pinned?.fall}, both must be 1)`);
}

/**
 * One reading. `step(2)` before each read = exactly one gather dispatch at
 * probeGatherRate 2, then the readback.
 *
 * The digest is FNV-1a over the f32 bit patterns in little-endian byte order —
 * the same algorithm family as `frame-hash.ts`'s `fnv1aFloats`, recomputed here
 * because this file must run against a build that may predate it.
 */
const READ = `(async () => {
  __sdfGame.step(2);
  const dyn = await __sdfGame.probeDynReadback();
  const u = new Uint32Array(dyn.buffer, dyn.byteOffset, dyn.length);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < u.length; i++) {
    const b = u[i];
    h = Math.imul(h ^ (b & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((b >>> 8) & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((b >>> 16) & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((b >>> 24) & 0xff), 0x01000193) >>> 0;
  }
  let nonZero = 0, nonFinite = 0, maxAbs = 0, sum = 0;
  for (let i = 0; i < dyn.length; i++) {
    const v = dyn[i];
    if (!Number.isFinite(v)) nonFinite++;
    else if (v !== 0) { nonZero++; const a = Math.abs(v); if (a > maxAbs) maxAbs = a; sum += v; }
  }
  const gates = __sdfGame.probeDynamic?.gates ?? null;
  const frames = __sdfGame.probeDynamic?.frames ?? null;
  return {
    digest: h >>> 0,
    floats: Array.from(dyn),
    stats: { length: dyn.length, nonZero, nonFinite, maxAbs, sum },
    gates: gates ? { capsules: gates.capsules, lights: gates.lights, room: gates.room, dynOn: gates.dynOn, grid: gates.grid } : null,
    bound: __sdfGame.probeDynamic?.bound ?? null,
    frames,
  };
})()`;

const results = [];
for (const rays of RAYS) {
  if (OPTIMIZATION_AB) await evaluate('__sdfGame.setProbeOptimization(false)');
  // Pin the seam under test, then settle two dispatches so the reading is not
  // taken mid-transition from the previous ray count.
  await evaluate(`(() => { __sdfGame.setProbeRays(${rays}); __sdfGame.step(4); return 1; })()`);
  const first = await evaluate(READ);
  if (FLASH && !(first.gates?.lights > 1)) fail('muzzle-flash fixture has no additional probe light');
  const second = await evaluate(READ);
  if (!first || first.floats.length === 0) fail(`no probeDyn readback at rays=${rays} (gather unbound?)`);
  // ONE READING IS NOT ENOUGH, and here it is a hard gate rather than a note.
  // Blend 1 + a locked sim make the record a PURE function of the frame's
  // inputs, so two dispatches from the same state must agree BYTE FOR BYTE. A
  // scratch write that races the fold, a barrier in the wrong place, or a
  // workgroup reading another workgroup's slab all show up exactly here, as a
  // difference between two reads that had no right to differ — and nowhere
  // else: none of it is visible in the rendered frame except as lighting that
  // "looks a bit off", and vitest cannot see it at all.
  let changed = 0, maxDelta = 0, firstDiff = -1;
  for (let i = 0; i < first.floats.length; i++) {
    const d = Math.abs(first.floats[i] - second.floats[i]);
    if (d !== 0) { changed++; if (firstDiff < 0) firstDiff = i; }
    if (d > maxDelta) maxDelta = d;
  }
  if (changed !== 0) {
    fail(`rays=${rays}: two dispatches from the SAME locked state differ in ${changed}/${first.floats.length} floats `
      + `(max ${maxDelta.toExponential(3)}, first at float ${firstDiff} = probe ${Math.floor(firstDiff / 16)} ch ${firstDiff % 16}) `
      + `— with blend 1 nothing about the record depends on history, so this is a race or a mis-reduction, not drift`);
  }
  let optimization = null;
  if (OPTIMIZATION_AB) {
    await evaluate('(() => { __sdfGame.setProbeOptimization(true); __sdfGame.step(4); return 1; })()');
    const candidate = await evaluate(READ);
    const repeated = await evaluate(READ);
    const changedIndices = first.floats.flatMap((x, i) => Object.is(x, candidate.floats[i]) ? [] : [i]);
    const repeatChanged = candidate.digest !== repeated.digest || candidate.floats.some((x, i) => !Object.is(x, repeated.floats[i]));
    const inputsEqual = JSON.stringify(first.gates) === JSON.stringify(candidate.gates);
    optimization = { referenceDigest: first.digest, candidateDigest: candidate.digest,
      changed: changedIndices.length, repeatChanged, inputsEqual };
    if (first.digest !== candidate.digest || changedIndices.length || repeatChanged || !inputsEqual || candidate.stats.nonFinite) {
      if (OUT) writeFileSync(`${OUT}.mismatch.json`, JSON.stringify({ rays, optimization, first, candidate, repeated }));
      fail(`optimization rays=${rays}: ${JSON.stringify(optimization)}`);
    }
    console.log(`optimization rays=${rays}: bit-identical, repeated candidate stable, matched inputs`);
  }
  results.push({
    optimization,
    rays, digest: first.digest, digest2: second.digest,
    repeat: { changed, maxDelta, identical: true },
    stats: first.stats, gates: first.gates, bound: first.bound, frames: first.frames,
    floats: first.floats,
  });
  console.log(`rays=${String(rays).padStart(2)}  digest=${first.digest.toString(16).padStart(8, '0')}  `
    + `2nd=${second.digest.toString(16).padStart(8, '0')}  `
    + `nonzero=${String(first.stats.nonZero).padStart(4)}/${first.stats.length}  `
    + `maxAbs=${first.stats.maxAbs.toExponential(3)}  `
    + `repeatIdentical=${changed === 0}  `
    + `caps=${first.gates?.capsules ?? '?'} lights=${first.gates?.lights ?? '?'}`);
}

// Leave the seams as the harness expects to find them (scripts/sdf-game-bench.mjs
// pins the same three at the top of every leg).
await evaluate('(() => { __sdfGame.setProbeRays(null); __sdfGame.setProbeBlend(null); __sdfGame.setProbeFall(null); return 1; })()');
const timing = [];
if (argv.includes('--timing-ab')) {
  // applyShipDefaults above is the historical native-march parity fixture.
  // Timing must restore today's half-resolution shipped upscaler input.
  const upscale = await evaluate(`(() => { __sdfGame.setSdfScale(0.5); __sdfGame.setHullExitBound(false); return __sdfGame.upscaleInfo(); })()`);
  if (!upscale.on || upscale.inSize.width !== 400 || upscale.inSize.height !== 300) fail('timing fixture is not the shipped upscaler scale');
  for (let rep = 0; rep < 4; rep++) for (const optimized of rep % 2 ? [true, false] : [false, true]) {
    const sample = await evaluate(`(async () => {
      const g = __sdfGame;
      g.setProbeOptimization(${optimized}); g.step(80); await g.resolveGpu(); await g.passTimings();
      const frames = [];
      // This parity harness pins performance.now for scene clocks. Use the
      // unmodified prototype method for elapsed wall time.
      const now = Performance.prototype.now.bind(performance);
      for (let i = 0; i < 100; i++) {
        const t = now(); g.step(1); await g.resolveGpu(); frames.push(now() - t);
      }
      const p = await g.passTimings();
      return { frames, gather: p.samples.filter(s => s.label === 'compute:probe-gather').map(s => s.ms), gates:g.probeDynamic.gates, hidden:document.hidden };
    })()`);
    if (sample.hidden || !sample.gather.length || sample.frames.every(t=>t<=0)) fail('invalid timing sample');
    const med = a => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
    timing.push({ rep, optimized, upscale, ...sample });
    console.log(`timing rep${rep} optimized=${optimized}: frame ${med(sample.frames).toFixed(3)} ms, gather ${med(sample.gather).toFixed(4)} ms`);
  }
}

// THE GATHER MUST ACTUALLY HAVE RUN. A kernel that fails to compile, or a
// dispatch of zero workgroups, leaves the buffer at its initial value: all
// zeros. A digest of that is stable, reproducible and completely meaningless, so
// it is checked explicitly rather than read as a pass.
const dispatchFrames = results.map(r => r.frames);
const advanced = dispatchFrames.every((f, i) => i === 0 || (f ?? 0) > (dispatchFrames[i - 1] ?? -1));
const anyRadiance = results.some(r => r.rays > 0 && r.stats.maxAbs > 0);
const finite = results.every(r => r.stats.nonFinite === 0);
console.log(`\ngather bound=${results[0]?.bound}  dispatch frames ${dispatchFrames.join(' -> ')}  `
  + `advanced=${advanced}  anyRadiance=${anyRadiance}  allFinite=${finite}`);
if (!advanced) fail('the gather never dispatched (probeDynamic.frames did not advance) — a digest of an untouched buffer is not evidence');
if (!anyRadiance) fail('every readback is identically zero — the kernel ran but wrote nothing');
if (!finite) fail('the readback contains non-finite values');

const consoleEvents = await evaluate('(() => window.__gatherConsole ?? [])()').catch(() => []);
const problems = consoleEvents.filter(([kind, text]) => kind !== 'warning'
  || /TSL|WGSL|Tint|pipeline|shader|deliberately/i.test(String(text)));
console.log(`console errors/problems: ${problems.length}`);
for (const [kind, text] of problems.slice(0, 20)) console.log(`  [${kind}] ${String(text).slice(0, 300)}`);

const payload = {
  label: LABEL, optimizationAB: OPTIMIZATION_AB, room: Number(ROOM), at: new Date().toISOString(), probesReady,
  dispatchFrames, advanced, anyRadiance, finite,
  timing,
  consoleProblems: problems.map(([k, t]) => [k, String(t).slice(0, 400)]),
  results: results.map(r => ({ ...r, floats: undefined })),
  floats: Object.fromEntries(results.map(r => [r.rays, r.floats])),
};
if (OUT) { writeFileSync(OUT, JSON.stringify(payload)); console.log(`wrote ${OUT}`); }

/**
 * Numeric diff of two dumped runs, per ray count. A DIGEST CANNOT DO THIS JOB:
 * an ulp-level FMA difference and a dropped probe both "differ". Reported per
 * ray count: how many floats moved, the largest absolute and RELATIVE move, and
 * where the worst one is (probe index + channel), because the shape of the
 * damage says which fault it is — one probe is a mapping/lane bug, every probe
 * is a rate or divisor bug, and a uniform ulp everywhere is the compiler's
 * freedom to contract a multiply-add.
 */
function diffPayloads(ref, cur, labelRef, labelCur) {
  console.log(`=== ${labelCur} vs ${labelRef} (CROSS-BOOT: check the input gates before believing any of it) ===`);
  for (const r of cur.results) {
    const o = ref.results.find(x => x.rays === r.rays);
    if (!o) { console.log(`rays=${r.rays}: no reference row`); continue; }
    const a = ref.floats?.[String(r.rays)], b = cur.floats?.[String(r.rays)];
    if (!a || !b) { console.log(`rays=${r.rays}: no dumped floats in one of the two files`); continue; }
    let changed = 0, maxAbs = 0, maxRel = 0, worst = -1, rel1e6 = 0;
    for (let i = 0; i < b.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d !== 0) {
        changed++;
        const scale = Math.max(Math.abs(a[i]), Math.abs(b[i]), 1e-30);
        const rel = d / scale;
        if (rel > 1e-6) rel1e6++;
        if (rel > maxRel) { maxRel = rel; worst = i; }
      }
      if (d > maxAbs) maxAbs = d;
    }
    const sameGates = JSON.stringify(o.gates) === JSON.stringify(r.gates);
    const sameStructure = o.stats.nonZero === r.stats.nonZero;
    console.log(`rays=${String(r.rays).padStart(2)}  floats changed ${String(changed).padStart(4)}/${b.length}  `
      + `rel>1e-6: ${String(rel1e6).padStart(4)}  maxAbs ${maxAbs.toExponential(3)}  maxRel ${maxRel.toExponential(3)}  `
      + `nonzero ${o.stats.nonZero}${sameStructure ? '=' : '->'}${r.stats.nonZero}  `
      + `inputs ${sameGates ? 'IDENTICAL' : `DIFFER ${JSON.stringify(o.gates)} vs ${JSON.stringify(r.gates)}`}`
      + (worst >= 0 ? `  worst probe ${Math.floor(worst / 16)} ch ${worst % 16}` : '  (bit-identical)'));
  }
}

if (COMPARE) diffPayloads(JSON.parse(readFileSync(COMPARE, 'utf8')), payload, COMPARE, LABEL);
process.exit(problems.length ? 2 : 0);
