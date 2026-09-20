// src/lab/sdf-zombie/webgpu/march/body/io.wgsl.test.ts
//
// March phase-2 task 2: the MarchIn ⇄ MARCH_BODY_PARAMS sync gate. The pack
// statement is GENERATED from the positional list (io.wgsl.ts) but the struct
// itself is hand-written text — these tests pin all three (list, struct,
// pack) to each other, names AND types AND order, so adding a parameter to
// MARCH_BODY_PARAMS without deciding struct-or-positional fails here rather
// than at pipeline creation with a constructor arity error.
//
// Nothing here compiles a shader; these guard what CAN be checked from text
// (same discipline as entry.wgsl.test.ts). WGSL forbids pointers, textures
// and samplers as struct members at any nesting depth (gpuweb WGSL,
// "Structure Types"), which is what the excluded list IS — see io.wgsl.ts.

import { describe, it, expect } from 'vitest';
import * as M from '../../march.wgsl';

/** Every `name: type` head in a WGSL signature/struct body, comments
 * stripped. Same shape as three's propertiesRegexp, `i` flag included —
 * the names carry uppercase. Type = head token plus its angle-bracket tail,
 * as written in the source (the struct writes the same text as the list). */
const pairs = (src: string): { name: string; type: string }[] => {
  const code = src.replace(/\/\/[^\n]*/g, '');
  const re = /([a-z_0-9]+)\s*:\s*([a-z_0-9]+(?:<[\s\S]*?>)?)/gi;
  return [...code.matchAll(re)].map((m) => ({ name: m[1]!, type: m[2]! }));
};

const VALUE_PARAMS = pairs(M.MARCH_BODY_PARAMS).filter(
  (p) => !/^(texture|ptr|sampler)/i.test(p.type),
);

describe('MarchIn io (phase-2 task 2)', () => {
  it('declares exactly the VALUE parameters, in list order, with identical types', () => {
    const structBody = M.MARCH_IN_STRUCT.slice(
      M.MARCH_IN_STRUCT.indexOf('struct MarchIn {'),
    );
    expect(pairs(structBody)).toEqual(VALUE_PARAMS);
  });

  it('excludes exactly the 13 handle/pointer parameters — no more, no fewer', () => {
    const all = pairs(M.MARCH_BODY_PARAMS);
    const valueNames = new Set(VALUE_PARAMS.map((p) => p.name));
    const excluded = all.filter((p) => !valueNames.has(p.name)).map((p) => p.name);
    // Textures and storage pointers only — the WGSL spec's struct-member rule.
    expect(excluded.sort()).toEqual(
      [
        'data', 'volumeTex', 'faceTex', 'segVolumeAtlas', 'segVolumeMeta',
        'tileHdr', 'tileEnt', 'levelShadowTex', 'depthPreTex', 'probeTex',
        'probeDyn', 'lastTex', 'inst',
      ].sort(),
    );
    // The struct must not carry a handle head under any spelling.
    expect(VALUE_PARAMS.every((p) => /^(vec|mat|[fiu]32|bool)/.test(p.type))).toBe(true);
  });

  it('the pack statement names exactly the struct fields, in field order', () => {
    const structBody = M.MARCH_IN_STRUCT.slice(
      M.MARCH_IN_STRUCT.indexOf('struct MarchIn {'),
    );
    const fields = pairs(structBody).map((p) => p.name);
    const packArgs = M.MARCH_IN_PACK.slice(
      M.MARCH_IN_PACK.indexOf('MarchIn(') + 'MarchIn('.length,
      M.MARCH_IN_PACK.lastIndexOf(');'),
    )
      .replace(/\/\/[^\n]*/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(packArgs).toEqual(fields);
  });

  it('both entries carry the pack once, as the first body statement, and the struct once', () => {
    for (const entry of [M.MARCH_BODY, M.REFINE_BODY]) {
      expect(entry.match(/var m: MarchIn = MarchIn\(/g)).toHaveLength(1);
      expect(entry.indexOf('var m: MarchIn = MarchIn(')).toBeGreaterThan(-1);
      // FIRST statement: nothing but comments between the signature's `{` and the pack.
      const bodyStart = entry.slice(entry.indexOf(') -> vec4<f32> {') + ') -> vec4<f32> {'.length);
      expect(bodyStart.replace(/\/\/[^\n]*/g, '').replace(/^\s+/, '').startsWith('var m: MarchIn = MarchIn(')).toBe(true);
      expect(entry.match(/struct MarchIn \{/g)).toHaveLength(1);
      // Trailing declaration: the struct closes the module text (pattern order-independence).
      expect(entry.trimEnd().endsWith('}')).toBe(true);
    }
  });

  it('the anchor fn keeps the chunk wgslFn-parseable on its own (^fn rule)', () => {
    expect(M.MARCH_IN_STRUCT.startsWith('fn marchIoAnchor()')).toBe(true);
  });
});
