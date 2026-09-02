// src/lab/sdf-zombie/damage.ts
import type { Primitive, Vec3 } from './types';
import { add, basisFromAxis, dot, len, normalize, qFromTo, qRotate, scale, sub } from './vec';
import { rotateYaw } from './gait';
import { sdPrimitive } from './validate';

/** Must match MAX_WOUNDS in the fragment shader. */
export const MAX_WOUNDS = 16;

export type WoundType = 'pellet' | 'blast' | 'burn';

/** Per-type wound character — the "weapon calibre" knobs. rimSplayScale and
 *  rimOffsetScale multiply the global woundCfg rim settings PER WOUND, packed
 *  into the spare ROW_WOUND_META channels (z, w). */
export interface WoundProfile {
  radius: number;
  rimSplayScale: number;
  rimOffsetScale: number;
}
export const WOUND_PROFILES: Record<WoundType, WoundProfile> = {
  // Pellet: small clean punch. Splay 0.35, not 0.8: at 0.8 the lip was 2.4 cm
  // tall on a 5.5 cm crater — a volcano that read as a convex red bump beside
  // a blast's dish (cyclops, 2026-08-23). A puncture has a thin lip.
  pellet: { radius: 0.055, rimSplayScale: 0.8, rimOffsetScale: 1.0 },
  // Blast: big crater but a TAMED lip — the default splay welded the arm to
  // the torso at the shoulder (playtest 2026-08-16 screenshot 1).
  blast: { radius: 0.13, rimSplayScale: 0.45, rimOffsetScale: 0.85 },
  // Burn: chars and contracts; barely everts (shader already scales by 0.25).
  burn: { radius: 0.08, rimSplayScale: 1.0, rimOffsetScale: 1.0 },
};

export interface Wound {
  /** Index into the built primitive array — the primitive this wound rides. */
  primIdx: number;
  /** Hit position in that primitive's local frame (u, v, w along the basis
   *  `frame(prim, bodyYaw)` builds — axis basis de-yawed by the body yaw, or
   *  the orient-quat basis for rigid-head prims). */
  local: Vec3;
  radius: number;
  type: WoundType;
  ageSec: number;
  /**
   * The primitive's unit axis in the DE-YAWED body frame at stamp time — the
   * anchor the local frame is transported from on every later map (see
   * `frame`). Absent for oriented prims (their frame is the orient quat) and
   * for wounds made before this field existed, which fall back to rebuilding
   * the frame from the live axis.
   */
  axis0?: Vec3;
  /**
   * Multiplier on this wound's everted-rim amplitude, 0..1, from how much
   * flesh there was behind the hit (see `rimScaleFor`). Absent means 1 — the
   * full lip — which is right for every torso hit and for callers that have
   * no field to probe (explosions on chunks).
   */
  rimScale?: number;
  /**
   * SEVERING IS A DAMAGE DECISION, NOT A CRATER SIDE-EFFECT. When set, this
   * is the radius connectivity's carve-union test (cutLimbs/cutChains) uses
   * for this wound; the VISUAL carve always uses `radius`. Absent means
   * `radius` governs both — the blast path keeps that (a falloff-scaled
   * blast wound's own radius IS its severing power), and every wound
   * stamped before this field existed behaves exactly as before.
   *
   * Why it exists: the grapeshot fires ~10 cm pellet balls whose honest
   * crater is the stock 5.5 cm pellet profile, but one-directional pellet
   * volleys only ever carve the NEAR side of a joint's cross-section disc,
   * so 5.5 cm carve spheres can never cover it and nothing ever severs
   * (measured sweep: 0.055/0.07/0.085 never sever; 0.10 severs a shoulder
   * in ~8 pellets). Inflating the crater to 0.10 fixed severing but the
   * crater was then wider than a forearm and carved the whole cross-section
   * laterally — the see-through-hole report, 2026-08-26. A linear damage
   * accumulator CANNOT replace the geometry here: it would need one
   * threshold that both a single 13 cm blast (severs in 1) and eight 5.5 cm
   * pellets cross, and 0.13 < 8×0.055 makes that impossible. The union test
   * stays; what changes is that it reads ITS OWN calibre, not the crater's.
   */
  severRadius?: number;
  /**
   * The INWARD unit normal at the stamp, in the same prim-local frame as
   * `local` (so it is transported by the same `frame()` and rides yaw/jiggle
   * exactly like the anchor). Together with `carveDepth` it orients the GPU
   * carve's depth slab: a plane through the anchor, facing inward, that
   * clips the carve sphere so it penetrates at most ~45% of the flesh
   * measured behind the hit — depth WITHOUT the far-side punch-through.
   * The sphere itself stays centred ON the anchor (the lab's deep-bowl
   * look); only its reach is clipped. Absent when no field was passed at
   * stamp time: consumers then carve the plain, uncapped sphere (old
   * wounds, chunk torn-ends, explosions on chunks).
   */
  carveN?: Vec3;
  /**
   * Max carve depth below the anchor plane, metres —
   * WOUND_CARVE_DEPTH_FRAC × (flesh measured behind the hit).
   */
  carveDepth?: number;
  /**
   * This wound opened a body CAVITY — set on the CPU at stamp time, where
   * cluster membership is known and free. Drives the viscera ramp stop and
   * gates whether a gut rope can spawn. Absent means false; limbs are never
   * cavities (a thigh is genuinely a wall of meat).
   */
  cavity?: boolean;
  /** What stamped this wound, for the spill ROLL only (entrails). Set to
   *  'slug' by woundFromSlug; absent means blast (explosions never mark it).
   *  Needed because the slug stamps type 'blast' — it uses the blast crater
   *  profile — so `type` cannot distinguish the two, which is exactly how
   *  the shipped slug roll (SPILL_CHANCE.slug 0.35) spent a day as dead code:
   *  every torso slug took the blast pin at 1.0. Same stamp-time pattern as
   *  `cavity`, so every present and future spill call site is right by
   *  construction. */
  spillCalibre?: 'slug';
}

/**
 * Local basis for a primitive AT A GIVEN BODY YAW.
 *
 * The yaw threading is what glues wounds to a TURNING body (motion-polish
 * fix): the basis is built in the DE-YAWED body frame and rotated back out,
 * so a wound stamped at yaw θ0 and mapped at yaw θ rides the rotation — its
 * offset comes out rotated by exactly (θ − θ0), for every primitive shape:
 *
 *  - SPHERES (a === b — every torso blob, the shoulder ball) have no axis at
 *    all; without the yaw their "local" frame was fixed WORLD axes and a
 *    crater stayed viewer-fixed while the body rotated under it (owner
 *    playtest). De-yawed, they get one canonical basis that the re-yaw then
 *    turns with the body.
 *  - VERTICAL capsules (the thigh, axis exactly ±y) hit basisFromAxis's
 *    degenerate fallback — also a fixed frame. De-yawing makes the fallback
 *    deterministic at BOTH ends (stamp and upload see the same de-yawed
 *    axis), so the delta-yaw rotation is exact there too.
 *  - Every other capsule already tracked axis swings; the de-yaw/re-yaw is
 *    an exact no-op at yaw 0 and a rigid delta-rotation under a pure turn.
 *
 * Oriented prims (the rigid head's face spheres, rig-bind.ts) carry their
 * FULL rotation — body yaw included — in prim.orient, so the wound frame is
 * that quaternion's basis outright: a crater on the nose rides the head's
 * own turn inside the clamp cone, not just the body's.
 */
/**
 * The de-yawed unit axis `frame` keys on; a sphere (a === b) gets +y so its
 * frame is the one canonical basis every map agrees on.
 */
function bodyAxis(prim: Primitive, bodyYaw: number): Vec3 {
  const axis = rotateYaw(sub(prim.b, prim.a), -bodyYaw);
  return len(axis) === 0 ? [0, 1, 0] : normalize(axis);
}

/**
 * WHY THE STAMP AXIS IS TRANSPORTED RATHER THAN THE BASIS REBUILT (the wound
 * flicker, 2026-08-22): `basisFromAxis` chooses its reference axis by
 * comparing |x|, |y|, |z| of the axis — a discontinuous choice. A thigh is
 * exactly vertical at rest and a forearm six degrees off, and under the walk
 * both sway a few degrees in x AND z, so |x| and |z| trade places every step.
 * Each trade snapped the (u, v) basis 90 degrees around the limb and the
 * crater with it: a live probe measured 14 snaps and 18.6 cm single-frame
 * jumps in 2.6 s on a thigh-bound wound, and over half of all surface hits on
 * the zombie bind to a forearm or thigh (nearest-endpoint binding puts the
 * lower torso on the limbs). Given the stamp-time axis, the frame is instead
 * the stamp basis carried by the shortest-arc rotation from that axis to the
 * live one — continuous in the axis, exact under a rigid swing, and the
 * identity at rest, so nothing authored before this changed.
 */
function frame(prim: Primitive, bodyYaw: number, axis0?: Vec3) {
  if (prim.orient) {
    const q = prim.orient;
    return {
      u: qRotate(q, [1, 0, 0] as Vec3),
      v: qRotate(q, [0, 1, 0] as Vec3),
      w: qRotate(q, [0, 0, 1] as Vec3),
    };
  }
  const axis = bodyAxis(prim, bodyYaw);
  let b = basisFromAxis(axis0 ?? axis);
  if (axis0) {
    const q = qFromTo(axis0, axis);
    b = { u: qRotate(q, b.u), v: qRotate(q, b.v), w: qRotate(q, b.w) };
  }
  if (bodyYaw === 0) return b;
  return { u: rotateYaw(b.u, bodyYaw), v: rotateYaw(b.v, bodyYaw), w: rotateYaw(b.w, bodyYaw) };
}

/**
 * How tall the shader's everted lip is for a wound of `radius`, in metres, at
 * the stock woundCfg splay of 0.55 — the height the flesh behind a hit is
 * compared against. Mirrors `amp = depth * woundCfg.z * wMeta.z` in
 * march.wgsl.ts's applyWounds (the live splay uniform may be tuned, which is
 * fine: this only needs the same order of magnitude).
 */
const STOCK_RIM_SPLAY = 0.55;

/**
 * The carve may eat at most this fraction of the measured flesh thickness
 * behind a hit; anything deeper is shifted outward. 45% leaves over half the
 * limb intact so the far side never opens (punch-through stays the job of
 * the sever/connectivity system).
 */
export const WOUND_CARVE_DEPTH_FRAC = 0.45;

const PROBE_STEP = 0.004, PROBE_MAX = 0.6;
/** How far past an outside-skin hit the seek may march to find the surface.
 *  Projectile traces bisect a hitEps shell (1 cm out); 4 cm is generous. */
const PROBE_SEEK_MAX = 0.04;

/**
 * Probes the flesh behind a surface hit: marches from the hit toward the
 * nearest point on the primitive's axis until the field turns positive and
 * returns how far that went (the thickness behind the hit) together with the
 * unit INWARD direction used (null when the hit sits on the axis itself —
 * nothing sensible to measure along).
 *
 * If the hit itself sits OUTSIDE the skin (every first sample outside), the
 * march seeks inward to the surface first and measures from there — a point
 * returned on a trace's hitEps shell otherwise measures zero flesh and the
 * thickness cap degenerated to a tangent, invisible carve sphere
 * (2026-08-27). The seek changes nothing for hits that already measure
 * flesh: their loop is byte-identical to the original.
 */
function probeFlesh(
  field: (p: Vec3) => number, hit: Vec3, prim: Primitive,
): { thick: number; inward: Vec3 | null } {
  const ab = sub(prim.b, prim.a);
  const L2 = dot(ab, ab);
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(hit, prim.a), ab) / L2));
  const axisPt = add(prim.a, scale(ab, t));
  const inward = sub(axisPt, hit);
  const n = len(inward);
  if (n < 1e-6) return { thick: 0, inward: null };
  const dir = scale(inward, 1 / n);
  const measure = (from: number): number => {
    let thick = 0;
    for (let d = from; d <= PROBE_MAX; d += PROBE_STEP) {
      const p = add(hit, scale(dir, d));
      if (field(p) > 0) break;
      thick = d;
    }
    return thick;
  };
  let thick = measure(PROBE_STEP);
  if (thick > 0) return { thick, inward: dir };
  // DEGENERATE: every sample so far was outside the flesh. Seek the surface.
  let seek = 0;
  let entered = false;
  for (let d = PROBE_STEP; d <= PROBE_SEEK_MAX; d += PROBE_STEP) {
    seek = d;
    if (field(add(hit, scale(dir, d))) <= 0) { entered = true; break; }
  }
  if (!entered) return { thick: 0, inward: dir };
  thick = measure(seek + PROBE_STEP) - seek;
  return { thick, inward: dir };
}

/**
 * THE LIP IS PEELED MATERIAL, NOT CONJURED (cyclops, 2026-08-23). The rim
 * in applyWounds is a Gaussian shell gated by distance to the ORIGINAL skin,
 * so on a feature thinner than the lip — a claw, a finger — it adds flesh in
 * empty space: a CPU cross-section of a blast on the cyclops's hand put 36%
 * of the rim's cells outside the original flesh, which drew as a glossy ball
 * from one angle and a dark ring from another as the marcher caught or
 * missed the floating shell. Probe the flesh behind the hit (march from the
 * hit toward the owning primitive's axis until the field goes positive) and
 * scale the lip to it: 1 when there is at least twice the lip's height of
 * flesh, down to 0 for nothing.
 */
export function rimScaleFor(
  field: (p: Vec3) => number, hit: Vec3, prim: Primitive, radius: number, type: WoundType,
): number {
  // Inward direction: toward the nearest point on the primitive's axis.
  const { thick, inward } = probeFlesh(field, hit, prim);
  if (!inward) return 1;
  const lip = radius * STOCK_RIM_SPLAY * WOUND_PROFILES[type].rimSplayScale;
  return Math.max(0, Math.min(1, thick / (2 * lip)));
}

/**
 * Converts a world-space hit into a wound bound to the nearest primitive, stored
 * in that primitive's LOCAL frame. This is what makes a crater stay on the
 * shoulder while the shoulder swings and stretches.
 *
 * `field` (the body's signed distance, e.g. `p => sdBody(p, body)`) lets the
 * wound scale its everted rim to the flesh actually behind the hit — see
 * `rimScaleFor`. Omit it and the rim is the full lip.
 */
export function worldHitToWound(
  prims: Primitive[],
  hit: Vec3,
  radius: number,
  type: WoundType,
  /** The body's applied yaw at stamp time (motion.ts state.bodyYaw, 0 in the
   *  statue loop) — the frame the hit is expressed in. Must match the yaw
   *  woundWorldPos is later called with or the wound drifts by the delta. */
  bodyYaw = 0,
  field?: (p: Vec3) => number,
): Wound {
  // The primitive whose SURFACE the hit is on — the arg-min of the per-prim
  // field, the same rule the shader's hitBest paints by. It used to be the
  // nearest ENDPOINT, which put over half of the zombie's surface hits (the
  // whole lower torso, both flanks) on a forearm or thigh whose endpoint
  // happened to be close: the crater then swung with the arm (6 cm per
  // frame in a live probe) instead of staying on the belly it was shot into.
  let primIdx = -1;
  let best = Infinity;
  prims.forEach((p, i) => {
    // A carve is a hole. A crater riding the inside of an eye socket is
    // meaningless, and it would be carried by a primitive with no surface.
    if (p.op === 'sub' || p.op === 'groove' || p.dead) return;
    const d = sdPrimitive(hit, p);
    if (d < best) { best = d; primIdx = i; }
  });
  if (primIdx < 0) primIdx = 0; // a body with no solid primitives cannot be hit

  const prim = prims[primIdx]!;
  const axis0 = prim.orient ? undefined : bodyAxis(prim, bodyYaw);
  const { u, v, w } = frame(prim, bodyYaw, axis0);
  const rel = sub(hit, prim.a);
  const wound: Wound = { primIdx, local: [dot(rel, u), dot(rel, v), dot(rel, w)], radius, type, ageSec: 0 };
  if (axis0) wound.axis0 = axis0;
  if (field) {
    wound.rimScale = rimScaleFor(field, hit, prim, radius, type);
    // DEPTH-SLAB CAP (2026-08-27): the GPU carve sphere stays centred ON the
    // surface anchor — the lab's deep-bowl look, whose cavity reads RED —
    // and is clipped by a slab through the anchor along the measured inward
    // normal, at most WOUND_CARVE_DEPTH_FRAC of the flesh behind the hit.
    // The previous cap SHIFTED the sphere centre outward instead, which
    // guarantees the visible dish only ever grazes the sphere's outer shell:
    // with a probe measured from a hitEps-shell hit (1 cm outside the skin)
    // the shift ate the whole radius and the carve was tangent — invisible,
    // which is the owner's pale-wound report. Depth, not position, is the
    // thing that must be capped; see march.wgsl.ts APPLY_WOUNDS for the
    // GPU side (max of the sphere and the slab SDFs, exact for the convex
    // intersection).
    const { thick, inward } = probeFlesh(field, hit, prim);
    if (inward) {
      wound.carveDepth = WOUND_CARVE_DEPTH_FRAC * thick;
      wound.carveN = [dot(inward, u), dot(inward, v), dot(inward, w)];
    }
  }
  return wound;
}

/**
 * Transforms a wound back into world space using its primitive's current
 * pose. Pass the body's CURRENT applied yaw — the same value the motion
 * pipeline rotated the rest pose by this frame — so the wound's stored
 * offset rotates out of the stamp frame and into the live one.
 */
export function woundWorldPos(prims: Primitive[], wound: Wound, bodyYaw = 0): Vec3 {
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw, wound.axis0);
  return add(prim.a, add(add(scale(u, wound.local[0]), scale(v, wound.local[1])), scale(w, wound.local[2])));
}

/**
 * The GPU carve's INWARD slab normal in world space — the orientation of the
 * depth cap stored at stamp time (`carveN`), rotated out of the prim-local
 * frame by the same transform `woundWorldPos` uses. Null when the wound
 * carries no slab (no field at stamp time): the renderer then carves the
 * plain, uncapped sphere — the lab's historical behaviour, unchanged.
 */
export function woundCarveNormal(prims: Primitive[], wound: Wound, bodyYaw = 0): Vec3 | null {
  if (!wound.carveN) return null;
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw, wound.axis0);
  const c = wound.carveN;
  return add(add(scale(u, c[0]), scale(v, c[1])), scale(w, c[2]));
}

/** Ring buffer append — oldest is evicted at capacity. */
export function pushWound(ring: Wound[], wound: Wound, cap: number): Wound[] {
  const next = [...ring, wound];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
