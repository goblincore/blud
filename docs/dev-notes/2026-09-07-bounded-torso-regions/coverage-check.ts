import { writeFileSync } from 'node:fs';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../../src/lab/sdf-zombie/build-body';
import { parseBlob } from '../../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../../src/lab/sdf-zombie/blob-compile';
import source from '../../../src/lab/sdf-zombie/characters/zombie.blob?raw';
import { createZombieActor } from '../../../src/lab/sdf-zombie/webgpu/game-actor';
import { traceProjectile, woundFromPellet } from '../../../src/lab/sdf-zombie/webgpu/game-weapon';
import { woundWorldPos, woundCarveNormal } from '../../../src/lab/sdf-zombie/damage';
import { sdBody } from '../../../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../../../src/lab/sdf-zombie/types';

function actor(boundedWounds: boolean) {
 const doc=parseBlob(source),body=buildBody(compileBlob(doc,compileFace(doc)),DEFAULT_BUILD_OPTS,{});
 const a=createZombieActor({id:1,room:1,body,view:{update(){},setRootShift(){},setHeadRotation(){},setTime(){},setWounds(){}} as never,start:[0,0,0],seed:1337,bounds:{minX:-5,maxX:5,minZ:-5,maxZ:5},furniture:[],boundedWounds});
 a.step(1/60);return a;
}
function shoot(a:ReturnType<typeof actor>,x:number,y:number) {
 const body=a.posed(),hit=traceProjectile([x,y,1.2],[x,y,-1.2],p=>sdBody(p,body));
 if(!hit)return null;
 const w=woundFromPellet(body.prims,hit,a.pose().yaw,p=>sdBody(p,body));
 a.stampBlast([w]);a.advanceWoundPreview(.4);
 const p=woundWorldPos(a.posed().prims,w,a.pose().yaw);
 const visuals=a.visualWounds();
 const contributions=visuals.map(v=>{const c=woundWorldPos(a.posed().prims,v,a.pose().yaw),n=woundCarveNormal(a.posed().prims,v,a.pose().yaw);const q=p.map((x,i)=>x-c[i]!) as Vec3;return Math.min(v.radius-Math.hypot(...q),n&&(v.carveDepth??0)>0?v.carveDepth!-q.reduce((s,x,i)=>s+x*n[i]!,0):1e5);});
 return {x,y,limb:body.prims[w.primIdx]!.limb,primIdx:w.primIdx,impact:p,carveDepth:w.carveDepth,visualCount:visuals.length,atImpactCarve:Math.max(-1e5,...contributions),visualCentres:visuals.map(v=>woundWorldPos(a.posed().prims,v,a.pose().yaw))};
}
const rows=[];
for(const x of [-.12,0,.12])for(const y of [1.1,1.25,1.32,1.38,1.43])for(const bounded of [false,true])for(const prior of [false,true]) {
 const a=actor(bounded);if(prior)shoot(a,0,1.05);
 rows.push({bounded,prior,shot:shoot(a,x,y)});
}
const torso=rows.filter(r=>r.shot?.limb==='torso');
const counts=Object.fromEntries([false,true].flatMap(bounded=>[false,true].map(prior=>{const selected=torso.filter(r=>r.bounded===bounded&&r.prior===prior);return [`${bounded?'preview':'baseline'}-${prior?'after-belly':'fresh'}`,{samples:selected.length,noCutAtImpact:selected.filter(r=>r.shot!.atImpactCarve<=0).length}]})));
const report={scope:'CPU trace and actual game actor upload-state diagnostic; not pixel visibility or performance',counts,rows};
writeFileSync(new URL('./coverage-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(counts,null,2));
console.log(JSON.stringify(rows.filter(r=>r.shot?.x===0&&r.shot?.y===1.32),null,2));
