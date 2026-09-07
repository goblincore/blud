import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createKitDamage } from './kit-damage';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import source from '../characters/soldier.blob?raw';
import { severLimb } from '../sever';
import { worldHitToWound } from '../damage';

function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.19, 1.33, 0, -.09, 1.33, 0, -.09, 1.43, 0, -.19, 1.43, 0,
    .09, 1.33, 0, .19, 1.33, 0, .19, 1.43, 0, .09, 1.43, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeVertexNormals();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({length: 8}, (_,i)=>[i<4?0:1,0,0,0]).flat(), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({length: 8}, ()=>[1,0,0,0]).flat(), 4));
  const l = new THREE.Bone(); l.name='upperarml';
  const r = new THREE.Bone(); r.name='upperarmr';
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({name:'plate'}));
  mesh.bind(new THREE.Skeleton([l,r]));
  const root = new THREE.Group(); root.add(mesh);
  root.updateMatrixWorld(true);
  return { mesh, l, r, damage:createKitDamage(root) };
}
const body = () => buildBody(compileBlob(parseBlob(source)));

describe('damaged kit pieces', () => {
  it('restores a woundless gibbed kit when a healthy body respawns', () => {
    const {mesh,damage}=fixture();
    const healthy=body();
    const gibbed={...healthy,clusters:healthy.clusters.map(c=>({...c,alive:false}))};
    damage.update(gibbed,[],0);
    damage.update(gibbed,[],1/60); // gibs clear wounds before respawn
    expect(mesh.visible).toBe(false);
    expect(damage.debris.children).toHaveLength(2);
    damage.update(healthy,[],0);
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.index!.count).toBe(12);
    expect(damage.debris.children).toHaveLength(0);
    damage.dispose();
  });
  it('keeps the intact mesh draw calls, then releases only the cut limb at its posed location', () => {
    const {mesh,l,damage}=fixture();
    const b=body();
    damage.update(b, [], 0);
    expect(mesh.geometry.index!.count).toBe(12);
    l.position.x=3; l.updateMatrixWorld(true);
    damage.update(severLimb(b,'armL').body, [], 0);
    expect(mesh.geometry.index!.count).toBe(6);
    expect(damage.debris.children).toHaveLength(1);
    expect(damage.debris.children[0]!.position.x).toBeCloseTo(3-.14,5);
    damage.update(severLimb(b,'armL').body, [], 1/60);
    expect(damage.debris.children).toHaveLength(1);
    damage.dispose();
  });
  it('reattaches the kit and clears debris on an explicit reset', () => {
    const {mesh,damage}=fixture();
    damage.update(severLimb(body(),'armR').body, [], 0);
    expect(damage.debris.children).toHaveLength(1);
    damage.reset();
    expect(mesh.geometry.index!.count).toBe(12);
    expect(damage.debris.children).toHaveLength(0);
    damage.dispose();
  });
  it('breaks the locally hit plate, ignores stump decoration, and resets when healed', () => {
    const {mesh,damage}=fixture();
    const b=body();
    const index=b.prims.findIndex(p=>p.limb==='armL' && p.op!=='sub');
    const wound={...worldHitToWound([b.prims[index]!],[-.14,1.38,.01],.055,'pellet'),primIdx:index};
    damage.update(b,[wound,{...wound,injuryIgnored:true}],0);
    expect(damage.debris.children).toHaveLength(0);
    damage.update(b,[wound,wound],0);
    expect(damage.debris.children).toHaveLength(1);
    expect(mesh.geometry.index!.count).toBe(6);
    for(let i=0;i<240;i++) damage.update(b,[wound,wound],1/60);
    const plate=damage.debris.children[0] as THREE.Mesh;
    plate.updateMatrixWorld(true);
    const bounds=plate.geometry.boundingBox!.clone().applyMatrix4(plate.matrixWorld);
    expect(bounds.min.y).toBeGreaterThanOrEqual(.009);
    expect(bounds.min.y).toBeLessThan(.02);
    damage.update(b,[],0);
    expect(damage.debris.children).toHaveLength(0);
    expect(mesh.geometry.index!.count).toBe(12);
    damage.dispose();
  });
});
