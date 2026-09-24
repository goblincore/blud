// scripts/bride-game-frames.mjs — the bride in the GAME, framed (Task 3 of
// docs/superpowers/plans/2026-09-24-bride-sword-enemy.md, Step 5).
//
// Why a game capture at all: translateBody (spawn placement) must move every
// position-absolute part of a prim, and shell CLIP PLANES are absolute
// half-spaces. Until f5df2b40 it did not move them and every in-game garment
// was cut at the world origin. The lab never translates bodies, so lab frames
// cannot catch that class of bug: the veil, bodice and skirt have to be seen
// uncut HERE.
//
// Boots /sdf-game.html?spawn=<character>&frozen=1&seed=1&vhs=off (every non-soldier
// slot spawns the character), teleports to room 2, finds the nearest actor of
// that kind (actorTrace), stands the player DIST m in front of it, facing it,
// and screenshots from the front, 3/4 and back by moving the player round
// it. Frozen, so the body holds still between shots.
//
// Usage (servers from scripts/lab-servers.sh or already listening):
//   node scripts/bride-game-frames.mjs <vitePort> <cdpPort> <outDir>
// Env: CHARACTER (bride), ROOM (2), DIST (2.6), EYE_PITCH (-0.18).
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5271);
const CDP = Number(process.argv[3] ?? 9271);
const OUT = process.argv[4] ?? '.lab-tmp/game-frames';
const CHARACTER = process.env.CHARACTER ?? 'bride';
const ROOM = Number(process.env.ROOM ?? 2);
const DIST = Number(process.env.DIST ?? 2.6);
const PITCH = Number(process.env.EYE_PITCH ?? -0.18);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
mkdirSync(OUT, { recursive: true });

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({ send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?spawn=${CHARACTER}&frozen=1&seed=1&vhs=off` });
// Capture scripts require the warm gate (the plan's rule): before 'ready'
// the page still shows its READY / click-to-start card, and the first
// screenshot of an early run caught exactly that.
for (let i = 0; i < 240; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') !== 'ready') fail('warm gate never reached ready');
await evaluate(`__sdfGame.teleport(${ROOM}); __sdfGame.step(2);`);
const actors = JSON.parse(await evaluate('JSON.stringify(__sdfGame.actorTrace())'));
const kinds = [...new Set(actors.map((a) => a.kind))];
console.log(`actors: ${actors.length} (${kinds.join(', ')})`);
// Frozen boot: the actors hold their spawn pose, so the first one of the
// character's kind is as good as any.
const target = actors.find((a) => a.kind !== 'soldier');
if (!target) fail('no non-soldier actor in the room');
console.log(`framing actor ${target.id} (${target.kind}) at ${target.pos.map((v) => v.toFixed(2)).join(', ')}`);

// The page exposes no actor heading, so shoot from the four world compass
// points round her (plus the diagonals); the caller picks front/3/4/back.
const shot = async (name, angle) => {
  const pos = target.pos;
  const x = pos[0] + Math.sin(angle) * DIST, z = pos[2] + Math.cos(angle) * DIST;
  // yaw 0 looks down -z (crowd-normal-probe: player at z + d, yaw 0), and
  // placePlayer's yaw turns the other way from the placement angle
  // (measured: yaw = +angle looked away from her at 45 degrees).
  const yaw = -angle;
  await evaluate(`__sdfGame.placePlayer({ x: ${x}, z: ${z}, yaw: ${yaw}, pitch: ${PITCH} }); __sdfGame.step(8);`);
  await sleep(1500);
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(png.result.data, 'base64'));
  console.log(`wrote ${file}`);
};
// The READY card FADES out after the gate opens; the first shot of a run
// caught it half-transparent. Give it time to go.
await sleep(5000);
for (let i = 0; i < 8; i++) await shot(`yaw-${i * 45}`, i * Math.PI / 4);
process.exit(0);
