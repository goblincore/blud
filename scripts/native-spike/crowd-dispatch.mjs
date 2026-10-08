// scripts/native-spike/crowd-dispatch.mjs
//
// Crowd dispatch by body count: the live game's whole-frame time (timeDraws)
// on the bench's `distance` scene — the player in room 1's near corner, n
// zombies on a 0.9 m grid in the far half — under `boxes` and `quad`, with and
// without ?earlyz=1. One fresh page per (flag, n); the dispatch is switched
// inside the page, boxes measured again last as the drift check.
//
//   scripts/native-spike/servers.sh node scripts/native-spike/crowd-dispatch.mjs
import { applyShipDefaults, bootCloseupPage, connectGame, failHard, sleep } from '../lib/sdf-closeup-stage.mjs';
import { waitForLoader } from '../lib/wait-loader.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5291);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9291);
const COUNTS = (process.env.CROWD_COUNTS ?? '0,2,4,8,12,24').split(',').map(Number);
const FLAGS = (process.env.CROWD_FLAGS ?? ',earlyz=1').split(',');
const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP });

const stage = (n) => evaluate(`(() => {
  const b = __sdfGame.rooms.find(x => x.id === 1).bounds;
  const px = b.minX + 0.6, pz = b.minZ + 0.6;
  __sdfGame.teleport(1);
  __sdfGame.placePlayer({ x: px, z: pz, yaw: Math.atan2(b.maxX - px, -(b.maxZ - pz)), pitch: 0 });
  __sdfGame.freeze(true);
  if (${n} > 0) __sdfGame.spawnCrowd('zombie', ${n}, { spacing: 0.9, region: { minX: (b.minX + b.maxX) / 2, maxX: b.maxX - 0.5, minZ: b.minZ + 0.5, maxZ: b.maxZ - 0.5 } });
})()`);
const time = async () => {
  await evaluate('__sdfGame.step(4)');
  const t = [];
  for (let i = 0; i < 3; i++) t.push(await evaluate('__sdfGame.timeDraws(15)', 300_000));
  return t.sort((a, b) => a - b)[1];
};

for (const flag of FLAGS) {
  for (const n of COUNTS) {
    await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html${flag ? `?${flag}` : ''}` });
    await waitForLoader(evaluate, { fail: failHard });
    for (let i = 0; i < 1200 && !(await evaluate('__sdfGame.warmBackground().crowd === "ready"')); i++) await sleep(1000);
    if (flag) await sleep(20_000); // the early-Z front program compiles after ready
    await applyShipDefaults(evaluate);
    await stage(n);
    const row = { flag: flag || 'ship', n };
    await evaluate(`__sdfGame.setCrowdDispatch('boxes')`); row.boxes = await time();
    await evaluate(`__sdfGame.setCrowdDispatch('quad')`); row.quad = await time();
    await evaluate(`__sdfGame.setCrowdDispatch('boxes')`); row.boxesAgain = await time();
    row.visible = await evaluate(`__sdfGame.crowdInfo().types.reduce((s, t) => s + t.visible, 0)`);
    console.log(JSON.stringify(row));
  }
}
process.exit(0);
