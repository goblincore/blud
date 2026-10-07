// src/lab/sdf-zombie/webgpu/level-tier.ts
//
// THE CHEAP LEVEL TIER (spec 2026-09-29-level-list-lighting-design.md). Pure, no three: which lights the level's
// materials shade through the list node instead of a three.js light, which list indices a room's node loops over,
// and the CPU twins of the node's math (level-list-node.ts LEVEL_LIST_WGSL is the port; change one, change both —
// level-tier.test.ts and level-list-node.test.ts pin the pair).
//
// The falloff is three's, so a light that moves here keeps its look: three's getDistanceAttenuation (the Frostbite
// window), SpotLightNode's smoothstep cone, and Lambert scaling in the node (irradiance x diffuseColor / PI).
import { maskHasRoom, type ListLight, type Vec3 } from './light-list';

/** Cheap lights the node loops over per room. */
export const LEVEL_PICKS = 8;
/** A tube spot's decay (TUBE.decay in game-dynamic-light.ts). */
export const LEVEL_SPOT_DECAY = 1.2;
/** three's PointLight default, which the level's accent points keep. */
export const LEVEL_POINT_DECAY = 2;

export interface LevelCheapInput { fixture?: 'bulb' | 'tube' | 'beacon'; mood?: string; shadow?: boolean }

/** The one rule for the tier: fire-mood lights and shadowless tubes. Beacons are shadowed sweeps: never. */
export function isLevelCheap(a: LevelCheapInput): boolean {
  if (a.fixture === 'beacon') return false;
  if (a.mood === 'fire') return true;
  return a.fixture === 'tube' && a.shadow === false;
}

export const levelDecay = (kind: ListLight['kind']): number => (kind === 'spot' ? LEVEL_SPOT_DECAY : LEVEL_POINT_DECAY);
/** A spot cuts off at its list range (three's spot distance); a point has none (three's accent points have distance 0). */
export const levelCutoff = (l: Pick<ListLight, 'kind' | 'range'>): number => (l.kind === 'spot' ? l.range : 0);

/** three's getDistanceAttenuation. */
export function distanceAttenuation(dist: number, cutoff: number, decay: number): number {
  const falloff = 1 / Math.max(Math.pow(dist, decay), 0.01);
  if (cutoff > 0) {
    const r = Math.min(1, Math.max(0, 1 - Math.pow(dist / cutoff, 4)));
    return falloff * r * r;
  }
  return falloff;
}

/** three's SpotLightNode smoothstep(coneCos, penumbraCos, angleCos), guarded against a zero-width penumbra. */
export function spotFactor(cosAngle: number, cosOuter: number, cosInner: number): number {
  const w = Math.max(cosInner - cosOuter, 1e-4);
  const t = Math.min(1, Math.max(0, (cosAngle - cosOuter) / w));
  return t * t * (3 - 2 * t);
}

/** The packed cone lane (light-list.ts packLightList: floor(cosOuter x 1000) + cosInner x 0.999). */
export function decodeCone(cone: number): { cosOuter: number; cosInner: number } {
  const f = Math.floor(cone);
  return { cosOuter: f / 1000, cosInner: (cone - f) / 0.999 };
}

/** One light's contribution to a surface point p with normal n: n.L x colour x falloff x cone. The node multiplies
 *  the sum by diffuseColor / PI. The cone uses the packed (quantised) cosOuter, like the GPU. */
export function levelIrradiance(l: ListLight, p: Vec3, n: Vec3): Vec3 {
  const lx = l.pos[0] - p[0], ly = l.pos[1] - p[1], lz = l.pos[2] - p[2];
  const d = Math.max(Math.hypot(lx, ly, lz), 1e-4);
  const Lx = lx / d, Ly = ly / d, Lz = lz / d;
  const nl = Math.max(n[0] * Lx + n[1] * Ly + n[2] * Lz, 0);
  const att = distanceAttenuation(d, levelCutoff(l), levelDecay(l.kind));
  let sp = 1;
  if (l.kind === 'spot') {
    const outer = Math.floor(l.cosOuter * 1000) / 1000;
    sp = spotFactor(-(Lx * l.axis[0] + Ly * l.axis[1] + Lz * l.axis[2]), outer, l.cosInner);
  }
  const k = nl * att * sp;
  return [l.color[0] * k, l.color[1] * k, l.color[2] * k];
}

/** Fill `out` (length >= LEVEL_PICKS) with the list indices of the cheap lights that reach `room`, in list order, padded
 *  with -1; returns how many. Allocation-free. */
export function cheapLevelIndices(list: readonly ListLight[], room: number, out: number[] | Float32Array): number {
  let n = 0;
  for (let i = 0; i < list.length && n < LEVEL_PICKS; i++) {
    const l = list[i]!;
    if (l.levelCheap && maskHasRoom(l.roomMask, room)) out[n++] = i;
  }
  for (let k = n; k < LEVEL_PICKS; k++) out[k] = -1;
  return n;
}
