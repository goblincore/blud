// scripts/body-lod-ab.mjs — same-frame A/B captures for the distance mesh LOD spike (2026-11-08).
// A row of four staged bodies (plus the arena's own at (0, -10)) of one character in the arena, frozen; the camera steps back through DISTS; at each stop the
// frame is shot with the LOD forced on (switch distance under the camera, so every body is the mesh) and off.
// Env: DISTS (default 6,10,14,17), QUERY (extra URL params), TAG (file-name suffix).
// Usage: node scripts/body-lod-ab.mjs <vitePort> <cdpPort> <character> [outDir]
// Needs the arena (public/assets/levels/arena.level.json) and a running vite + headless Chrome (scripts/lab-servers.sh).
import { openGame } from './lib/cdp-game.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , vite = '5391', cdp = '9391', name = 'zombie', out = '.lab-tmp/lod/ab'] = process.argv;
const DISTS = (process.env.DISTS ?? '6,10,14,17').split(',').map(Number);
mkdirSync(out, { recursive: true });
const g = await openGame(Number(vite), Number(cdp));
const QUERY = process.env.QUERY ?? '';           // e.g. &bodylodlook=corpse
const TAG = process.env.TAG ?? '';
await g.boot(`level=arena&spawn=${name}&vhs=off${QUERY}`);
// The row stands in the lit middle of the arena (lights at z -4.5..-20); the camera backs off along the diagonal
// to the (+x, +z) corner, which is the only way to get 17 m inside a 24 x 28 m room and stay in its light.
const ROW_Z = -14;
const DIAG = [11.5 / Math.hypot(11.5, 13.5), 13.5 / Math.hypot(11.5, 13.5)];
// The arena's own enemy stays where it spawned, (0, -10): a nudge of a frozen body drags its root off its pinned feet.
await g.ev(`__sdfGame.bodyLodStage(${JSON.stringify(name)}, [[-4,${ROW_Z}],[-2,${ROW_Z}],[2,${ROW_Z}],[4,${ROW_Z}]])`);
await g.ev('__sdfGame.freeze(true)');
await g.ev(`document.querySelectorAll('body > *:not(#app)').forEach(e => e.style.display = 'none')`);
await g.ev('__sdfGame.setBodyLod({ on: true, switchM: 1, hysteresisM: 0 })');
for (let i = 0; i < 120; i++) {
  const info = await g.ev('__sdfGame.bodyLod()');
  if (info.types?.some((t) => t.status !== 'pending')) break;
  await g.sleep(500);
}
const res = [];
for (const d of DISTS) {
  const cx = DIAG[0] * d, cz = ROW_Z + DIAG[1] * d;
  await g.ev(`__sdfGame.setPose(${cx}, ${cz}, ${-Math.atan2(cx, cz - ROW_Z)}, 0, 0)`);
  await g.sleep(1500);
  await g.ev('__sdfGame.setBodyLod({ on: true })'); await g.sleep(700);
  const on = await g.measure(9);
  writeFileSync(`${out}/${name}${TAG}-${d}m-on.png`, await g.shot());
  await g.ev('__sdfGame.setBodyLod({ on: false })'); await g.sleep(700);
  const off = await g.measure(9);
  writeFileSync(`${out}/${name}${TAG}-${d}m-off.png`, await g.shot());
  res.push({ d, on: { fence: +on.fenceMs.toFixed(1), march: on.marchMs }, off: { fence: +off.fenceMs.toFixed(1), march: off.marchMs } });
  console.log(JSON.stringify(res.at(-1)));
}
const info = await g.ev('__sdfGame.bodyLod()');
writeFileSync(`${out}/${name}${TAG}.json`, JSON.stringify({ res, types: info.types }, null, 1));
console.log(JSON.stringify(info.types), JSON.stringify(g.errors().slice(0, 3)));
process.exit(0);
