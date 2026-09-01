// src/lab/sdf-zombie/webgpu/dungeon-lighting.ts
//
// THE DUNGEON RIG, AS DATA. Kept separate from game-main so the numbers can be
// gated by test without standing up a renderer, and so the gallery rig survives
// as a live A/B rather than as a comment. See
// docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md.
//
// THREE comes from 'three/webgpu', never bare 'three': importing both loads two
// copies of three and the node system stops recognising lights constructed by
// the other copy (lab-renderer.ts header). Do not split these imports.
import * as THREE from 'three/webgpu';
import { OCCLUDER_LAYER } from './sdf-layer';

export type Vec3 = [number, number, number];

export interface AmbientRig {
  /** THREE.AmbientLight intensity. */
  ambientIntensity: number;
  /** THREE.HemisphereLight intensity. */
  hemiIntensity: number;
  /** THREE.DirectionalLight intensity — 0 in a dungeon; there is no sun. */
  sunIntensity: number;
  ambientColor: Vec3;
  hemiSky: Vec3;
  hemiGround: Vec3;
  fogColor: Vec3;
  fogNear: number;
  fogFar: number;
  /** Near-white. Warm light on warm stone kills the specular we are here for. */
  flashlightColor: Vec3;
  /** Warm fire, the only warm source in the room. */
  practicalColor: Vec3;
}

/** The white-wall gallery as it shipped (L1 P1). Kept for the A/B and as the
 *  fixture the dungeon's darkness assertions are measured against. */
export const GALLERY_RIG: AmbientRig = {
  ambientIntensity: 0.95,
  hemiIntensity: 0.75,
  sunIntensity: 0.9,
  ambientColor: [1, 1, 1],
  hemiSky: [0.96, 0.95, 0.94],
  hemiGround: [0.56, 0.55, 0.52],
  fogColor: [0.10, 0.067, 0.086],
  fogNear: 10,
  fogFar: 60,
  flashlightColor: [1, 0.97, 0.94],
  practicalColor: [1, 0.55, 0.12],
};

/** Dark, dank, wet gray. Ambient is a FLOOR, not a fill: enough that geometry
 *  is not literally invisible when the beam points elsewhere, far too little to
 *  read by. Everything you actually see comes from the flashlight and the fires. */
export const DUNGEON_RIG: AmbientRig = {
  ambientIntensity: 0.035,
  hemiIntensity: 0.05,
  sunIntensity: 0,
  ambientColor: [0.52, 0.57, 0.63],   // cold, slightly blue — damp stone in the dark
  hemiSky: [0.34, 0.38, 0.44],
  hemiGround: [0.13, 0.13, 0.12],
  fogColor: [0.008, 0.009, 0.011],    // effectively black
  fogNear: 2.5,
  fogFar: 13,
  flashlightColor: [0.94, 0.96, 1.0], // cold near-white
  practicalColor: [1.0, 0.46, 0.13],  // fire
};

/** Offset from the eye, in view space: right, up, forward.
 *
 *  LOAD-BEARING. A flashlight AT the eye casts no visible shadow — every
 *  shadow it throws is exactly hidden behind the object throwing it (the
 *  headlight problem, demonstrated live during the spike). The horizontal
 *  offset is what makes shadows emerge, and it is the entire Doom 3 read. */
export const FLASHLIGHT_OFFSET: Vec3 = [0.25, -0.15, 0.1];

export interface Flashlight {
  spot: THREE.SpotLight;
  /** Pose the light from the camera each frame. */
  update(camera: THREE.PerspectiveCamera): void;
}

export function createFlashlight(rig: AmbientRig = DUNGEON_RIG): Flashlight {
  const c = rig.flashlightColor;
  const spot = new THREE.SpotLight(
    new THREE.Color(c[0], c[1], c[2]),
    90,               // intensity — physically-correct falloff wants a big number
    16,               // distance
    Math.PI * 0.12,   // cone half-angle. 0.24π (the first cut) is a FLOODLIGHT:
                      // an 86° full cone at this intensity swallows the whole
                      // room and the page reads gallery-bright (seen on the
                      // 2026-09-01 task-2 captures). ~22° half reads as a
                      // torch: one bright disc, dark everywhere else.
    0.45,             // penumbra
    1.6,              // decay
  );
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 0.2;
  spot.shadow.camera.far = 18;
  spot.shadow.bias = -0.002;

  // THE FIX — see the test above and the spec's spike section. Setting any bit
  // above bit 0 stops three inheriting the main camera's (mid-frame, wrong)
  // mask, AND opts the character hull in as a shadow caster. One change, both
  // shadow mechanisms.
  spot.shadow.camera.layers.set(0);
  spot.shadow.camera.layers.enable(OCCLUDER_LAYER);

  const eye = new THREE.Vector3();
  const off = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function update(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld();
    camera.getWorldPosition(eye);
    off.set(FLASHLIGHT_OFFSET[0], FLASHLIGHT_OFFSET[1], FLASHLIGHT_OFFSET[2])
      .applyQuaternion(camera.quaternion);
    spot.position.copy(eye).add(off);
    camera.getWorldDirection(fwd);
    spot.target.position.copy(spot.position).addScaledVector(fwd, 10);
    spot.target.updateMatrixWorld();
    spot.updateMatrixWorld();
  }

  return { spot, update };
}
