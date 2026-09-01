// src/lab/sdf-zombie/webgpu/dungeon-lighting.ts
//
// THE DUNGEON RIG, AS DATA. Kept separate from game-main so the numbers can be
// gated by test without standing up a renderer, and so the gallery rig survives
// as a live A/B rather than as a comment. See
// docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md.
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
