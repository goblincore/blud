// src/lab/sdf-zombie/damage.ts
//
// The wound record and everything that stamps, locates and converts wounds on a body, including cloth wound handling.

import type { Primitive, Vec3 } from './types';
import { add, basisFromAxis, dot, len, normalize, qFromTo, qRotate, scale, sub } from './vec';
import { rotateYaw } from './gait';
import { sdBody, sdBodyClosed, sdPrimitive, type Body } from './validate';
import { unwarpDir, unwarpPoint } from './head-split';

/** Wounds per body (the ring cap). Every WGSL wound loop bound and the per-ray
 *  wound list size are built from this constant. The frozen GLSL twin
 *  (march.glsl.ts) keeps its own cap, GLSL_MAX_WOUNDS, and shows the newest wounds. */
export const MAX_WOUNDS = 32;

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

/** Gameplay provenance is independent of visual crater calibre. */
export type ShotProvenance =
  | { weapon: 'shotgun'; shotId: number; barrels: 1 | 2; barrel: 0 | 1 }
  | { weapon: 'slug'; shotId?: number }
  | { weapon: 'explosion' };

export interface Wound {
  /** Stable render-event identity. Wound aging replaces objects each frame. */
  eventId?: number;
  /** Head damage model (head-damage.ts): the head keeps at most MAX_HEAD_WOUNDS craters of its own; 'keep' craters (the eye socket, the scalp, the brain) outlive 'face' ones and survive the total cap. */
  headSlot?: 'keep' | 'face';
  /** Head damage v2 (head-damage.ts, spec §15): the head region this crater belongs to. A region keeps one
   *  crater: a new one with the same headRegion replaces its predecessor in place. */
  headRegion?: string;
  shot?: ShotProvenance;
  /** Exposed stump decoration, not another projectile injury. */
  injuryIgnored?: boolean;
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
  /** Render-only: a single crater with a noise-ragged edge (0..0.45, the fraction of
   *  radius its edge can grow by). Absent = a round crater. See soldier-wounds.ts. */
  ragged?: number;
  /** Render-only: TORN, SPLAYED LIPS (flail v1.5b, torn-lips.ts), 0..1 intensity. The wound
   *  uploads with ROW_WOUND_FLAGS.x bit 3: a two-octave ragged edge, petal-shaped taller rim
   *  pushed outward, a wet red lip over a glossy red interior and a clotted floor. Absent or 0
   *  = the stock look, pixel for pixel. Set with `tearWound`. */
  tear?: number;
  /** Render-only: WET RED LIP (gun wounds, torn-lips.ts GUN_WET_LIP), 0..1. The wound uploads with
   *  ROW_WOUND_FLAGS.x bit 4: the torn look's wet red lip / glossy walls / clotted floor SHADING on
   *  the stock crater SHAPE. Absent or 0 = the stock look. Set with `wetLipWound`. */
  wetLip?: number;
  /** CUT (cut-wound.ts, 2026-10-03): a blade slot instead of a crater. `local` is the slot's MIDPOINT, `radius` its HALF-
   *  LENGTH (the shader's reach and the threat box are supersets; plain `radius` consumers are not, see cut-wound.ts), `carveN`/`carveDepth` its inward direction and depth, `cutDir` its
   *  along-segment unit (prim-local, same frame as `local`), `kerf` its half-width at the skin. Absent = a crater. */
  shape?: 'cut';
  cutDir?: Vec3;
  kerf?: number;
  /** CUT: the chord midpoint's depth below the anchor (`local`) along the inward direction (>= 0): the skin's fall-off over the cut; 0 for a straight cut.
   *  The slot's floor is measured from the anchor plane shifted inward by this, so it can never open the far skin. */
  sag?: number;
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
  /**
   * CLOTH (cultist, 2026-09-23): set by `clothifyWound` when the struck prim
   * is cloth (a shell, or a painted non-metal prim). 'tear' = a heavy round
   * (shotgun pellet, slug) ripped a ragged hole and the wound shows through
   * it; 'hole' = a small-calibre round (pistol/SMG) left only a small ragged
   * bullet hole. Effects read it (cloth puff, no blood gout on a 'hole').
   */
  cloth?: 'tear' | 'hole';
  /**
   * CLOTH DECAL (soft targets, 2026-09-24): set by `clothDecal`. The wound
   * does NOT carve: a round passes through a robe, it does not blow a window
   * in it. The shader skips it in every carve and paints it on the cloth
   * instead (ROW_WOUND_FLAGS.x bit 2): a blood stain round a torn core, or,
   * with cloth 'hole', a scorched bullet hole.
   */
  decal?: boolean;
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
  // A rig-added pose orient (Primitive.poseOrient) is not the prim's own
  // frame — its rest copy has none — so wounds keep the axis frame there.
  if (prim.orient && !prim.poseOrient) {
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
/** A/B SEAM for the cap below — `?woundcap=0` restores the uncapped march so
 *  the two can be measured INTERLEAVED in one boot. Single runs of this
 *  machine disagree by more than the effect (a blast's resolve moved 39 -> 55 ms
 *  between two runs of the SAME build), which is exactly the trap TASKS.md
 *  records for the bench: judge a delta against its own legs' spread. */
let probeCapEnabled = true;
export function setProbeCapEnabled(on: boolean): void { probeCapEnabled = on; }

/** The CARVE-depth probe's own cap (see worldHitToWound) — a second, separate
 *  seam, because the two probes have different consumers and a single knob
 *  cannot price them apart. `false` restores the uncapped march. */
let carveProbeCapEnabled = true;
export function setCarveProbeCapEnabled(on: boolean): void { carveProbeCapEnabled = on; }

function probeFlesh(
  field: (p: Vec3) => number, hit: Vec3, prim: Primitive,
  /**
   * STOP ONCE THE MEASUREMENT REACHES THIS. The ONLY consumer of `thick` is
   * `rimScaleFor`, which computes `min(1, thick / (2 * lip))` — so every
   * thickness at or beyond `2 * lip` produces the same answer, and marching to
   * PROBE_MAX 0.6 m to find that out is work with no reader.
   *
   * MEASURED, and this was the blast pause: the march is
   * PROBE_MAX / PROBE_STEP = 150 `sdBody` folds PER WOUND, and a 5-body blast
   * stamps 16 wounds on each — 50 ms of a 56 ms resolve, while the traces that
   * find the surfaces cost 5 ms. With the cap the march stops at
   * `2 * lip / PROBE_STEP` samples: ~36 for a 0.13 m blast wound, ~9 for a
   * 0.03 m pellet one.
   *
   * EXACT, not an approximation: below the cap nothing changes, and at or above
   * it both the capped and uncapped forms clamp to 1. `damage.test.ts` pins that
   * against an uncapped reference probe.
   */
  stopAtThick: number = PROBE_MAX,
): { thick: number; inward: Vec3 | null } {
  const ab = sub(prim.b, prim.a);
  const L2 = dot(ab, ab);
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(hit, prim.a), ab) / L2));
  const axisPt = add(prim.a, scale(ab, t));
  const inward = sub(axisPt, hit);
  const n = len(inward);
  if (n < 1e-6) return { thick: 0, inward: null };
  const dir = scale(inward, 1 / n);
  const cap = probeCapEnabled ? stopAtThick : PROBE_MAX;
  const measure = (from: number, stopAt: number = cap): number => {
    let thick = 0;
    for (let d = from; d <= PROBE_MAX; d += PROBE_STEP) {
      const p = add(hit, scale(dir, d));
      if (field(p) > 0) break;
      thick = d;
      if (thick >= stopAt) break;   // nothing past here can change the rim
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
  // The seek subtracted below means the cap has to be raised by `seek`, or a
  // thickened measurement would come back under the threshold and shrink a rim
  // the uncapped probe called full.
  thick = measure(seek + PROBE_STEP, stopAtThick + seek) - seek;
  return { thick, inward: dir };
}

/** The flesh behind `hit` along the owning prim's inward direction, measured up to `cap` metres (the march stops once it
 *  reaches `cap`, so `thick >= cap` means "at least that much"). `probeFlesh`'s result, unchanged: `inward` is null when
 *  `hit` sits on the prim's axis. Cut wounds size their depth from this, not from a crater's probe cap. */
export function fleshBehind(
  field: (p: Vec3) => number, hit: Vec3, prim: Primitive, cap: number,
): { thick: number; inward: Vec3 | null } {
  return probeFlesh(field, hit, prim, cap);
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
  const lip = radius * STOCK_RIM_SPLAY * WOUND_PROFILES[type].rimSplayScale;
  const full = 2 * lip;
  // Inward direction: toward the nearest point on the primitive's axis.
  // `full` is the cap: at or beyond it the rim is 1 whatever the probe would
  // have kept marching to find (see probeFlesh's stopAtThick).
  const { thick, inward } = probeFlesh(field, hit, prim, full);
  if (!inward) return 1;
  return Math.max(0, Math.min(1, thick / full));
}

/** A hit on a body, taken to where wounds live (unwarpHit). */
export interface UnwarpedHit {
  /** The hit in the UN-WARPED body: stamp here. The hit itself when nothing moved it. */
  hit: Vec3;
  /** The piece of the split it is on: 0 the unmoved rest (and every hit on a closed body), 1 the + half, 2 the - half. */
  piece: 0 | 1 | 2;
  /** The CLOSED body's field (sdBody with no split): probe the flesh behind the stamp with this one. */
  field: (p: Vec3) => number;
  /** A world direction (a view, a blade line) in that piece's un-warped frame. */
  dir: (v: Vec3) => Vec3;
}

/**
 * WOUNDS LIVE IN THE UN-WARPED HEAD (the head split, head-split.ts). A split
 * body's FIELD has the head's halves turned open (validate.ts sdBody), but its
 * prims are the closed head's, and the GPU reads every wound at the un-warped
 * point of the piece it is shading. A stamp made at the world hit would sit
 * out where the half now is, off the closed prims, and never be read. So every
 * stamp takes its hit back first: stamp `hit` with `field`, and turn any
 * direction that goes into the wound through `dir`. World-space effects of
 * the same hit (the shove, the blood, the reaction) keep the world point.
 *
 * On a body with no split this is the identity: `hit` is the same point, `dir`
 * returns its argument, and `field` is sdBody on the body as given.
 */
export function unwarpHit(body: Body, hit: Vec3): UnwarpedHit {
  const split = body.split;
  if (!split) return { hit, piece: 0, field: p => sdBody(p, body), dir: v => v };
  const field = (p: Vec3) => sdBodyClosed(p, body);
  const { q, piece } = unwarpPoint(split, hit, field);
  return { hit: q, piece, field, dir: v => unwarpDir(split, piece, v) };
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
  const axis0 = prim.orient && !prim.poseOrient ? undefined : bodyAxis(prim, bodyYaw);
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
    // THE SECOND PROBE IS CAPPED TOO, AND EXACTLY. This one has a CONTINUOUS
    // consumer (carveDepth = FRAC x thick), not a thresholded one like the rim,
    // so it is not "the same answer past a point" in general — but it is past
    // ONE point, and that point is computable: march.wgsl.ts's APPLY_WOUNDS
    // intersects the carve SPHERE (radius = w.w = this wound's radius) with a
    // slab through the anchor at capEff, and a slab that reaches the sphere's
    // centre cannot bind anywhere. capEff >= radius  <=>  thick >= radius/FRAC,
    // so every measurement at or past that is a full sphere and the extra
    // marching buys nothing at all.
    //
    // MEASURED, and this was the second half of the blast pause: the uncapped
    // march is PROBE_MAX/PROBE_STEP = 150 `sdBody` folds PER WOUND, against 36
    // for the capped rim probe beside it, and a 5-body blast stamps 16 wounds
    // on each. The cap lands at 73 samples for a 0.13 m blast wound and 17 for
    // a 0.03 m pellet one.
    const { thick, inward } = probeFlesh(field, hit, prim,
      carveProbeCapEnabled ? radius / WOUND_CARVE_DEPTH_FRAC : PROBE_MAX);
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

/** How far a crater's everted lip reaches from its centre, in its own radii: the shader centres the lip's ring at
 *  woundCfg.w x rimOffsetScale radii (1.15 x at most 1.12 for a torn wound) and gives it a width of woundCfg2.x radii
 *  (0.42) each way (march/fields/wounds.wgsl.ts). */
export const LIP_REACH = 1.6;

/** What lipsAfterSever leaves of a lip that would hang, as a share of the lip it had. */
export const STUMP_LIP = 0;
/** Live value (`__sdfGame.head.stumpLips(v)`): STUMP_LIP ships; 1 leaves every lip as it was (the look before
 *  2026-10-07, when a lip could hang over a stump). */
let stumpLip: number = STUMP_LIP;
export function setStumpLip(share: number): void { stumpLip = Math.min(1, Math.max(0, share)); }
export function stumpLipShare(): number { return stumpLip; }

/**
 * THE LIPS THAT WENT WITH THE LIMB. A crater's lip is flesh the shader ADDS in a ring round the crater, wherever the
 * ring passes within a few centimetres of the body's skin as it was BEFORE any wound (applyWounds' rimLocal reads the
 * un-wounded field). Carves do not hold it back: where another wound's carve has since taken that skin away, the lip
 * stays, standing in the hole. A sever makes exactly that hole: the stump wound is a deep bowl stamped where a
 * limb's root was, usually beside the craters that cut the limb off, and their lips (and the stump's own, when it
 * opens inside a bigger crater) were left hanging over the stump as a cup or an arc of flesh attached to nothing
 * (the owner, 2026-10-07: "a floating piece of the neck" over a headless zombie).
 *
 * So after a sever, with `stump` the wound it stamped (null: none), a crater loses its lip (`rimScale` times the
 * stump lip share, 0 as shipped; its carve and its paint stay) when:
 *   - the flesh it rides is gone: its prim is dead, or its prim's cluster is no longer alive;
 *   - its lip's ring reaches into the stump's carve: centres closer than the stump's radius plus LIP_REACH of its own;
 * and the stump loses its own lip when its ring reaches into such a crater's carve (centres closer than that crater's
 * radius plus LIP_REACH stump radii). Decals carve nothing and are left alone; a cut has no ring.
 * Returns `wounds` itself when nothing changes; a changed wound is a new object.
 */
export function lipsAfterSever(
  wounds: readonly Wound[], prims: Primitive[], clusters: readonly { start: number; count: number; alive: boolean }[],
  stump: Wound | null, bodyYaw = 0,
): readonly Wound[] {
  if (stumpLip >= 1) return wounds;
  const gone = (w: Wound): boolean => {
    const p = prims[w.primIdx];
    if (!p || p.dead) return true;
    const c = clusters.find(q => w.primIdx >= q.start && w.primIdx < q.start + q.count);
    return !!c && !c.alive;
  };
  const ring = (w: Wound): boolean => !w.decal && w.shape !== 'cut' && (w.rimScale ?? 1) > 0;
  const at = stump && prims[stump.primIdx] ? woundWorldPos(prims, stump, bodyYaw) : null;
  let stumpHangs = false;
  let changed = false;
  const out = wounds.map((w) => {
    if (w === stump || !ring(w)) return w;
    let drop = gone(w);
    if (at && stump && prims[w.primIdx]) {
      const c = woundWorldPos(prims, w, bodyYaw);
      const d = len(sub(c, at));
      if (d < stump.radius + w.radius * LIP_REACH) drop = true;
      if (d < w.radius + stump.radius * LIP_REACH) stumpHangs = true;
    }
    if (!drop) return w;
    changed = true;
    return { ...w, rimScale: (w.rimScale ?? 1) * stumpLip };
  });
  if (stump && stumpHangs && ring(stump)) {
    const i = out.indexOf(stump);
    if (i >= 0) { out[i] = { ...stump, rimScale: (stump.rimScale ?? 1) * stumpLip }; changed = true; }
  }
  return changed ? out : wounds;
}

/** A prim-local direction of `wound` (same frame as `local` / `carveN`) in world space. */
export function woundDirToWorld(prims: Primitive[], wound: Wound, local: Vec3, bodyYaw = 0): Vec3 {
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw, wound.axis0);
  return add(add(scale(u, local[0]), scale(v, local[1])), scale(w, local[2]));
}

/** A world direction in `wound`'s prim-local frame (the inverse of woundDirToWorld). */
export function worldDirToWoundLocal(prims: Primitive[], wound: Wound, dir: Vec3, bodyYaw = 0): Vec3 {
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw, wound.axis0);
  return [dot(dir, u), dot(dir, v), dot(dir, w)];
}

/**
 * Is this prim CLOTH to a bullet? A shell (the sheet garments) or any painted
 * prim that is not metal and does not glow — the cultist's robe-coloured
 * torso and sleeves are flesh prims painted as cloth, and a player cannot
 * tell them from the shells. Metal plates and glowing eyes are not cloth.
 * The shader applies the same rule when it lets a wound show through paint
 * (paint-char.wgsl.ts): paint yields inside a wound unless it is metal.
 */
export function isClothPrim(p: Primitive): boolean {
  if (p.shell) return true;
  return p.color !== undefined && !p.metal && !((p.glow ?? 0) > 0);
}

/** How a round meets cloth. 'heavy' = shotgun pellet / slug; 'small' =
 *  pistol / SMG (none in the game yet — the cultist's own gun is next). */
export type ClothCalibre = 'heavy' | 'small';

/** Ragged edge for a hole in cloth: torn fabric, not a punched porthole.
 *  0.40 of the 0.45 the shader clamps to. */
export const CLOTH_RAGGED = 0.40;
/** A small-calibre round through cloth leaves a bullet hole this size, not a
 *  crater: a 2.8 cm carve sphere through the sheet, a dark hole with a
 *  scorched ring (paint-char.wgsl.ts fray band) round it. 0.008 was tried
 *  first and was a speck at 1.3 m — invisible at combat range. The carve's
 *  fillet scales with the radius (wounds.wgsl.ts kW), or a hole this small
 *  melted 5 cm of an 8 mm sheet. */
export const CLOTH_BULLET_HOLE_RADIUS = 0.014;

/** A heavy round's blood stain on a soft target's robe is capped at this
 *  radius. The mask reaches 1.6 x the radius, so the slug's 0.16 crater
 *  radius would soak half a metre of robe; 0.07 is a ~22 cm stain. */
export const CLOTH_STAIN_MAX_RADIUS = 0.07;

/**
 * SOFT-TARGET CLOTH TAKES MARKS, NOT CRATERS (owner playtest 2026-09-24): "it
 * would just pass through the cloth and hit the flesh ... the rips and tears
 * can be replaced with decals". A soft target dies to the first hit, so there
 * is nothing to reveal: the robe just shows where it was hit. Run AFTER
 * `clothifyWound` (which decided tear vs hole). Marks the wound as a decal,
 * caps a stain's size and drops the gore extras that need an opening (cavity,
 * spill). A no-op off cloth (a face shot still carves) and for burns.
 * The soldier keeps `clothifyWound`'s carved tears: he is a gore target.
 */
export function clothDecal(prims: Primitive[], wound: Wound): Wound {
  const p = prims[wound.primIdx];
  if (!p || !isClothPrim(p) || wound.type === 'burn') return wound;
  wound.decal = true;
  if (wound.cloth !== 'hole') wound.radius = Math.min(wound.radius, CLOTH_STAIN_MAX_RADIUS);
  delete wound.cavity;
  delete wound.spillCalibre;
  return wound;
}

/**
 * Cloth hit reactions (owner, 2026-09-23: "a pistol or SMG will just make a
 * small hole or bullet decal on the clothes, but a large shotgun slug would
 * actually reveal wounds ... it's all about differing visceral effects").
 *
 * RENDERING NEEDS NOTHING NEW. A wound already carves the blended body —
 * cloth and flesh together — and since paint yields to the wound inside its
 * mask, a crater through a sheet shows the flesh wound behind it with a
 * scorched fray round the hole. So the whole decision is this stamp-time
 * rewrite of the wound:
 *   heavy -> ragged edge, marked 'tear' (gore unchanged: it reveals);
 *   small -> shrunk to a bullet hole, ragged, marked 'hole', and stripped of
 *            the gore extras (cavity, spill) — it is a hole in a robe.
 * Returns the wound unchanged when the struck prim is not cloth.
 */
export function clothifyWound(prims: Primitive[], wound: Wound, calibre: ClothCalibre): Wound {
  const p = prims[wound.primIdx];
  if (!p || !isClothPrim(p) || wound.type === 'burn') return wound;
  wound.ragged = CLOTH_RAGGED;
  if (calibre === 'heavy') { wound.cloth = 'tear'; return wound; }
  wound.cloth = 'hole';
  wound.radius = Math.min(wound.radius, CLOTH_BULLET_HOLE_RADIUS);
  // No everted lip: a punched hole in cloth has no rim of meat to catch the
  // light (with one, a small hole read as a pale ring).
  wound.rimScale = 0;
  if (wound.carveDepth !== undefined) wound.carveDepth = Math.min(wound.carveDepth, wound.radius);
  delete wound.cavity;
  delete wound.spillCalibre;
  return wound;
}

/** Marks `wound` torn (Wound.tear, clamped to 0..1): the flail's wounds (game-flail.ts,
 *  game-head-damage.ts). A cloth DECAL carves nothing, so it has no lip to tear and is left
 *  alone. Returns the wound. */
export function tearWound(wound: Wound, tear: number): Wound {
  if (wound.decal || !(tear > 0)) return wound;
  wound.tear = Math.min(1, tear);
  return wound;
}

/** Marks `wound` with a wet red lip (Wound.wetLip, clamped to 0..1): the gun's craters
 *  (game-actor.ts hit / hitSlug). Cloth wounds (decal, hole, tear) and burns never take it — a
 *  robe has no meat lip. Returns the wound. */
export function wetLipWound(wound: Wound, wetLip: number): Wound {
  if (wound.decal || wound.cloth || wound.type === 'burn' || !(wetLip > 0)) return wound;
  wound.wetLip = Math.min(1, wetLip);
  return wound;
}

/** Head craters (Wound.headSlot) a body keeps at most — melee head damage, head-damage.ts: six regions,
 *  the brain cavity and the slug burst's exit crater. */
export const MAX_HEAD_WOUNDS = 8;

/** MERGE ON OVERFLOW (2026-10-03, owner: tough enemies' faces "reappear" when old wounds are evicted). */
export const MERGE = {
  /** Two craters on one prim merge when their centres are within this × (r1 + r2). */
  reach: 1.5,
  /** A merged crater never grows past this radius (m): a whole limb must not become one bowl. */
  maxRadius: 0.16,
} as const;

const localDist = (a: Wound, b: Wound): number =>
  Math.hypot(a.local[0] - b.local[0], a.local[1] - b.local[1], a.local[2] - b.local[2]);

/** Head damage craters (head-damage.ts) own their slot rules and never move, grow or change through a merge. */
const headTagged = (x: Wound): boolean => x.headSlot !== undefined || x.headRegion !== undefined;

/** The oldest wound at index `victim` folded into its nearest same-prim crater neighbour (the survivor becomes the minimal
 *  sphere enclosing both), or null when none is in reach, or the enclosing sphere would pass MERGE.maxRadius (the caller
 *  then evicts, as before: a merge never shrinks below what covers both). */
function mergeVictim(next: Wound[], victim: number): Wound[] | null {
  const v = next[victim]!;
  if (v.shape === 'cut' || v.decal || headTagged(v)) return null;
  let best = -1, bd = Infinity;
  next.forEach((o, i) => {
    if (i === victim || o.primIdx !== v.primIdx || o.shape === 'cut' || o.decal || headTagged(o) || o.type !== v.type || o.cloth !== v.cloth) return;
    const d = localDist(v, o);
    if (d <= MERGE.reach * (v.radius + o.radius) && d < bd) { bd = d; best = i; }
  });
  if (best < 0) return null;
  const o = next[best]!;
  const rv = v.radius, ro = o.radius;
  let local: Vec3, radius: number;
  if (bd + Math.min(rv, ro) <= Math.max(rv, ro)) {
    // One crater already contains the other: the larger sphere stands as it is.
    const big = rv > ro ? v : o;
    local = [big.local[0], big.local[1], big.local[2]];
    radius = big.radius;
  } else {
    radius = (bd + rv + ro) / 2;
    const t = (radius - ro) / bd; // bd > 0 here: bd = 0 takes the containment branch
    local = [o.local[0] + (v.local[0] - o.local[0]) * t, o.local[1] + (v.local[1] - o.local[1]) * t, o.local[2] + (v.local[2] - o.local[2]) * t];
  }
  if (radius > MERGE.maxRadius) return null;
  const merged: Wound = { ...o, local, radius };
  if (v.carveDepth !== undefined || o.carveDepth !== undefined) merged.carveDepth = Math.max(v.carveDepth ?? 0, o.carveDepth ?? 0);
  // A merge never raises the sever calibre: always explicit, so connectivity never falls back to the grown radius. A
  // deliberate 0 ("never sever": flail and slug-burst craters, cuts) wins over any larger calibre.
  merged.severRadius = v.severRadius === 0 || o.severRadius === 0 ? 0 : Math.max(v.severRadius ?? rv, o.severRadius ?? ro);
  if (v.tear !== undefined || o.tear !== undefined) merged.tear = Math.max(v.tear ?? 0, o.tear ?? 0);
  if (v.wetLip !== undefined || o.wetLip !== undefined) merged.wetLip = Math.max(v.wetLip ?? 0, o.wetLip ?? 0);
  const out = [...next];
  out[best] = merged;
  out.splice(victim, 1);
  return out;
}

/** Ring buffer append. A wound with a headRegion replaces an earlier wound of the same region, in that
 *  one's index. Head craters keep their own MAX_HEAD_WOUNDS slots (oldest 'face' crater evicted first),
 *  and the total cap takes the oldest wound that is not a 'keep' head crater: it is MERGED into its nearest
 *  same-prim crater when one is in reach (MERGE; head-tagged wounds, cuts and decals never merge), and only
 *  evicted when none is. When that oldest wound is a CUT, the oldest crater that can merge is folded instead,
 *  and the cut is evicted only when no crater can. A merged survivor is a NEW Wound object. */
export function pushWound(ring: Wound[], wound: Wound, cap: number): Wound[] {
  if (wound.headRegion !== undefined) {
    const prev = ring.findIndex(x => x.headRegion === wound.headRegion);
    if (prev >= 0) {
      const replaced = [...ring];
      replaced[prev] = wound;
      return replaced;
    }
  }
  const next = [...ring, wound];
  if (wound.headSlot) {
    const head = next.filter(x => x.headSlot);
    if (head.length > MAX_HEAD_WOUNDS) {
      const victim = head.find(x => x.headSlot === 'face') ?? head[0]!;
      next.splice(next.indexOf(victim), 1);
    }
  }
  let out = next;
  while (out.length > cap) {
    const i = out.findIndex(x => x.headSlot !== 'keep');
    const victim = i < 0 ? 0 : i;
    let merged = mergeVictim(out, victim);
    // A CUT never merges, so as the victim it would simply be evicted: a rod release stamps up to 3, and ~11 sweeps fill
    // the ring. Fold the oldest crater that CAN merge first (oldest first; mergeVictim keeps its own guards: same prim, in
    // reach, never a cut, decal or head-tagged crater), so old slashes outlive craters that still have room to merge. Only
    // when nothing can merge is the oldest evicted, as before.
    if (!merged && out[victim]!.shape === 'cut') {
      for (let j = 0; j < out.length && !merged; j++) if (j !== victim) merged = mergeVictim(out, j);
    }
    if (merged) out = merged;
    else out.splice(victim, 1);
  }
  return out;
}
