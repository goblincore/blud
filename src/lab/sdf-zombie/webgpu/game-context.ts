// src/lab/sdf-zombie/webgpu/game-context.ts
//
// The state container for game-main.ts's main(). One PLAIN MUTABLE slice per
// concern — no getters, setters, proxies or freezing. `let x = 1; x = 2` must
// migrate to `ctx.s.x = 1; ctx.s.x = 2` and nothing subtler, because accessors
// would change evaluation timing and timing is exactly what the pixel gate
// catches.
//
// Slices are shaped as ECS-resources-to-be and `world` as component-storage-
// to-be, so the eventual ECS move is a refactor rather than a rewrite.
//
// Membership is decided by scripts/slice-extract.ts, not by hand:
//   npx tsx scripts/slice-extract.ts <slice>
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import { makeRenderState, type RenderState } from './game-state-render';
import { makeLightingState, type LightingState } from './game-state-lighting';
import { makeProbesState, type ProbesState } from './game-state-probes';
import { makeGibsState, type GibsState } from './game-state-gibs';
import { makeDynamiteState, type DynamiteState } from './game-state-dynamite';
import { makeWeaponState, type WeaponState } from './game-state-weapon';
import { makePlayerState, type PlayerState } from './game-state-player';
import { makeGooState, type GooState } from './game-state-goo';
import { makeCrowdState, type CrowdState } from './game-state-crowd';
import { makeBakeState, type BakeState } from './game-state-bake';
import { makeVfxState, type VfxState } from './game-state-vfx';
import { makeDemoState, type DemoState } from './game-state-demo';
import { makeTelemetryState, type TelemetryState } from './game-state-telemetry';
import { makePanelsState, type PanelsState } from './game-state-panels';
import { makeWorldState, type WorldState } from './game-state-world';
import { makeBootState, type BootState } from './game-state-boot';

export const SLICE_NAMES = [
  'render', 'lighting', 'probes', 'gibs', 'dynamite', 'weapon', 'player',
  'goo', 'crowd', 'bake', 'vfx', 'demo', 'telemetry', 'panels', 'world', 'boot',
] as const;

export type SliceName = typeof SLICE_NAMES[number];

export interface GameContext {
  render: RenderState;
  lighting: LightingState;
  probes: ProbesState;
  gibs: GibsState;
  dynamite: DynamiteState;
  weapon: WeaponState;
  player: PlayerState;
  goo: GooState;
  crowd: CrowdState;
  bake: BakeState;
  vfx: VfxState;
  demo: DemoState;
  telemetry: TelemetryState;
  panels: PanelsState;
  /** Entity storage — ECS component storage to be. */
  world: WorldState;
  /** DOM handles, URL params, loader and warm-up state. */
  boot: BootState;
}

export function makeGameContext(): GameContext {
  return {
    render: makeRenderState(),
    lighting: makeLightingState(),
    probes: makeProbesState(),
    gibs: makeGibsState(),
    dynamite: makeDynamiteState(),
    weapon: makeWeaponState(),
    player: makePlayerState(),
    goo: makeGooState(),
    crowd: makeCrowdState(),
    bake: makeBakeState(),
    vfx: makeVfxState(),
    demo: makeDemoState(),
    telemetry: makeTelemetryState(),
    panels: makePanelsState(),
    world: makeWorldState(),
    boot: makeBootState(),
  };
}
