// src/lab/sdf-zombie/webgpu/march/lean-walk-wiring.test.ts
//
// The lean walk's splices (lean-walk-flag.ts) are pure insertions. `?leanwalk=0` is the march without it; the default
// (walk only) and `?leanwalk` (walk and probe) are that text plus the inserted lines and nothing else, and each field
// call keeps ONE mapBody( site.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as DEFAULT from '../march.wgsl';
import { HULL_BOUNDS_BLOCK } from './body/blocks/setup/hull-bounds.wgsl';
import { LEAN_WALK, LEAN_WALK_PROBE } from './lean-walk-flag';
import { LEAN_CENSUS_BLOCK, LEAN_TEST_BLOCK, MAP_LEAN } from './lean-walk.wgsl';

const count = (s: string, needle: string) => s.split(needle).length - 1;
// The flag is read from globalThis.location at module load. The test environment is node, so there is no location
// (the default); stub one and re-import the barrel and everything under it fresh.
const load = async (search: string, walk: boolean, probe: boolean) => {
  vi.resetModules();
  vi.stubGlobal('location', { search });
  const flag = await import('./lean-walk-flag');
  expect(flag.LEAN_WALK).toBe(walk);
  expect(flag.LEAN_WALK_PROBE).toBe(probe);
  return await import('../march.wgsl');
};
const loadOff = () => load('?leanwalk=0', false, false);
const loadProbe = () => load('?leanwalk', true, true);
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const WALK_ON = '    var dres = vec4<f32>(0.0);\n    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else { dres = ';
const WALK_TAIL_ON = 'segVolumeMeta, perfCfg, inst, instCfg); }\n    gWalkStep = 0.0;';
const WALK_TAIL_OFF = 'segVolumeMeta, perfCfg, inst, instCfg);\n    gWalkStep = 0.0;';
const PROBE_ON = 'if (leanOk) { dres0 = mapLean(camPos + rd * s, data, inst, instCfg); } else { ';
const PROBE_TAIL_ON = 'segVolumeMeta, perfCfg, inst, instCfg); }\n        if (probe == 3';
const PROBE_TAIL_OFF = 'segVolumeMeta, perfCfg, inst, instCfg);\n        if (probe == 3';

describe('the flag\'s values', () => {
  it('no parameter is the walk-only form', () => {
    expect(LEAN_WALK).toBe(true);
    expect(LEAN_WALK_PROBE).toBe(false);
  });
  it('?leanwalk=walk is the default spelled out; ?leanwalk=probe is ?leanwalk', async () => {
    const W = await load('?leanwalk=walk', true, false);
    expect(W.MARCH_TRACE_SETUP).toBe(DEFAULT.MARCH_TRACE_SETUP);
    expect(W.MARCH_TRACE_LOOP).toBe(DEFAULT.MARCH_TRACE_LOOP);
    const P = await load('?leanwalk=probe', true, true);
    const Q = await loadProbe();
    expect(P.MARCH_TRACE_SETUP).toBe(Q.MARCH_TRACE_SETUP);
  });
});

describe('?leanwalk=0: the march without the lean walk', () => {
  it('carries no trace of it', async () => {
    const OFF = await loadOff();
    const all = [OFF.MAP_BODY, OFF.MARCH_TRACE_SETUP, OFF.MARCH_TRACE_LOOP, OFF.MARCH_TRACE_POST, (OFF.HELPERS as string[]).join('\n')].join('\n');
    // Code only: the tile reference list's comments (on by default, tile-ref-flag.ts) name mapLean as a reader.
    expect(all.replace(/\/\/.*$/gm, '')).not.toMatch(/mapLean|leanOk|debugCfg\.x\) > 22\.5/);
    expect(OFF.MARCH_TRACE_LOOP).toContain('    let dres = mapBody(camPos + rd * t, ');
  });
  it('exports the same names and the same number of helpers', async () => {
    const OFF = await loadOff();
    expect(Object.keys(OFF).sort()).toEqual(Object.keys(DEFAULT).sort());
    expect((OFF.HELPERS as string[]).length).toBe((DEFAULT.HELPERS as string[]).length);
    expect(OFF.MARCH_TRACE_POST).toBe(DEFAULT.MARCH_TRACE_POST);
  });
});

describe('the default: the walk takes mapLean, the temporal probe stays on mapBody', () => {
  it('appends mapLean to mapBody\'s tail and changes nothing else in it', async () => {
    const OFF = await loadOff();
    expect(DEFAULT.MAP_BODY).toBe(`${OFF.MAP_BODY}\n${MAP_LEAN}`);
  });
  it('puts the per-pixel test after the slot table and the wound list, before the hull bounds, and adds nothing else to the setup', async () => {
    const OFF = await loadOff();
    const setup = DEFAULT.MARCH_TRACE_SETUP;
    expect(count(setup, LEAN_TEST_BLOCK)).toBe(1);
    expect(setup.replace(`${LEAN_TEST_BLOCK}\n`, '')).toBe(OFF.MARCH_TRACE_SETUP);
    const at = setup.indexOf('var leanOk');
    expect(at).toBeGreaterThan(setup.indexOf('gWoundListOn = select('));
    expect(at).toBeGreaterThan(setup.indexOf('gPixN = gPixN + 1;'));
    expect(at).toBeLessThan(setup.indexOf(HULL_BOUNDS_BLOCK));
    expect(at).toBeLessThan(setup.indexOf('dres0 = mapBody('));
    expect(count(setup, 'mapLean(')).toBe(0);
  });
  it('the walk chooses per pixel at ONE mapBody call site', async () => {
    const OFF = await loadOff();
    const loop = DEFAULT.MARCH_TRACE_LOOP;
    expect(count(loop, 'mapBody(')).toBe(count(OFF.MARCH_TRACE_LOOP, 'mapBody('));
    expect(count(loop, 'mapLean(')).toBe(1);
    expect(count(loop, WALK_ON)).toBe(1);
    expect(count(loop, WALK_TAIL_ON)).toBe(1);
    const back = loop.replace(WALK_ON, '    let dres = ').replace(WALK_TAIL_ON, WALK_TAIL_OFF).replace(LEAN_CENSUS_BLOCK, '');
    expect(back).toBe(OFF.MARCH_TRACE_LOOP);
  });
  it('the census sits with the other raw-counter modes, before the miss discard', () => {
    expect(count(DEFAULT.MARCH_TRACE_LOOP, LEAN_CENSUS_BLOCK)).toBe(1);
    expect(DEFAULT.MARCH_TRACE_LOOP.endsWith(`${LEAN_CENSUS_BLOCK}\n`)).toBe(true);
  });
});

describe('?leanwalk: the temporal start\'s probe on mapLean too', () => {
  it('the probe chooses per pixel at ONE mapBody call site, and nothing else differs from the default', async () => {
    const P = await loadProbe();
    const setup = P.MARCH_TRACE_SETUP;
    expect(count(setup, 'mapBody(')).toBe(count(DEFAULT.MARCH_TRACE_SETUP, 'mapBody('));
    expect(count(setup, 'mapLean(')).toBe(1);
    expect(count(setup, PROBE_ON)).toBe(1);
    expect(count(setup, PROBE_TAIL_ON)).toBe(1);
    expect(setup.replace(PROBE_ON, '').replace(PROBE_TAIL_ON, PROBE_TAIL_OFF)).toBe(DEFAULT.MARCH_TRACE_SETUP);
    expect(P.MARCH_TRACE_LOOP).toBe(DEFAULT.MARCH_TRACE_LOOP);
    expect(P.MAP_BODY).toBe(DEFAULT.MAP_BODY);
  });
});
