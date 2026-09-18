// src/lab/sdf-zombie/webgpu/game-state-panels.ts
//
// PANELS slice of the GameContext decomposition. The nine bindings that used
// to live in `main()`'s closure as `let` declarations: the five dev tuning
// panels (goo, wound, dynamite, vhs, shutter) plus the visibility flag that
// hides them all at once, and the impact-splash layer with its own enable
// flag and the shutter game layer.
//
// Types are imported, never redeclared, so the panel classes and the state
// object can never drift. `import type` keeps this module free of runtime
// imports — it is a plain data shape with a factory.

import type { GooPanel } from './goo-panel';
import type { WoundPanel } from './wound-panel';
import type { DynamitePanel } from './dynamite-panel';
import type { VhsPanel } from './vhs-panel';
import type { ImpactSplashLayer } from './impact-splash';
import type { ShutterGameLayer } from './shutter-game-layer';
import type { ShutterPanel } from './shutter-panel';

export interface PanelsState {
  /** The goo tuning panel (goo-panel.ts). Created during init. */
  gooPanel: GooPanel | null;
  /** The wound panel (wound-panel.ts). Ships VISIBLE but COLLAPSED. */
  woundPanel: WoundPanel | null;
  /** The DYNAMITE / GIB panel (dynamite-panel.ts). Ships VISIBLE but COLLAPSED. */
  dynamitePanel: DynamitePanel | null;
  /** The VHS tuning panel (vhs-panel.ts). */
  vhsPanel: VhsPanel | null;
  /** True while every dev panel is hidden by the visibility hotkey. */
  hidden: boolean;
  /** Supplementary procedural impact crown; off unless `?impactsplash=1`. */
  impactSplashEnabled: boolean;
  /** Lazily created on first use by `ensureImpactSplashLayer`. */
  impactSplashLayer: ImpactSplashLayer | null;
  /** Selective shutter blur layer over the blood goo. */
  shutterGame: ShutterGameLayer | null;
  /** The shutter blur tuning panel (shutter-panel.ts). */
  shutterPanel: ShutterPanel | null;
}

/** Fresh panels state. All nine initializers in `main()` are literals, so the
 *  declared literals ARE the defaults — no placeholder stands in for a
 *  computed value. Never share arrays or objects between calls. */
export function makePanelsState(): PanelsState {
  return {
    gooPanel: null,
    woundPanel: null,
    dynamitePanel: null,
    vhsPanel: null,
    hidden: false,
    impactSplashEnabled: false,
    impactSplashLayer: null,
    shutterGame: null,
    shutterPanel: null,
  };
}

/** Old closure binding name -> `panels.<field>` path, for the codemod that
 *  rewrites `main()` to read and write through the GameContext. */
export const PANELS_BINDINGS = {
  gooPanel: 'panels.gooPanel',
  woundPanel: 'panels.woundPanel',
  dynamitePanel: 'panels.dynamitePanel',
  vhsPanel: 'panels.vhsPanel',
  panelsHidden: 'panels.hidden',
  impactSplashEnabled: 'panels.impactSplashEnabled',
  impactSplashLayer: 'panels.impactSplashLayer',
  shutterGame: 'panels.shutterGame',
  shutterPanel: 'panels.shutterPanel',
} as const;
