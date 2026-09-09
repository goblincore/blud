// scripts/wound-panel-verify.mjs — wound pass r2 task 8's step-6 gate:
// does the wound tuning panel actually DRIVE the shader, and does COPY
// round-trip?
//
// Per the plan's verification rules this is NOT a pixel-diff gate (the
// turntable noise floor is 52-82k px — bigger than anything here). It is:
//   1. CPU assertions: the seam's record AND the live surfCfg3 uniform from
//      body 1, read before/after setWoundTuning — the uniform moving is the
//      "panel drives the shader" proof.
//   2. The owner's COPY flow end-to-end: click the panel's copy button,
//      take the text it logs to the console, EVALUATE that text, and require
//      the record to come back identical (no unknown-key no-ops).
//   3. Structural A/B captures of one stamped wound at fatDepth 0.004 vs
//      0.03 (read and describe the band; do not count pixels).
//   4. boneRatio: a real rebuild through spawnZombie — cast size, player
//      pose and march occupancy must survive it, and on-body wounds are
//      expected to reset (documented cost).
//
//   scripts/wound-panel-verify.sh   # -> /tmp/wound-panel-verify/*.png + log
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const VITE=Number(process.argv[2]??5233), CDP=Number(process.argv[3]??9223);
const OUT=process.env.LOOK_OUT ?? '/tmp/wound-panel-verify';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await (await fetch(`http://localhost:${CDP}/json/new?about:blank`,{method:'PUT'})).json();
process.on('exit',()=>{try{execFileSync('curl',['-s','-m','2',`http://localhost:${CDP}/json/close/${tab.id}`],{stdio:'ignore'});}catch{}});
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,err)=>{ws.onopen=ok;ws.onerror=err;});
let seq=0;const pend=new Map();const errs=[];const consoleLogs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;}
  if(m.method==='Runtime.exceptionThrown')errs.push(JSON.stringify(m.params.exceptionDetails).slice(0,300));
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='log')
    consoleLogs.push(m.params.args.map(a=>a.value??a.description??'').join(' '));};
const send=(method,params={})=>new Promise(res=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
  if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const shot=async name=>{const s=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${OUT}/${name}.png`,Buffer.from(s.result.data,'base64'));};
const fail=msg=>{console.error('FAIL:',msg);process.exitCode=1;};
mkdirSync(OUT,{recursive:true});
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:`http://localhost:${VITE}/sdf-game.html`});
for(let i=0;i<600;i++){await sleep(200);if(await ev('typeof window.__sdfGame === "object"'))break;}
if(!(await ev('typeof window.__sdfGame === "object"'))){console.error('never booted',errs);process.exit(1);}
await ev('typeof window.__sdfGame.gooPanel === "function" && window.__sdfGame.gooPanel(false)');
await ev('typeof window.__sdfGame.vhsPanel === "function" && window.__sdfGame.vhsPanel(false)');

// ---- 1. The panel exists in the DOM: 5 sliders, preset + copy buttons ----
// Panels ship VISIBLE but COLLAPSED (panel-chrome.ts) — only the title bar
// shows until expanded, so the sliders and the capture below both need the
// panel opened first, not just made visible.
await ev('window.__sdfGame.woundPanel(true)');
await ev('window.__sdfGame.woundPanelCollapsed(false)');
const ui=await ev(`(() => {
  const panels=[...document.querySelectorAll('[data-panel="WOUND TUNING"]')].filter(d=>d.querySelector('input[type=range]'));
  const p=panels[panels.length-1];
  if(!p) return null;
  return {
    sliders: p.querySelectorAll('input[type=range]').length,
    buttons: [...p.querySelectorAll('button')].map(b=>b.textContent),
    labels: [...p.querySelectorAll('span')].slice(0,5).map(s=>s.textContent),
  };
})()`);
console.log('panel UI:', JSON.stringify(ui));
if(!ui||ui.sliders!==5) fail('panel does not show 5 sliders');
if(!ui||!ui.buttons.includes('copy')) fail('panel has no copy button');
await ev('window.__sdfGame.woundPanelCollapsed(false)'); // stays expanded for the shot
await shot('panel-open');
await ev('window.__sdfGame.woundPanel(false)');

// ---- 2. CPU assertions: defaults, then a slider write reaching the field ----
const def=await ev('window.__sdfGame.woundTuning');
console.log('defaults:', JSON.stringify(def));
if(def.fatDepth!==0.004||def.muscleDepth!==0.014||def.woundDepthAmp!==1||def.woundFibreAmp!==0.6||def.boneRatio!==0.38)
  fail('record defaults are not the shipped tuning');
if(JSON.stringify(def.surfCfg3)!=='[1,0.004,0.014,0.6]')
  fail(`body-1 surfCfg3 does not match the record: ${JSON.stringify(def.surfCfg3)}`);

const afterFat=await ev('window.__sdfGame.setWoundTuning({ fatDepth: 0.03 })');
console.log('after setWoundTuning({fatDepth:0.03}):', JSON.stringify(afterFat));
if(afterFat.fatDepth!==0.03) fail('record did not take fatDepth');
if(afterFat.surfCfg3?.[1]!==0.03) fail(`uniform did not move: ${JSON.stringify(afterFat.surfCfg3)}`);
console.log('PASS: slider write reached body-1 surfCfg3.y');

// ---- 3. The owner's COPY flow: click the button, paste what it logs ----
const copied=await ev(`(() => {
  const panels=[...document.querySelectorAll('[data-panel="WOUND TUNING"]')].filter(d=>d.querySelector('input[type=range]'));
  const p=panels[panels.length-1];
  const btn=[...p.querySelectorAll('button')].find(b=>b.textContent==='copy');
  btn.click();
  return true;
})()`);
await sleep(100);
const copyText=consoleLogs.find(l=>l.includes('__sdfGame.setWoundTuning('));
console.log('COPY button logged:', JSON.stringify(copyText));
if(!copyText) fail('copy button produced no setWoundTuning text');
else {
  for(const k of ['woundDepthAmp','fatDepth','muscleDepth','woundFibreAmp','boneRatio'])
    if(!copyText.includes(k)) fail(`COPY text missing ${k}`);
  const pasted=await ev(copyText); // the owner pastes; must apply cleanly
  console.log('paste round-trip:', JSON.stringify(pasted));
  if(pasted.fatDepth!==0.03||pasted.muscleDepth!==0.014||pasted.woundDepthAmp!==1
     ||pasted.woundFibreAmp!==0.6||pasted.boneRatio!==0.38)
    fail(`pasted COPY did not reproduce the tuned record: ${JSON.stringify(pasted)}`);
  else console.log('PASS: COPY → paste reproduces the panel state exactly');
}

// ---- 4. Structural A/B: one wound, fat knee default vs deep ----
await ev('window.__sdfGame.freeze(true)');
await ev('window.__sdfGame.setLoopRunning(false)');
await ev('window.__sdfGame.setBleed(false)');   // no droplets/splats in the A/B
await ev('window.__sdfGame.setGoo(false)');     // no metaball pass either
const stage=await ev(`(() => {
  // aimSurface's predictor rejects some geometries; sweep zombies x offsets
  // until one lands. (Pure +-z stagings fail its yaw sweep — offset ones.)
  const offs=[[3,0],[-3,0],[0,3],[0,-3],[2.5,1.5],[-2.5,-1.5],[1.5,2.5]];
  for (const z of window.__sdfGame.zombies()) {
    for (const [ox,oz] of offs) {
      window.__sdfGame.setPose(z.pos[0]+ox, z.pos[2]+oz, 0, 0);
      if (window.__sdfGame.aimSurface()) {
        const hit=window.__sdfGame.fireSlug();
        if (hit) return { zid: z.id, ox, oz, pos: z.pos, me: window.__sdfGame.pose() };
      }
    }
  }
  return null;
})()`) || null;
console.log('stage:', JSON.stringify(stage));
if(!stage){ fail('no zombie x offset produced a landed slug'); }
await ev('window.__sdfGame.step(2)');
if(stage){
// Close-up: 0.75 m in front of the body, eye on the wound (torso ~1.05 m).
await ev(`(() => {
  const z=window.__sdfGame.zombies().find(q=>q.id===${stage.zid});
  const dx=${stage.me.pos[0]}-z.pos[0], dz=${stage.me.pos[2]}-z.pos[2];
  const l=Math.hypot(dx,dz)||1;
  window.__sdfGame.setPose(z.pos[0]+dx/l*0.75, z.pos[2]+dz/l*0.75, Math.atan2(-dx/l,-dz/l), 0, 1.0);
  window.__sdfGame.step(2);
})()`);
}
await shot('wound-fat-default');
const wc=stage?await ev(`window.__sdfGame.zombie(${stage.zid}).woundCount()`):0;
console.log('wounds on body', stage&&stage.zid, ':', wc);
if(stage&&wc<1) fail('no wound stamped — A/B would be empty');
await ev('window.__sdfGame.setWoundTuning({ fatDepth: 0.03 })');
await ev('window.__sdfGame.step(1)');
await shot('wound-fat-deep');
console.log('captures: wound-fat-default.png / wound-fat-deep.png');

// ---- 5. boneRatio: a real rebuild through the boot spawn path ----
const beforeCast=await ev('({ n: window.__sdfGame.zombies().length, me: window.__sdfGame.pose() })');
const afterBone=await ev('window.__sdfGame.setWoundTuning({ boneRatio: 0.7 })');
console.log('after setWoundTuning({boneRatio:0.7}):', JSON.stringify(afterBone));
if(afterBone.boneRatio!==0.7) fail('record did not take boneRatio');
const afterCast=await ev('({ n: window.__sdfGame.zombies().length, me: window.__sdfGame.pose() })');
if(afterCast.n!==beforeCast.n) fail(`cast size changed: ${beforeCast.n} -> ${afterCast.n}`);
if(Math.hypot(afterCast.me.pos[0]-beforeCast.me.pos[0],afterCast.me.pos[2]-beforeCast.me.pos[2])>1e-6)
  fail('player pose moved across the rebuild');
const wcAfter=await ev(`(() => { const z=window.__sdfGame.zombie(${stage?stage.zid:-1}); return z?z.woundCount():'gone'; })()`);
console.log('staged body after rebuild:', JSON.stringify(wcAfter), '(gone/0 both fine — old ids retire, wounds reset)');
if(wcAfter!==0&&wcAfter!=='gone') fail('old wound survived a body rebuild — stale prim indices');
const occ=await ev('window.__sdfGame.occupancy()');
console.log('occupancy after rebuild:', JSON.stringify(occ));
if(!(occ.hits>0)) fail('march hits nothing after rebuild — field is broken');
await ev('window.__sdfGame.setWoundTuning({ boneRatio: 0.38 })');
await ev('window.__sdfGame.step(1)');
await shot('after-rebuild');
console.log('PASS: boneRatio rebuild kept cast, pose and a live field');

if(errs.length){console.error('PAGE ERRORS:',errs);process.exitCode=1;}
else console.log('no page exceptions');
console.log('done. shots in', OUT);
