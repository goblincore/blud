// scripts/march-hash.mjs — the before/after pixel gate for march shader
// refactors. Boots the game frozen, stages the standard close-up (room 1,
// ship defaults), and prints a deterministic hash of the 400x300 march
// target — plus a repeat-state determinism proof and a wounded variant.
//
// USAGE: run this script at commit A, save its JSON line; run it again at
// commit B (e.g. with a single shader file swapped in via `git show
// <sha>:<path> > <path>`, then restored); diff the two JSON lines. Any hash
// mismatch means the refactor changed march-target output — investigate,
// do not loosen this gate to make it pass.
//
// EXACT, not truncated: __sdfGameDebug.hashMarchTarget() (game-main.ts)
// folds each float into its FNV hash via `r | 0`, which truncates to the
// integer part — a sub-1.0 change in a pixel's float value is invisible to
// it. Measured directly: stamping wounds changed the march target's rSum
// (1784.941 -> 1784.711) but hashMarchTarget()'s hash did not move. So this
// script instead pulls the exact float readback via
// __sdfGameDebug.readMarchTarget() ({ w, h, rgba32f: base64 of the raw
// Float32Array bytes, row-depadded}) and hashes the raw bytes with sha1 in
// Node — every bit of every float participates, nothing is truncated.
//
// Output: ONE JSON line to stdout —
//   { "room1": "<hash>", "room1-repeat": "<hash>", "room1-wounded": "<hash>" }
// room1-repeat must equal room1 (same staged state, hashed again after a
// couple of extra steps) — that is the determinism proof this script
// exists to provide before trusting a cross-commit comparison at all.
// room1-wounded must NOT equal room1 — the stamped wound must be visible to
// the gate, or the gate isn't testing anything. Either check failing FAILs
// loudly rather than reporting a possibly-spurious diff.
//
// Env: LAB_VITE_PORT / LAB_CDP_PORT (default 5323 / 9323). Run inside
// lab-servers (see scripts/lab-servers.sh).
import { createHash } from 'node:crypto';
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 6 min'); process.exit(3); }, 6 * 60_000).unref();

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({
  send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0`,
});
await applyShipDefaults(evaluate);
// Pin the wall-clock-driven render state: the dungeon flicker lights read
// performance.now() directly in the draw path (game-main.ts ~line 1114),
// with no gate from ?frozen=1 or freeze(true) — those only stop actors.
// The truncating hashMarchTarget() never noticed this drift (sub-1.0
// lighting deltas don't cross an integer boundary); the exact byte readback
// does (measured: two direct back-to-back readMarchTarget() calls on an
// unpinned clock produced different sha1s). Same pins scripts/upscale-parity.mjs
// uses for the same reason.
// Also pin the room-probe afterglow (game-main.ts ~line 1389, default
// blend 0.6 / fall 0.12): a slow temporal accumulation filter whose state
// depends on how many frames have been dispatched, same reasoning as
// scripts/upscale-parity.mjs — blend/fall = 1 makes it a pure per-frame
// estimate so the march target is a function of the frozen scene alone.
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
await stageCloseUp(evaluate, { room: 1 }, fail);
await evaluate('(() => { __sdfGame.setSdfScale(0.5); __sdfGame.step(6); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');

// readMarchTarget() (game-main.ts) calls handle.step(0) itself before
// reading — an extra internal frame per call, on top of whatever this
// script's own step()s already advanced. That internal step flips a
// frame-parity-driven jitter: measured directly, back-to-back
// readMarchTarget() calls with zero other steps in between produce a
// strict period-2 cycle (X, Y, X, Y, ...), not noise — hashMarchTarget()
// never showed this because it reads the current target with no step of
// its own. Calling readMarchTarget() TWICE per logical capture (consuming
// an even number of internal frames each time) locks the parity so
// successive logical captures land on the same phase; verified stable
// across an intervening external step(2) too.
const capture = async () => {
  await evaluate('__sdfGameDebug.readMarchTarget()');
  const r = await evaluate('__sdfGameDebug.readMarchTarget()');
  const bytes = Buffer.from(r.rgba32f, 'base64');
  return createHash('sha1').update(bytes).digest('hex');
};

const room1 = await capture();

await evaluate('(() => { __sdfGame.step(2); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const room1Repeat = await capture();

if (room1Repeat !== room1) {
  fail(`not deterministic within boot: room1=${room1} room1-repeat=${room1Repeat}`);
}

// Wounded variant — reuse the stamp dance from scripts/sdf-game-parity.mjs:
// fire the staged pose's slug + two pellets at the body, then re-hash.
const stampWounds = () => evaluate(`(async () => {
  __sdfGame.setWoundTuning({ spillChance: 0 });
  const hits = [];
  for (const [dyaw, dpitch, kind] of [
    [0, 0, 'slug'], [0.12, 0.05, 'pellet'], [-0.12, -0.05, 'pellet'],
  ]) {
    const base = __sdfGame.pose();
    const yaw = base.yaw + dyaw, pitch = base.pitch + dpitch;
    __sdfGame.setPose(base.pos[0], base.pos[2], yaw, pitch, 0);
    const p = __sdfGame.predictSlugHit();
    if (p.actorId < 0 || !p.hit) continue;
    __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
      p.dir[0], p.dir[1], p.dir[2], kind, p.actorId);
    hits.push({ kind, at: p.hit, actorId: p.actorId });
  }
  __sdfGame.step(5);
  return { stamped: hits.length };
})()`);

const stamp = await stampWounds();
if (!stamp.stamped) fail(`no wounds stamped: ${JSON.stringify(stamp)}`);
await evaluate('__sdfGame.resolveGpu()');
const room1Wounded = await capture();

if (room1Wounded === room1) {
  fail(`wound not visible to the gate: room1-wounded=${room1Wounded} equals room1=${room1}`);
}

console.log(JSON.stringify({
  room1,
  'room1-repeat': room1Repeat,
  'room1-wounded': room1Wounded,
}));
process.exit(0);
