// src/lab/sdf-zombie/resolve.ts
import type { BoneDef, LimbId, Primitive, ResolvedBone, Vec3 } from './types';
import type { ExpandedPrim } from './mirror';
import { add, lerp, normalize, scale } from './vec';

/**
 * Walks the bone tree, converting relative (parent + dir + length + side)
 * placement into concrete world-space head/tail pairs.
 */
export function resolveBones(bones: BoneDef[], root: Vec3): Map<string, ResolvedBone> {
  const byName = new Map(bones.map(b => [b.name, b]));
  const out = new Map<string, ResolvedBone>();

  for (const b of bones)
    if (b.parent !== null && !byName.has(b.parent))
      throw new Error(`bone "${b.name}" has unknown parent "${b.parent}"`);

  // Iterate to a fixed point; each pass resolves any bone whose parent is known.
  let remaining = bones.slice();
  while (remaining.length > 0) {
    const next: BoneDef[] = [];
    for (const b of remaining) {
      const parentTail = b.parent === null ? root : out.get(b.parent)?.tail;
      if (parentTail === undefined) { next.push(b); continue; }
      const head: Vec3 = [parentTail[0] + (b.side ?? 0), parentTail[1], parentTail[2]];
      out.set(b.name, { head, tail: add(head, scale(normalize(b.dir), b.length)) });
    }
    if (next.length === remaining.length)
      throw new Error(`unresolved bones (cycle?): ${next.map(b => b.name).join(', ')}`);
    remaining = next;
  }
  return out;
}

/** Places each primitive at its normalised position along its resolved bone. */
export function placePrims(
  prims: ExpandedPrim[],
  bones: Map<string, ResolvedBone>,
): Omit<Primitive, 'cluster'>[] {
  return prims.map(p => {
    const bone = bones.get(p.bone);
    if (!bone) throw new Error(`prim references unknown bone "${p.bone}"`);
    const o = p.offset ?? ([0, 0, 0] as const);
    const shift = (v: Vec3): Vec3 => [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
    const a = shift(lerp(bone.head, bone.tail, p.at));
    const b0 = p.capTo === undefined ? a : shift(lerp(bone.head, bone.tail, p.capTo));
    // `tip` displaces the FAR end alone, which is what lets a primitive point
    // somewhere its bone does not — a nose out of a vertical skull, a tusk out
    // of a jaw. Applied after `offset`, which moved both ends together.
    const t = p.tip;
    const b: Vec3 = t === undefined ? b0 : [b0[0] + t[0], b0[1] + t[1], b0[2] + t[2]];
    return {
      a, b,
      radius: p.radius,
      ...(p.radiusB === undefined ? {} : { radiusB: p.radiusB }),
      scale: p.scale,
      blendK: p.blendK,
      ...(p.blendProfile === undefined || p.blendProfile === 'round'
        ? {} : { blendProfile: p.blendProfile }),
      limb: p.limb as LimbId,
      op: p.op ?? 'add',
    };
  });
}
