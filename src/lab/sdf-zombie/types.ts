// src/lab/sdf-zombie/types.ts
import type { Quat } from './vec';

export type Vec3 = readonly [number, number, number];

/** Fixed fold order. Index into this array IS the cluster id. Never reorder. */
export const CLUSTER_ORDER = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'] as const;
export type LimbId = (typeof CLUSTER_ORDER)[number];

/** Authoring-time limb, before mirror expansion. */
export type LimbBase = 'head' | 'torso' | 'arm' | 'leg';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Direction in world axes (this body is authored in a rest pose, no rotations). */
  dir: Vec3;
  length: number;
  /** Lateral (x) offset of this bone's head from its parent's tail. Negated on the mirrored side. */
  side?: number;
  /** When true, expands into `<name>.l` and `<name>.r`. */
  mirror?: boolean;
}

export interface PrimDef {
  /** Bone name this primitive rides. For mirrored prims, the unsuffixed base name. */
  bone: string;
  /** Normalised position along the bone, 0 = head, 1 = tail. */
  at: number;
  /** When set, the primitive is a capsule spanning `at` → `capTo` on the same bone. */
  capTo?: number;
  radius: number;
  /** Ellipsoid axis scale applied to the primitive's local space. */
  scale: Vec3;
  /** Smooth-min strength against the rest of the body. */
  blendK: number;
  limb: LimbBase;
  mirror?: boolean;
  /**
   * 'sub' carves this primitive out of the assembled field instead of adding
   * to it. Carves apply AFTER the complete additive fold — see applyCarves in
   * march.glsl.ts for why not per-cluster.
   */
  op?: 'add' | 'sub';
  /**
   * Displacement from the bone-relative placement, in world axes. The body is
   * authored in a rest pose with no rotations, so world and bone axes coincide
   * at authoring time.
   */
  offset?: Vec3;
  /**
   * Emits two copies with `offset.x` negated. For bilateral features on a bone
   * that is NOT itself mirrored — eye sockets on the skull. Distinct from
   * `mirror`, which requires a mirrored bone and throws without one.
   */
  mirrorOffset?: boolean;
}

export interface BodyDef {
  name: string;
  /** World position of the root bone's head. */
  root: Vec3;
  bones: BoneDef[];
  prims: PrimDef[];
}

/** A resolved primitive in rest space. */
export interface Primitive {
  a: Vec3;
  b: Vec3;
  radius: number;
  scale: Vec3;
  blendK: number;
  limb: LimbId;
  cluster: number;
  /**
   * Absent means 'add'. Optional rather than required so the many existing
   * test fixtures that build Primitive literals keep compiling.
   */
  op?: 'add' | 'sub';
  /**
   * Severed mid-limb but never removed — the smooth-min fold order is sacred,
   * so a distal prim goes DEAD instead: packBody writes primScale.w = 2 and
   * every field (shader add fold, carve pass, CPU mirror) skips it. Absent
   * means alive.
   */
  dead?: boolean;
  /**
   * Per-prim ORIENTATION (motion-polish task 3): the quaternion that carries
   * the prim's local frame into world space. Absent means identity — almost
   * every prim is identity; applyRig sets it to the head's rigid rotation on
   * skull-owned prims so the anisotropically scaled face ellipsoids (brow,
   * nose, jaw, cranium) rotate WITH the head instead of staying world-aligned
   * (the detached-visor bug). sdPrim/sdPrimitive rotate the sample point into
   * the prim's local frame by the CONJUGATE about the prim midpoint before
   * the scale-divide. Optional so fixtures compile — same pattern as `dead`.
   */
  orient?: Quat;
}

export interface ClusterInfo {
  id: number;
  limb: LimbId;
  /** Index of the first primitive of this cluster in `BuiltBody.prims`. */
  start: number;
  count: number;
  center: Vec3;
  radius: number;
  alive: boolean;
}

export interface ResolvedBone {
  head: Vec3;
  tail: Vec3;
}

export interface BuiltBody {
  /** Sorted by cluster id. Never reorder — see the fold-order constraint. */
  prims: Primitive[];
  clusters: ClusterInfo[];
  bones: Map<string, ResolvedBone>;
}
