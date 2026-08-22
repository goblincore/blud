// src/lab/sdf-zombie/resolve.ts
import type { BoneDef, LimbId, Primitive, ResolvedBone, Vec3 } from './types';
import type { ExpandedPrim } from './mirror';
import { add, bendCtrl, lerp, normalize, scale } from './vec';

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
    // A collinear control point IS the straight primitive — mathematically.
    // Drop it here rather than routing it through the Bezier path, which is
    // identical but NOT bit-identical, exactly why untapered prims keep the
    // plain capsule branch. 0.1 um of deviation is far below anything an
    // author means by "straight" and well above f64 noise.
    let bend = p.bend;
    if (bend !== undefined) {
      const abLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (abLen < 1e-9) {
        bend = undefined;
      } else {
        const ctrl = bendCtrl(a, b, bend);
        const cx = ctrl[0] - a[0], cy = ctrl[1] - a[1], cz = ctrl[2] - a[2];
        const ux = (b[0] - a[0]) / abLen, uy = (b[1] - a[1]) / abLen, uz = (b[2] - a[2]) / abLen;
        const px = cy * uz - cz * uy, py = cz * ux - cx * uz, pz = cx * uy - cy * ux;
        if (Math.hypot(px, py, pz) < 1e-7) bend = undefined;
      }
    }
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
      // The bend is MID-RELATIVE, so it needs no resolving here — it is
      // defined against the midpoint of a/b wherever they end up, which is
      // what lets rigging and translation move the prim without touching it.
      // Degenerate (collinear/zero) bends are dropped above.
      ...(bend === undefined ? {} : { bend }),
      // Paint rides through untouched: it is a property of the primitive,
      // not of where the rig put it.
      ...(p.color === undefined ? {} : { color: p.color }),
      ...(p.gloss === undefined ? {} : { gloss: p.gloss }),
      ...(p.core ? { core: true } : {}),
    };
  });
}
