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

  for (const b of def.bones) {
    if (!b.mirror) { bones.push({ ...b }); continue; }
    mirroredBoneNames.add(b.name);
    const side = b.side ?? 0;
    bones.push({ ...b, name: `${b.name}.l`, side, mirror: false });
    bones.push({ ...b, name: `${b.name}.r`, side: -side, mirror: false });
  }

  // A mirrored bone's parent may itself be mirrored — retarget to the same side.
  for (const b of bones) {
    if (b.parent && mirroredBoneNames.has(b.parent)) {
      const suffix = b.name.endsWith('.r') ? '.r' : '.l';
      b.parent = `${b.parent}${suffix}`;
    }
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
