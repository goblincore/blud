// src/lab/sdf-zombie/webgpu/shutter-blur.test.ts
//
// Pure tests for the efficient shutter candidate: the depth conventions, the
// object-only projected sweep planner (constant speed, clamps, rejects), the
// single-valued seed ownership that keeps opposed streams from cancelling, and
// the bounded depth-aware occlusion rule. No GPU and no three node graph.

import { describe, it, expect } from 'vitest';
import type { Droplet } from '../blood-sim';
import {
  clipToViewDepth, viewToClipDepth, projectWorldRadiusToPixels, sweepOccluded,
  planSweepStamp, planSweepStamps, rasterizeSweepSeed, seedDimsForOutput,
  EMPTY_SEED_STATS, SHUTTER_SEED_MIN, SHUTTER_SEED_MAX, SHUTTER_CANDIDATE_TAPS,
  DEFAULT_DEPTH_BIAS_M, type ShutterProjection, type SweepStamp, type SeedOwnership,
} from './shutter-blur';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function projection(over: Partial<ShutterProjection> = {}): ShutterProjection {
  return {
    viewProj: IDENTITY,
    viewMatrix: IDENTITY,
    width: 800,
    height: 600,
    near: 0.1,
    far: 200,
    tanHalfFovY: 1,
    ...over,
  };
}

function droplet(over: Partial<Droplet> = {}): Droplet {
  return {
    pos: [0, 0, -5], vel: [0, 0, 0], age: 0, life: 100, size: 0.1, kind: 'drop',
    ...over,
  } as Droplet;
}

const OPTS = { maxStreakPx: 100, sizeScale: 0.14, quadScale: 3.2, mistMaxSize: 0.05 };

describe('shutter candidate — depth conventions', () => {
  it('round-trips buffer depth to metric view depth and back', () => {
    const near = 0.1;
    const far = 200;
    for (const viewDepth of [near, 0.5, 5, 50, far]) {
      const clip = viewToClipDepth(viewDepth, near, far);
      expect(clipToViewDepth(clip, near, far)).toBeCloseTo(viewDepth, 6);
    }
  });

  it('pins the buffer-depth endpoints and rejects a degenerate inverse', () => {
    expect(viewToClipDepth(0.1, 0.1, 200)).toBeCloseTo(0, 9);
    expect(viewToClipDepth(200, 0.1, 200)).toBeCloseTo(1, 9);
    expect(clipToViewDepth(1, 0.1, 200)).toBeCloseTo(200, 6);
    expect(clipToViewDepth(0, 0.1, 200)).toBeCloseTo(0.1, 6);
    // A cleared far plane is not a usable metric depth.
    expect(Number.isFinite(clipToViewDepth(Number.NaN, 0.1, 200))).toBe(false);
  });

  it('projects a world radius with the pinhole focal length', () => {
    // focalPx = (600/2)/0.5 = 600 px; radius 1 m at 5 m -> 120 px.
    expect(projectWorldRadiusToPixels(1, 5, 0.5, 600)).toBeCloseTo(120, 9);
    // Doubling the distance halves the radius.
    expect(projectWorldRadiusToPixels(1, 10, 0.5, 600)).toBeCloseTo(60, 9);
    expect(projectWorldRadiusToPixels(0, 5, 0.5, 600)).toBe(0);
  });

  it('occludes only when the scene is nearer than the owner by the bias', () => {
    const near = 0.1;
    const far = 200;
    const ownerAt5 = viewToClipDepth(5, near, far);
    const sceneAt3 = viewToClipDepth(3, near, far);
    const sceneAt10 = viewToClipDepth(10, near, far);
    expect(sweepOccluded(5, sceneAt3, near, far, DEFAULT_DEPTH_BIAS_M)).toBe(true);
    expect(sweepOccluded(5, sceneAt10, near, far, DEFAULT_DEPTH_BIAS_M)).toBe(false);
    // Cleared far plane (no geometry) never occludes.
    expect(sweepOccluded(5, 1, near, far, DEFAULT_DEPTH_BIAS_M)).toBe(false);
    // Within the bias the owner is still the visible surface.
    expect(sweepOccluded(5, viewToClipDepth(4.99, near, far), near, far, 0.02)).toBe(false);
    expect(ownerAt5).toBeGreaterThan(0);
  });
});

describe('shutter candidate — object-only projected sweep', () => {
  it('projects BOTH endpoints through the current camera (constant speed)', () => {
    // Identity clip: 1 world unit = 400 px. 1 m/s for 0.1 s = 0.1 world = 40 px.
    const s = planSweepStamp(droplet({ pos: [0, 0, -5], vel: [1, 0, 0] }), projection(), 0.1, OPTS)!;
    expect(s.toX).toBeCloseTo(400, 6);
    expect(s.fromX).toBeCloseTo(360, 6);
    expect(s.streakPx).toBeCloseTo(40, 6);
    expect(s.velocityX).toBeCloseTo(400, 6);
    // The seed stores display UV per second: 400 px/s over 800 px = 0.5 uv/s.
    expect(s.velocityU).toBeCloseTo(0.5, 6);
    expect(s.velocityV).toBeCloseTo(0, 9);
    expect(s.ownerU).toBeCloseTo(0.5, 9);
    expect(s.ownerV).toBeCloseTo(0.5, 9);
    expect(s.ownerViewDepth).toBeCloseTo(5, 9);
    expect(s.ownerClipZ).toBeCloseTo(viewToClipDepth(5, 0.1, 200), 9);
  });

  it('caps the drawn streak at maxStreakPx by pulling the far endpoint in', () => {
    const s = planSweepStamp(
      droplet({ pos: [0, 0, -5], vel: [10, 0, 0] }), projection(), 0.1, { ...OPTS, maxStreakPx: 10 },
    )!;
    expect(s.streakPx).toBeCloseTo(10, 9);
    expect(Math.hypot(s.toX - s.fromX, s.toY - s.fromY)).toBeCloseTo(10, 6);
    // The clamped segment's implied speed is still the drawn displacement / time.
    expect(s.velocityX).toBeCloseTo(100, 6);
    expect(s.velocityU).toBeCloseTo(100 / 800, 9);
  });

  it('rejects unusable motion instead of inventing a vector', () => {
    // Behind the eye: w <= 0.
    const behind = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0];
    expect(planSweepStamp(droplet(), projection({ viewProj: behind }), 0.1, OPTS)).toBeNull();
    // Zero exposure is the sharp frame: no sweep at all.
    expect(planSweepStamp(droplet(), projection(), 0, OPTS)).toBeNull();
    // Mist and sub-cutoff droplets are billboarded, never seeded.
    expect(planSweepStamp(droplet({ kind: 'mist' }), projection(), 0.1, OPTS)).toBeNull();
    expect(planSweepStamp(droplet({ size: 0.01 }), projection(), 0.1, OPTS)).toBeNull();
    // Scraps pass the size cutoff regardless.
    expect(planSweepStamp(droplet({ kind: 'scrap', size: 0.001 }), projection(), 0.1, OPTS)).not.toBeNull();
  });

  it('plans one stamp per selected droplet and keeps the stream tag', () => {
    const sim = {
      droplets: [
        droplet({ pos: [0, 0, -5], vel: [1, 0, 0], stream: 7 }),
        droplet({ kind: 'mist', stream: 8 }),
        droplet({ pos: [0.2, 0, -5], vel: [0, 1, 0], stream: 9 }),
      ],
    };
    const stamps = planSweepStamps(sim.droplets, projection(), 0.1, OPTS);
    expect(stamps.map(s => s.stream)).toEqual([7, 9]);
  });
});

function stamp(over: Partial<SweepStamp> = {}): SweepStamp {
  return {
    stream: 1, ownerX: 400, ownerY: 300, ownerU: 0.5, ownerV: 0.5,
    ownerViewDepth: 5, ownerClipZ: viewToClipDepth(5, 0.1, 200),
    fromX: 360, fromY: 300, toX: 400, toY: 300,
    radiusPx: 2, streakPx: 40,
    velocityU: 0.5, velocityV: 0, velocityX: 400, velocityY: 0,
    ...over,
  };
}

describe('shutter candidate — bounded seed ownership', () => {
  it('does no work for an empty frame', () => {
    const out = new Float32Array(200 * 150 * 4).fill(7);
    const stats = rasterizeSweepSeed([], 800, 600, 200, 150, out);
    expect(stats).toEqual({ ...EMPTY_SEED_STATS });
    // Untouched: the caller can skip the resolve without clearing.
    expect(out[0]).toBe(7);
  });

  it('fills the swept segment (outside the current endpoint) with one owner', () => {
    const out = new Float32Array(200 * 150 * 4);
    const stats = rasterizeSweepSeed([stamp()], 800, 600, 200, 150, out);
    expect(stats.stamps).toBe(1);
    expect(stats.texels).toBeGreaterThan(0);
    expect(stats.maxStreakPx).toBeCloseTo(40, 9);
    // A texel at the far endpoint (seed x ~9) carries the owner's stored
    // motion, not its position.
    const ix = Math.floor(360 * (200 / 800));
    const iy = Math.floor(300 * (150 / 600));
    const idx = (iy * 200 + ix) * 4;
    expect(out[idx]).toBeCloseTo(0.5, 6);
    expect(out[idx + 1]).toBeCloseTo(0, 6);
    expect(out[idx + 3]).toBeGreaterThan(0);
    // Every weight is a normalized falloff.
    for (let i = 3; i < out.length; i += 4) expect(out[i]!).toBeLessThanOrEqual(1);
  });

  it('keeps OPPOSED streams single-valued; never averages them to a standstill', () => {
    const out = new Float32Array(200 * 150 * 4);
    const own: SeedOwnership = {
      stream: new Int32Array(200 * 150),
      vx: new Float32Array(200 * 150),
      vy: new Float32Array(200 * 150),
    };
    // Two streams sweeping through the SAME point from opposite sides. The
    // stored motion is +0.5 and -0.5 uv/s: an average would be exactly 0.
    const right = stamp({ stream: 1, velocityU: 0.5, fromX: 360, toX: 400, velocityX: 400 });
    const left = stamp({ stream: 2, velocityU: -0.5, fromX: 440, toX: 400, velocityX: -400 });
    const stats = rasterizeSweepSeed([right, left], 800, 600, 200, 150, out, own);
    expect(stats.conflicts).toBeGreaterThan(0);
    expect(stats.oppositeConflicts).toBeGreaterThan(0);
    // Every stored owner is EXACTLY one stream's velocity (|v| = 0.5), never
    // the 0 midpoint a bilinear blend or an averaged vector would produce.
    let checked = 0;
    for (let i = 0; i < own.stream.length; i++) {
      if (own.stream[i] === -1) continue;
      const u = out[i * 4]!;
      if (Math.abs(Math.abs(u) - 0.5) < 1e-6) checked++;
      else if (Math.abs(u) < 0.25) throw new Error('averaged opposed velocities at a collision texel');
    }
    expect(checked).toBeGreaterThan(0);
    // The two owners are represented at all (one stream did not delete the other).
    const streams = new Set(Array.from(own.stream).filter(s => s !== -1));
    expect(streams.has(1)).toBe(true);
    expect(streams.has(2)).toBe(true);
  });

  it('lets the nearer depth win a near-equal weight (depth-coherent ownership)', () => {
    const out = new Float32Array(200 * 150 * 4);
    const own: SeedOwnership = {
      stream: new Int32Array(200 * 150),
      vx: new Float32Array(200 * 150),
      vy: new Float32Array(200 * 150),
    };
    const far = stamp({ stream: 1, ownerClipZ: viewToClipDepth(20, 0.1, 200) });
    const near = stamp({ stream: 2, ownerClipZ: viewToClipDepth(2, 0.1, 200) });
    const stats = rasterizeSweepSeed([far, near], 800, 600, 200, 150, out, own);
    expect(stats.nearerWins).toBeGreaterThan(0);
    // At the shared endpoint texel the NEAR owner won.
    const ix = Math.floor(400 * (200 / 800));
    const iy = Math.floor(300 * (150 / 600));
    const idx = (iy * 200 + ix) * 4;
    expect(out[idx + 2]).toBeCloseTo(near.ownerClipZ, 6);
  });

  it('bounds seed dimensions and exposes the bounded tap count', () => {
    expect(seedDimsForOutput(800, 600, 0.5)).toEqual({ width: 400, height: 300 });
    expect(seedDimsForOutput(10, 10, 0.5).width).toBe(SHUTTER_SEED_MIN);
    const huge = seedDimsForOutput(100000, 100000, 1);
    expect(huge.width).toBe(SHUTTER_SEED_MAX);
    expect(huge.height).toBe(SHUTTER_SEED_MAX);
    expect(SHUTTER_CANDIDATE_TAPS).toBeGreaterThan(0);
    expect(SHUTTER_CANDIDATE_TAPS).toBeLessThanOrEqual(8);
  });
});
