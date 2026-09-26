// src/lab/sdf-zombie/webgpu/game-state-crowd.ts
//
// CROWD slice of the GameContext decomposition — the merged crowd-march stage
// state: the `?crowd` / `?crowddispatch` boot seams, the per-type registries
// (types, their source views and the volume-bound set) and the two
// warn-once flags. The per-frame march itself lives elsewhere; this module is
// only the state those functions close over.
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js/WebGPU dependency. Fields are
// plain and mutable — no getters, setters, `readonly` or `Object.freeze` —
// because the codemod moves the original assignments onto these fields and an
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (URL reads, `new Map`/`new Set`) get a type-correct
// placeholder in the factory; the codemod supplies the real value at the
// binding's original line. Every call still hands out fresh containers.

import type { CrowdDispatch, CrowdType } from './crowd-type';
import type { ZombieGpuView } from './zombie-gpu';

export interface CrowdState {
  /** Raw `?crowd` value; `'0'` opts out to the per-body path. */
  param: string | null;
  /** `?crowddispatch=quad` selects the one-screen-quad dispatch; boxes otherwise. */
  dispatch: CrowdDispatch;
  /** True while the merged crowd march is the shipped path (`?crowd=0` disables). */
  on: boolean;
  /** Why the boot fell back to per-body, or null when the crowd march survived. */
  fallbackReason: string | null;
  /** One `CrowdType` per character registry name; lazily created on first spawn. */
  types: Map<string, CrowdType>;
  /** The first attached view per type — the source of per-type uniform values. */
  sourceView: Map<CrowdType, ZombieGpuView>;
  /** Each attached view's type (the crowd key for its nearest-to-the-player body). */
  typeOfView: WeakMap<ZombieGpuView, CrowdType>;
  /** Types whose shared segVolume atlas/meta were bound from the first actor. */
  volumeBound: Set<CrowdType>;
  /** True once the missing-seg-meta warning has been logged, so it is logged once. */
  segMetaWarned: boolean;
  /** True once the unsupported-refine warning has been logged, so it is logged once. */
  refineWarned: boolean;
}

/** Every call returns a fresh object, maps and set included. */
export function makeCrowdState(): CrowdState {
  return {
    param: null,
    dispatch: 'boxes',
    on: false,
    fallbackReason: null,
    types: new Map<string, CrowdType>(),
    sourceView: new Map<CrowdType, ZombieGpuView>(),
    typeOfView: new WeakMap<ZombieGpuView, CrowdType>(),
    volumeBound: new Set<CrowdType>(),
    segMetaWarned: false,
    refineWarned: false,
  };
}

/** Old `game-main.ts` binding name → path on the `crowd` slice. */
export const CROWD_BINDINGS = {
  crowdParam: 'crowd.param',
  crowdDispatch: 'crowd.dispatch',
  crowdOn: 'crowd.on',
  crowdFallbackReason: 'crowd.fallbackReason',
  crowdTypes: 'crowd.types',
  crowdSourceView: 'crowd.sourceView',
  crowdTypeOfView: 'crowd.typeOfView',
  crowdVolumeBound: 'crowd.volumeBound',
  crowdSegMetaWarned: 'crowd.segMetaWarned',
  crowdRefineWarned: 'crowd.refineWarned',
} as const;
