// Functional WebGPU/recording gate, deliberately no performance comparisons.
// Start Vite and an isolated CDP Chrome, then: node scripts/game-tiles-telemetry-check.mjs 5299 9299
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const vite = Number(process.argv[2] ?? 5299), cdp = Number(process.argv[3] ?? 9299);
const out = 'docs/dev-notes/2026-09-06-game-tiles-telemetry';
mkdirSync(out, { recursive: true });
const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, {method:'PUT'})).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r,j) => { ws.onopen=r; ws.onerror=j; });
const pending = new Map(); let seq=0;
const errors = [], checks = [];
ws.onmessage = e => {
  const m=JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (m.method==='Runtime.consoleAPICalled' && m.params.type==='error') errors.push(m.params.args.map(a=>a.value??a.description));
};
const send=(method,params={})=>new Promise(r=>{ const id=++seq; pending.set(id,r); ws.send(JSON.stringify({id,method,params})); });
const evaluate=async expression=>{
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,timeout:120000});
 if(r.error||r.result?.exceptionDetails) throw new Error(JSON.stringify(r));
 return r.result?.result?.value;
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,detail)=>{checks.push({name,detail});console.log('PASS',name,JSON.stringify(detail));};
const key=async code=>{await send('Input.dispatchKeyEvent',{type:'keyDown',code,key:code});await send('Input.dispatchKeyEvent',{type:'keyUp',code,key:code});};
async function boot(query) {
 await send('Page.navigate',{url:`http://127.0.0.1:${vite}/sdf-game.html?slug&${query}`});
 for(let i=0;i<240;i++){
  await sleep(500);
  if(await evaluate('!!window.__sdfGame'))return;
  if(errors.length)throw new Error(JSON.stringify(errors));
 }
 throw new Error('Boot timeout');
}
try {
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await boot('tiles-playtest'); await sleep(1500);
 const tiles=await evaluate('__sdfGame.tiles()');
 assert.equal(tiles.enabled,true);assert.ok(tiles.active>0);assert.equal(tiles.active,tiles.bound);
 check('tiles-enabled-all-actors',tiles);
 await key('F8');await sleep(500);
 await key('F9');await key('F6');await sleep(250);
 assert.equal((await evaluate('__sdfGame.tiles()')).active,0);
 await key('F6');await sleep(250);
 assert.ok((await evaluate('__sdfGame.tiles()')).active>0);
 check('live-tile-toggle',await evaluate('__sdfGame.tiles()'));
 await evaluate('__sdfGame.freeze(true); __sdfGame.teleport(1);');
 // Aim using the game's own camera/weapon predictor, then let natural frames advance the shot.
 await sleep(300);
 const aiming=await evaluate(`(()=>{const g=__sdfGame;const z=g.zombies().find(a=>a.room===1);g.setPose(z.pos[0],z.pos[2]+2.2,0,0);return z.id;})()`);
 await sleep(300);
 assert.equal(await evaluate('__sdfGame.aimSurface("torso")'),true);
 await sleep(300);
 assert.equal(await evaluate('__sdfGame.fireSlug()'),true);
 await sleep(1500);
 check('natural-slug-fired',{actor:aiming});
 await key('F9');
 await evaluate('__sdfGame.setSdfScale(0.5)');await sleep(300);
 assert.ok((await evaluate('__sdfGame.tiles()')).active>0);
 await evaluate('__sdfGame.setSdfScale(1)');await sleep(300);
 check('resolution-change',await evaluate('__sdfGame.tiles()'));
 const beforeRebuild=await evaluate('__sdfGame.tiles().bound');
 await evaluate('__sdfGame.setWoundTuning({boneRatio:0.25})');await sleep(500);
 const rebuilt=await evaluate('__sdfGame.tiles()');assert.equal(rebuilt.bound,beforeRebuild);assert.equal(rebuilt.active,rebuilt.bound);
 check('cast-rebuild-retains-tiles',rebuilt);
 await key('F8');await sleep(700);
 const capture=await evaluate('__sdfGame.telemetry.lastCapture()');
 assert.ok(capture.frames.length>0);assert.ok(capture.snapshots.length>=2);
 assert.ok(capture.events.some(e=>e.name==='tile-culling'));
 const impact=capture.events.find(e=>e.name==='impact' && e.detail.stamped);
 assert.ok(impact,'natural slug produced impact');
 assert.equal(impact.detail.world.length,3);assert.equal(impact.detail.wound.local.length,3);
 assert.ok(impact.detail.wound.region);assert.ok(capture.events.some(e=>e.name==='actor-wounds'));
 check('wound-location-recorded',{region:impact.detail.wound.region,world:impact.detail.world,local:impact.detail.wound.local});
 assert.ok(capture.snapshots[0].detail.actors[0].prims.length>0);
 assert.ok(capture.frames.every(f=>f.state.tiles));
 assert.ok((await evaluate('document.body.innerText')).includes('Saved telemetry/'));
 check('natural-recording-saved',{frames:capture.frames.length,snapshots:capture.snapshots.length,events:capture.events.length});
 writeFileSync(`${out}/functional-capture.json`,JSON.stringify(capture));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 writeFileSync(`${out}/playtest.png`,Buffer.from(shot.result.data,'base64'));
 await boot('');await sleep(500);
 const normal=await evaluate('__sdfGame.tiles()');
 assert.equal(normal.allowed,false);assert.equal(normal.bound,0);assert.equal(normal.active,0);
 check('ordinary-launch-has-no-tile-bindings',normal);
 assert.deepEqual(errors,[]);
 check('no-page-or-WebGPU-errors',{});
} finally {
 writeFileSync(`${out}/functional-check.json`,JSON.stringify({checks,errors},null,2));
 await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`);ws.close();
}
