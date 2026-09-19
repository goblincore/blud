// src/lab/sdf-zombie/webgpu/march/body/blocks/post/prim-material.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `prim-material`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, DATA_ROWS, ROW_PRIM_COLOR, ROW_PRIM_SHAPE, ROW_PRIM_CLIP } from '../../../../march.wgsl';
import moduleSource from '../../../../march.wgsl?raw';
import layoutSource from '../../../layout?raw';
import { MARCH_TREE_SRC } from '../../../../march-test-support';

describe('per-primitive colour', () => {
  it('has a data row of its own, inside DATA_ROWS', () => {
    expect(ROW_PRIM_COLOR).toBeLessThan(DATA_ROWS);
  });

  it('reads the row at the HIT primitive and gates on the w sentinel', () => {
    expect(MARCH_BODY).toContain(`vec2<i32>(hitBest, ${ROW_PRIM_COLOR} + gBand)`);
    expect(MARCH_BODY).toContain('if (PC.w > 0.0)');
  });

  // The painted eyes live exactly where a pair of sunglasses goes; if the
  // glow survived paint it would shine through the lenses.
  it('zeroes the eye glow on a painted primitive', () => {
    expect(MARCH_BODY).toContain('faceGlow = faceGlow * (1.0 - painted)');
  });
});

describe("gloss suppresses the flesh's own noise (hard-surface task 1)", () => {
  // Milled steel was getting bull-hide pores: surfaceNoiseAmp (surfCfg2.y)
  // perturbs the shading normal and silhouetteNoiseAmp (marchCfg.z) ripples
  // the field calcNormal samples — both body-wide, both applied before the
  // shader learns the hit prim is painted. The fix scales BOTH by
  // (1 - gloss) at the point of application. There is no GPU in CI, so the
  // assertions are structural: the factor must sit at BOTH application
  // sites, inside the existing amplitude guard, resolved off ONE hoisted
  // prim-colour read that happens before the normal exists. The numeric
  // claim — losing pitting improves a lens — is a prediction only the
  // render A/B can carry; this suite pins the mechanism, the frames pin
  // the look.
  const SHADE_BODY = MARCH_BODY;
  // The one ROW_PRIM_COLOR read (pack.ts writes w = 1 + gloss, w = 0 flesh).
  const LOAD = `textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_COLOR} + gBand), 0)`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('resolves gloss BEFORE the shading normal exists, off ONE load', () => {
    // The read was hoisted up from the per-prim colour block; it must be a
    // hoist, not a repeat — a second load of the same texel on every hit
    // pixel is exactly the kind of cost this file's other gates exist to
    // stop (cf. the wm-gated hitMat read).
    expect((SHADE_BODY.match(new RegExp(esc(LOAD), 'g')) ?? []).length).toBe(1);
    expect(SHADE_BODY.indexOf('var gloss = 0.0;'))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
    expect(SHADE_BODY.indexOf(LOAD))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
  });

  it('scales the silhouette noise reaching calcNormal by (1 - max(gloss, metal))', () => {
    // calcNormal's noiseAmp is the ONLY path silhouetteNoiseAmp has into the
    // shading normal (the march loop runs the field smooth; the AO/scatter
    // probes are field probes, not surface detail, and keep full amp).
    // hard-surface task 2: `metal` implies the same suppression with no
    // gloss= — a machined surface has no pores either — so the factor is
    // the max of both levers (each is 0..1).
    // task-3 merge: calcNormal's amp is melt's vec4 (x silhouette, y/z/w
    // melt) — the kill applies to .x only, melt passes through untouched.
    expect(SHADE_BODY).toContain(
      'calcNormal(p, data, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg');
  });

  it('scales the micro-detail perturbation by (1 - max(gloss, metal)), still inside its amplitude guard', () => {
    // The guard must wrap the NOISE CALL, not just its result (entrails
    // post-mortem, 2026-09-02): a polished prim skips the six lookups
    // outright, it does not compute them and multiply them away — so the
    // gloss kill folds into the guarded amplitude itself, not into the
    // fbm result.
    expect(SHADE_BODY).toContain('let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));');
    const detailBlock=SHADE_BODY.slice(SHADE_BODY.indexOf('if (detailAmp > 0.0)'),SHADE_BODY.indexOf('// Tissue depth'));
    expect(detailBlock).toContain('fbm(anchor * 22.0)');
    expect(detailBlock).toContain('detailAmp * mix(1.0, 1.45, soldierPit)');
  });

  it('still paints the prim albedo after the face pass; char still wins', () => {
    // Hoisting the READ must not hoist the OVERWRITE: a painted prim
    // replaces the flesh albedo (mottle and face sheet included) exactly
    // where it always did, and burnt is still burnt on top of it.
    const faceAt = SHADE_BODY.indexOf('if (faceCfg.x > 0.5) {');
    const paintAt = SHADE_BODY.indexOf('if (painted > 0.0) {');
    const charAt = SHADE_BODY.indexOf('albedo = mix(albedo, charColor, cm);');
    expect(faceAt).toBeGreaterThan(-1);
    expect(paintAt).toBeGreaterThan(faceAt);
    expect(charAt).toBeGreaterThan(paintAt);
  });
});

describe('metal modifier (hard-surface task 2)', () => {
  // A painted prim gets full diffuse + untinted white highlight — polished
  // plastic. `metal` (prof bit 4, packed by pack.ts) suppresses the diffuse
  // to a floor and tints the specular by the prim's own albedo. There is no
  // GPU in CI, so these are structural pins: where the bit is read, what it
  // scales, and what stays bit-identical at metal 0. The LOOK — whether the
  // plates read as steel — is the render's job, not this suite's.
  const SHADE_BODY = MARCH_BODY;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const SHAPE_LOAD = `textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SHAPE} + gBand), 0)`;

  it('reads the metal bit inside the ONE hoisted painted read, above calcNormal', () => {
    // Same hoist discipline as gloss (task 1): the value is needed by the
    // noise-suppression sites BEFORE the shading normal exists, and the
    // extra texel load is paid only inside the painted branch — metal is
    // parse-gated on color=, so an unpainted pixel can never change the
    // answer. One load, not a repeat.
    expect(SHADE_BODY).toContain('var metal = 0.0;');
    expect((SHADE_BODY.match(new RegExp(esc(SHAPE_LOAD), 'g')) ?? []).length).toBe(1);
    expect(SHADE_BODY.indexOf('var metal = 0.0;'))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
    expect(SHADE_BODY.indexOf(SHAPE_LOAD))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
    expect(SHADE_BODY).toContain('if ((i32(PS.y) & 16) != 0)');
  });

  it('implies task 1 noise suppression with NO gloss set: both sites use max(gloss, metal)', () => {
    // Pinned in the gloss describe above with the same strings; this test
    // makes the METAL half of the max explicit, so dropping metal from
    // either application site fails HERE as well as there.
    expect(SHADE_BODY).toContain('marchCfg.z * (1.0 - max(gloss, metal))');
    expect(SHADE_BODY).toContain('let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));');
  });

  it('suppresses the whole diffuse family to a floor, not to zero', () => {
    // A pure-metal term in a shader with no environment map goes black
    // wherever the highlight is not, and the lab has one key. Rendered
    // curve (12-frame turntable, 2026-09-03): 0.25 went BLACK at the front
    // yaw; 0.35 kept slab forms but the front still read near-black; 0.45
    // keeps the greave's specular gradient AND a readable front face, so
    // 0.45 ships. Multiplying the whole `albedo * (amb + diff...)` family —
    // ambient bounce included — because bounce IS diffuse.
    expect(SHADE_BODY).toContain(
      'albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao * mix(1.0, 0.45, metal)');
  });

  it('tints the specular AND the fresnel rim by the prim albedo, at steel F0', () => {
    // The single change that makes metal read as metal: the highlight takes
    // the prim's colour instead of the light's, so steel differs from white
    // plastic under the same key. The tint is NOT the raw albedo — that
    // rendered the plates black (0.17 linear luminance killed the
    // highlight; frame-00 A/B) — it is the albedo hue with luminance
    // renormalised to polished steel's ~56% normal-incidence reflectance.
    // The tint multiplies BOTH the tight specular and the fresnel rim —
    // metals tint their grazing reflection too — and never the wound/gore
    // wet or scatter terms.
    expect(SHADE_BODY).toContain(
      'min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5))');
    expect(SHADE_BODY).toContain(
      'metalTint * keyC * (shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet');
  });

  it('collapses to an EXACTLY white tint at metal 0 — flesh keeps its highlight', () => {
    // THE REGRESSION THIS EXISTS FOR (found 2026-09-04, on main, in the lab).
    // metalTint shipped UNGATED:
    //     let metalTint = min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5));
    // primAlbedo is vec3(0) on every UNPAINTED pixel — flesh never enters the
    // painted branch (PC.w > 0.0) that fills it — so metalTintLum clamped to
    // its 1e-3 floor, the tint evaluated to vec3(0), and it multiplied the
    // WHOLE specular + fresnel term to nothing. Every zombie lost its
    // highlight AND its rim at once, everywhere, lab and game.
    //
    // The tell: the specular slider did nothing. surfCfg.x sits INSIDE those
    // parentheses, so once the common factor is zero the knob cannot move the
    // pixel. Anything that kills shine and fres TOGETHER is a common factor,
    // not the shine term.
    //
    // The diffuse half of this same feature got its gate right —
    // `mix(1.0, 0.45, metal)`, pinned above — and this is the missing other
    // half. mix() to exactly 1.0 is an exact multiply, so at metal 0 flesh
    // shades bit-identically to the pre-metal shader; at metal 1 the steel
    // tint is untouched.
    expect(SHADE_BODY).toContain(
      'let metalTint = mix(vec3<f32>(1.0), min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5)), metal);');
  });
});

describe('per-prim glow= in primClip.w (hard-surface task 3)', () => {
  // No GPU in CI, so these are structural pins — where the value is read,
  // what it composes with, and what stays bit-identical at glow 0. Whether
  // the eyes READ as glowing is the render's job (task 3 step 4 does that
  // from frames, not from strings).
  const SHADE_BODY = MARCH_BODY;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CLIP_LOAD = `textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_CLIP} + gBand), 0)`;

  it('row 17 no longer documents w as spare', () => {
    // Done-when: leaving "w spare" in the row table is how the next person
    // packs over the lane. Pinned against the MODULE SOURCE — the docstring
    // is a TS comment, not part of any exported WGSL string, so a check on
    // MARCH_BODY cannot see it (that vacuous version was caught by its own
    // mutation run). Scoped to ROW_PRIM_CLIP's OWN doc block: other rows'
    // "yzw spare" notes are true statements about other lanes and contain
    // the same substring.
    const clipSource = moduleSource + layoutSource;
    const clipConst = clipSource.indexOf('export const ROW_PRIM_CLIP');
    const clipDoc = clipSource.slice(clipSource.lastIndexOf('/**', clipConst), clipConst);
    expect(clipDoc).not.toContain('spare');
    expect(clipDoc).toContain('glow');
  });

  it('reads glow from ROW_PRIM_CLIP.w, inside the painted branch only', () => {
    // glow= is parse-gated on color= (same gate as gloss/metal), so an
    // unpainted pixel can never author a glow — the read is paid only where
    // it can matter. And the field path reads this row as .xyz only
    // (sdShell), so the lane was genuinely spare until this.
    expect(SHADE_BODY).toContain(CLIP_LOAD);
    expect(SHADE_BODY).toContain('primGlow = clamp(');
    // ONE read: the load must not be repeated per consumer.
    expect((SHADE_BODY.match(new RegExp(esc(CLIP_LOAD), 'g')) ?? []).length).toBe(1);
    // ...and it happens INSIDE the painted branch (after `painted = 1.0;`,
    // before the branch closes).
    expect(SHADE_BODY.indexOf('painted = 1.0;'))
      .toBeLessThan(SHADE_BODY.indexOf(CLIP_LOAD));
  });

  it('the glow COLOUR is the prim albedo — the authored glow= is the strength', () => {
    // Design C: a prim with color=ff2200 glow=0.9 glows red because it IS
    // red. No new colour field, no global strength multiplier (the authored
    // value IS the strength), no flicker (that is the face sheet's
    // heartbeat).
    expect(SHADE_BODY).toContain('+ primAlbedo * primGlow * (1.0 - cm)');
  });

  it('composes at the SAME two composite lines the face glow uses, and fades the lit term', () => {
    // The face path replaces lit with fleshLit * (1 - faceGlow) + glow;
    // per-prim glow fades by its own amount, and at primGlow 0 the factor is
    // exactly 1.0 — bit-identical (multiplication by 1.0 is exact), so every
    // non-glowing pixel everywhere shades byte-for-byte as before. The burn
    // emissive carrier rides the same line — gBurnEmit is 0 everywhere burn
    // is off (adding 0.0 is exact), and a burning body's fire is light.
    expect(SHADE_BODY).toContain(
      'var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow + gBurnEmit;');
  });

  it('char still kills per-prim glow — burnt is burnt', () => {
    // The face glow carries * (1.0 - cm); the per-prim term must too, or a
    // charred eye keeps shining through the burn.
    const glowLine = SHADE_BODY.split('\n').find(l => l.includes('+ primAlbedo * primGlow'))!;
    expect(glowLine).toContain('(1.0 - cm)');
  });

  it('does NOT resurrect the face glow on painted prims — the sunglasses rule is untouched', () => {
    // march.wgsl.ts zeroes faceGlow on paint so baked eyes cannot shine
    // through sunglasses. The precedence decision: that kill stays exactly
    // as it was and applies to the FACE term only; per-prim glow is authored
    // per prim and survives paint BY CONSTRUCTION — nothing in the kill
    // reads primGlow. This pins both halves: the kill string, and that the
    // kill line carries no primGlow.
    expect(SHADE_BODY).toContain('faceGlow = faceGlow * (1.0 - painted);');
    const killLine = SHADE_BODY.split('\n').find(l => l.includes('faceGlow = faceGlow * (1.0 - painted);'))!;
    expect(killLine).not.toContain('primGlow');
    // ...and primGlow is ASSIGNED exactly three times in the module: the `var
    // primGlow = 0.0` default, the clamp read, and the burning-body fade
    // (flame lab task 6 — a burning body's fire replaces authored glow). A
    // FOURTH assignment — e.g. a separate `primGlow = primGlow * (1.0 -
    // painted)` kill line — would be the resurrected sunglasses rule wearing
    // a different hat (this exact mutation was run and killed).
    expect((MARCH_TREE_SRC.match(/primGlow =/g) ?? []).length).toBe(3);
  });
});
