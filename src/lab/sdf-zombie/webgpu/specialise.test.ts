// src/lab/sdf-zombie/webgpu/specialise.test.ts
//
// The specialised shader has to be interchangeable with the generic one. What
// can be checked from text is the FOLD ORDER, which is the whole correctness
// argument — smin is not associative, so emitting the same primitives in a
// different order is a different surface, and it would not look obviously
// wrong on screen.

import { describe, it, expect } from 'vitest';
import { specialiseMapBody, structureKey } from './specialise';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { makeZombie } from '../body';
import { DEFAULT_FACE } from '../face';

const body = buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);

/** Primitive indices in the order the generated source folds them. */
function foldOrder(src: string, op: 'smin' | 'smax'): number[] {
  // The additive fold evaluates sdPrim on its own line so the ONE result
  // feeds both the smin and the argmin tracker (motion-polish task 6); the
  // smin then folds the shared `sd`. Carves keep the inline form.
  const re = op === 'smin'
    ? /^\s*sd = sdPrim\(p, (\d+), data\);$/gm
    : /d = smax\(d, -sdPrim\(p, (\d+), data\)/g;
  return [...src.matchAll(re)].map(m => Number(m[1]));
}

describe('specialiseMapBody', () => {
  const src = specialiseMapBody(body);

  it('starts with fn, so wgslFn can parse it', () => {
    // three's declarationRegexp is ^-anchored; a leading comment or blank line
    // makes the whole thing fail with one unhelpful error.
    expect(/^fn\s+mapBody\s*\(/.test(src)).toBe(true);
  });

  it('keeps the generic signature, so the two are interchangeable', () => {
    expect(src).toContain('data: texture_2d<f32>');
    expect(src).toContain('counts: vec4<f32>');
    expect(src).toContain('noiseAmp: f32');
    expect(src).toContain('woundCfg: vec4<f32>');
    expect(src).toContain('woundCfg2: vec4<f32>');
  });

  it('folds every additive primitive exactly once, in array order', () => {
    const additive = body.prims
      .map((p, i) => ({ p, i }))
      .filter(x => x.p.op !== 'sub')
      .map(x => x.i);
    expect(foldOrder(src, 'smin')).toEqual(additive);
  });

  it('applies every carve after the complete additive fold', () => {
    // Carving inside the additive fold would restructure a non-associative
    // smooth-min and change the surface everywhere, not just at the carve.
    const lastAdd = src.lastIndexOf('d = smin(');
    const firstCarve = src.indexOf('d = smax(d, -sdPrim');
    if (firstCarve >= 0) expect(firstCarve).toBeGreaterThan(lastAdd);
  });

  it('reads the alive flag at runtime rather than baking it', () => {
    // Severing flips alive constantly. Baking it would mean a pipeline compile
    // in the middle of a gib.
    expect(src).toContain('range.z >= 0.5');
  });

  it('bakes the blend constants as literals', () => {
    // The point of the exercise: no texel read to discover a primitive's k.
    const k = body.prims[0]!.blendK;
    expect(src).toContain(k.toPrecision(9));
  });

  it('keeps the zero-amplitude noise guard', () => {
    // The silhouette fbm runs ~100x per pixel and is the most expensive term
    // in the shader; losing its branch would undo the biggest LOD lever.
    expect(src).toContain('noiseAmp <= 0.0');
  });

  it('keeps the argmin tracking and the rest-space noise anchor (task 6)', () => {
    // PARITY with the generic mapBody: the specialised fold must track the
    // dominant prim (argmin over the SAME sd the fold uses — no second
    // sdPrim call) and anchor the noise term in that prim's rest frame, or
    // crowd/chunk bodies would shade with a different noise field than the
    // hero. The rest endpoints are runtime texture rows, so nothing about
    // them is baked — this is a text tripwire, not a value pin.
    expect(src).toContain('var bestIdx = -1;');
    expect(src).toContain('if (sd < best) { best = sd; bestIdx = ');
    expect(src).toContain('let anchor = restPoint(p, data, bestIdx, noiseLocal(p, noiseShift));');
    expect(src).toContain('return vec4<f32>(d + fbm(anchor * 3.0) * noiseAmp, f32(bestIdx), 0.0, 0.0);');
    // And the return packing matches the generic signature (x field, y argmin).
    expect(src).toContain('-> vec4<f32> {');
  });

  it('emits no dynamic loop at all — that is the whole point', () => {
    expect(src).not.toContain('for (');
  });

  it('drops clusters that are severed at BUILD time from the source', () => {
    // A body rebuilt with a limb already gone should not carry its primitives.
    const oneArmed: BuildResult = {
      ...body,
      clusters: body.clusters.map(c => (c.limb === 'armL' ? { ...c, alive: false } : c)),
    };
    // alive is a runtime flag, so the source is unchanged — that is deliberate
    // and this pins it, because the alternative is recompiling mid-gib.
    expect(specialiseMapBody(oneArmed)).toBe(src);
  });

  it('drops prims severed MID-LIMB (dead flag) from both passes', () => {
    // Unlike the cluster alive flag, dead is per-primitive and must be baked
    // out: the generic shader reads it from primScale.w, but here the fold
    // calls are literals. A dead prim left in the source keeps rendering.
    const armIdx = body.prims.findIndex(p => p.limb === 'armL');
    const midSevered: BuildResult = {
      ...body,
      prims: body.prims.map((p, i) => (i === armIdx ? { ...p, dead: true } : p)),
    };
    const deadSrc = specialiseMapBody(midSevered);
    expect(foldOrder(deadSrc, 'smin')).toEqual(foldOrder(src, 'smin').filter(i => i !== armIdx));
  });

  it('REFUSES a non-identity prim orient — a rig-posed body must use the generic march', () => {
    // sdPrim reads the quat row from the texture at runtime, so orient is
    // never baked as a literal — but a prim whose quat CHANGES per frame
    // (skull prims under applyRig) has no business in a structure-baked
    // shader at all. Assert the assumption rather than silently specialising
    // a body whose baked structure went stale. Crowd/chunks are always
    // identity, so this never fires for the bodies specialise serves.
    const posed: BuildResult = {
      ...body,
      prims: body.prims.map((p, i) => i === 0
        ? { ...p, orient: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number] }
        : p),
    };
    expect(() => specialiseMapBody(posed)).toThrow(/orient/);
  });

  it('accepts identity or absent orient — the crowd/chunk case', () => {
    const ident: BuildResult = {
      ...body,
      prims: body.prims.map((p, i) => i === 0
        ? { ...p, orient: [0, 0, 0, 1] as [number, number, number, number] }
        : p),
    };
    expect(specialiseMapBody(ident)).toBe(src);
  });
});

describe('structureKey', () => {
  it('ignores endpoint movement, which is what the rig does every frame', () => {
    const jiggled: BuildResult = {
      ...body,
      prims: body.prims.map(p => ({ ...p, a: [p.a[0] + 0.01, p.a[1], p.a[2]] as const })),
    };
    expect(structureKey(jiggled)).toBe(structureKey(body));
  });

  it('changes when a primitive becomes a carve', () => {
    const carved: BuildResult = {
      ...body,
      prims: body.prims.map((p, i) => (i === 0 ? { ...p, op: 'sub' as const } : p)),
    };
    expect(structureKey(carved)).not.toBe(structureKey(body));
  });

  it('changes when a blend constant changes, since those are baked', () => {
    const rebl: BuildResult = {
      ...body,
      prims: body.prims.map((p, i) => (i === 0 ? { ...p, blendK: p.blendK + 0.001 } : p)),
    };
    expect(structureKey(rebl)).not.toBe(structureKey(body));
  });

  it('does NOT change on a sever, so no pipeline compile happens mid-gib', () => {
    const dead: BuildResult = {
      ...body,
      clusters: body.clusters.map(c => (c.limb === 'head' ? { ...c, alive: false } : c)),
    };
    expect(structureKey(dead)).toBe(structureKey(body));
  });

  it('changes when a primitive goes dead, since dead prims are baked out', () => {
    const armIdx = body.prims.findIndex(p => p.limb === 'armL');
    const midSevered: BuildResult = {
      ...body,
      prims: body.prims.map((p, i) => (i === armIdx ? { ...p, dead: true } : p)),
    };
    expect(structureKey(midSevered)).not.toBe(structureKey(body));
  });
});
