import { writeFileSync } from 'node:fs';
import { connectGame, bootCloseupPage, stageCloseUp } from '../../../scripts/lib/sdf-closeup-stage.mjs';
const vite=Number(process.env.LAB_VITE_PORT ?? 5289),cdp=Number(process.env.LAB_CDP_PORT ?? 9225);
const c=await connectGame({vite,cdp,width:900,height:650,onFail:m=>{throw Error(m)}});
const report={scope:'Opt-in bounded analytic torso game preview; correctness only, no timing claim',errors:[]};
const save=(name,value)=>writeFileSync(new URL(name,import.meta.url),value);
try {
 await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__previewErrors=[];window.addEventListener('error',e=>__previewErrors.push(e.message));window.addEventListener('unhandledrejection',e=>__previewErrors.push(String(e.reason)));const old=console.error;console.error=(...args)=>{__previewErrors.push(args.map(String).join(' '));old(...args)};`});
 await bootCloseupPage({...c,url:`http://localhost:${vite}/sdf-game.html?bounded-wounds&frozen&slug&res=540p`,fail:m=>{throw Error(m)}});
 await c.evaluate('__sdfGame.setBleed(false);__sdfGame.setWoundTuning({ spillChance: 0 })');
 report.staged=await stageCloseUp(c.evaluate,{ladder:[1.2],aimY:1.22});
 report.before=await c.evaluate(`__sdfGame.zombie(${report.staged.body}).visualWoundList()`);
 for(const hits of [1,20]) {
   report['hits'+hits]=await c.evaluate(`(()=>{const id=${report.staged.body},z=__sdfGame.zombies().find(z=>z.id===id),p=__sdfGame.pose(),eye=[p.pos[0],1.62,p.pos[2]],target=[z.pos[0],1.22,z.pos[2]];const v=target.map((x,i)=>x-eye[i]),l=Math.hypot(...v);let count=0;for(let i=0;i<${hits};i++)if(__sdfGame.stampWoundAt(...eye,...v.map(x=>x/l),'pellet',id))count++;__sdfGame.step(24);const a=__sdfGame.zombie(id),tex=a.view.dataTexture.image.data;return {count,gameplay:a.woundCount(),visual:a.visualWoundList(),uploaded:a.view.uniforms.woundCfg.value.x,types:[tex[6*128*4],tex[6*128*4+4]]};})()`);
   const row=report['hits'+hits];
   if(row.visual.length!==(hits===1?1:2)||row.types[0]!==-1)throw Error('bounded upload missing '+JSON.stringify(row));
   await c.evaluate('__sdfGame.step(2)');
   await new Promise(r=>setTimeout(r,500));
   const shot=await c.send('Page.captureScreenshot',{format:'png'});save(`game-${hits}.png`,Buffer.from(shot.result.data,'base64'));
 }
 report.occupancy=await c.evaluate('__sdfGame.occupancy()');
 if(!report.occupancy.hits)throw Error('empty game render');
 report.errors=await c.evaluate('__previewErrors');
 if(report.errors.length)throw Error(report.errors.join('\n'));
 report.passed=true; save('report.json',JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report));
} catch(error) {report.failure=String(error.stack??error);save('failed-report.json',JSON.stringify(report,null,2)+'\n');throw error;}
finally {await fetch(`http://localhost:${cdp}/json/close/${c.tab.id}`).catch(()=>{});}
process.exit();
