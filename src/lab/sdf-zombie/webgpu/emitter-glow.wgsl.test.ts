// src/lab/sdf-zombie/webgpu/emitter-glow.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import {
  FLUORO_FLICKER, FLUORO_RGB, FLUORO_WARM, LED_AMBER, LED_BLINK_CUT, LED_GREEN, LED_RED, SB_CELL_TYPES, SB_TEXT_MEAN, SCREEN_AMBER,
  SCREEN_AMBER_RATE, SCREEN_GREEN, SCREEN_RATES, SIGN_BUZZ, SIGN_RGB, VS_BASE, VS_BASE_UP, VS_PLANET_CHANCE, VS_PLANET_COOL,
  VS_PLANET_WARM, VS_RIM, VS_STAR,
} from '../../../game/level/emitter-layout';
import { EM_FLUORO_FLICKER, EM_HASH, EM_RAND, EM_SCREEN_STATE, EMITTER_FN, EMITTER_KINDS, v3 } from './emitter-glow.wgsl';

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

describe('emitter-glow.wgsl colours come from emitter-layout.ts (item 2g B1: one source for shader and bake)', () => {
  it('screen, LED, troffer, sign and viewscreen colours and cuts are interpolated, not literals', () => {
    const sb = EMITTER_FN.screenBank.src;
    expect(sb).toContain(v3(SCREEN_GREEN)); expect(sb).toContain(v3(SCREEN_AMBER));
    expect(sb).toContain(`< ${SCREEN_AMBER_RATE}`);
    for (const c of [LED_RED, LED_GREEN, LED_AMBER]) expect(sb).toContain(v3(c));
    expect(sb).toContain(`> ${LED_BLINK_CUT}`);
    expect(sb).toContain(`mix(dot, ${SB_TEXT_MEAN}, aa)`);
    // Reduced flashes freeze the LED blink (emitter-layout.ts ledOn).
    expect(sb).toMatch(/blinkPhase = select\(floor\(.*\), 0\.0, calm > 0\.5\)/);
    expect(EMITTER_FN.fluorescent.src).toContain(`${FLUORO_RGB[0]} + warm`);
    expect(EMITTER_FN.fluorescent.src).toContain(`${FLUORO_WARM} * (emRand(a, b + 1) - 0.5)`);
    expect(EMITTER_FN.fluorescent.src).toContain('mix(1.0, 0.92 + 0.08 * tb, 1.0 - calm)');
    expect(EMITTER_FN.exitSign.src).toContain(v3(SIGN_RGB));
    const vs = EMITTER_FN.viewscreen.src;
    for (const c of [VS_BASE, VS_BASE_UP, VS_STAR, VS_RIM, ...VS_PLANET_WARM, ...VS_PLANET_COOL]) expect(vs).toContain(v3(c));
    expect(vs).toContain(`< ${VS_PLANET_CHANCE}`);
  });
});
