// src/lab/sdf-zombie/webgpu/game-state-goo.ts
//
// GOO slice of the game-main `GameContext` decomposition. State only: the
// layer handle, the on/off and reconstruction toggles, the strand/sheet/
// connection candidates, and the body view the goo rig borrows its light
// uniform NODES from.
//
// The field names drop the redundant `goo` prefix; `GOO_BINDINGS` is the
// codemod's old-name -> `goo.<field>` map and covers exactly the seven
// bindings AST analysis assigned to this slice. Plain mutable fields only —
// no getters, setters, readonly or freezing, because those change evaluation
// timing and the pixel gate is sensitive to it.

import type { GooLayer, GooReconstruction } from './goo-layer';
import type { ZombieGpuView } from './zombie-gpu';

export interface GooState {
  /** The screen-space metaball layer, or null before the actors give it a rig. */
  layer: GooLayer | null;
  /** Master on/off. Ships on; `setGoo(false)` is the kill switch. */
  enabled: boolean;
  /** Which goo reconstruction to run — smooth is the game default. */
  reconstruction: GooReconstruction;
  /** Tapered strand connections between droplets (opt-in). */
  connectionsEnabled: boolean;
  /** Strands (tapered strands) candidate; on by default. */
  strandsEnabled: boolean;
  /** Experimental stream-grid sheets (opt-in, OFF by default). */
  sheetsEnabled: boolean;
  /** First actor's view, whose light uniform nodes the goo layer shares.
   *  Undefined until an actor exists. */
  rigView: ZombieGpuView | undefined;
}

export function makeGooState(): GooState {
  return {
    layer: null,
    enabled: true,
    reconstruction: 'smooth',
    connectionsEnabled: false,
    strandsEnabled: true,
    sheetsEnabled: false,
    rigView: undefined,
  };
}

export const GOO_BINDINGS = {
  gooLayer: 'goo.layer',
  gooEnabled: 'goo.enabled',
  gooReconstruction: 'goo.reconstruction',
  gooConnectionsEnabled: 'goo.connectionsEnabled',
  gooStrandsEnabled: 'goo.strandsEnabled',
  gooSheetsEnabled: 'goo.sheetsEnabled',
  gooRigView: 'goo.rigView',
} as const;
