// scripts/sdf-demo-hash.mjs — THE FRAME HASH, driver half.
//
// Deterministic demo recordings stage 2 (2026-09-10). Plan:
// docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md
//
// WHAT THIS IS FOR. It converts "needs a quiet machine and the owner's eyes"
// into "compare a number". Two of this project's own bugs shipped on
// 2026-09-10 and were caught by PLAYTEST rather than by a gate — the zeroed
// dynamic probe layer that rendered characters as BLACK SILHOUETTES, and the
// tracer-light slots that defaulted to 0. Both change rendered pixels and
// neither is visible to any CPU test. A per-frame hash of the march target and
// the gather's dynamic layer fails on the exact frame either ships.
//
// It is also the only available verification of the WGSL TRANSCRIPTION of that
// session's three gather optimisations (capsule cull, any-hit shadow, box-first
// reorder), which today are proven only against the CPU twin in
// probe-dynamic-cull.test.ts.
//
// MODES
//   ab        the primary check: record the SAME spec twice and compare. A
//             clean result is the proof that a frame is reproducible.
//   verify    compare a freshly recorded replay against a STORED recording —
//             the regression-gate use (a stored baseline is the gate).
//   negative  CONTROL ON THE CONTROL: prove the gate can fail. Re-records with
//             a deliberately different pre-roll state, which MUST diverge. A
//             gate that has never been seen to fail is not evidence.
//   record    write one recording, for use as a future baseline.
//
// HONEST LIMITS (read these before quoting a result):
//   - SAME BUILD, SAME GPU, SAME DRIVER ONLY. A hash compares bit patterns; it
//     will not survive a driver bump and must not be used across machines.
//   - It does NOT remove timing noise. Determinism makes both legs do the same
//     WORK; it cannot make the GPU run at the same SPEED. Millisecond A/Bs
//     still need a quiet machine. The two disciplines are complementary.
//   - It hashes the march target and the gather's dynamic layer, NOT the
//     composited screen. The shipped 'bodies' field style is interlaced, so
//     alternate frames carry held rows BY DESIGN and a screen hash would
//     differ between two correct frames. Screen-level hashing needs field
//     parity freeze plumbing first.
//
// Usage: LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-demo-hash.mjs ab
// (or scripts/sdf-demo-hash.sh, which owns the vite + Chrome lifecycle)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// The digest lives in scripts/lib/demo-digest.mjs so it can be unit-tested
// without executing this script's main body. See that file's header.
import { fnv1aBytes } from './lib/demo-digest.mjs';
// decodePng + hashPresented live in scripts/lib/ so they can be unit-tested
// without executing this script's main body (which opens Chrome).
import { hashPresented } from './lib/demo-presented.mjs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep, StageFail } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? process.argv[2] ?? 5277);
const CDP = Number(process.env.LAB_CDP_PORT ?? process.argv[3] ?? 9277);
const OUT = process.env.DEMO_HASH_OUT ?? '/tmp/sdf-demo-hash';
// The mode is the first non-numeric argument so the port-first invocation every
// other script in this repo uses keeps working.
const ARGV = process.argv.slice(2).filter((a) => !/^\d+$/.test(a));
const MODE = ARGV[0] ?? 'ab';
const SPEC_ARG = ARGV[1] ?? '';
const BASELINE = process.env.DEMO_HASH_BASELINE ?? ARGV[2] ?? '';

const W = 1280, H = 800;
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
// A recording is a long hand-stepped run: hashing reads ~1M floats per sampled
// frame, so a 120-frame spec sampled every 4 frames is minutes, not seconds.
setTimeout(() => { console.error('FAIL: watchdog (60 min)'); process.exit(3); }, 60 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

/** The recording spec. Everything that can change a frame is IN here, because a
 *  hash is only evidence next to the state that produced it. */
function loadSpec(arg) {
  const defaults = {
    name: 'default',
    room: 4,
    kind: 'firefight',
    frames: 96,
    every: 4,
    /** Frames stepped before recording, to settle boot transients (the same
     *  recipe every capture script in this repo uses: settle, then lock). */
    warmup: Number(process.env.DEMO_HASH_WARMUP ?? 90),
    /** Explicit camera pose, so the run does not depend on where the scenario's
     *  first teleport happens to leave the player. null = the scenario's own. */
    pose: null,
    /** Ship defaults pinned before the run (the bench's own pin set, minus the
     *  two the harness still gets wrong — see the perf handoff's "Bench
     *  discipline"). Overridable per run so a lever can be A/B'd. */
    prelude: '',
    /** Freeze the flicker clock. Default true: it is wall-clock by design and
     *  wobbles the level's point lights at sub-LSB level. */
    freezeClock: true,
    /** Step a LIVE simulation instead of recording re-renders of one settled
     *  instant. Default false — see demoScenario's own note: the sim path is
     *  not reproducible yet, so it hunts a bug rather than gating a change. */
    sim: false,
    /** Extra hashes of the FINAL frame position, each after its own step, to
     *  measure per-frame randomness with the boot state held fixed. Default 2:
     *  cheap, and the number that says which class of nondeterminism you have. */
    repeat: 2,
    /** Re-hashes of ONE position with no step between them. Default 2. If these
     *  differ, the nondeterminism is in the readback or in unwritten texels, not
     *  in anything the scene does between frames. */
    resample: 2,
    /** Also hash the PRESENTED canvas (the image the owner sees). Default true:
     *  it is the surface that actually matters, and it catches post-chain bugs the
     *  GPU layers cannot see. */
    presented: true,
  };
  if (!arg) return defaults;
  if (arg.endsWith('.json')) {
    return { ...defaults, ...JSON.parse(readFileSync(arg, 'utf8')) };
  }
  return { ...defaults, ...JSON.parse(arg) };
}

/** Ship defaults, pinned so two runs cannot inherit different state. Mirrors
 *  the bench's own reset block — the rule that came out of the 2026-09-10
 *  harness bug is that ANY seam a leg can set must be pinned. */
async function pinDefaults(evaluate, spec) {
  await applyShipDefaults(evaluate);
  // The two the bench harness still pins the WRONG way round (ship truth is
  // occluder OFF, hull-exit-bound ON). Pinned explicitly here so a recording
  // reflects the game rather than the harness.
  // NOTE: CDP's Runtime.evaluate is an EXPRESSION context — a bare `return` is
  // a SyntaxError there, so each of these is wrapped in an IIFE.
  await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); return 1; })()');
  if (spec.freezeClock) await evaluate('(() => { __sdfGame.setLightClockFrozen(true); return __sdfGame.lightClockFrozen; })()');
  if (spec.prelude) await evaluate(`(() => { ${spec.prelude}; return 1; })()`);
}

/** One recording run. A FRESH PAGE every run: damage, baked chunks and boot
 *  transients all persist otherwise, and a second run on a warm page would be
 *  measuring the page, not the spec. */
async function runOnce(conn, spec, label) {
  const { send, evaluate } = conn;
  await send('Page.bringToFront');
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1`, fail });
  await pinDefaults(evaluate, spec);
  // Pin the wall clock for the whole run. The frozen scene still ticks the fire
  // flicker off performance.now(), which jitters the frame at sub-LSB level
  // (measured 2026-09-05: ~19% of pixels differ between two same-state captures
  // 2.5 s apart, at d>0). setLightClockFrozen handles the lighting path; this
  // handles anything else still reading the clock.
  await evaluate('(() => { performance.now = () => 100000; return 1; })()');
  // WAIT FOR THE STATIC PROBE GRID BAKE. The room grids are gathered in a
  // module worker at boot and the reply lands on whichever frame it finishes, so
  // nothing else in this recipe pins WHEN it lands. Recording before it does
  // captures a different lighting state than recording after — an async race, not
  // a renderer fault, and one this recorder must not silently include.
  let baked = false;
  for (let i = 0; i < 240; i++) {
    baked = await evaluate('(() => __sdfGame.roomProbesReady())()') === true;
    if (baked) break;
    await sleep(500);
  }
  if (!baked) {
    // Refuse rather than record a lie: a probe grid that never lands means the
    // capture's lighting is the 1x1 fallback, which is a different scene.
    fail(`${label}: the static probe grid never finished baking (roomProbesReady stayed false for 2 min) — refusing to record a scene whose lighting is still settling`);
  }
  await evaluate('(() => { __sdfGame.setDemoHold(true); return __sdfGame.demoHold; })()');
  if (spec.pose) {
    const p = spec.pose;
    await evaluate(`(() => { __sdfGame.setPose(${p.x}, ${p.z}, ${p.yaw}, ${p.pitch ?? 0}); return 1; })()`);
  }
  // Settle BEFORE the hold, with the sim live: a teleport excites head-bob and
  // the weapon spring, and those transients decay over ~90 frames.
  await evaluate(`(() => { __sdfGame.step(${spec.warmup}); return 1; })()`);
  // Then FREEZE with the render lock, the way the close-up gates do: after
  // this, step(n) is n pure advances from a settled state.
  await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(true); return 1; })()');

  const record = await evaluate(
    `__sdfGame.demoScenario(${JSON.stringify({
      kind: spec.kind, room: spec.room, frames: spec.frames, every: spec.every,
      sim: spec.sim === true,
      repeat: spec.repeat ?? 0,
      resample: spec.resample ?? 0,
    })})`,
    30 * 60_000,
  );
  if (!record || !Array.isArray(record.hashes) || !record.hashes.length) {
    // Report WHAT came back, not just that it was wrong. A silent seam is the
    // failure this tool exists to catch, so it must not be one itself.
    fail(
      `${label}: demoScenario returned no hashes — the seam did not bind.\n` +
      `  returned: ${JSON.stringify(record)?.slice(0, 400)}`,
    );
  }
  // Prove the seam is LIVE rather than hashing an empty buffer: a layer that
  // reads all-zero is exactly the shipped regression, and a recording that
  // silently hashed nothing would report "identical" forever.
  const march = record.hashes[0].layers.marchTarget;
  if (!march || march.stats.nonZero === 0) {
    fail(`${label}: the march target hashed to nothing (nonZero ${march?.stats.nonZero}) — refusing to trust this recording`);
  }
  // PARITY: the recording is only comparable if every sample sits on the same
  // field parity. The shipped 'bodies' style marches alternate scanlines, so a
  // mixed-parity recording reports a divergence between two CORRECT frames.
  const parities = [...new Set(record.parity ?? [])];
  if ((record.parity ?? []).length > 1) {
    if (parities.length > 1) {
      fail(
        `${label}: the recording sampled BOTH field parities (${(record.parity ?? []).join(',')}).\n` +
        '  The interlaced field makes alternate frames differ by design, so this recording is not\n' +
        '  comparable to anything. Use an EVEN `every` (the default 4 is even).',
      );
    }
    console.log(`  ${label}: field parity ${parities[0]} on all ${record.parity.length} sample(s) — comparable.`);
  }
  if (Array.isArray(record.resampled) && record.resampled.length) {
    const march = record.resampled.map((r) => r.marchTarget?.hash);
    const dyn = record.resampled.map((r) => r.probeDyn?.hash);
    const same = (a) => a.every((h) => h === a[0]);
    console.log(
      `  ${label}: READBACK control (no step between): marchTarget ` +
      `${same(march) ? 'STABLE' : 'VARIES'} (${march.length} samples), probeDyn ` +
      `${same(dyn) ? 'STABLE' : 'VARIES'}`,
    );
  }
  if (Array.isArray(record.repeated) && record.repeated.length) {
    const march = record.repeated.map((r) => r.marchTarget?.hash);
    const dyn = record.repeated.map((r) => r.probeDyn?.hash);
    const same = (a) => a.every((h) => h === a[0]);
    console.log(
      `  ${label}: same-session control (parity held, 2 steps between): marchTarget ` +
      `${same(march) ? 'STABLE' : 'VARIES'} (${march.join(', ')}), probeDyn ` +
      `${same(dyn) ? 'STABLE' : 'VARIES'} (${dyn.join(', ')})`,
    );
  }
  // THE CAMERA IS PART OF THE FRAME'S IDENTITY. The march's body pixels are
  // cull-dependent (`updateVisibleActors` frustum + clearSight), so a camera
  // that settled even a hair differently between boots changes WHICH bodies are
  // marched — and the localisation below shows exactly the body region varying
  // while the level stays bit-identical. Logged, not hashed: a diagnostic.
  const cam = await evaluate('(() => { const c = __sdfGame.cameraWorld(); return c.map(v => +v.toFixed(6)); })()');
  console.log(`  ${label}: camera ${JSON.stringify(cam)}`);
  // THE PRESENTED FRAME (owner request, 2026-09-10). `frameHash` reads GPU
  // targets and answers "did the RENDERER change"; this answers "did the SCREEN
  // change". Everything downstream of the march — the interlaced field's held
  // rows, FXAA, the VHS pass with its own temporal blend and 60/24 Hz row-noise
  // hashes — is invisible to the former, so a bug in any of it needs this one.
  // 8-bit by construction: the canvas is premultiplied sRGB, so sub-LSB
  // differences do not exist here.
  let presented = null;
  if (spec.presented !== false) {
    const shot = await evaluate('(() => __sdfGame.presentedShot())()', 120_000);
    if (typeof shot === 'string' && shot.length > 0) {
      presented = hashPresented(shot);
      record.presented = presented;
      console.log(`  ${label}: presented ${presented.width}x${presented.height} hash ${presented.hash} nonZeroBytes ${presented.nonZeroBytes}`);
    } else {
      console.log(`  ${label}: presented shot UNAVAILABLE (no canvas) — skipping the screen-level hash`);
    }
  }
  console.log(`  ${label}: gather dispatches over the run: ${record.dispatches}`);
  console.log(
    `  ${label}: ${record.hashes.length} hashes over ${record.frames} frames ` +
    `(${record.ms} ms) · march ${march.width}x${march.height} nonZero ${march.stats.nonZero}` +
    (record.hashes[0].layers.probeDyn
      ? ` · probeDyn nonZero ${record.hashes[0].layers.probeDyn.stats.nonZero}`
      : ' · probeDyn ABSENT (gather not bound)'),
  );
  return { label, spec, record, fingerprint: fingerprint(spec, march, record) };
}

/** What a stored recording must match to be comparable at all: the instrument
 *  shape, the layer geometry, and the spec. A hash compared against a
 *  differently shaped instrument is a phantom divergence. */
function fingerprint(spec, march, record) {
  return {
    version: march ? 1 : 0,
    marchWidth: march?.width ?? 0,
    marchHeight: march?.height ?? 0,
    /** The gather's dispatch count over the recording. Recorded because it was
     *  ONCE used as a phase proxy and proved not to be one — kept as an
     *  observation, NOT as a gate: see `setDemoHold`'s note on the reset that
     *  made it negative. Do not compare on this. */
    dispatches: record?.seedIdle ?? 0,
    kind: spec.kind, room: spec.room, frames: spec.frames, every: spec.every,
    warmup: spec.warmup, pose: spec.pose, prelude: spec.prelude, sim: spec.sim === true,
  };
}

/** The comparison, on the SAME algorithm the page used. In-page hashes are
 *  compared as numbers; this only decides where they first differ. Kept here
 *  rather than imported so this script has no build step — the pure module is
 *  the tested implementation, and a divergence tool that is itself untested
 *  would just move the problem. */
/** The presented-frame comparison, which is NOT part of the layer diff: it is 8-bit
 *  screen data, not a GPU layer, and it is the one the owner can see. */
function presentedDiff(a, b) {
  const pa = a.record.presented, pb = b.record.presented;
  if (!pa || !pb) return null;
  if (pa.hash === pb.hash && pa.width === pb.width && pa.height === pb.height) return null;
  return { hashA: pa.hash, hashB: pb.hash, nonZeroA: pa.nonZeroBytes, nonZeroB: pb.nonZeroBytes };
}

function firstDivergence(a, b) {
  const n = Math.min(a.record.hashes.length, b.record.hashes.length);
  for (let i = 0; i < n; i++) {
    const fa = a.record.hashes[i], fb = b.record.hashes[i];
    const changed = [];
    for (const key of Object.keys(fa.layers)) {
      const la = fa.layers[key], lb = fb.layers[key];
      if (!lb) { changed.push(key); continue; }
      if (la.hash !== lb.hash || la.floats !== lb.floats) changed.push(key);
    }
    if (changed.length) {
      const detail = changed.map((key) => {
        const la = fa.layers[key], lb = fb.layers[key];
        const tilesA = fa.tiles[key] ?? [], tilesB = (fb.tiles[key] ?? []);
        const moved = tilesA.map((h, t) => (h === tilesB[t] ? -1 : t)).filter((t) => t >= 0);
        const statDelta = Object.keys(la.stats)
          .filter((k) => la.stats[k] !== lb.stats[k])
          .map((k) => `${k} ${la.stats[k]}→${lb.stats[k]}`);
        return `${key}${statDelta.length ? ` [${statDelta.join(', ')}]` : ''}${moved.length ? ` tiles ${moved.join(',')}` : ''}`;
      });
      return { frame: fa.frame, changed, detail };
    }
  }
  if (a.record.hashes.length !== b.record.hashes.length) {
    return {
      frame: n,
      changed: ['<recording-length>'],
      detail: [`frames ${a.record.hashes.length} vs ${b.record.hashes.length}`],
    };
  }
  return null;
}

const spec = loadSpec(SPEC_ARG);
if (!['ab', 'record', 'verify', 'negative'].includes(MODE)) {
  fail(`unknown mode '${MODE}' — expected ab | record | verify | negative`);
}
console.log(`sdf-demo-hash [${MODE}] → ${OUT}`);
console.log(`  spec: ${JSON.stringify({ name: spec.name, kind: spec.kind, room: spec.room, frames: spec.frames, every: spec.every, warmup: spec.warmup })}`);

const conn = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
conn.vite = VITE;

try {
  if (MODE === 'record') {
    const a = await runOnce(conn, spec, 'record');
    writeFileSync(`${OUT}/demo-${spec.name}.json`, JSON.stringify(a, null, 2));
    console.log(`OK: ${a.record.hashes.length} hashes → ${OUT}/demo-${spec.name}.json`);
    process.exit(0);
  }

  if (MODE === 'verify' || (MODE === 'ab' && BASELINE)) {
    const path = BASELINE || `${OUT}/demo-${spec.name}.json`;
    let stored;
    try { stored = JSON.parse(readFileSync(path, 'utf8')); }
    catch (err) { fail(`cannot read baseline ${path}: ${err.message}`); }
    const fresh = await runOnce(conn, spec, 'replay');
    if (JSON.stringify(stored.fingerprint) !== JSON.stringify(fresh.fingerprint)) {
      // Refuse rather than report: comparing across instrument shapes produces
      // a divergence that means nothing.
      fail(`fingerprint mismatch — the stored recording is not comparable.\n  stored ${JSON.stringify(stored.fingerprint)}\n  fresh  ${JSON.stringify(fresh.fingerprint)}`);
    }
    const d = firstDivergence(stored, fresh);
    const pd = presentedDiff(stored, fresh);
    writeFileSync(`${OUT}/verify.json`, JSON.stringify({ path, divergence: d, presented: pd, fresh }, null, 2));
    if (pd) {
      console.error(`FAIL: THE PRESENTED FRAME DIVERGED — hash ${pd.hashA} vs ${pd.hashB}`);
      console.error('  The GPU layers may agree while the SCREEN does not: the difference is downstream of them.');
      process.exit(1);
    }
    if (d) {
      console.error(`FAIL: REPLAY DIVERGED at frame ${d.frame} — ${d.detail.join('; ')}`);
      console.error(`  ${fresh.record.hashes.length} frames recorded, detail in ${OUT}/verify.json`);
      process.exit(1);
    }
    console.log(`OK: ${fresh.record.hashes.length}/${fresh.record.hashes.length} frames identical to ${path} — the frame is reproducible.`);
    process.exit(0);
  }

  if (MODE === 'negative') {
    // CONTROL ON THE CONTROL. A gate nobody has seen fail is not evidence, so
    // this mode makes it fail ON PURPOSE: the same spec, re-recorded with a
    // different pre-roll depth, which changes the simulation state at frame 0.
    // It must diverge, and at frame 0.
    //
    // WHAT THIS DOES AND DOES NOT PROVE. It proves the hash is live and
    // sensitive to the frame's content, and that the comparison reports the
    // first divergent frame. It is NOT a realistic visual regression — a
    // renderer-only bug that leaves sim state alone is the class that actually
    // shipped (the black silhouettes), and this control does not exercise that
    // path. Treat a green negative as "the gate is wired", not as "the gate
    // catches renderer bugs".
    const shifted = { ...spec, warmup: spec.warmup + 7 };
    const clean = await runOnce(conn, spec, 'control-a');
    const broken = await runOnce(conn, shifted, 'control-b (warmup +7)');
    const d = firstDivergence(clean, broken);
    writeFileSync(`${OUT}/negative.json`, JSON.stringify({ clean, broken, divergence: d }, null, 2));
    if (!d) {
      console.error('FAIL: the negative control did NOT diverge — the hash is not seeing the frame.');
      console.error('  A gate that cannot fail is not a gate. Do not trust a pass from this tool.');
      process.exit(1);
    }
    console.log(`OK: negative control diverged at frame ${d.frame} — ${d.detail.join('; ')}`);
    console.log('  (the gate is wired and sensitive; this is NOT evidence it catches renderer-only bugs)');
    process.exit(0);
  }

  // MODE 'ab' — the primary check. Two identical runs, fresh page each.
  const a = await runOnce(conn, spec, 'run A');
  const b = await runOnce(conn, spec, 'run B');
  const d = firstDivergence(a, b);
  writeFileSync(`${OUT}/ab.json`, JSON.stringify({ a, b, divergence: d }, null, 2));
  if (d) {
    console.error(`FAIL: TWO IDENTICAL RUNS DIVERGED at frame ${d.frame} — ${d.detail.join('; ')}`);
    console.error('  A replay is not yet reproducible. Fix that BEFORE trusting any A/B measured here.');
    console.error(`  Detail in ${OUT}/ab.json`);
    process.exit(1);
  }
  console.log(`OK: ${a.record.hashes.length}/${a.record.hashes.length} sampled frames identical across two fresh-page runs.`);
  console.log('  This is the reproducibility the bench needs: same work, frame for frame.');
  process.exit(0);
} catch (err) {
  if (err instanceof StageFail) fail(err.message);
  throw err;
}
