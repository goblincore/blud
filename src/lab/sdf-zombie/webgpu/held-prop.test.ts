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
    const first:GunPose={root:[3,1,2],quat:[0,0,0,1]};
    prop.pose(first,Infinity,[1,0,0]);
    prop.release([1,2,0],3);
    prop.step(.1,0);
    expect(prop.released).toBe(true);
    prop.reset();
    const fresh:GunPose={root:[0,1,0],quat:[0,0,0,1]};
    prop.pose(fresh,Infinity,[1,0,0]);
    expect(prop.released).toBe(false);
    expect(prop.muzzle()).toEqual(gunPoint(fresh,GUN_GRIP.muzzle));
    prop.step(.1,0);
    expect(prop.muzzle()).toEqual(gunPoint(fresh,GUN_GRIP.muzzle));
    prop.dispose();
  } finally { load.mockRestore(); }
});
