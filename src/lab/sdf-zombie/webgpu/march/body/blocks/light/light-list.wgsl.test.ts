// src/lab/sdf-zombie/webgpu/march/body/blocks/light/light-list.wgsl.test.ts
//
// Shared light list plan 1, Task 9: text pins for the march reading the list. Nothing here
// compiles WGSL (the headless light gate does); these pin the gate, the call, the splice point,
// the dominant's wrap and the compose add, and that the off path keeps the old expressions.

import { describe, expect, it } from 'vitest';
import { LIGHT_LIST_BLOCK } from './light-list.wgsl';
import { FLASHLIGHT_BLOCK } from './flashlight.wgsl';
import { COMPOSE_BLOCK } from './compose.wgsl';
import { OCCLUSION_BLOCK } from './occlusion.wgsl';
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
    expect(LIGHT_LIST_BLOCK).toContain('keyC = select(keyC, bl.domC / max(peak, 1e-4), peak > 1e-4);');
    expect(LIGHT_LIST_BLOCK).not.toContain('    keyC = bl.domC / max(peak, 1e-4);');
    expect(LIGHT_LIST_BLOCK).toContain('keyI = peak;');
  });

  it('a gib chunk view (lightListCfg.y > 0.5) drops the back rims; bodies (y = 0) keep them (owner, 2026-09-27)', () => {
    expect(LIGHT_LIST_BLOCK).toContain('listRim = select(bl.rim, vec3<f32>(0.0), lightListCfg.y > 0.5);');
    expect(LIGHT_LIST_BLOCK).not.toContain('    listRim = bl.rim;');
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
    expect(MARCH_BODY_LIGHT).toContain('if (lightListCfg.x > 0.0) { diff = max((dot(n, Lk) + listDomFloor) / (1.0 + listDomFloor), 0.0); }');
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

describe('Task 9 review: list mode keeps the rim, the shoulder and viewBias; no flashlight shadow', () => {
  it('Lk is declared as L before the gate (off: Lk == L) and set to the dominant Lb inside it', () => {
    const gate = LIGHT_LIST_BLOCK.indexOf('if (lightListCfg.x > 0.0) {');
    const decl = LIGHT_LIST_BLOCK.indexOf('var Lk = L;');
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(gate);
    expect(LIGHT_LIST_BLOCK.indexOf('Lk = bl.domLb;')).toBeGreaterThan(gate);
  });

  it('H and the list-mode wrap use Lk; the off diff stays max(dot(n, L), 0)', () => {
    expect(MARCH_BODY_LIGHT).toContain('let H = normalize(Lk + V);');
    expect(MARCH_BODY_LIGHT).not.toContain('let H = normalize(L + V);');
    expect(MARCH_BODY_LIGHT).toContain('var diff = max(dot(n, L), 0.0);');
    expect(MARCH_BODY_LIGHT).toContain('if (lightListCfg.x > 0.0) { diff = max((dot(n, Lk) + listDomFloor) / (1.0 + listDomFloor), 0.0); }');
  });

  it('scatter and the wound shadow keep the raw L', () => {
    expect(OCCLUSION_BLOCK).toContain('p + L * 0.06');
    expect(OCCLUSION_BLOCK).toContain('woundShadow(p, L, ');
    expect(OCCLUSION_BLOCK).not.toMatch(/\bLk\b/);
  });

  it('the level shadow is 1.0 in list mode, computed only when the list is off', () => {
    expect(OCCLUSION_BLOCK).toContain('var lvl = 1.0;');
    expect(OCCLUSION_BLOCK).toContain('if (lightListCfg.x <= 0.0) { lvl = levelShadow(p, n, levelShadowTex, levelShadowMatrix, levelShadowCfg); }');
    expect(OCCLUSION_BLOCK).not.toContain('let lvl = ');
  });

  it('the highlight shoulder runs for the beam OR the list', () => {
    expect(COMPOSE_BLOCK).toContain('if ((spotCfg.x > 0.0 || lightListCfg.x > 0.0) && spotCfg2.y > 0.0) {');
    expect(COMPOSE_BLOCK).not.toContain('if (spotCfg.x > 0.0 && spotCfg2.y > 0.0) {');
  });

  it('the beam shoulder (owner 2026-09-27): listBeam from bodyLights picks a hue-preserving luminance tail; 0 keeps the exponential shoulder', () => {
    expect(LIGHT_LIST_BLOCK).toContain('var listBeam = 0.0;');
    expect(LIGHT_LIST_BLOCK).toContain('listBeam = bl.beam;');
    expect(LIGHT_LIST_BLOCK.indexOf('listBeam = bl.beam;')).toBeGreaterThan(LIGHT_LIST_BLOCK.indexOf('if (lightListCfg.x > 0.0) {'));
    expect(COMPOSE_BLOCK).toContain('if (listBeam > 0.0) {');
    // The CPU reference is light-shade.ts beamTail: the same four lines.
    expect(COMPOSE_BLOCK).toContain('let lumIn = dot(fleshLit, vec3<f32>(0.2126, 0.7152, 0.0722));');
    expect(COMPOSE_BLOCK).toContain('let lumOut = select(lumIn, knee + head * tl / (1.0 + tl), lumIn > knee);');
    expect(COMPOSE_BLOCK).toContain('let hued = fleshLit * (lumOut / max(lumIn, 1e-4));');
    expect(COMPOSE_BLOCK).toContain('let beamTail = vec3<f32>(softShoulder(hued.x, 0.9), softShoulder(hued.y, 0.9), softShoulder(hued.z, 0.9));');
    expect(COMPOSE_BLOCK).not.toContain('knee - 0.1');
    expect(COMPOSE_BLOCK).toContain('fleshLit = mix(shoulder, beamTail, clamp(listBeam, 0.0, 1.0));');
    expect(COMPOSE_BLOCK).toContain('} else {\n      fleshLit = shoulder;\n    }');
  });

  it('the flashlight beam is skipped in list mode; beamAmt, its only other output, is unread', () => {
    expect(FLASHLIGHT_BLOCK).toContain('if (spotCfg.x > 0.0 && lightListCfg.x <= 0.0) {');
    for (const e of [MARCH_BODY, REFINE_BODY]) {
      const code = e.replace(/\/\/.*$/gm, '');
      expect(code.match(/\bbeamAmt\b/g)?.length).toBe(2);   // the var and the one write
    }
  });
});
