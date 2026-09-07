import { describe,it,expect,vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import soldierSrc from '../characters/soldier.blob?raw';
import { defaultUniforms } from './zombie-gpu';
import { corpsePartition, createSoldierCorpseBakes, soldierCorpseSnapshot } from './soldier-corpse-bake';
import type { ZombieActor } from './game-actor';

const result = { positions:new Float32Array([0,0,0,1,0,0,0,1,0]), normals:new Float32Array(9),
  colors:new Float32Array(12),indices:new Uint16Array([0,1,2]),centre:[0,0,0] as [number,number,number],
  radius:1,verts:3,tris:1,bakeMs:1,overflow:false,droppedQuads:0 };
function setup() {
  const body=buildBody(compileBlob(parseBlob(soldierSrc)));
  let revision=0;
  const actor={ id:1, body, posed:()=>body, pose:()=>({yaw:0,pos:[0,0,0]}), wounds:()=>[],
    corpseBakeEligible:()=>true,damageRevision:()=>revision,pauseForBake:vi.fn(),
    view:{object:new THREE.Object3D(),coneObject:new THREE.Object3D(),update:vi.fn(),uniforms:defaultUniforms(new THREE.Texture())} } as unknown as ZombieActor;
  const worker={onmessage:null as any,onerror:null as any,onmessageerror:null as any,postMessage:vi.fn(),terminate:vi.fn()};
  const scene=new THREE.Scene();
  const manager=createSoldierCorpseBakes(scene,()=>new THREE.MeshBasicMaterial(),()=>worker as any);
  return {body,actor,worker,manager,scene,damage:()=>revision++};
}
describe('soldier corpse bake lifecycle',()=>{
  it('partitions without renumbering wound owners and preserves the head',()=>{
    const {body,actor}=setup();
    const data=soldierCorpseSnapshot(actor)!;
    expect(data.body!.prims).toHaveLength(body.prims.length);
    expect(data.body!.clusters.filter(c=>c.alive).every(c=>c.limb!=='head')).toBe(true);
    expect(corpsePartition(body,true).clusters.filter(c=>c.alive).every(c=>c.limb==='head')).toBe(true);
    expect(data.look.goreStrength).toBe(0);
    expect(data.halfExtent!.every(v=>Number.isFinite(v)&&v>0)).toBe(true);
  });
  it('waits for a quiet interval, freezes once, swaps to a mesh, and restores on damage',()=>{
    const {actor,worker,manager,scene,damage}=setup();
    manager.update([actor],1);expect(worker.postMessage).not.toHaveBeenCalled();
    manager.update([actor],.6);expect(actor.pauseForBake).toHaveBeenLastCalledWith(true);
    worker.onmessage({data:{id:1,result}});manager.update([actor],0);
    expect(manager.stats().baked).toEqual([1]);expect(scene.children).toHaveLength(1);
    expect(actor.view.update).toHaveBeenLastCalledWith(expect.objectContaining({clusters:expect.arrayContaining([expect.objectContaining({limb:'torso',alive:false})])}),actor.body);
    damage();manager.update([actor],0);
    expect(scene.children).toHaveLength(0);expect(actor.pauseForBake).toHaveBeenLastCalledWith(false);
    expect(actor.view.update).toHaveBeenLastCalledWith(actor.posed(),actor.body);
  });
  it('rejects an in-flight result after damage and cleans up on actor removal',()=>{
    const {actor,worker,manager,scene,damage}=setup();
    manager.update([actor],2);const reply=worker.onmessage;
    damage();manager.update([actor],0);reply({data:{id:1,result}});manager.update([actor],0);
    expect(scene.children).toHaveLength(0);expect(manager.stats().pending).toBeNull();
    manager.update([actor],2);manager.update([],0);
    expect(actor.pauseForBake).toHaveBeenLastCalledWith(false);expect(manager.stats().pending).toBeNull();
  });
  it('falls back to live SDF on worker failure or disabling the feature',()=>{
    const {actor,worker,manager}=setup();manager.update([actor],2);
    worker.onmessage({data:{id:1,error:'extraction failed'}});manager.update([actor],0);
    expect(actor.pauseForBake).toHaveBeenLastCalledWith(false);expect(manager.stats().error).toBe('extraction failed');
    manager.setEnabled(false);expect(manager.stats().baked).toEqual([]);
  });
});
