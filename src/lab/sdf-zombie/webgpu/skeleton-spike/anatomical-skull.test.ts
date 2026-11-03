// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AnatomicalSkullKit, SKULL_OPENINGS, SKULL_PIECES, readSkullEyeRadius, readSkullOpenings, skullEyePoint } from './anatomical-skull';
import { ANATOMICAL_SKULL_ASSET, OWN_SKULLS } from './skull-cast';
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
import { batchInstances, batchMatrixAt, isSegmentBatch } from './segment-instance';

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
    // No frame with the skull and its thrown plates together: in the batches as they stand, before any update, a's
    // plates and seated eyes are out (their instances at zero scale) and b's whole skull and eyes are untouched.
    expect(bones(a)).toHaveLength(0);
    expect(renderer.drawn.filter(d=>d.owner===a&&d.eye)).toHaveLength(0);
    expect(bones(b)).toHaveLength(1);
    expect(renderer.drawn.filter(d=>d.owner===b&&d.eye).length).toBeGreaterThan(0);
    const live = renderer.object.children.filter(isSegmentBatch)
      .flatMap(mesh=>Array.from({length:batchInstances(mesh)},(_,i)=>batchMatrixAt(mesh,i,new THREE.Matrix4()).getMaxScaleOnAxis()))
      .filter(scale=>scale>0);
    // What is left drawn is b's: one skull and its eyes.
    expect(live).toHaveLength(1+renderer.drawn.filter(d=>d.owner===b&&d.eye).length);
    expect(renderer.explodeSkull(a,[head],[0,1,0])).toBe(0);
    renderer.update([[head],[head]],[a,b]);
    expect(bones(a)).toHaveLength(0);
    expect(bones(b)).toHaveLength(1);
    renderer.clear();
    expect(renderer.skullState(a).missing).toBe(0);
    renderer.dispose();
  });
  it('a whole skull that pops is out of the batches in the same call, its seated eyes with it',()=> {
    const body = buildBody(compileBlob(parseBlob(readFileSync('src/lab/sdf-zombie/characters/zombie.blob','utf8'))),DEFAULT_BUILD_OPTS);
    const head = createSkeletonSources(body,bindRig(body),{character:'zombie'}).find(s=>s.segment==='head')!;
    const cache = new SegmentMeshCache(undefined,undefined,new AnatomicalSkullKit(source,new THREE.Texture(),new THREE.Vector2(1,1)));
    const debris: THREE.Object3D[] = [];
    const renderer = createSegmentMeshRenderer(cache,0,undefined,object=>debris.push(object));
    const a={},b={};
    renderer.update([[head],[head]],[a,b]);
    const of = (owner:object,eye:boolean)=>renderer.drawn.filter(d=>d.owner===owner&&!!d.eye===eye);
    expect(of(a,false)).toHaveLength(1);
    expect(of(a,true).length).toBeGreaterThan(0);
    expect(renderer.explodeSkull(a,[head],[0,1,0])).toBe(14);
    expect(debris).toHaveLength(14);
    expect(of(a,false)).toHaveLength(0);
    expect(of(a,true)).toHaveLength(0);
    expect(of(b,false)).toHaveLength(1);
    expect(of(b,true).length).toBeGreaterThan(0);
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

describe('a skull asset of a character\'s own (skull-cast.ts OWN_SKULLS): its kit and its manifest\'s openings', () => {
  it('a kit fits its own asset\'s cast alone, tags what it fits with the asset, and keeps the asset\'s openings', () => {
    const body = buildBody(compileBlob(parseBlob(readFileSync('src/lab/sdf-zombie/characters/zombie.blob','utf8'))),DEFAULT_BUILD_OPTS);
    const headAs = (character: string) => createSkeletonSources(body,bindRig(body),{character}).find(s=>s.segment==='head')!;
    const openings = readSkullOpenings({ openings: { orbitLeft: [0.03, 0.01, 0.05], orbitRight: [-0.03, 0.01, 0.05], nasal: [0, -0.02, 0.06] } });
    const imp = new AnatomicalSkullKit(anatomicalSkullSource(),new THREE.Texture(),new THREE.Vector2(1,1),'envelope',OWN_SKULLS.imp!.asset,openings);
    const human = new AnatomicalSkullKit(anatomicalSkullSource(),new THREE.Texture(),new THREE.Vector2(1,1));
    expect(imp.fitOf('imp')).toEqual({ fit: 'envelope' });
    for (const name of ['zombie','cultist','ogre']) expect(imp.fitOf(name),name).toBeNull();
    expect(human.fitOf('imp')).toBeNull();
    expect(human.asset).toBe(ANATOMICAL_SKULL_ASSET);
    expect(human.openings).toBe(SKULL_OPENINGS);
    expect(imp.openings).toEqual(openings);
    expect(skullEyePoint(openings)).toEqual({ x: 0, y: 0.01 });
    const fitted = imp.head(headAs('imp'))!;
    expect(fitted.pieces.map(p=>p.id)).toEqual([...SKULL_PIECES]);
    expect(fitted.mesh.geometry.userData).toMatchObject({ anatomicalSkull: true, skullAsset: 'imp' });
    for (const p of fitted.pieces) expect(p.geometry.userData.skullAsset).toBe('imp');
    expect(human.head(headAs('zombie'))!.mesh.geometry.userData.skullAsset).toBe('anatomical');
    expect(imp.head(headAs('zombie'))).toBeNull();
    imp.dispose(); human.dispose();
  });
  it('a manifest\'s openings are three points or the asset does not load', () => {
    const good = { orbitLeft: [0.02, 0, 0.04], orbitRight: [-0.02, 0, 0.04], nasal: [0, -0.03, 0.05] };
    expect(readSkullOpenings({ schema: 1, openings: good })).toEqual(good);
    for (const bad of [null, {}, { openings: {} }, { openings: { ...good, nasal: [0, 0] } }, { openings: { ...good, orbitLeft: [0, NaN, 0] } }, { openings: { ...good, orbitRight: '0,0,0' } }]) {
      expect(() => readSkullOpenings(bad, 'imp-skull.json'), JSON.stringify(bad)).toThrow(/imp-skull\.json: openings\.\w+ is not a point/);
    }
  });
  it('a manifest\'s modelled eyes are a positive radius, or absent', () => {
    expect(readSkullEyeRadius({ eyes: { radius: 0.008 } })).toBe(0.008);
    expect(readSkullEyeRadius({ openings: {} })).toBeNull();
    for (const bad of [{ eyes: {} }, { eyes: { radius: 0 } }, { eyes: { radius: '8' } }, { eyes: null }]) {
      expect(() => readSkullEyeRadius(bad, 'imp-skull.json'), JSON.stringify(bad)).toThrow(/imp-skull\.json: eyes\.radius/);
    }
  });
});
