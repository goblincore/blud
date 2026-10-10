// scripts/kit-beam-stills.mjs — kit vs flesh under the flashlight, in the game.
//
// Boots /sdf-game.html?spawn=<CHARACTER>&frozen=1&seed=1&vhs=off<EXTRA>, poses the
// kit, teleports to ROOM, and stands the player at each of DISTS metres in
// front of the first non-soldier actor (or any actor for CHARACTER=soldier),
// flashlight on (the dungeon rig default). One still per distance:
//   <outDir>/<PREFIX>-<dist>m.png
// EXTRA=&kitbeam=0 reproduces the pre-2026-09-25 kit lighting for a before still.
//
// node scripts/kit-beam-stills.mjs <vitePort> <cdpPort> <outDir>
// Env: CHARACTER (bride), ROOM (2), DISTS ("0.7,2"), ANGLE (0, radians round
// her), PITCHES (per distance, "-0.35,-0.12"), PREFIX (CHARACTER), EXTRA ("").
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2]), CDP = Number(process.argv[3]), OUT = process.argv[4];
const CHARACTER = process.env.CHARACTER ?? 'bride';
const ROOM = Number(process.env.ROOM ?? 2);
const DISTS = (process.env.DISTS ?? '0.7,2').split(',').map(Number);
const PITCHES = (process.env.PITCHES ?? '-0.35,-0.12').split(',').map(Number);
const ANGLE = Number(process.env.ANGLE ?? 0);
const PREFIX = process.env.PREFIX ?? CHARACTER;
const EXTRA = process.env.EXTRA ?? '';
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
mkdirSync(OUT, { recursive: true });

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({ send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?spawn=${CHARACTER}&frozen=1&seed=1&vhs=off${EXTRA}` });
// A boot after a shader change can compile for minutes: wait up to 5.
for (let i = 0; i < 600; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') !== 'ready') fail('warm gate never reached ready');
await evaluate(`__sdfGame.teleport(${ROOM}); __sdfGame.step(2);`);
await evaluate(`__sdfGame.freeze(false); __sdfGame.step(2); __sdfGame.freeze(true);`);
const actors = JSON.parse(await evaluate('JSON.stringify(__sdfGame.actorTrace())'));
const target = CHARACTER === 'soldier' ? actors[0] : actors.find((a) => a.kind !== 'soldier');
if (!target) fail('no target actor');
console.log(`framing ${target.id} (${target.kind})`);
await sleep(9000); // the READY card fades after the gate opens
for (let i = 0; i < DISTS.length; i++) {
  const d = DISTS[i], pitch = PITCHES[i] ?? PITCHES[PITCHES.length - 1];
  const x = target.pos[0] + Math.sin(ANGLE) * d, z = target.pos[2] + Math.cos(ANGLE) * d;
  await evaluate(`__sdfGame.placePlayer({ x: ${x}, z: ${z}, yaw: ${-ANGLE}, pitch: ${pitch} }); __sdfGame.step(8);`);
  await sleep(1500);
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/${PREFIX}-${d}m.png`;
  writeFileSync(file, Buffer.from(png.result.data, 'base64'));
  console.log(`wrote ${file}`);
}
process.exit(0);
