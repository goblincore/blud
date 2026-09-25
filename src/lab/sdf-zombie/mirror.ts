// src/lab/sdf-zombie/mirror.ts
import type { BodyDef, BoneDef, LimbBase, LimbId, PrimDef } from './types';

/** A prim after mirror expansion: bone name is concrete, limb is a concrete cluster. */
export interface ExpandedPrim extends Omit<PrimDef, 'limb' | 'mirror' | 'mirrorOffset'> {
  limb: LimbId;
  /**
   * Set on BOTH copies a mirrored line produced, under either mirror mode.
   *
   * The `mirror`/`mirrorOffset` inputs are consumed here, so this is the only
   * place that still knows a pair came from one authored number — and a
   * downstream consumer that writes a measurement BACK to that number needs to
   * know, because the x components below are negated on the second copy. See
   * Primitive.mirrored.
   */
  mirrored?: boolean;
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

  for (const src of def.bones) {
    const { lengthR, ...b } = src;
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
      // Asymmetric pair (`lenR=`): only the right copy takes the other length.
      length: lengthR ?? b.length,
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
    const { mirror, mirrorOffset, limb, ...rest } = p;

    if (mirror && mirrorOffset)
      throw new Error(`prim on bone "${p.bone}" sets both mirror and mirrorOffset`);

    // SINGLE-SIDED (`side=l|r`): ONE copy, retargeted onto that side of the
    // mirrored pair. The bone must be mirrored — a side of a pair that does
    // not exist is a typo, and silently placing it unmirrored would author a
    // centreline prim. Not flagged `mirrored`: one authored number placed
    // once, nothing x-negated, so a downstream fit may write back freely.
    if (p.side) {
      if (mirror || mirrorOffset)
        throw new Error(`prim on bone "${p.bone}" sets side=${p.side}; mirror/both already decide sides`);
      if (!mirroredBoneNames.has(p.bone))
        throw new Error(`prim on bone "${p.bone}" sets side=${p.side} but "${p.bone}" is not a mirrored bone`);
      prims.push({ ...rest, bone: `${p.bone}.${p.side}`, limb: limbFor(limb, p.side) });
      continue;
    }

    // Bilateral by OFFSET: one bone, two prims either side of its axis. This is
    // how a face gets two eye sockets — `skull` is not a mirrored bone, so
    // `mirror: true` would throw on it.
    if (mirrorOffset) {
      const o = rest.offset ?? ([0, 0, 0] as const);
      const side = limbFor(limb, null);
      // `tip` mirrors in x with `offset`, not independently of it. A pair of
      // tusks reflected only at the base would both lean the same way — the
      // right one splaying inward across the face — which is the exact bug
      // this whole `both` path exists to avoid for offsets.
      const t = rest.tip;
      const flipT = t === undefined ? undefined : ([-t[0], t[1], t[2]] as const);
      // The bend mirrors in x alongside offset and tip. A control point that
      // hooks one ear's horn outward would hook its twin INWARD across the
      // skull if only the endpoints reflected — same failure the tip flip
      // exists for, arriving through the curve instead of the endpoint.
      const bn = rest.bend;
      const flipB = bn === undefined ? undefined : ([-bn[0], bn[1], bn[2]] as const);
      // A bilateral SHELL's clip plane flips with it. The cloth edge normals to
      // the mirror axis, so a clip that cuts one collar point's hem cuts its
      // twin's hem only if the plane's x component reflects.
      const cn = rest.shell?.clipNormal;
      const flipC = cn === undefined
        ? undefined
        : { ...rest.shell!, clipNormal: [-cn[0], cn[1], cn[2]] as const };
      // Only the SECOND copy reflects — the first keeps what the author wrote,
      // exactly as `offset` and `tip` do above. Applying the flip to both
      // copies negates the authored side too, so a horn pair curves the same
      // way AND neither one curves the way the .blob asked for.
      prims.push({ ...rest, offset: [o[0], o[1], o[2]], limb: side, mirrored: true });
      prims.push({ ...rest, offset: [-o[0], o[1], o[2]], ...(flipT ? { tip: flipT } : {}), ...(flipB ? { bend: flipB } : {}), ...(flipC ? { shell: flipC } : {}), limb: side, mirrored: true });
      continue;
    }

    if (!mirror) { prims.push({ ...rest, limb: limbFor(limb, null) }); continue; }
    if (!mirroredBoneNames.has(p.bone))
      throw new Error(`mirrored prim references non-mirrored bone "${p.bone}"`);
    prims.push({ ...rest, bone: `${p.bone}.l`, limb: limbFor(limb, 'l'), mirrored: true });
    // The `.r` copy reflects its offset, tip and bend in x, exactly as the
    // second copy of a `both` pair does above. It did not, for as long as no
    // mirrored prim carried an x component: the mouse's finger bones exist
    // because a finger fan authored as tipped bars on the hand bone put the
    // right hand's index finger pointing INWARD across the chest, and the
    // SDF shoes — three prims offset outward from each foot bone — put the
    // right shoe on the centreline. A mirrored bone sits at -side; anything
    // authored relative to it in x has to reflect with it.
    const o = rest.offset, t = rest.tip, bn = rest.bend;
    const cn = rest.shell?.clipNormal;
    prims.push({
      ...rest, bone: `${p.bone}.r`, limb: limbFor(limb, 'r'), mirrored: true,
      ...(o ? { offset: [-o[0], o[1], o[2]] as const } : {}),
      ...(t ? { tip: [-t[0], t[1], t[2]] as const } : {}),
      ...(bn ? { bend: [-bn[0], bn[1], bn[2]] as const } : {}),
      ...(cn ? { shell: { ...rest.shell!, clipNormal: [-cn[0], cn[1], cn[2]] as const } } : {}),
    });
  }

  return { name: def.name, root: def.root, bones, prims };
}
