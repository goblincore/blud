// src/lab/sdf-zombie/build-body.ts
import type { BodyDef, BuiltBody } from './types';
import { expandMirror } from './mirror';
import { placePrims, resolveBones } from './resolve';
import { assignClusters } from './clusters';
import { validateBody, type ValidateOpts } from './validate';

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

  const body = { prims, clusters };
  return { ...body, bones, errors: validateBody(body, opts) };
}
