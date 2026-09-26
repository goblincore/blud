// src/lab/sdf-zombie/webgpu/march/body/blocks/light/light-list.wgsl.test.ts
//
// Shared light list plan 1, Task 9: text pins for the march reading the list. Nothing here
// compiles WGSL (the headless light gate does); these pin the gate, the call, the splice point,
// the dominant's wrap and the compose add, and that the off path keeps the old expressions.

import { describe, expect, it } from 'vitest';
import { LIGHT_LIST_BLOCK } from './light-list.wgsl';
import { FLASHLIGHT_BLOCK } from './flashlight.wgsl';
import { COMPOSE_BLOCK } from './compose.wgsl';
import { MARCH_BODY_LIGHT } from '../../light.wgsl';
import { MARCH_BODY, REFINE_BODY } from '../../entry.wgsl';

describe('LIGHT_LIST_BLOCK', () => {
  it('is gated on lightListCfg.x and calls bodyLights with skipFirst = true', () => {
    expect(LIGHT_LIST_BLOCK).toContain('if (lightListCfg.x > 0.0) {');
    expect(LIGHT_LIST_BLOCK).toContain('bodyLights(p, n, -rd, gInstLights, lightList, true)');
  });

  it('replaces the key with the dominant: L, keyC normalised to peak 1, keyI the peak', () => {
    expect(LIGHT_LIST_BLOCK).toContain('let peak = max(bl.domC.x, max(bl.domC.y, bl.domC.z));');
    expect(LIGHT_LIST_BLOCK).toContain('L = bl.domL;');
    expect(LIGHT_LIST_BLOCK).toContain('keyC = bl.domC / max(peak, 1e-4);');
    expect(LIGHT_LIST_BLOCK).toContain('keyI = peak;');
  });

  it('declares the list terms zero OUTSIDE the gate, so the off path adds exact zeros', () => {
    const gate = LIGHT_LIST_BLOCK.indexOf('if (lightListCfg.x > 0.0) {');
    for (const d of ['var listDiff = vec3<f32>(0.0);', 'var listSpec = vec3<f32>(0.0);',
      'var listRim = vec3<f32>(0.0);', 'var listDomFloor = 0.0;']) {
      const at = LIGHT_LIST_BLOCK.indexOf(d);
      expect(at, d).toBeGreaterThan(-1);
      expect(at, d).toBeLessThan(gate);
    }
  });
});

describe('MARCH_BODY_LIGHT splice', () => {
  it('splices the block right after FLASHLIGHT_BLOCK, before V and the dominant wrap', () => {
    expect(MARCH_BODY_LIGHT).toContain(`${FLASHLIGHT_BLOCK}\n${LIGHT_LIST_BLOCK}\n  let V = -rd;`);
  });

  it('the dominant wraps by its floor only when the list is on; off keeps the old expression', () => {
    expect(MARCH_BODY_LIGHT).toContain('var diff = max(dot(n, L), 0.0);');
    expect(MARCH_BODY_LIGHT).toContain('if (lightListCfg.x > 0.0) { diff = max((dot(n, L) + listDomFloor) / (1.0 + listDomFloor), 0.0); }');
    expect(MARCH_BODY_LIGHT).not.toContain('let diff = max(dot(n, L), 0.0);');
  });

  it('compose adds the other lights through AO, right after fleshLit', () => {
    const line = 'fleshLit = fleshLit + (listDiff * albedo + listSpec) * ao + listRim;';
    expect(COMPOSE_BLOCK).toContain(line);
    expect(COMPOSE_BLOCK.indexOf(line)).toBeGreaterThan(COMPOSE_BLOCK.indexOf('var fleshLit = albedo *'));
    expect(COMPOSE_BLOCK.indexOf(line)).toBeLessThan(COMPOSE_BLOCK.indexOf('if (spotCfg2.w > 0.0) {'));
    expect(MARCH_BODY_LIGHT).toContain(line);
  });

  it('both lit entries carry the block exactly once', () => {
    for (const e of [MARCH_BODY, REFINE_BODY]) {
      expect(e.split('bodyLights(p, n, -rd, gInstLights, lightList, true)').length).toBe(2);
    }
  });
});
