import {writeFileSync,mkdirSync} from 'node:fs';
import {loadavg} from 'node:os';
import {connectGame,bootCloseupPage,stageCloseUp,applyShipDefaults} from '/Users/donny/Projects/blud/.worktrees/zombie-analytic-normals/scripts/lib/sdf-closeup-stage.mjs';
const out='/tmp/blud-normal-integrated-quick';mkdirSync(out,{recursive:true});
const c=await connectGame({vite:5251,cdp:9251,width:800,height:720,onFail:m=>{throw Error(m)}}),e=c.evaluate;
const report={scope:'Warmed frozen torso smoke comparison; same scene, alternating modes. CPU + GPU completion wall latency, not GPU timestamps or gameplay FPS.',checks:[],legs:[],errors:[]};
const check=(name,pass)=>{report.checks.push({name,pass});if(!pass)throw Error(name)};
try{
 await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{let s=20260906;Math.random=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);const g=navigator.gpu,a=g.requestAdapter;g.requestAdapter=async function(...x){const d=await a.apply(this,x);if(!d)return d;const r=d.requestDevice;d.requestDevice=async function(...x){const v=await r.apply(this,x);window.__quickQueue=v.queue;window.__quickErrors=[];v.addEventListener('uncapturederror',e=>__quickErrors.push(e.error.message));d.requestDevice=r;g.requestAdapter=a;return v};return d}})()`});
 await bootCloseupPage({...c,url:'http://localhost:5251/sdf-game.html?slug&normal-playtest',fail:m=>{throw Error(m)}});
 check('playtest starts analytic',await e('__sdfGame.normalGradientStatus().mode===1&&document.querySelector("[data-normal-playtest]").textContent.includes("Analytic")'));
 await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'n',code:'KeyN'});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'n',code:'KeyN'});
 check('N switches original',await e('__sdfGame.normalGradientStatus().mode===0'));
 await e('document.querySelector("[data-normal-playtest] button").click()');check('button switches analytic',await e('__sdfGame.normalGradientStatus().mode===1'));
 await e('__sdfGame.freeze(true);__sdfGame.setLoopRunning(false)');
 await applyShipDefaults(e);await e('__sdfGame.setAdaptive(false);__sdfGame.setSmear(0);__sdfGame.setNormalGradientDebug(0)');
 report.stage=await stageCloseUp(e,{aimY:1.15},m=>{throw Error(m)});
 for(const scene of ['intact','wounded']){
  if(scene==='wounded')report.wound=await e(`(()=>{const p=__sdfGame.predictSlugHit();if(!p.hit||p.actorId!==${report.stage.body})throw Error('wrong wound target');const hit=__sdfGame.stampWoundAt(...p.origin,...p.dir,'slug',p.actorId);if(!hit)throw Error('no wound');return __sdfGame.debugWounds(p.actorId)})()`);
  report[scene+'Occupancy']=await e('__sdfGame.occupancy()');await e('__sdfGame.setLoopRunning(false)');
  for(let rep=0;rep<3;rep++)for(const mode of rep%2?[1,0]:[0,1]){
   await e(`(async()=>{__sdfGame.setNormalGradient(${mode});for(let i=0;i<60;i++){__sdfGame.step(1,0);await __quickQueue.onSubmittedWorkDone()}})()`);
   const before=loadavg();
   const samples=await e(`(async()=>{const a=[];for(let i=0;i<100;i++){const t=performance.now();__sdfGame.step(1,0);await __quickQueue.onSubmittedWorkDone();a.push(performance.now()-t)}return a})()`);
   const sorted=[...samples].sort((a,b)=>a-b),leg={scene,rep,mode,median:sorted[50],p95:sorted[95],loadBefore:before,loadAfter:loadavg(),samples};report.legs.push(leg);console.log(JSON.stringify({...leg,samples:undefined}));
  }
  for(const mode of [0,1]){await e(`__sdfGame.setNormalGradient(${mode});__sdfGame.step(20,0)`);const s=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${scene}-${mode}.png`,Buffer.from(s.result.data,'base64'));}
 }
 report.errors=await e('__quickErrors');check('no uncaptured GPU errors',report.errors.length===0);
}catch(err){report.failure=String(err.stack??err)}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');await fetch(`http://localhost:9251/json/close/${c.tab.id}`).catch(()=>{});}
console.log(JSON.stringify({checks:report.checks,failure:report.failure}));process.exit(report.failure?1:0);
