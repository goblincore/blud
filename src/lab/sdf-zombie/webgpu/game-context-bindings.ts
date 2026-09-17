// src/lab/sdf-zombie/webgpu/game-context-bindings.ts
//
// Every slice's binding map in one place, for scripts/game-context-codemod.ts.
// Kept separate from game-context.ts so the codemod does not pull the whole
// three/WebGPU import graph into a Node script.
export { RENDER_BINDINGS } from './game-state-render';
export { LIGHTING_BINDINGS } from './game-state-lighting';
export { PROBES_BINDINGS } from './game-state-probes';
export { GIBS_BINDINGS } from './game-state-gibs';
export { DYNAMITE_BINDINGS } from './game-state-dynamite';
export { WEAPON_BINDINGS } from './game-state-weapon';
export { PLAYER_BINDINGS } from './game-state-player';
export { GOO_BINDINGS } from './game-state-goo';
export { CROWD_BINDINGS } from './game-state-crowd';
export { BAKE_BINDINGS } from './game-state-bake';
export { VFX_BINDINGS } from './game-state-vfx';
export { DEMO_BINDINGS } from './game-state-demo';
export { TELEMETRY_BINDINGS } from './game-state-telemetry';
export { PANELS_BINDINGS } from './game-state-panels';
export { WORLD_BINDINGS } from './game-state-world';
export { BOOT_BINDINGS } from './game-state-boot';
