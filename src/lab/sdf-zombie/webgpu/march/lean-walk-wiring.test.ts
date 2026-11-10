// src/lab/sdf-zombie/webgpu/march/lean-walk-wiring.test.ts
//
// The `?leanwalk` splices (lean-walk-flag.ts) are pure insertions: flag off, no trace in the barrel's text; flag on,
// removing the inserted text gives back the flag-off text byte for byte, and each field call keeps ONE mapBody( site.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as OFF from '../march.wgsl';
import { HULL_BOUNDS_BLOCK } from './body/blocks/setup/hull-bounds.wgsl';
import { LEAN_CENSUS_BLOCK, LEAN_TEST_BLOCK, MAP_LEAN } from './lean-walk.wgsl';

const count = (s: string, needle: string) => s.split(needle).length - 1;
// The flag is read from globalThis.location at module load (lean-walk-flag.ts). The test environment is node, so
// there is no location; stub one and re-import the barrel and everything under it fresh.
const loadOn = async () => {
  vi.resetModules();
  vi.stubGlobal('location', { search: '?leanwalk' });
  const flag = await import('./lean-walk-flag');
  expect(flag.LEAN_WALK).toBe(true);
  return await import('../march.wgsl');
};
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const WALK_ON = '    var dres = vec4<f32>(0.0);\n    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else { dres = ';
const PROBE_ON = 'if (leanOk) { dres0 = mapLean(camPos + rd * s, data, inst, instCfg); } else { ';

describe('lean walk wiring, flag off', () => {
  it('leaves no trace in the shipped text', () => {
    const all = [OFF.MAP_BODY, OFF.MARCH_TRACE_SETUP, OFF.MARCH_TRACE_LOOP, OFF.MARCH_TRACE_POST, (OFF.HELPERS as string[]).join('\n')].join('\n');
    expect(all).not.toMatch(/mapLean|leanOk|debugCfg\.x > 22\.5/);
  });
});

describe('lean walk wiring, ?leanwalk', () => {
  it('really compiles different text (the stub flips the flag)', async () => {
    const ON = await loadOn();
    expect(ON.MAP_BODY).not.toBe(OFF.MAP_BODY);
    expect(ON.MARCH_TRACE_SETUP).not.toBe(OFF.MARCH_TRACE_SETUP);
    expect(ON.MARCH_TRACE_LOOP).not.toBe(OFF.MARCH_TRACE_LOOP);
    expect(ON.MARCH_TRACE_POST).toBe(OFF.MARCH_TRACE_POST);
  });
  it('appends mapLean to mapBody\'s tail and changes nothing else in it', async () => {
    const ON = await loadOn();
    expect(ON.MAP_BODY).toBe(`${OFF.MAP_BODY}\n${MAP_LEAN}`);
    expect((ON.HELPERS as string[]).length).toBe((OFF.HELPERS as string[]).length);
    expect(Object.keys(ON).sort()).toEqual(Object.keys(OFF).sort());
  });
  it('puts the per-pixel test after the wound list and before the hull bounds', async () => {
    const ON = await loadOn();
    expect(count(ON.MARCH_TRACE_SETUP, LEAN_TEST_BLOCK)).toBe(1);
    const at = ON.MARCH_TRACE_SETUP.indexOf('var leanOk');
    expect(at).toBeGreaterThan(ON.MARCH_TRACE_SETUP.indexOf('gWoundListOn = select('));
    expect(at).toBeGreaterThan(ON.MARCH_TRACE_SETUP.indexOf('gPixN = gPixN + 1;'));
    expect(at).toBeLessThan(ON.MARCH_TRACE_SETUP.indexOf(HULL_BOUNDS_BLOCK));
    expect(at).toBeLessThan(ON.MARCH_TRACE_SETUP.indexOf('dres0 = mapBody('));
  });
  it('the walk chooses per pixel at ONE mapBody call site', async () => {
    const ON = await loadOn();
    expect(count(ON.MARCH_TRACE_LOOP, 'mapBody(')).toBe(count(OFF.MARCH_TRACE_LOOP, 'mapBody('));
    expect(count(ON.MARCH_TRACE_LOOP, 'mapLean(')).toBe(1);
    expect(count(ON.MARCH_TRACE_LOOP, WALK_ON)).toBe(1);
    const back = ON.MARCH_TRACE_LOOP.replace(WALK_ON, '    let dres = ').replace('segVolumeMeta, perfCfg, inst, instCfg); }\n    gWalkStep = 0.0;', 'segVolumeMeta, perfCfg, inst, instCfg);\n    gWalkStep = 0.0;').replace(LEAN_CENSUS_BLOCK, '');
    expect(back).toBe(OFF.MARCH_TRACE_LOOP);
  });
  it('the temporal start\'s probe chooses per pixel at ONE mapBody call site', async () => {
    const ON = await loadOn();
    expect(count(ON.MARCH_TRACE_SETUP, 'mapBody(')).toBe(count(OFF.MARCH_TRACE_SETUP, 'mapBody('));
    expect(count(ON.MARCH_TRACE_SETUP, 'mapLean(')).toBe(1);
    expect(count(ON.MARCH_TRACE_SETUP, PROBE_ON)).toBe(1);
    const back = ON.MARCH_TRACE_SETUP.replace(`${LEAN_TEST_BLOCK}\n`, '').replace(PROBE_ON, '').replace('segVolumeMeta, perfCfg, inst, instCfg); }\n        if (probe == 3', 'segVolumeMeta, perfCfg, inst, instCfg);\n        if (probe == 3');
    expect(back).toBe(OFF.MARCH_TRACE_SETUP);
  });
  it('the census sits with the other raw-counter modes, before the miss discard', async () => {
    const ON = await loadOn();
    expect(ON.MARCH_TRACE_LOOP.endsWith(`${LEAN_CENSUS_BLOCK}\n`)).toBe(true);
    expect(count(ON.MARCH_TRACE_LOOP, LEAN_CENSUS_BLOCK)).toBe(1);
  });
});

describe('lean walk wiring, ?leanwalk=walk (the temporal probe stays on mapBody)', () => {
  const loadWalk = async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?leanwalk=walk' });
    const flag = await import('./lean-walk-flag');
    expect(flag.LEAN_WALK).toBe(true);
    expect(flag.LEAN_WALK_PROBE).toBe(false);
    return await import('../march.wgsl');
  };
  it('the setup still decides leanOk and the probe is the shipped line', async () => {
    const W = await loadWalk();
    expect(count(W.MARCH_TRACE_SETUP, 'mapLean(')).toBe(0);
    expect(W.MARCH_TRACE_SETUP.replace(`${LEAN_TEST_BLOCK}\n`, '')).toBe(OFF.MARCH_TRACE_SETUP);
  });
  it('the walk and mapBody\'s tail are the full flag\'s', async () => {
    const W = await loadWalk();
    const walkLoop = W.MARCH_TRACE_LOOP;
    const walkBody = W.MAP_BODY;
    const ON = await loadOn();
    expect(walkLoop).toBe(ON.MARCH_TRACE_LOOP);
    expect(walkBody).toBe(ON.MAP_BODY);
  });
  it('plain ?leanwalk moves the probe too', async () => {
    await loadOn();
    const flag = await import('./lean-walk-flag');
    expect(flag.LEAN_WALK_PROBE).toBe(true);
  });
});
