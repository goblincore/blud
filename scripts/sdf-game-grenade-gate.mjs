// Grenade flight/bounce/embed/blast visual gate. Own tab, bounded CDP, warm-ready required.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { waitForLoader } from './lib/wait-loader.mjs';

const VITE = Number(process.argv[2] ?? 5294);
const CDP = Number(process.argv[3] ?? 9294);
const OUT = process.env.GAME_OUT ?? 'docs/dev-notes/2026-09-29-launcher-projectile/runtime';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const sendRaw = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const send = (method, params = {}) => withTimeout(sendRaw(method, params), 30000, method);
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

/** A crashed/tab-busy target never answers a CDP request — every await needs
 *  a bound, or the driver hangs forever with zero diagnostics. */
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}

mkdirSync(OUT, { recursive: true });
let shotCount = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  shotCount++;
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html?launcher=1&god&seed=20260929&vhs=off`;
await send('Page.navigate', { url });
await waitForLoader(evaluate, { timeoutSec: 300, settleMs: 500 });
const warm = await evaluate('window.__warmGate');
if (warm?.phase !== 'ready') fail(`warm gate ${JSON.stringify(warm)}`);
for (const panel of ['woundPanel','gooPanel','vhsPanel','lightLayersPanel','dynamitePanel','shutterPanel']) await evaluate(`__sdfGame.${panel}?.(false)`);
await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.setFreeAim(false); __sdfGame.setLightClockFrozen?.(true)');
const report = { warm, warmDone: await evaluate('__sdfGame.warmDone()'), samples: [], errors: [] };
const advance = async (t) => evaluate(`__sdfGame.step(${Math.round(t*120)},1/120)`);
async function sample(name) {
  const s = await evaluate('__sdfGame.grenades()');
  report.samples.push({ name, ...s }); await shot(name); return s;
}
await advance(.1);
await sample('idle');
const clips = process.env.GRENADE_CLIP === '1';
const frames = `${OUT}/clip-frames`;
let frame = 0;
async function recordFrame() {
  if (!clips) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${frames}/${String(frame++).padStart(4,'0')}.png`, Buffer.from(r.result.data,'base64'));
}
if (clips) { mkdirSync(frames, {recursive:true}); for(let i=0;i<6;i++) await recordFrame(); }
if (!(await evaluate('__sdfGame.fireLauncher()'))) fail('actual fire refused');
const spawn = await sample('muzzle');
if (spawn.live.length !== 1 || !spawn.live[0].visible) fail('no visible live muzzle projectile');
await advance(.075); await sample('flight');
await recordFrame();
if (clips) { for (let i=0;i<64;i++) { await advance(1/30); await recordFrame(); } }
else await advance(2.125);
const fired = await sample('fire-resolved');
if (fired.detonations !== 1 || fired.live.length) fail('live shot did not resolve its fuse');

// A controlled floor shot uses the same pool, physics, damage and visual path.
const origin = await evaluate('(()=>{const p=__sdfGame.pose().pos;return [p[0]+.65,.22,p[2]]})()');
await evaluate(`__sdfGame.launchGrenade(${JSON.stringify(origin)},[0,-2,2])`);
await advance(.15); const bounce = await sample('floor-bounce');
if (!(bounce.live[0]?.bounces > 0) || bounce.live[0].detonated) fail('floor contact did not bounce');
await evaluate('__sdfGame.selectSlot("shotgun")');
await advance(1.7);
const holster = await sample('holstered-explosion');
if (holster.live.length || holster.detonations !== 2) fail('holstering stopped the fuse');
await evaluate('__sdfGame.selectSlot("launcher")'); await advance(.8);

// Pick a torso surface from actual posed flesh, no fixed enemy coordinates.
const target = await evaluate(`(()=>{
 const list=__sdfGame.zombies();
 const a=list.find(a=>{const b=__sdfGame.zombie(a.id)?.posed();return b?.clusters.some(c=>c.limb==='torso'&&c.alive)});
 if(!a) return null;
 const c=__sdfGame.zombie(a.id).posed().clusters.find(c=>c.limb==='torso'&&c.alive).center;
 return {id:a.id,point:[...c],actor:a};
})()`);
if (!target) fail('no live flesh target');
report.target = target;
// Stage next to the chosen actor and fire a direct segment at its drawn torso.
await evaluate(`__sdfGame.placePlayer({x:${target.point[0]-.5},z:${target.point[2]+1.6},yaw:.15,pitch:-.32})`);
await advance(.025);
const directOrigin = [target.point[0], target.point[1], target.point[2]+.7];
if (clips) for(let i=0;i<6;i++) await recordFrame();
await evaluate(`__sdfGame.launchGrenade(${JSON.stringify(directOrigin)},[0,0,-10])`);
for(let i=0;i<9;i++) {await advance(1/120); await recordFrame();}
const embedded = await sample('embedded');
const stuck = embedded.live.find(g=>g.embedded===target.id);
if (!stuck) fail(`direct flesh hit did not embed: ${JSON.stringify(embedded)}`);
if (!(stuck.anchorErrorM < .002)) fail('attachment drift at hit');
await evaluate(`__sdfGame.freeze(false); __sdfGame.zombieNudge(${target.id},.15,0)`);
await advance(.075); await evaluate('__sdfGame.freeze(true)'); const moved = await sample('embedded-moving');
if (!(moved.live[0]?.anchorErrorM < .002)) fail('attachment did not follow moved flesh');
const shift = Math.hypot(...moved.live[0].pos.map((v,i)=>v-stuck.pos[i]));
report.attachmentShiftM = shift;
if (!(shift > .01)) fail('attachment test did not actually move the struck flesh');
const previousBlast = await evaluate('__sdfGame.dynamite().detonations');
if(clips) {for(let i=0;i<43;i++){await advance(1/30); await recordFrame();} await advance(1/60);}
else await advance(1.45);
const burst = await sample('embedded-blast'); await recordFrame();
if (burst.detonations !== 3 || burst.lastExplosion.embedded !== target.id || burst.fragments === 0) fail('embedded explosion/fragments missing');
await advance(.25); await sample('fragment-flight');
await advance(.6); const done = await sample('gore-settled');
if(clips) {
 for(let i=0;i<25;i++){await advance(1/30); await recordFrame();}
 execFileSync('ffmpeg',['-y','-framerate','30','-i',`${frames}/%04d.png`,'-vf','scale=900:-2','-c:v','libx264','-pix_fmt','yuv420p',`${OUT}/grenade-gameplay.mp4`],{stdio:'ignore'});
 rmSync(frames,{recursive:true,force:true});
}
if (done.live.length || done.fragments) fail('expired projectiles/fragments remain');
if (!(done.fragmentHits > 0)) fail('no fragment wounds reached the actor damage path');
const actualBlast = await evaluate('__sdfGame.dynamite()'); report.blast = actualBlast;
if (actualBlast.detonations <= previousBlast) fail('shared blast resolver not called');

report.errors = consoleEvents.filter(e => e.type === 'error' || e.type === 'exception');
writeFileSync(`${OUT}/gate.json`,JSON.stringify(report,null,2)+'\n');
if (report.errors.length) fail(`console/GPU errors: ${JSON.stringify(report.errors.slice(-3))}`);
console.log(`PASS: ${shotCount} images; flight/bounce/embed/blast gates green; drawOnce ${report.warmDone?.phases?.drawOnce?.toFixed(1)} ms`);
ws.close(); process.exit(0);
