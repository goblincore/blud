// src/lab/sdf-zombie/webgpu/march/body/blocks/light/split-glisten.wgsl.test.ts
//
// THE OPENED HEAD GLISTENS: text pins for the wet film of an open split (split-glisten.wgsl.ts; its numbers are
// head-split.ts SPLIT_SHADE.glisten). Nothing here compiles WGSL (the census and the head-split gate do); these pin
// the off setting, the splice point, the gate, what the film reads and the one thing it writes.

import { describe, expect, it, vi } from 'vitest';
import { REGION_MARGIN, SPLIT_SHADE } from '../../../../../head-split';
import { MARCH_SURFACE } from '../../../../deferred-sdf';
import { MARCH_BODY, REFINE_BODY } from '../../entry.wgsl';
import { MARCH_BODY_LIGHT } from '../../light.wgsl';
import { LIGHT_LIST_BLOCK } from './light-list.wgsl';
import { MAP_BODY } from '../../../map-body.wgsl';
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
  it('with gain 0 the three march exports ARE the build without the block, to the character', async () => {
    // The modules built again with only that one number changed.
    vi.resetModules();
    vi.doMock('../../../../../head-split', async (original) => {
      const real = await original<typeof import('../../../../../head-split')>();
      return { ...real, SPLIT_SHADE: { ...real.SPLIT_SHADE, glisten: { ...real.SPLIT_SHADE.glisten, gain: 0 } } };
    });
    try {
      const off = { ...(await import('../../entry.wgsl')), ...(await import('../../light.wgsl')) };
      const on = { MARCH_BODY, MARCH_BODY_LIGHT, REFINE_BODY };
      for (const name of ['MARCH_BODY', 'MARCH_BODY_LIGHT', 'REFINE_BODY'] as const) {
        // The shipped export holds the block once; cut out, it is the gain-0 export.
        expect(on[name].split(SPLIT_GLISTEN_BLOCK), name).toHaveLength(2);
        expect(off[name], name).toBe(on[name].replace(SPLIT_GLISTEN_BLOCK, ''));
        expect(off[name], name).not.toMatch(/\bglis[A-Z]/);
      }
    } finally {
      vi.doUnmock('../../../../../head-split');
      vi.resetModules();
    }
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
  it('ON THE HEAD ONLY: above the hinge plane and inside the hold ball, at the un-warped point; not the region sphere\'s neck and chest', () => {
    // The piece loop's own measure of where the split's flesh is (map-body.wgsl.ts cap0), read at pS.
    expect(code).toContain('let glisRel = pS - gInstSplitH.xyz;');
    expect(code).toContain(`let glisHold = min(dot(cross(gInstSplitN.xyz, gInstSplitA.xyz), glisRel), gInstSplitR.x - ${f(REGION_MARGIN)} - length(glisRel));`);
    expect(MAP_BODY).toContain('let spU = cross(spN, spA);');
    expect(MAP_BODY).toContain('var cap0 = min(dot(spU, pIn - spH), spRho - spDh);');
    expect(MAP_BODY).toContain(`let spRho = gInstSplitR.x - ${REGION_MARGIN};`);
    // Whole on and inside the bounds (the floor of the V lies ON the hinge plane), gone `edge` past them.
    expect(code).toContain(`* smoothstep(${f(-G.edge)}, 0.0, glisHold);`);
    expect(G.edge).toBeGreaterThan(0);
    expect(G.edge).toBeLessThanOrEqual(0.02);
    // No fade of the film's is measured on the region sphere: the only radius it reads is the hold ball's.
    expect(code.match(/gInstSplitR\.x/g)).toHaveLength(1);
  });
  it('by value: the shoulder and the chest of a zombie whose head is open are outside the hold; the pit, a cut face and the floor of the V inside', () => {
    // The zombie's middle split as the captures saw it (NOTES): the hinge h, n across, a back, the region's r.
    const h = [34.5, 1.5595, -0.9639], n = [1, 0, 0], a = [0, 0, -1], r = 0.3234;
    const u = [n[1]! * a[2]! - n[2]! * a[1]!, n[2]! * a[0]! - n[0]! * a[2]!, n[0]! * a[1]! - n[1]! * a[0]!];
    const hold = (p: number[]) => { const rel = p.map((v, i) => v - h[i]!); return Math.min(rel.reduce((acc, v, i) => acc + v * u[i]!, 0), r - REGION_MARGIN - Math.hypot(...rel)); };
    const gate = (p: number[]) => { const x = Math.min(Math.max((hold(p) + G.edge) / G.edge, 0), 1); return x * x * (3 - 2 * x); };
    expect(u.map((v) => v + 0)).toEqual([0, 1, 0]);
    // Inside the region sphere, under the hinge: a pellet in the shoulder, the top of a chest chop, the neck.
    for (const p of [[34.66, 1.3895, -0.8912], [34.5, 1.39, -0.854], [34.5, 1.54, -0.87]]) {
      expect(Math.hypot(...p.map((v, i) => v - h[i]!))).toBeLessThan(r);
      expect(gate(p), String(p)).toBe(0);
    }
    // The crown's pit, a cut face half way up, the floor of the V on the hinge plane.
    for (const p of [[34.5, 1.756, -0.894], [34.52, 1.66, -0.95], [34.5, 1.5595, -0.95]]) expect(gate(p), String(p)).toBe(1);
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
    // Projected onto the tangent plane, as the body grain's tilt is: the film's normal leans, it never turns into
    // the surface (n . glisN > 0 whatever the tilt).
    expect(code).toContain('glisTilt = glisTilt - n * dot(glisTilt, n);');
    expect(code.indexOf('glisTilt = glisTilt - n * dot(glisTilt, n);')).toBeGreaterThan(code.indexOf('if (splitTheta != 0.0) { glisTilt = qRot(splitQ, glisTilt); }'));
    expect(code).toContain('let glisN = normalize(n + glisTilt);');
    expect(code.indexOf('let glisN = normalize(n + glisTilt);')).toBeGreaterThan(code.indexOf('glisTilt = glisTilt - n * dot(glisTilt, n);'));
    const lean = (nrm: number[], tilt: number[]) => { const d = tilt.reduce((acc, v, i) => acc + v * nrm[i]!, 0); const t = tilt.map((v, i) => v - nrm[i]! * d); const g = nrm.map((v, i) => v + t[i]!); return g.reduce((acc, v, i) => acc + v * nrm[i]!, 0) / Math.hypot(...g); };
    for (const tilt of [[0, 0, 0], [3, -3, 3], [-3.2, -3.2, -3.2], [0, 0, -50]]) expect(lean([0, 0, 1], tilt), String(tilt)).toBeGreaterThan(0);
  });
  it('the torch glints from its own place, past the beam\'s cone by the spill, with its switch, range and level shadow', () => {
    expect(code).toContain('if (spotCfg.x > 0.0) {');
    expect(code).toContain('let glisTo = spotPos - p;');
    expect(code).toContain(`let glisCone = clamp((dot(-glisLs, normalize(spotAxis)) - spotCfg.z) / ${f(G.spill)} + 1.0, 0.0, 1.0);`);
    expect(code).toContain('let glisFar = clamp(1.0 - glisDist / max(spotCfg.w, 1e-4), 0.0, 1.0);');
    // A zero-safe half vector, as bodyLights takes its own.
    expect(code).toContain('let glisH = glisHv * inverseSqrt(max(dot(glisHv, glisHv), 1e-12));');
    // With the surface's own horizon: no glint on flesh that faces away from the torch.
    expect(code.replace(/\s+/g, ' ')).toContain(`glis = spotColor * (pow(max(dot(glisN, glisH), 0.0), ${f(G.pow)}) * smoothstep(0.0, ${f(G.horizon)}, dot(n, glisLs)) * glisCone * glisCone * glisFar * glisFar * min(spotCfg.x, 1.0) * lvl);`);
    expect(G.horizon).toBeGreaterThan(0);
    expect(G.spill).toBeGreaterThan(0);
    expect(G.pow).toBeGreaterThan(1);
  });
  it('with the torch off the lamp that keys the body glints: the key\'s highlight off the film, only where the list handed a lamp the key', () => {
    expect(code).toContain('if (lightListCfg.x > 0.0 && lightListCfg.z <= 0.5 && listBeam <= 0.0) {');
    // L is the raw direction to that lamp (light-list.wgsl.ts): the horizon is the surface's own, as the torch's.
    expect(code.replace(/\s+/g, ' ')).toContain(`glis = glis + keyC * (pow(max(dot(glisN, H), 0.0), ${f(G.lampPow)}) * smoothstep(0.0, ${f(G.horizon)}, dot(n, L)) * min(keyI, 1.0) * wShadow * ${f(G.lamps)});`);
  });
  it('A TRIPWIRE, not an explanation: the list is not walked here, and the entry calls bodyLights at its two exclusive sites only', () => {
    // A build of this block that walked the light list a second time, off the film's normal, showed an unexplained
    // depth fault: whole 4 x 4 texel cells of an open head kept their colour and took the world origin's depth.
    // bodyLights is pure (no private write, no callee) and those texels never ran the added call (their colour was
    // bit-equal to gain 0), so this is NOT a rule about bodyLights: the cause is not known, and any edit to the light
    // tail could bring it back. What catches it is scripts/head-split-gate.mjs depthGuard. These pins only make the
    // one edit known to trigger it show up in review.
    expect(code).not.toContain('bodyLights(');
    expect(code).not.toMatch(/lightList\b|gInstLights/);
    for (const entry of [MARCH_BODY, REFINE_BODY]) expect(noComments(entry).match(/\bbodyLights\(/g)).toHaveLength(2);
    const list = noComments(LIGHT_LIST_BLOCK);
    expect(list.match(/\bbodyLights\(/g)).toHaveLength(2);
    expect(list).toMatch(/if \(lightListCfg\.x > 0\.0 && lightListCfg\.z > 0\.5\) \{[^}]*bodyLights\([^}]*\} else if \(lightListCfg\.x > 0\.0\) \{[^}]*bodyLights\(/);
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
