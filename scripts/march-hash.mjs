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
// Output: ONE JSON line to stdout —
//   { "room1": "<hash>", "room1-repeat": "<hash>", "room1-wounded": "<hash>" }
// room1-repeat must equal room1 (same staged state, hashed again after a
// couple of extra steps) — that is the determinism proof this script
// exists to provide before trusting a cross-commit comparison at all. If it
// does not match, this script FAILs loudly rather than reporting a
// possibly-spurious diff.
//
// Env: LAB_VITE_PORT / LAB_CDP_PORT (default 5323 / 9323). Run inside
// lab-servers (see scripts/lab-servers.sh).
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
await stageCloseUp(evaluate, { room: 1 }, fail);
await evaluate('(() => { __sdfGame.setSdfScale(0.5); __sdfGame.step(6); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');

const capture = () => evaluate('__sdfGameDebug.hashMarchTarget()');

const room1 = await capture();

await evaluate('(() => { __sdfGame.step(2); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const room1Repeat = await capture();

if (room1Repeat.hash !== room1.hash) {
  fail(`not deterministic within boot: room1=${JSON.stringify(room1)} room1-repeat=${JSON.stringify(room1Repeat)}`);
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

console.log(JSON.stringify({
  room1: room1.hash,
  'room1-repeat': room1Repeat.hash,
  'room1-wounded': room1Wounded.hash,
}));
process.exit(0);
