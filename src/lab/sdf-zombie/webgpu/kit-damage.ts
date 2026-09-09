import * as THREE from 'three/webgpu';
import type { BuildResult } from '../build-body';
import type { LimbId, Vec3 } from '../types';
import { woundWorldPos, type Wound } from '../damage';

const boneKey = (s: string) => s.toLowerCase().replace(/[._]/g, '');
function boneLimb(name: string): LimbId {
  const k = boneKey(name), side = k.endsWith('l') ? 'L' : 'R';
  if (/clavicle|upperarm|forearm|hand/.test(k)) return `arm${side}`;
  if (/thigh|shin|foot/.test(k)) return `leg${side}`;
  return /skull|neck|head/.test(k) ? 'head' : 'torso';
}

interface Piece {
  source: THREE.SkinnedMesh;
  indices: number[];
  bone: string;
  limb: LimbId;
  centre: THREE.Vector3;
  radius: number;
  armor: boolean;
  released: boolean;
  damage: number;
}
interface Debris { mesh: THREE.Mesh; velocity: THREE.Vector3; spin: THREE.Vector3; resting: boolean }
export interface KitDamageEvent { kind:'armor-hit'|'armor-shed'; point:Vec3; limb:LimbId }

/** WAM keeps part shapes disconnected but merges them per material. Join
 * UV-seam duplicates by position, then collect triangle islands once at load.
 * The intact mesh keeps its original draw calls; only detached islands bake. */
function piecesOf(mesh: THREE.SkinnedMesh): Piece[] {
  const g = mesh.geometry, pos = g.getAttribute('position');
  const skin = g.getAttribute('skinIndex'), weight = g.getAttribute('skinWeight');
  if (!pos || !skin || !weight) return [];
  const indices = g.index ? Array.from(g.index.array) : Array.from({length:pos.count}, (_,i)=>i);
  const parent = Array.from({length:pos.count}, (_,i)=>i);
  const root = (a:number):number => { while(parent[a]!==a) { parent[a]=parent[parent[a]!]!; a=parent[a]!; } return a; };
  const union = (a:number,b:number) => { parent[root(b)]=root(a); };
  const vertices = new Map<string,number>();
  for (const i of indices) {
    const key = [pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
    const previous=vertices.get(key);
    if(previous!==undefined) union(i,previous); else vertices.set(key,i);
  }
  for(let i=0;i<indices.length;i+=3) { union(indices[i]!,indices[i+1]!); union(indices[i]!,indices[i+2]!); }
  const islands=new Map<number,number[]>();
  for(let i=0;i<indices.length;i+=3) {
    const key=root(indices[i]!); const list=islands.get(key)??[];
    list.push(indices[i]!,indices[i+1]!,indices[i+2]!); islands.set(key,list);
  }
  const material=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
  return [...islands.values()].map(list=>{
    const bounds=new THREE.Box3(), point=new THREE.Vector3(), votes=new Map<number,number>();
    for(const i of new Set(list)) {
      bounds.expandByPoint(point.fromBufferAttribute(pos,i));
      for(let j=0;j<4;j++) { const bone=skin.getComponent(i,j); votes.set(bone,(votes.get(bone)??0)+weight.getComponent(i,j)); }
    }
    const joint=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0]??0;
    const bone=mesh.skeleton.bones[joint]?.name??'pelvis';
    const centre=bounds.getCenter(new THREE.Vector3());
    return {source:mesh,indices:list,bone,limb:boneLimb(bone),centre,radius:bounds.getSize(point).length()*.5,
      armor:material?.name==='plate',released:false,damage:0};
  });
}

function attached(piece:Piece, body:BuildResult):boolean {
  if(!body.clusters.some(c=>c.limb===piece.limb && c.alive)) return false;
  // Boots have no flesh-foot primitive; their support is the shin. Shoulder
  // plates may be weighted to a clavicle while the flesh starts at upperarm.
  const key=boneKey(piece.bone).replace('foot','shin').replace('clavicle','upperarm');
  const prims=body.prims.filter(p=>p.op!=='sub' && boneKey(p.bone??'')===key);
  return prims.length===0 || prims.some(p=>!p.dead);
}

/** Soldier-only kit damage. Missing anatomy always sheds its equipment;
 * clustered local impacts knock armor plates off to expose existing wounds. */
export function createKitDamage(object:THREE.Object3D) {
  const pieces:Piece[]=[], originals=new Map<THREE.SkinnedMesh,number[]>();
  object.traverse(o=>{
    const mesh=o as THREE.SkinnedMesh;
    if(!mesh.isSkinnedMesh) return;
    // Each glTF primitive can share attribute storage; own only its index.
    mesh.geometry=mesh.geometry.clone();
    originals.set(mesh,mesh.geometry.index?Array.from(mesh.geometry.index.array):Array.from({length:mesh.geometry.getAttribute('position').count},(_,i)=>i));
    pieces.push(...piecesOf(mesh));
  });
  const debris=new THREE.Group(); debris.name='DetachedArmor';
  const drops:Debris[]=[];
  let seen=new Set<number>();
  const clear=()=>{ for(const d of drops) d.mesh.geometry.dispose(); drops.length=0; debris.clear(); };
  const reset=()=>{
    clear();
    seen=new Set();
    for(const p of pieces) { p.released=false; p.damage=0; }
    for(const [mesh,index] of originals) { mesh.geometry.setIndex(index); mesh.visible=true; }
  };
  const bake=(piece:Piece)=>{
    const source=piece.source, g=source.geometry, pos=g.getAttribute('position'), normal=g.getAttribute('normal'), uv=g.getAttribute('uv');
    const positions:number[]=[], normals:number[]=[], uvs:number[]=[];
    const p=new THREE.Vector3(), n=new THREE.Vector3();
    source.updateWorldMatrix(true,false);
    for(const i of piece.indices) {
      p.fromBufferAttribute(pos,i);
      source.applyBoneTransform(i,p); p.applyMatrix4(source.matrixWorld); positions.push(...p.toArray());
      if(normal) {
        // Difference of two skinned points preserves the weighted direction
        // without translation, including the current articulated pose.
        n.fromBufferAttribute(pos,i).addScaledVector(new THREE.Vector3().fromBufferAttribute(normal,i),.01);
        source.applyBoneTransform(i,n); n.applyMatrix4(source.matrixWorld).sub(p).normalize(); normals.push(...n.toArray());
      }
      if(uv) uvs.push(uv.getX(i),uv.getY(i));
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    if(normals.length) geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3)); else geometry.computeVertexNormals();
    if(uvs.length) geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.computeBoundingBox();
    const centre=geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x,-centre.y,-centre.z); geometry.computeBoundingBox();
    const mesh=new THREE.Mesh(geometry,source.material); mesh.position.copy(centre); mesh.name=`Detached_${piece.bone}`;
    debris.add(mesh);
    const side=piece.limb.endsWith('L')?1:-1;
    drops.push({mesh,velocity:new THREE.Vector3(side*.7,1.7,1.3),spin:new THREE.Vector3(4,side*3,2),resting:false});
    piece.released=true;
    return centre.toArray() as Vec3;
  };
  const worldBounds=(piece:Piece)=>{
    const g=piece.source.geometry,pos=g.getAttribute('position'),box=new THREE.Box3(),p=new THREE.Vector3();
    piece.source.updateWorldMatrix(true,false);
    for(const i of new Set(piece.indices)) { p.fromBufferAttribute(pos,i); piece.source.applyBoneTransform(i,p); p.applyMatrix4(piece.source.matrixWorld); box.expandByPoint(p); }
    return box;
  };
  return {
    debris,
    reset,
    update(body:BuildResult,wounds:readonly Wound[],bodyYaw:number,dt:number):KitDamageEvent[] {
      const events:KitDamageEvent[]=[];
      // Gibs clear their wound list before a healthy body is respawned.
      // Equipment loss, not the previous wound count, records that reset.
      if(pieces.some(p=>p.released) && wounds.length===0 && body.clusters.every(c=>c.alive) && body.prims.every(p=>!p.dead)) reset();
      const retained=new Set(wounds.flatMap(w=>w.eventId===undefined?[]:[w.eventId]));
      seen=new Set([...seen].filter(id=>retained.has(id)));
      const impacts=wounds.filter(w=>w.eventId!==undefined&&!seen.has(w.eventId)&&!w.injuryIgnored&&w.type!=='burn').map(w=>{
        seen.add(w.eventId!); return {limb:body.prims[w.primIdx]?.limb,point:woundWorldPos(body.prims,w,bodyYaw),weight:w.type==='blast'?3:1};
      });
      const changed=new Set<THREE.SkinnedMesh>();
      for(const piece of pieces) {
        if(piece.released) continue;
        if(piece.armor) for(const hit of impacts) {
          if(hit.limb!==piece.limb) continue;
          if(worldBounds(piece).distanceToPoint(new THREE.Vector3(...hit.point))<=.07) {
            piece.damage+=hit.weight; events.push({kind:'armor-hit',point:hit.point,limb:piece.limb});
          }
        }
        if(!attached(piece,body) || piece.damage>=(piece.limb==='torso'?3:2)) {
          const point=bake(piece); changed.add(piece.source);
          if(piece.armor) events.push({kind:'armor-shed',point,limb:piece.limb});
        }
      }
      for(const mesh of changed) {
        const index=pieces.filter(p=>p.source===mesh && !p.released).flatMap(p=>p.indices);
        mesh.geometry.setIndex(index); mesh.visible=index.length>0;
      }
      const step=Math.min(Math.max(dt,0),1/30);
      for(const d of drops) {
        if(d.resting || step===0) continue;
        d.velocity.y-=10*step; d.mesh.position.addScaledVector(d.velocity,step);
        d.mesh.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(d.spin.x*step,d.spin.y*step,d.spin.z*step)));
        d.mesh.updateMatrixWorld(true);
        const bounds=d.mesh.geometry.boundingBox!.clone().applyMatrix4(d.mesh.matrixWorld);
        if(bounds.min.y<.01) {
          d.mesh.position.y+=.01-bounds.min.y;
          d.velocity.set(d.velocity.x*.6,Math.abs(d.velocity.y)*.22,d.velocity.z*.6); d.spin.multiplyScalar(.65);
          if(d.velocity.y<.3) { d.resting=true; d.velocity.set(0,0,0); }
        }
      }
      return events;
    },
    dispose(){ clear(); debris.removeFromParent(); },
  };
}
