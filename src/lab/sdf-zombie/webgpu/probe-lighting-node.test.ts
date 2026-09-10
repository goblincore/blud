// src/lab/sdf-zombie/webgpu/probe-lighting-node.test.ts
//
// Pins for the level's probe lighting node (lighting P3/P4 step 3). Nothing
// here compiles WGSL or builds a material; the GPU gate is the in-game A/B
// (plan, Task 2). These pin what a refactor could silently break: the
// evaluators are the march's strings BY IDENTITY, the level wrapper parses to
// the nine declared inputs in order, the light list keeps the scene lights
// and ends with the probe node, and the match rule puts the probe level at
// the hemisphere's.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (same pattern as
// probe-grid.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import {
  PROBE_LEVEL_INCLUDES, PROBE_LEVEL_WGSL, ProbeLightingNode, createProbeLevelSlots,
  levelLightsNode, levelMatchedGain,
} from './probe-lighting-node';
import { PROBE_GRID_WGSL } from './probe-grid.wgsl';
import { PROBE_DYNAMIC_WGSL } from './probe-dynamic.wgsl';
import { SH_A0, SH_Y00, type ProbeGrid } from '../probe-grid';
import { luminance } from '../ambient';

describe('PROBE_LEVEL_WGSL — the level evaluates what the march evaluates', () => {
  it('includes the march\'s evaluators by identity, grid then dynamic', () => {
    expect(PROBE_LEVEL_INCLUDES[0]).toBe(PROBE_GRID_WGSL);
    expect(PROBE_LEVEL_INCLUDES[1]).toBe(PROBE_DYNAMIC_WGSL);
    expect(PROBE_LEVEL_INCLUDES.length).toBe(2);
  });

  it('calls both march evaluators and nothing else field-shaped', () => {
    expect(PROBE_LEVEL_WGSL).toContain('probeIrradiance(p, n, probeTex, probeMin, probeInvExtent, probeDims)');
    expect(PROBE_LEVEL_WGSL).toContain('probeDynamic(p, n, probeDyn, probeMin, probeInvExtent, probeDims)');
    expect(PROBE_LEVEL_WGSL).not.toContain('mapBody');
    expect(PROBE_LEVEL_WGSL).not.toContain('textureSample');
  });

  it('starts with fn probeLevelIrradiance, per the wgslFn parse contract', () => {
    expect(PROBE_LEVEL_WGSL.startsWith('fn probeLevelIrradiance(')).toBe(true);
  });

  it('the real wgslFn parser sees exactly the nine declared inputs, in order', () => {
    const parsed = new WGSLNodeFunction(PROBE_LEVEL_WGSL);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names).toEqual([
      'p', 'n', 'probeTex', 'probeDyn', 'probeMin', 'probeInvExtent', 'probeDims', 'probeCfg', 'probeDynCfg',
    ]);
  });

  it('composes the march\'s two terms with the march\'s gates', () => {
    // Static: weight AND gain must be on; dynamic: either gain on.
    expect(PROBE_LEVEL_WGSL).toContain('if (probeCfg.x > 0.0 && probeCfg.y > 0.0)');
    expect(PROBE_LEVEL_WGSL).toContain('* probeCfg.y * probeCfg.x');
    expect(PROBE_LEVEL_WGSL).toContain('if (probeDynCfg.x > 0.0 || probeDynCfg.y > 0.0)');
    expect(PROBE_LEVEL_WGSL).toContain('e * mix(1.0, dyn.w, probeDynCfg.y) + dyn.xyz * probeDynCfg.x');
  });

  it('returns the sum in the march\'s units: times PI, since three divides by PI in BRDF_Lambert', () => {
    expect(PROBE_LEVEL_WGSL).toContain(`return e * ${Math.PI};`);
  });
});

describe('ProbeLightingNode + levelLightsNode — the light list', () => {
  it('is a LightingNode whose slots start at the parity values', () => {
    const slots = createProbeLevelSlots();
    const node = new ProbeLightingNode(slots);
    expect(node.isLightingNode).toBe(true);
    expect(node.isProbeLightingNode).toBe(true);
    expect(slots.probeCfg.value.x).toBe(0);
    expect(slots.probeCfg.value.y).toBe(0);
    expect(slots.probeDynCfg.value.x).toBe(0);
    expect(slots.probeDynCfg.value.y).toBe(0);
    node.dispose();
  });

  it('two nodes never share a fallback texture (the one-texture-two-nodes trap)', () => {
    const a = createProbeLevelSlots(), b = createProbeLevelSlots();
    expect(a.ownedFallback).not.toBe(b.ownedFallback);
    expect(a.ownedFallback.uuid).not.toBe(b.ownedFallback.uuid);
  });

  it('lists the scene lights first, in the given order, and the probe node last', () => {
    const hemi = new THREE.HemisphereLight();
    const accent = new THREE.PointLight();
    const spot = new THREE.SpotLight();
    const node = new ProbeLightingNode(createProbeLevelSlots());
    const list = levelLightsNode([hemi, accent, spot], node);
    expect(list).toBeInstanceOf(THREE.LightsNode);
    const got = list.getLights();
    expect(got.length).toBe(4);
    expect(got[0]).toBe(hemi);
    expect(got[1]).toBe(accent);
    expect(got[2]).toBe(spot);
    expect(got[3]).toBe(node as unknown as THREE.Light);
    node.dispose();
  });

  it('a later setLights keeps the probe node when the caller re-appends it', () => {
    // The muzzle-flash PointLight is created after the level (gun load), so
    // the game re-lists; this pins the re-list shape it relies on.
    const hemi = new THREE.HemisphereLight();
    const flash = new THREE.PointLight();
    const node = new ProbeLightingNode(createProbeLevelSlots());
    const list = levelLightsNode([hemi], node);
    list.setLights([hemi, flash, node as unknown as THREE.Light]);
    expect(list.getLights().at(-1)).toBe(node as unknown as THREE.Light);
    expect(list.getLights()).toContain(flash);
    node.dispose();
  });
});

describe('levelMatchedGain — the probe level equals the hemisphere level', () => {
  /** A 1-probe grid whose L1-SH is a flat L0 lobe of the given colour: the
   *  irradiance for ANY normal is c * SH_A0 * SH_Y00 (see probe-grid.ts). */
  function flatGrid(c: [number, number, number]): ProbeGrid {
    return {
      dims: [1, 1, 1], min: [0, 0, 0], max: [4, 3, 4],
      // 3 vec4 per probe: (L0.r, L0.g, L0.b, 0), then the L1 lobes, all zero.
      sh: new Float32Array([c[0], c[1], c[2], 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    };
  }

  it('scales a flat grid to the hemisphere\'s mean luminance', () => {
    const grid = flatGrid([0.5, 0.5, 0.5]);
    const hemi = { sky: [0.34, 0.38, 0.44] as [number, number, number], ground: [0.13, 0.13, 0.12] as [number, number, number], intensity: 0.05 };
    const g = levelMatchedGain(grid, hemi);
    const probeLum = luminance([0.5, 0.5, 0.5]) * SH_A0 * SH_Y00;
    const hemiLum = 0.05 * luminance([(0.34 + 0.13) / 2, (0.38 + 0.13) / 2, (0.44 + 0.12) / 2]);
    // What the evaluator adds is probe * gain * PI; that must equal the hemi.
    expect(g * probeLum * Math.PI).toBeCloseTo(hemiLum, 9);
  });

  it('is 0 for a dark grid rather than infinite', () => {
    expect(levelMatchedGain(flatGrid([0, 0, 0]), { sky: [1, 1, 1], ground: [1, 1, 1], intensity: 1 })).toBe(0);
  });

  it('is 0 when the hemisphere is off (nothing to match)', () => {
    expect(levelMatchedGain(flatGrid([1, 1, 1]), { sky: [1, 1, 1], ground: [1, 1, 1], intensity: 0 })).toBe(0);
  });
});
