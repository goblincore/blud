// src/lab/sdf-zombie/webgpu/shutter-reference.ts
//
// SAMPLED-REFERENCE CONTRACT (selective shutter blur, task 1).
//
// The plan forbids the cheap shortcut: "Never accumulate particle density
// across shutter times and threshold once: that makes a different fluid
// shape." The reference therefore samples the recorded timeline at N times
// inside the trailing box, reconstructs and shades the selected blood
// SEPARATELY at each time, and averages WORKING-LINEAR PREMULTIPLIED
// colour/coverage. This module owns the pure half of that:
//
//   - the box-filter sample plan (sample times + normalized weight),
//   - selected-vs-static classification and scratch-sim reconstruction,
//   - the premultiplied accumulate/average/composite math,
//   - a projection parity probe (the fixture is asymmetric on purpose).
//
// The GPU half lives in blood-compare-main.ts and reuses the production goo
// layer's smooth reconstruction. It is a QUALITY ORACLE, not a shipping frame
// cost, and the split it performs has a documented topology limitation: the
// moving blood and the static pools are reconstructed in separate density
// fields, so a droplet that overlaps a pool does not metaball-fuse with it in
// the reference (see TASK-1.md).

import type { BloodSim, Droplet, Splat } from '../blood-sim';
import type { ParticleState, ShutterTimeline } from './shutter-timeline';
import { particlesAt } from './shutter-timeline';
import { clampSampleCount, trailingInterval } from './shutter-timing';

export type ShutterReferenceId = 'sharp' | 'sampled' | 'efficient';

export interface ShutterReferenceOption {
  id: ShutterReferenceId;
  label: string;
  /** False when the entry is listed but not selectable (never aliased). */
  implemented: boolean;
}

/**
 * The three reference choices the plan names. `sharp` and `sampled` are the
 * task-1 oracle paths; `efficient` is the task-2 bounded velocity-streak
 * candidate (see shutter-blur.ts). All three are selectable, and selection is
 * never aliased: the page dispatches on the id.
 */
export const SHUTTER_REFERENCES: readonly ShutterReferenceOption[] = [
  { id: 'sharp', label: 'Sharp (no exposure)', implemented: true },
  { id: 'sampled', label: 'Sampled reference (slow oracle)', implemented: true },
  { id: 'efficient', label: 'Shutter candidate (velocity streaks)', implemented: true },
];

export const DEFAULT_SHUTTER_SAMPLES = 8;
/** Quality cap on the drawn streak width, in content pixels. */
export const DEFAULT_MAX_STREAK_PX = 40;
/** Reference particle cap per sample, so one fixture cannot stall the page. */
export const MAX_REFERENCE_PARTICLES = 900;

export interface ShutterSamplePlan {
  exposureSeconds: number;
  /** 0 when exposure is off: the sharp frame is the whole truth. */
  sampleCount: number;
  /** Ascending shutter sample times spanning the trailing box. */
  sampleTimes: number[];
  /** Box-filter weight per sample; sums to 1. 0 when off. */
  sampleWeight: number;
  from: number;
  to: number;
}

/**
 * Plan a normalized box exposure over `[now - exposure, now]`.
 *
 * Sample times are at bin MIDPOINTS (`from + exposure*(i+0.5)/n`), the
 * standard midpoint rule for a box integral: every sample carries equal
 * weight and no sample sits exactly on a discontinuity. Zero (or invalid)
 * exposure returns an empty plan rather than one instant: the page routes
 * that case to the existing sharp render so exposure-zero parity is exact.
 */
export function planShutterSamples(
  nowSec: number, exposureSeconds: number, requestedSamples: number,
): ShutterSamplePlan {
  if (!Number.isFinite(exposureSeconds) || exposureSeconds <= 0) {
    const at = Number.isFinite(nowSec) ? nowSec : 0;
    return { exposureSeconds: 0, sampleCount: 0, sampleTimes: [], sampleWeight: 0, from: at, to: at };
  }
  const n = clampSampleCount(requestedSamples);
  const { from, to } = trailingInterval(nowSec, exposureSeconds);
  const dt = exposureSeconds / n;
  const sampleTimes: number[] = [];
  for (let i = 0; i < n; i++) sampleTimes.push(from + dt * (i + 0.5));
  return { exposureSeconds, sampleCount: n, sampleTimes, sampleWeight: 1 / n, from, to };
}

export type ShutterCategory = 'airborne' | 'scrap' | 'mist' | 'gut';

export function classifyDroplet(d: Droplet): ShutterCategory {
  if (d.kind === 'gut') return 'gut';
  if (d.kind === 'mist') return 'mist';
  if (d.kind === 'scrap') return 'scrap';
  return 'airborne';
}

/**
 * Selected content for stage 1: airborne blood and flying scraps. Mist stays a
 * separate fine-spray switch (the plan requires it independently switchable);
 * gut nodes are static/owned by the entrails chain and stay sharp.
 */
export function isSelectedForShutter(d: Droplet): boolean {
  return d.kind === 'drop' || d.kind === 'scrap';
}

function copySplat(s: Splat): Splat {
  return { pos: [s.pos[0], s.pos[1], s.pos[2]], size: s.size, yaw: s.yaw };
}

/**
 * Build a scratch BloodSim from reconstructed particle states. The caller
 * supplies the static splats when it wants them drawn (the sharp half of the
 * reference); the moving half passes none.
 */
export function simFromParticles(
  particles: readonly ParticleState[], splats: readonly Splat[] = [], out?: BloodSim,
): BloodSim {
  const sim: BloodSim = out ?? { droplets: [], splats: [], clocks: {} };
  sim.droplets.length = 0;
  sim.splats.length = 0;
  for (const key of Object.keys(sim.clocks)) delete sim.clocks[Number(key)];
  for (const p of particles) {
    sim.droplets.push({
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      vel: [p.vel[0], p.vel[1], p.vel[2]],
      age: p.age,
      life: p.life,
      size: p.size,
      kind: p.kind,
      ...(p.ribbon ? { ribbon: true } : {}),
      ...(p.stream >= 0 ? { stream: p.stream } : {}),
    });
  }
  for (const s of splats) sim.splats.push(copySplat(s));
  return sim;
}

export interface ShutterSplit {
  /** Selected moving droplets only (drop + scrap), no splats. */
  moving: BloodSim;
  /** Static content: floor pools + gut nodes, no selected moving droplets. */
  staticSim: BloodSim;
}

/**
 * Split a live sim for the reference. The moving holes are left in
 * `staticSim.droplets` as gut nodes only, so the sharp half keeps pools/guts
 * and the accumulator sees only selected motion. This is where the documented
 * moving/static topology separation happens.
 */
export function splitSimForShutter(sim: BloodSim): ShutterSplit {
  const moving: BloodSim = { droplets: [], splats: [], clocks: {} };
  const staticSim: BloodSim = { droplets: [], splats: [], clocks: {} };
  for (const d of sim.droplets) {
    const copy: Droplet = {
      pos: [d.pos[0], d.pos[1], d.pos[2]],
      vel: [d.vel[0], d.vel[1], d.vel[2]],
      age: d.age,
      life: d.life,
      size: d.size,
      kind: d.kind,
      ...(d.ribbon ? { ribbon: true } : {}),
      ...(d.stream !== undefined ? { stream: d.stream } : {}),
    };
    if (isSelectedForShutter(d)) moving.droplets.push(copy);
    else staticSim.droplets.push(copy);
  }
  for (const s of sim.splats) staticSim.splats.push(copySplat(s));
  return { moving, staticSim };
}

/**
 * Reconstruct the selected moving sim at one sample time. Non-selected
 * droplets (mist, gut) are filtered out and `splats` are always empty: pools
 * and guts stay in the sharp half.
 */
export function movingSimAt(timeline: ShutterTimeline, t: number, out?: BloodSim): BloodSim {
  const selected = particlesAt(timeline, t).filter(p =>
    p.kind === 'drop' || p.kind === 'scrap');
  return simFromParticles(selected, [], out);
}

// ---------------------------------------------------------------------------
// Working-linear premultiplied math
//
// The GPU accumulates premultiplied colour and coverage with a One/One blend
// into a half-float target. These helpers are the exact same arithmetic on the
// CPU, so the averaging contract is testable without a GPU.
// ---------------------------------------------------------------------------

export interface PremultipliedRGBA {
  r: number; g: number; b: number; a: number;
}

export const PREMUL_ZERO: Readonly<PremultipliedRGBA> = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

export function accumulatePremultiplied(
  acc: Readonly<PremultipliedRGBA>, sample: Readonly<PremultipliedRGBA>,
): PremultipliedRGBA {
  return { r: acc.r + sample.r, g: acc.g + sample.g, b: acc.b + sample.b, a: acc.a + sample.a };
}

/**
 * Box average. Dividing all four channels by the same count is what keeps the
 * background contribution normalized: the scene is later blended with
 * `scene*(1-a) + rgb`, so a background seen through an uncovered pixel keeps
 * its full weight, and a sample that fully covers a pixel contributes its
 * colour once.
 */
export function averagePremultiplied(
  acc: Readonly<PremultipliedRGBA>, sampleCount: number,
): PremultipliedRGBA {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return { ...PREMUL_ZERO };
  return { r: acc.r / sampleCount, g: acc.g / sampleCount, b: acc.b / sampleCount, a: acc.a / sampleCount };
}

/** Standard premultiplied over: `scene*(1-a) + rgb`. */
export function compositeOverScene(
  scene: readonly [number, number, number], premul: Readonly<PremultipliedRGBA>,
): [number, number, number] {
  const ia = 1 - premul.a;
  return [scene[0] * ia + premul.r, scene[1] * ia + premul.g, scene[2] * ia + premul.b];
}

/** Average an explicit list of per-sample premultiplied results (CPU oracle). */
export function averageSamples(
  samples: readonly Readonly<PremultipliedRGBA>[], sampleCount = samples.length,
): PremultipliedRGBA {
  let acc: PremultipliedRGBA = { ...PREMUL_ZERO };
  for (const s of samples) acc = accumulatePremultiplied(acc, s);
  return averagePremultiplied(acc, sampleCount);
}

// ---------------------------------------------------------------------------
// Projection parity probe
//
// The fixture is deliberately asymmetric (the obstacle sits at +x, the wound
// origin is offset in +z), so a mirrored reference is visible on screen. This
// pure probe proves the projection convention the page uses maps +world-x to
// +screen-x and is unit-tested with an identity matrix.
// ---------------------------------------------------------------------------

/** Column-major 4x4 multiply (three.js convention). */
export function projectWorldToPixel(
  p: readonly [number, number, number],
  viewProj: readonly number[],
  width: number, height: number,
): [number, number] | null {
  if (viewProj.length < 16) return null;
  const x = p[0], y = p[1], z = p[2];
  const cx = viewProj[0]! * x + viewProj[4]! * y + viewProj[8]! * z + viewProj[12]!;
  const cy = viewProj[1]! * x + viewProj[5]! * y + viewProj[9]! * z + viewProj[13]!;
  const cw = viewProj[3]! * x + viewProj[7]! * y + viewProj[11]! * z + viewProj[15]!;
  if (!(cw > 1e-9)) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return [(ndcX * 0.5 + 0.5) * width, (1 - (ndcY * 0.5 + 0.5)) * height];
}

/**
 * The displayed quality budget: how many shade samples the reference runs and
 * the geometric streak the plan's equation predicts at a reference speed.
 * Shown in the lab diagnostics so the cost is named rather than implied.
 */
export function referenceBudget(
  plan: ShutterSamplePlan, particleCount: number, speedPxPerSec: number,
): { samples: number; particlesPerSample: number; shadeSamples: number; streakPx: number } {
  const particlesPerSample = Math.min(particleCount, MAX_REFERENCE_PARTICLES);
  return {
    samples: plan.sampleCount,
    particlesPerSample,
    shadeSamples: plan.sampleCount * particlesPerSample,
    streakPx: speedPxPerSec * plan.exposureSeconds,
  };
}
