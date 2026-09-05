// src/lab/sdf-zombie/webgpu/held-prop.ts
//
// A held polygon prop (the soldier's shorty) on the DEFAULT layer, posed
// every frame from the motion frame's gun pose (carry.ts gunPoseFromArm, the
// right forearm) with the post-shot muzzle rise on top; released on collapse
// or gib into prop-drop.ts's tumble, where it lands and stays.
//
// Same depth story as the kit (kit-overlay.ts header): the SDF composite
// already depth-tests against the polygonal pass, so the gun interleaves
// with flesh with nothing added here.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '../types';
import { GUN_GRIP, gunPoint, muzzleRise, type GunPose } from '../carry';
import { releaseProp, stepDrop, type DropState } from '../prop-drop';
import { qFromAxisAngle, qMul, qRotate, sub, scale, type Quat } from '../vec';

export interface HeldProp {
  object: THREE.Object3D;
  /** Pose from this frame's gun pose. `sinceFire` (s) adds the muzzle rise;
   *  `bodyRight` is the axis the rise pitches about. */
  pose(gun: GunPose, sinceFire: number, bodyRight: Vec3): void;
  /** Let go: the prop tumbles from where it is with the hand's velocity. */
  release(handVel: Vec3, seed: number): void;
  /** Advance a released prop. No-op while held or resting. */
  step(dt: number, floorY: number): void;
  /** World muzzle (midpoint of the two bores) for the last posed frame. */
  muzzle(): Vec3;
  /** True once released. */
  readonly released: boolean;
  dispose(): void;
}

export async function loadHeldProp(url: string): Promise<HeldProp> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const object = new THREE.Group();
  object.add(gltf.scene);
  object.matrixAutoUpdate = false;
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let last: GunPose = { root: [0, 0, 0], quat: [0, 0, 0, 1] };
  let drop: DropState | null = null;

  const write = (root: Vec3, quat: Quat) => {
    pos.set(root[0], root[1], root[2]);
    q.set(quat[0], quat[1], quat[2], quat[3]);
    object.matrix.compose(pos, q, one);
    object.matrixWorld.copy(object.matrix);
  };

  return {
    object,
    get released() { return drop !== null; },
    pose(gun, sinceFire, bodyRight) {
      if (drop) return;
      const rise = muzzleRise(sinceFire);
      const quat: Quat = rise === 0 ? gun.quat : qMul(qFromAxisAngle(bodyRight, -rise), gun.quat);
      // Rise pivots about the grip, not the root: keep Grip_Hand where it is.
      const grip = gunPoint(gun, GUN_GRIP.gripHand);
      const root = sub(grip, qRotate(quat, GUN_GRIP.gripHand));
      last = { root, quat };
      write(root, quat);
    },
    release(handVel, seed) {
      if (drop) return;
      drop = releaseProp(last.root, last.quat, scale(handVel, 1), seed);
    },
    step(dt, floorY) {
      if (!drop || drop.resting) return;
      drop = stepDrop(drop, dt, floorY);
      last = { root: drop.pos, quat: drop.quat };
      write(drop.pos, drop.quat);
    },
    muzzle() { return gunPoint(last, GUN_GRIP.muzzle); },
    dispose() {
      object.traverse(o => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.dispose();
      });
    },
  };
}
