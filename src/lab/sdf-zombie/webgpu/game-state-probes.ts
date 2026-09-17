// src/lab/sdf-zombie/webgpu/game-state-probes.ts
//
// PROBES slice of the GameContext decomposition. Numbers, flags and handles
// for the dynamic probe-gather layer only: the boot-parameter seams
// (?probedyn / ?proberate / ?dynrays / ?dynlights / ?dynblend / ?dynfall /
// ?probeopt / ?probes), the amortization bookkeeping, the capsule staging
// arrays and the last-frame diagnostics.
//
// Pure by construction: the only imports are erased `import type`s, so this
// module carries no Three.js/WebGPU dependency. The state is plain mutable
// fields — no getters, setters, `readonly` or freezing — because the codemod
// moves the original assignments here and any accessor would change evaluation
// timing around the pixel gate.
//
// Computed initializers (URL reads, `parseIntParam`, `boneInstanceArrays`, ...)
// get a type-correct placeholder in the factory; the codemod supplies the real
// value at the binding's original line.

import type { BoneInstanceArrays } from './bone-instancer';
import type { ProbeGatherBinding, ProbeGatherFrame } from './probe-gather-compute';

export interface ProbesState {
  /** GPU gather binding; created next to the room probes once the level exists. */
  gather: ProbeGatherBinding | null;
  /** Raw `?probedyn` value; `'0'`/`'off'` zero both gains below. */
  dynParam: string | null;
  /** Dynamic-layer gain; 0 when `?probedyn=0`/`off`. */
  dynGain: number;
  /** Visibility strength for the dynamic layer; 0 when `?probedyn=0`/`off`. */
  visStrength: number;
  /** `?proberate`, or null for the shipped default. */
  gatherRateBoot: number | null;
  /** `?dynrays` diagnostic seam, or null when absent. */
  raysBoot: number | null;
  /** `?dynlights` diagnostic seam, or null when absent. */
  lightsBoot: number | null;
  /** `?dynblend` afterglow rise rate, or null when absent. */
  blendBoot: number | null;
  /** `?dynfall` afterglow fall rate, or null when absent. */
  fallBoot: number | null;
  /** Muzzle-flash light boost, 1x = physical. */
  flashBoost: number;
  /** Frames since boot; drives the gather amortization cadence. */
  frame: number;
  /** Count of gather dispatch/readback errors, for the diagnostics panel. */
  gatherErrors: number;
  /** `?probeopt=0` restores the original (unoptimized) gather scan. */
  optimized: boolean;
  /** Frames between dynamic gathers; 1 = every frame. */
  gatherRate: number;
  /** Frame counter within the amortization cadence. */
  gatherTick: number;
  /** The gather frame queued from the last gather tick, if any. */
  pendingGather: ProbeGatherFrame | null;
  /** This room's actors' posed bones, packed for the gather. */
  capsuleArrays: BoneInstanceArrays;
  /** Rate limiter for the gate diagnostics log. */
  gateLogs: number;
  /** Last logged gate counts, or null before the first log. */
  lastGates: unknown;
  /** Capsule count from the last logged gather. */
  lastCapsules: number;
  /** Light count from the last logged gather. */
  lastLights: number;
  /** Parked probe weight (the probe-vis tunable's parked value). */
  weight: number;
  /** Raw `?probes` value. */
  probesParam: string | null;
  /** `?probes=0`/`off` keeps every body on the P1 path. */
  probesOff: boolean;
}

/** Every call returns a fresh object, nested arrays included. */
export function makeProbesState(): ProbesState {
  return {
    gather: null,
    dynParam: null,
    dynGain: 0,
    visStrength: 0,
    gatherRateBoot: null,
    raysBoot: null,
    lightsBoot: null,
    blendBoot: null,
    fallBoot: null,
    flashBoost: 4,
    frame: 0,
    gatherErrors: 0,
    optimized: false,
    gatherRate: 2,
    gatherTick: 0,
    pendingGather: null,
    capsuleArrays: { ab: new Float32Array(0), overflowed: false },
    gateLogs: 0,
    lastGates: null,
    lastCapsules: 0,
    lastLights: 0,
    weight: 0,
    probesParam: null,
    probesOff: false,
  };
}

/** Old `game-main.ts` binding name → path on the `probes` slice. */
export const PROBES_BINDINGS = {
  probeGather: 'probes.gather',
  probeDynParam: 'probes.dynParam',
  probeDynGain: 'probes.dynGain',
  probeVisStrength: 'probes.visStrength',
  probeGatherRateBoot: 'probes.gatherRateBoot',
  probeRaysBoot: 'probes.raysBoot',
  probeLightsBoot: 'probes.lightsBoot',
  probeBlendBoot: 'probes.blendBoot',
  probeFallBoot: 'probes.fallBoot',
  probeFlashBoost: 'probes.flashBoost',
  probeFrame: 'probes.frame',
  probeGatherErrors: 'probes.gatherErrors',
  probeOptimized: 'probes.optimized',
  probeGatherRate: 'probes.gatherRate',
  probeGatherTick: 'probes.gatherTick',
  pendingGather: 'probes.pendingGather',
  probeCapsuleArrays: 'probes.capsuleArrays',
  probeGateLogs: 'probes.gateLogs',
  probeLastGates: 'probes.lastGates',
  probeLastCapsules: 'probes.lastCapsules',
  probeLastLights: 'probes.lastLights',
  probeWeight: 'probes.weight',
  probesParam: 'probes.probesParam',
  probesOff: 'probes.probesOff',
} as const;
