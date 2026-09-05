// scripts/goo-smoke.mjs — quick boot + seam + staging probe (task 4).
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';
import { writeFileSync } from 'node:fs';

const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const VITE = Number(process.argv[2] ?? 5397);
const CDP = Number(process.argv[3] ?? 9397);
const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const ev = conn.evaluate;
await bootCloseupPage({ send: conn.send, evaluate: ev, url: `http://localhost:${VITE}/sdf-game.html?frozen=1`, fail });
await applyShipDefaults(ev);
console.log('goo:', await ev('JSON.stringify(__sdfGame.goo)'));
console.log('perf defaults:', await ev('JSON.stringify(__sdfGame.goo.perf)'));
console.log('setGooPerf on:', await ev('__sdfGame.setGooPerf({ surfaceAtDensityRes: true })'));
console.log('setGooPerf off:', await ev('__sdfGame.setGooPerf({ surfaceAtDensityRes: false })'));

const stage = `
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find(q => q.room === 1);
  const ex = z.pos[0], ez = z.pos[2] + 1.1;
  __sdfGame.setPose(ex, ez, 0, 0.05, 0);
  __sdfGame.step(10);
  __sdfGame.fireSlug();
  __sdfGame.step(36);
  return 1;
`;
await ev(`(async () => { ${stage} })()`);
const probe = JSON.parse(await ev('JSON.stringify(await __sdfGame.gooProbe())'));
console.log('probe seam-off: live', probe.liveCount, 'dens max', probe.density.max.toFixed(2), 'nonzero', probe.density.nonZero);

await ev('__sdfGame.setGooPerf({ surfaceAtDensityRes: true })');
await ev('__sdfGame.step(2)');
const probe2 = JSON.parse(await ev('JSON.stringify(await __sdfGame.gooProbe())'));
console.log('probe seam-on: live', probe2.liveCount, 'dens max', probe2.density.max.toFixed(2));
await sleep(400);
const s = await conn.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/goo-smoke-on.png', Buffer.from(s.result.data, 'base64'));
await ev('__sdfGame.setGooPerf({ surfaceAtDensityRes: false })');
await ev('__sdfGame.step(2)');
await sleep(400);
const s2 = await conn.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/goo-smoke-off.png', Buffer.from(s2.result.data, 'base64'));
console.log('shots saved');
