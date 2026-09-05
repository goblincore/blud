import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyShipDefaults, stageCloseUp, stampFacingWounds } from './lib/sdf-closeup-stage.mjs';
import { readNormalGates } from './lib/normal-gradient-gates.mjs';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const phase = valueOf('--phase', 'kernel');
const outDir = resolve(valueOf('--out', '/tmp/zombie-normal-gradient'));
const vite = Number(valueOf('--vite', process.env.LAB_VITE_PORT ?? 5233));
const cdp = Number(valueOf('--cdp', process.env.LAB_CDP_PORT ?? 9223));
const negativeControl = argv.includes('--negative-control');
const allowed = new Set(['kernel', 'intact', 'wounds', 'verdict']);
if (!allowed.has(phase)) throw new Error(`unknown phase ${phase}`);
mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)),
]);
const reasonCode = {
  ok: 0, unsupported: 1, degenerate: 2, 'hard-boundary': 3,
  'owner-unstable': 4, 'wound-pending': 5, 'sampled-cache': 6, inactive: 7,
};

let tab = null;
let ws = null;
let seq = 0;
const pending = new Map();
const consoleEvents = [];
let report = {
  version: 1,
  phase,
  negativeControl,
  vite,
  cdp,
  backend: null,
  referenceGate: null,
  passed: false,
  results: [],
  failures: [],
  console: [],
};

const send = (method, params = {}) => withTimeout(new Promise((resolveSend, reject) => {
  const id = ++seq;
  pending.set(id, { resolve: resolveSend, reject });
  ws.send(JSON.stringify({ id, method, params }));
}), 30000, method);

const evaluate = async expression => {
  const response = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1200));
  }
  return response.result?.result?.value;
};

function assess(results) {
  const failures = [];
  const checked = results.map(result => {
    const item = { ...result, comparisons: [] };
    if (!Array.isArray(result.actual) || result.actual.length !== 4) {
      failures.push(`${result.name}: actual output is not four channels`);
      return item;
    }
    if (!result.actual.every(Number.isFinite)) failures.push(`${result.name}: non-finite GPU output`);
    const wantedReason = reasonCode[result.expectedReason];
    if (result.reasonCode !== wantedReason) {
      failures.push(`${result.name}: reason ${result.reasonCode}, expected ${wantedReason} ${result.expectedReason}`);
    }
    if (wantedReason !== 0) {
      if (result.reasonCode === 0) failures.push(`${result.name}: invalid case incorrectly reported ok`);
      return item;
    }
    for (const [source, reference] of [['cpu', result.expected], ['scalar-oracle', result.oracle]]) {
      if (!Array.isArray(reference) || reference.length !== 4 || !reference.every(Number.isFinite)) {
        failures.push(`${result.name}: missing finite ${source} reference`);
        continue;
      }
      for (let channel = 0; channel < 4; channel++) {
        const tolerance = channel === 0
          ? 5e-5 + 1e-4 * Math.abs(reference[channel])
          : 2e-3 + 1e-2 * Math.abs(reference[channel]);
        const error = Math.abs(result.actual[channel] - reference[channel]);
        item.comparisons.push({ source, channel, reference: reference[channel], error, tolerance });
        if (error > tolerance) {
          failures.push(`${result.name}: ${source} channel ${channel} error ${error} > ${tolerance}`);
        }
      }
    }
    return item;
  });
  return { checked, failures };
}

async function runIntact() {
  const gates = await readNormalGates(resolve('docs/dev-notes/2026-09-05-zombie-analytic-normals/gates.json'));
  if (gates.gpuKernel !== 'pass') throw new Error(`gpuKernel gate is ${gates.gpuKernel}`);
  for (let i=0; i<120; i++) {
    if (await evaluate('window.__sdfGame?.backend === "webgpu"')) break;
    await sleep(500);
  }
  if (!await evaluate('window.__sdfGame?.backend === "webgpu"')) throw new Error('game WebGPU boot failed');
  report.backend = 'webgpu';
  report.criteria={depth:'exact float alpha equality',fallbackMax:1e-6,scalarMax:1e-5,legacyStencilAngle:{p99:5,max:25,unit:'degrees'},intactHeadAndTorsoCoverage:.5,otherSceneProbeFloor:.1,ownerLook:'pending',timing:'not measured'};
  await evaluate(`__sdfGame.freeze(true); __sdfGame.setLoopRunning(false); __sdfGame.installDebugProbe()`);
  await applyShipDefaults(evaluate);
  await evaluate(`__sdfGame.step(1); window.__ngClockOriginal = performance.now.bind(performance); window.__ngClock = performance.now(); performance.now = () => window.__ngClock`);
  const frame = async (mode, diagnostic, name) => {
    const r = await evaluate(`__sdfGame.setNormalGradient(${mode}); __sdfGame.setNormalGradientDebug(${diagnostic}); __sdfGameDebug.readMarchTarget()`);
    if (!r?.rgba32f || !(r.w>0 && r.h>0)) throw new Error('missing raw float target');
    const bytes = Buffer.from(r.rgba32f, 'base64');
    if (bytes.length !== r.w*r.h*16) throw new Error('invalid packed float target');
    writeFileSync(resolve(outDir, `${name}.rgba32f`), bytes);
    const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length/4);
    const png = await evaluate(`(() => {
      const raw = Uint8Array.from(atob(${JSON.stringify(r.rgba32f)}), c=>c.charCodeAt(0));
      const data = new Float32Array(raw.buffer);
      const canvas = document.createElement('canvas'); canvas.width=${r.w}; canvas.height=${r.h};
      const ctx=canvas.getContext('2d'); const img=ctx.createImageData(canvas.width,canvas.height);
      const palette=[[10,10,15],[35,220,105],[230,50,55],[255,140,30],[255,230,40],[145,65,220],[30,140,245],[245,70,180],[110,110,110]];
      for(let i=0;i<data.length;i+=4) {
        const rgb=${diagnostic}===2 ? (palette[Math.round(data[i])]??palette[0]) : [data[i]*255,data[i+1]*255,data[i+2]*255];
        img.data[i]=rgb[0];img.data[i+1]=rgb[1];img.data[i+2]=rgb[2];img.data[i+3]=255;
      }
      ctx.putImageData(img,0,0);return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    writeFileSync(resolve(outDir, `${name}.png`), Buffer.from(png,'base64'));
    return { ...r, data, rgba32f:undefined };
  };
  const compare = async (name, expectedReason=null) => {
    const legacy = await frame(0,1,`${name}-legacy-normal`);
    const hybrid = await frame(1,1,`${name}-hybrid-normal`);
    const eligibility = await frame(1,2,`${name}-eligibility`);
    const reasons = Object.fromEntries(Object.keys(reasonCode).map(k=>[k,0]));
    let depthMax=0, depthChanged=0, fallbackMax=0, scalarMax=0, nonFinite=0;
    const angles=[];
    for (let i=0;i<legacy.data.length;i+=4) {
      const delta=Math.abs(legacy.data[i+3]-hybrid.data[i+3]);
      depthMax=Math.max(depthMax,delta); if(delta!==0) depthChanged++;
      const code=Math.round(eligibility.data[i])-1;
      if (code<0||code>7) continue;
      const reason=Object.keys(reasonCode).find(k=>reasonCode[k]===code); reasons[reason]++;
      for(let k=0;k<4;k++) if(!Number.isFinite(legacy.data[i+k])||!Number.isFinite(hybrid.data[i+k])) nonFinite++;
      if(code===0) {
        scalarMax=Math.max(scalarMax,Math.abs(eligibility.data[i+1]));
        const a=Array.from(legacy.data.subarray(i,i+3),v=>v*2-1);
        const b=Array.from(hybrid.data.subarray(i,i+3),v=>v*2-1);
        const cos=a.reduce((v,x,k)=>v+x*b[k],0)/(Math.hypot(...a)*Math.hypot(...b));
        angles.push(Math.acos(Math.max(-1,Math.min(1,cos)))*180/Math.PI);
      } else for(let k=0;k<3;k++) fallbackMax=Math.max(fallbackMax,Math.abs(legacy.data[i+k]-hybrid.data[i+k]));
    }
    angles.sort((a,b)=>a-b);
    const total=Object.values(reasons).reduce((a,b)=>a+b,0);
    const result={name,w:legacy.w,h:legacy.h,total,reasons,analyticFraction:reasons.ok/Math.max(total,1),depthMax,depthChanged,fallbackMax,scalarMax,nonFinite,
      angularDegrees:{count:angles.length,p50:angles[Math.floor(angles.length*.5)]??0,p95:angles[Math.floor(angles.length*.95)]??0,p99:angles[Math.floor(angles.length*.99)]??0,max:angles.at(-1)??0}};
    report.results.push(result);
    if(total<100) report.failures.push(`${name}: insufficient hit pixels ${total}`);
    if(depthChanged||nonFinite||fallbackMax>1e-6||scalarMax>1e-5) report.failures.push(`${name}: numeric mismatch ${JSON.stringify(result)}`);
    if(expectedReason!==null) {
      if(reasons[expectedReason]!==total) report.failures.push(`${name}: expected complete ${expectedReason} fallback`);
    } else {
      const coverageFloor = name === 'head' || name === 'torso' ? .5 : .1;
      if(reasons.ok<100||result.analyticFraction<coverageFloor) report.failures.push(`${name}: analytic coverage below ${coverageFloor}`);
      if(result.angularDegrees.p99>5||result.angularDegrees.max>25) report.failures.push(`${name}: base-normal angular error exceeds 5deg p99 /25deg max`);
    }
    console.log(JSON.stringify(result));
    for(const mode of [0,1]) {
      await evaluate(`__sdfGame.setNormalGradient(${mode});__sdfGame.setNormalGradientDebug(0);__sdfGame.step(1,0)`);
      await sleep(100);
      const shot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(resolve(outDir,`${name}-${mode===0?'legacy':'hybrid'}-beauty.png`),Buffer.from(shot.result.data,'base64'));
    }
  };
  try {
    report.initialStatus=await evaluate('__sdfGame.normalGradientStatus()');
    if(report.initialStatus.mode!==0) throw new Error('gradient does not default off');
    report.staging=[];
    for(const [name,aimY,ladder] of [['whole-body',.95,[2.4]],['torso',1.15,[1.1]],['head',1.65,[.8]]]) {
      const stage=await stageCloseUp(evaluate,{aimY,ladder});report.staging.push({name,...stage});
      await compare(name);
    }
    const body=report.staging[0].body;
    report.material=await evaluate(`(() => { const u=__sdfGame.zombie(${body}).view.uniforms; return {march:u.marchCfg.value.toArray(),surface:u.surfCfg.value.toArray(),surface2:u.surfCfg2.value.toArray(),wound:u.woundCfg.value.toArray(),wound2:u.woundCfg2.value.toArray(),perf:u.perfCfg.value.toArray()}; })()`);
    await evaluate(`performance.now=window.__ngClockOriginal;__sdfGame.freeze(false);__sdfGame.step(20);__sdfGame.freeze(true);performance.now=()=>window.__ngClock`);
    await stageCloseUp(evaluate,{aimY:1.25,ladder:[1.25]});
    report.animatedGeometry=await evaluate(`(() => { const p=__sdfGame.zombie(${body}).posed().prims;return {count:p.length,anisotropic:p.filter(x=>Math.max(...x.scale)-Math.min(...x.scale)>1e-5).length,rotated:p.filter(x=>x.orient&&Math.abs(x.orient[3]-1)>1e-6).length}; })()`);
    await compare('animated-scaled-flesh');
    await evaluate(`__sdfGame.zombie(${body}).view.uniforms.counts2.value.y = 1`);
    await compare('unsupported-bare-bones','unsupported');
    await evaluate(`__sdfGame.zombie(${body}).view.uniforms.counts2.value.y = 0`);
    const stage=await stageCloseUp(evaluate,{aimY:1.1,ladder:[1.45]});
    report.wounds=await stampFacingWounds(evaluate,{offsets:[[0,0,'slug']],minStamped:1});
    await evaluate('__sdfGame.step(30)');
    await compare('mixed-wounded');
    if(!(report.results.at(-1).reasons['wound-pending']>0)) report.failures.push('mixed-wounded: no wound fallback pixels');
    // Shipped-look paired moving-body/flashlight reel, same frozen pose per pair.
    // Clock increments are explicit and restored before this driver exits.
    for(let i=0;i<12;i++) {
      await evaluate(`performance.now=window.__ngClockOriginal;__sdfGame.freeze(false);__sdfGame.step(4);__sdfGame.freeze(true);window.__ngClock+=66.6667;performance.now=()=>window.__ngClock`);
      const z=await evaluate(`__sdfGame.zombies().find(z=>z.id===${body})`);
      const ang=.2*Math.sin(i*.4), distance=1.8;
      const x=z.pos[0]+Math.sin(ang)*distance, zcam=z.pos[2]+Math.cos(ang)*distance;
      await evaluate(`__sdfGame.setPose(${x},${zcam},${ang},${Math.atan2(1.1-1.62,distance)},0)`);
      for(const mode of [0,1]) {
        await evaluate(`__sdfGame.setNormalGradient(${mode});__sdfGame.setNormalGradientDebug(0);__sdfGame.step(1,0)`);
        await sleep(65);
        const shot=await send('Page.captureScreenshot',{format:'png'});
        writeFileSync(resolve(outDir,`motion-${mode}-${String(i).padStart(3,'0')}.png`),Buffer.from(shot.result.data,'base64'));
      }
    }
    report.motion={frames:12,simFramesPerPose:4,legacy:'motion-0-%03d.png',hybrid:'motion-1-%03d.png',description:'Moving rig and camera flashlight around one slug crater; shipped noise/gloss/metal suppression'};
  } finally {
    await evaluate(`if(window.__ngClockOriginal)performance.now=window.__ngClockOriginal;__sdfGame.setNormalGradient(0);__sdfGame.setNormalGradientDebug(0);__sdfGame.setLoopRunning(false)`);
  }
}

try {
  const gates = await readNormalGates(resolve('docs/dev-notes/2026-09-05-zombie-analytic-normals/gates.json'));
  report.referenceGate = gates.reference ?? null;
  if (gates.reference !== 'pass') throw new Error(`reference gate is ${gates.reference ?? 'missing'}, expected pass`);
  tab = await withTimeout(
    fetch(`http://localhost:${cdp}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json()),
    10000,
    'open CDP target',
  );
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await withTimeout(new Promise((open, reject) => {
    ws.onopen = open;
    ws.onerror = () => reject(new Error('CDP websocket failed'));
  }), 10000, 'CDP websocket');
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        type: message.params.type,
        text: message.params.args.map(x => x.value ?? x.description ?? '').join(' '),
      });
    } else if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({ type: 'exception', text: JSON.stringify(message.params.exceptionDetails).slice(0, 1000) });
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', {
    width: phase === 'kernel' ? 1280 : 800, height: phase === 'kernel' ? 900 : 720, deviceScaleFactor: 1, mobile: false,
  });
  const page = phase === 'kernel' ? 'normal-gradient-check.html' : 'sdf-game.html';
  await send('Page.navigate', { url: `http://localhost:${vite}/${page}${phase === 'intact' ? '?frozen=1' : ''}` });

  if (phase === 'intact') {
    await runIntact();
  } else {
  if (phase !== 'kernel') throw new Error(`phase ${phase} is reserved for its dependent task`);
  let status = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    await sleep(250);
    status = await evaluate(`typeof window.__zombieNormalGradient === 'object'
      ? window.__zombieNormalGradient.status() : null`);
    if (status?.phase === 'ready' || status?.phase === 'failed') break;
  }
  if (!status) throw new Error('probe API did not appear');
  if (status.phase !== 'ready') throw new Error(`probe bootstrap ${status.phase}: ${status.error ?? 'unknown'}`);
  if (status.backend !== 'webgpu') throw new Error(`backend ${status.backend}, expected webgpu`);
  report.backend = status.backend;

  const values = await evaluate(`window.__zombieNormalGradient.run({ negateX: ${negativeControl} })`);
  if (!Array.isArray(values) || values.length === 0) throw new Error('probe returned an empty result array');
  if (values.length !== status.count) throw new Error(`probe returned ${values.length} rows, expected ${status.count}`);
  const assessment = assess(values);
  report.results = assessment.checked;
  report.failures.push(...assessment.failures);
  }
  const shaderIssues = consoleEvents.filter(event =>
    event.type === 'error' || event.type === 'exception' ||
    (/warn/i.test(event.type) && /wgsl|shader|webgpu|validation/i.test(event.text)),
  );
  report.console = consoleEvents;
  if (shaderIssues.length) report.failures.push(`shader console is not clean: ${JSON.stringify(shaderIssues.slice(0, 4))}`);
  report.passed = report.failures.length === 0;

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(resolve(outDir, 'numeric-visualization.png'), Buffer.from(shot.result.data, 'base64'));
} catch (error) {
  report.failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  report.passed = false;
} finally {
  report.console = consoleEvents;
  writeFileSync(resolve(outDir, `${phase}.json`), `${JSON.stringify(report, null, 2)}\n`);
  if (ws) ws.close();
  if (tab?.id) {
    try {
      execFileSync('curl', ['-s', '-m', '3', `http://localhost:${cdp}/json/close/${tab.id}`], { stdio: 'ignore' });
    } catch { /* closing an already-gone target is harmless */ }
  }
}

for (const result of report.results) {
  if(phase==='kernel') console.log(`${result.name}: actual=${JSON.stringify(result.actual)} reason=${result.reasonCode} expected=${result.expectedReason}`);
}
if (report.passed) {
  console.log(`${phase.toUpperCase()} PASS: ${report.results.length} named cases; evidence ${outDir}`);
} else {
  console.error(`${phase.toUpperCase()} FAIL: ${report.failures.join(' | ')}`);
  process.exitCode = 1;
}
