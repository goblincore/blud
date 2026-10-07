// src/lab/sdf-zombie/gun-wet-lip.test.ts
//
// WET RED LIPS ON GUN WOUNDS (plan 2026-09-26-spike-flail.md Task 35). Text/data gates: the wet-lip flag
// (bit 4) packs beside the tear bit without disturbing the threat-mask fraction; the SHADING blocks key
// off tear|wetLip while the SHAPE (carve, mask edge, analytic-normal fallback) keys off tear alone; cloth
// wounds, decals and burns never take it; the gun (not the soldier, not the soft target) stamps it.
// The pixel proof is the GPU look loop in docs/dev-notes/2026-09-28-head-damage/torn-lips/gun-*.png.
import { describe, expect, it } from 'vitest';
import { GUN_WET_LIP, WET_LIP_LOOK, gunWetLipOn, setGunWetLip, wetLipUpload } from './torn-lips';
import { wetLipWound, type Wound } from './damage';
import { WOUND_FLAG, woundFlagBits, writeWounds } from './webgpu/zombie-gpu';
import { APPLY_WOUNDS, WOUND_MASK, MARCH_BODY, MARCH_TRACE_POST } from './webgpu/march.wgsl';
import { MARCH_SURFACE } from './webgpu/deferred-sdf';
import { NG_WOUNDS } from './webgpu/normal-gradient.wgsl';
import actorSrc from './webgpu/game-actor.ts?raw';
import viewSrc from './webgpu/character-view.ts?raw';

const wound = (extra: Partial<Wound> = {}): Wound => ({ primIdx: 0, local: [0, 0, 0], radius: 0.055, type: 'pellet', ageSec: 0, ...extra });

describe('gun wet lip: the flag', () => {
  it('packs wetLip as bit 4 beside tear (bit 3), integer part only', () => {
    expect(WOUND_FLAG.wetLip).toBe(16);
    expect(woundFlagBits({ wetLip: true })).toBe(16);
    expect(woundFlagBits({ tear: true, wetLip: true })).toBe(24);
    expect(woundFlagBits({ cavity: true, hole: true, decal: true, tear: true, wetLip: true })).toBe(31);
  });
  it('writeWounds keeps the threat-mask fraction and the tear bit under the wet-lip bit', () => {
    const stride = 16;
    const layout = { stride, woundRow: 0, metaRow: 1, capRow: 2, flagsRow: 3, maxWounds: 3 };
    const texels = new Float32Array(stride * 4 * 40);
    writeWounds(texels, [[0, 0, 0], [1, 0, 0], [2, 0, 0]], [0.055, 0.16, 0.09], [0, 1, 1], [0, 0, 0], undefined, undefined, layout, undefined,
      [false, true, false], undefined, [0b111111111, 0b101, 0], undefined, undefined, [false, false, true], [true, true, false]);
    const x = [0, 1, 2].map((i) => texels[3 * stride * 4 + i * 4]!);
    expect(Math.floor(x[0]!)).toBe(16);
    expect(Math.round((x[0]! - 16) * 1024)).toBe(0b111111111);
    expect(Math.floor(x[1]!)).toBe(17);                     // cavity + wet lip
    expect(Math.round((x[1]! - 17) * 1024)).toBe(0b101);
    expect(Math.floor(x[2]!)).toBe(8);                      // torn, no wet lip
    // Unflagged: the exact pre-wet-lip value (bit 4 absent, everything else unchanged).
    const plain = new Float32Array(stride * 4 * 40);
    writeWounds(plain, [[0, 0, 0], [1, 0, 0], [2, 0, 0]], [0.055, 0.16, 0.09], [0, 1, 1], [0, 0, 0], undefined, undefined, layout, undefined,
      [false, true, false], undefined, [0b111111111, 0b101, 0], undefined, undefined, [false, false, true]);
    expect(plain[3 * stride * 4]).toBe(x[0]! - 16);
    expect(plain[3 * stride * 4 + 4]).toBe(x[1]! - 16);
    expect(plain[3 * stride * 4 + 8]).toBe(x[2]);
  });
});

describe('gun wet lip: who gets it', () => {
  it('wetLipWound clamps, and refuses cloth (hole, tear, decal) and burns', () => {
    expect(wetLipWound(wound(), 1.5).wetLip).toBe(1);
    expect(wetLipWound(wound(), 0).wetLip).toBeUndefined();
    expect(wetLipWound(wound({ cloth: 'hole' }), 1).wetLip).toBeUndefined();
    expect(wetLipWound(wound({ cloth: 'tear' }), 1).wetLip).toBeUndefined();
    expect(wetLipWound(wound({ decal: true }), 1).wetLip).toBeUndefined();
    expect(wetLipWound(wound({ type: 'burn' }), 1).wetLip).toBeUndefined();
  });
  it('the upload sets bit 4 only for a live wet lip on a carved flesh wound, and the switch drops it', () => {
    expect(wetLipUpload(wound({ wetLip: 1 }))).toBe(true);
    expect(wetLipUpload(wound())).toBe(false);
    // A wound that became cloth AFTER the stamp (clothDecal on a soft target) never uploads it.
    expect(wetLipUpload(wound({ wetLip: 1, decal: true }))).toBe(false);
    expect(wetLipUpload(wound({ wetLip: 1, cloth: 'hole' }))).toBe(false);
    expect(wetLipUpload(wound({ wetLip: 1, cloth: 'tear' }))).toBe(false);
    setGunWetLip(false);
    expect(gunWetLipOn()).toBe(false);
    expect(wetLipUpload(wound({ wetLip: 1 }))).toBe(false);
    setGunWetLip(true);
    expect(viewSrc).toContain('rows.map(w => wetLipUpload(w)),');
  });
  it('the gun stamps it on pellets and slugs, zombie-class bodies only', () => {
    expect(GUN_WET_LIP).toEqual({ pellet: 1, slug: 1 });
    expect(actorSrc).toContain("gunWetLip(wound, 'pellet');");
    expect(actorSrc).toContain("gunWetLip(wound, 'slug');");
    expect(actorSrc).toContain('if (soldierDamage || softTarget) return;');
  });
});

describe('gun wet lip: shading on tear|wetLip, shape on tear only', () => {
  it('the SHAPE ignores bit 4: carve, mask edge and the analytic-normal fallback test bit 3 alone', () => {
    expect(APPLY_WOUNDS).toContain('let torn = (i32(wFlags.x) & 8) != 0;');
    for (const bad of ['& 16)', '& 24)']) {
      expect(APPLY_WOUNDS).not.toContain(bad);
      expect(NG_WOUNDS).not.toContain(bad);
    }
    expect(NG_WOUNDS).toContain('if ((i32(flagsRow.x) & 8) != 0) { gNgReason = 1; return d; }');
    expect(WOUND_MASK).toContain('if ((fBits & 8) != 0) { rM = rM / (1.0 + ragged * mix(n, noise3(q * 3.7');
  });
  it('the SHADING footprint takes bit 3 or bit 4; gWoundWetOnly is bit 4 without bit 3', () => {
    expect(WOUND_MASK).toContain('if ((fBits & 24) != 0) { gWoundTear = max(gWoundTear, contribution); }');
    expect(WOUND_MASK).toContain('if ((fBits & 24) == 16) { gWoundWetOnly = max(gWoundWetOnly, contribution); }');
    expect(WOUND_MASK).toContain('gWoundWetOnly = 0.0;');
    expect(WOUND_MASK).toContain('return vec3<f32>(m, m, cav);');   // still one mask edge
  });
  it('the crater calm (wetOnly) lives in the shared post block, identity off wet-lip-only pixels', () => {
    expect(MARCH_TRACE_POST).toContain('let wetOnly = clamp(gWoundWetOnly / max(gWoundTear, 1e-4), 0.0, 1.0);');
    for (const src of [MARCH_BODY, MARCH_SURFACE]) {
      expect(src).toContain(`woundGlint = mix(woundGlint, 1.0, wetOnly * ${WET_LIP_LOOK.GLINT_CALM});`);
      expect(src).toContain(`let tornWallRed = mix(gooRed, gooRedSmooth, wetOnly * ${WET_LIP_LOOK.WALL_SMOOTH});`);
      expect(src).toContain(`mix(1.15, ${WET_LIP_LOOK.LIP_CREST}, wetOnly)`);
      // The wet and glint blocks stay keyed on tornWound (so they cover wet-lip craters too).
      expect(src).toContain('wet = max(wet, mix(wet, tornWet, tornWound * (1.0 - cm)));');
    }
    expect(MARCH_BODY).toContain('mix(1.0, woundGlint, max(soldierWound, tornWound))');
  });
});
