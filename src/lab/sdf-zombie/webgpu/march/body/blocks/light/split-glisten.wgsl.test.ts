// src/lab/sdf-zombie/webgpu/march/body/blocks/light/split-glisten.wgsl.test.ts
//
// THE OPENED HEAD GLISTENS: text pins for the wet film of an open split (split-glisten.wgsl.ts; its numbers are
// head-split.ts SPLIT_SHADE.glisten). Nothing here compiles WGSL (the census and the head-split gate do); these pin
// the off setting, the splice point, the gate, what the film reads and the one thing it writes.

import { describe, expect, it } from 'vitest';
import { REGION_MARGIN, SPLIT_SHADE } from '../../../../../head-split';
import { MARCH_SURFACE } from '../../../../deferred-sdf';
import { MARCH_BODY, REFINE_BODY } from '../../entry.wgsl';
import { COMPOSE_BLOCK } from './compose.wgsl';
import { SKIN_PRE } from './skin-detail-proto';
import { SPLIT_GLISTEN_BLOCK, splitGlistenBlock } from './split-glisten.wgsl';

const noComments = (s: string) => s.replace(/\/\/[^\n]*/g, '');
const G = SPLIT_SHADE.glisten;
const code = noComments(SPLIT_GLISTEN_BLOCK);
/** The block's own float literal. */
const f = (v0: number) => { const v = +v0.toFixed(6); return Number.isInteger(v) ? `${v}.0` : `${v}`; };

describe('the off setting: gain 0', () => {
  it('writes nothing, so the shader is the one without the film', () => {
    expect(splitGlistenBlock({ ...G, gain: 0 })).toBe('');
    // With the block's text taken out, the list's add is followed by what followed it before.
    const without = COMPOSE_BLOCK.replace(SPLIT_GLISTEN_BLOCK, '');
    expect(without).toContain('  fleshLit = fleshLit + (listDiff * albedo + listSpec) * ao + listRim;\n  // LIGHTNING SIDE RIM');
    expect(without).not.toMatch(/glis|splitIn/);
  });
  it('is on as shipped, and the shipped block is the function of the shipped numbers', () => {
    expect(G.gain).toBeGreaterThan(0);
    expect(SPLIT_GLISTEN_BLOCK).toBe(splitGlistenBlock());
    expect(SPLIT_GLISTEN_BLOCK.length).toBeGreaterThan(0);
  });
});

describe('where it runs', () => {
  it('is spliced into the compose right after the light list, before the highlight shoulder', () => {
    const at = COMPOSE_BLOCK.indexOf(SPLIT_GLISTEN_BLOCK);
    const list = 'fleshLit = fleshLit + (listDiff * albedo + listSpec) * ao + listRim;';
    expect(at).toBe(COMPOSE_BLOCK.indexOf(list) + list.length);
    expect(at).toBeLessThan(COMPOSE_BLOCK.indexOf(SKIN_PRE));
    expect(at).toBeLessThan(COMPOSE_BLOCK.indexOf('let knee = clamp(1.0 - spotCfg2.y'));
    expect(COMPOSE_BLOCK.split(SPLIT_GLISTEN_BLOCK)).toHaveLength(2);
  });
  it('the march and its refine twin carry it; the deferred surface entry has no light tail and does not', () => {
    expect(MARCH_BODY).toContain(SPLIT_GLISTEN_BLOCK);
    expect(REFINE_BODY).toContain(SPLIT_GLISTEN_BLOCK);
    expect(MARCH_SURFACE).not.toContain('glisRaw');
  });
});

describe('the gate: an open split\'s raw flesh, and nothing else', () => {
  it('everything is behind splitIn, so a closed body and a hit outside the region run none of it', () => {
    expect(code.trim()).toMatch(/^if \(splitIn\) \{[\s\S]*\}$/);
    // One top-level statement: the braces balance only at the end.
    let depth = 0, closedAt = -1;
    const body = code.trim();
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '{') depth++;
      if (body[i] === '}' && --depth === 0) { closedAt = i; break; }
    }
    expect(closedAt).toBe(body.length - 1);
  });
  it('raw flesh: the wound mask past its faint reach, off the face sheet, the non-flesh share and char', () => {
    expect(code).toContain(`let glisRaw = smoothstep(${f(G.rawLo)}, ${f(G.rawHi)}, wm) * (1.0 - faceSheetCover) * (1.0 - cutKeep) * (1.0 - cm) * select(1.0, 0.25, isBone)`);
    expect(G.rawLo).toBeGreaterThan(0);
    expect(G.rawHi).toBeGreaterThan(G.rawLo);
    expect(G.rawHi).toBeLessThanOrEqual(1);
  });
  it('fades out over the last stretch of the region sphere, inside the margin no moved flesh reaches', () => {
    expect(code).toContain(`* (1.0 - smoothstep(gInstSplitR.x - ${f(G.edge)}, gInstSplitR.x, length(p - gInstSplitH.xyz)));`);
    // The turned halves lie within r - REGION_MARGIN of the hinge: they carry the whole film.
    expect(G.edge).toBeGreaterThan(0);
    expect(G.edge).toBeLessThan(REGION_MARGIN);
  });
  it('fades with the coarse octave as its cell nears one march texel; the fine octave by its own cell', () => {
    expect(code).toContain('let glisPix = max(2.0 * t * aaCfg.x, 1e-6);');
    expect(code).toContain(`* smoothstep(${f(G.fadeLo)}, ${f(G.fadeHi)}, ${f(G.lump)} / glisPix)`);
    expect(code).toContain(`* (${f(G.fineTilt)} * smoothstep(${f(G.fadeLo)}, ${f(G.fadeHi)}, ${f(G.fine)} / glisPix));`);
    expect(G.fadeHi).toBeGreaterThan(G.fadeLo);
    expect(G.lump).toBeGreaterThan(G.fine);
  });
  it('the work is behind the raw gate too', () => {
    const inner = code.slice(code.indexOf('if (glisRaw > 0.0) {'));
    for (const paid of ['noise3(', 'pow(', 'fleshLit =']) {
      expect(code.indexOf(paid), paid).toBeGreaterThan(code.indexOf('if (glisRaw > 0.0) {'));
      expect(inner, paid).toContain(paid);
    }
  });
});

describe('the film', () => {
  it('its pattern is cut in the REST anchor (it rides the half, nothing swims) and turns out with the half', () => {
    expect(code).toContain(`let glisA = anchor * ${f(1 / G.lump)};`);
    expect(code).toContain(`let glisB = anchor * ${f(1 / G.fine)};`);
    // The coarse octave is pushed off zero, so the film is not a flat mirror with a little noise on it.
    expect(code).toContain('let glisLump = vec3<f32>(noise3(glisA), noise3(glisA + 5.0), noise3(glisA + 11.0));');
    expect(code).toContain(`var glisTilt = glisLump / (abs(glisLump) + vec3<f32>(${f(G.lumpFlat)})) * ${f(G.lumpTilt)}`);
    expect(G.lumpFlat).toBeGreaterThan(0);
    // Every noise tap reads one of those two, never a world point.
    const taps = code.match(/noise3\(([^)]*)\)/g) ?? [];
    expect(taps).toHaveLength(6);
    for (const tap of taps) expect(tap).toMatch(/^noise3\(glis[AB]( \+ \d+\.0)?\)$/);
    // Behind the angle, as every rotation by the piece's turn is (split-hit.wgsl.test.ts).
    expect(code).toContain('if (splitTheta != 0.0) { glisTilt = qRot(splitQ, glisTilt); }');
    expect(code).toContain('let glisN = normalize(n + glisTilt);');
  });
  it('the torch glints from its own place, past the beam\'s cone by the spill, with its switch, range and level shadow', () => {
    expect(code).toContain('if (spotCfg.x > 0.0) {');
    expect(code).toContain('let glisTo = spotPos - p;');
    expect(code).toContain(`let glisCone = clamp((dot(-glisLs, normalize(spotAxis)) - spotCfg.z) / ${f(G.spill)} + 1.0, 0.0, 1.0);`);
    expect(code).toContain('let glisFar = clamp(1.0 - glisDist / max(spotCfg.w, 1e-4), 0.0, 1.0);');
    // A zero-safe half vector, as bodyLights takes its own.
    expect(code).toContain('let glisH = glisHv * inverseSqrt(max(dot(glisHv, glisHv), 1e-12));');
    expect(code).toContain(`glis = spotColor * (pow(max(dot(glisN, glisH), 0.0), ${f(G.pow)}) * glisCone * glisCone * glisFar * glisFar * min(spotCfg.x, 1.0) * lvl);`);
    expect(G.spill).toBeGreaterThan(0);
    expect(G.pow).toBeGreaterThan(1);
  });
  it('with the torch off the lamp that keys the body glints: the key\'s highlight off the film, only where the list handed a lamp the key', () => {
    expect(code).toContain('if (lightListCfg.x > 0.0 && lightListCfg.z <= 0.5 && listBeam <= 0.0) {');
    expect(code).toContain(`glis = glis + keyC * (pow(max(dot(glisN, H), 0.0), ${f(G.lampPow)}) * min(keyI, 1.0) * wShadow * ${f(G.lamps)});`);
    // A second bodyLights call in the entry left screen tiles of an open head at a wrong depth: the list is not
    // walked again here.
    expect(code).not.toContain('bodyLights(');
    expect(code).not.toMatch(/lightList\b|gInstLights/);
  });
  it('adds highlights to the lit colour and writes nothing else', () => {
    expect(code).toContain(`fleshLit = fleshLit + glis * (${f(G.gain)} * glisRaw * ao);`);
    // Its only assignments: its own names, and that one add.
    const assigned = [...code.matchAll(/(?:^|[;{}\s])(?:let |var )?([A-Za-z_][\w.]*) = /g)].map((m) => m[1] ?? '');
    expect(assigned.filter((name) => !name.startsWith('glis'))).toEqual(['fleshLit']);
    // What it declares cannot collide with the entry's names.
    for (const m of code.matchAll(/\b(?:let|var) (\w+)/g)) expect(m[1]).toMatch(/^glis/);
  });
  it('is scalars and vecs only: no array, nothing indexed', () => {
    expect(code).not.toMatch(/\[|array</);
    expect(code).not.toMatch(/\bfor\b|\bwhile\b|\bloop\b/);
  });
});
