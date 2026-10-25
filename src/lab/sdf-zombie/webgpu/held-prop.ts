// src/lab/sdf-zombie/webgpu/held-prop.ts
//
// A held polygon prop (the soldier's shotgun) on the DEFAULT layer, posed
// every frame from the motion frame's gun pose (carry.ts gunPoseFromArm, the
// right forearm) with the post-shot muzzle rise on top; released on collapse
// or gib into prop-drop.ts's tumble, where it lands and stays.
//
// Same depth story as the kit (kit-overlay.ts header): the SDF composite
// already depth-tests against the polygonal pass, so the gun interleaves
// with flesh with nothing added here.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setMaterialEnvironment } from './material-environment';
import type { Vec3 } from '../types';
import { GUN_GRIP, gunPoint, muzzleRise, type GunPose } from '../carry';
import { DROP, releaseProp, stepDrop, type DropState } from '../prop-drop';
import type { DebrisGround, DebrisSeat } from '../debris-ground';
import { add, qFromAxisAngle, qMul, qRotate, sub, scale, type Quat } from '../vec';

export interface HeldProp {
  object: THREE.Object3D;
  /** Pose from this frame's gun pose. `sinceFire` (s) adds the muzzle rise;
   *  `bodyRight` is the axis the rise pitches about. */
  pose(gun: GunPose, sinceFire: number, bodyRight: Vec3, barrelSpin?: number): void;
  /** Let go: the prop tumbles from where it is with the hand's velocity. SECTOR levels (plan 3b) pass `seat`: the
   *  drop starts inside the level and on its body's floor. */
  release(handVel: Vec3, seed: number, seat?: DebrisSeat): void;
  /** Advance a released prop. No-op while held or resting. SECTOR levels pass `ground` (prop-drop.ts stepDrop). */
  step(dt: number, floorY: number, ground?: DebrisGround): void;
  /** The released prop's pose (null while held) and whether it is resting — the debris seam. */
  dropped(): { pos: Vec3; resting: boolean } | null;
  /** World muzzle for the last posed frame; optional forward offset for gas. */
  muzzle(forward?: number): Vec3;
  /** True once released. */
  readonly released: boolean;
  /** Reclaim the prop for a fresh body; the caller supplies its next held pose. */
  reset(): void;
  dispose(): void;
}

export async function loadHeldProp(url: string, renderer?: THREE.WebGPURenderer, muzzleAt: Vec3 = GUN_GRIP.muzzle): Promise<HeldProp> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const object = new THREE.Group();
  object.add(gltf.scene);
  // Like the armour, PBR gun metal needs something to reflect. This is a
  // prop-only reflection source; it does not change the level's lighting.
  let environment: THREE.RenderTarget | null = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    object.traverse(o => {
      const material = (o as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          setMaterialEnvironment(std, environment!.texture);
          std.envMapIntensity = 0.65;
        }
      }
    });
  }
  // A rotary gun's barrel cluster (make-juggernaut-chaingun.ts): a node on
  // the bore axis, spun about its local Z by pose()'s barrelSpin.
  const barrels = gltf.scene.getObjectByName('Barrels') ?? null;
  // The prop's bounds centre in its own (root) frame: a dropped gun meets sector walls there (prop-drop.ts
  // DropState.centre), not at the grip root a long barrel reaches far past.
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const centreLocal: Vec3 = bounds.isEmpty() ? [0, 0, 0] : bounds.getCenter(new THREE.Vector3()).toArray() as Vec3;
  object.matrixAutoUpdate = false;
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let last: GunPose = { root: [0, 0, 0], quat: [0, 0, 0, 1] };
  let drop: DropState | null = null;

  const write = (root: Vec3, quat: Quat) => {
    pos.set(root[0], root[1], root[2]);
    q.set(quat[0], quat[1], quat[2], quat[3]);
    one.setScalar(last.scale ?? 1);
    object.matrix.compose(pos, q, one);
    object.matrixWorld.copy(object.matrix);
  };

  return {
    object,
    get released() { return drop !== null; },
    reset() {
      drop = null;
      object.visible = true;
    },
    pose(gun, sinceFire, bodyRight, barrelSpin = 0) {
      if (drop) return;
      if (barrels) barrels.rotation.z = barrelSpin;
      const rise = muzzleRise(sinceFire);
      const quat: Quat = rise === 0 ? gun.quat : qMul(qFromAxisAngle(bodyRight, -rise), gun.quat);
      // Rise pivots about the grip, not the root: keep Grip_Hand where it is.
      const grip = gunPoint(gun, GUN_GRIP.gripHand);
      const root = sub(grip, qRotate(quat, scale(GUN_GRIP.gripHand, gun.scale ?? 1)));
      last = { root, quat, scale: gun.scale };
      write(root, quat);
    },
    release(handVel, seed, seat) {
      if (drop) return;
      drop = releaseProp(last.root, last.quat, scale(handVel, 1), seed);
      if (seat) {
        // Sector levels: seat the bounds CENTRE inside the level and move the root by the same correction.
        const centre = scale(centreLocal, last.scale ?? 1);
        const c = add(drop.pos, qRotate(drop.quat, centre));
        const at = seat(c, DROP.radius);
        const root: Vec3 = [drop.pos[0] + at.pos[0] - c[0], drop.pos[1] + at.pos[1] - c[1], drop.pos[2] + at.pos[2] - c[2]];
        drop = { ...drop, pos: root, centre, ...(at.floorY === undefined ? {} : { floorY: at.floorY }) };
      }
    },
    step(dt, floorY, ground) {
      if (!drop || drop.resting) return;
      drop = stepDrop(drop, dt, floorY, ground);
      last = { ...last, root: drop.pos, quat: drop.quat };
      write(drop.pos, drop.quat);
    },
    dropped() {
      return drop ? { pos: [drop.pos[0], drop.pos[1], drop.pos[2]] as Vec3, resting: drop.resting } : null;
    },
    muzzle(forward = 0) {
      return gunPoint(last, [muzzleAt[0], muzzleAt[1], muzzleAt[2] + forward]);
    },
    dispose() {
      object.removeFromParent();
      environment?.dispose();
      object.traverse(o => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.dispose();
      });
    },
  };
}
