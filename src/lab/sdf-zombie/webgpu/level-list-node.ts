// src/lab/sdf-zombie/webgpu/level-list-node.ts
//
// THE CHEAP LEVEL TIER'S NODE (spec 2026-09-29-level-list-lighting-design.md). One per room, in that room's level
// `lightsNode`, next to three's shadowed lights and the room's ProbeLightingNode. It shades the room's cheap lights
// (level-tier.ts) straight out of the shared list's storage buffer, DIFFUSE ONLY: n.L x colour x three's falloff x cone.
// It adds into `reflectedLight.directDiffuse`, where three's own direct diffuse lands, scaled as three's Lambert
// (diffuseColor / PI), so fog, tone and everything downstream are unchanged.
//
// The picks are two vec4 uniforms holding up to 8 list indices (-1 = empty), written once a frame by writeLightList
// (game-light-list-leaves.ts). LEVEL_LIST_WGSL's CPU twin is level-tier.ts levelIrradiance: change one, change both.
import * as THREE from 'three/webgpu';
import { wgslFn, positionWorld, normalWorld, uniform, diffuseColor, vec3 } from 'three/tsl';
import { LIGHT_VEC4S, LIST_LIGHTS_AT } from './light-list';
import { LEVEL_POINT_DECAY, LEVEL_SPOT_DECAY } from './level-tier';

/** The layout of one light record (light-list.ts packLightList): a = pos.xyz + kind (0 point, 1 spot, 2 directional),
 *  a1 = colour.rgb (physical: colour x intensity) + range, a2 = axis.xyz + packed cone. */
export const LEVEL_LIST_WGSL = /* wgsl */ `fn levelListIrradiance(p: vec3<f32>, n: vec3<f32>, picksA: vec4<f32>, picksB: vec4<f32>, count: f32, lights: ptr<storage, array<vec4<f32>>, read>) -> vec3<f32> {
  var e = vec3<f32>(0.0, 0.0, 0.0);
  // The picks are packed at the front (cheapLevelIndices), so a uniform count bounds the loop: a room with one
  // cheap light runs one iteration, and a room with none skips the loop.
  let n_picks = i32(count);
  for (var k = 0; k < n_picks; k = k + 1) {
    let iv = select(picksB[k & 3], picksA[k & 3], k < 4);
    let base = ${LIST_LIGHTS_AT} + i32(iv) * ${LIGHT_VEC4S};
    let a0 = (*lights)[base];
    let a1 = (*lights)[base + 1];
    let a2 = (*lights)[base + 2];
    let lv = a0.xyz - p;
    let d = max(length(lv), 0.0001);
    let L = lv / d;
    let isSpot = a0.w > 0.5 && a0.w < 1.5;
    let decay = select(${LEVEL_POINT_DECAY.toFixed(1)}, ${LEVEL_SPOT_DECAY.toFixed(1)}, isSpot);
    let cutoff = select(0.0, a1.w, isSpot);
    var att = 1.0 / max(pow(d, decay), 0.01);
    if (cutoff > 0.0) {
      let r = clamp(1.0 - pow(d / cutoff, 4.0), 0.0, 1.0);
      att = att * r * r;
    }
    var sp = 1.0;
    if (isSpot) {
      let cosOuter = floor(a2.w) / 1000.0;
      let cosInner = fract(a2.w) / 0.999;
      let t = clamp((-dot(L, a2.xyz) - cosOuter) / max(cosInner - cosOuter, 0.0001), 0.0, 1.0);
      sp = t * t * (3.0 - 2.0 * t);
    }
    e = e + a1.rgb * (max(dot(n, L), 0.0) * att * sp);
  }
  return e;
}`;

export class LevelListLightingNode extends THREE.LightingNode {
  static get type(): string { return 'LevelListLightingNode'; }
  readonly isLevelListLightingNode = true;
  readonly picksA = uniform(new THREE.Vector4(-1, -1, -1, -1));
  readonly picksB = uniform(new THREE.Vector4(-1, -1, -1, -1));
  /** How many leading picks are live (the loop bound). */
  readonly count = uniform(0);
  private readonly evalNode = wgslFn(LEVEL_LIST_WGSL);
  private readonly listNode: unknown;

  /** `listNode`: the shared list's read-only storage node (LightListGpu.node), bound at construction. */
  constructor(listNode: unknown) {
    super();
    this.listNode = listNode;
  }

  /** Eight list indices (-1 = empty), as cheapLevelIndices writes them. */
  setPicks(idx: ArrayLike<number>): void {
    this.picksA.value.set(idx[0]!, idx[1]!, idx[2]!, idx[3]!);
    this.picksB.value.set(idx[4]!, idx[5]!, idx[6]!, idx[7]!);
    let n = 0;
    while (n < 8 && idx[n]! >= 0) n++;
    this.count.value = n;
  }

  override setup(builder: THREE.NodeBuilder): undefined {
    const e = this.evalNode(positionWorld, normalWorld, this.picksA, this.picksB, this.count, this.listNode as never);
    const ctx = (builder as unknown as { context: { reflectedLight: { directDiffuse: { addAssign(n: unknown): void } } } }).context;
    // three's BRDF_Lambert: irradiance x diffuseColor / PI.
    ctx.reflectedLight.directDiffuse.addAssign((e as unknown as ReturnType<typeof vec3>).mul(diffuseColor.rgb).mul(1 / Math.PI));
    return undefined;
  }
}
