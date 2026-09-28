// src/lab/sdf-zombie/webgpu/light-layers.test.ts
import { describe, expect, it } from 'vitest';
import { LIGHT_LAYERS, layerOn, layerState, onLayerChange, parseLayers, setLayer } from './light-layers';
import { LIGHT_LIST_BLOCK } from './march/body/blocks/light/light-list.wgsl';
import { FLASHLIGHT_BLOCK } from './march/body/blocks/light/flashlight.wgsl';

describe('light layers (owner 2026-09-28: all off = the melee branch body lighting)', () => {
  it('parses ?layers=: none/absent, all, and a comma list (unknown keys dropped)', () => {
    expect(parseLayers(null).size).toBe(0);
    expect(parseLayers('none').size).toBe(0);
    expect(parseLayers('all').size).toBe(LIGHT_LAYERS.length);
    expect([...parseLayers('list, sCurve,bogus')]).toEqual(['list', 'sCurve']);
  });
  it('defaults all off in node, and setLayer notifies once per real change', () => {
    expect(Object.values(layerState()).every(v => v === false)).toBe(true);
    const seen: string[] = [];
    onLayerChange((k, v) => seen.push(`${k}=${v}`));
    setLayer('bodyFog', true);
    setLayer('bodyFog', true);
    expect(layerOn('bodyFog')).toBe(true);
    setLayer('bodyFog', false);
    expect(seen).toEqual(['bodyFog=true', 'bodyFog=false']);
  });
  it('the hybrid torch (lane z): the old beam runs under the list and the list adds all four without taking the key', () => {
    expect(FLASHLIGHT_BLOCK).toContain('if (spotCfg.x > 0.0 && (lightListCfg.x <= 0.0 || lightListCfg.z > 0.5)) {');
    const hyb = LIGHT_LIST_BLOCK.slice(LIGHT_LIST_BLOCK.indexOf('if (lightListCfg.x > 0.0 && lightListCfg.z > 0.5) {'), LIGHT_LIST_BLOCK.indexOf('} else if (lightListCfg.x > 0.0) {'));
    expect(hyb).toContain('bodyLights(p, n, -rd, gInstLights, lightList, false, true)');
    expect(hyb).not.toMatch(/\bL = |\bkeyC = |\bkeyI = |listBeam = /);
  });
});
