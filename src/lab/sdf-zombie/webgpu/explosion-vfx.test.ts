// src/lab/sdf-zombie/webgpu/explosion-vfx.test.ts
//
// Headless tests for the procedural explosion burst. Everything here is pure
// arithmetic or node-graph CONSTRUCTION — no WebGPU device is ever created
// (vitest has none, and asking for one is the classic way to make a suite that
// only passes on the author's machine). The GPU half of the contract — that
// the node material actually renders as soft fire rather than opaque squares —
// is proven by the spike page and its capture driver, not from here.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  EXPLOSION_VFX_LIMITS, EXPLOSION_VFX_TUNING,
  burstAnchor, burstSeed, clamp01, clampTuning, createExplosionLookMaterial,
  createExplosionVfx, findFreeSlot, fireEnvelope, lightEnvelope,
  makeExplosionLookUniforms, randomInUnitSphere, ringEnvelope, smokeEnvelope,
  smoothstep01, stepEmber,
  curlWarpGain,
  extentQuartiles,
} from './explosion-vfx';
import type { BurstVisual } from '../explosion-aoe';

const visual = (kind: 'air' | 'ground', at: readonly [number, number, number]): BurstVisual =>
  ({ kind, at, heightM: 2 });

/** A fixed, deterministic LCG for the sphere-sample test. */
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

// ————————————————————————————————————————————————————————————————————————
// Envelope curves
// ————————————————————————————————————————————————————————————————————————

describe('envelope curves', () => {
  it('clamp01 / smoothstep01 hold their ends and are monotone in between', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(3)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
    expect(smoothstep01(0, 1, -1)).toBe(0);
    expect(smoothstep01(0, 1, 2)).toBe(1);
    expect(smoothstep01(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    // A degenerate band must not divide by zero.
    expect(smoothstep01(1, 1, 0.5)).toBe(0);
    expect(smoothstep01(1, 1, 2)).toBe(1);
  });

  it('fire blooms fast, holds, then burns out — and only ever grows', () => {
    // Ignition is a FLASH: the first 12% carries the whole rise.
    expect(fireEnvelope(0).intensity).toBe(0);
    expect(fireEnvelope(0.12).intensity).toBeGreaterThan(0.9);
    expect(fireEnvelope(1).intensity).toBe(0);
    // Burn-out is complete at the end of the burst, never before it.
    const mid = fireEnvelope(0.4).intensity;
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    // Radius, rise and stretch are monotone: a fireball never shrinks, never
    // falls and never un-stretches.
    let prevR = -1, prevRise = -1, prevStretch = -1;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const s = fireEnvelope(u);
      expect(s.radius).toBeGreaterThanOrEqual(prevR);
      expect(s.rise).toBeGreaterThanOrEqual(prevRise);
      expect(s.stretchY).toBeGreaterThanOrEqual(prevStretch);
      prevR = s.radius; prevRise = s.rise; prevStretch = s.stretchY;
    }
    // "Bloom then STRETCH upward" is the brief's wording: by the end of the
    // billboard's life it is taller than it is wide. The NECK is the one layer
    // that must keep this: it is a column, not a cap.
    expect(fireEnvelope(1).stretchY).toBeGreaterThan(1.5);
    expect(fireEnvelope(1).rise).toBeGreaterThan(0);
    // Out-of-range input is clamped, not extrapolated.
    expect(fireEnvelope(-5)).toEqual(fireEnvelope(0));
    expect(fireEnvelope(5)).toEqual(fireEnvelope(1));
  });

  it('the fire is the plume\u2019s NECK: it converges instead of growing in every direction', () => {
    // The horizontal term is not the vertical one any more. Before the plume
    // pass a single `spread` factor fed x, z AND y off the same radius, so
    // every billboard was displaced self-similarly and the burst could only
    // ever be a ball at any size or count.
    let prevFlare = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const s = fireEnvelope(u);
      expect(s.flare).toBeLessThanOrEqual(prevFlare);
      prevFlare = s.flare;
    }
    // Flares out of the crater, then narrows to a column.
    expect(fireEnvelope(0).flare).toBeGreaterThan(1);
    expect(fireEnvelope(1).flare).toBeLessThan(0.4);
    // ...and STOPS climbing: an unclamped rise is what turned the neck into
    // half of a sphere.
    expect(fireEnvelope(1).rise).toBeCloseTo(EXPLOSION_VFX_TUNING.plumeNeckH, 10);
    for (const h of [0.2, 0.6, 1.35]) {
      expect(fireEnvelope(1, h).rise).toBeCloseTo(h, 10);
    }
  });

  it('smoke is a late bloomer that rises further and glows only briefly', () => {
    expect(smokeEnvelope(0).density).toBe(0);
    expect(smokeEnvelope(1).density).toBe(0);
    expect(smokeEnvelope(0).glow).toBe(1);
    // The internal fire-light is gone by 45% of the billboard's life, while
    // the density is still near its peak — smoke outlives its own glow.
    expect(smokeEnvelope(0.5).glow).toBe(0);
    expect(smokeEnvelope(0.5).density).toBeGreaterThan(0.5);
    // Smoke travels further than fire over the same life. The ratio is not
    // 1.5x any more BECAUSE both rises are now clamped to the plume's own
    // two heights — the property that matters is the ORDER, and that the cap
    // sits above the neck by a margin rather than by a runaway curve.
    expect(smokeEnvelope(1).rise).toBeGreaterThan(fireEnvelope(1).rise);
    expect(smokeEnvelope(1).rise - fireEnvelope(1).rise).toBeGreaterThan(0.4);
    expect(smokeEnvelope(1).radius).toBeGreaterThan(fireEnvelope(1).radius);
  });

  it('the smoke is the CAP: it rolls outward and ends WIDER THAN TALL', () => {
    // `stretchY >= 1` everywhere means nothing in this effect could ever be
    // flatter than it is wide — which is exactly what a mushroom cap is, and
    // why the shape needed a term of its own rather than a bigger stretch.
    let prevFlare = -1;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const s = smokeEnvelope(u);
      expect(s.flare).toBeGreaterThanOrEqual(prevFlare);
      prevFlare = s.flare;
    }
    expect(smokeEnvelope(0).flare).toBeLessThan(0.4);
    expect(smokeEnvelope(1).flare).toBeCloseTo(1, 6);
    // The end of life is the flattened cap, and the flattening only ever goes
    // one way (a cap that puffed back out would read as a bounce).
    expect(smokeEnvelope(1).flatten).toBeCloseTo(EXPLOSION_VFX_TUNING.capFlatten, 10);
    expect(smokeEnvelope(0).flatten).toBe(1);
    let prevFlat = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const s = smokeEnvelope(u);
      expect(s.flatten).toBeLessThanOrEqual(prevFlat);
      prevFlat = s.flatten;
    }
    // The cap's top is a knob, and a zero cap flattens the plume onto the
    // burst centre rather than producing a NaN.
    expect(smokeEnvelope(1, 3.5).rise).toBeCloseTo(3.5, 10);
    expect(smokeEnvelope(1, 0).rise).toBe(0);
  });

  it('reports where a layer\u2019s mass sits, without a bounding box to re-cut', () => {
    // The shape question ("is the mass up top") as arithmetic on the sample set.
    // A QUARTILE cannot be reordered by a stray sample the way a bounding-box
    // band split can — which is why this replaced the frame-differential version
    // that read 7.45 and then 0.26 for the same arm.
    expect(extentQuartiles([])).toEqual({ meanY: 0, lowQuartileY: 0, highQuartileY: 0 });
    const even = extentQuartiles([1, 2, 3, 4]);
    expect(even.meanY).toBeCloseTo(2.5, 12);
    expect(even.lowQuartileY).toBe(1);
    expect(even.highQuartileY).toBe(4);
    // A plume puts its mass up top: same samples, top-heavy, and the gap between
    // the quartiles is what says so.
    const plume = extentQuartiles([0.2, 0.3, 1.1, 1.2, 1.3, 1.4]);
    const ball = extentQuartiles([0.6, 0.7, 0.8, 0.9, 1.0, 1.1]);
    expect(plume.meanY).toBeGreaterThan(ball.meanY);
    expect(plume.highQuartileY - plume.lowQuartileY)
      .toBeGreaterThan(ball.highQuartileY - ball.lowQuartileY);
    // Fewer than four samples still yields one per quartile rather than an
    // empty mean of nothing (a NaN here would print as a shape claim).
    const two = extentQuartiles([1, 5]);
    expect(two.lowQuartileY).toBe(1);
    expect(two.highQuartileY).toBe(5);
    expect(Number.isFinite(two.meanY)).toBe(true);
  });

  it('the shockwave expands, decelerates and fades to nothing', () => {
    const start = ringEnvelope(0, 0.5, 10, 0.6);
    expect(start.radiusM).toBeCloseTo(0.5, 12);
    expect(start.alpha).toBe(1);
    const end = ringEnvelope(1, 0.5, 10, 0.6);
    expect(end.alpha).toBe(0);
    expect(end.radiusM).toBeCloseTo(0.5 + 10 * 0.6, 10);
    // Deceleration: the first half of the life covers more than half the
    // travel, which is what "a blast front slowing in air it already swept"
    // means numerically.
    const half = ringEnvelope(0.5, 0.5, 10, 0.6);
    expect(half.radiusM - 0.5).toBeGreaterThan((end.radiusM - 0.5) / 2);
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const s = ringEnvelope(u, 0.5, 10, 0.6);
      expect(s.radiusM).toBeGreaterThanOrEqual(prev);
      prev = s.radiusM;
      expect(s.alpha).toBeGreaterThanOrEqual(0);
    }
    // Speed 0 is a ring that never expands, not a NaN.
    expect(ringEnvelope(0.5, 0.5, 0, 0.6).radiusM).toBeCloseTo(0.5, 12);
  });

  it('the dynamic light spikes almost instantly and is out by the end', () => {
    expect(lightEnvelope(0)).toBe(0);
    expect(lightEnvelope(1)).toBe(0);
    expect(lightEnvelope(0.05)).toBeGreaterThan(0.85);
    const peak = lightEnvelope(0.05);
    for (let u = 0.1; u <= 1.0001; u += 0.05) {
      expect(lightEnvelope(u)).toBeLessThanOrEqual(peak + 1e-12);
    }
  });
});

// ————————————————————————————————————————————————————————————————————————
// Deterministic RNG
// ————————————————————————————————————————————————————————————————————————

describe('deterministic randomness', () => {
  it('a pinned seed is independent of how many bursts came before it', () => {
    expect(burstSeed(1234, 0, 99)).toBe(1234);
    expect(burstSeed(1234, 57, 99)).toBe(1234);
    expect(burstSeed(undefined, 0, 99)).toBe(99);
    expect(burstSeed(undefined, 3, 99)).toBe(102);
    // Negative and fractional seeds are folded into uint32 rather than
    // handed to the LCG as-is.
    expect(burstSeed(-1, 0, 0)).toBe(0xffffffff);
    expect(burstSeed(7.9, 0, 0)).toBe(7);
  });

  it('samples evenly inside the unit ball, and reproducibly', () => {
    const a = randomInUnitSphere(lcg(1));
    const b = randomInUnitSphere(lcg(1));
    expect(a).toEqual(b);
    expect(randomInUnitSphere(lcg(1))).not.toEqual(randomInUnitSphere(lcg(2)));

    const rng = lcg(7);
    let sumX = 0, sumY = 0, sumZ = 0, maxR = 0, octants = new Set<string>();
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const [x, y, z] = randomInUnitSphere(rng);
      const r = Math.hypot(x, y, z);
      expect(r).toBeLessThanOrEqual(1 + 1e-9);
      maxR = Math.max(maxR, r);
      sumX += x; sumY += y; sumZ += z;
      octants.add(`${x > 0 ? 1 : 0}${y > 0 ? 1 : 0}${z > 0 ? 1 : 0}`);
    }
    // All eight octants are reachable — a fireball must not be a hemisphere.
    expect(octants.size).toBe(8);
    // Mean near the origin.
    expect(Math.abs(sumX / N)).toBeLessThan(0.03);
    expect(Math.abs(sumY / N)).toBeLessThan(0.03);
    expect(Math.abs(sumZ / N)).toBeLessThan(0.03);
    // Cube-root radius: the outer shell really is populated, which is the
    // difference between a fireball and a bright core with stray licks.
    expect(maxR).toBeGreaterThan(0.98);
  });
});

// ————————————————————————————————————————————————————————————————————————
// Ember ballistics
// ————————————————————————————————————————————————————————————————————————

describe('ember ballistics', () => {
  it('integrates semi-implicitly, so gravity never adds energy', () => {
    const e = { px: 0, py: 0, pz: 0, vx: 0, vy: 10, vz: 0 };
    stepEmber(e, 0.1, -10, 0);
    // v is updated BEFORE p, so the first step is 9 m/s for 0.1 s.
    expect(e.vy).toBeCloseTo(9, 10);
    expect(e.py).toBeCloseTo(0.9, 10);
    stepEmber(e, 0.1, -10, 0);
    expect(e.vy).toBeCloseTo(8, 10);
    expect(e.py).toBeCloseTo(1.7, 10);
  });

  it('drag bleeds speed off and a zero step is the identity', () => {
    const e = { px: 1, py: 2, pz: 3, vx: 8, vy: 0, vz: -8 };
    const before = { ...e };
    stepEmber(e, 0, -10, 2);
    expect(e).toEqual(before);
    stepEmber(e, 0.1, 0, 2);
    // damp = 1 - 2*0.1 = 0.8
    expect(e.vx).toBeCloseTo(8 * 0.8, 10);
    expect(e.vz).toBeCloseTo(-8 * 0.8, 10);
    expect(e.px).toBeCloseTo(1 + 6.4 * 0.1, 10);
    // Drag can never invert the velocity (damp is floored at 0).
    const fast = { px: 0, py: 0, pz: 0, vx: 10, vy: 0, vz: 0 };
    stepEmber(fast, 5, 0, 2);
    expect(fast.vx).toBe(0);
  });
});

// ————————————————————————————————————————————————————————————————————————
// Slot ring / capacity
// ————————————————————————————————————————————————————————————————————————

describe('slot ring', () => {
  it('takes the first retired slot, then the oldest when all are busy', () => {
    expect(findFreeSlot([Infinity, Infinity], 1)).toBe(0);
    expect(findFreeSlot([0.5, Infinity], 1)).toBe(1);
    expect(findFreeSlot([0.9, 1.2, 0.1], 1)).toBe(1);
    // All live: recycle the oldest rather than refuse.
    expect(findFreeSlot([0.2, 0.9, 0.5], 1)).toBe(1);
    // A NaN age is treated as LIVE, never as free — a corrupt age must not
    // silently steal a slot that another burst is still using.
    expect(findFreeSlot([NaN, 0.9], 1)).toBe(1);
    // Exactly-at-life counts as retired.
    expect(findFreeSlot([1, 0.1], 1)).toBe(0);
  });

  it('clamps a tuning patch into what the pool can actually draw', () => {
    const t = clampTuning({
      ...EXPLOSION_VFX_TUNING,
      gain: 1e6, fireScale: -4, lifeSec: 0, fireCount: 3.9,
      smokeCount: 999, emberCount: -2, ringSpeedMps: 1e5,
      lightIntensity: -1, seed: 12.7, smokeOpacity: 5, ringOpacity: -1,
    });
    expect(t.gain).toBe(64);
    expect(t.fireScale).toBe(0.05);
    expect(t.lifeSec).toBe(0.05);
    expect(t.fireCount).toBe(3); // floored: 3.9 billboards is not drawable
    expect(t.smokeCount).toBe(EXPLOSION_VFX_LIMITS.maxSmokePerBurst);
    expect(t.emberCount).toBe(0);
    expect(t.ringSpeedMps).toBe(400);
    expect(t.lightIntensity).toBe(0);
    expect(t.seed).toBe(12);
    expect(t.smokeOpacity).toBe(1);
    expect(t.ringOpacity).toBe(0);
  });

  it('turns a non-finite panel value into a usable one instead of NaN', () => {
    const t = clampTuning({
      ...EXPLOSION_VFX_TUNING,
      gain: NaN, lifeSec: Infinity, fireCount: NaN, seed: NaN,
    });
    expect(t.gain).toBe(0);
    expect(t.lifeSec).toBe(0.05);
    expect(t.fireCount).toBe(0);
    expect(t.seed).toBe(0);
  });

  it('keeps the shipped defaults inside their own limits', () => {
    const L = EXPLOSION_VFX_LIMITS;
    const d = EXPLOSION_VFX_TUNING;
    expect(d.fireCount).toBeLessThanOrEqual(L.maxFirePerBurst);
    expect(d.smokeCount).toBeLessThanOrEqual(L.maxSmokePerBurst);
    expect(d.emberCount).toBeLessThanOrEqual(L.maxEmberPerBurst);
    expect(d.fireCount + d.smokeCount + d.emberCount + 1).toBe(L.billboardsPerDefaultBurst);
    // The brief's budget: "well under ~40" billboards per burst.
    expect(L.billboardsPerDefaultBurst).toBeLessThan(40);
    expect(clampTuning({ ...d })).toEqual(d);
  });
});

// ————————————————————————————————————————————————————————————————————————
// Air vs ground anchoring
// ————————————————————————————————————————————————————————————————————————

describe('air vs ground anchoring', () => {
  it('an airburst is centred on the detonation point', () => {
    const a = burstAnchor('air', [3, 5, -2], 2);
    expect(a.at).toEqual([3, 5, -2]);
    expect(a.centreY).toBe(5);
    expect(a.baseY).toBe(3);
    expect(a.halfHeightM).toBe(2);
    // The shockwave is a sphere shell: its silhouette is a circle, so the
    // ring billboards in the camera plane at the blast centre.
    expect(a.ring).toBe('billboard');
    expect(a.orient).toBe('ball');
  });

  it('a ground burst bottoms out on the floor and blooms upward', () => {
    const a = burstAnchor('ground', [3, 0.2, -2], 2);
    // The ring/dome sits at at.y...
    expect(a.baseY).toBe(0.2);
    // ...and the fireball's centre is ABOVE it, so the plume rises.
    expect(a.centreY).toBeGreaterThan(a.baseY);
    expect(a.centreY - a.baseY).toBeCloseTo(1, 12);
    expect(a.ring).toBe('flat');
    expect(a.orient).toBe('plume');
  });

  it('never aliases the caller\u2019s Vec3', () => {
    const at: [number, number, number] = [1, 2, 3];
    const a = burstAnchor('air', at, 1);
    at[1] = 99;
    expect(a.at).toEqual([1, 2, 3]);
  });
});

// ————————————————————————————————————————————————————————————————————————
// Material contract (construction only — no device)
// ————————————————————————————————————————————————————————————————————————

describe('material contract', () => {
  const u = makeExplosionLookUniforms();

  it('never uses the two flags this repo has been burned by, by default', () => {
    for (const layer of ['fire', 'smoke', 'ember', 'ring'] as const) {
      const m = createExplosionLookMaterial(layer, u);
      expect(m.alphaHash).toBe(false);
      expect(m.alphaTest).toBe(0);
      expect(m.transparent).toBe(true);
      // Occluded by the completed SDF depth buffer, never occluding itself.
      expect(m.depthTest).toBe(true);
      expect(m.depthWrite).toBe(false);
    }
  });

  it('is additive for the emissive layers and normal-blended for smoke', () => {
    expect(createExplosionLookMaterial('fire', u).blending).toBe(THREE.AdditiveBlending);
    expect(createExplosionLookMaterial('ember', u).blending).toBe(THREE.AdditiveBlending);
    expect(createExplosionLookMaterial('ring', u).blending).toBe(THREE.AdditiveBlending);
    expect(createExplosionLookMaterial('smoke', u).blending).toBe(THREE.NormalBlending);
  });

  it('can still build the known-bad controls, for the spike page only', () => {
    const hash = createExplosionLookMaterial('fire', u, { alphaControl: 'hash' });
    expect(hash.alphaHash).toBe(true);
    expect(hash.transparent).toBe(false);
    const test = createExplosionLookMaterial('fire', u, { alphaControl: 'test' });
    expect(test.alphaTest).toBe(0.5);
    expect(test.transparent).toBe(false);
  });
});

// ————————————————————————————————————————————————————————————————————————
// The whole effect, driven headlessly
// ————————————————————————————————————————————————————————————————————————

interface LayerView { count: number; positions: Float32Array }

function layerOf(vfx: ReturnType<typeof createExplosionVfx>, name: string): LayerView {
  const mesh = vfx.object.getObjectByName(name) as THREE.Mesh;
  const geo = mesh.geometry;
  return {
    count: geo.drawRange.count / 6,
    positions: (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array,
  };
}

/** Drive the same dt sequence through two instances and return their layer
 *  data — the reproducibility check the brief asks for. */
function run(seed: number, steps: number, dt: number) {
  const vfx = createExplosionVfx();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 1, 0);
  const scene = new THREE.Scene();
  scene.add(vfx.object);
  vfx.spawn(visual('ground', [0, 0, 0]), seed);
  const light: number[] = [];
  for (let i = 0; i < steps; i++) {
    vfx.update(dt, camera);
    light.push(vfx.lightIntensity);
  }
  return { vfx, light };
}

describe('createExplosionVfx', () => {
  it('preallocates one tree of four layers and starts hidden', () => {
    const vfx = createExplosionVfx();
    expect(vfx.object.children).toHaveLength(4);
    expect(vfx.activeBursts).toBe(0);
    expect(vfx.lightIntensity).toBe(0);
    for (const child of vfx.object.children) {
      expect((child as THREE.Mesh).isMesh).toBe(true);
      expect((child as THREE.Mesh).visible).toBe(false);
      expect((child as THREE.Mesh).frustumCulled).toBe(false);
    }
    vfx.dispose();
  });

  it('ships the curl and soft-fade switches OFF, so the game look is unchanged', () => {
    // game-main.ts uses these explosions. The curl domain-warp and the
    // soft-particle fade are opt-in until the owner flips them: a default of 0
    // contributes exactly zero to the node graph, which is what makes the
    // game's frame identical to the pre-curl one.
    expect(EXPLOSION_VFX_TUNING.curlStrength).toBe(0);
    expect(EXPLOSION_VFX_TUNING.softFade).toBe(0);

    const vfx = createExplosionVfx();
    expect(vfx.tuning.curlStrength).toBe(0);
    expect(vfx.tuning.softFade).toBe(0);

    // The live seam really applies them, and clamps them into bounds.
    vfx.setTuning({ curlStrength: 0.85, curlScale: 2.5, softFade: 0.35 });
    expect(vfx.tuning.curlStrength).toBeCloseTo(0.85, 12);
    expect(vfx.tuning.curlScale).toBeCloseTo(2.5, 12);
    expect(vfx.tuning.softFade).toBeCloseTo(0.35, 12);
    vfx.setTuning({ curlStrength: -5, curlScale: 0, softFade: -1 });
    expect(vfx.tuning.curlStrength).toBe(0);
    expect(vfx.tuning.curlScale).toBe(0.25);   // clamped to the floor
    expect(vfx.tuning.softFade).toBe(0);
    vfx.dispose();
  });

  it('curlWarpGain caps the warp amplitude at the fold-safe gradient', () => {
    // 2026-09-18 cross fix. A domain warp folds the noise lookup when its
    // spatial gradient reaches the lookup's own; the gradient goes as
    // appliedAmplitude / curlScale. The shipped look is below the cap, so it is
    // unchanged; tighter swirls are capped instead of folding.
    // At the shared 6 m scale the whole shipped strength applies.
    expect(curlWarpGain(1.1, 6)).toBeCloseTo(1.1, 12);
    expect(curlWarpGain(1.1, 12)).toBeCloseTo(1.1, 12);
    expect(curlWarpGain(1.1, 60)).toBeCloseTo(1.1, 12);
    // A strong request at 6 m is capped at the safe gradient, not passed on.
    expect(curlWarpGain(2.0, 6)).toBeCloseTo(0.2 * 6, 12);
    expect(curlWarpGain(2.0, 60)).toBeCloseTo(2.0, 12);
    // Below the reference scale the cap bites, but never below a request that
    // already sits under it.
    expect(curlWarpGain(1.1, 2.2)).toBeCloseTo(0.2 * 2.2, 12);
    expect(curlWarpGain(2.0, 2.2)).toBeCloseTo(0.2 * 2.2, 12);
    expect(curlWarpGain(0.4, 2.2)).toBeCloseTo(0.4, 12);
    // Off is off, and degenerate inputs never divide by zero.
    expect(curlWarpGain(0, 2.2)).toBe(0);
    expect(curlWarpGain(0, 0)).toBe(0);
    expect(curlWarpGain(-1, 2.2)).toBe(0);
    expect(curlWarpGain(1.1, 0)).toBe(0);
    // Monotone in scale, and never above the requested strength.
    let prev = -Infinity;
    for (const s of [0.25, 1, 2.2, 4, 6, 16, 64]) {
      const g = curlWarpGain(1.1, s);
      expect(g).toBeGreaterThanOrEqual(prev);
      expect(g).toBeLessThanOrEqual(1.1);
      prev = g;
    }
    // The old tight-spike scale folds at full strength; the recommended 6 m
    // scale keeps the whole strength and is cross-free.
    expect(curlWarpGain(1.1, 2.2)).toBeLessThan(1.1);
    expect(curlWarpGain(1.1, 6)).toBeGreaterThan(curlWarpGain(1.1, 2.2));
  });

  it('spawn -> live -> retire, with the light trailing the fire', () => {
    const vfx = createExplosionVfx();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 8);
    const scene = new THREE.Scene();
    scene.add(vfx.object);

    vfx.spawn(visual('ground', [0, 0, 0]), 1);
    expect(vfx.activeBursts).toBe(1);

    vfx.update(0.016, camera);
    // 16 ms is not enough for a billboard to have ignited from cold — the
    // envelope deliberately ramps. Give it a few frames.
    for (let i = 0; i < 4; i++) vfx.update(0.016, camera);
    const first = layerOf(vfx, 'ExplosionFire').count;
    expect(first).toBeGreaterThan(0);
    expect(layerOf(vfx, 'ExplosionShockwave').count).toBe(48); // one annulus
    expect(vfx.lightIntensity).toBeGreaterThan(0);

    // The light is out long before the burst is: a detonation flash, not a
    // lamp that stays lit for the fireball's whole life.
    let litAtHalf = 0;
    for (let i = 0; i < 60; i++) vfx.update(1 / 60, camera); // ~1.0 s
    litAtHalf = vfx.lightIntensity;
    expect(litAtHalf).toBeLessThan(EXPLOSION_VFX_TUNING.lightIntensity * 0.2);

    for (let i = 0; i < 60; i++) vfx.update(1 / 60, camera); // past lifeSec
    expect(vfx.activeBursts).toBe(0);
    expect(vfx.lightIntensity).toBe(0);
    expect(layerOf(vfx, 'ExplosionFire').count).toBe(0);
    expect(layerOf(vfx, 'ExplosionSmoke').count).toBe(0);
    expect(layerOf(vfx, 'ExplosionEmbers').count).toBe(0);
    expect(layerOf(vfx, 'ExplosionShockwave').count).toBe(0);
    for (const child of vfx.object.children) expect((child as THREE.Mesh).visible).toBe(false);
    vfx.dispose();
  });

  it('never exceeds the per-burst billboard budget, at any tuning', () => {
    const vfx = createExplosionVfx();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 3, 9);
    camera.lookAt(0, 1, 0);
    vfx.setTuning({
      fireCount: 999, smokeCount: 999, emberCount: 999, lifeSec: 3,
    });
    for (let i = 0; i < 20; i++) vfx.spawn(visual('ground', [i * 0.1, 0, 0]), 100 + i);
    // Every slot live and saturated.
    expect(vfx.activeBursts).toBe(EXPLOSION_VFX_LIMITS.maxBursts);
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      vfx.update(0.02, camera);
      const total = layerOf(vfx, 'ExplosionFire').count
        + layerOf(vfx, 'ExplosionSmoke').count
        + layerOf(vfx, 'ExplosionEmbers').count
        + layerOf(vfx, 'ExplosionShockwave').count / 48;
      peak = Math.max(peak, total);
    }
    const cap = EXPLOSION_VFX_LIMITS.maxBursts * (
      EXPLOSION_VFX_LIMITS.maxFirePerBurst + EXPLOSION_VFX_LIMITS.maxSmokePerBurst
      + EXPLOSION_VFX_LIMITS.maxEmberPerBurst + 1);
    expect(peak).toBeLessThanOrEqual(cap);
    // ...and the caps really are the caps, not "whatever fitted".
    expect(cap).toBe(306);
    vfx.dispose();
  });

  it('recycles slots under rapid fire instead of refusing to spawn', () => {
    const vfx = createExplosionVfx();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 8);
    for (let i = 0; i < 40; i++) {
      vfx.spawn(visual('air', [i, 2, 0]), i);
      vfx.update(0.033, camera);
      expect(vfx.activeBursts).toBeLessThanOrEqual(EXPLOSION_VFX_LIMITS.maxBursts);
      expect(vfx.activeBursts).toBeGreaterThan(0);
    }
    vfx.dispose();
  });

  it('is reproducible: a pinned seed and dt sequence give identical geometry', () => {
    const a = run(4242, 30, 1 / 60);
    const b = run(4242, 30, 1 / 60);
    for (const name of ['ExplosionFire', 'ExplosionSmoke', 'ExplosionEmbers', 'ExplosionShockwave']) {
      const la = layerOf(a.vfx, name);
      const lb = layerOf(b.vfx, name);
      expect(la.count).toBe(lb.count);
      expect(la.count).toBeGreaterThan(0);
      expect(Array.from(la.positions)).toEqual(Array.from(lb.positions));
    }
    expect(a.light).toEqual(b.light);
    // A different pinned seed must actually change the burst.
    const c = run(99, 30, 1 / 60);
    expect(Array.from(layerOf(c.vfx, 'ExplosionFire').positions))
      .not.toEqual(Array.from(layerOf(a.vfx, 'ExplosionFire').positions));
    a.vfx.dispose(); b.vfx.dispose(); c.vfx.dispose();
  });

  it('lightIntensity 0 really disables the dynamic light', () => {
    const vfx = createExplosionVfx();
    const camera = new THREE.PerspectiveCamera();
    vfx.setTuning({ lightIntensity: 0 });
    vfx.spawn(visual('air', [0, 2, 0]), 5);
    for (let i = 0; i < 10; i++) {
      vfx.update(0.02, camera);
      expect(vfx.lightIntensity).toBe(0);
    }
    vfx.dispose();
  });

  it('the smoke and ring opacity switches really remove their layers', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 8);
    const vfx = createExplosionVfx();
    vfx.setTuning({ smokeOpacity: 0, ringOpacity: 0 });
    vfx.spawn(visual('ground', [0, 0, 0]), 11);
    let smoke = 0, ring = 0, fire = 0;
    for (let i = 0; i < 90; i++) {
      vfx.update(1 / 60, camera);
      smoke = Math.max(smoke, layerOf(vfx, 'ExplosionSmoke').count);
      ring = Math.max(ring, layerOf(vfx, 'ExplosionShockwave').count);
      fire = Math.max(fire, layerOf(vfx, 'ExplosionFire').count);
    }
    expect(smoke).toBe(0);
    expect(ring).toBe(0);
    expect(fire).toBeGreaterThan(0);
    vfx.dispose();
  });

  it('update() is stable under a hitch and under a paused/negative frame', () => {
    const vfx = createExplosionVfx();
    const camera = new THREE.PerspectiveCamera();
    vfx.setTuning({ lifeSec: 1 });
    vfx.spawn(visual('ground', [0, 0, 0]), 3);
    vfx.update(0, camera);          // a paused frame must not advance the burst
    expect(vfx.activeBursts).toBe(1);
    vfx.update(-4, camera);         // a negative dt must not run it backwards
    expect(vfx.activeBursts).toBe(1);
    // A 2-second hitch is clamped to 50 ms, so the burst is still alive.
    vfx.update(2, camera);
    expect(vfx.activeBursts).toBe(1);
    vfx.dispose();
  });

  it('disposes cleanly and is safe to dispose twice', () => {
    const vfx = createExplosionVfx();
    const scene = new THREE.Scene();
    scene.add(vfx.object);
    vfx.spawn(visual('air', [0, 0, 0]), 1);
    vfx.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => vfx.dispose()).not.toThrow();
  });

  it('setTuning is live and clamped through the public seam', () => {
    const vfx = createExplosionVfx();
    const identity = vfx.tuning;
    vfx.setTuning({ gain: 4, lifeSec: 99 });
    expect(vfx.tuning).toBe(identity);    // the seam is stable, not a new object
    expect(vfx.tuning.gain).toBe(4);
    expect(vfx.tuning.lifeSec).toBe(10);  // clamped
    expect(vfx.tuning.fireCount).toBe(EXPLOSION_VFX_TUNING.fireCount);
    vfx.dispose();
  });
});
