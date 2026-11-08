// scripts/body-lod-spots.mjs — frame cost and A/B frames for the distance mesh LOD at fixed level spots (2026-11-08).
// Boots the level, freezes the cast, and at each spot measures (frameSplit + completion-order march ms) and shoots
// with the LOD off and on, alternating, in the same boot. Bodies are idle where they spawned.
// Usage: node scripts/body-lod-spots.mjs <vitePort> <cdpPort> <level> '<[[x,z,yaw],...]>' [query] [outDir]
import { openGame } from './lib/cdp-game.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , vite, cdp, level, spotsJson, query = '', out = '.lab-tmp/lod/spots'] = process.argv;
const spots = JSON.parse(spotsJson);
mkdirSync(out, { recursive: true });
const g = await openGame(Number(vite), Number(cdp));
await g.boot(`level=${level}&god=1&vhs=off${query}`);
await g.ev('__sdfGame.freeze(true)');
await g.ev(`document.querySelectorAll('body > *:not(#app)').forEach(e => e.style.display = 'none')`);
const rows = [];
for (const [i, [x, z, yaw]] of spots.entries()) {
  const f = (await g.ev(`__sdfGame.ground(${x}, ${z})`)).floor;
  await g.ev(`__sdfGame.setPose(${x}, ${z}, ${yaw}, 0, ${f})`);
  // Let the LOD bake every type in view (one bake at a time), then measure.
  for (let k = 0; k < 90; k++) {
    await g.sleep(500);
    const info = await g.ev('__sdfGame.bodyLod()');
    if (info.pendingJob === null && k > 6) break;
  }
  const row = { spot: [x, z, yaw] };
  for (const leg of ['off', 'on', 'off', 'on']) {
    await g.ev(`__sdfGame.setBodyLod({ on: ${leg === 'on'} })`);
    await g.sleep(600);
    const m = await g.measure(15);
    const info = await g.ev('__sdfGame.bodyLod()');
    const c = await g.ev('__sdfGame.actorCull()');
    (row[leg] ??= []).push({ fence: +m.fenceMs.toFixed(1), drawOnly: +m.drawOnlyMs.toFixed(1), tick: +m.tickMs.toFixed(1), draw: +m.drawMs.toFixed(1), march: m.marchMs, meshed: info.meshed?.length ?? 0, visible: c.visible });
    writeFileSync(`${out}/${level}-${i}-${leg}.png`, await g.shot());
  }
  const info = await g.ev('__sdfGame.bodyLod()');
  row.types = info.types;
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(`${out}/${level}.json`, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(g.errors().slice(0, 3)));
process.exit(0);
