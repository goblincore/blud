import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildBody } from '../../../src/lab/sdf-zombie/build-body.ts';
import { parseBlob } from '../../../src/lab/sdf-zombie/blob-parse.ts';
import { compileBlob, compileFace } from '../../../src/lab/sdf-zombie/blob-compile.ts';
import { createZombieActor } from '../../../src/lab/sdf-zombie/webgpu/game-actor.ts';
import { sdBody } from '../../../src/lab/sdf-zombie/validate.ts';
import { makeRig, stepRig } from '../../../src/lab/sdf-zombie/rig.ts';
const sub=(a:any,b:any)=>a.map((v:number,i:number)=>v-b[i]);
const dot=(a:any,b:any)=>a.reduce((s:number,v:number,i:number)=>s+v*b[i],0);
const len=(a:any)=>Math.hypot(...a);
const norm=(a:any)=>a.map((x:number)=>x/len(a));
const cross=(a:any,b:any)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const doc=parseBlob(readFileSync(new URL('../../../src/lab/sdf-zombie/characters/zombie.blob', import.meta.url),'utf8'));
mkdirSync('/tmp/blud-elbow-investigation', {recursive:true});
const results:any[]=[];
for(const side of ['l','r']) for(const warm of [0,30]) for(const kind of ['pellet','slug']) for(const t of [0.15,0.5,0.85]) for(const dir of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]) {
 const body=buildBody(compileBlob(doc,compileFace(doc)));
 let severs=0, uploads=0;
 const actorOptions={id:1,room:0,body,view:{setRootShift(){},update(){uploads++},setHeadRotation(){},setTime(){},setWounds(){}} as any,start:[0,0,0],seed:0,bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},furniture:[],onSever(){severs++}};
 const actor=createZombieActor(actorOptions as any);
 const control=createZombieActor({...actorOptions,body:buildBody(compileBlob(doc,compileFace(doc))),view:{setRootShift(){},update(){},setHeadRotation(){},setTime(){},setWounds(){}},onSever(){}} as any);
 const rest=actor.boundRig().rig.restPose;
 const upper=body.bones.get('upperArm.'+side)!;const lower=body.bones.get('foreArm.'+side)!;
 const ids=[upper.head,upper.tail,lower.tail].map(p=>rest.findIndex(q=>len(sub(q,p))<1e-5));
 if(ids.includes(-1))throw Error('joint mapping');
 for(let f=0;f<warm;f++){actor.step(1/60);control.step(1/60);}
 const beforePoints=ids.map(i=>actor.boundRig().rig.points[i].pos);
 const baselineNormal=norm(cross(sub(beforePoints[1],beforePoints[0]),sub(beforePoints[2],beforePoints[1])));
 const angle=(target=actor)=>{const p=ids.map(i=>target.boundRig().rig.points[i].pos);const u=norm(sub(p[1],p[0])),v=norm(sub(p[2],p[1]));return Math.atan2(dot(cross(u,v),baselineNormal),dot(u,v))*180/Math.PI;};
 const before=angle();
 const prim=actor.posed().prims.find(p=>p.bone==='foreArm.'+side && p.a.some((x,i)=>Math.abs(x-p.b[i])>0.001))!;
 const center=prim.a.map((x,i)=>x+(prim.b[i]-x)*t);
 const origin=center.map((x,i)=>x-dir[i]*0.6);
 let hit:any=null;
 for(let r=0;r<1.2;r+=0.001){const p=origin.map((x,i)=>x+dir[i]*r);if(sdBody(p as any,actor.posed())<=0){hit=p;break;}}
 if(!hit)continue;
 const prior=uploads;
 const wound=kind==='pellet'?actor.hit(hit,dir as any):actor.hitSlug(hit,dir as any);
 const hitBone=body.prims[wound!.primIdx].bone;
 if(severs || !hitBone?.includes('Arm.'+side))continue;
 const immediate=angle();const uploadedImmediately=uploads>prior;const timeline=[{frame:0,angle:immediate,controlAngle:angle(control)}];
 for(let f=1;f<=12;f++){actor.step(1/60);control.step(1/60);if(severs)break;timeline.push({frame:f,angle:angle(),controlAngle:angle(control)});}
 results.push({side,warm,kind,t,dir,hit,hitBone,before,immediate,minimum:Math.min(...timeline.map(x=>x.angle)),uploadedImmediately,severs,timeline});
}
results.sort((a,b)=>a.minimum-b.minimum);
writeFileSync('/tmp/blud-elbow-investigation/results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({cases:results.length,reverseImmediate:results.filter(r=>r.immediate<0).length,worst:results.slice(0,3)},null,2));
// A length-preserving backward elbow is an exact solution to all existing constraints.
const chain=makeRig([{pos:[0,0.6,0],pinned:true},{pos:[0,0.3,0],pinned:false},{pos:[0,0.3-Math.sqrt(0.08),-0.1],pinned:false}],[{a:0,b:1,rest:0.3,stiffness:1},{a:1,b:2,rest:0.3,stiffness:1}]);
const solved=stepRig(chain,1/60,{gravity:[0,0,0],damping:0.06,iterations:4,restStiffness:0});
console.log(JSON.stringify({lengthOnlyProof:{unchanged:JSON.stringify(chain.points)===JSON.stringify(solved.points),handZ:solved.points[2].pos[2],lengths:[len(sub(solved.points[1].pos,solved.points[0].pos)),len(sub(solved.points[2].pos,solved.points[1].pos))]}}));
