// src/lab/sdf-zombie/webgpu/probe-lighting-node.ts
//
// LEVEL SURFACES READING THE PROBES (lighting P3/P4, step 3; plan
// docs/superpowers/plans/2026-09-10-level-probe-lighting.md). The walls,
// floor and ceiling are three MeshStandard materials on the FORWARD path;
// three composes their indirect diffuse from `builder.context.irradiance`,
// which HemisphereLightNode writes with addAssign. ProbeLightingNode does the
// same with the room's probe irradiance — static grid plus the GPU gather's
// dynamic layer — evaluated by the SAME WGSL the march runs (`probeIrradiance`
// from probe-grid.wgsl.ts, `probeDynamic` from probe-dynamic.wgsl.ts) against
// the same probe texture and the same dynamic storage node the bodies bind,
// so walls and flesh cannot disagree about the light.
//
// One node per ROOM, shared by every surface of that room: uniform updates
// are O(rooms), and every surface of a room compiles to one pipeline.
//
// `material.lightsNode` REPLACES the scene's light list for that material
// (NodeMaterial.lightsNode), so levelLightsNode re-lists the real lights and
// appends the probe node. Forgetting a light there darkens the level
// silently — probe-lighting-node.test.ts pins the list shape.
import * as THREE from 'three/webgpu';
import { wgslFn, positionWorld, normalWorld, texture, uniform, lights, storage } from 'three/tsl';
import { PROBE_GRID_WGSL } from './probe-grid.wgsl';
import { PROBE_DYNAMIC_WGSL } from './probe-dynamic.wgsl';
import { luminance, type Vec3 } from '../ambient';
import { sampleProbeGrid, type ProbeGrid } from '../probe-grid';

/** The evaluators the level node includes, BY IDENTITY the march's strings. */
export const PROBE_LEVEL_INCLUDES: readonly string[] = [PROBE_GRID_WGSL, PROBE_DYNAMIC_WGSL];

/**
 * The level's probe irradiance: the march's two probe terms, gated the same
 * way (see march.wgsl.ts around `probeIrradiance(` / `probeDynamic(`), minus
 * the P1 fill the bodies mix against — on a wall the hemisphere light IS
 * that fill and it is faded on the CPU (hemi.intensity) as the weight rises.
 *
 *   E = probe * cfg.y * cfg.x                  (static grid; 0 when either is 0)
 *   E = E * mix(1, dyn.w, dynCfg.y) + dyn.xyz * dynCfg.x   (dynamic layer)
 *
 * Both gates at zero skip the reads entirely — the node stays in the light
 * list but adds nothing, which is what ?levelprobes=0 pins.
 */
export const PROBE_LEVEL_WGSL = /* wgsl */ `fn probeLevelIrradiance(
  p: vec3<f32>,
  n: vec3<f32>,
  probeTex: texture_2d<f32>,
  probeDyn: ptr<storage, array<vec4<f32>>, read>,
  probeMin: vec3<f32>,
  probeInvExtent: vec3<f32>,
  probeDims: vec4<f32>,
  probeCfg: vec4<f32>,
  probeDynCfg: vec4<f32>
) -> vec3<f32> {
  var e = vec3<f32>(0.0, 0.0, 0.0);
  if (probeCfg.x > 0.0 && probeCfg.y > 0.0) {
    e = probeIrradiance(p, n, probeTex, probeMin, probeInvExtent, probeDims) * probeCfg.y * probeCfg.x;
  }
  if (probeDynCfg.x > 0.0 || probeDynCfg.y > 0.0) {
    let dyn = probeDynamic(p, n, probeDyn, probeMin, probeInvExtent, probeDims);
    e = e * mix(1.0, dyn.w, probeDynCfg.y) + dyn.xyz * probeDynCfg.x;
  }
  return e;
}`;

/** The five static probe slots (room-probes.ts stamp() writes these) plus
 *  the dynamic layer's cfg. Same shapes as the march's uniforms so
 *  RoomProbes.bind() can stamp a room node like a body. */
/** A uniform node whose `.value` the game stamps — the shape wgslFn takes. */
export type UniformOf<T> = THREE.Node & { value: T };

export interface ProbeLevelSlots {
  probeTex: THREE.TextureNode;
  probeMin: UniformOf<THREE.Vector3>;
  probeInvExtent: UniformOf<THREE.Vector3>;
  probeDims: UniformOf<THREE.Vector4>;
  probeCfg: UniformOf<THREE.Vector4>;
  probeDynCfg: UniformOf<THREE.Vector4>;
  /** The gather's read-only storage node (probeGather.probeDynNode) or a
   *  private zero fallback. Bound at construction — a storage node cannot
   *  be rebound after the pipeline compiles. */
  probeDyn: unknown;
  /** The node's own fallback texture, disposed with the node. */
  readonly ownedFallback: THREE.DataTexture;
}

/**
 * One owned 1x3 zero probe texture per node. NEVER share one DataTexture
 * between two texture() nodes: a TextureNode's uniform hash is its value's
 * uuid, so two nodes over one texture collapse into one binding for the
 * pipeline's life (the M2 trap, see deferred-layer.ts).
 */
export function createProbeLevelSlots(probeDyn?: unknown): ProbeLevelSlots {
  const fallback = new THREE.DataTexture(new Float32Array(12), 3, 1, THREE.RGBAFormat, THREE.FloatType);
  fallback.needsUpdate = true;
  let dyn = probeDyn;
  if (dyn === undefined) {
    const a = new THREE.StorageBufferAttribute(4, 4);
    dyn = storage(a, 'vec4', 4).toReadOnly();
  }
  return {
    probeTex: texture(fallback),
    probeMin: uniform(new THREE.Vector3(0, 0, 0)),
    probeInvExtent: uniform(new THREE.Vector3(0, 0, 0)),
    probeDims: uniform(new THREE.Vector4(1, 1, 1, 0)),
    probeCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
    probeDynCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
    probeDyn: dyn,
    ownedFallback: fallback,
  };
}

/**
 * Adds the room's probe irradiance to the material's indirect diffuse. The
 * hook is the one HemisphereLightNode uses (`context.irradiance.addAssign`),
 * so the probe term rides the same BRDF path as the hemisphere it replaces.
 */
export class ProbeLightingNode extends THREE.LightingNode {
  static get type(): string { return 'ProbeLightingNode'; }
  readonly isProbeLightingNode = true;
  readonly slots: ProbeLevelSlots;
  private readonly evalNode: ReturnType<typeof wgslFn>;

  constructor(slots: ProbeLevelSlots) {
    super();
    this.slots = slots;
    // The include chain mirrors zombie-gpu.ts: each wgslFn carries its
    // dependency so three emits the evaluators once, in declaration order.
    // (three's CodeNodeInclude typing does not admit wgslFn's own return
    // type, though the runtime takes it — zombie-gpu.ts relies on the same.)
    const grid = wgslFn(PROBE_GRID_WGSL);
    const dyn = wgslFn(PROBE_DYNAMIC_WGSL, [grid as never]);
    this.evalNode = wgslFn(PROBE_LEVEL_WGSL, [dyn as never]);
  }

  override setup(builder: THREE.NodeBuilder): undefined {
    const s = this.slots;
    const e = this.evalNode(
      positionWorld, normalWorld, s.probeTex, s.probeDyn as never,
      s.probeMin, s.probeInvExtent, s.probeDims, s.probeCfg, s.probeDynCfg,
    );
    const ctx = (builder as unknown as { context: { irradiance: { addAssign(n: unknown): void } } }).context;
    ctx.irradiance.addAssign(e);
    return undefined;
  }

  override dispose(): void {
    this.slots.ownedFallback.dispose();
    super.dispose();
  }
}

/**
 * The light list for a level material: the scene's real lights (which
 * `lightsNode` would otherwise drop) followed by the room's probe node.
 * three sorts the list by id at setup; the order here is only the contract
 * the test pins. Every entry adds into the same irradiance, so order does
 * not change the result.
 */
export function levelLightsNode(sceneLights: readonly THREE.Light[], probe: ProbeLightingNode): THREE.LightsNode {
  return lights([...sceneLights, probe as unknown as THREE.Light]);
}

/**
 * The gain that puts the grid's room-centre irradiance (mean over the six
 * axis normals, like room-probes matchedGain) at the HEMISPHERE light's
 * mean contribution, so nothing gets brighter when the seam flips: a
 * hemisphere of intensity I with sky s and ground g averages I * (s + g) / 2
 * over those six normals (±x, ±z sit at the mix midpoint; +y and −y bracket
 * it). 0 when the grid is dark.
 */
export function levelMatchedGain(
  grid: ProbeGrid, hemi: { sky: Vec3; ground: Vec3; intensity: number },
): number {
  const c: Vec3 = [
    (grid.min[0] + grid.max[0]) / 2, (grid.min[1] + grid.max[1]) / 2, (grid.min[2] + grid.max[2]) / 2,
  ];
  const axes: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let lum = 0;
  for (const n of axes) lum += luminance(sampleProbeGrid(grid, c, n));
  lum /= axes.length;
  const mean: Vec3 = [
    (hemi.sky[0] + hemi.ground[0]) / 2, (hemi.sky[1] + hemi.ground[1]) / 2, (hemi.sky[2] + hemi.ground[2]) / 2,
  ];
  const target = hemi.intensity * luminance(mean);
  return lum > 1e-6 ? target / lum : 0;
}
