// One record per march instance, read by the kernel through a read-only
// storage buffer (`inst` param). The slot index IS the prim-atlas band index.
// Layout is vec4-granular so the WGSL loader is `(*inst)[base + REC_X]`.
import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
import { DATA_ROWS } from './march.wgsl';
import type { SplitWarp } from '../head-split';
import { SPLIT_ABLATE, splitAblate } from './split-ablate';

export const REC_VEC4S = 21;
export const MAX_CROWD_INSTANCES = 64;

export const REC_COUNTS = 0;        // primCount, clusterCount, carveCount, maxBlendK
export const REC_COUNTS2 = 1;       // boneCount, bareBones, ownerRefoldGate, woundListGate
export const REC_WOUND_BOUND = 2;   // xyz centre, w radius (1e9 = no cull)
export const REC_ANCHOR_BAND = 3;   // bodyAnchor.xyz, w = band = slot * DATA_ROWS
export const REC_WIND_ALIVE = 4;    // windDrift.xyz, w = 1 alive / 0 free slot
export const REC_MELT = 5;          // meltCfg: x melt, y motion-out, z skin detail k, w body grain
export const REC_FLASH = 6;         // bodyFlash
export const REC_NOISE_YAW = 7;     // noiseShift.xyz, w = bodyYaw
export const REC_HEAD_WCOUNT = 8;   // headCentre.xyz, w = wound count
export const REC_HEAD_QUAT = 9;     // headQuat
export const REC_VOL_POSE0 = 10;    // volumePose0
export const REC_VOL_POSE1 = 11;    // volumePose1
export const REC_CENTRE_SEED = 12;  // bodyCentre.xyz, w = variantSeed
export const REC_HALF_REV = 13;     // bodyHalf.xyz, w = damageRevision
/** RUPTURE GORE (body-to-gib task 3): x = goreStrength 0..1. `lodCfg` is a
 *  per-VIEW uniform, so on the shared crowd draw a doomed body could not ramp
 *  its gore without ramping the whole type; the ramp has to ride the record.
 *  Slot 14 was the first free vec4. */
export const REC_GORE = 14;         // x = goreStrength, y/z = eye L/R glow OFF, w = eye disc radius (uv)
/** BURNING BODY: x = burn 0..1, y = seconds alight, z = char 0..1, w spare.
 *  Per-body and not per-view for the same reason as REC_GORE above: the crowd
 *  shares one material, so a single burning body needs its own ramp. */
export const REC_BURN = 15;        // burn, burnSec, char, spare
/** SHARED LIGHT LIST (spec §4): slot 16 is the body's light picks -- four
 *  packed floats, `index + weight` (weight in [0, 0.999], the CPU's absolute
 *  per-body strength for that light), -1 = empty, slot 0 the dominant light.
 *  Per-body for the same reason as REC_GORE: every SDF view is a crowd slot,
 *  and the record is the one place a body's own picks can ride. The WGSL
 *  decodes with i32(floor(v)) and fract(v). */
export const REC_LIGHTS = 16;      // 4 packed picks, -1 empty
/** THE HEAD SPLIT (head-split.ts SplitWarp, world space): slots 17-20. Per-body for the same reason as REC_GORE.
 *  A CLOSED head is four zero vec4s, and an open one carries a unit plane normal: the march reads slot 17 on every
 *  body and takes a non-zero normal as "open" (loadInstance), so it reads the other three only then. */
export const REC_SPLIT_N = 17;     // plane normal n.xyz, w = thetaP (the + side's angle, >= 0)
export const REC_SPLIT_H = 18;     // hinge point h.xyz, w = d0 (the plane offset: s(q) = n.q - d0)
export const REC_SPLIT_A = 19;     // hinge axis a.xyz, w = thetaM (the - side's angle, <= 0)
export const REC_SPLIT_R = 20;     // x = r (the region sphere's radius about h), yzw spare

function createRecordNode(attribute: THREE.StorageBufferAttribute, count: number) {
  return storage(attribute, 'vec4', count).toReadOnly();
}

/** Read-only vec4 storage node type, inferred from the TSL factory. */
export type CrowdRecordNode = ReturnType<typeof createRecordNode>;

export interface RecordSource {
  counts: ArrayLike<number>; counts2: ArrayLike<number>; woundBound: ArrayLike<number>;
  bodyAnchor: ArrayLike<number>; windDrift: ArrayLike<number>; meltCfg: ArrayLike<number>;
  bodyFlash: ArrayLike<number>; noiseShift: ArrayLike<number>; bodyYaw: number;
  headCentre: ArrayLike<number>; woundCount: number; headQuat: ArrayLike<number>;
  volumePose0: ArrayLike<number>; volumePose1: ArrayLike<number>;
  bodyCentre: ArrayLike<number>; variantSeed: number; bodyHalf: ArrayLike<number>; damageRevision: number;
  /** Rupture gore strength 0..1 (0 on a standing body, 1 on a chunk view). */
  gore: number;
  /** Per-eye face glow (onL, onR, radiusUV); omitted = both on. Stored as OFF flags (a zero record = on). */
  eyeMask?: ArrayLike<number>;
  burn: number;
  burnSec: number;
  charAmount: number;
  /** Four packed light picks (`index + weight`, -1 empty). Omitted = none. */
  lights?: readonly number[];
  /** The head split of the posed body this record draws (`posed.split`). Omitted or null = closed. */
  split?: SplitWarp | null;
}

export interface CrowdRecords {
  readonly capacity: number;
  readonly floats: Float32Array;
  readonly attribute: THREE.StorageBufferAttribute;
  /** Read-only storage node to bind as the kernel's `inst` param. */
  readonly node: CrowdRecordNode;
  dirty: boolean;
  write(slot: number, src: RecordSource, band?: number): void;
  alive(slot: number, on: boolean): void;
  /** Flags the attribute for upload if dirty; call once per frame after all writes. */
  flush(): void;
}

export function createCrowdRecords(capacity = MAX_CROWD_INSTANCES): CrowdRecords {
  const floats = new Float32Array(capacity * REC_VEC4S * 4);
  const attribute = new THREE.StorageBufferAttribute(floats, 4);
  attribute.setUsage(THREE.DynamicDrawUsage);
  const node = createRecordNode(attribute, capacity * REC_VEC4S);
  const put4 = (o: number, a: ArrayLike<number>, w?: number) => {
    floats[o] = a[0] ?? 0; floats[o + 1] = a[1] ?? 0; floats[o + 2] = a[2] ?? 0;
    floats[o + 3] = w ?? (a[3] ?? 0);
  };
  const rec: CrowdRecords = {
    capacity, floats, attribute, node, dirty: false,
    write(slot, s, band = slot * DATA_ROWS) {
      const b = slot * REC_VEC4S * 4;
      put4(b + REC_COUNTS * 4, s.counts);
      put4(b + REC_COUNTS2 * 4, s.counts2);
      put4(b + REC_WOUND_BOUND * 4, s.woundBound);
      put4(b + REC_ANCHOR_BAND * 4, s.bodyAnchor, band);
      put4(b + REC_WIND_ALIVE * 4, s.windDrift, 1);
      put4(b + REC_MELT * 4, s.meltCfg);
      put4(b + REC_FLASH * 4, s.bodyFlash);
      put4(b + REC_NOISE_YAW * 4, s.noiseShift, s.bodyYaw);
      put4(b + REC_HEAD_WCOUNT * 4, s.headCentre, s.woundCount);
      put4(b + REC_HEAD_QUAT * 4, s.headQuat);
      put4(b + REC_VOL_POSE0 * 4, s.volumePose0);
      put4(b + REC_VOL_POSE1 * 4, s.volumePose1);
      put4(b + REC_CENTRE_SEED * 4, s.bodyCentre, s.variantSeed);
      put4(b + REC_HALF_REV * 4, s.bodyHalf, s.damageRevision);
      const em = s.eyeMask;
      put4(b + REC_GORE * 4, [s.gore, em ? 1 - (em[0] ?? 1) : 0, em ? 1 - (em[1] ?? 1) : 0, em ? (em[2] ?? 0) : 0]);
      put4(b + REC_BURN * 4, [s.burn, s.burnSec, s.charAmount, 0]);
      const l = s.lights;
      const lo = b + REC_LIGHTS * 4;
      floats[lo] = l?.[0] ?? -1; floats[lo + 1] = l?.[1] ?? -1;
      floats[lo + 2] = l?.[2] ?? -1; floats[lo + 3] = l?.[3] ?? -1;
      // No split, or one with neither side turned, is the zero record (see REC_SPLIT_N).
      const sp = s.split;
      const so = b + REC_SPLIT_N * 4;
      if (sp && (sp.thetaP !== 0 || sp.thetaM !== 0)) {
        put4(so, sp.n, sp.thetaP);
        put4(b + REC_SPLIT_H * 4, sp.h, sp.d0);
        put4(b + REC_SPLIT_A * 4, sp.a, sp.thetaM);
        const ro = b + REC_SPLIT_R * 4;
        // .y: the ablation mask, in a `?splitablate` build only (split-ablate.ts); 0 on every shipped page.
        floats[ro] = sp.r; floats[ro + 1] = SPLIT_ABLATE ? splitAblate.mask : 0; floats[ro + 2] = 0; floats[ro + 3] = 0;
      } else {
        floats.fill(0, so, b + (REC_SPLIT_R + 1) * 4);
        if (SPLIT_ABLATE) floats[b + REC_SPLIT_R * 4 + 1] = splitAblate.mask;
      }
      rec.dirty = true;
    },
    alive(slot, on) {
      const b = slot * REC_VEC4S * 4;
      floats[b + REC_WIND_ALIVE * 4 + 3] = on ? 1 : 0;
      // A freed slot keeps no split: whatever takes it next starts closed.
      if (!on) floats.fill(0, b + REC_SPLIT_N * 4, b + (REC_SPLIT_R + 1) * 4);
      rec.dirty = true;
    },
    flush() { if (rec.dirty) { attribute.needsUpdate = true; rec.dirty = false; } },
  };
  return rec;
}

/** Zero-filled singleton for materials built without a crowd (tests, hands view). */
let fallback: CrowdRecords | null = null;
export function fallbackCrowdRecords(): CrowdRecords {
  if (!fallback) fallback = createCrowdRecords(1);
  return fallback;
}

/**
 * Lowest free slot, removed from `free`. -1 when the set is full. Linear in
 * the free-set size, and the set only ever holds free slots, so a full set
 * costs its capacity checks — cheaper than a heap for this size and
 * deterministic. Shared by the CrowdType slot pool and the shared chunk
 * material's record-slot pool (task 7c), so both allocate lowest-first.
 */
export function allocateSlot(free: Set<number>): number {
  let best = -1;
  for (const s of free) if (best < 0 || s < best) best = s;
  if (best >= 0) free.delete(best);
  return best;
}
