// src/lab/sdf-zombie/build-body.ts
import type { BodyDef, BuiltBody, Primitive } from './types';
import { CLUSTER_ORDER } from './types';
import { expandMirror } from './mirror';
import { placePrims, resolveBones } from './resolve';
import { assignClusters } from './clusters';
import { validateBody, boneBreach, type ValidateOpts } from './validate';
import { deriveBones, DEFAULT_BONE_RATIO } from './bone-derive';
import type { FaceParams } from './face';

export interface BuildOpts extends ValidateOpts {}

export const DEFAULT_BUILD_OPTS: BuildOpts = {
  silhouetteNoiseAmp: 0.012,
  stepMultiplier: 0.6,
};

/**
 * Non-destructive override layer, keyed by built-primitive index. Written by
 * the tuning panel so slider work survives a reload without editing body.ts.
 */
export interface BodyOverride {
  primRadius?: Record<number, number>;
  primBlendK?: Record<number, number>;
  /**
   * Live face tuning. Merged over DEFAULT_FACE by the caller and passed to
   * `makeZombie`, not applied by buildBody — face params change which
   * primitives exist, so they must act before the body is built.
   */
  faceParams?: Partial<FaceParams>;
}

export interface BuildResult extends BuiltBody {
  /** Empty when the body passes every check. Never throws — the panel shows these. */
  errors: string[];
}

export function buildBody(
  def: BodyDef,
  opts: BuildOpts = DEFAULT_BUILD_OPTS,
  override: BodyOverride = {},
): BuildResult {
  const expanded = expandMirror(def);
  const bones = resolveBones(expanded.bones, expanded.root);
  const placed = placePrims(expanded.prims, bones);
  const { prims, clusters } = assignClusters(placed);

  // Overrides apply AFTER clustering, so indices are stable built-array indices.
  for (const [k, v] of Object.entries(override.primRadius ?? {}))
    if (prims[+k]) prims[+k] = { ...prims[+k]!, radius: v };
  for (const [k, v] of Object.entries(override.primBlendK ?? {}))
    if (prims[+k]) prims[+k] = { ...prims[+k]!, blendK: v };

  // BONE DERIVATION (wound pass r2). Bones live in their OWN array, never in
  // `prims`: ~20 modules walk prims and filter on op, and only four (rig-bind,
  // pack, sever, validate) should ever see bone — a separate array makes the
  // rest correct by construction. Derivation runs over the EXPANDED defs so a
  // mirrored flesh line yields both sides' bones; the results are resolved
  // through the SAME placePrims pass as flesh, so a bone is geometrically its
  // flesh source with a smaller radius (same endpoints, bend, taper), and
  // clustered from its concrete limb, matching the flesh cluster id.
  //
  // CONTAINMENT-FILTERED: the radius ratio is a heuristic, but "bone strictly
  // inside flesh" is a HARD premise — the shader's nearWound gate is only an
  // identity while it holds. An appendage prim (an ear, a hand ball) or a
  // flattened disc cannot host a contained bone at the default ratio, so its
  // derived bone is DROPPED rather than emitted to float in air inside a wound
  // cavity. Auto-derivation must never break the field identity; an AUTHORED
  // bone (task 4b) instead surfaces as a validateBody error, because an
  // author's explicit claim should be reported, not silently second-guessed.
  const ratio = def.boneRatio ?? DEFAULT_BONE_RATIO;
  const bonePlaced = placePrims(deriveBones(expanded.prims, ratio), bones);
  const bonePrims: Primitive[] = bonePlaced
    .map(p => ({ ...p, cluster: CLUSTER_ORDER.indexOf(p.limb) }))
    .filter(b => boneBreach({ prims, clusters }, b) === null);

  const body = { prims, clusters, bonePrims };
  return { ...body, bones, errors: validateBody(body, opts) };
}
