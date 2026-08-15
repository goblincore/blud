// src/lab/sdf-zombie/mirror.ts
import type { BodyDef, BoneDef, LimbBase, LimbId, PrimDef } from './types';

/** A prim after mirror expansion: bone name is concrete, limb is a concrete cluster. */
export interface ExpandedPrim extends Omit<PrimDef, 'limb' | 'mirror'> {
  limb: LimbId;
}

export interface ExpandedBody {
  name: string;
  root: BodyDef['root'];
  bones: BoneDef[];
  prims: ExpandedPrim[];
}

function limbFor(base: LimbBase, side: 'l' | 'r' | null): LimbId {
  if (base === 'head') return 'head';
  if (base === 'torso') return 'torso';
  if (side === null) throw new Error(`limb "${base}" requires a mirrored prim (got no side)`);
  return (base === 'arm' ? (side === 'l' ? 'armL' : 'armR') : side === 'l' ? 'legL' : 'legR');
}

export function expandMirror(def: BodyDef): ExpandedBody {
  const bones: BoneDef[] = [];
  const mirroredBoneNames = new Set<string>();
  /** Which side each emitted bone came out on; null for bones that were not mirrored. */
  const sideOf = new Map<BoneDef, 'l' | 'r' | null>();

  for (const b of def.bones) {
    if (!b.mirror) {
      const kept = { ...b };
      bones.push(kept);
      sideOf.set(kept, null);
      continue;
    }
    mirroredBoneNames.add(b.name);
    const side = b.side ?? 0;
    const l: BoneDef = { ...b, name: `${b.name}.l`, side, mirror: false };
    // The right copy mirrors in x — both the side offset AND the direction.
    // Negating only `side` leaves a `dir` with a nonzero x component (the
    // zombie's clavicle is `dir: [1,0,0]`) pointing the same way on both sides,
    // so both limbs land on the left of the body.
    const r: BoneDef = {
      ...b, name: `${b.name}.r`, side: -side, mirror: false,
      dir: [-b.dir[0], b.dir[1], b.dir[2]],
    };
    bones.push(l, r);
    sideOf.set(l, 'l');
    sideOf.set(r, 'r');
  }

  // A mirrored bone's parent may itself be mirrored — retarget to the same side.
  // The side comes from how this bone was expanded, not from its name: a bone
  // that was never mirrored has no side, and guessing one would silently hang it
  // off the left half of a bilateral pair.
  for (const b of bones) {
    if (!b.parent || !mirroredBoneNames.has(b.parent)) continue;
    const side = sideOf.get(b) ?? null;
    if (side === null)
      throw new Error(
        `bone "${b.name}" has mirrored parent "${b.parent}" but is not itself mirrored — ambiguous side`,
      );
    b.parent = `${b.parent}.${side}`;
  }

  const prims: ExpandedPrim[] = [];
  for (const p of def.prims) {
    const { mirror, limb, ...rest } = p;
    if (!mirror) { prims.push({ ...rest, limb: limbFor(limb, null) }); continue; }
    if (!mirroredBoneNames.has(p.bone))
      throw new Error(`mirrored prim references non-mirrored bone "${p.bone}"`);
    prims.push({ ...rest, bone: `${p.bone}.l`, limb: limbFor(limb, 'l') });
    prims.push({ ...rest, bone: `${p.bone}.r`, limb: limbFor(limb, 'r') });
  }

  return { name: def.name, root: def.root, bones, prims };
}
