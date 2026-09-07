const frame = document.querySelector('#game');
const status = document.querySelector('#status');
const output = document.querySelector('#result');
const button = document.querySelector('#run');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const summary = xs => { const sorted = [...xs].sort((a,b)=>a-b); return {samples:xs.length,p50:median(xs),p95:sorted[Math.floor(xs.length*.95)],mean:xs.reduce((s,v)=>s+v,0)/xs.length}; };

async function boot(candidate) {
 frame.src='about:blank'; await sleep(100);
 frame.src=`/sdf-game.html?frozen&slug&res=640${candidate?'&bounded-wounds':''}`;
 const start=performance.now();
 for (;;) {
  const api=frame.contentWindow?.__sdfGame;
  if(api?.backend) {
   if(api.backend!=='webgpu')throw Error('WebGPU unavailable');
   api.setLoopRunning(false);api.freeze(true);api.setAdaptive(false);api.setSdfScale(1);
   api.setFxaa(true);api.setSmear(.25);api.setBleed(false);api.setWoundTuning({spillChance:0});
   const z=api.zombies().find(z=>z.room===1);
   if(!z)throw Error('No room 1 fixture');
   const distance=1.0,aimY=1.22;
   api.setPose(z.pos[0],z.pos[2]+distance,0,Math.atan2(aimY-1.62,distance));
   api.step(2);await api.resolveGpu();
   if(api.resolution.cap.width!==640||api.sdfTarget.width!==640||api.sdfTarget.height!==480||api.sdfScale!==1||!api.fxaa||api.smear!==.25)throw Error('Settings mismatch');
   return {api,z,bootMs:performance.now()-start};
  }
  if(performance.now()-start>90000)throw Error('Game boot timeout');
  await sleep(100);
 }
}
async function draw(api) {
 if(document.hidden||frame.contentDocument.hidden)throw Error('Hidden frame invalidates measurement');
 const start=performance.now();api.step(1);await api.resolveGpu();return performance.now()-start;
}
async function sample(api,n) {const values=[];for(let i=0;i<n;i++)values.push(await draw(api));return {summary:summary(values),values};}
function stamp(api,z,y,side) {
 const hit=api.stampWoundAt(z.pos[0],y,z.pos[2]+side*1.2,0,0,-side,'pellet',z.id);
 if(!hit)throw Error('Fixture ray missed');
 const a=api.zombie(z.id),last=a.woundList().at(-1);
 if(a.posed().prims[last.primIdx].limb!=='torso')throw Error('Fixture hit a non-torso primitive');
 return {point:hit,owner:last.primIdx};
}
button.addEventListener('click',async()=>{
 button.disabled=true;output.textContent='';
 const report={method:'CPU simulation/render submission plus GPU queue fence per unpaced frame; no GPU timestamp or combat FPS claim',settings:{width:640,height:480,sdfScale:1,fxaa:true,smear:.25,bleed:false,frozen:true},runs:[],passed:false};
 try {
  for(let rep=0;rep<3;rep++)for(const candidate of rep%2?[true,false]:[false,true]) {
   const mode=candidate?'candidate':'baseline';status.textContent=`Run ${report.runs.length+1}/6: ${mode}, loading`;
   const {api,z,bootMs}=await boot(candidate);
   const run={rep,mode,bootMs,body:z,stages:[]};
   // Record first-frame pipeline settling separately; never mix it into steady samples.
   run.warmup=await sample(api,24);
   run.intact=await sample(api,100);
   for(const stage of ['front','all-four']) {
    status.textContent=`Run ${report.runs.length+1}/6: ${mode}, ${stage}`;
    const side=stage==='front'?1:-1,firstUse=[];
    for(const y of [1.05,1.32]) {
     const t=performance.now();const hit=stamp(api,z,y,side);await draw(api);
     firstUse.push({...hit,stampAndFrameMs:performance.now()-t});
    }
    // One more hit per region advances to heavy; then fill the original
    // gameplay ring with the same deterministic sequence in both modes.
    for(let i=0;i<6;i++)stamp(api,z,i%2?1.32:1.05,side);
    const transition=await sample(api,24);
    const steady=await sample(api,120);
    const a=api.zombie(z.id),visual=a.visualWoundList();
    const expected=candidate?(stage==='front'?4:8):(stage==='front'?8:16);
    if(visual.length!==expected)throw Error(`Expected ${expected} visual wounds, got ${visual.length}`);
    run.stages.push({stage,firstUse,transition,steady,gameplayWounds:a.woundCount(),visualWounds:visual.length,centres:visual.map(w=>({primIdx:w.primIdx,local:w.local,radius:w.radius}))});
   }
   report.runs.push(run);output.textContent=JSON.stringify(report,null,2);
  }
  report.comparison=['front','all-four'].map(stage=>{
   const med=mode=>median(report.runs.filter(r=>r.mode===mode).map(r=>r.stages.find(s=>s.stage===stage).steady.summary.p50));
   const baseline=med('baseline'),candidate=med('candidate');
   return {stage,baselineP50:baseline,candidateP50:candidate,changePercent:(candidate/baseline-1)*100};
  });
  report.passed=true;status.textContent='Complete';
 }catch(error){report.error=String(error.stack??error);status.textContent='Failed';}
 output.textContent=JSON.stringify(report,null,2);button.disabled=false;
});
