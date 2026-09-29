// src/lab/sdf-zombie/webgpu/game-head-damage.ts
//
// THE MELEE HEAD DAMAGE LEAF, v2 (spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md §15;
// plan Task 17). The flail hands head-region hits here (game-flail.ts strike → deps.headHit). The pure
// modules decide everything; this leaf only turns their output into objects:
//   * head-damage.ts  the region model (flesh per region → events);
//   * head-deform.ts  the wobble and the dents → the actor's setHeadDeform hook (applied at every re-pose);
//   * head-eye.ts     the orbit ray, the stalk rope, its prims → hand-posed pieces (boot.attachPiece);
//   * head-crown.ts   the brain lumps and skull chips → onGoreDispatch, and the whole brain's launch → the
//                     modelled brain MESH (game-brain-gib.ts, spec §14 decision 3).
// Wounds go through ZombieActor.blast (the kill is its forceCollapse). The per-actor state lives in this
// module (keyed by the actor object), never on main().
//
// EVENTS → WORLD.
//   strip          the region's ONE crater, stamped or replaced (Wound.headRegion) at the region's surface
//                  point — traced toward the head centre from its ANCHOR's hs direction (the model's
//                  state.anchor: where the first blow that struck the region landed), or from the region
//                  centre's while it has none (only spilled on; the orbits always) — radius
//                  REGION_TUNING.craterR(region, flesh), 'keep', no sever. One lasting dent per hit.
//   orbit-exposed  that eye's painted glow off (view.setEyeGlow) + the IN-ORBIT eyeball: one piece of
//                  eyeballPrims (no nerve, life-size ORBIT_EYE_R) inside the orbit's surface point along −forward,
//                  looking along the head forward.
//                  If this hit carries no strip event for that orbit (v1.5a: the OTHER eye, exposed by the first
//                  one's pop — the model set its flesh to the threshold), its crater is stamped here as a strip
//                  would; if the same hit pops that eye, no in-orbit piece is attached.
//   eye-pop        the in-orbit piece is disposed; the DANGLING piece is attached: stalkPrims(stalk, iris,
//                  headForward, eyeR — growing ORBIT_EYE_R → EYEBALL_R over POP_GROW_S) followed by the SOCKET PLUG (a matte near-black sphere, r 0.024) at the socket.
//                  v1.5a: BOTH eyes pop in the same hit (head-damage.ts), each with its own orbit, trackers, stalk and
//                  piece — 2 draws while both dangle.
//   eye-snap       the stalk's free half and the eyeball fly off as a gib; the dangling piece is disposed and a
//                  PLUG-ONLY piece is attached in its place. One per dangling eye: the next head hit (or death) snaps both.
//   skull-exposed  nothing extra: from the threshold on the region's crater carves past the measured skull depth;
//                  above it the carve stays in the flesh (HEAD_LEAF.carve, regionCarve).
//   brain          the brain mesh + lumps + chips from the CRACKED region's (anchored) surface point, the reduced blood,
//                  and a CROWN.brainR cavity there (headRegion 'brain').
//   kill           forceCollapse.
//
// DRAWS PER EYE (each attached piece is one pooled chunk view = one draw): painted 0, in-orbit 1, dangling 1
// (stalk + eyeball + plug in ONE piece), gone 1 (the plug alone). The alternative — a plug piece of its own
// from the pop on — costs 2 while the eye dangles, so the plug rides in the dangling piece and is re-attached
// alone at the snap (the piece's prim count must stay constant, which is why the snap re-attaches).
//
// THE PIECES RIDE THE HEAD through trackers: Wound records (never pushed on the ring) stamped on the orbit
// crater's prim at the orbit surface point, 1 cm behind it (−forward) and 2 cm in front of it; woundWorldPos re-reads
// them every frame, so the eye and the plug follow the posed, wobbling, dented, collapsing head, and the
// head's forward is read from the same prim.
//
// LIFETIME. Every attached piece is a pooled chunk view drawn every frame until disposed, so all of an
// actor's pieces are disposed on every way out: the head is gone (popped, severed), the actor is gone from
// ctx.world.actors (gibbed, retired, a cast rebuild — tick() notices on the next frame), forget() and
// reset() (rebuildCast calls it first). The same exits switch both painted eyes' glow back ON: actor views
// are pooled, and a recycled view must not come back blind.
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { AttachedPiece } from './game-state-boot';
import type { Primitive, Vec3 } from '../types';
import type { BuildResult } from '../build-body';
import { EYEBALL_R, eyeballPrims, prim, type GorePiece } from '../head-pop';
import { clothifyWound, woundWorldPos, worldHitToWound, type Wound } from '../damage';
import { sdBody, sdPrimitive } from '../validate';
import { headQuatOf } from '../rig-bind';
import {
  HEAD_REGIONS, REGION_TUNING, headDeath, headHit, isSkullRegion, makeHeadDamage,
  type EyeSide, type EyeState, type HeadDamageState, type HeadEvent, type HeadRegion, type SkullRegion,
} from '../head-damage';
import {
  addDent, deformHead, headAffine, headAffineMatrix, kickWobble, makeHeadDeform, rotate, stepWobble,
  type HeadDeformState, type HeadFrame, type Quat,
} from '../head-deform';
import { EYE_FLY, EYE_STALK, ORBIT_EYE_R, eyeFlyLaunch, eyeRayStart, makeStalk, popEyeR, stalkPrims, stepStalk, type StalkState } from '../head-eye';
import { CROWN, brainLaunch, brainLumps, brainPiece, skullChips } from '../head-crown';
import type { BrainGibLeaf } from './game-brain-gib';
import { FLAIL_HEAD, snapToSurface, traceRaySurface } from './flail-strike';
import { rngStreams } from './rng';
import { mulberry32 } from '../melt-bones';

/** The leaf's numbers (spec §5, §6, §15). */
export const HEAD_LEAF = {
  /** A hit's lasting dent depth (spec §5). */
  dentDepth: 0.018,
  /** The flesh strip per swing. v1.5b BIGGER BITES (owner: "too gradual"): doubled, so the face comes off in big
   *  chunks — an orbit is bone on hit 2, both eyes pop on hit 3 (v1.4, flail spec §13.2, was R/L 0.20, H 0.28;
   *  head spec §15 had R and L 0.25, H 0.35). */
  strip: { R: 0.4, L: 0.4, H: 0.55 } as Record<'R' | 'L' | 'H', number>,
  /** A head hit's share of the swing's collapse credit (flail spec §13.2): the head model kills, not the meter
   *  (R/L 0.065 × 0.3 ≈ 0.02 per head hit). */
  meterScale: 0.3,
  /** The eye's spring-out speed along the reflected blow (spec §6). */
  popSpeed: 2.5,
  /** The eyeballs' iris: the face sheet's glow colour (faceGlowColor, march/body/face.wgsl.ts). */
  iris: [1.9, 0.012, 0.005] as Vec3,
  /** The in-orbit eyeball's centre sits this far inside the orbit's surface point, straight back along the head's
   *  −forward (plan Task 17). With the life-size ball (head-eye ORBIT_EYE_R 0.018) 0.02, not 0.01: the traced point
   *  is up to 1 cm outside the skin (rayEps), so the ball's front sits a few mm proud of the old skin, in the bowl. */
  eyeInset: 0.02,
  /** THE SOCKET PLUG: matte, near black, filling the popped orbit's crater. Its centre is `inset` inside the
   *  orbit's surface point, straight back along the head's −forward (toward the head centre it sat ~2 cm toward
   *  the nose from the painted eye). Centred ON the surface point (the plan's local end 0) it bulged a 2.4 cm
   *  grey-rimmed dome out of the face; at inset 0.024 its top touched the traced point — which is up to 1 cm OUTSIDE
   *  the skin (traceRaySurface's rayEps) — and it still read as a black ball with a lit rim; 0.034 sinks it into the
   *  bowl. blendK 0.0005, not 0.004: in the dangling piece it smooth-unions with the stalk's root, and the 4 mm fillet
   *  shaded as a light grey halo round the stalk, right where the hole should read dark (v2-eye-pop). */
  plug: { r: 0.024, color: [0.03, 0.01, 0.01] as Vec3, inset: 0.034 },
  /** THE CARVE DEEPENS WITH THE WEAR, AND THE SKULL WAITS FOR THE THRESHOLD (spec §15). A region crater's carve
   *  depth below its anchor plane (regionCarve):
   *    - while the region's flesh is at or above its bone threshold (orbits REGION_TUNING.orbitExposed, the rest
   *      skullExposed): shallow + (preBone − shallow)·t, t = (1 − flesh)/(1 − threshold), kept `skullGap` short of
   *      the skull (never under minDepth);
   *    - below it: worldHitToWound's own depth (min(radius, 0.45 × the flesh behind the hit)), raised to
   *      `skullBite` past the skull if that fell short. It never needed raising in the smoke (brow 0.05 ≥ skull
   *      + 0.004; crown 0.055 vs skull 0.02-0.03).
   *  The skull depth is measured per crater over the carve's footprint (hit(): skullDepth, on the head's bone
   *  prims — the field the mesh skeleton is extracted from). MEASURED on the zombie, along each region's ray from
   *  the skin: skull 5 mm under the brow, 6 mm under the orbit, 20 mm under the crown — the forehead is thin.
   *  Uncapped, the first brow crater (r 0.032, carve up to 0.032) turned ~half its 3 cm circle bone-tan on hit 1.
   *  skullGap 6 mm is EMPIRICAL: with 1.5 mm the tan share on brow hit 2 (flesh 0.48) was still 60%, with 6 mm
   *  it is 2% / 38% / 66% on hits 1 / 2 / 3 (skull exposed at 3). Caveat: the fat band (fatColor) is tan too,
   *  and the pixel measure cannot tell the two apart. */
  carve: { shallow: 0.005, preBone: 0.012, skullGap: 0.006, minDepth: 0.002, skullBite: 0.004 },
} as const;

export interface HeadHitFeel {
  meterCredit: number; shove: number;
  /** The swing that landed (FLAIL_FEEL.swing's keys): picks the strip (HEAD_LEAF.strip). Absent: R. */
  side?: 'R' | 'L' | 'H';
  /** The blast reaction's gain (ActorBlastEffect.gain; flail-impact.ts reactionGain). Absent: 1. */
  gain?: number;
}

export interface HeadDamageDeps {
  /** game-main's headShape: the fattest additive head prim's midpoint and radius·scale axes — the frame
   *  the face sheet projects through. Takes a BODY (not the actor) so the deform hook can measure the
   *  un-deformed pose it is handed. */
  headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null;
  /** ctx.boot.onGoreDispatch. */
  gore(a: ZombieActor, pieces: GorePiece[]): void;
  /** The brain stage's blood (burstVolume + spawnImpactGout, game-main; half the head pop's burst radius so
   *  the brain is seen). */
  burst(a: ZombieActor, at: Vec3, dir: Vec3): void;
  /** The modelled brain mesh (game-brain-gib.ts). Absent, or not loaded yet: the SDF brainPiece is thrown. */
  brain?: BrainGibLeaf;
  /** Blood for a crater (registerBleed, at `kind`'s gout). */
  bleed(a: ZombieActor, w: Wound, point: Vec3, dir: Vec3, kind: 'pellet' | 'slug'): void;
  /** ctx.boot.attachPiece (absent before the chunk spawner exists: the pieces are then not drawn). */
  attach?: (a: ZombieActor, prims: Primitive[], pos: Vec3, opts?: { clean?: boolean }) => AttachedPiece;
}

export interface HeadDamageDebug {
  hits: number;
  flesh: Record<HeadRegion, number>;
  skull: Record<SkullRegion, number>;
  eyes: Record<EyeSide, EyeState>;
  dead: boolean;
  /** The anchored regions' hs (the model's state.anchor). */
  anchor: Partial<Record<SkullRegion, readonly [number, number, number]>>;
  squash: number;
  flat: number[];
  /** Each eye's eyeball centre (world): in its orbit, or at the end of its stalk; null painted / gone. */
  eyeball: Record<EyeSide, Vec3 | null>;
  /** That eyeball's drawn radius (ORBIT_EYE_R in the orbit; popEyeR(age) dangling); null painted / gone. */
  eyeR: Record<EyeSide, number | null>;
  /** Each orbit's socket point (world) once it is exposed; null while painted. */
  socket: Record<EyeSide, Vec3 | null>;
  /** Each dangling eye's stalk rope nodes (world, socket first); null when not dangling. */
  stalk: Record<EyeSide, Vec3[] | null>;
  /** Attached pieces this actor draws (one draw each). */
  draws: number;
  /** Each region's (and the brain cavity's) last stamped crater: its radius, its carve depth below the anchor
   *  plane (null: a full sphere — no flesh probe) and the measured anchor-to-skull depth (null: none found). */
  craters: Partial<Record<HeadRegion | 'brain', { radius: number; carveDepth: number | null; skull: number | null }>>;
  /** The head frame the deform hook last measured (the UN-deformed pose; null before the first re-pose). */
  frame: HeadFrame | null;
}

export interface HeadDamageLeaf {
  /** One head-region hit at `point` (world, on the posed surface), blow direction `dir` (world, unit). */
  hit(a: ZombieActor, point: Vec3, dir: Vec3, feel: HeadHitFeel): void;
  tick(dt: number): void;
  /** Drop an actor's state: dispose its pieces, clear its deform hook, its eyes glow again. */
  forget(id: number): void;
  /** Drop every actor's state (a cast rebuild / level reset). */
  reset(): void;
  debug(id: number): HeadDamageDebug | null;
  /** The head deform the actor's LAST re-pose applied to its flesh, as a world-space column-major 4x4 (null: none).
   *  The skeleton-mesh path premultiplies the skull segment's pose by it, so the skull squashes and dents with the
   *  flesh (spec §14 decision 1). Captured inside the deform hook — the same state, frame and instant the flesh
   *  used — so the mesh never runs a wobble step ahead of the skin it sits in. */
  affine(a: ZombieActor): readonly number[] | null;
}

/** An exposed orbit: its trackers and whichever piece shows it now. */
interface Orbit {
  /** The orbit's surface point, 1 cm straight back from it (the head's −forward), 2 cm in front of it (forward). */
  at: Wound; inner: Wound; front: Wound;
  inOrbit: AttachedPiece | null;
  stalk: StalkState | null;
  dangling: AttachedPiece | null;
  /** Seconds since the pop: the dangling eyeball grows ORBIT_EYE_R → EYEBALL_R (head-eye popEyeR). */
  popAge: number;
  /** The dangling piece's prims' radii as attached (the eyeball at EYEBALL_R): update() can only re-scale them. */
  danglingR0: number[];
  plug: AttachedPiece | null;
}
interface ActorHead {
  model: HeadDamageState; deform: HeadDeformState;
  orbits: Partial<Record<EyeSide, Orbit>>;
  /** The per-actor jitter stream (seed = actor id). */
  rand: () => number;
  craters: HeadDamageDebug['craters'];
  /** The frame the deform hook measured at the last re-pose (the un-deformed head). */
  frame: HeadFrame | null;
  /** That re-pose's deform as a world 4x4 (headAffineMatrix), null at rest. */
  affine: number[] | null;
}

const IDENTITY: Quat = [0, 0, 0, 1];
const SIDES: readonly EyeSide[] = ['L', 'R'];
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const orbitRegion = (side: EyeSide): HeadRegion => (side === 'L' ? 'orbitL' : 'orbitR');

/** The field's outward normal at `p` (central differences). */
function normalAt(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = 0.002;
  return unit([
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ]);
}

/** Outside the head on a region's hs line: the leaf traces from here toward the head centre. The orbits use
 *  eyeRayStart (in front of the face on the eye's line, as v1's socket did); the rest start 1.5 head radii
 *  out along their hs direction — `anchor`'s when the region has one (state.anchor), else the centre's. */
export function regionRayStart(frame: HeadFrame, r: HeadRegion, anchor?: readonly [number, number, number]): Vec3 {
  if (r === 'orbitL') return eyeRayStart(frame, 'L');
  if (r === 'orbitR') return eyeRayStart(frame, 'R');
  const hs = anchor && Math.hypot(anchor[0], anchor[1], anchor[2]) > 0.2 ? anchor : HEAD_REGIONS[r];
  const k = 1.5 / (Math.hypot(hs[0], hs[1], hs[2]) || 1);
  return add(frame.centre, rotate(frame.quat, [hs[0] * frame.axes[0] * k, hs[1] * frame.axes[1] * k, hs[2] * frame.axes[2] * k]));
}

/** A region crater's carve depth at `flesh` (HEAD_LEAF.carve): `full` is worldHitToWound's depth, `skull` the
 *  measured anchor-to-skull depth along the inward normal (Infinity: no skull under it). */
export function regionCarve(r: HeadRegion, flesh: number, full: number, skull = Infinity): number {
  const C = HEAD_LEAF.carve;
  const bone = r === 'orbitL' || r === 'orbitR' ? REGION_TUNING.orbitExposed : REGION_TUNING.skullExposed;
  if (flesh < bone) return Number.isFinite(skull) ? Math.max(full, skull + C.skullBite) : full;
  const t = Math.min(1, Math.max(0, (1 - flesh) / (1 - bone)));
  const ramp = C.shallow + (C.preBone - C.shallow) * t;
  return Math.min(full, Math.max(C.minDepth, Math.min(ramp, skull - C.skullGap)));
}

/** A per-actor seed from its id (plan Task 17: seed = actor id), mixed so ids 1, 2, 3 are unrelated streams. */
function actorRand(id: number): () => number {
  let h = (Math.imul(id | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return mulberry32(h);
}

const headAlive = (b: BuildResult): boolean => b.clusters.some(c => c.limb === 'head' && c.alive);

export function createHeadDamage(ctx: GameContext, deps: HeadDamageDeps): HeadDamageLeaf {
  const heads = new Map<ZombieActor, ActorHead>();
  let traceMissWarned = false;

  /** The head frame of a body posed at `yaw` by `a`'s rig: headShape + the rigid head's rotation. */
  function frameOf(a: ZombieActor, b: BuildResult): HeadFrame | null {
    const s = deps.headShape(b);
    if (!s) return null;
    return { centre: s.centre, axes: s.axes, quat: (headQuatOf(a.boundRig(), a.pose().yaw) as Quat | null) ?? IDENTITY };
  }

  /** Trace from `from` toward the head centre onto the posed surface; a miss falls back to the nearest
   *  point on the head (snapToSurface) and warns once. */
  function surfaceToward(field: (p: Vec3) => number, from: Vec3, frame: HeadFrame, along?: Vec3): Vec3 {
    const d = along ?? sub(frame.centre, from);
    const l = Math.hypot(d[0], d[1], d[2]);
    const hit = l > 1e-6 ? traceRaySurface(field, from, [d[0] / l, d[1] / l, d[2] / l], l + 0.1) : null;
    if (hit) return hit;
    if (!traceMissWarned) {
      traceMissWarned = true;
      console.warn('[head-damage] a head trace missed the posed surface; snapping to the nearest point instead');
    }
    return snapToSurface(field, from);
  }

  /** A tracker on prim `primIdx` at world `p` (never pushed on the ring: woundWorldPos re-reads it). */
  function tracker(prims: Primitive[], primIdx: number, p: Vec3, yaw: number): Wound {
    const w = worldHitToWound([prims[primIdx]!], p, 0.01, 'blast', yaw);
    w.primIdx = primIdx;
    return w;
  }

  /** The orbit's live points: the surface point, the inward unit and the head forward (world). */
  function orbitNow(prims: Primitive[], o: Orbit, yaw: number): { at: Vec3; inward: Vec3; fwd: Vec3 } {
    const at = woundWorldPos(prims, o.at, yaw);
    return {
      at,
      inward: unit(sub(woundWorldPos(prims, o.inner, yaw), at)),
      fwd: unit(sub(woundWorldPos(prims, o.front, yaw), at)),
    };
  }

  const plugPrim = (at: Vec3, inward: Vec3): Primitive => {
    const c = add(at, scale(inward, HEAD_LEAF.plug.inset));
    return prim(c, c, HEAD_LEAF.plug.r, HEAD_LEAF.plug.color, { gloss: 0, blendK: 0.0005 });
  };
  const inOrbitPrims = (n: { at: Vec3; inward: Vec3; fwd: Vec3 }): Primitive[] =>
    eyeballPrims(add(n.at, scale(n.inward, HEAD_LEAF.eyeInset)), n.fwd, HEAD_LEAF.iris, false, ORBIT_EYE_R);
  const danglingPrims = (s: StalkState, n: { at: Vec3; inward: Vec3; fwd: Vec3 }, eyeR: number): Primitive[] =>
    [...stalkPrims(s, HEAD_LEAF.iris, n.fwd, eyeR), plugPrim(n.at, n.inward)];
  /** The prims' ends relative to `at`; with `r0` (the radii the piece was attached with) every prim also carries the
   *  uniform scale that draws it at its current radius (morph re-writes scale rows, never radii; a morph entry without
   *  a scale keeps the last one, so it is always sent — 1 once the eye is full size). */
  const localEnds = (prims: Primitive[], at: Vec3, r0?: readonly number[]) => prims.map((p, i) => {
    if (!r0) return { a: sub(p.a, at), b: sub(p.b, at) };
    const k = r0[i] ? p.radius / r0[i]! : 1;
    return { a: sub(p.a, at), b: sub(p.b, at), scale: [k, k, k] as Vec3 };
  });
  const attach = (a: ZombieActor, prims: Primitive[], at: Vec3): AttachedPiece | null =>
    deps.attach ? deps.attach(a, prims, at, { clean: true }) : null;

  function disposeOrbit(o: Orbit): void {
    o.inOrbit?.dispose(); o.dangling?.dispose(); o.plug?.dispose();
    o.inOrbit = o.dangling = o.plug = null;
    o.stalk = null;
  }

  /** The dangling eye flies off: the stalk's free half and the eyeball become one gib; the plug stays. */
  function snapEye(a: ZombieActor, h: ActorHead, side: EyeSide, dir: Vec3): void {
    const o = h.orbits[side];
    if (!o || !o.stalk) return;
    const posed = a.posed(), yaw = a.pose().yaw;
    const n = orbitNow(posed.prims, o, yaw);
    const s = o.stalk;
    o.dangling?.dispose();
    o.dangling = null;
    o.stalk = null;
    const all = stalkPrims(s, HEAD_LEAF.iris, n.fwd, popEyeR(o.popAge));
    const caps = EYE_STALK.nodes - 1;
    // Capsules from the rope's middle on, then the eyeball (stalkPrims' order: caps, then the eye).
    const prims = [...all.slice(Math.floor(caps / 2), caps), ...all.slice(caps)];
    const last = s.p[s.p.length - 1]!;
    // THE COMIC FLIGHT (head-eye EYE_FLY): up in an arc, out along the blow and the face, away to the eye's own
    // side, spinning, and rubber-ball bouncy off the floor and the walls. The eye's side of the head is the head
    // frame's local x ('L' = hs.x < 0, the face sheet's image-left eye).
    const frame = h.frame ?? frameOf(a, posed);
    const sgn = side === 'L' ? -1 : 1;
    // No frame (no head prims): up × forward is the head's local +x.
    const outward: Vec3 = frame ? rotate(frame.quat, [sgn, 0, 0]) : [n.fwd[2] * sgn, 0, -n.fwd[0] * sgn];
    const l = eyeFlyLaunch(dir, n.fwd, outward, rngStreams.misc);
    const piece: GorePiece = {
      // 'torso', not 'head': a head chunk wears the face projection (boot.attachPiece's rule).
      limb: 'torso', origin: [last[0], last[1], last[2]], prims, kind: 'gob', tornAt: [], bones: [],
      vel: l.vel, angVel: l.angVel,
      restitution: EYE_FLY.restitution, wallRestitution: EYE_FLY.restitution, tag: 'eye',
    };
    deps.gore(a, [piece]);
    // The dark hole stays: the plug alone, re-attached (the dangling piece's prim count is fixed).
    o.plug = attach(a, [plugPrim(n.at, n.inward)], n.at);
  }

  function drop(a: ZombieActor, h: ActorHead): void {
    for (const side of SIDES) { const o = h.orbits[side]; if (o) disposeOrbit(o); }
    h.orbits = {};
    // Pooled views: a recycled view must not keep this zombie's switched-off eyes.
    a.view.setEyeGlow('L', true);
    a.view.setEyeGlow('R', true);
    a.setHeadDeform(null);
    heads.delete(a);
  }

  function hit(a: ZombieActor, point: Vec3, dir: Vec3, feel: HeadHitFeel): void {
    const posed = a.posed();
    const yaw = a.pose().yaw;
    const field = (q: Vec3) => sdBody(q, posed);
    // The UN-deformed head frame (the deform hook's last measurement): measured on the posed body mid-wobble,
    // headShape reads the squashed, dented head — its centre and axes move by centimetres, so hs (and the
    // nearest region) would drift with every hit landing while the last one still rings.
    const frame = headAlive(posed) ? (heads.get(a)?.frame ?? frameOf(a, posed)) : null;
    const impulse = { at: point, vel: [dir[0] * feel.shove, dir[1] * feel.shove, dir[2] * feel.shove] as Vec3 };
    if (!frame) {
      // No head to damage (off, or no head prims): the flail's plain face crater.
      const w = worldHitToWound(posed.prims, point, FLAIL_HEAD.faceCraterR, 'blast', yaw, field);
      w.severRadius = 0;
      clothifyWound(posed.prims, w, 'heavy');
      a.blast({ wounds: [w], meterCredit: feel.meterCredit * HEAD_LEAF.meterScale, impulse, reaction: 'blast', gain: feel.gain });
      deps.bleed(a, w, point, dir, 'slug');
      return;
    }
    let h = heads.get(a);
    if (!h) {
      h = { model: makeHeadDamage(), deform: makeHeadDeform(), orbits: {}, rand: actorRand(a.id), craters: {}, frame: null, affine: null };
      heads.set(a, h);
      const st = h;
      // Measured on the pose it is handed (fresh from applyRig), so the frame is the un-deformed head's.
      a.setHeadDeform(p => {
        const f = frameOf(a, p);
        st.frame = f;
        const m = f ? headAffine(st.deform, f) : null;
        st.affine = m ? headAffineMatrix(m) : null;
        return f ? deformHead(p, st.deform, f) : p;
      });
    }
    const dirLocal = rotate(conj(frame.quat), dir);
    const local = rotate(conj(frame.quat), sub(point, frame.centre));
    const hs: Vec3 = [local[0] / frame.axes[0], local[1] / frame.axes[1], local[2] / frame.axes[2]];
    const strip = HEAD_LEAF.strip[feel.side ?? 'R'];
    const r = headHit(h.model, { hs, strip }, h.rand);
    h.model = r.state;

    // Region surface points, traced once per hit on the posed (un-carved) surface.
    const surf = new Map<HeadRegion, Vec3>();
    const surfaceOf = (reg: HeadRegion): Vec3 => {
      let p = surf.get(reg);
      // An orbit is traced straight back along the head's forward (on the painted eye's line: toward the centre
      // it would land ~2 cm nearer the nose); the other regions toward the head centre.
      const back = reg === 'orbitL' || reg === 'orbitR' ? rotate(frame.quat, [0, 0, -1]) : undefined;
      const anchor = isSkullRegion(reg) ? h.model.anchor[reg] : undefined;
      if (!p) { p = surfaceToward(field, regionRayStart(frame, reg, anchor), frame, back); surf.set(reg, p); }
      return p;
    };
    // The shallowest depth below the anchor plane at which the carve (a sphere of `radius` round the anchor, clipped
    // by a slab along the inward normal) first cuts the skull — the head's bone prims, the field the mesh skeleton
    // is extracted from. Sampled over the carve's whole footprint (a centre column + rings at 1/3, 2/3 and 0.95 of
    // the radius, 8 columns each), not just under the anchor: the brow ridge sits 9 mm shallower off-axis.
    const skullBones = (posed.bonePrims ?? []).filter(p => p.op === 'bone' && p.limb === 'head' && !p.dead);
    const skullDepth = (at: Vec3, radius: number): number => {
      if (!skullBones.length) return Infinity;
      const n = normalAt(field, at);
      const t1 = unit(Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]]);
      const t2: Vec3 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
      let best = Infinity;
      const column = (u: number, v: number): void => {
        const lat2 = u * u + v * v;
        for (let d = 0; d < best && d * d + lat2 < radius * radius; d += 0.0005) {
          const q: Vec3 = [
            at[0] + t1[0] * u + t2[0] * v - n[0] * d, at[1] + t1[1] * u + t2[1] * v - n[1] * d, at[2] + t1[2] * u + t2[2] * v - n[2] * d,
          ];
          if (skullBones.some(p => sdPrimitive(q, p) < 0)) { best = d; return; }
        }
      };
      column(0, 0);
      for (const f of [1 / 3, 2 / 3, 0.95]) {
        for (let k = 0; k < 8; k++) column(Math.cos(k * Math.PI / 4) * f * radius, Math.sin(k * Math.PI / 4) * f * radius);
      }
      return best;
    };
    const crater = (reg: HeadRegion | 'brain', at: Vec3, radius: number): Wound => {
      const w = worldHitToWound(posed.prims, at, radius, 'blast', yaw, field);
      w.headSlot = 'keep'; w.headRegion = reg; w.severRadius = 0;
      let skull: number | null = null;
      if (reg !== 'brain' && w.carveDepth !== undefined) {
        const sd = skullDepth(at, radius);
        skull = Number.isFinite(sd) ? sd : null;
        // The carve's depth slab clips the sphere (radius `radius`): deeper than the radius carves nothing more.
        w.carveDepth = Math.min(radius, regionCarve(reg, h.model.flesh[reg], w.carveDepth, sd));
      }
      h.craters[reg] = { radius: w.radius, carveDepth: w.carveDepth ?? null, skull };
      return clothifyWound(posed.prims, w, 'heavy');
    };

    const wounds: Wound[] = [];
    let bleedAt: Wound | null = null;
    let forceCollapse = false;
    let dented = false;
    for (const ev of r.events as HeadEvent[]) {
      switch (ev.kind) {
        case 'wobble':
          h.deform = kickWobble(h.deform, dirLocal);
          break;
        case 'strip': {
          if (!dented) { dented = true; h.deform = addDent(h.deform, dirLocal, HEAD_LEAF.dentDepth, frame.axes); }
          const w = crater(ev.region, surfaceOf(ev.region), REGION_TUNING.craterR(ev.region, ev.flesh));
          wounds.push(w);
          bleedAt ??= w;
          break;
        }
        case 'orbit-exposed': {
          a.view.setEyeGlow(ev.side, false);
          const at = surfaceOf(orbitRegion(ev.side));
          const pi = worldHitToWound(posed.prims, at, 0.01, 'blast', yaw).primIdx;
          const fwd = rotate(frame.quat, [0, 0, 1]);
          const o: Orbit = {
            at: tracker(posed.prims, pi, at, yaw),
            // Straight back along −forward, NOT toward the head centre: the orbit is off-centre, so the centre
            // line ran ~2 cm toward the nose and the plug's dark hole (and the in-orbit eye) sat off the painted eye.
            inner: tracker(posed.prims, pi, add(at, scale(fwd, -0.01)), yaw),
            front: tracker(posed.prims, pi, add(at, scale(fwd, 0.02)), yaw),
            inOrbit: null, stalk: null, dangling: null, plug: null, popAge: 0, danglingR0: [],
          };
          h.orbits[ev.side] = o;
          // BOTH EYES POP AT ONCE (v1.5a): the other eye is exposed and popped in the same hit. Its orbit then has
          // no strip event of its own (the model only set its flesh to the threshold): stamp its crater here, as a
          // strip would. And its in-orbit piece would be disposed by the eye-pop a few events on: skip it.
          const region = orbitRegion(ev.side);
          if (!r.events.some(e => e.kind === 'strip' && e.region === region)) {
            wounds.push(crater(region, at, REGION_TUNING.craterR(region, h.model.flesh[region])));
          }
          if (!r.events.some(e => e.kind === 'eye-pop' && e.side === ev.side)) {
            o.inOrbit = attach(a, inOrbitPrims(orbitNow(posed.prims, o, yaw)), at);
          }
          break;
        }
        case 'eye-pop': {
          const o = h.orbits[ev.side];
          if (!o) break;
          o.inOrbit?.dispose();
          o.inOrbit = null;
          const n = orbitNow(posed.prims, o, yaw);
          const nrm = normalAt(field, n.at);
          const k = dot(dir, nrm);
          const out = unit([dir[0] - 2 * k * nrm[0], dir[1] - 2 * k * nrm[1], dir[2] - 2 * k * nrm[2]]);
          // makeStalk lays the rope STRAIGHT at full length: the piece's bound is fixed from these prims.
          o.stalk = makeStalk(n.at, out, HEAD_LEAF.popSpeed);
          // THE COMIC POP: the eye leaves the orbit life-size and swells to the cartoon EYEBALL_R over POP_GROW_S.
          // The piece's radius rows are packed once (attach), so it is attached at the FULL size — its bound and radii
          // — and every update re-scales the eyeball's prims (morph's per-prim scale) down to popEyeR(age).
          o.popAge = 0;
          const full = danglingPrims(o.stalk, n, EYEBALL_R);
          o.danglingR0 = full.map(p => p.radius);
          o.dangling = attach(a, full, n.at);
          o.dangling?.update(n.at, localEnds(danglingPrims(o.stalk, n, popEyeR(0)), n.at, o.danglingR0));
          break;
        }
        case 'eye-snap':
          snapEye(a, h, ev.side, dir);
          break;
        case 'skull-exposed':
          break;   // the region's crater at this flesh reaches bone (regionCarve)
        case 'brain': {
          const c = surfaceOf(ev.region);
          wounds.push(crater('brain', c, CROWN.brainR));
          const rand = rngStreams.misc;
          // The whole brain is the modelled MESH (spec §14); the SDF brainPiece only while the GLB loads.
          const l = brainLaunch(c, dir, rand);
          const thrown = deps.brain?.throw(l.pos, l.vel, l.angVel) ?? false;
          deps.gore(a, [...(thrown ? [] : [brainPiece(c, dir, rand)]), ...brainLumps(c, dir, rand), ...skullChips(c, dir, rand)]);
          // Up, leaning out of the cracked region (0.4 × its outward normal). Straight out of a brow crack the burst
          // sprayed at the player and the brain went unseen behind streaks (smoke, b2-brain-3f).
          const outN = normalAt(field, c);
          deps.burst(a, c, unit([outN[0] * 0.4, outN[1] * 0.4 + 1, outN[2] * 0.4]));
          break;
        }
        case 'kill':
          forceCollapse = true;
          break;
      }
    }
    a.blast({ wounds, meterCredit: feel.meterCredit * HEAD_LEAF.meterScale, impulse, reaction: 'blast', forceCollapse, gain: feel.gain });
    // Head strips bleed a PELLET's gout (spec §15), and so does the brain stage (spec §14: so the brain is seen).
    if (bleedAt) deps.bleed(a, bleedAt, point, dir, 'pellet');
  }

  function tick(dt: number): void {
    for (const [a, h] of heads) {
      if (!ctx.world.actors.includes(a)) { drop(a, h); continue; }
      const s0 = h.deform.s;
      h.deform = stepWobble(h.deform, dt);
      // A FROZEN actor (?frozen=1, the gates) never steps, and the step is where the deform is re-applied:
      // its posed/drawn head would keep the hit's re-pose — the wobble's PEAK squash (0.40 along the blow),
      // which pulls the face flesh ~2-3 cm back behind the undeformed skull and teeth — for good.
      if (ctx.demo.wanderFrozen && h.deform.s !== s0) a.reposeHead();
      if (!h.orbits.L && !h.orbits.R) continue;
      const posed = a.posed();
      if (!headAlive(posed)) {
        // The head is gone (popped, severed): its eyes and plugs go with it.
        h.model = headDeath(h.model).state;
        for (const side of SIDES) { const o = h.orbits[side]; if (o) disposeOrbit(o); }
        h.orbits = {};
        continue;
      }
      if (a.debug().phase !== 'standing') {
        // Dead some other way (the brain's collapse, dynamite): a dangling eye snaps off; the plug stays.
        const d = headDeath(h.model);
        h.model = d.state;
        for (const ev of d.events) if (ev.kind === 'eye-snap') snapEye(a, h, ev.side, [0, 0, 0]);
      }
      const yaw = a.pose().yaw;
      for (const side of SIDES) {
        const o = h.orbits[side];
        if (!o) continue;
        const n = orbitNow(posed.prims, o, yaw);
        if (o.inOrbit) o.inOrbit.update(n.at, localEnds(inOrbitPrims(n), n.at));
        if (o.stalk) {
          // The socket rides the posed (wobbling, dented) head.
          o.stalk = stepStalk(o.stalk, n.at, dt);
          o.popAge += Number.isFinite(dt) && dt > 0 ? dt : 0;
          o.dangling?.update(n.at, localEnds(danglingPrims(o.stalk, n, popEyeR(o.popAge)), n.at, o.danglingR0));
        }
        if (o.plug) o.plug.update(n.at, localEnds([plugPrim(n.at, n.inward)], n.at));
      }
    }
  }

  return {
    hit,
    tick,
    forget(id) {
      for (const [a, h] of heads) if (a.id === id) drop(a, h);
    },
    reset() {
      for (const [a, h] of heads) drop(a, h);
    },
    affine: a => heads.get(a)?.affine ?? null,
    debug(id) {
      for (const [a, h] of heads) {
        if (a.id !== id) continue;
        const posed = a.posed(), yaw = a.pose().yaw;
        const eyeball: Record<EyeSide, Vec3 | null> = { L: null, R: null };
        const socket: Record<EyeSide, Vec3 | null> = { L: null, R: null };
        const stalk: Record<EyeSide, Vec3[] | null> = { L: null, R: null };
        const eyeR: Record<EyeSide, number | null> = { L: null, R: null };
        let draws = 0;
        for (const side of SIDES) {
          const o = h.orbits[side];
          if (!o) continue;
          const n = orbitNow(posed.prims, o, yaw);
          socket[side] = n.at;
          if (o.inOrbit) { eyeball[side] = add(n.at, scale(n.inward, HEAD_LEAF.eyeInset)); eyeR[side] = ORBIT_EYE_R; }
          if (o.stalk) {
            eyeball[side] = [...o.stalk.p[o.stalk.p.length - 1]!] as Vec3;
            stalk[side] = o.stalk.p.map(q => [...q] as Vec3);
            eyeR[side] = popEyeR(o.popAge);
          }
          draws += (o.inOrbit ? 1 : 0) + (o.dangling ? 1 : 0) + (o.plug ? 1 : 0);
        }
        const m = h.model;
        return {
          hits: m.hits,
          flesh: { ...m.flesh },
          skull: { ...m.skull },
          eyes: { ...m.eyes },
          dead: m.dead,
          anchor: { ...m.anchor },
          squash: h.deform.s,
          flat: [...h.deform.flat],
          eyeball,
          eyeR,
          socket,
          stalk,
          draws,
          craters: Object.fromEntries(Object.entries(h.craters).map(([k, v]) => [k, { ...v }])),
          frame: h.frame ? { centre: [...h.frame.centre] as Vec3, quat: [...h.frame.quat] as Quat, axes: [...h.frame.axes] as Vec3 } : null,
        };
      }
      return null;
    },
  };
}

