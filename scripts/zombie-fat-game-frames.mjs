// scripts/zombie-fat-game-frames.mjs — the fat zombie in the GAME (docs/dev-notes/2026-10-27-zombie-fat/).
//
// bride-game-frames.mjs for any level and any character: boots /sdf-game.html?level=<LEVEL>&frozen=1 (plus
// &spawn=<SPAWN> when set), finds the first actor whose CHARACTER is <CHARACTER> (brains() names it; actorList places
// it), teleports to its room and shoots it from round the compass at DIST m. A Night Train boot with no spawn override
// is the real mix (zombie-variants.ts), so its frames show the fat zombies among the plain ones.
//
// Usage (servers from scripts/lab-servers.sh or already listening):
//   node scripts/zombie-fat-game-frames.mjs <vitePort> <cdpPort> <outDir>
// Env: LEVEL (arena), SPAWN (unset), CHARACTER (zombie-fat), PICK (0: which of that character's actors, in spawn
// order), DIST (2.6), EYE_PITCH (-0.12), YAWS (0,45,90,180), KIT_STEPS (2), SETTLE (5 s: a story level's first boot
// is still compiling pipelines after the warm gate, so give it longer).
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5233);
const CDP = Number(process.argv[3] ?? 9223);
const OUT = process.argv[4] ?? '.lab-tmp/zombie-fat-frames';
const LEVEL = process.env.LEVEL ?? 'arena';
const SPAWN = process.env.SPAWN;
const CHARACTER = process.env.CHARACTER ?? 'zombie-fat';
const DIST = Number(process.env.DIST ?? 2.6);
const PITCH = Number(process.env.EYE_PITCH ?? -0.12);
const YAWS = (process.env.YAWS ?? '0,45,90,180').split(',').map(Number);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
mkdirSync(OUT, { recursive: true });

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({ send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?level=${LEVEL}${SPAWN ? `&spawn=${SPAWN}` : ''}&frozen=1&seed=1&vhs=off` });
for (let i = 0; i < 240; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') !== 'ready') fail('warm gate never reached ready');
const list = JSON.parse(await evaluate('JSON.stringify(__sdfGame.actorList())'));
const brains = JSON.parse(await evaluate('JSON.stringify(__sdfGame.brains())'));
const charOf = new Map(brains.map((b) => [b.id, b.character]));
const counts = {};
for (const a of list) counts[charOf.get(a.id)] = (counts[charOf.get(a.id)] ?? 0) + 1;
console.log(`actors: ${list.length}`, JSON.stringify(counts));
for (const a of list) console.log(`  ${a.id} ${charOf.get(a.id)} room ${a.room} at ${a.pos.map((v) => v.toFixed(1)).join(', ')}`);
const target = list.filter((a) => charOf.get(a.id) === CHARACTER)[Number(process.env.PICK ?? 0)];
if (!target) fail(`no ${CHARACTER} in ${LEVEL}`);
console.log(`framing actor ${target.id} (${CHARACTER}) in room ${target.room} at ${target.pos.map((v) => v.toFixed(2)).join(', ')}`);
await evaluate(`__sdfGame.teleport(${target.room}); __sdfGame.step(2);`);
// ?frozen=1 parks every kit at its bind pose; a couple of live ticks pose it (bride-game-frames.mjs).
const KIT_STEPS = Number(process.env.KIT_STEPS ?? 2);
if (KIT_STEPS > 0) await evaluate(`__sdfGame.freeze(false); __sdfGame.step(${KIT_STEPS}); __sdfGame.freeze(true);`);
const pos = JSON.parse(await evaluate('JSON.stringify(__sdfGame.actorList())')).find((a) => a.id === target.id).pos;
writeFileSync(`${OUT}/actors.json`, JSON.stringify({ level: LEVEL, counts, target: { ...target, pos } }, null, 1));

await sleep(Number(process.env.SETTLE ?? 5) * 1000);   // the READY card fades after the gate opens
for (const deg of YAWS) {
  const angle = deg * Math.PI / 180;
  const x = pos[0] + Math.sin(angle) * DIST, z = pos[2] + Math.cos(angle) * DIST;
  await evaluate(`__sdfGame.placePlayer({ x: ${x}, z: ${z}, yaw: ${-angle}, pitch: ${PITCH} }); __sdfGame.step(8);`);
  await sleep(1500);
  const png = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/${LEVEL}-yaw-${deg}.png`;
  writeFileSync(file, Buffer.from(png.result.data, 'base64'));
  console.log(`wrote ${file}`);
}
process.exit(0);
