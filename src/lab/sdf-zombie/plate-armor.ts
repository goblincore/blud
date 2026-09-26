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

export function freshPlates(spec: ArmorSpec): PlateState {
  return Object.fromEntries(spec.plates.map(p => [p.id, p.hp]));
}

/** The plate covering `bone` (either spelling), or null for bare flesh. */
export function plateFor(spec: ArmorSpec, bone: string | undefined): PlateSpec | null {
  if (!bone) return null;
  const k = plateKey(bone);
  return spec.plates.find(p => p.bones.some(b => plateKey(b) === k)) ?? null;
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

/** One ROUND (pellet or slug) lands on `bone`. The hit that breaks a plate is
 *  still absorbed by it; the next one reaches the flesh. */
export function hitPlate(spec: ArmorSpec, state: PlateState, bone: string | undefined, points: number): PlateHit {
  const plate = plateFor(spec, bone);
  if (!plate || isShed(state, plate.id)) return { state, plate: null, absorbed: false, shed: false };
  const hp = (state[plate.id] ?? 0) - points;
  return { state: { ...state, [plate.id]: hp }, plate: plate.id, absorbed: true, shed: hp <= 0 };
}

/** One EXPLOSION wounds the bones listed: every intact plate among them loses
 *  blastPlateDamage ONCE (a 16-wound bundle is one blast, not sixteen). Never
 *  absorbs: the wounds stamp regardless. */
export function blastPlates(spec: ArmorSpec, state: PlateState, bones: readonly (string | undefined)[]): { state: PlateState; hit: string[]; shed: string[] } {
  const ids = new Set<string>();
  for (const b of bones) { const p = plateFor(spec, b); if (p && !isShed(state, p.id)) ids.add(p.id); }
  const next: Record<string, number> = { ...state };
  const shed: string[] = [];
  for (const id of ids) {
    next[id] = (next[id] ?? 0) - spec.blastPlateDamage;
    if (next[id]! <= 0) shed.push(id);
  }
  return { state: next, hit: [...ids], shed };
}
