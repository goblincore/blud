// scripts/sdf-game-bench.mjs — the honest perf baseline for sdf-game.html.
//
// No-deps CDP, same plumbing as scripts/sdf-game.mjs. Drives __sdfGame.bench
// (see src/lab/sdf-zombie/webgpu/game-bench.ts) across a matrix of ablation
// legs and rooms, then a spike pass.
//
// THREE RULES THIS SCRIPT EXISTS TO ENFORCE:
//
//   1. LEGS ALTERNATE. Running leg A five times and then leg B five times
//      measures the thermal ramp as much as the change. A B A B A B does not.
//   2. LEGS RESET FIRST. Every leg re-applies ship defaults before its own
//      overrides, so a leg cannot inherit the previous one's state.
//   3. A HIDDEN PAGE IS AN INVALID RUN, not a fast one. A hidden page has no
//      swapchain texture, so the passes do nothing and the fence resolves to
//      ~0.065 ms — which reads as a 70x speedup. The harness counts hidden
//      frames; this script fails the run on any of them.
//   4. A RUN THAT STOPS MUST SAY SO. Nothing here waits forever: every CDP
//      round trip is bounded, a dead socket fails every outstanding wait, and
//      a wedged leg is abandoned so the rest of the matrix still runs. Every
//      completed leg is appended to bench-progress.jsonl as it lands, so an
//      aborted run keeps the legs it already measured. See FAILURE BUDGETS.
//
// Usage: LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game-bench.mjs
// (or scripts/sdf-game-bench.sh, which owns the vite + Chrome lifecycle)
//
// Exit code is non-zero if ANY leg-run failed, even though the reports are
// still written — a partial matrix must never be mistaken for a clean one.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { reportCensusDrift, reportFrameHashDrift } from './census-diff.mjs';

const VITE = Number(process.argv[2] ?? 5277);
const CDP = Number(process.argv[3] ?? 9277);
const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-game-bench';
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);
const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
// Room 5 (3 soldiers + 2 zombies) joins the default matrix 2026-09-09: it is
// the only room with soldiers and it had NEVER been benched, so every recorded
// figure predates the character whose cost the owner is asking about.
const ROOM_IDS = (process.env.BENCH_ROOMS ?? '1,2,3,4,5').split(',').map(Number);
// BENCH_PRELUDE — an optional JS expression evaluated in the page AFTER the
// leg's ship-defaults + overrides, right before any timing, so it always
// wins. One prelude per invocation; pair it with BENCH_LEGS to A/B a lever
// the static leg table does not model, e.g. perf round 2 task 9's sweep:
//   BENCH_LEGS=baseline BENCH_PRELUDE='__sdfGame.setOmega(0.6)' ...
// Results rows and meta record it, so a stored bench.json is never ambiguous
// about what state the page was in.
const PRELUDE = process.env.BENCH_PRELUDE ?? '';
// BENCH_CROWD=n — spawn n copies of the zombie type into the player's room
// after ship-defaults and before the leg overrides, so a crowd leg measures a
// populated room (the per-body baseline) instead of an empty one. Uses the
// `__sdfGame.spawnCrowd` seam added for the crowd-march work.
const CROWD = Number(process.env.BENCH_CROWD ?? 0);
// BENCH_CROWD_SPACING — grid pitch (metres) passed to `__sdfGame.spawnCrowd`.
// Perf 7f: copies spread on a floor grid centred on the room's spawn point so
// the bench measures bodies-in-a-room, not N stacked on the single spawn.
const CROWD_SPACING = Number(process.env.BENCH_CROWD_SPACING ?? 1.2);
const CROWD_PRELUDE = CROWD > 0
  ? `__sdfGame.spawnCrowd('zombie', ${CROWD}, { spacing: ${CROWD_SPACING} })`
  : '';
// BENCH_CROWD_MAX — hard ceiling on BENCH_CROWD. The 24-body crowd path hung
// the GPU for 330 s and corrupted the owner's display on 2026-09-14; this
// makes that failure mode a boot refusal instead of a display-corrupting run.
const CROWD_MAX = Number(process.env.BENCH_CROWD_MAX ?? 24);
// BENCH_FRAME_CAP_MS — the probe frame guard. Before each leg's real bench run
// a tiny `mode: 'passes'` probe returns a fenced frame p50; above this cap (or
// a 30 s evaluate timeout) the leg is ABORTED without the long run. A too-slow
// scene must fail fast and visibly, never hold the GPU.
const FRAME_CAP_MS = Number(process.env.BENCH_FRAME_CAP_MS ?? 250);
// BENCH_PASSES=1 — per-pass GPU timestamp attribution (gpu-pass-timing.ts).
// Runs the matrix in the harness's 'passes' mode: the same fence-per-chunk
// frame timing as throughput, PLUS every render/compute pass summed by its
// site label per frame. Writes passes.md / passes.json and SKIPS the spike
// pass. Pass durations are GPU pass time only (no CPU submit, no gaps), so
// their sum sits below the fenced frame — read SHARES, and read the gap.
const PASSES = process.env.BENCH_PASSES === '1';
// BENCH_QUERY — extra URL query appended to sdf-game.html, for levers gated
// on a page flag (the tile-culling playtest needs `tiles-playtest`).
const QUERY = process.env.BENCH_QUERY ?? '';
// ---------------------------------------------------------------------------
// FAILURE BUDGETS. Every wait in this script is bounded, because none of them
// used to be: send() had no timeout and no reject path, and nothing rejected
// the outstanding requests when the socket died. A CDP response that never
// arrived therefore wedged the harness forever with no diagnostic — observed
// 2026-09-09, 141 of 204 leg-runs done, then 19+ minutes of silence with
// Chrome alive at 1.3% CPU, CDP responsive and the page loaded. It never
// recovered and the whole run was lost.
//
//   SEND   one CDP request/response round trip. Generous by default, because
//          a bench evaluate legitimately blocks the page for a long time;
//          evaluate() raises it to the IN-PAGE timeout plus a grace margin so
//          the transport window always outlives the evaluation it carries.
//          (Runtime.evaluate's own `timeout` bounds evaluation inside the
//          page. It says nothing about delivery of the response, which is
//          exactly the wait that hung.)
//   LEG    one whole leg-run: boot + apply + bench + collect. Past this the
//          leg is abandoned and THE MATRIX CONTINUES — losing 1 leg beats
//          losing 203.
//   FAILS  consecutive leg failures tolerated. A wedged browser fails every
//          remaining leg and each failure costs a full LEG timeout, so past
//          this many in a row the run is over: write what completed and get
//          out rather than burning a CI budget on 60 more doomed legs.
const SEND_TIMEOUT_MS = Number(process.env.BENCH_SEND_TIMEOUT_MS ?? 120_000);
const SEND_GRACE_MS = Number(process.env.BENCH_SEND_GRACE_MS ?? 30_000);
const LEG_TIMEOUT_MS = Number(process.env.BENCH_LEG_TIMEOUT_MS ?? 420_000);
const MAX_CONSEC_FAILS = Number(process.env.BENCH_MAX_CONSEC_FAILS ?? 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
if (CROWD > CROWD_MAX) {
  fail(`BENCH_CROWD=${CROWD} exceeds BENCH_CROWD_MAX=${CROWD_MAX} — refusing to start. `
    + 'Raise BENCH_CROWD_MAX deliberately only after the frame guard is validated; '
    + 'the unbounded crowd overflow hung the GPU for 330 s on 2026-09-14.');
}

mkdirSync(OUT, { recursive: true });

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
// WHERE THE HARNESS IS RIGHT NOW. A timeout is only useful if it can name the
// leg/room/rep and phase that wedged; "it stopped" is what we had.
const progress = { rep: 0, leg: '-', room: '-', mode: '-', phase: 'startup' };
const where = () => `rep${progress.rep} ${progress.leg}/room${progress.room}/${progress.mode} [${progress.phase}]`;
const consoleTail = (n = 8) => (consoleEvents.slice(-n)
  .map((e) => `       [${e.type}] ${String(e.text).replace(/\s+/g, ' ').slice(0, 300)}`)
  .join('\n') || '       (no console output captured)');
/**
 * Print everything known about a stall or a failed leg, then let the caller
 * decide whether it is fatal. bootPage's failure path already printed the
 * console tail on a boot timeout; this is that idea applied to every wait.
 */
function diagnose(err) {
  console.error(`\n  !! ${err?.message ?? err}`);
  console.error(`     in flight: ${where()}`);
  console.error('     console tail:');
  console.error(consoleTail());
}
// Safety net: an unawaited rejection should print the same diagnostic rather
// than a bare stack trace with no idea which leg was running.
process.on('unhandledRejection', (e) => { diagnose(e); process.exit(1); });

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(p.timer);
    p.resolve(m);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
  // Ring buffer: only the tail is ever read, and a 200-leg run with a chatty
  // page would otherwise hold every line it ever printed.
  if (consoleEvents.length > 500) consoleEvents.splice(0, consoleEvents.length - 500);
};
// A DEAD SOCKET MUST FAIL EVERY OUTSTANDING WAIT, immediately. Without this,
// a dropped connection or a crashed renderer leaves every pending promise
// unsettled and the harness blocks until the heat death of the CI job.
// (Node's global WebSocket is an EventTarget, so these are addEventListener
// handlers, not the `ws.on(...)` of the npm `ws` package.)
let socketDead = null;
const killPending = (reason) => {
  socketDead ??= reason;
  const outstanding = [...pending.entries()];
  pending.clear();
  for (const [id, p] of outstanding) {
    clearTimeout(p.timer);
    p.reject(new Error(`${reason} while awaiting CDP ${p.method} (id ${id}) — ${where()}`));
  }
};
ws.addEventListener('close', (ev) => killPending(`CDP socket closed (code ${ev?.code ?? '?'})`));
ws.addEventListener('error', () => killPending('CDP socket error'));

/**
 * One CDP round trip, BOUNDED. Rejects with the method, the params and the
 * leg that was in flight, and clears its own `pending` entry so a late reply
 * cannot resolve a promise nobody is holding.
 */
const send = (method, params = {}, timeoutMs = SEND_TIMEOUT_MS) => new Promise((resolve, reject) => {
  if (socketDead) {
    reject(new Error(`${socketDead} — refusing to send CDP ${method} (${where()})`));
    return;
  }
  const id = ++seq;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(
      `CDP ${method} (id ${id}) never answered in ${(timeoutMs / 1000).toFixed(0)}s — ${where()}\n`
      + `     params: ${JSON.stringify(params).slice(0, 300)}`,
    ));
  }, timeoutMs);
  pending.set(id, { resolve, reject, timer, method, params });
  try {
    ws.send(JSON.stringify({ id, method, params }));
  } catch (e) {
    clearTimeout(timer);
    pending.delete(id);
    reject(new Error(`CDP ${method} could not be sent: ${e?.message ?? e} — ${where()}`));
  }
});
const evaluate = async (expression, timeoutMs = 300_000) => {
  // Transport window = in-page window + grace. The in-page `timeout` below
  // bounds evaluation; only the send() timeout bounds DELIVERY of the answer.
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  }, timeoutMs + SEND_GRACE_MS);
  if (r.result?.exceptionDetails) {
    // THROW, don't exit. A page exception is nearly always THIS leg's own
    // override (a renamed seam, a bad argument), and the other 203 legs are
    // still worth measuring — runLegGuarded records it as a leg failure and
    // the run continues. Global invariants (wrong backend, hidden frames)
    // still call fail() and take the whole run down, as they should.
    throw new Error(`page threw evaluating \`${expression.replace(/\s+/g, ' ').slice(0, 120)}\`: `
      + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  }
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: false,
});

const url = `http://localhost:${VITE}/sdf-game.html${QUERY ? `?${QUERY}` : ''}`;
console.log(`bench ${url}  (${W}x${H}, repeats=${REPEATS}, rooms=${ROOM_IDS.join(',')}${PRELUDE ? `, prelude: ${PRELUDE}` : ''})`);

/**
 * Load the page fresh.
 *
 * CALLED BEFORE EVERY RUN, and that is not paranoia — it is the fix for the
 * defect that made the 2026-08-31 matrix unreadable. Wounds, severed limbs and
 * collapsed bodies PERSIST on the page: run N inherits every crater run N-1
 * carved. The census caught it (room 3's walk segment opened at `wounds 20`,
 * carried over from room 2's run, with `bodies 0 -> 0` because the survivors
 * had been shot to pieces). Cost then depends on cumulative damage rather than
 * on the leg under test, and identical repeats spread by up to 583%.
 *
 * A reload costs ~10 s. Sharing one page across 76 runs costs the whole
 * measurement.
 */
async function bootPage(settleMs = 5000) {
  progress.phase = 'boot:navigate';
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url });
  progress.phase = 'boot:wait-for-__sdfGame';
  let backend = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (backend) break;
  }
  if (!backend) {
    // Leg-scoped for the same reason as the evaluate path above: the next leg
    // reloads from scratch and may well boot. MAX_CONSEC_FAILS stops the run
    // if it is really the browser that is gone.
    throw new Error('game page never booted (__sdfGame absent after 120s)');
  }
  if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu — a WebGL fallback bench means nothing here`);
  // Settle: let the boot loop render and the shaders finish compiling before
  // anything is timed. First-use pipeline stalls are real.
  progress.phase = 'boot:settle';
  await sleep(settleMs);
  return backend;
}

let backend;
try {
  backend = await bootPage();
} catch (e) {
  diagnose(e);
  fail('initial page boot failed — nothing can be benched');
}
console.log('backend: webgpu');

// ---------------------------------------------------------------------------
// The legs. Each is a named set of overrides applied on top of ship defaults.
// ---------------------------------------------------------------------------
const ALL_LEGS = {
  // The crowd A/B under a `?crowd=1` boot: baseline must explicitly turn the
  // crowd OFF or it would silently run the crowd path (the boot flag defaults
  // `setCrowd`), and the A/B would compare crowd against crowd.
  baseline: { setCrowd: false },
  // BLEED (bleeding-wounds, 2026-08-31) SHIPS ON, so baseline includes it;
  // this leg is the "before" column — setBleed(false) is pixel-identical to
  // the pre-feature page (the off-state parity gate proves that in pixels),
  // so the fire-segment delta between these legs IS the feature's cost.
  'bleed-off': { setBleed: false },
  // The shell march SHIPS ON as of 2026-08-31 (owner-passed; -40%/-54%).
  // baseline above therefore includes it; this leg measures what turning it
  // OFF costs — the ablation direction flipped with the default.
  'shell-off': { setShell: false },
  'occluder-off': { setOccluder: false },
  // Perf round 2 task 5b: the accumulated-depth gate SHIPS OFF (measured as
  // a net pass-structure loss at 3-4 bodies); this leg turns it ON — the
  // ablation direction of 'cone-on', not 'shell-off'.
  'depth-gate-on': { setDepthGate: true },
  'cone-on': { setCone: true },
  'fxaa-off': { setFxaa: false },
  'scale-0.7': { setSdfScale: 0.7 },
  'scale-0.5': { setSdfScale: 0.5 },
  // STEP-BUDGET SWEEP — the shell-march decision experiment. See
  // __sdfGame.setMarchSteps: the slope of cost against budget is what the
  // MISS pixels cost, and miss pixels are exactly what a bounded entry/exit
  // shell deletes. These legs degrade the image on purpose; they are a
  // measurement, not a config.
  'steps-96': { setMarchSteps: 96 },
  'steps-64': { setMarchSteps: 64 },
  'steps-48': { setMarchSteps: 48 },
  'steps-32': { setMarchSteps: 32 },
  'steps-24': { setMarchSteps: 24 },
  'steps-16': { setMarchSteps: 16 },
  // TILE-LIST LEGS — need BENCH_QUERY=tiles-playtest or setTiles is a no-op
  // (the controller is not `allowed` without the page flag). 'tiles-on' is
  // the existing per-tile group list; 'tiles-raycull' adds the per-ray
  // sphere compaction prototype at the march entry (march.wgsl.ts, tileCfg.x
  // == 2). Baseline is the cluster walk with tiles OFF, as shipped.
  'tiles-on': { setTiles: true },
  'tiles-raycull': { setTiles: true, setTileRayCull: true },
  // CROWD LEGS (2026-09-13, merged crowd march). Pair with BENCH_CROWD=n and
  // BENCH_QUERY='crowd=1'; baseline explicitly turns the crowd OFF (see the
  // baseline leg). `crowd-on` under a crowd=1 boot is already on, so
  // setCrowd(true) is a no-op and the BENCH_CROWD spawns (which run after these
  // overrides) attach to the crowd types.
  //
  // TILES EXPLICIT ON 'crowd-on' (perf 7f, 2026-09-14). The ship-defaults block
  // pins setTiles(false), so the boot's ?tiles-playtest is overridden before
  // the leg runs — 'crowd-on' with no setTiles was therefore the SAME
  // configuration as 'crowd-on-tiles-off' (verified on the page: boot enabled,
  // setTiles(false) -> false, setCrowd(true) -> still false). The intended A/B
  // is crowd tiles-on vs crowd tiles-off, so re-enable tiles here.
  'crowd-on': { setCrowd: true, setTiles: true, setCrowdDispatch: 'quad' },
  'crowd-on-tiles-off': { setCrowd: true, setTiles: false, setCrowdDispatch: 'quad' },
  // STAGE a-2 DISPATCH A/B (2026-09-14). 'crowd-quad' is the one-screen-quad
  // dispatch (the stage default); 'crowd-boxes' is the stage-a instanced proxy
  // boxes. 'crowd-on' above is kept as an alias of 'crowd-quad'.
  'crowd-quad': { setCrowd: true, setTiles: true, setCrowdDispatch: 'quad' },
  'crowd-boxes': { setCrowd: true, setTiles: true, setCrowdDispatch: 'boxes' },
  // GOO DENSITY LEVERS (pass attribution 2026-09-07: goo:density equals the
  // march once blood flies). Run with BENCH_PASSES=1 and read the
  // goo:density row. 'goo-density-off' is the diagnostic ceiling — a wrong
  // frame on purpose — that bounds what any lever can recover.
  'goo-dens-0.35': { setGooPerf: { densityScale: 0.35 } },
  'goo-dens-0.25': { setGooPerf: { densityScale: 0.25 } },
  'goo-dens-0.125': { setGooPerf: { densityScale: 0.125 } },
  'goo-cap-300': { setGooPerf: { particleCap: 300, areaPriority: true } },
  'goo-cap-150': { setGooPerf: { particleCap: 150, areaPriority: true } },
  'goo-mintexel-1': { setGooPerf: { minTexelRadius: 1 } },
  'goo-density-off': { setGooPerf: { passGate: { density: false } } },
  // PROBE GATHER CADENCE (2026-09-10). `probeGatherRate` SHIPS at 2 (every
  // other frame) and setProbeGatherRate clamps to 1..4, so this is a pure
  // cadence trade on what is now the #2 GPU pass (4-5 ms). READ IT CAREFULLY:
  // the pass-attribution row measures the cost of ONE gather, so it does NOT
  // move when only the frequency changes — the amortised saving only appears in
  // the FENCED FRAME p50, which needs a quiet machine to mean anything. These
  // legs exist so that trade can be priced with an alternated in-run A/B
  // instead of a cross-run guess. Baseline IS rate 2; 'probe-rate1' is the
  // every-frame diagnostic ceiling (the costliest cadence, not a lever).
  'probe-rate3': { setProbeGatherRate: 3 },
  'probe-rate4': { setProbeGatherRate: 4 },
  // PROBE GATHER COST SPLIT (2026-09-10). Both legs are WRONG FRAMES ON
  // PURPOSE — a diagnostic ceiling, like 'chunks-skip', not a lever. The split
  // they produce is the measurement that decides whether widening the gather's
  // dispatch (7 workgroups / 448 threads) or deleting its per-light shadow
  // sweep pays more. Before these the shadow share was an op-count MODEL.
  //   primary = probe-nolights - probe-norays
  //   shadow  = baseline       - probe-nolights
  'probe-norays': { setProbeRays: 0 },
  'probe-nolights': { setProbeLights: 0 },
  // PROBE-GATHER BUDGET CURVE (2026-09-10, after R1). R1 took
  // `compute:probe-gather` from 4.00 ms to 0.18 ms, which turns the gather from
  // a budget LINE into a knob that can be spent on quality — more lights, more
  // rays, more frequent updates. These legs price that spend on the shipped
  // workload. `setProbeLights` CAPS the frame's own list (lights are packed
  // strongest-first), so probe-lights1/2/4 are "the same frame with only the
  // first N lights gathered", and 'probe-nolights' above is the 0 end of the
  // same sweep. NOTE the legs are caps, so a scene that natively has fewer
  // lights than the cap measures the same thing twice — read the row together
  // with `__sdfGame.probeDynamic.gates.lights`.
  // RESOLUTION SCALE (2026-09-10). `setSdfScale` (0.2..1) scales the MARCH target:
  // 0.5 is a quarter of the marched pixels, 0.35 about an eighth. This is the
  // priced half of the temporal-accumulation idea — the scheme wants a low-res
  // march plus a jittered, reprojected history to reconstruct it, and these legs
  // measure what the low-res march is worth on its own (the reconstruction adds
  // cost back, so this is the CEILING, not the win). The ship defaults pin 1.0.
  'sdfscale-0.75': { setSdfScale: 0.75 },
  'sdfscale-0.5': { setSdfScale: 0.5 },
  'sdfscale-0.35': { setSdfScale: 0.35 },
  'probe-lights1': { setProbeLights: 1 },
  'probe-lights2': { setProbeLights: 2 },
  'probe-lights4': { setProbeLights: 4 },
  'probe-rays16': { setProbeRays: 16 },
  'probe-rays64': { setProbeRays: 64 },
  // MARCH ATTRIBUTION LEGS (2026-09-07: the march is the whole GPU frame and
  // grows 8 -> 19 -> 31 ms walk/fire/gib). Each prices one wound/chunk
  // mechanism against the shipped state. 'chunks-skip' is a diagnostic
  // ceiling (wrong frame on purpose); the rest are real levers or the old
  // values of levers that already shipped.
  'wstep-0.6': { setWoundStep: 0.6 },
  'wound-earlyout-off': { setWoundEarlyOut: false },
  'wound-cull-off': { setWoundCull: false },
  'chunks-skip': { setChunkPass: 'skip' },
  // The per-limb owner re-fold (march.wgsl.ts ~L1505): the one wound-path
  // mechanism never priced. OFF is a wrong frame on purpose.
  'owner-refold-off': { setOwnerRefold: false },
  // PER-RAY WOUND LIST (march.wgsl.ts, counts2.w): build the reachable wound
  // set once per pixel and fold only those. OFF is bit-identical, so this
  // leg prices the preload against the per-step full-wound fold.
  'wound-list-on': { setWoundList: true },
  // Bone tubes ON: skeleton drawn as instanced tubes in the polygon pass
  // instead of folded into the field inside wounds (bone-tubes, default OFF
  // pending the look verdict). Prices the inside-flesh rows the nearWound
  // gate opens.
  'bone-mesh-on': { setBoneMesh: true },
  // Bone-cluster sphere cull ON: one per-flesh-cluster sphere culls the
  // inside-flesh rows (bones/organs) before folding them inside wounds. The
  // spatially-culled alternative to bone-mesh-on — keeps the bones in the
  // field, recovers a fraction of the bone-mesh-on win (gib -25-30%).
  'bone-cull-on': { setBoneCull: true },
  // Bone-SEGMENT sphere cull ON: one sphere per rigid segment (skull / axial
  // BoneFrame / limb bone / organs) culls the inside-flesh rows. The finer
  // granularity the cluster verdict asked for — a chest pixel should skip
  // the pelvis, the skull and the shins.
  // Bone cull SHIPS 'segment' (2026-09-07); baseline includes it. These legs
  // are the ablations: 'bone-cull-off' = the pre-cull flat fold, 'bone-seg-on'
  // kept as an explicit no-op leg for scripts that name it.
  'bone-cull-off': { setBoneCullMode: 'off' },
  'bone-seg-on': { setBoneCullMode: 'segment' },
  // NEURAL UPSCALE legs (2026-09-12, the deferred P1 Task 6 cost gate, now on
  // trained weights). 'march-half' is the raw saving of a 0.5 march with NO
  // upscale (nearest, via the zero model); the trained legs load exports from
  // .upscale-models/<name>/ — a missing model leaves the stage OFF and the leg
  // silently measures march-half, so check `upscaleInfo().on` in the notes.
  'march-half': { setUpscale: { model: 'zero', layout: 'sp', inputs: 'rgb', seed: 1 } },
  'upscale-s8': { setUpscale: { trained: 's8-rgb-best' } },
  'upscale-s32': { setUpscale: { trained: 's32-rgb-best' } },
  'upscale-s32-rgbd': { setUpscale: { trained: 's32-rgbd-best' } },
  // Ship truth 2026-09-12 → 2026-09-13 was s32-rgbd + CAS 0.5; kept as an A/B leg. `upscale-ship` (the
  // current default, t16-rgb) is defined in the run-5b block below.
  'upscale-ship-s32-rgbd': { setUpscale: { trained: 's32-rgbd-best' }, setUpscaleSharpen: 0.5 },
  'upscale-s64-rgb': { setUpscale: { trained: 'v3-s64-rgb-best' } },
  // Needs the normal attachment: BENCH_QUERY=upscale=0&upscalenormals=1 (which also puts the MRT on
  // every other leg in that run — compare against THAT run's baseline, not another run's).
  'upscale-s64d-rgbn': { setUpscale: { trained: 'v3-s64d-rgbn-best' } },
  // RUN 5 (2026-09-13). Boot with BENCH_QUERY='upscale=0&upscalenormals=1&refine=1' so the normal
  // attachments AND the refine twins/targets exist; the ship-defaults block turns the refine pass OFF
  // (setRefine(false)) so 'upscale-r5-head' measures the run-4-style head alone and 'refine-on' /
  // 'upscale-r5-headr' add the pass. The headr model REQUIRES the pass on (its H1 binds refineN/refineC).
  'refine-on': { setRefine: true },
  'upscale-r5-head': { setUpscale: { trained: 'r5-s32-rgbn-head-int2' } },
  'upscale-r5-headr': { setRefine: true, setUpscale: { trained: 'r5-s32-rgbn-headr-int2' } },
  // RUN 5b (2026-09-13). Refine-band legs on the drop-trained headr model, plus the tracked
  // default (loaded from an untracked copy so a leg can name it) and the no-normals/no-head
  // default candidate for the "what ships" question.
  // SHIP TRUTH since 2026-09-13: t16-rgb (v3.2) + CAS 0.5 is the tracked default
  // (public/assets/lab/upscale/t16-rgb-v32.json); the untracked store carries the same export, which
  // is what this leg loads. 'upscale-ship-high' is `?graphics=high`: the run-5b refine head, refine
  // pass on, slim tail, boot-default medium band.
  'upscale-ship': { setUpscale: { trained: 't16-rgb-v32' }, setUpscaleSharpen: 0.5 },
  'upscale-ship-high': { setRefine: true, setRefineTail: 'slim', setUpscale: { trained: 'r5b-s32-rgbn-headr-drop-int2' }, setUpscaleSharpen: 0.5 },
  'upscale-t16-rgb': { setUpscale: { trained: 't16-rgb-v32' } },
  'upscale-r5b-headr': { setRefine: true, setRefineTail: 'slim', setUpscale: { trained: 'r5b-s32-rgbn-headr-drop-int2' } },          // band = boot default (medium)
  'upscale-r5b-headr-full': { setRefine: true, setRefineTail: 'full', setUpscale: { trained: 'r5b-s32-rgbn-headr-drop-int2' } },
  'upscale-r5b-headr-open': { setRefine: true, setRefineTail: 'slim', setRefineBand: { near: 0, far: 99 }, setUpscale: { trained: 'r5b-s32-rgbn-headr-drop-int2' } },  // every standing body refined
};
// BENCH_LEGS lets a validation pass run one leg without the whole matrix.
const LEGS = process.env.BENCH_LEGS
  ? Object.fromEntries(process.env.BENCH_LEGS.split(',').map((k) => [k, ALL_LEGS[k] ?? {}]))
  : ALL_LEGS;

async function applyLeg(name) {
  progress.phase = 'apply-leg';
  // Fall back to ALL_LEGS: the spike pass always runs 'baseline', which a
  // BENCH_LEGS filter may have excluded from the throughput matrix.
  const overrides = LEGS[name] ?? ALL_LEGS[name] ?? {};
  // Ship defaults first, so legs cannot contaminate each other.
  //
  // ✅ RESYNCED TO SHIP TRUTH (2026-09-10, resolving the audit below). Both pins
  // now match what the game actually runs: `setOccluderEnabled(false)` and
  // `GAME_HULL_EXIT_BOUND = 1` (game-main.ts). Before this, every delta the
  // harness produced was taken with one extra pass the game does NOT run and
  // with a march bound the game DOES have switched off — so the harness was
  // measuring a configuration that does not exist, which is the same failure
  // class as the two URL-default bugs that shipped this session.
  //
  // The reason the hull-exit pin was ever OFF ("= 1 FAILS render parity",
  // task 1b: background bodies vanish past a foreground hull) was root-caused
  // as scene fog on 2026-09-04, and the bound then shipped ON with a
  // bit-identical re-census on hits/rasterised/meanStepsHit. The pin was simply
  // never re-synced afterwards.
  //
  // CONSEQUENCE FOR OLD NUMBERS: stored bench.json files taken before this
  // change were measured in the OLD configuration. They remain internally
  // consistent (every leg in one run shared it) but are NOT comparable to a run
  // from now on. Tag them in dev-notes rather than mixing the two.
  //
  // The BENCH_PRELUDE workaround is no longer needed:
  //   BENCH_PRELUDE='__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'
  // (that prelude is now a no-op; it is kept in older notes for provenance).
  await evaluate(`(() => {
    // ANY NEW SEAM A LEG CAN SET MUST BE RESET HERE. The 2026-09-10 probe-gather
    // legs were added WITHOUT this, and the omission silently corrupted two
    // runs: 'probe-norays' (last in the order) left rays=0 for the NEXT rep's
    // baseline, so the pass-attribution median landed on 0.01 ms for every leg
    // including baseline — which reads as "the gather is free" rather than as
    // "the harness is lying". Same class as the pin bug above. If a leg sets it,
    // pin it.
    __sdfGame.setProbeGatherRate(2);
    __sdfGame.setProbeRays(null);
    __sdfGame.setProbeLights(null);
    __sdfGame.setProbeBlend(null);   // R1 verification seams (?dynblend / ?dynfall);
    __sdfGame.setProbeFall(null);    // shipped 0.6 rise / 0.12 fall
    __sdfGame.setTemporalAccum(false);   // accumulation ships OFF (2026-09-10)
    __sdfGame.setOccluder(false);   // ship truth (game-main.ts: setOccluderEnabled(false))
    __sdfGame.setCone(false);
    __sdfGame.setFxaa(true);
    // Run 5 refine pass: pin OFF like every other seam a leg can set — but only
    // when the boot actually allocated the refine twins/targets (?refine=1), since
    // setRefine throws on an unallocated page and most runs never pass that flag.
    if (__sdfGame.refineInfo && __sdfGame.refineInfo().allocated) __sdfGame.setRefine(false);
    __sdfGame.setUpscale(null);   // upscale legs set it; pin. NOTE (2026-09-12): the GAME now boots
    // WITH the s32-rgbd stage + sharpen by default, so 'baseline' here is the pre-stage native march, NOT
    // ship truth. A ship leg loading public/assets/lab/upscale/s32-rgbd-best.json is the follow-up (TASKS.md).
    __sdfGame.setSdfScale(1.0);
    __sdfGame.setAdaptive(false);
    __sdfGame.setMarchSteps(96);
    __sdfGame.setShell(true);
    __sdfGame.setRelax(1.0);
    __sdfGame.setBleed(true);
    // Perf round 2 task 5b: the depth gate DEFAULTS OFF (its pass structure
    // measured as a net loss at 3-4 bodies — see game-main.ts). Pinned here
    // so legs cannot inherit state; the 'depth-gate-on' leg is the A/B.
    // SHIP TRUTH: GAME_HULL_EXIT_BOUND = 1 in game-main.ts. The old pin held it
    // OFF on the grounds that it "FAILS render parity" (task 1b); that was
    // root-caused as scene fog on 2026-09-04 and the bound shipped ON. See the
    // audit note above — and note that a bench measuring a config the game does
    // not run is the bug, not the pin being "conservative".
    __sdfGame.setHullExitBound(true);
    // Tiles ship OFF (playtest-gated); pinned so the tile legs are the A/B.
    __sdfGame.setTiles(false);
    __sdfGame.setTileRayCull(false);
    // Wound levers at the GAME's shipped state (game-main.ts GAME_* consts:
    // near-wound step 1.0, early-out on, union-reach cull on).
    __sdfGame.setWoundStep(1.0);
    __sdfGame.setWoundEarlyOut(true);
    __sdfGame.setWoundCull(true);
    __sdfGame.setOwnerRefold(true);
    __sdfGame.setWoundList(false);
    __sdfGame.setBoneMesh(false);
    __sdfGame.setBoneCullMode('segment');
    // Chunk pass: split ONLY in passes mode, so the timer can label chunks;
    // every other mode benches the shipped single pass.
    __sdfGame.setChunkPass(${JSON.stringify(PASSES ? 'split' : 'merged')});
    // Goo perf seams at their shipped state (goo-layer.ts defaults).
    __sdfGame.setGooPerf({ densityScale: 0.5, particleCap: 1000, minTexelRadius: 0, areaPriority: false, splatFadeTail: 0, surfaceAtDensityRes: false, passGate: { density: true, blur: true, surface: true } });
    return 1;
  })()`);
  // Apply the leg's overrides FIRST, so a rebuild-inducing override
  // (setCrowd) settles before the crowd prelude below. The crowd seam is
  // present since Task 6; the guard remains for a page without it.
  for (const [fn, arg] of Object.entries(overrides)) {
    if (fn === 'setCrowd' && !(await evaluate('typeof __sdfGame.setCrowd === "function"'))) continue;
    await evaluate(`__sdfGame.${fn}(${JSON.stringify(arg)})`);
  }
  // BENCH_CROWD — spawn AFTER the leg overrides. Rebuild-inducing overrides
  // (setCrowd(false) on the baseline leg) wipe spawnDebugCharacter's actors, so
  // spawning BEFORE them would leave the per-body baseline with the default
  // cast while the crowd leg kept its N — a dishonest A/B. Spawning last gives
  // both legs the same N bodies, and a leg's own overrides are still in force
  // when the bodies are built.
  if (CROWD_PRELUDE) { progress.phase = 'crowd-prelude'; await evaluate(CROWD_PRELUDE); }
}

// Warmup is deliberately long. Switching a leg reallocates render targets
// (a scale change) and rebuilds pipelines, and 40 frames does not absorb it —
// the first smoke run put that cost squarely in the walk segment and made
// every leg's walk column its own setup cost. 120 frames is two seconds.
const WARMUP = Number(process.env.BENCH_WARMUP ?? 120);
// Small chunks so a segment yields enough samples for a percentile to mean
// anything. 120 frames / 10 = 12 samples per segment; at the old 20 the p95
// index landed on the last element, i.e. it WAS the max.
const CHUNK = Number(process.env.BENCH_CHUNK ?? 10);

async function runLeg(name, room, mode) {
  progress.leg = name; progress.room = room; progress.mode = mode;
  // Fresh page per run — see bootPage. Damage does not survive a reload,
  // which is the entire point.
  await bootPage(2500);
  await applyLeg(name);
  // Verification note: what the page actually loaded, not what the leg asked for
  // (a missing/failed model load leaves the stage OFF and silently measures the
  // wrong thing — see the upscale-legs comment above ALL_LEGS).
  const infoNote = await evaluate(
    `JSON.stringify({ up: __sdfGame.upscaleInfo ? __sdfGame.upscaleInfo().on : null, ` +
    `refine: __sdfGame.refineInfo ? __sdfGame.refineInfo().on : null })`,
  );
  console.log(`  [${name}] upscaleInfo().on=${JSON.parse(infoNote).up} refineInfo().on=${JSON.parse(infoNote).refine}`);
  // run 5b: bodies-refined count + band, for legs that touch setRefineBand/setRefineTail.
  const legOverrides = LEGS[name] ?? ALL_LEGS[name] ?? {};
  if (/refine/i.test(name) || legOverrides.setRefine || legOverrides.setRefineBand || legOverrides.setRefineTail) {
    const bandNote = await evaluate(
      `JSON.stringify({ bodies: __sdfGame.refineInfo ? __sdfGame.refineInfo().bodies : null, ` +
      `band: __sdfGame.refineInfo ? __sdfGame.refineInfo().band : null, ` +
      `tail: __sdfGame.refineInfo ? __sdfGame.refineInfo().tail : null })`,
    );
    console.log(`  [${name}] refineInfo().bodies=${bandNote}`);
  }
  if (PRELUDE) { progress.phase = 'prelude'; await evaluate(PRELUDE); }
  const label = `${name}/room${room}/${mode}`;
  // FRAME GUARD (perf 7d). A tiny probe BEFORE the real run: the smallest
  // accepted warmup/chunk, 'passes' mode, a 30 s CDP evaluate timeout. Its
  // fenced frame p50 decides whether the scene is safe to bench at all. A
  // probe that times out or reads over BENCH_FRAME_CAP_MS aborts the leg and
  // SKIPS the long run — the honest early-out for the 24-body hang class.
  progress.phase = 'probe';
  let probe;
  try {
    probe = await evaluate(
      `__sdfGame.bench({ room: ${room}, mode: "passes", warmup: 4, chunkFrames: 2, label: ${JSON.stringify(`${label}-probe`)} })`,
      30_000,
    );
  } catch (e) {
    return { aborted: 'frame-cap', probeP50: null, error: `probe evaluate failed after 30 s: ${e?.message ?? e}` };
  }
  const probeP50 = Number(probe?.overall?.p50 ?? Infinity);
  if (!(probeP50 <= FRAME_CAP_MS)) {
    return {
      aborted: 'frame-cap',
      probeP50: Number.isFinite(probeP50) ? probeP50 : null,
      error: `probe frame p50 ${Number.isFinite(probeP50) ? `${probeP50.toFixed(2)} ms` : 'unavailable'} > BENCH_FRAME_CAP_MS=${FRAME_CAP_MS}`,
    };
  }
  const opts = mode === 'spike'
    ? `{ room: ${room}, mode: "spike", warmup: ${WARMUP}, label: ${JSON.stringify(label)} }`
    : `{ room: ${room}, mode: ${JSON.stringify(mode)}, warmup: ${WARMUP}, chunkFrames: ${CHUNK}, label: ${JSON.stringify(label)} }`;
  progress.phase = 'bench';
  await evaluate(`__sdfGame.bench(${opts})`);
  progress.phase = 'collect';
  const raw = await evaluate('JSON.stringify(window.__gameBench)');
  const r = JSON.parse(raw);
  if (!r.valid) fail(`${label}: ${r.hiddenSteps} hidden frames — INVALID (a hidden page renders nothing)`);
  // A run that saw no bodies measured an empty room, whatever its timings say.
  const seen = Math.max(0, ...r.segments.flatMap((sg) => sg.census ? [sg.census.first.bodies, sg.census.last.bodies] : [0]));
  if (seen === 0) console.warn(`  WARN ${label}: census saw ZERO bodies — this run measured an empty room`);
  r.bodiesSeen = seen;
  // Crowd census for the stage-a bench table: attached/visible per type and
  // the tile-binding fallback count. Null on a per-body-only boot.
  const ci = await evaluate('typeof __sdfGame.crowdInfo === "function" ? JSON.stringify(__sdfGame.crowdInfo()) : "null"');
  r.crowdInfo = JSON.parse(ci);
  // Tiles state as actually applied (perf 7f): the crowd tiles-on/off columns
  // are only readable if each row states which mode it measured.
  r.tilesOn = await evaluate('typeof __sdfGame.tiles === "function" ? __sdfGame.tiles().enabled : null');
  return r;
}

// ---------------------------------------------------------------------------
// 1. THROUGHPUT MATRIX — the comparison numbers.
// ---------------------------------------------------------------------------
const results = [];
const failures = [];
// Probe-aborted legs (frame cap / timeout). Kept separate from `results` so
// the table/segment builders never see a row without segments; they still mark
// the run incomplete and force a non-zero exit.
const aborts = [];
// Set when the matrix stops before it has attempted every leg — the report has
// to distinguish "attempted and failed" from "never attempted at all".
let abandoned = null;

// INCREMENTAL RESULTS. bench.json / bench.md / passes.md are only written once
// the WHOLE matrix finishes, so before this file existed the 2026-09-09 stall
// at leg 141 of 204 threw away 140 perfectly good runs along with the bad one.
// Every completed leg is appended here the moment it lands. One small append
// per ~30 s leg is nothing next to the work being timed, and it makes any
// interrupted run recoverable:
//   jq -s '{ results: . }' /tmp/sdf-game-bench/bench-progress.jsonl
// The full result objects are identical to bench.json's `results` entries.
const PROGRESS_JSONL = `${OUT}/bench-progress.jsonl`;
writeFileSync(PROGRESS_JSONL, '');
const record = (row) => {
  results.push(row);
  try {
    appendFileSync(PROGRESS_JSONL, `${JSON.stringify(row)}\n`);
  } catch (e) {
    console.warn(`  WARN could not append ${PROGRESS_JSONL}: ${e?.message ?? e}`);
  }
};

/**
 * One leg-run, BOUNDED. A leg that makes no progress inside LEG_TIMEOUT_MS is
 * abandoned so the matrix can carry on without it.
 *
 * The abandoned promise gets its own catch: nothing awaits it any more, and
 * its eventual rejection (the send() behind it timing out, or the socket
 * dying) would otherwise take the process down through unhandledRejection.
 */
async function runLegGuarded(leg, room, mode) {
  const p = runLeg(leg, room, mode);
  p.catch(() => {});
  let timer;
  try {
    return await Promise.race([p, new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(
        `leg watchdog: ${leg}/room${room}/${mode} made no progress in `
        + `${(LEG_TIMEOUT_MS / 1000).toFixed(0)}s (raise BENCH_LEG_TIMEOUT_MS if legitimate)`,
      )), LEG_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const MODE = PASSES ? 'passes' : 'throughput';
let consecFails = 0;
matrix:
for (let rep = 0; rep < REPEATS; rep++) {
  progress.rep = rep;
  for (const leg of Object.keys(LEGS)) {
    for (const room of ROOM_IDS) {
      let r;
      try {
        r = await runLegGuarded(leg, room, MODE);
      } catch (e) {
        // ONE WEDGED LEG IS NOT A DEAD RUN. Report it loudly, drop it from the
        // tables, keep going — the remaining legs are still worth measuring.
        diagnose(e);
        failures.push({
          rep, leg, room, mode: MODE, phase: progress.phase, error: String(e?.message ?? e),
          consoleTail: consoleEvents.slice(-8),
        });
        consecFails += 1;
        if (socketDead) {
          abandoned = `${socketDead} — no browser left to bench`;
          console.error(`  !! ${abandoned}. Writing what completed.`);
          break matrix;
        }
        if (consecFails >= MAX_CONSEC_FAILS) {
          abandoned = `${consecFails} legs failed in a row (BENCH_MAX_CONSEC_FAILS=${MAX_CONSEC_FAILS})`;
          console.error(`  !! ${abandoned} — the browser is not coming back. Writing what completed.`);
          break matrix;
        }
        continue;
      }
      if (r.aborted) {
        const row = { rep, leg, room, mode: MODE, ...r };
        aborts.push(row);
        try { appendFileSync(PROGRESS_JSONL, `${JSON.stringify(row)}\n`); } catch (e) { console.warn(`  WARN could not append ${PROGRESS_JSONL}: ${e?.message ?? e}`); }
        console.warn(`  rep${rep} ${leg} room${room}: ABORTED (${r.aborted}) — ${r.error}`);
        consecFails = 0;
        continue;
      }
      consecFails = 0;
      record({ rep, leg, room, prelude: PRELUDE, ...r });
      process.stdout.write(`  rep${rep} ${leg} room${room}: median ${r.overall.p50.toFixed(2)} ms (max chunk ${r.overall.max.toFixed(2)})\n`);
      if (PASSES && r.passes) {
        if (!r.passes.available) console.warn(`  WARN ${leg}/room${room}: no pass samples — timestamp tracking absent?`);
        const top = Object.values(r.passes.overall.labels).slice(0, 4).map((l) => `${l.name} ${l.p50.toFixed(2)}`).join(', ');
        process.stdout.write(`      passes: ${top}\n`);
      }
    }
  }
}
progress.phase = 'matrix-done';
if (!results.length && !aborts.length) {
  console.error(`\nFAIL: no leg-run completed — nothing to report. ${failures.length} failure(s) above.`);
  process.exit(1);
}

// Median across repeats, not mean: one thermal outlier should not move the
// reported number.
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const table = [];
for (const leg of Object.keys(LEGS)) {
  for (const room of ROOM_IDS) {
    const rs = results.filter((r) => r.leg === leg && r.room === room);
    if (!rs.length) continue;
    // MEDIAN of chunk means, not p95. A throughput segment yields ~12
    // samples; a p95 over 12 is an order statistic one element from the top,
    // which is a max wearing a percentile's name. The spike pass below is
    // where p95 is answered, on real per-frame samples.
    const seg = (n) => med(rs.map((r) => r.segments.find((s) => s.name === n).p50));
    table.push({
      leg, room, bodies: room,
      overallP50: med(rs.map((r) => r.overall.p50)),
      overallMax: med(rs.map((r) => r.overall.max)),
      walkP50: seg('walk'), fireP50: seg('fire'), gibP50: seg('gib'),
    });
  }
}

// ---------------------------------------------------------------------------
// 2. SPIKE PASS — baseline only. NOT comparable to the table above: fencing
//    every frame drains the queue and lets the GPU clock down between frames.
//    Read the max/p50 RATIO, which is what says whether a moment blows up.
// ---------------------------------------------------------------------------
const spikes = [];
if (PASSES) writePassReport();
for (const room of PASSES ? [] : ROOM_IDS) {
  if (socketDead) {
    abandoned ??= `${socketDead} — no browser left for the spike pass`;
    break;
  }
  let r;
  try {
    r = await runLegGuarded('baseline', room, 'spike');
  } catch (e) {
    // Same rule as the matrix: a wedged spike room costs that room, not the
    // throughput tables that are already in hand.
    diagnose(e);
    failures.push({
      rep: 0, leg: 'baseline', room, mode: 'spike', phase: progress.phase,
      error: String(e?.message ?? e), consoleTail: consoleEvents.slice(-8),
    });
    continue;
  }
  if (r.aborted) {
    const row = { rep: 0, leg: 'baseline', room, mode: 'spike', ...r };
    aborts.push(row);
    try { appendFileSync(PROGRESS_JSONL, `${JSON.stringify(row)}\n`); } catch (e) { console.warn(`  WARN could not append ${PROGRESS_JSONL}: ${e?.message ?? e}`); }
    console.warn(`  spike room${room}: ABORTED (${r.aborted}) — ${r.error}`);
    continue;
  }
  spikes.push({ room, prelude: PRELUDE, ...r });
  process.stdout.write(`  spike room${room}: p50 ${r.overall.p50.toFixed(2)} max ${r.overall.max.toFixed(2)} ms\n`);
}

writeFileSync(`${OUT}/bench.json`, JSON.stringify({
  meta: {
    url, W, H, repeats: REPEATS, rooms: ROOM_IDS, backend, prelude: PRELUDE,
    when: new Date().toISOString(),
    // `complete: false` means legs are MISSING from every table below. Never
    // read a delta out of a partial matrix without checking this first.
    complete: failures.length === 0 && aborts.length === 0 && !abandoned,
    runsCompleted: results.length,
    abandoned,
    failures,
    aborts,
  },
  results, table, spikes,
}, null, 2));

const lines = [];
lines.push('');
if (failures.length || abandoned || aborts.length) {
  // Loudest thing in the report, first. A partial matrix that looks complete
  // is worse than no matrix at all.
  lines.push(`## INCOMPLETE RUN — ${failures.length} leg-run(s) failed, ${aborts.length} aborted, ${results.length} completed`);
  lines.push('');
  if (abandoned) {
    lines.push(`**The matrix was ABANDONED early: ${abandoned}.** Legs after the last`);
    lines.push('failure below were never attempted at all, so their absence is not a');
    lines.push('measurement — it is a gap.');
    lines.push('');
  }
  lines.push('Failed runs are ABSENT from every table below, so a leg may have fewer');
  lines.push('repeats than the header claims, or be missing entirely. Do not read a');
  lines.push('delta across a leg listed here without re-running it.');
  lines.push('');
  lines.push('| rep | leg | room | mode | phase | error |');
  lines.push('| ---: | --- | ---: | --- | --- | --- |');
  for (const f of failures) {
    lines.push(`| ${f.rep} | ${f.leg} | ${f.room} | ${f.mode} | ${f.phase} | ${f.error.replace(/\s+/g, ' ').slice(0, 200)} |`);
  }
  lines.push('');
  if (aborts.length) {
    lines.push('Aborted legs (probe frame p50 over BENCH_FRAME_CAP_MS, or the probe');
    lines.push('timed out) — the real run was SKIPPED to protect the GPU:');
    lines.push('');
    lines.push('| rep | leg | room | aborted | probe p50 ms | reason |');
    lines.push('| ---: | --- | ---: | --- | ---: | --- |');
    for (const a of aborts) {
      lines.push(`| ${a.rep} | ${a.leg} | ${a.room} | ${a.aborted} | ${a.probeP50 ?? 'n/a'} | ${String(a.error).replace(/\s+/g, ' ').slice(0, 200)} |`);
    }
    lines.push('');
  }
}
lines.push('## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats');
lines.push('');
lines.push('| leg | room | spawned | overall | walk | fire | gib | worst chunk |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const t of table) {
  lines.push(`| ${t.leg} | ${t.room} | ${t.bodies} | ${t.overallP50.toFixed(2)} | ${t.walkP50.toFixed(2)} | ${t.fireP50.toFixed(2)} | ${t.gibP50.toFixed(2)} | ${t.overallMax.toFixed(2)} |`);
}
lines.push('');
lines.push('## Repeatability — READ THIS BEFORE ANY DELTA');
lines.push('');
lines.push('Spread of the overall median across identical repeats. A leg whose');
lines.push('spread exceeds the delta you care about has not measured anything.');
lines.push('On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy');
lines.push('machine, which is why this section exists.');
lines.push('');
lines.push('| leg | room | reps (overall median ms) | spread | spread % of min |');
lines.push('| --- | ---: | --- | ---: | ---: |');
let worstSpreadPct = 0;
for (const leg of Object.keys(LEGS)) {
  for (const room of ROOM_IDS) {
    const rs = results.filter((r) => r.leg === leg && r.room === room);
    if (rs.length < 2) continue;
    const vals = rs.map((r) => r.overall.p50);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pct = ((hi - lo) / lo) * 100;
    worstSpreadPct = Math.max(worstSpreadPct, pct);
    lines.push(`| ${leg} | ${room} | ${vals.map((v) => v.toFixed(2)).join(' / ')} | ${(hi - lo).toFixed(2)} | ${pct.toFixed(0)}% |`);
  }
}
lines.push('');
lines.push(`**Worst repeat spread: ${worstSpreadPct.toFixed(0)}%.** Judge each delta`);
lines.push('against ITS OWN legs\' spread, not against this worst case — one noisy leg');
lines.push('does not invalidate a delta measured between two quiet ones. A delta smaller');
lines.push('than either leg\'s spread is UNRESOLVED, not zero.');
lines.push('');
lines.push('## Census — what was ON SCREEN while those numbers were taken');
lines.push('');
lines.push('A cost column is unreadable without this. Read `bodies` first: if it');
lines.push('falls through the run, the cheap segments were timing an empty room.');
lines.push('');
lines.push('| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |');
lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: |');
for (const room of ROOM_IDS) {
  // Prefer baseline, but fall back to ANY leg for this room — a BENCH_LEGS
  // filter can exclude baseline, and an empty census table is worse than a
  // census from a different leg (the scene is the same either way).
  const r = results.find((x) => x.leg === 'baseline' && x.room === room)
    ?? results.find((x) => x.room === room);
  if (!r) continue;
  for (const seg of r.segments) {
    if (!seg.census) continue;
    const { first: a, last: b } = seg.census;
    lines.push(`| ${room} | ${seg.name} | ${a.bodies}→${b.bodies} | ${a.wounds}→${b.wounds} | ${a.chunks}→${b.chunks} | ${a.droplets ?? '-'}→${b.droplets ?? '-'} | ${a.gooQuads ?? '-'}→${b.gooQuads ?? '-'} |`);
  }
}
lines.push('');
lines.push('## Spike (fenced per frame, baseline only) — ratios within a run ONLY');
lines.push('');
lines.push('| room | bodies | p50 | p95 | max | max/p50 | worst segment |');
lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | --- |');
for (const s of spikes) {
  const worst = [...s.segments].sort((a, b) => b.max - a.max)[0];
  lines.push(`| ${s.room} | ${s.room} | ${s.overall.p50.toFixed(2)} | ${s.overall.p95.toFixed(2)} | ${s.overall.max.toFixed(2)} | ${(s.overall.max / s.overall.p50).toFixed(1)}x | ${worst.name} (${worst.max.toFixed(1)} ms) |`);
}
lines.push('');

const report = lines.join('\n');
console.log(report);
writeFileSync(`${OUT}/bench.md`, report);
console.log(`wrote ${OUT}/bench.json and ${OUT}/bench.md`);
// THE WORKLOAD HALF OF REPEATABILITY (2026-09-10). The Repeatability section
// above covers machine noise; this covers the SCENARIO. If the same scripted leg
// drew a different number of bodies, or a different number of droplets were in
// flight, then the legs were not doing the same work and any delta between them
// is measuring the scenario rather than the change.
//
// It is not hypothetical: on the two runs committed in
// docs/dev-notes/2026-09-10-probe-gather-cost/ this reports 12 drifted fields,
// including room 4 `fire` ending with 2/4/3 bodies and 222/74/53 droplets across
// three repeats of the SAME leg. Run on the in-memory results rather than the
// written file so it covers both the passes mode (passes.json) and throughput
// mode (bench.json) with one path.
const censusDrift = reportCensusDrift('(this run, in-memory results)', { results });
if (censusDrift > 0) {
  console.error(`\n⚠ CENSUS DRIFT: ${censusDrift} field(s) differed between repeats of the same leg.`);
  console.error('  The workload was NOT identical, so cross-leg deltas from this run are suspect.');
  console.error('  Judge each delta against its own legs\' spread, and read the drift list above.');
  console.error('  This is the failure determinism stage 1 fixes — see');
  console.error('  docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md.');
}

// THE FRAME-LEVEL COMPANION (deterministic demo recordings stage 2). The census
// counts what the page CONTAINS; this digests what it RENDERS, and it catches
// the half the census is blind to — a zeroed probe layer or a mistranscribed
// shader changes no count. Both shipped on 2026-09-10 and were caught by the
// owner PLAYTESTING, which is the failure this report exists to end.
//
// It reports only when a leg actually hashed (the page supplies endHash); a
// silent absence is not a pass, and reportFrameHashDrift says so in words.
const frameHashDrift = reportFrameHashDrift('(this run, in-memory results)', { results });
if (frameHashDrift > 0) {
  console.error(`\n⚠ FRAME HASH DRIFT: ${frameHashDrift} layer(s) differed between repeats of the same leg.`);
  console.error('  The same leg RENDERED different frames, so no delta between those repeats is attributable.');
  console.error('  Read the activity stats above first — a layer that went to zero names its own cause.');
}

if (failures.length || abandoned || aborts.length) {
  console.error(`\nFAIL: ${failures.length} run(s) failed, ${aborts.length} aborted (frame cap), ${results.length} completed — the tables above are PARTIAL.`);
  if (abandoned) console.error(`      Matrix abandoned early: ${abandoned}. Remaining legs were never attempted.`);
  console.error(`      Completed runs are also in ${PROGRESS_JSONL} (one JSON object per line).`);
  process.exit(1);
}
// Drift does NOT fail the run by itself: it is a property of the SCENARIO, and a
// leg matrix is still worth reading for within-leg pass rows. It is reported
// loudly and it does change the exit code, so a scripted/CI caller notices.
process.exit(censusDrift > 0 || frameHashDrift > 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// PASS ATTRIBUTION REPORT (BENCH_PASSES=1). Per leg: one table, rows = pass
// labels, one column per room = median across repeats of the overall p50 of
// that pass's per-frame GPU time, with its share of the labelled total. The
// last rows are the labelled total, the fenced frame p50, and the GAP between
// them — CPU submit, inter-pass bubbles, and anything the timestamps cannot
// see. A large gap is itself a finding.
// ---------------------------------------------------------------------------
function writePassReport() {
  const out = [];
  out.push('# Per-pass GPU attribution');
  out.push('');
  out.push(`${W}x${H}, repeats=${REPEATS}, rooms=${ROOM_IDS.join(',')}${PRELUDE ? `, prelude: ${PRELUDE}` : ''}${QUERY ? `, query: ${QUERY}` : ''}`);
  out.push('');
  if (failures.length || abandoned || aborts.length) {
    if (abandoned) out.push(`**MATRIX ABANDONED EARLY: ${abandoned} — later legs were never attempted.**`);
    out.push(`**INCOMPLETE — ${failures.length} leg-run(s) failed and are absent below:** `
      + failures.map((f) => `rep${f.rep} ${f.leg}/room${f.room} (${f.phase})`).join(', '));
    if (aborts.length) out.push(`**${aborts.length} leg-run(s) aborted by the frame guard and skipped:** `
      + aborts.map((a) => `rep${a.rep} ${a.leg}/room${a.room} (probe p50 ${a.probeP50 ?? 'n/a'} ms)`).join(', '));
    out.push('');
  }
  out.push('Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,');
  out.push('all segments). Share = of the labelled total. Gap = fenced frame p50 minus');
  out.push('the labelled total: CPU submit, inter-pass bubbles, unlabelled work.');
  out.push('');
  const perSeg = {};
  for (const leg of Object.keys(LEGS)) {
    const rs = results.filter((r) => r.leg === leg && r.passes?.available);
    if (!rs.length) { out.push(`## ${leg}: NO PASS SAMPLES`); out.push(''); continue; }
    const allLabels = [...new Set(rs.flatMap((r) => Object.keys(r.passes.overall.labels)))];
    const labels = allLabels.filter((l) => !l.startsWith('cpu:'));
    const cpuLabels = allLabels.filter((l) => l.startsWith('cpu:'));
    const cell = (room, label) => {
      const xs = results.filter((r) => r.leg === leg && r.room === room && r.passes?.available)
        .map((r) => r.passes.overall.labels[label]?.p50 ?? 0);
      return xs.length ? med(xs) : 0;
    };
    const totals = Object.fromEntries(ROOM_IDS.map((room) => [room, labels.reduce((n, l) => n + cell(room, l), 0)]));
    const frameP50 = Object.fromEntries(ROOM_IDS.map((room) => {
      const xs = results.filter((r) => r.leg === leg && r.room === room).map((r) => r.overall.p50);
      return [room, xs.length ? med(xs) : 0];
    }));
    // Order labels by their cost in the LAST room (the busiest), largest first.
    const last = ROOM_IDS[ROOM_IDS.length - 1];
    labels.sort((a, b) => cell(last, b) - cell(last, a));
    out.push(`## ${leg}`);
    out.push('');
    out.push(`| pass | ${ROOM_IDS.map((r) => `room ${r} ms | share`).join(' | ')} |`);
    out.push(`| --- | ${ROOM_IDS.map(() => '---: | ---:').join(' | ')} |`);
    for (const l of labels) {
      out.push(`| ${l} | ${ROOM_IDS.map((room) => { const v = cell(room, l); const t = totals[room]; return `${v.toFixed(2)} | ${t > 0 ? (100 * v / t).toFixed(0) : '0'}%`; }).join(' | ')} |`);
    }
    // Per-label medians do not add: the "labelled total" is the sum of
    // medians (a share denominator), while the GPU SPAN row is the median of
    // per-frame first-start-to-last-end — the honest per-frame GPU time.
    const spanP50 = Object.fromEntries(ROOM_IDS.map((room) => {
      const xs = results.filter((r) => r.leg === leg && r.room === room && r.passes?.available).map((r) => r.passes.overall.span.p50);
      return [room, xs.length ? med(xs) : 0];
    }));
    out.push(`| **labelled total (sum of medians)** | ${ROOM_IDS.map((room) => `**${totals[room].toFixed(2)}** | 100%`).join(' | ')} |`);
    out.push(`| GPU span p50 (first start → last end) | ${ROOM_IDS.map((room) => `${spanP50[room].toFixed(2)} | `).join(' | ')} |`);
    out.push(`| fenced frame p50 | ${ROOM_IDS.map((room) => `${frameP50[room].toFixed(2)} | `).join(' | ')} |`);
    out.push(`| gap (frame − span) | ${ROOM_IDS.map((room) => `${(frameP50[room] - spanP50[room]).toFixed(2)} | ${frameP50[room] > 0 ? (100 * (frameP50[room] - spanP50[room]) / frameP50[room]).toFixed(0) : '0'}% of frame`).join(' | ')} |`);
    out.push('');
    if (cpuLabels.length) {
      // CPU side, per stepped frame: tick (sim) and draw (encode + submit)
      // totals, then the telemetry phases inside the tick. Phases overlap
      // nothing and nest inside cpu:tick; they do not add to a total.
      cpuLabels.sort((a, b) => cell(last, b) - cell(last, a));
      out.push(`CPU per frame (ms, median over repeats of p50):`);
      out.push('');
      out.push(`| cpu | ${ROOM_IDS.map((r) => `room ${r}`).join(' | ')} |`);
      out.push(`| --- | ${ROOM_IDS.map(() => '---:').join(' | ')} |`);
      for (const l of cpuLabels) out.push(`| ${l} | ${ROOM_IDS.map((room) => cell(room, l).toFixed(2)).join(' | ')} |`);
      out.push('');
    }
    // Per-segment view of the same leg, one line per segment: top three passes.
    out.push(`Per segment (top passes, room ${last}):`);
    out.push('');
    for (const segName of ['walk', 'fire', 'gib']) {
      const rows = results.filter((r) => r.leg === leg && r.room === last && r.passes?.available)
        .map((r) => r.passes.segments.find((s) => s.name === segName)).filter(Boolean);
      if (!rows.length) continue;
      const segLabels = [...new Set(rows.flatMap((s) => Object.keys(s.labels)))];
      const segCell = (l) => med(rows.map((s) => s.labels[l]?.p50 ?? 0));
      const ranked = segLabels.map((l) => [l, segCell(l)]).sort((a, b) => b[1] - a[1]);
      const tot = ranked.reduce((n, [, v]) => n + v, 0);
      perSeg[`${leg}/${segName}`] = ranked;
      const cen = results.find((r) => r.leg === leg && r.room === last)?.segments.find((s) => s.name === segName)?.census;
      const cenTxt = cen ? ` — droplets ${cen.first.droplets ?? '-'}→${cen.last.droplets ?? '-'}, goo quads ${cen.first.gooQuads ?? '-'}→${cen.last.gooQuads ?? '-'}` : '';
      out.push(`- **${segName}** (${tot.toFixed(2)} ms labelled${cenTxt}): ${ranked.slice(0, 5).map(([l, v]) => `${l} ${v.toFixed(2)}`).join(', ')}`);
    }
    out.push('');
  }
  out.push('## Repeatability (fenced frame p50 across repeats)');
  out.push('');
  out.push('| leg | room | reps | spread % of min |');
  out.push('| --- | ---: | --- | ---: |');
  for (const leg of Object.keys(LEGS)) {
    for (const room of ROOM_IDS) {
      const xs = results.filter((r) => r.leg === leg && r.room === room).map((r) => r.overall.p50);
      if (!xs.length) continue;
      const mn = Math.min(...xs), mx = Math.max(...xs);
      out.push(`| ${leg} | ${room} | ${xs.map((x) => x.toFixed(2)).join(' / ')} | ${mn > 0 ? (100 * (mx - mn) / mn).toFixed(0) : '0'}% |`);
    }
  }
  out.push('');
  const text = out.join('\n');
  console.log(text);
  writeFileSync(`${OUT}/passes.md`, text);
  writeFileSync(`${OUT}/passes.json`, JSON.stringify({
    meta: { url, W, H, repeats: REPEATS, rooms: ROOM_IDS, backend, prelude: PRELUDE, when: new Date().toISOString() },
    results, perSeg,
  }, null, 2));
  console.log(`wrote ${OUT}/passes.md and ${OUT}/passes.json`);
}
