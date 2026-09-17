// src/lab/sdf-zombie/webgpu/game-state-lighting.ts
//
// LIGHTING slice of the GameContext decomposition. State and handles for the
// level's light rig only: the hemisphere ceiling fill and its probe-grid blend,
// the dungeon/flashlight rig, the flickering accent lights, the gathered
// tracer lights, the body-flash gain and the boot-parameter seams that gate
// them (?levelprobes / ?tracerlight / ?tracerlightslots / ?bouncespot /
// ?fxlight, plus the TASK-6 light-clock freeze).
//
// Pure by construction: the only non-local import is an erased `import type`,
// so this module carries no runtime Three.js/WebGPU dependency. Fields are
// plain and mutable — no getters, setters, `readonly` or `Object.freeze` —
// because the codemod moves the original assignments onto these fields and an
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (URL reads, `parseIntParam`, `new THREE.HemisphereLight`,
// `createFlashlight`) get a type-correct placeholder in the factory; the codemod
// supplies the real value at the binding's original line.

import type * as THREE from 'three/webgpu';
import type { Flashlight } from './dungeon-lighting';
import type { Projectile } from './game-weapon';
import type { ProbeLightingNode } from './probe-lighting-node';

export interface LightingState {
  /** Hemisphere ceiling fill; the codemod supplies the real light. */
  hemi: THREE.HemisphereLight | null;
  /** Raw `?levelprobes` value; `'0'`/`'off'` pin the hemisphere at full intensity. */
  levelProbesParam: string | null;
  /** 0..1 blend from the hemisphere fill to the room probe grid. */
  levelProbeWeight: number;
  /** Per-room matched gain; -1 = each room's own matched level. */
  levelProbeGain: number;
  /** The hemisphere rig's intensity at boot, before the weight fades it. */
  hemiBase: number;
  /** Room-probe lighting nodes, keyed by room id. */
  levelProbeNodes: Map<number, ProbeLightingNode>;
  /** Accent lights that pulse, each with its base power and phase. */
  flickerLights: { light: THREE.PointLight; base: number; phase: number }[];
  /** Dungeon rig on/off; the gallery must render unchanged when false. */
  dungeonOn: boolean;
  /** Beam + shadow rig; the codemod supplies the real flashlight. */
  flashlight: Flashlight | null;
  /** Provider for the live projectile lists, or null before they exist. */
  liveTracers: (() => readonly Projectile[]) | null;
  /** Raw `?tracerlight` value; `'0'`/`'off'` zero the gain. */
  tracerLightParam: string | null;
  /** Tracer-light gather gain. */
  tracerLightGain: number;
  /** How many tracers may be gathered at once; 0 = off. */
  tracerLightSlots: number;
  /** Direct body-flash multiplier; 0 = off, bit-identical. */
  bodyFlashGain: number;
  /** TASK-6 diagnostic: freezes the practical flicker phase. */
  clockFrozen: boolean;
  /** The flicker clock instant captured by `clockFrozen`. */
  flickerClockFrozenAt: number;
  /** Raw `?bouncespot` value. */
  bounceSpotParam: string | null;
  /** Flashlight bounce-disc gain; 0 pins the bit-identical path. */
  bounceSpotGain: number;
  /** Live level-shadow seam; boot default is `GAME_LEVEL_SHADOW > 0.5`. */
  levelShadowEnabled: boolean;
  /** `?fxlight` scale applied to both explosion light peaks. */
  fxLightScale: number;
}

/** Every call returns a fresh object, nested arrays and maps included. */
export function makeLightingState(): LightingState {
  return {
    hemi: null,
    levelProbesParam: null,
    levelProbeWeight: 0,
    levelProbeGain: -1,
    hemiBase: 0,
    levelProbeNodes: new Map<number, ProbeLightingNode>(),
    flickerLights: [],
    dungeonOn: true,
    flashlight: null,
    liveTracers: null,
    tracerLightParam: null,
    tracerLightGain: 0,
    tracerLightSlots: 0,
    bodyFlashGain: 0.06,
    clockFrozen: false,
    flickerClockFrozenAt: 0,
    bounceSpotParam: null,
    bounceSpotGain: 0,
    levelShadowEnabled: false,
    fxLightScale: 0,
  };
}

/** Old `game-main.ts` binding name → path on the `lighting` slice. */
export const LIGHTING_BINDINGS = {
  hemi: 'lighting.hemi',
  levelProbesParam: 'lighting.levelProbesParam',
  levelProbeWeight: 'lighting.levelProbeWeight',
  levelProbeGain: 'lighting.levelProbeGain',
  hemiBase: 'lighting.hemiBase',
  levelProbeNodes: 'lighting.levelProbeNodes',
  flickerLights: 'lighting.flickerLights',
  dungeonOn: 'lighting.dungeonOn',
  flashlight: 'lighting.flashlight',
  liveTracers: 'lighting.liveTracers',
  tracerLightParam: 'lighting.tracerLightParam',
  tracerLightGain: 'lighting.tracerLightGain',
  tracerLightSlots: 'lighting.tracerLightSlots',
  bodyFlashGain: 'lighting.bodyFlashGain',
  lightClockFrozen: 'lighting.clockFrozen',
  flickerClockFrozenAt: 'lighting.flickerClockFrozenAt',
  bounceSpotParam: 'lighting.bounceSpotParam',
  bounceSpotGain: 'lighting.bounceSpotGain',
  levelShadowEnabled: 'lighting.levelShadowEnabled',
  fxLightScale: 'lighting.fxLightScale',
} as const;
