// scripts/views-smoke.mjs — the per-body-path pixel smoke for crowd stage (a)
// task 7c. The FPV hands, the chunk views and the hull refine all march their
// own record now; before this task each bound the zero-filled fallback record
// (`counts = 0`) and rendered an EMPTY field, invisibly.
//
// This script stages the standard close-up (march-hash.mjs's boot and pins),
// counts the march-target hit pixels (alpha < 1), then:
//   - spawns one synthetic meat-ball chunk in front of the staged body through
//     the REAL spawn path (__sdfGame.spawnTestChunk) and counts again;
//   - probes for a first-person SDF-hands seam and counts again if one exists.
//
// Output: ONE JSON line — { base, withHands, withChunk }. `withHands` is null
// when the page has no SDF hands view (sdf-game.html renders mesh
// goblin-arm.glb hands; the SDF `createHandsGpuView` is lab-only, see
// fpv-view.ts and lab-main.ts), in which case a note goes to stderr. The
// hands record is covered by fpv-view.test.ts instead.
//
// Run at commit A and commit B and compare: withChunk must INCREASE over base
// (a spawned chunk visible in the field). A withChunk equal to base means the
// chunk marched the empty fallback record.
//
// Env: LAB_VITE_PORT / LAB_CDP_PORT (default 5323 / 9323), VIEWS_SMOKE_QUERY
// (extra boot URL flags; pass `crowd=0` to exercise the per-body control after
// the task-8 default flip). Run inside scripts/lab-servers (see that file's header).
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
// VIEWS_SMOKE_QUERY — extra query flags appended to the boot URL (task-8
// default flip: `VIEWS_SMOKE_QUERY='crowd=0'` runs the per-body control).
const EXTRA_QUERY = process.env.VIEWS_SMOKE_QUERY ? `&${process.env.VIEWS_SMOKE_QUERY}` : '';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 6 min'); process.exit(3); }, 6 * 60_000).unref();

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({
  send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0${EXTRA_QUERY}`,
});
await evaluate('__sdfGame.setLoopRunning(false)');
await applyShipDefaults(evaluate);
await evaluate('__sdfGame.setFieldStyle("off")');
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
const staged = await stageCloseUp(evaluate, { room: 1 }, fail);
await evaluate('(() => { __sdfGame.setSdfScale(0.5); __sdfGame.step(6); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');

// readMarchTarget() steps one internal frame per call; two calls per logical
// capture lock the period-2 jitter parity (march-hash.mjs's discipline). Count
// hit pixels = alpha (NDC depth) < 1. The raw floats never leave the page.
const countHits = async () => {
  await evaluate('__sdfGameDebug.readMarchTarget()');
  const r = await evaluate('__sdfGameDebug.readMarchTarget()');
  const bytes = Buffer.from(r.rgba32f, 'base64');
  const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  let hits = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 1) hits++;
  return { hits, w: r.w, h: r.h };
};

const base = (await countHits()).hits;

// --- withHands -------------------------------------------------------------
// The shipped game page has no SDF hands seam: its first-person hands are the
// mesh goblin-arm.glb groups (game-main.ts 'fpv-hand-grip'/'fpv-hand-fore'),
// not createHandsGpuView. Probe for a hands seam anyway so this leg starts
// working the moment one exists.
const handsSeam = await evaluate(`(() => {
  const g = window.__sdfGame;
  if (typeof g.setHandsVisible === 'function') return 'setHandsVisible';
  if (typeof g.showHands === 'function') return 'showHands';
  return null;
})()`);
let withHands = null;
if (handsSeam) {
  await evaluate(`__sdfGame.${handsSeam}(true)`);
  await evaluate('(() => { __sdfGame.step(6); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  withHands = (await countHits()).hits;
} else {
  console.error('note: no SDF hands view in the game page (mesh hands); withHands = null (covered by fpv-view.test.ts)');
}

// --- withChunk -------------------------------------------------------------
// Spawn one stationary test chunk at the staged body's own position — right in
// front of the camera the coverage search just aimed at the body. The chunk
// path is the shared chunk material (createSharedChunkGpuMaterial).
const spawned = await evaluate(`(() => {
  const z = __sdfGame.zombies().find(q => q.id === ${staged.body});
  const p = z ? z.pos : [0, 0, 0];
  const n = __sdfGame.spawnTestChunk(p[0], 1.0, p[2], 0.25, true);
  return { n, live: __sdfGame.chunkStats().live };
})()`);
if (!spawned || spawned.live < 1) fail(`test chunk did not spawn: ${JSON.stringify(spawned)}`);
await evaluate('(() => { __sdfGame.step(6); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const withChunk = (await countHits()).hits;

console.log(JSON.stringify({ base, withHands, withChunk }));
process.exit(0);
