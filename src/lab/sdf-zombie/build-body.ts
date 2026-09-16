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

/**
 * COLD-START BODY-BUILD MEMO (2026-09-16 playtest follow-ups, task 1).
 *
 * WHY. `buildBody` is deterministic in `(def, opts, override)`, but the game
 * called the whole build pipeline once PER ACTOR: `spawnAll` spawns 23 bodies
 * and every one paid bone derivation plus the containment checks
 * (`boneBreach` per derived bone and `validateBody`'s whole-body scans), which
 * is CPU-bound SDF evaluation. Measured 26 ms per zombie and 43 ms per
 * soldier, i.e. ~0.67 s of the boot's `room-probes-start -> player-start`
 * block; the caller-side compile/face parse on top of it made the block
 * ~0.86 s. The boot CPU profile's top self-time was `validate.ts`'s `sdBody`
 * / `sdPrimitive` / `boneBreach`, not module loading.
 *
 * WHAT IT IS. A signature-keyed memo around an explicit builder closure. The
 * caller owns the key (it knows which inputs actually change the result) and
 * the builder (it knows how to derive the body). A hit returns the SAME
 * untranslated `BuildResult`; callers that need a per-actor body translate it,
 * which copies every mutable array (translate.ts), so the cached value is
 * never handed out as a mutable actor body.
 *
 * INVALIDATION. The key is the cache's whole contract: whoever changes an
 * input that can change `buildBody`'s output MUST fold that input into the key
 * (the character identity + compiled face + bone ratio + override signature
 * today). There is no time- or revision-based expiry because a page load
 * rebuilds the registry and this cache with it; a body that would change
 * because its `.blob`/anatomy changed gets a different key by construction.
 *
 * OWNERSHIP. Entries hold CPU-only structures (`prims`, `clusters`, `bones`,
 * `bonePrims`, `errors`); they carry no GPU resources, so there is nothing to
 * dispose per entry. `clear()` drops every reference for a hard reset.
 */
export interface BodyBuildCacheStats {
  entries: number;
  hits: number;
  misses: number;
  buildMs: number;
}

export class BodyBuildCache<T> {
  readonly #map = new Map<string, T>();
  #hits = 0;
  #misses = 0;
  #buildMs = 0;
  /** Return the cached value for `key`, or build it once and memoize it. */
  get(key: string, build: () => T): T {
    const hit = this.#map.get(key);
    if (hit !== undefined) { this.#hits++; return hit; }
    const t0 = performance.now();
    const built = build();
    this.#buildMs += performance.now() - t0;
    this.#misses++;
    this.#map.set(key, built);
    return built;
  }
  /** Cumulative diagnostics; never resets on its own. */
  stats(): BodyBuildCacheStats {
    return {
      entries: this.#map.size,
      hits: this.#hits,
      misses: this.#misses,
      buildMs: Math.round(this.#buildMs * 100) / 100,
    };
  }
  clear(): void { this.#map.clear(); }
}

export function buildBody(
  def: BodyDef,
  opts: BuildOpts = DEFAULT_BUILD_OPTS,
  override: BodyOverride = {},
): BuildResult {
  // Authored bones (wound pass r2, task 4b) ride the SAME mirror expansion as
  // flesh, so one authored line on a mirrored bone yields both sides — the
  // whole point of reusing the body grammar. The concatenation below is a
  // temporary for EXPANSION ONLY: the prims are split apart again right after
  // (compiled bone defs carry op:'bone') and an authored bone never reaches
  // the built `prims` array.
  const authored = def.bonePrims ?? [];
  const expanded = expandMirror(
    authored.length === 0 ? def : { ...def, prims: [...def.prims, ...authored] });
  // Organs (organs r3) ride the authored array beside bone — the split is
  // "inside the flesh", not "bone specifically", so the split key is the
  // same one that keeps them out of the CPU field: everything with a wound-
  // pass op goes to the bonePrims path, everything else stays flesh.
  const isInside = (p: { op?: string }) => p.op === 'bone' || p.op === 'organ';
  const authoredDefs = expanded.prims.filter(isInside);
  const fleshDefs = expanded.prims.filter(p => !isInside(p));
  const bones = resolveBones(expanded.bones, expanded.root);
  const placed = placePrims(fleshDefs, bones);
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
  // cavity. Auto-derivation must never break the field identity.
  const ratio = def.boneRatio ?? DEFAULT_BONE_RATIO;
  // Authored bones win PER BONE: an authored skull must not cost the author
  // every auto-derived limb bone, and an authored line on `thigh` must not
  // coexist with a derived one on `thigh` (two bones on one bone is the
  // neither-shape). The set holds CONCRETE post-expansion names ('thigh.l'),
  // matching what derivation filters. Derivation output stays
  // CONTAINMENT-FILTERED (dropped, not reported — it is a heuristic's guess);
  // AUTHORED bones are NOT filtered: an author's explicit claim that breaches
  // is a fact to report, so validateBody's containment check surfaces it as a
  // build error instead of buildBody silently second-guessing the author.
  const authoredBones = new Set(authoredDefs.map(p => p.bone));
  const toBone = (p: Omit<Primitive, 'cluster'>): Primitive => ({ ...p, cluster: CLUSTER_ORDER.indexOf(p.limb) });
  const bonePrims: Primitive[] = [
    ...placePrims(authoredDefs, bones).map(toBone),
    ...placePrims(deriveBones(fleshDefs.filter(p => !authoredBones.has(p.bone)), ratio), bones)
      .map(toBone)
      .filter(b => boneBreach({ prims, clusters }, b) === null),
  ];

  const body = { prims, clusters, bonePrims };
  return { ...body, bones, errors: validateBody(body, opts) };
}
