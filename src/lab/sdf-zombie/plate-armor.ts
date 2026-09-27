// src/lab/sdf-zombie/plate-armor.ts
//
// PLATE ARMOUR THAT WORKS (the juggernaut, spec 2026-09-25-juggernaut-design.md,
// "Damage"). Pure: plain data in, plain data out, no three.
//
// The soldier's plates are visual only (webgpu/kit-damage.ts): every hit
// wounds the flesh under them, and the plate falls off after two or three
// hits to show craters that were already there. The juggernaut's plates STOP
// rounds instead:
//
//   * a hit on an intact plate spends that plate's hit points and makes no
//     wound and no injury (game-actor.ts returns no wound; sparks fly);
//   * a plate at zero SHEDS, and from then on hits there wound the flesh under
//     it with the soldier's regional injury rules;
//   * the HELMET is a plate, so a head shot only counts once it is gone;
//   * blasts are never absorbed: dynamite wounds through armour and cracks
//     every plate it reaches (blastPlateDamage), the intended answer to a tank.
//
// ONE PLATE PER BONE GROUP, deliberately coarse. The kit's mesh islands
// (pauldron + sleeve on the upper arm, knee + greave on the shin) are skinned
// to those same bones, so kit-damage.ts can shed exactly the islands of a shed
// plate by bone, with no mesh-to-plate table to keep in step. The pelvis is
// NOT armoured: the hips below the iron girdle are the weak spot.
//
// Bone names compare through plateKey(): GLTFLoader sanitises `clavicle.l` to
// `claviclel` on the kit side, while body prims carry the .blob spelling.

export interface PlateSpec {
  id: string;
  /** .blob bone names this plate covers. */
  bones: readonly string[];
  /** Injury points it absorbs before shedding (a pellet is 1, a slug 3). */
  hp: number;
  /** Optional BODY-LOCAL sphere (metres; +x his left, +y up from the floor,
   *  +z forward, de-yawed about his root) the hit must also land in. For
   *  metal EMBEDDED in flesh (the warbull), where a bone carries both: the
   *  neck bone holds his pecs AND the spine rack behind them, and only a
   *  round that lands on the rack is stopped. Absent = the whole bone group,
   *  the juggernaut's suit. A region plate matches only when the hit point
   *  is known (hitPlate's `local`). */
  region?: { center: readonly [number, number, number]; radius: number };
  /** Bones whose KIT islands shed with this plate (kit-damage.ts), when they
   *  are not all of `bones`: a region plate lists every bone its patch of
   *  flesh can report, but must strip only the metal skinned to its own. */
  kitBones?: readonly string[];
}

export interface ArmorSpec {
  plates: readonly PlateSpec[];
  /** Plate hit points one explosion takes from every plate it wounds under. */
  blastPlateDamage: number;
}

/** Plate id -> hit points left. A plate at <= 0 is shed. */
export type PlateState = Readonly<Record<string, number>>;

export const plateKey = (bone: string) => bone.toLowerCase().replace(/[._]/g, '');

const mirrored = (id: string, bones: readonly string[], hp: number): PlateSpec[] =>
  (['l', 'r'] as const).map(s => ({ id: `${id}.${s}`, bones: bones.map(b => `${b}.${s}`), hp }));

/** The juggernaut's suit (juggernaut-kit.wam). HP against the soldier's own
 *  regional thresholds (soldier-damage.ts): the cuirass alone soaks ~2.5
 *  single-barrel volleys that all land before the torso takes a point. */
export const JUGGERNAUT_ARMOR: ArmorSpec = {
  plates: [
    { id: 'helmet', bones: ['skull', 'neck'], hp: 8 },
    { id: 'cuirass', bones: ['chest', 'spine2', 'spine1'], hp: 20 },
    ...mirrored('upperarm', ['clavicle', 'upperarm'], 8),
    ...mirrored('forearm', ['forearm', 'hand'], 6),
    ...mirrored('thigh', ['thigh'], 8),
    ...mirrored('shin', ['shin', 'foot'], 6),
  ],
  blastPlateDamage: 10,
};

/** The warbull's MACHINERY (the reference plate's: the launcher prop, the
 *  kit's belt, braces and shod hoof), spec 2026-09-27-warbull-design.md
 *  "Damage". Only the LAUNCHER is a plate: it is the one piece of metal that
 *  is a target in its own right, and shooting it off is the DISARM (profile
 *  armor.disarmPlate): the prop drops, the ranged mode ends. Bone-only (the
 *  whole right forearm and fist are casing). 14: a focused double volley
 *  and change, deliberately reachable. The cable belt and the braces are
 *  thin metal round flesh: rounds wound through them. (Region plates,
 *  PlateSpec.region, remain for metal embedded in flesh that shares a bone.) */
export const WARBULL_ARMOR: ArmorSpec = {
  plates: [
    { id: 'launcher', bones: ['forearm.r', 'hand.r'], hp: 14 },
  ],
  blastPlateDamage: 10,
};

export function freshPlates(spec: ArmorSpec): PlateState {
  return Object.fromEntries(spec.plates.map(p => [p.id, p.hp]));
}

const covers = (p: PlateSpec, k: string) => p.bones.some(b => plateKey(b) === k);
const inRegion = (p: PlateSpec, local?: readonly number[]) => !p.region || (!!local
  && Math.hypot(local[0]! - p.region.center[0], local[1]! - p.region.center[1], local[2]! - p.region.center[2]) <= p.region.radius);

/** The plate covering `bone` (either spelling) at body-local `local`, or
 *  null for bare flesh. Region plates need `local`. */
export function plateFor(spec: ArmorSpec, bone: string | undefined, local?: readonly number[]): PlateSpec | null {
  if (!bone) return null;
  const k = plateKey(bone);
  return spec.plates.find(p => covers(p, k) && inRegion(p, local)) ?? null;
}

/** True when the KIT island skinned to `bone` goes with a shed plate
 *  (kit-damage.ts plate mode): its plate's kitBones, else its bones. */
export function kitShedFor(spec: ArmorSpec, shed: ReadonlySet<string>, bone: string): boolean {
  const k = plateKey(bone);
  return spec.plates.some(p => shed.has(p.id) && (p.kitBones ?? p.bones).some(b => plateKey(b) === k));
}

export function isShed(state: PlateState, id: string): boolean {
  return (state[id] ?? 0) <= 0;
}

export function shedPlates(state: PlateState): Set<string> {
  return new Set(Object.keys(state).filter(id => isShed(state, id)));
}

export interface PlateHit {
  state: PlateState;
  /** The plate the round met, or null (bare flesh, or already shed). */
  plate: string | null;
  /** True: the plate stopped it. Stamp no wound, record no injury. */
  absorbed: boolean;
  /** True: this hit took the plate to zero. */
  shed: boolean;
}

/** One ROUND (pellet or slug) lands on `bone`, at body-local `local` (needed
 *  by region plates). The hit that breaks a plate is still absorbed by it;
 *  the next one reaches the flesh. */
export function hitPlate(spec: ArmorSpec, state: PlateState, bone: string | undefined, points: number, local?: readonly number[]): PlateHit {
  const plate = plateFor(spec, bone, local);
  if (!plate || isShed(state, plate.id)) return { state, plate: null, absorbed: false, shed: false };
  const hp = (state[plate.id] ?? 0) - points;
  return { state: { ...state, [plate.id]: hp }, plate: plate.id, absorbed: true, shed: hp <= 0 };
}

/** One EXPLOSION wounds the bones listed: every intact plate among them loses
 *  blastPlateDamage ONCE (a 16-wound bundle is one blast, not sixteen). Never
 *  absorbs: the wounds stamp regardless. A blast is judged by bone alone, so
 *  it cracks every plate covering a wounded bone, region plates included. */
export function blastPlates(spec: ArmorSpec, state: PlateState, bones: readonly (string | undefined)[]): { state: PlateState; hit: string[]; shed: string[] } {
  const ids = new Set<string>();
  for (const b of bones) {
    if (!b) continue;
    const k = plateKey(b);
    for (const p of spec.plates) if (covers(p, k) && !isShed(state, p.id)) ids.add(p.id);
  }
  const next: Record<string, number> = { ...state };
  const shed: string[] = [];
  for (const id of ids) {
    next[id] = (next[id] ?? 0) - spec.blastPlateDamage;
    if (next[id]! <= 0) shed.push(id);
  }
  return { state: next, hit: [...ids], shed };
}

type V3 = readonly [number, number, number] | readonly number[];
/**
 * A world hit carried back to the REST body, for region plates: de-yaw it
 * (and the posed prim) about his root, then re-seat it on the rest prim at
 * the same fraction along the prim's segment and the same radial offset,
 * rotated by the arc from the posed axis to the rest axis. Exact for a prim
 * that only moved rigidly; for region matching (spheres 15-30 cm across) the
 * residual of a bending pose is well inside the radius. Pure vector maths.
 */
export function restHitPoint(
  hit: V3, root: V3, bodyYaw: number,
  posed: { a: V3; b: V3; orient?: readonly number[] }, rest: { a: V3; b: V3 },
): [number, number, number] {
  // A RIGID prim (the head's, rig-bind.ts applyRig) carries its full world
  // rotation from rest: undo it exactly, no segment approximation (the head
  // nods ~28 degrees on the gaze, and a sphere has no segment to measure).
  if (posed.orient) {
    const [qx, qy, qz, qw] = posed.orient as [number, number, number, number];
    const v = [hit[0]! - posed.a[0]!, hit[1]! - posed.a[1]!, hit[2]! - posed.a[2]!];
    // conj(q) * v: t = 2 * cross(-q.xyz, v); v' = v + w t + cross(-q.xyz, t)
    const ux = -qx, uy = -qy, uz = -qz;
    const tx = 2 * (uy * v[2]! - uz * v[1]!), ty = 2 * (uz * v[0]! - ux * v[2]!), tz = 2 * (ux * v[1]! - uy * v[0]!);
    return [
      rest.a[0]! + v[0]! + qw * tx + (uy * tz - uz * ty),
      rest.a[1]! + v[1]! + qw * ty + (uz * tx - ux * tz),
      rest.a[2]! + v[2]! + qw * tz + (ux * ty - uy * tx),
    ];
  }
  const c = Math.cos(-bodyYaw), s = Math.sin(-bodyYaw);
  // rotateYaw (gait.ts): x' = x cos + z sin, z' = -x sin + z cos.
  const unyaw = (p: V3): [number, number, number] => {
    const x = p[0]! - root[0]!, z = p[2]! - root[2]!;
    return [x * c + z * s, p[1]! - root[1]!, -x * s + z * c];
  };
  const sub = (p: V3, q: V3): [number, number, number] => [p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!];
  const dot = (p: V3, q: V3) => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
  const h = unyaw(hit), a = unyaw(posed.a), b = unyaw(posed.b);
  const ab = sub(b, a), rab = sub(rest.b, rest.a);
  const L2 = dot(ab, ab);
  const t = L2 > 1e-12 ? dot(sub(h, a), ab) / L2 : 0;
  const on: [number, number, number] = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  const r = sub(h, on);
  // Shortest-arc rotation posed axis -> rest axis (Rodrigues).
  const n = (v: V3): [number, number, number] => { const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return [v[0]! / l, v[1]! / l, v[2]! / l]; };
  const u = n(ab), w = n(rab);
  const k: [number, number, number] = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const sn = Math.hypot(...k), cs = dot(u, w);
  let rr: [number, number, number] = [r[0], r[1], r[2]];
  if (L2 > 1e-12 && sn > 1e-9) {
    const kk = [k[0] / sn, k[1] / sn, k[2] / sn] as const;
    const kxr: [number, number, number] = [kk[1] * r[2] - kk[2] * r[1], kk[2] * r[0] - kk[0] * r[2], kk[0] * r[1] - kk[1] * r[0]];
    const kr = dot(kk, r);
    rr = [0, 1, 2].map(i => r[i]! * cs + kxr[i]! * sn + kk[i]! * kr * (1 - cs)) as [number, number, number];
  }
  const base = [rest.a[0]! + rab[0] * t, rest.a[1]! + rab[1] * t, rest.a[2]! + rab[2] * t];
  return [base[0]! + rr[0], base[1]! + rr[1], base[2]! + rr[2]];
}
