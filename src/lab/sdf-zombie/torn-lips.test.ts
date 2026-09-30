// src/lab/sdf-zombie/torn-lips.test.ts
//
// TORN, SPLAYED LIPS (flail v1.5b, plan 2026-09-26-spike-flail.md Task 31). Text/data gates: the tear
// flag's packing, the upload mapping, and that every shader path that shades or differentiates a wound
// carries the torn branch — gated so a wound without bit 3 takes exact-identity constants. The pixel
// proof (an untouched shotgun wound unchanged) is the GPU capture in docs/dev-notes/2026-09-28-head-damage/torn-lips/.
import { describe, expect, it } from 'vitest';
import { TEAR_LOOK, TORN, tearUpload } from './torn-lips';
import { tearWound, type Wound } from './damage';
import { WOUND_FLAG, woundFlagBits, writeWounds } from './webgpu/zombie-gpu';
import { APPLY_WOUNDS, WOUND_MASK, MARCH_BODY, MARCH_BODY_SURFACE_PREP, MARCH_TRACE_POST, ROW_WOUND_FLAGS } from './webgpu/march.wgsl';
import { MARCH_SURFACE } from './webgpu/deferred-sdf';
import { NG_WOUNDS } from './webgpu/normal-gradient.wgsl';

const wound = (extra: Partial<Wound> = {}): Wound => ({ primIdx: 0, local: [0, 0, 0], radius: 0.09, type: 'blast', ageSec: 0, ...extra });

describe('torn lips: the flag', () => {
  it('packs tear as bit 3 beside cavity/hole/decal, integer part only', () => {
    expect(WOUND_FLAG).toEqual({ cavity: 1, hole: 2, decal: 4, tear: 8, wetLip: 16 });
    expect(woundFlagBits({})).toBe(0);
    expect(woundFlagBits({ tear: true })).toBe(8);
    expect(woundFlagBits({ cavity: true, hole: true, decal: true, tear: true })).toBe(15);
  });
  it('writeWounds keeps the threat-mask fraction under the tear bit', () => {
    const stride = 16;
    const texels = new Float32Array(stride * 4 * 40);
    const layout = { stride, woundRow: 0, metaRow: 1, capRow: 2, flagsRow: 3, maxWounds: 2 };
    writeWounds(texels, [[0, 0, 0], [1, 0, 0]], [0.09, 0.09], [1, 1], [0, 0], undefined, undefined, layout,
      undefined, undefined, undefined, [0b101, 0b10], undefined, undefined, [true, false]);
    const x0 = texels[3 * stride * 4]!, x1 = texels[3 * stride * 4 + 4]!;
    expect(Math.floor(x0)).toBe(8);
    expect(Math.round((x0 - 8) * 1024)).toBe(0b101);
    expect(Math.floor(x1)).toBe(0);
    expect(Math.round(x1 * 1024)).toBe(0b10);
    // Unflagged: the exact pre-tear value (bit 3 absent, fraction unchanged).
    const plain = new Float32Array(stride * 4 * 40);
    writeWounds(plain, [[0, 0, 0], [1, 0, 0]], [0.09, 0.09], [1, 1], [0, 0], undefined, undefined, layout,
      undefined, undefined, undefined, [0b101, 0b10]);
    expect(plain[3 * stride * 4 + 4]).toBe(x1);
    expect(plain[3 * stride * 4]).toBe(x0 - 8);
  });
});

describe('torn lips: the upload', () => {
  it('tear absent or 0 is the stock upload exactly', () => {
    expect(tearUpload(undefined, undefined)).toEqual({ ragged: 0, splayMul: 1, offsetMul: 1, torn: false });
    expect(tearUpload(0, 0.2)).toEqual({ ragged: 0.2, splayMul: 1, offsetMul: 1, torn: false });
  });
  it('a torn wound is ragged 0.35-0.45, taller and pushed outward', () => {
    const full = tearUpload(1, undefined);
    expect(full.torn).toBe(true);
    expect(full.ragged).toBeCloseTo(TEAR_LOOK.raggedMax);
    expect(full.splayMul).toBeCloseTo(1 + TEAR_LOOK.rimBoost);
    expect(full.offsetMul).toBeCloseTo(1 + TEAR_LOOK.offsetBoost);
    const part = tearUpload(0.8, undefined);
    expect(part.ragged).toBeGreaterThanOrEqual(0.35);
    expect(part.ragged).toBeLessThan(full.ragged);
    expect(TEAR_LOOK.raggedMax).toBeLessThanOrEqual(0.45);   // the shader's ragged cap
  });
  it('the widest torn petal stays inside the per-wound reach at the shipped rim uniforms', () => {
    // reach = radius * max(2, 2 rimOffset + 3 rimWidth) (APPLY_WOUNDS); the rim is spent (exp(-9)) at
    // x = 3, i.e. s * depth * (rimOffset * offsetScale + 3 * rimWidth * widthK), s = 1 + ragged.
    const rimOffset = 1.15, rimWidth = 0.42, blastOffset = 0.85;
    const reach = Math.max(2, 2 * rimOffset + 3 * rimWidth);
    const s = 1 + TEAR_LOOK.raggedMax;
    const extent = s * (rimOffset * blastOffset * (1 + TEAR_LOOK.offsetBoost) + 3 * rimWidth * TORN.WIDTH_HI);
    expect(extent).toBeLessThanOrEqual(reach + 0.05);
  });
  it('tearWound clamps, and never tears a cloth decal (it carves nothing)', () => {
    expect(tearWound(wound(), 1.7).tear).toBe(1);
    expect(tearWound(wound(), 0).tear).toBeUndefined();
    expect(tearWound(wound({ decal: true }), 1).tear).toBeUndefined();
  });
});

describe('torn lips: the shaders', () => {
  it('APPLY_WOUNDS reads bit 3 and takes exact-identity constants off it', () => {
    expect(APPLY_WOUNDS).toContain('let torn = (i32(wFlags.x) & 8) != 0;');
    expect(APPLY_WOUNDS).toContain('let petal = select(1.0, mix(');
    expect(APPLY_WOUNDS).toContain('let widthK = select(1.0, mix(');
    expect(APPLY_WOUNDS).toContain('carveK = select(0.75, 0.5, torn);');
    // The flags row is read BEFORE the torn test (it already was, for the decal skip).
    expect(APPLY_WOUNDS.indexOf(`${ROW_WOUND_FLAGS} + band`)).toBeLessThan(APPLY_WOUNDS.indexOf('let torn ='));
  });
  it('WOUND_MASK follows the same two-octave edge and fills gWoundTear from the SAME footprint', () => {
    expect(WOUND_MASK).toContain('if ((fBits & 8) != 0) { rM = rM / (1.0 + ragged * mix(n, noise3(q * 3.7');
    // The shading footprint is torn OR wet-lip (bit 3 | bit 4) since Task 35; see gun-wet-lip.test.ts.
    expect(WOUND_MASK).toContain('if ((fBits & 24) != 0) { gWoundTear = max(gWoundTear, contribution); }');
    expect(WOUND_MASK).toContain('gWoundTear = 0.0;');
    // Still ONE mask edge (the halo lesson): m is the only thing returned.
    expect(WOUND_MASK).toContain('return vec3<f32>(m, m, cav);');
  });
  it('the torn shading lives in the sections the deferred surface entry shares', () => {
    expect(MARCH_TRACE_POST).toContain('let tornWound = smoothstep(0.02, 0.62, gWoundTear)');
    expect(MARCH_BODY_SURFACE_PREP).toContain('if (tornWound > 0.0) {');
    for (const src of [MARCH_BODY, MARCH_SURFACE]) {
      expect(src).toContain('albedo = mix(albedo, tornRed, tornWound * 0.85);');
      expect(src).toContain('wet = max(wet, mix(wet, tornWet, tornWound * (1.0 - cm)));');
    }
    // The legacy compose's glint reaches torn wounds too; soldier-only when tornWound = 0.
    expect(MARCH_BODY).toContain('mix(1.0, woundGlint, max(soldierWound, tornWound))');
  });
  it('the analytic normal falls back to the taps on a torn wound', () => {
    expect(NG_WOUNDS).toContain('if ((i32(flagsRow.x) & 8) != 0) { gNgReason = 1; return d; }');
  });
});
