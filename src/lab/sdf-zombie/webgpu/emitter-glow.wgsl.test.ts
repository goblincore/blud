// src/lab/sdf-zombie/webgpu/emitter-glow.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import { FLUORO_FLICKER, SB_CELL_TYPES, SCREEN_RATES, SIGN_BUZZ } from '../../../game/level/emitter-layout';
import { EM_FLUORO_FLICKER, EM_HASH, EM_RAND, EM_SCREEN_STATE, EMITTER_FN, EMITTER_KINDS } from './emitter-glow.wgsl';

const all = [EM_HASH, EM_RAND, ...EMITTER_KINDS.flatMap(k => [EMITTER_FN[k].src, ...EMITTER_FN[k].deps])];
const fnName = (src: string) => /^fn (\w+)\(/.exec(src.trim())![1]!;

describe('emitter-glow.wgsl', () => {
  it('each string is exactly one fn with a return type', () => {
    for (const s of all) {
      expect(s.trim().startsWith('fn ')).toBe(true);
      expect(s.match(/^fn /gm)).toHaveLength(1);
      expect(s).toContain('-> ');
    }
  });
  it('each kind\'s fn has the call signature the sector mesh passes, and every helper it calls is included', () => {
    for (const k of EMITTER_KINDS) {
      const e = EMITTER_FN[k];
      expect(fnName(e.src)).toBe(e.name);
      expect(e.src).toContain('(uv: vec2<f32>, mask: vec4<f32>, t: f32, sec: f32, calm: f32, fw: f32) -> vec3<f32>');
      const have = new Set(['emRand', 'emHash', ...e.deps.map(fnName)]);
      for (const m of e.src.matchAll(/\b(em[A-Z]\w*|screenFlicker|fluoroFlicker)\(/g)) {
        if (m[1] !== e.name) expect(have.has(m[1]!), `${k} calls ${m[1]}`).toBe(true);
      }
    }
    expect(EM_RAND).toContain('emHash(');
  });
  it('every smoothstep with literal edges has low < high (WGSL makes low >= high a shader-creation error)', () => {
    let seen = 0;
    for (const s of all) for (const m of s.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
      expect(Number(m[1]), m[0]).toBeLessThan(Number(m[2]));
      seen++;
    }
    expect(seen).toBeGreaterThan(5);
  });
  it('has no colon inside a // comment, and no unfilled template', () => {
    for (const s of all) {
      expect(s).not.toContain('${');
      expect(s).not.toContain('undefined');
      expect(s).not.toContain('NaN');
      for (const line of s.split('\n')) {
        const at = line.indexOf('//');
        if (at >= 0) expect(line.slice(at)).not.toContain(':');
      }
    }
  });
  it('mixed bitwise and arithmetic ops are parenthesised (WGSL forbids a * b ^ c)', () => {
    for (const line of EM_HASH.split('\n')) if (line.includes('^') && line.includes('*')) expect(line).toMatch(/\(\w+ \* 0x/);
  });
  it('the layout and rates come from emitter-layout.ts', () => {
    expect(EMITTER_FN.screenBank.src).toContain(`array<i32, 16>(${SB_CELL_TYPES.join(', ')})`);
    expect(EM_SCREEN_STATE).toContain(`h < ${SCREEN_RATES.dead}`);
    expect(EM_FLUORO_FLICKER).toContain(`${FLUORO_FLICKER.slotHz}.0`);
    expect(EMITTER_FN.exitSign.src).toContain(`${SIGN_BUZZ.chance}`);
  });
});
