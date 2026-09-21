// scripts/sdf-late-spawn-gate.mjs — A BODY SPAWNED AFTER BOOT MUST MARCH FLESH.
//
// Regression gate for the late-spawn bug (2026-09-21): bodies added through
// `__sdfGame.spawnDebugCharacter` / `spawnCrowd` after boot drew no flesh while
// the cast was frozen (occupancy hits bit-identical for minutes — melee
// harness NOTES, branch dispatch/2026-09-21-melee-closeup-harness). Root cause:
// the frozen path builds the outer shell hull ONCE, the shell ships on, and the
// march discards every pixel no hull instance covers — a late body had none.
//
// Per cast name, on a FRESH frozen page (so bodies cannot occlude each other):
// wait for the background crowd program, turn the camera off the boot soldier,
// measure `occupancy().hits`, spawn the body 1.6 m ahead, step, and measure
// again. PASS iff every spawn adds >= LATE_SPAWN_MIN_HITS flesh hits at the
// 400x300 march target.
//
// Usage: scripts/sdf-late-spawn-gate.sh   (owns vite + Chrome)
//   LATE_SPAWN_CAST=goblin,minotaur scripts/sdf-late-spawn-gate.sh
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.argv[3] ?? process.env.LAB_CDP_PORT ?? 9277);
const CAST = (process.env.LATE_SPAWN_CAST ?? 'zombie,goblin,bonewalker').split(',');
const MIN_HITS = Number(process.env.LATE_SPAWN_MIN_HITS ?? 300);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 40 min'); process.exit(3); }, 40 * 60_000).unref();

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });

const rows = [];
for (const name of CAST) {
  await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
  // The crowd program compiles in the background after the loader; spawns in
  // the shipped state happen after it lands (cold: minutes).
  let bg = null;
  for (let i = 0; i < 1200; i++) {
    bg = await evaluate('__sdfGame.warmBackground()');
    if (bg?.crowd === 'ready' || bg?.crowd === 'failed') break;
    await sleep(500);
  }
  if (bg?.crowd !== 'ready') fail(`crowd program never landed: ${JSON.stringify(bg)}`);
  await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
  // Room 1's spawn pose faces the soldier; 0.55 rad right is open floor.
  const p = await evaluate(`(() => { const p = __sdfGame.pose(); __sdfGame.setPose(p.pos[0], p.pos[2], p.yaw + 0.55, 0); return __sdfGame.pose(); })()`);
  await sleep(1000);
  const before = (await evaluate('__sdfGame.occupancy()')).hits;
  // Camera forward on the floor plane is (sin yaw, -cos yaw).
  const at = [p.pos[0] + Math.sin(p.yaw) * 1.6, 0, p.pos[2] - Math.cos(p.yaw) * 1.6];
  const spawn = await evaluate(`__sdfGame.spawnDebugCharacter(${JSON.stringify(name)}, ${JSON.stringify(at)})`);
  if (spawn?.errors?.length) fail(`${name}: spawn errors ${spawn.errors.join(' | ')}`);
  await sleep(1500);
  const after = (await evaluate('__sdfGame.occupancy()')).hits;
  const row = { name, before, after, delta: after - before };
  console.log(JSON.stringify(row));
  rows.push(row);
}
const bad = rows.filter(r => r.delta < MIN_HITS);
if (bad.length) fail(`late spawns drew no flesh: ${bad.map(r => `${r.name} (+${r.delta})`).join(', ')}`);
console.log(`PASS: ${rows.length} late spawns each added >= ${MIN_HITS} flesh hits`);
process.exit(0);
