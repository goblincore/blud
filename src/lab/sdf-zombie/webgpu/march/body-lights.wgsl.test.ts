// src/lab/sdf-zombie/webgpu/march/body-lights.wgsl.test.ts
//
// Pins for the bodyLights WGSL. Nothing here compiles WGSL; the maths is unit-tested on the CPU
// twin (../light-shade.test.ts), and these pin the text: the parse contract, the buffer offsets,
// the guards, and that every profile param is read from the lane packProfiles writes it to.

import { describe, expect, it } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser; no public type
// declarations exist for three/src/* (same pattern as probe-dynamic.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { BODY_LIGHTS } from './body-lights.wgsl';
import { HELPERS } from './helpers';
import { LIGHT_VEC4S, LIST_LIGHTS_AT } from '../light-list';
import { LIGHT_PROFILES, PROFILE_VEC4S, packProfiles } from '../light-profiles';

describe('BODY_LIGHTS — parse contract', () => {
  it('begins with fn bodyLights and the real wgslFn parser sees the six inputs in order', () => {
    expect(BODY_LIGHTS.startsWith('fn bodyLights(')).toBe(true);
    const parsed = new WGSLNodeFunction(BODY_LIGHTS);
    expect(parsed.name).toBe('bodyLights');
    expect(parsed.inputs.map((i: { name: string }) => i.name)).toEqual(['p', 'n', 'V', 'picks', 'lights', 'skipFirst']);
    expect(parsed.outputType).toBe('BodyLit');
  });

  it('declares BodyLit after the fn (trailing-declaration pattern) with the six fields', () => {
    const s = BODY_LIGHTS.indexOf('struct BodyLit {');
    expect(s).toBeGreaterThan(BODY_LIGHTS.indexOf('return o;'));
    const body = BODY_LIGHTS.slice(s);
    for (const f of ['diffuse: vec3<f32>', 'spec: vec3<f32>', 'rim: vec3<f32>', 'domL: vec3<f32>', 'domC: vec3<f32>', 'domFloor: f32']) {
      expect(body).toContain(f);
    }
  });

  it('interpolated every constant and uses no WGSL reserved word as a name', () => {
    expect(BODY_LIGHTS).not.toContain('${');
    expect(BODY_LIGHTS).not.toMatch(/\blet meta\b/);
  });

  it('is not in HELPERS yet (Task 9 wires it; the march golden does not move here)', () => {
    expect(HELPERS).not.toContain(BODY_LIGHTS);
  });
});

describe('BODY_LIGHTS — offsets and guards', () => {
  it('addresses a light at LIST_LIGHTS_AT + li x LIGHT_VEC4S (25 + li * 4)', () => {
    expect(LIST_LIGHTS_AT).toBe(25);
    expect(LIGHT_VEC4S).toBe(4);
    expect(BODY_LIGHTS).toContain('let base = 25 + li * 4;');
    expect(BODY_LIGHTS).toContain('let a = (*lights)[base];');
    expect(BODY_LIGHTS).toContain('let col = (*lights)[base + 1];');
    expect(BODY_LIGHTS).toContain('let lm = (*lights)[base + 3];');
  });

  it('addresses a profile at id x PROFILE_VEC4S, its three vec4 at pr, pr + 1, pr + 2', () => {
    expect(PROFILE_VEC4S).toBe(3);
    expect(BODY_LIGHTS).toContain('let pr = i32(lm.x) * 3;');
    expect(BODY_LIGHTS).toContain('let pa = (*lights)[pr];');
    expect(BODY_LIGHTS).toContain('let pb = (*lights)[pr + 1];');
    expect(BODY_LIGHTS).toContain('let pc = (*lights)[pr + 2];');
  });

  it('decodes picks as i32(floor(v)) + fract(v), skipping empty slots', () => {
    expect(BODY_LIGHTS).toContain('let li = i32(floor(pv));');
    expect(BODY_LIGHTS).toContain('let w = fract(pv);');
    expect(BODY_LIGHTS).toContain('if (pv < 0.0) { continue; }');
  });

  it('gates only slot 0 diffuse and spec on skipFirst; rim and dom* are outside the gate', () => {
    const gate = BODY_LIGHTS.indexOf('if (!(skipFirst && k == 0)) {');
    expect(gate).toBeGreaterThan(0);
    const gated = BODY_LIGHTS.slice(gate, BODY_LIGHTS.indexOf('}', gate));
    expect(gated).toContain('o.diffuse = o.diffuse + c * wrap;');
    expect(gated).toContain('o.spec = o.spec + c * sp;');
    expect(gated).not.toContain('o.rim');
    expect(BODY_LIGHTS).toContain('if (k == 0) { o.domL = L; o.domC = c; o.domFloor = pa.z; }');
  });

  it('directional lights (kind 2) use pos as the direction; the rest aim at the point', () => {
    expect(BODY_LIGHTS).toContain('let L = select(lv * inverseSqrt(max(dot(lv, lv), 1e-12)), a.xyz, a.w > 1.5);');
  });

  it('every normalize is zero-safe: a light at p or Lb == -V gives vec3(0), never NaN', () => {
    expect(BODY_LIGHTS).toContain('let lv = a.xyz - p;');
    expect(BODY_LIGHTS).toContain('let lbv = mix(L, V, pa.y);');
    expect(BODY_LIGHTS).toContain('let Lb = lbv * inverseSqrt(max(dot(lbv, lbv), 1e-12));');
    expect(BODY_LIGHTS).toContain('let hv = Lb + V;');
    expect(BODY_LIGHTS).toContain('let H = hv * inverseSqrt(max(dot(hv, hv), 1e-12));');
    expect(BODY_LIGHTS.replace(/\/\/.*$/gm, '')).not.toMatch(/\bnormalize\(/);   // code, not comments
  });

  it('never re-evaluates cone or distance: the colour is rgb x weight x gain', () => {
    expect(BODY_LIGHTS).toContain('let c = col.rgb * (w * pa.x);');
    expect(BODY_LIGHTS).not.toMatch(/\(\*lights\)\[base \+ 2\]/);   // the spot axis/cone vec4 is unread
    expect(BODY_LIGHTS).not.toMatch(/\bcol\.w\b/);   // range is the pick's business, not the shader's
  });
});

describe('BODY_LIGHTS — lane parity with packProfiles and the CPU reference', () => {
  // The lane each param is packed into (light-profiles.ts packProfiles) and the WGSL expression
  // that reads it. light-shade.ts reads the same lanes (pa[0] gain, pa[1] viewBias, ...).
  const LANES: { param: keyof (typeof LIGHT_PROFILES)[number] | 'rimTint.rgb'; flat: number | number[]; wgsl: string }[] = [
    { param: 'gain', flat: 0, wgsl: 'let c = col.rgb * (w * pa.x);' },
    { param: 'viewBias', flat: 1, wgsl: 'let lbv = mix(L, V, pa.y);' },
    { param: 'floor', flat: 2, wgsl: 'let wrap = max((dot(n, Lb) + pa.z) / (1.0 + pa.z), 0.0);' },
    { param: 'backRim', flat: 4, wgsl: 'let rim = pb.x * pow(1.0 - nv, 4.0) * max(side, back * 0.5);' },
    { param: 'spec', flat: 5, wgsl: 'let sp = pb.y * pow(max(dot(n, H), 0.0), pb.w);' },
    { param: 'specPow', flat: 7, wgsl: 'pow(max(dot(n, H), 0.0), pb.w)' },
    { param: 'rimTint.rgb', flat: [8, 9, 10], wgsl: 'o.rim = o.rim + c * pc.rgb * rim;' },
  ];

  it('every param sits in the lane the WGSL reads, for every profile', () => {
    const packed = packProfiles();
    LIGHT_PROFILES.forEach((prof, id) => {
      const at = id * PROFILE_VEC4S * 4;
      for (const l of LANES) {
        if (l.param === 'rimTint.rgb') {
          (l.flat as number[]).forEach((f, i) => expect(packed[at + f]).toBeCloseTo(prof.rimTint[i]!, 6));
        } else {
          expect(packed[at + (l.flat as number)], `${l.param} lane`).toBeCloseTo(prof[l.param] as number, 5);
        }
      }
    });
    for (const l of LANES) expect(BODY_LIGHTS, l.param).toContain(l.wgsl);
  });

  it('the WGSL reads no spare lane (pa.w backKey is CPU pick only, pb.z is spare)', () => {
    expect(BODY_LIGHTS).not.toMatch(/\bpa\.w\b/);
    expect(BODY_LIGHTS).not.toMatch(/\bpb\.z\b/);
    expect(BODY_LIGHTS).not.toMatch(/\bpc\.w\b/);
  });
});
