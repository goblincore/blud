// scripts/body-lod-crowd.mjs — what the mesh LOD buys on a distant crowd (spike, 2026-11-08).
// Arena, one character: NEAR bodies at 3-5 m (always marched) and FAR bodies in a grid 11-25 m off (meshed when on),
// frozen, camera fixed. Legs alternate off/on twice; each leg is frameSplit + completion-order march ms.
// Usage: node scripts/body-lod-crowd.mjs <vitePort> <cdpPort> <character> <near> <far> [outDir]
import { openGame } from './lib/cdp-game.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , vite = '5391', cdp = '9391', name = 'butcher', nNear = '3', nFar = '24', out = '.lab-tmp/lod/crowd'] = process.argv;
mkdirSync(out, { recursive: true });
const g = await openGame(Number(vite), Number(cdp));
await g.boot(`level=arena&spawn=${name}&vhs=off`);
const rows = [];
for (let i = 0; i < Number(nNear); i++) rows.push([-2 + 2 * i, -4.5 - (i % 2)]);
for (let i = 0; i < Number(nFar); i++) rows.push([-8 + (i % 6) * 3.2, -12 - Math.floor(i / 6) * 3.5]);
await g.ev(`__sdfGame.bodyLodStage(${JSON.stringify(name)}, ${JSON.stringify(rows)})`);
await g.ev('__sdfGame.freeze(true)');
await g.ev(`document.querySelectorAll('body > *:not(#app)').forEach(e => e.style.display = 'none')`);
await g.ev('__sdfGame.setPose(0, -0.5, 0, -0.05, 0)');
for (let i = 0; i < 160; i++) { const info = await g.ev('__sdfGame.bodyLod()'); if (info.types?.some((t) => t.status !== 'pending') && info.pendingJob === null) break; await g.sleep(500); }
await g.sleep(1500);
const legs = [];
for (const leg of ['off', 'on', 'off', 'on']) {
  await g.ev(`__sdfGame.setBodyLod({ on: ${leg === 'on'} })`);
  await g.sleep(800);
  const m = await g.measure(15);
  const info = await g.ev('__sdfGame.bodyLod()');
  legs.push({ leg, fence: +m.fenceMs.toFixed(1), drawOnly: +m.drawOnlyMs.toFixed(1), draw: +m.drawMs.toFixed(1), tick: +m.tickMs.toFixed(1), march: m.marchMs, meshed: info.meshed.length, visible: (await g.ev('__sdfGame.actorCull()')).visible });
  writeFileSync(`${out}/${name}-${nNear}n${nFar}f-${leg}.png`, await g.shot());
  console.log(JSON.stringify(legs.at(-1)));
}
writeFileSync(`${out}/${name}-${nNear}n${nFar}f.json`, JSON.stringify(legs, null, 1));
console.log(JSON.stringify(g.errors().slice(0, 3)));
process.exit(0);
