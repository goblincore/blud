// src/lab/sdf-zombie/death-fall.ts
//
// AUTHORED DEATH FALLS (owner playtest 2026-11-02: the free ragdoll "still demonstrates unnatural body
// ragdolling"; "ideally some kind of blended solution where we can have control but still some dynamic
// physics"). Every humanoid's death plays one of a small set of keyframed falls, the soldier's way
// (soldier-fall.ts): the pose gives each rig point a TARGET and the verlet rig springs toward it at the
// rest pull, so gravity, the floor and late hits still move the body. DEATH_FALL.pull sets how hard the
// pose holds (1 = authored, lower = looser); after the last key the pull eases to DEATH_FALL.settle so the
// corpse settles under its own weight.
//
// A fall is a list of keys. Each key bends the rest pose's limbs, twists it about the vertical, topples
// it about the pivot toward a heading measured from the killing shot, and grounds it on the floor; the
// pose blends from the body's pose at death through the keys. A horizontal travel and an airborne arc
// ride on top (the blown-away throw).
//
// Frames: the rest pose's forward is +Z and its left +X. A bone angle is a pitch about local X:
// positive swings a hanging bone backward (-Z), negative forward. Heading 0 topples along the shot
// (a body facing the shooter goes onto its back), PI against it (face down), +-PI/2 to the side.
//
// Pure: no clock, randomness comes in as a function.
import type { Vec3 } from './types';
import type { GaitJointName } from './gait';
import { rotateYaw } from './gait';
import { add, lerp, normalize, qFromAxisAngle, qRotate, scale, sub } from './vec';

export type DeathFallKind = 'blown' | 'backward' | 'crumple' | 'spin' | 'sit';
export const DEATH_FALL_KINDS: readonly DeathFallKind[] = ['blown', 'backward', 'crumple', 'spin', 'sit'];

/** The fall a death plays: picked once, when the body goes down. */
export interface DeathFallChoice {
  kind: DeathFallKind;
  /** 0..1.5: scales the travel and the arc (a point-blank double barrel is 1). */
  strength: number;
  /** +1 or -1: which way a spin turns and which side it lands on; mirrors the asymmetric limbs. */
  side: 1 | -1;
  /** World direction of the killing volley; absent = the shot motion.ts saw last. */
  impact?: Vec3;
}

/** Tuning (wound panel). */
export const DEATH_FALL = {
  /** Authored deaths on (off = the old free ragdoll for everyone but the soldier family). */
  on: true,
  /** Rest pull while the fall plays: 1 holds the authored pose, lower lets physics loosen it. */
  pull: 1,
  /** Rest pull the corpse eases to over SETTLE_SEC after the last key. */
  settle: 0.35,
};
export const SETTLE_SEC = 0.6;

export function setDeathFall(k: Partial<typeof DEATH_FALL>): void { Object.assign(DEATH_FALL, k); }

/** Pitch angles (rad) for a chain's bones, root first: leg = thigh, shin, foot; arm = upper, fore, hand. Each is
 *  ABSOLUTE (from the bone's rest direction), not relative to its parent: a knee bends when the shin's angle is
 *  above the thigh's, an elbow when the forearm's is below the upper arm's. The other way round fights the rig's
 *  bend limits (constrainRigBends) forever: a corpse whose arms never stopped swinging. */
type Chain = readonly [number, number, number];

interface FallKey {
  /** Seconds after the body went down. */
  at: number;
  /** Topple angle (rad) about the pivot; ~1.5 lies the body flat. */
  topple: number;
  /** Topple heading (rad) from the shot's horizontal direction. */
  heading: number;
  /** Turn about the vertical (rad), applied before the topple. */
  twist: number;
  /** Near leg / far leg and near arm / far arm ("near" is the `side` the fall favours). */
  legNear: Chain; legFar: Chain; armNear: Chain; armFar: Chain;
  /** Sideways splay (rad) of the arms and the legs, away from the body's midline. */
  armSplay: number; legSplay: number;
}

interface FallSpec {
  keys: readonly FallKey[];
  /** Horizontal travel along the shot (m) at strength 1, eased in over travelSec. */
  travel: number; travelSec: number;
  /** Airborne arc height (m) at strength 1, over airSec. */
  air: number; airSec: number;
}

const STRAIGHT: Chain = [0, 0, 0];
const HANG: Chain = [0, -0.15, -0.15];
const k = (p: Partial<FallKey> & { at: number }): FallKey => ({
  topple: 0, heading: 0, twist: 0, legNear: STRAIGHT, legFar: STRAIGHT, armNear: HANG, armFar: HANG,
  armSplay: 0.4, legSplay: 0.12, ...p,
});

/** The falls. Times in seconds after the body went down. */
export const FALLS: Record<DeathFallKind, FallSpec> = {
  // Off his feet along the shot: legs swing up, arms fling toward the shooter, lands flat on his back.
  blown: {
    keys: [
      k({ at: 0.22, topple: 0.7, legNear: [-0.7, -0.2, 0], legFar: [-0.45, 0.1, 0], armNear: [-2.0, -2.3, -2.3], armFar: [-1.7, -2.0, -2.0], armSplay: 0.5 }),
      k({ at: 0.62, topple: 1.5, legNear: [-0.35, 0.35, 0.3], legFar: [-0.1, 0.1, 0.1], armNear: [-2.6, -2.8, -2.8], armFar: [-2.3, -2.6, -2.6], armSplay: 0.9, legSplay: 0.2 }),
    ],
    travel: 1.6, travelSec: 0.7, air: 0.45, airSec: 0.62,
  },
  // Rocked back off his heels: the soldier's dead fall, one knee folding.
  backward: {
    keys: [
      k({ at: 0.3, topple: 0.55, legNear: [-0.3, 0.45, 0.3], armNear: [-0.6, -0.9, -0.9], armFar: [-0.3, -0.5, -0.5], armSplay: 0.5 }),
      k({ at: 0.7, topple: 1.5, legNear: [-0.5, 0.5, 0.5], legFar: [-0.12, 0.12, 0.12], armNear: [-0.4, -0.6, -0.6], armFar: [0, -0.1, -0.1], armSplay: 0.7 }),
    ],
    travel: 0.45, travelSec: 0.6, air: 0.05, airSec: 0.4,
  },
  // Knees buckle, he drops onto them, then folds forward onto his face.
  crumple: {
    keys: [
      k({ at: 0.38, topple: 0.15, heading: Math.PI, legNear: [-0.15, 1.5, 1.5], legFar: [-0.2, 1.45, 1.45], armNear: [-0.2, -0.4, -0.4], armFar: [-0.1, -0.3, -0.3], armSplay: 0.25, legSplay: 0.15 }),
      k({ at: 0.62, topple: 0.55, heading: Math.PI, legNear: [-0.4, 1.4, 1.4], legFar: [-0.45, 1.35, 1.4], armNear: [-0.6, -1.0, -1.0], armFar: [-0.4, -0.8, -0.8], armSplay: 0.3, legSplay: 0.15 }),
      k({ at: 1.0, topple: 1.48, heading: Math.PI, legNear: [0.1, 0.35, 0.6], legFar: [0, 0.2, 0.5], armNear: [0.3, 0.1, 0.1], armFar: [0.45, 0.25, 0.25], armSplay: 0.55, legSplay: 0.15 }),
    ],
    travel: -0.1, travelSec: 1.0, air: 0, airSec: 1,
  },
  // Spun by the hit: turns, the near knee gives, and he goes down on his side and rolls toward his front.
  spin: {
    keys: [
      k({ at: 0.3, twist: 0.8, topple: 0.45, heading: Math.PI / 2, legNear: [-0.5, 0.9, 0.6], legFar: [0.1, 0.15, 0.15], armNear: [-0.3, -0.6, -0.6], armFar: [-1.2, -1.5, -1.5], armSplay: 1.0 }),
      k({ at: 0.8, twist: 1.5, topple: 1.5, heading: Math.PI / 2, legNear: [-0.7, 0.9, 0.5], legFar: [-0.2, 0.3, 0.3], armNear: [-0.2, -0.5, -0.5], armFar: [-1.4, -1.7, -1.7], armSplay: 0.9, legSplay: 0.2 }),
    ],
    travel: 0.3, travelSec: 0.7, air: 0.03, airSec: 0.4,
  },
  // Legs go: he sits down hard, then slumps back flat, knees up.
  sit: {
    keys: [
      k({ at: 0.4, topple: 0.3, legNear: [-1.4, -0.1, 0.2], legFar: [-1.3, 0, 0.2], armNear: [0.5, 0.3, 0.3], armFar: [0.4, 0.3, 0.3], armSplay: 0.45, legSplay: 0.25 }),
      k({ at: 0.65, topple: 0.5, legNear: [-1.35, -0.1, 0.2], legFar: [-1.25, 0, 0.2], armNear: [0.3, 0.2, 0.2], armFar: [0.3, 0.2, 0.2], armSplay: 0.55, legSplay: 0.25 }),
      k({ at: 1.15, topple: 1.5, legNear: [-0.9, 0.9, 0.4], legFar: [-0.4, 0.3, 0.2], armNear: [-0.3, -0.5, -0.5], armFar: [-0.1, -0.3, -0.3], armSplay: 0.75, legSplay: 0.25 }),
    ],
    travel: 0.3, travelSec: 0.5, air: 0, airSec: 1,
  },
};

/** Seconds until the last key lands. */
export function fallLength(kind: DeathFallKind): number {
  const keys = FALLS[kind].keys;
  return keys[keys.length - 1]!.at;
}

/** The rest pull for a body `age` seconds into its fall (DEATH_FALL.pull, easing to .settle after the last key). */
export function deathFallPull(kind: DeathFallKind, age: number, t: typeof DEATH_FALL = DEATH_FALL): number {
  const u = Math.min(1, Math.max(0, (age - fallLength(kind)) / SETTLE_SEC));
  return t.pull + (Math.min(t.pull, t.settle) - t.pull) * u * u * (3 - 2 * u);
}

/** Which fall a death plays (weights per situation; `blown` comes only from the blow-away roll). */
export const FALL_WEIGHTS: Record<'legs' | 'head' | 'body', Partial<Record<DeathFallKind, number>>> = {
  legs: { crumple: 0.5, sit: 0.3, spin: 0.2 },
  head: { crumple: 0.35, backward: 0.35, spin: 0.3 },
  body: { backward: 0.3, sit: 0.25, spin: 0.25, crumple: 0.2 },
};

export interface DeathFallInput {
  /** The blow-away roll threw him (blow-away.ts), with this throw strength (1 = a point-blank double barrel). */
  blown: number | null;
  /** Where the killing volley struck. */
  struck: 'legs' | 'head' | 'body';
}

/** Picks the fall. `rand` is called exactly twice, so a seeded stream replays the same death. */
export function pickDeathFall(input: DeathFallInput, rand: () => number): DeathFallChoice {
  const r = rand();
  const side: 1 | -1 = rand() < 0.5 ? 1 : -1;
  if (input.blown !== null) return { kind: 'blown', strength: Math.min(1.5, Math.max(0.5, input.blown)), side };
  const w = FALL_WEIGHTS[input.struck];
  const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
  let acc = 0;
  for (const kind of DEATH_FALL_KINDS) {
    acc += (w[kind] ?? 0) / (total || 1);
    if (r < acc) return { kind, strength: 1, side };
  }
  return { kind: 'backward', strength: 1, side };
}

/** A body can play the falls when it has a humanoid skeleton. */
export function canDeathFall(names: readonly GaitJointName[]): boolean {
  const need: GaitJointName[] = ['pelvis', 'chest', 'head', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR'];
  return need.every(n => names.includes(n));
}

/** Contact radius (m) of a joint against the floor: the trunk's flesh, then the limbs'. */
const RADIUS: Partial<Record<GaitJointName, number>> = {
  pelvis: 0.13, hips: 0.13, spineA: 0.14, spineB: 0.14, chest: 0.15, neck: 0.08, head: 0.11,
  shoulderL: 0.115, shoulderR: 0.115, kneeL: 0.06, kneeR: 0.06, footL: 0.04, footR: 0.04, hipL: 0.1, hipR: 0.1,
};
/** Contact radius of any other joint (elbows, hands, toes). */
const LIMB_RADIUS = 0.05;
const LEG = new Set<GaitJointName>(['kneeL', 'kneeR', 'footL', 'footR', 'hipL', 'hipR']);
/** Topple (rad) under which a key still stands on its legs. */
const UPRIGHT = 1.0;

export interface DeathFallFrame {
  /** Rest pose joints, rig-point order, local frame (forward +Z). */
  base: readonly Vec3[];
  names: readonly GaitJointName[];
  /** World joints the moment he went down. */
  start: readonly Vec3[];
  /** The body's root (world) and its accumulated shift, as motion.ts lays the rest targets. */
  pivot: Vec3; shift: Vec3;
  yaw: number;
  /** World floor height the trunk lies on. */
  floor: number;
  /** World floor the limbs drape onto, when it differs from `floor` (the soldier's trunk floor is 13 cm under the
   *  visible one: his joints sit high in the armour). */
  limbFloor?: number;
  /** World direction of the killing shot. */
  impact: Vec3;
  /** Joints that are gone (a severed limb's): never ground the body on them. */
  missing?: ReadonlySet<GaitJointName>;
}

/** One key's pose: bent, twisted, toppled, turned to the body yaw, grounded. Relative to the pivot. */
function keyPose(key: FallKey, f: DeathFallFrame, side: 1 | -1, shotLocal: Vec3): Vec3[] {
  const { base, names } = f;
  const pose = base.map(p => [...p] as Vec3);
  const index = (name: GaitJointName) => names.indexOf(name);
  // "Near" is the side the fall favours: +X (left) for side +1.
  const near = side > 0 ? 'L' : 'R', far = side > 0 ? 'R' : 'L';
  const turnChain = (chain: GaitJointName[], angles: Chain, splay: number) => {
    const root = index(chain[0]!);
    if (root < 0) return;
    const out = Math.sign(base[root]![0]) * splay;
    for (let n = 1; n < chain.length; n++) {
      const a = index(chain[n - 1]!), b = index(chain[n]!);
      if (a < 0 || b < 0) continue;
      // Splay the hanging bone out first, then pitch it: a raised arm stays out from the midline (splaying after
      // the pitch swung arms raised overhead in across the face).
      const v = qRotate(qFromAxisAngle([0, 0, 1], out), sub(base[b]!, base[a]!));
      pose[b] = add(pose[a]!, qRotate(qFromAxisAngle([1, 0, 0], angles[Math.min(n - 1, 2)] ?? 0), v));
    }
  };
  const leg = (s: string): GaitJointName[] => [`hip${s}`, `knee${s}`, `foot${s}`, `toe${s}`] as GaitJointName[];
  const arm = (s: string): GaitJointName[] => [`shoulder${s}`, `elbow${s}`, `hand${s}`, `handTip${s}`] as GaitJointName[];
  turnChain(leg(near), key.legNear, key.legSplay);
  turnChain(leg(far), key.legFar, key.legSplay);
  turnChain(arm(near), key.armNear, key.armSplay);
  turnChain(arm(far), key.armFar, key.armSplay);
  // Topple heading: from the shot's local direction, turned by the key's heading (mirrored by side).
  const h = key.heading * side;
  const dir: Vec3 = [shotLocal[0] * Math.cos(h) + shotLocal[2] * Math.sin(h), 0, -shotLocal[0] * Math.sin(h) + shotLocal[2] * Math.cos(h)];
  const twist = qFromAxisAngle([0, 1, 0], key.twist * side);
  const topple = qFromAxisAngle([dir[2], 0, -dir[0]], key.topple);
  const pelvis = index('pelvis');
  const hub = pelvis >= 0 ? base[pelvis]! : [0, 0, 0] as Vec3;
  const turned = pose.map(p => rotateYaw(qRotate(topple, qRotate(twist, sub(p, hub))), f.yaw));
  // Ground the load-bearing body. While he is still fairly upright (topple under UPRIGHT) his legs bear him, on
  // his feet or his knees: grounding the trunk alone dropped the blown fall's first key to the floor mid-flight.
  // Lying, only the trunk and head do: a leg under a side lie held the trunk 9 cm up. Never an arm (one under a
  // side fall was a strut holding the corpse 0.6 m up); the floor contact folds the limbs instead.
  const legsBear = key.topple < UPRIGHT;
  let low = Infinity;
  turned.forEach((p, i) => {
    const name = names[i]!;
    const r = RADIUS[name];
    if (f.missing?.has(name) || r === undefined || (!legsBear && LEG.has(name))) return;
    low = Math.min(low, p[1] - r);
  });
  return turned.map(p => [p[0], p[1] - low, p[2]] as Vec3);
}

const smooth = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };

/** The fall's joint targets (world, rig-point order) `age` seconds after he went down. */
export function deathFallPose(choice: DeathFallChoice, f: DeathFallFrame, age: number): Vec3[] {
  const spec = FALLS[choice.kind];
  const horiz: Vec3 = Math.hypot(f.impact[0], f.impact[2]) > 1e-3 ? normalize([f.impact[0], 0, f.impact[2]]) : rotateYaw([0, 0, -1], f.yaw);
  const shotLocal = rotateYaw(horiz, -f.yaw);
  const place = (p: Vec3): Vec3 => [p[0] + f.pivot[0] + f.shift[0], p[1] + f.floor, p[2] + f.pivot[2] + f.shift[2]];
  // Before the first key: from the start pose; between keys: key to key.
  const keys = spec.keys;
  let pose: Vec3[];
  if (age <= keys[0]!.at) {
    const a = keyPose(keys[0]!, f, choice.side, shotLocal).map(place);
    pose = f.start.map((s, i) => lerp(s, a[i]!, smooth(age / keys[0]!.at)));
  } else {
    let j = 1;
    while (j < keys.length - 1 && age > keys[j]!.at) j++;
    const k0 = keys[j - 1]!, k1 = keys[Math.min(j, keys.length - 1)]!;
    const a = keyPose(k0, f, choice.side, shotLocal).map(place);
    const b = k1 === k0 ? a : keyPose(k1, f, choice.side, shotLocal).map(place);
    const u = k1 === k0 ? 1 : smooth((age - k0.at) / (k1.at - k0.at));
    pose = a.map((p, i) => lerp(p, b[i]!, u));
  }
  // Travel along the shot (ease-out) and the airborne arc.
  const travel = spec.travel * choice.strength * (1 - Math.pow(1 - Math.min(1, age / spec.travelSec), 2));
  const arc = age < spec.airSec ? Math.sin(Math.PI * age / spec.airSec) * spec.air * choice.strength : 0;
  // THE DRAPE (owner playtest 2026-11-02: "stiff but not lying on the ground properly"): after the last key every
  // limb joint (and the head) eases down onto the floor at its flesh radius, so raised arms and a knee up lie flat instead of being
  // held in the air. The bone lengths spread the limbs out along the floor.
  const drape = smooth((age - fallLength(choice.kind)) / SETTLE_SEC);
  return pose.map((p, i) => {
    const y = p[1] + arc;
    const name = f.names[i]!, r = RADIUS[name];
    // The trunk is already lying where the key grounded it (a side lie keeps its upper shoulder up); the limbs drape,
    // and the head and neck (the zombie's hunched neck held his head 35 cm up on his back) unless the trunk lies on a
    // floor of its own: pulling the soldier's head to the visible floor dragged his shoulder 4 cm into it.
    const head = (name === 'head' || name === 'neck') && (f.limbFloor ?? f.floor) === f.floor;
    const limb = r === undefined || LEG.has(name) || head;
    const lie = (f.limbFloor ?? f.floor) + (r ?? LIMB_RADIUS);
    return [p[0] + horiz[0] * travel, limb && drape > 0 ? y + (lie - y) * drape : y, p[2] + horiz[2] * travel] as Vec3;
  });
}

/** What a landed corpse holds (motion.ts keeps it in its state). */
export interface CorpseHold {
  /** The shape it re-anchored to where it lies (world joints); null until it has settled. */
  rest: Vec3[] | null;
  /** Seconds left of a hit's limp spell. */
  loose: number;
}

/** Hit shove on a landed corpse (×): limp, nothing springs it back, and the floor's friction alone stopped it late. */
export const CORPSE_SHOVE = 0.5;

/** Seconds a hit on a landed corpse goes limp before it re-anchors where it now lies. */
export const CORPSE_LOOSE_SEC = 0.5;

/** How far (m) a joint may move from where the corpse lay during a hit's limp spell before the pose catches it. */
export const CORPSE_SLACK_M = 0.3;

/** The trunk: it slides and turns as one piece under a hit, never folds. Its joints have no bend stops (only bone
 *  lengths), so a free trunk let a belly hit push the hips joint past the pelvis; the spine folded back on itself and
 *  the torso's flesh blobs bunched into one ball (owner playtest 2026-11-02: "an orb around his midsection"). */
const TRUNK = new Set<GaitJointName>(['pelvis', 'hips', 'spineA', 'spineB', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR']);

/** `anchor`'s trunk moved by the horizontal slide and turn that best fits it onto `points`' trunk (2-D Procrustes),
 *  its height kept; every other joint from `limbs`. */
function fitTrunk(anchor: readonly Vec3[], points: readonly Vec3[], limbs: readonly Vec3[], names: readonly GaitJointName[]): Vec3[] {
  const ids = names.flatMap((n, i) => (TRUNK.has(n) && anchor[i] && points[i] ? [i] : []));
  if (!ids.length) return limbs.map(p => [...p] as Vec3);
  const mean = (ps: readonly Vec3[]): [number, number] =>
    ids.reduce<[number, number]>((m, i) => [m[0] + ps[i]![0] / ids.length, m[1] + ps[i]![2] / ids.length], [0, 0]);
  const [ax, az] = mean(anchor), [px, pz] = mean(points);
  let dot = 0, cross = 0;
  for (const i of ids) {
    const u0 = anchor[i]![0] - ax, u1 = anchor[i]![2] - az, v0 = points[i]![0] - px, v1 = points[i]![2] - pz;
    dot += u0 * v0 + u1 * v1; cross += u1 * v0 - u0 * v1;
  }
  const th = Math.atan2(cross, dot), c = Math.cos(th), sn = Math.sin(th);
  return limbs.map((p, i) => {
    if (!ids.includes(i)) return [...p] as Vec3;
    const u0 = anchor[i]![0] - ax, u1 = anchor[i]![2] - az;
    return [px + c * u0 + sn * u1, anchor[i]![1], pz - sn * u0 + c * u1] as Vec3;
  });
}

/** One frame of a landed corpse. Without it a hit on the corpse was sprung straight back to the authored pose and
 *  the body wobbled 36 cm round it (owner playtest 2026-11-02: "spazzed out"). Now a hit puts it on a leash for
 *  CORPSE_LOOSE_SEC: each limb joint moves freely within CORPSE_SLACK_M of where it lay (the shove and gravity move
 *  it, nothing springs it back), and only past that does the pull catch it; the trunk follows the slide as one rigid
 *  piece (fitTrunk). Then it holds the shape it ended in. `pose` is this frame's authored fall (the anchor before it
 *  has settled). Before landing it returns null. */
export function corpseHoldStep(choice: DeathFallChoice, age: number, hold: CorpseHold | undefined, hit: boolean, dt: number,
  points: readonly Vec3[], pose: readonly Vec3[], names: readonly GaitJointName[], t: typeof DEATH_FALL = DEATH_FALL,
): { hold: CorpseHold; targets: readonly Vec3[] | null; pull: number } | null {
  if (age < fallLength(choice.kind)) return null;
  const pull = deathFallPull(choice.kind, age, t);
  const settled = age >= fallLength(choice.kind) + SETTLE_SEC;
  const wasLoose = (hold?.loose ?? 0) > 0;
  const loose = hit ? CORPSE_LOOSE_SEC : Math.max(0, (hold?.loose ?? 0) - dt);
  const anchor = hold?.rest ?? pose;
  if (loose > 0) {
    const leashed = points.map((p, i) => {
      const a = anchor[i]!, d = sub(p, a), l = Math.hypot(d[0], d[1], d[2]);
      return l <= CORPSE_SLACK_M ? [...p] as Vec3 : add(a, scale(d, CORPSE_SLACK_M / l));
    });
    return { hold: { rest: hold?.rest ?? null, loose }, targets: fitTrunk(anchor, points, leashed, names), pull };
  }
  // Re-anchor where the body lies: once settled, and again after every limp spell.
  const rest = (wasLoose || !hold?.rest) && settled ? fitTrunk(anchor, points, points, names) : hold?.rest ?? null;
  return { hold: { rest, loose: 0 }, targets: rest, pull };
}
