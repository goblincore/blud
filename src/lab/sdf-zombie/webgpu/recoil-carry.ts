// src/lab/sdf-zombie/webgpu/recoil-carry.ts
//
// The support hands ride the gun through the kick. The hands (and the arms
// aimed from the shoulders to them) were placed once at the rest pose and only
// moved during a reload, so when the recoil threw the gun up and back the hands
// stayed behind, hanging in the air where the fore-end used to be.
//
// The gun turns about its own origin (gunGroup.position, rotation x = pitch,
// z = roll). A hand gripping it is carried by the RECOIL part of that motion
// only -- the reload drives the fore hand on its own path, so the whole gun pose
// would double-count it.
import * as THREE from 'three';

export interface GunRest { pos: THREE.Vector3; pitchDeg: number; rollDeg: number }
export interface RecoilDelta { dy: number; dz: number; pitch: number; roll: number }

const _qRest = new THREE.Quaternion();
const _qNow = new THREE.Quaternion();
const _e = new THREE.Euler();
const _lift = new THREE.Vector3();
const rad = (d: number): number => (d * Math.PI) / 180;

/** `hand` (its rest position, rig space) carried with the gun's recoil, into `out`. */
export function carryWithRecoil(hand: THREE.Vector3, rest: GunRest, rc: RecoilDelta, out: THREE.Vector3): THREE.Vector3 {
  _qRest.setFromEuler(_e.set(rad(rest.pitchDeg), 0, rad(rest.rollDeg), 'XYZ')).invert();
  _qNow.setFromEuler(_e.set(rad(rest.pitchDeg + rc.pitch), 0, rad(rest.rollDeg + rc.roll), 'XYZ'));
  return out.copy(hand).sub(rest.pos).applyQuaternion(_qRest).applyQuaternion(_qNow)
    .add(rest.pos).add(_lift.set(0, rc.dy, rc.dz));
}
