// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AnatomicalSkullKit } from './anatomical-skull';
import { anatomicalSkullGltf, anatomicalSkullSource } from './anatomical-skull.fixture';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdBody } from '../../validate';
import { createSkeletonSources } from './contract';
import { skullRayHit, intactSkull } from '../../skull-fracture';
import { SegmentMeshCache } from './mesh';
import { createSegmentMeshRenderer } from './mesh-renderer';

const gltf = anatomicalSkullGltf;
const source = anatomicalSkullSource();
describe('offline anatomical skull asset',()=> {
  it('keeps all fourteen named pieces, a single atlas, and the budget',()=> {
    expect(source).toHaveLength(14);
    expect(source.reduce((n,p)=>n+p.geometry.index!.count/3,0)).toBe(9947);
    expect(gltf.images).toHaveLength(1);
    expect(gltf.materials[0].normalTexture).toBeDefined();
    for (const p of source) {
      expect(Array.from(p.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(p.geometry.getAttribute('uv').count).toBe(p.geometry.getAttribute('position').count);
      expect(p.geometry.index!.count).toBeGreaterThan(0);
    }
  });
  it('shares one intact draw, removes only the struck actor plate, spawns fourteen fragments once, and resets',()=> {
    const body = buildBody(compileBlob(parseBlob(readFileSync('src/lab/sdf-zombie/characters/zombie.blob','utf8'))),DEFAULT_BUILD_OPTS);
    const head = createSkeletonSources(body,bindRig(body),{character:'zombie'}).find(s=>s.segment==='head')!;
    const kit = new AnatomicalSkullKit(source,new THREE.Texture(),new THREE.Vector2(1,1));
    const cache = new SegmentMeshCache(undefined,undefined,kit);
    const debris: THREE.Object3D[] = [];
    const renderer = createSegmentMeshRenderer(cache,0,undefined,object=>debris.push(object));
    const a={},b={};
    renderer.update([[head],[head]],[a,b]);
    const bones = (owner:object)=>renderer.drawn.filter(d=>d.owner===owner&&!d.eye);
    expect(bones(a)).toHaveLength(1);
    expect(bones(a)[0]!.geometry).toBe(bones(b)[0]!.geometry);
    const y = head.bounds.min[1]+(head.bounds.max[1]-head.bounds.min[1])*.75;
    renderer.impact(a,[head],head.toWorld([0,y,head.bounds.max[2]+.03]),[0,0,-1],'slug');
    expect(renderer.skullState(a).pieces).toHaveLength(1);
    expect(renderer.skullState(b).missing).toBe(0);
    expect(debris).toHaveLength(1);
    renderer.update([[head],[head]],[a,b]);
    expect(bones(a)).toHaveLength(13);
    expect(bones(b)).toHaveLength(1);
    expect(renderer.explodeSkull(a,[head],[0,1,0])).toBe(13);
    expect(debris).toHaveLength(14);
    expect(renderer.explodeSkull(a,[head],[0,1,0])).toBe(0);
    renderer.update([[head],[head]],[a,b]);
    expect(bones(a)).toHaveLength(0);
    expect(bones(b)).toHaveLength(1);
    renderer.clear();
    expect(renderer.skullState(a).missing).toBe(0);
    renderer.dispose();
  });
  it.each(['zombie','soldier','cultist','cultist-cowled','bride','female','schoolgirl','schoolgirl-alt','schoolgirl-described','clown','clown-alt','juggernaut','bonewalker'])('fits %s behind intact flesh and shares geometry',character=> {
    const text = readFileSync(`src/lab/sdf-zombie/characters/${character}.blob`,'utf8');
    const body = buildBody(compileBlob(parseBlob(text)),DEFAULT_BUILD_OPTS);
    const head = createSkeletonSources(body,bindRig(body),{character}).find(s=>s.segment==='head');
    if (!head) return; // characters without authored head bones keep their own field
    const kit = new AnatomicalSkullKit(source,new THREE.Texture(),new THREE.Vector2(1,1));
    const skull = kit.head(head)!;
    expect(kit.head(head)).toBe(skull);
    const flesh = {...body,bonePrims:[]};
    const positions = skull.mesh.geometry.getAttribute('position');
    let worst = -Infinity, worstPoint: number[] = [];
    for(let i=0;i<positions.count;i++) {
      const point: [number,number,number] = [positions.getX(i),positions.getY(i),positions.getZ(i)];
      const d = sdBody(head.toWorld(point),flesh);
      if(d>worst){worst=d;worstPoint=point;}
    }
    if(worst>-.002) console.log('FIT',character,worst,worstPoint);
    expect(worst,`flesh clearance ${character}`).toBeLessThanOrEqual(-0.002);
    expect(skullRayHit(skull.pieces,intactSkull(14),[(head.bounds.min[0]+head.bounds.max[0])*.5,
      head.bounds.min[1]+(head.bounds.max[1]-head.bounds.min[1])*.75,head.bounds.max[2]+.03],[0,0,-1])).not.toBeNull();
    // Do not dispose shared fixture source geometries; this kit is test-local.
  });
});
