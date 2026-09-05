import {readFileSync,writeFileSync} from 'node:fs';
import {buildBody} from '../../../src/lab/sdf-zombie/build-body.ts';
import {parseBlob} from '../../../src/lab/sdf-zombie/blob-parse.ts';
import {compileBlob,compileFace} from '../../../src/lab/sdf-zombie/blob-compile.ts';
import {createZombieActor} from '../../../src/lab/sdf-zombie/webgpu/game-actor.ts';
import {sdBody} from '../../../src/lab/sdf-zombie/validate.ts';
import {rotateYaw} from '../../../src/lab/sdf-zombie/gait.ts';
import {add,sub,len} from '../../../src/lab/sdf-zombie/vec.ts';
const doc=parseBlob(readFileSync(new URL('../../../src/lab/sdf-zombie/characters/zombie.blob', import.meta.url),'utf8'));
const body=buildBody(compileBlob(doc,compileFace(doc)));const results=[];
for(const warm of [0,30,120])for(const x of [-.12,0,.12])for(const y of [1.1,1.25,1.38])for(const mode of ['normal']){
 let severs=0;
 const a=createZombieActor({id:1,room:0,body,view:{setRootShift(){},setTime(){},setHeadRotation(){},setWounds(){},update(){}} as any,start:[0,0,0],seed:0,bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},furniture:[],onSever(){severs++}});
 for(let i=0;i<warm;i++)a.step(1/60);
 const pose=a.pose(),dir=rotateYaw([0,0,-1],pose.yaw),origin=add(pose.pos,rotateYaw([x,y,1],pose.yaw));let hit=null;
 for(let d=0;d<2;d+=.002){const p=add(origin,dir.map(v=>v*d) as any);if(sdBody(p,a.posed())<=0){hit=p;break}}
 if(!hit)continue;
 const w=a.hitSlug(hit,dir);if(a.body.prims[w!.primIdx].limb!=='torso'||severs)continue;
 const timeline=[];
 for(let f=0;f<60;f++){
  if(f)a.step(1/60);
  const posed=a.posed(),torso={...posed,prims:posed.prims.map(p=>p.limb==='torso'?p:{...p,dead:true}),bonePrims:[]};
  const hands=posed.prims.filter(p=>p.bone?.startsWith('foreArm')&&len(sub(p.b,p.a))<.001&&!p.dead).map(p=>({bone:p.bone,pos:p.a,clearance:sdBody(p.a,torso)-p.radius}));
  const foreClearance=posed.prims.filter(p=>p.bone?.startsWith('foreArm')&&len(sub(p.b,p.a))>.01&&!p.dead).map(p=>({bone:p.bone,min:Math.min(...[0,.25,.5,.75,1].map(t=>sdBody(p.a.map((v,i)=>v+(p.b[i]-v)*t) as any,torso)-p.radius))}));
  timeline.push({f,hands,foreClearance,phase:a.debug().phase,root:a.pose().pos});
 }
 results.push({warm,x,y,mode,hit,dir,severs,min:Math.min(...timeline.flatMap(t=>t.hands.map(h=>h.clearance))),timeline});
}
writeFileSync('/tmp/torso-clutch-removed-results.json',JSON.stringify(results,null,2));
console.log(results.map(r=>({warm:r.warm,x:r.x,y:r.y,mode:r.mode,min:r.min,severs:r.severs})).sort((a,b)=>a.min-b.min));
