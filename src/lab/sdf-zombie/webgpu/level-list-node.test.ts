// src/lab/sdf-zombie/webgpu/level-list-node.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
// @ts-expect-error — deep three source import for the real wgslFn parser (same pattern as probe-lighting-node.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { LEVEL_LIST_WGSL, LevelListLightingNode } from './level-list-node';
import { LIGHT_VEC4S, LIST_LIGHTS_AT, LIST_VEC4S } from './light-list';
import { LEVEL_POINT_DECAY, LEVEL_SPOT_DECAY } from './level-tier';
import { levelLightsNode } from './probe-lighting-node';

const listNode = () => storage(new THREE.StorageBufferAttribute(LIST_VEC4S * 4, 4), 'vec4', LIST_VEC4S).toReadOnly();

describe('LEVEL_LIST_WGSL — the node\'s evaluator', () => {
  it('starts with fn levelListIrradiance and parses to its six inputs, in order', () => {
    expect(LEVEL_LIST_WGSL.startsWith('fn levelListIrradiance(')).toBe(true);
    const parsed = new WGSLNodeFunction(LEVEL_LIST_WGSL);
    expect(parsed.inputs.map((i: { name: string }) => i.name)).toEqual(['p', 'n', 'picksA', 'picksB', 'count', 'lights']);
  });
  it('takes its layout constants from light-list.ts and its decays from level-tier.ts', () => {
    expect(LEVEL_LIST_WGSL).toContain(`let base = ${LIST_LIGHTS_AT} + i32(iv) * ${LIGHT_VEC4S};`);
    expect(LEVEL_LIST_WGSL).toContain(`select(${LEVEL_POINT_DECAY.toFixed(1)}, ${LEVEL_SPOT_DECAY.toFixed(1)}, isSpot)`);
  });
  it('mirrors the CPU twin: three\'s window, the packed cone, n.L, no specular', () => {
    expect(LEVEL_LIST_WGSL).toContain('1.0 - pow(d / cutoff, 4.0)');
    expect(LEVEL_LIST_WGSL).toContain('floor(a2.w) / 1000.0');
    expect(LEVEL_LIST_WGSL).toContain('fract(a2.w) / 0.999');
    expect(LEVEL_LIST_WGSL).toContain('-dot(L, a2.xyz)');
    expect(LEVEL_LIST_WGSL).not.toContain('pow(max(dot(n, H)');
  });
});

describe('LevelListLightingNode', () => {
  it('is a LightingNode whose picks start empty and setPicks writes all eight slots', () => {
    const node = new LevelListLightingNode(listNode());
    expect(node.isLightingNode).toBe(true);
    expect(node.picksA.value.toArray()).toEqual([-1, -1, -1, -1]);
    expect(node.picksB.value.toArray()).toEqual([-1, -1, -1, -1]);
    expect(node.count.value).toBe(0);
    node.setPicks([3, 7, -1, -1, 9, -1, -1, -1]);
    expect(node.count.value).toBe(2);   // the loop bound: leading live picks (the packer fills from the front)
    expect(node.picksA.value.toArray()).toEqual([3, 7, -1, -1]);
    expect(node.picksB.value.toArray()).toEqual([9, -1, -1, -1]);
    node.dispose();
  });
  it('rides at the END of a level light list, after the probe node', () => {
    const extra = new LevelListLightingNode(listNode());
    const probeLike = new (THREE.LightingNode as unknown as new () => THREE.LightingNode)();
    const list = levelLightsNode([], probeLike as never, [extra]);
    const got = list.getLights();
    expect(got.at(-1)).toBe(extra as unknown as THREE.Light);
    expect(got.at(-2)).toBe(probeLike as unknown as THREE.Light);
  });
});
