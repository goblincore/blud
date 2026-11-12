// scripts/closet-spots.mjs — frame cost at fixed level spots with the monster closets shut and open (2026-11-08).
// Boots the level once per query (default: closets shut; `&closets=0`: open from load, the old import), freezes the
// cast, and at each spot records frameSplit + completion-order march ms, the bodies the cull keeps, the portal flood's
// sectors, and a screenshot. Bodies are idle where they spawned.
// A spot's optional 4th element [x, z] is somewhere to stand first (a walk-over line's trigger: the closet then opens).
// Usage: node scripts/closet-spots.mjs <vitePort> <cdpPort> <level> '<[[x,z,yaw,[px,pz]?],...]>' '<["", "&closets=0"]>' [outDir]
import { openGame } from './lib/cdp-game.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [, , vite, cdp, level, spotsJson, legsJson = '["", "&closets=0"]', out = '.lab-tmp/closets'] = process.argv;
const spots = JSON.parse(spotsJson);
const legs = JSON.parse(legsJson);
mkdirSync(out, { recursive: true });
const g = await openGame(Number(vite), Number(cdp));
const rows = [];
for (const [li, query] of legs.entries()) {
  await g.boot(`level=${level}&god=1&vhs=off${query}`);
  await g.ev('__sdfGame.freeze(true)');
  await g.ev(`document.querySelectorAll('body > *:not(#app)').forEach(e => e.style.display = 'none')`);
  for (const [i, [x, z, yaw, pre]] of spots.entries()) {
    if (pre) {
      await g.ev(`__sdfGame.setPose(${pre[0]}, ${pre[1]}, ${yaw}, 0)`);
      await g.sleep(1500);
    }
    const f = (await g.ev(`__sdfGame.ground(${x}, ${z})`)).floor;
    await g.ev(`__sdfGame.setPose(${x}, ${z}, ${yaw}, 0, ${f})`);
    await g.sleep(1500);
    const runs = [];
    for (let k = 0; k < 2; k++) {
      const m = await g.measure(15);
      const c = await g.ev('__sdfGame.actorCull()');
      const zc = await g.ev('__sdfGame.zoneCull()');
      runs.push({ fence: +m.fenceMs.toFixed(1), drawOnly: +m.drawOnlyMs.toFixed(1), tick: +m.tickMs.toFixed(1), march: m.marchMs,
        visible: c.visible, sectors: zc?.visibleSectors, zones: zc?.visibleZones?.length });
    }
    const closets = await g.ev('__sdfGame.closets ? __sdfGame.closets() : null');
    writeFileSync(`${out}/${level}-${i}-leg${li}.png`, await g.shot());
    const row = { query, spot: [x, z, yaw, pre ?? null], runs, closets: closets?.filter(c => c.sector === 115 || c.sector === 109) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(`${out}/${level}.json`, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(g.errors().slice(0, 3)));
process.exit(0);
