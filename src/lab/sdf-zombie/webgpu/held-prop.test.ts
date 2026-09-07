import { expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadHeldProp } from './held-prop';
import { gunPoint, GUN_GRIP } from '../carry';
import type { GunPose } from '../carry';

it('reclaims the dropped gun on respawn and accepts the new held pose', async () => {
  const load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockResolvedValue({scene:new THREE.Group()} as any);
  try {
    const prop=await loadHeldProp('/stub.glb');
    const first:GunPose={root:[3,1,2],quat:[0,0,0,1],scale:1.2};
    prop.pose(first,0,[1,0,0]);
    // The rendered mesh, both hand locators and firing origin must agree
    // even when recoil rotates an enlarged weapon about its grip.
    const rendered=(p:readonly [number,number,number])=>new THREE.Vector3(...p)
      .applyMatrix4(prop.object.matrix).toArray();
    rendered(GUN_GRIP.gripHand).forEach((v,i)=>expect(v).toBeCloseTo(gunPoint(first,GUN_GRIP.gripHand)[i]!,9));
    rendered(GUN_GRIP.muzzle).forEach((v,i)=>expect(v).toBeCloseTo(prop.muzzle()[i]!,9));
    prop.release([1,2,0],3);
    prop.step(.1,0);
    expect(prop.released).toBe(true);
    expect(prop.object.matrix.getMaxScaleOnAxis()).toBeCloseTo(1.2,9);
    rendered(GUN_GRIP.muzzle).forEach((v,i)=>expect(v).toBeCloseTo(prop.muzzle()[i]!,9));
    prop.reset();
    const fresh:GunPose={root:[0,1,0],quat:[0,0,0,1]};
    prop.pose(fresh,Infinity,[1,0,0]);
    expect(prop.released).toBe(false);
    expect(prop.object.matrix.getMaxScaleOnAxis()).toBeCloseTo(1,9);
    expect(prop.muzzle()).toEqual(gunPoint(fresh,GUN_GRIP.muzzle));
    prop.step(.1,0);
    expect(prop.muzzle()).toEqual(gunPoint(fresh,GUN_GRIP.muzzle));
    prop.dispose();
  } finally { load.mockRestore(); }
});
