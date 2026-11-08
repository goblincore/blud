// scripts/body-lod-damage.mjs — what damage does to far mesh-LOD bodies (spike, 2026-11-08).
// A row of four zombies 14 m off (beyond the 10 m switch, so all four start as the mesh), frozen. In order:
//   intact -> one double-barrel shot at body 1's torso -> body 2's left arm severed -> body 3 set alight -> body 4 shot to pieces
//   (double barrel x6) -> camera walks in to 8 m (every body crosses the band) -> back out to 14 m.
// Each step is shot with the LOD on; the 'intact' and the 8 m steps are also shot with it off (same frame).
// Usage: node scripts/body-lod-damage.mjs <vitePort> <cdpPort> <refine|keep> [outDir]
import { openGame } from './lib/cdp-game.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , vite = '5391', cdp = '9391', rule = 'refine', out = '.lab-tmp/lod/damage'] = process.argv;
mkdirSync(out, { recursive: true });
const g = await openGame(Number(vite), Number(cdp));
await g.boot(`level=arena&spawn=zombie&vhs=off&bodylodwound=${rule}`);
const ROW_Z = -14;
// The arena's own enemy stays where it spawned, (0, -10): a nudge of a frozen body drags its root off its pinned feet.
const { ids } = await g.ev(`__sdfGame.bodyLodStage('zombie', [[-4.5,${ROW_Z}],[-2.5,${ROW_Z}],[2.5,${ROW_Z}],[4.5,${ROW_Z}]])`);
await g.ev('__sdfGame.freeze(true)');
await g.ev(`document.querySelectorAll('body > *:not(#app)').forEach(e => e.style.display = 'none')`);
for (let i = 0; i < 120; i++) {
  const info = await g.ev('__sdfGame.bodyLod()');
  if (info.types?.some((t) => t.status !== 'pending')) break;
  await g.sleep(500);
}
const place = async (d) => { await g.ev(`__sdfGame.setPose(0, ${ROW_Z + d}, 0, 0, 0)`); await g.sleep(1200); };
const log = [];
const step = async (tag, ab = false) => {
  await g.sleep(900);
  const info = await g.ev('__sdfGame.bodyLod()');
  const wounds = await g.ev(`${JSON.stringify(ids)}.map(id => __sdfGame.zombie(id)?.woundCount() ?? null)`);
  writeFileSync(`${out}/${rule}-${tag}-on.png`, await g.shot());
  if (ab) {
    await g.ev('__sdfGame.setBodyLod({ on: false })'); await g.sleep(700);
    writeFileSync(`${out}/${rule}-${tag}-off.png`, await g.shot());
    await g.ev('__sdfGame.setBodyLod({ on: true })'); await g.sleep(700);
  }
  log.push({ tag, meshed: ids.filter((id) => info.meshed.includes(id)).map((id) => ids.indexOf(id) + 1),
    refined: ids.filter((id) => info.refined.includes(id)).map((id) => ids.indexOf(id) + 1), wounds, chunks: await g.ev('__sdfGame.liveChunks ? __sdfGame.liveChunks().length : null').catch(() => null) });
  console.log(JSON.stringify(log.at(-1)));
};
await place(14);
await step('0-intact', true);
await g.ev(`__sdfGame.aimSurface('torso', ${ids[0]})`); await g.ev('__sdfGame.fire(2)');
await step('1-shot');
await g.ev(`__sdfGame.zombie(${ids[1]}).sever('armL')`);
await step('2-sever');
await g.ev(`__sdfGame.igniteActor(${ids[2]})`);
await step('3-alight');
for (let i = 0; i < 6; i++) { await g.ev(`__sdfGame.aimSurface('torso', ${ids[3]})`); await g.ev('__sdfGame.fire(2)'); await g.sleep(400); }
await step('4-shredded');
await place(9.6); await step('5-at-9.6m');
await place(8); await step('6-at-8m', true);
await place(14); await step('7-back-at-14m', true);
writeFileSync(`${out}/${rule}.json`, JSON.stringify(log, null, 1));
console.log(JSON.stringify(g.errors().slice(0, 3)));
process.exit(0);
