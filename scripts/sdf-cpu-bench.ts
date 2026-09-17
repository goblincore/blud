// CPU-only actor/packing benchmark. No browser, GPU adapter or renderer.
// npx vite-node scripts/sdf-cpu-bench.ts
// CPU_ACTORS=12 CPU_FRAMES=900 CPU_DT=0.03333333333333333 CPU_SCENARIO=damaged
// CPU_OUT=/tmp/blud-cpu CPU_PROFILE=1 (profile separately; timings are instrumented)
// View upload executes the real packBody path with mesh skeletons; GPU submission,
// atlas copies, kit pose, encounter/projectile code and rendering are excluded.
import { Session } from 'node:inspector';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { packBody } from '../src/lab/sdf-zombie/pack';
import { translateBody } from '../src/lab/sdf-zombie/translate';
import { createZombieActor } from '../src/lab/sdf-zombie/webgpu/game-actor';
import { SOLDIER_PROFILE } from '../src/lab/sdf-zombie/motion-profile';
import { makeSoldierMind } from '../src/lab/sdf-zombie/webgpu/enemy-mind';
import zombie from '../src/lab/sdf-zombie/characters/zombie.blob?raw';
import soldier from '../src/lab/sdf-zombie/characters/soldier.blob?raw';
const count = Number(process.env.CPU_ACTORS ?? 12);
const frames = Number(process.env.CPU_FRAMES ?? 900);
const out = process.env.CPU_OUT ?? '/tmp/blud-cpu';
const dt = Number(process.env.CPU_DT ?? 1 / 30);
const scenario = process.env.CPU_SCENARIO ?? 'walk';
const packs: ReturnType<typeof packBody>[] = [];
const doc = [parseBlob(zombie), parseBlob(soldier)];
const bodies = doc.map(d=>buildBody(compileBlob(d, compileFace(d))));
const actors = Array.from({length:count},(_,i)=>{
 let scratch: ReturnType<typeof packBody> | undefined;
 const start: [number,number,number] = [(i%4)*2,0,Math.floor(i/4)*2];
 return createZombieActor({id:i+1,room:1,seed:1337+i*101,start,
  body:translateBody(bodies[i%2],start),bounds:{minX:-3,maxX:15,minZ:-3,maxZ:15},furniture:[],
  view:{setRootShift(){},update(next, rest){ scratch = packBody(next, rest, {packBones:false,boneCullMode:'segment'}, scratch); packs[i] = scratch; },setHeadRotation(){},setTime(){}} as never,
  ...(i%2?{profile:SOLDIER_PROFILE,mind:makeSoldierMind()}:{}),
 });
});
function stepActors(){for(const a of actors)a.step(dt);}
for(let f=0;f<180;f++)stepActors();
if (scenario === 'damaged') {
 for (const actor of actors) {
  actor.beginHits();
  for (const limb of ['torso', 'armL', 'legR'] as const) {
   const p = actor.posed().prims.find(p => p.limb === limb && p.op === 'add' && !p.dead);
   if (p) actor.hit([(p.a[0]+p.b[0])/2, (p.a[1]+p.b[1])/2, (p.a[2]+p.b[2])/2+p.radius], [0,0,-1]);
  }
  actor.endHits();
 }
}

const inspector = new Session(); inspector.connect(); const post = promisify(inspector.post.bind(inspector));
if(process.env.CPU_PROFILE==='1'){await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:100});await post('Profiler.start');}
const ms:number[]=[];const digest=createHash('sha256');
for(let f=0;f<frames;f++){
 const start=performance.now(); stepActors(); ms.push(performance.now()-start);
 if(f%60===0) {
  digest.update(JSON.stringify(actors.map(a=>[a.pose(),a.posed(),a.boundRig().rig,a.debug(),a.wounds()])));
  for (const pack of packs) for (const value of Object.values(pack)) {
   if (value instanceof Float32Array) digest.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
   else digest.update(String(value));
  }
 }
}
if(process.env.CPU_PROFILE==='1'){
 const {profile}=await post('Profiler.stop') as any;writeFileSync(out+'.cpuprofile',JSON.stringify(profile));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])); const totals=new Map();
 for(let i=0;i<profile.samples.length;i++){const n=nodes.get(profile.samples[i]) as any;const key=n.callFrame.functionName+' '+n.callFrame.url.split('/').slice(-2).join('/')+':'+(n.callFrame.lineNumber+1);totals.set(key,(totals.get(key)??0)+profile.timeDeltas[i]/1000);}
 console.log([...totals].sort((a,b)=>b[1]-a[1]).slice(0,25));
}
inspector.disconnect(); ms.sort((a,b)=>a-b);
const result={count,frames,dt,scenario,profile:process.env.CPU_PROFILE==='1',wounds:actors.reduce((n,a)=>n+a.wounds().length,0),packedBytesPerActor:Object.values(packs[0]!).reduce((n,v)=>n+(v instanceof Float32Array?v.byteLength:0),0),digest:digest.digest('hex'),p50:ms[Math.floor(ms.length*.5)],p95:ms[Math.floor(ms.length*.95)],mean:ms.reduce((a,b)=>a+b,0)/ms.length};
writeFileSync(out+'.json',JSON.stringify(result,null,2)); console.log(result);
