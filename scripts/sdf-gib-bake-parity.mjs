// Same-pose WebGPU comparison of the retained SDF view and its settled mesh.
// Run with lab-servers.sh: node scripts/sdf-gib-bake-parity.mjs VITE CDP OUT
import { decodePng } from './lib/demo-presented.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [vite = '5418', cdp = '9418', out = '/tmp/blud-gib-parity/after'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, e) => { ws.onopen = r; ws.onerror = e; });
let seq = 0; const pending = new Map(), errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params);
  if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !m.params.entry.url?.endsWith('/favicon.ico'))) errors.push(m.params);
};
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r));
  return r.result?.result?.value;
};
const watchdog = setTimeout(() => { console.error('parity capture timed out'); process.exit(1); }, 180000);
try {
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?room=arena&frozen=1&vhs=off&chunkbake=0&seed=623784120${process.env.DEFERRED ? "&renderer=deferred" : ""}` });
  for (let i = 0; i < 240; i++) {
    if (await ev('!!window.__sdfGame?.gunReady')) break;
    if (i === 239) throw new Error('game did not boot');
    await pause(250);
  }
  console.log("booted");
  await ev(`(() => {
    const g = __sdfGame; g.setLoopRunning(false); g.setDemoHold(true); g.setVhs(null);
    g.setAdaptive(false); g.step(5);
    const a = g.actorList().find(a => a.room === 6 && a.kind === 'zombie');
    ${process.env.SYNTH ? 'g.spawnTestChunk(23, .2, -9.6, .25, true);' : 'g.detonate(a.pos[0], a.pos[1] + .6, a.pos[2]);'} g.step(240);
    g.setPose(${process.env.SIDE ? '24, -7.7, -.46, -.56' : '23, -7.7, 0, -.62'});
  })()`);
  await ev('__sdfGame.step(2); __sdfGame.resolveGpu()');
  await pause(100);
  writeFileSync(`${out}/pre-bake.png`, Buffer.from(await ev('__sdfGame.presentedShot()'), 'base64'));
  await ev('__sdfGame.setChunkBake(true)');
  console.log('settled, baking');
  for (let i = 0; i < 150; i++) {
    await ev('__sdfGame.step(1)'); await pause(60);
    const s = await ev('__sdfGame.chunkStats()');
    if (s.bakeError) throw new Error(s.bakeError);
    if (s.baked === (process.env.SYNTH ? 1 : 12) && s.pendingBake === null) break;
    if (i === 149) throw new Error(`expected 12 flesh bakes: ${JSON.stringify(s)}`);
  }
  const head = process.env.HEAD ? await ev(`(() => {
    const g = __sdfGame;
    const p = g.chunkStats().pieces.find(p => g.normalGradientPiece('chunk:' + p.id).uniforms.faceCfg.value.x > .5);
    if (!p) throw new Error('no baked head');
    const u = g.normalGradientPiece('chunk:' + p.id).uniforms;
    const [x,y,z,w] = u.headQuat.value.toArray();
    const f = [2*(x*z+w*y), 2*(y*z-w*x), 1-2*(x*x+y*y)];
    if (f[1] < .2) throw new Error('seeded head faces the floor');
    const h = u.headCentre.value.toArray(), d = Math.max(2.7, (1.8-h[1])/f[1]);
    const eye = h.map((v,i) => v + f[i]*d);
    g.setPose(eye[0],eye[2],Math.atan2(-f[0],f[2]),Math.asin(-f[1]),eye[1]-1.62);
    // Zoom without changing the default SDF/upscaler configuration.
    g.setRenderFov(18); g.setFisheye(18); g.step(1);
    return p.id;
  })()`) : null;
  await ev('__sdfGame.setRenderLock(true)');
  const report = { stats: await ev('__sdfGame.chunkStats()'), albedo: await ev('__sdfGame.bakedAlbedoStats()') };
  const shots = {};
  for (const [name, reference] of [['marched', true], ['baked', false]]) {
    await ev(`__sdfGame.setBakedChunkReference(${reference});
      ${head === null ? '' : `__sdfGame.chunkStats().pieces.forEach(p => {
        if(p.id !== ${head}) { __sdfGame.setChunkVisible(p.id, false); __sdfGame.normalGradientPiece('chunk:' + p.id).object.visible = false; }
      });`}
      __sdfGame.step(2)`);
    await ev('__sdfGame.resolveGpu()');
    await pause(100);
    const png = await ev('__sdfGame.presentedShot()');
    if (!png) throw new Error('no presented canvas');
    shots[name] = decodePng(Buffer.from(png, 'base64'));
    writeFileSync(`${out}/${name}.png`, Buffer.from(png, 'base64'));
  }
  await ev('__sdfGame.chunkStats().pieces.forEach(p => __sdfGame.setChunkVisible(p.id, false)); __sdfGame.step(2); __sdfGame.resolveGpu()');
  const bg = decodePng(Buffer.from(await ev('__sdfGame.presentedShot()'), 'base64'));
  const sums = { marched: [0, 0, 0], baked: [0, 0, 0] };
  let pixels = 0, mae = 0;
  for (let i = 0; i < bg.data.length; i += 4) {
    const visible = name => [0, 1, 2].reduce((s, k) => s + Math.abs(shots[name].data[i + k] - bg.data[i + k]), 0) > 30;
    if (!visible('marched') || !visible('baked')) continue;
    pixels++;
    for (let k = 0; k < 3; k++) {
      sums.marched[k] += shots.marched.data[i + k]; sums.baked[k] += shots.baked.data[i + k];
      mae += Math.abs(shots.marched.data[i + k] - shots.baked.data[i + k]);
    }
  }
  report.comparison = { pixels, meanRGB: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v.map(x => +(x / pixels).toFixed(1))])), meanAbsoluteError: +(mae / (3 * pixels)).toFixed(2) };
  report.errors = errors;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (pixels < 1000) throw new Error('missing live or baked reference coverage; see report.json');
  if (head !== null) {
    report.head = head;
    report.recycle = await ev(`(() => {
      const g = __sdfGame, before = g.chunkDetailApplied().length;
      g.setBakedChunkReference(false); g.setChunkBake(false);
      for (let i=0;i<128 && g.chunkStats().pieces.some(p=>p.id===${head});i++) g.spawnTestChunk(23,.2,-9.6,.1,true);
      return { before, after:g.chunkDetailApplied().length, headRetired: !g.chunkStats().pieces.some(p=>p.id===${head}) };
    })()`);
    if (!report.recycle.headRetired || report.recycle.after !== report.recycle.before - 1) throw new Error('head material recycling: ' + JSON.stringify(report.recycle));
  }
  report.errors = errors;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log(JSON.stringify({ baked: report.stats.baked, errors: errors.length, comparison: report.comparison, out }));
} finally {
  clearTimeout(watchdog); ws.close();
  if (process.env.KEEP) writeFileSync('/tmp/blud-gib-tab.json', JSON.stringify(tab));
  else await fetch(`http://localhost:${cdp}/json/close/${tab.id}`);
}
