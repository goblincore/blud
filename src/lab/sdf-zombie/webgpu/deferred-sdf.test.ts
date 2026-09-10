// src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts
//
// Text/structure gates for the SDF surface producer (hybrid deferred M1 task
// 2). As with march.wgsl.test.ts, nothing here compiles a shader — these pin
// the things text CAN pin: the parse contract, that the surface entry IS the
// production trace + material sections (not a copied or simplified marcher),
// that it exits before every light-dependent term, and that the legacy
// expansion kept its arithmetic. The semantic cases (light-invariant buffers,
// wound-reactive tissue, one trace for all attachments, legacy/surface depth
// parity) are the real-GPU gate — see
// docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md and task 3.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (march.wgsl.test.ts does the
// same for the same reason).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import {
  MARCH_SURFACE, MARCH_SURFACE_PROLOGUE, MARCH_SURFACE_TAIL, SDF_SURFACE_STATE,
  SDF_SURFACE_READ_ALBEDO, SDF_SURFACE_READ_NORMAL, SDF_SURFACE_READ_EMISSION,
  sdfSurfaceMarch, sdfSurfaceMrtNodes,
} from './deferred-sdf';
import {
  MARCH_BODY, MARCH_BODY_PARAMS, MARCH_BODY_TRACE, MARCH_BODY_SURFACE_PREP, MARCH_BODY_LIGHT,
} from './march.wgsl';
import { SURFACE_CLASS_FLESH, SURFACE_ATTACHMENT_NAMES } from './deferred-surface';

/** `fn name(` — the same shape three's ^-anchored declarationRegexp needs. */
function declaredName(src: string): string | null {
  return /^fn\s+([a-z_0-9]+)\s*\(/i.exec(src)?.[1] ?? null;
}

// Same reserved-word guard as march.wgsl.test.ts — a one-word slip is a blank
// page whose only symptom is a buried CreateShaderModule error.
const RESERVED_WORDS = [
  'active', 'as', 'auto', 'binding_array', 'cast', 'class', 'common', 'compile',
  'demote', 'do', 'enum', 'explicit', 'export', 'extern', 'external', 'filter',
  'final', 'from', 'get', 'impl', 'import', 'inline', 'interface', 'layout',
  'match', 'meta', 'mod', 'module', 'move', 'mut', 'new', 'nil', 'null', 'of',
  'operator', 'package', 'partition', 'pass', 'precise', 'precision', 'priv',
  'protected', 'pub', 'public', 'readonly', 'ref', 'register', 'resource',
  'restrict', 'self', 'set', 'shared', 'sizeof', 'smooth', 'snorm', 'static',
  'std', 'super', 'target', 'template', 'this', 'throw', 'try', 'type',
  'typedef', 'typeof', 'union', 'unorm', 'use', 'using', 'varying', 'virtual',
  'volatile', 'where', 'while', 'write', 'writeonly', 'yield',
];

const ALL_SURFACE_SOURCES = [
  MARCH_SURFACE, SDF_SURFACE_STATE,
  SDF_SURFACE_READ_ALBEDO, SDF_SURFACE_READ_NORMAL, SDF_SURFACE_READ_EMISSION,
];

describe('surface-entry wgslFn parse contract', () => {
  it('starts every new source with fn, since three anchors its parse to ^', () => {
    for (const src of ALL_SURFACE_SOURCES) expect(declaredName(src)).not.toBeNull();
    expect(declaredName(MARCH_SURFACE)).toBe('marchSurface');
  });

  it('declares no WGSL reserved words as identifiers', () => {
    for (const src of ALL_SURFACE_SOURCES) {
      const declared = [
        ...src.matchAll(/\b(?:let|var)\s+([a-z_][a-z_0-9]*)/gi),
        ...src.matchAll(/[(,]\s*([a-z_][a-z_0-9]*)\s*:/gi),
      ].map((m) => m[1]!);
      expect(declared.filter((d) => RESERVED_WORDS.includes(d))).toEqual([]);
    }
  });

  it('the real parser sees EXACTLY marchBody’s 99 inputs, in the same order — one binding block serves both', () => {
    // marchSurface shares MARCH_BODY_PARAMS textually, so createMarchMaterial's
    // positional binding cannot drift between the modes. Running the REAL
    // parser (not a grep) also proves no comment phantom crept into the shared
    // signature — the 2026-09-05 paren/colon failure class.
    const legacy = new WGSLNodeFunction(MARCH_BODY).inputs.map((i: { name: string }) => i.name);
    const surface = new WGSLNodeFunction(MARCH_SURFACE).inputs.map((i: { name: string }) => i.name);
    // 84 + 5 probe grid + 4 bounce spot + 2 dynamic probe layer + 1 bodyFlash, positionally last.
    // +3 temporal reprojection start (lastTex, lastInvVp, temporalCfg) — plan 2026-09-10.
    expect(legacy.length).toBe(99); // plus sampled-skeleton atlas and metadata textures
    expect(legacy).toContain('faceGlowRedOnly');
    expect(surface).toEqual(legacy);
  });

  it('parses the readbacks with the traced hit as their data-dependency input', () => {
    expect(new WGSLNodeFunction(SDF_SURFACE_READ_ALBEDO).inputs.map((i: { name: string }) => i.name)).toEqual(['dep']);
    expect(new WGSLNodeFunction(SDF_SURFACE_READ_NORMAL).inputs.map((i: { name: string }) => i.name)).toEqual(['dep']);
    // M2 task 2: the emission readback also takes the packed material class
    // (base class + shadow receiver bit) as an unlit uniform-fed input.
    expect(new WGSLNodeFunction(SDF_SURFACE_READ_EMISSION).inputs.map((i: { name: string }) => i.name))
      .toEqual(['dep', 'classVal']);
  });
});

describe('the surface entry IS the production march, not a copy', () => {
  it('is assembled from the shared sections in order', () => {
    expect(MARCH_SURFACE).toBe(
      `fn marchSurface${MARCH_BODY_PARAMS}${MARCH_SURFACE_PROLOGUE}${MARCH_BODY_TRACE}${MARCH_BODY_SURFACE_PREP}${MARCH_SURFACE_TAIL}`,
    );
    // The prologue (output reset) must precede the trace's first statement.
    expect(MARCH_SURFACE.indexOf('_ = sdfSurfaceStateReset();'))
      .toBeLessThan(MARCH_SURFACE.indexOf('gWindDrift = windDrift;'));
  });

  it('runs the real material chain — tissue, char, face, painted prims, melt — not the flat-albedo seam', () => {
    // The flat-albedo diagnostic (debugCfg.y) returns baseColor WITHOUT
    // normals or tissue evaluation; the surface path must be the real one.
    for (const marker of [
      'calcNormal(', 'woundMask(', 'charMask(', 'tissueRamp(', 'texel(faceTex',
      'primAlbedo', 'fbm(anchor * surfCfg2.w)', 'skinPatch', 'organColor',
    ]) {
      expect(MARCH_SURFACE).toContain(marker);
    }
  });

  it('traces exactly once and evaluates the field once per march step — no per-attachment retrace', () => {
    expect(MARCH_SURFACE.match(/for \(var i = 0; i < 512;/g)).toHaveLength(1);
    // In the ENTRY text mapBody appears at the march step PLUS the ONE
    // authored-response AO probe (M2 task 7: the unlit field AO lane of
    // surfaceParams — the same probe the legacy light tail pays, so the
    // budget is unchanged relative to the legacy path). calcNormal's own
    // calls live in CALC_NORMAL's source; the scatter/shadow probes are all
    // in the lighting tail this entry does not include. A FOURTH call would
    // mean a per-attachment retrace crept back in. The THIRD (plan
    // 2026-09-10) is the temporal start's inside check — one sample, taken
    // only when the reprojected bound is live, before the loop; not a
    // retrace. The FOURTH and FIFTH (2026-09-10 follow-up) are the recovery
    // probes' two textual sites in that same pre-loop gate — first probe
    // plus rewind loop — runtime-bounded at three evals, still gated on the
    // live bound, still not a retrace. (Count is textual: two sites, one
    // loop body.)
    expect(MARCH_SURFACE.match(/\bmapBody\(/g)).toHaveLength(4);
  });

  it('exits before every light-dependent term and the display conversion', () => {
    // Strip the shared signature first: the PARAMS legitimately NAME lightDir/
    // keyColor/spotCfg etc. (the binding block is shared); the contract is
    // that the surface entry's BODY never reads them.
    const body = MARCH_SURFACE.slice(MARCH_SURFACE.indexOf(') -> vec4<f32> {'));
    for (const absent of [
      'ambientAt(', 'woundShadow(', 'levelShadow(', 'softShoulder(',
      'spotCfg', 'lightDir', 'keyColor', 'lightCfg', 'var fleshLit',
      'lodCfg.y', '0.04045',
    ]) {
      expect(body).not.toContain(absent);
    }
    // …and the shared surface-prep section really is light-independent: it
    // must sit BEFORE the flashlight in the legacy expansion and contain no
    // light reads itself.
    for (const absent of ['spotCfg', 'lightDir', 'keyColor', 'lightCfg']) {
      expect(MARCH_BODY_SURFACE_PREP).not.toContain(absent);
    }
  });

  it('keeps the trace’s own behaviour: shell/hull gates, miss discard, and the flat-albedo seam intact', () => {
    for (const marker of [
      'if (shellOut <= 0.0) { discard;',
      'if (!hit) { discard; }',
      'if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }',
      'if (max(shellIn, bodyEntry) > prevT) { discard;',
    ]) {
      expect(MARCH_SURFACE).toContain(marker);
    }
  });
});

describe('surface output assembly', () => {
  it('writes all three private globals from the production values, flesh class, and returns the hit distance', () => {
    expect(MARCH_SURFACE_TAIL).toContain('gSdfAlbedoRough = vec4<f32>(albedo, surfRough);');
    expect(MARCH_SURFACE_TAIL).toContain('gSdfNormalMetal = vec4<f32>(normalize(n), metal);');
    expect(MARCH_SURFACE_TAIL).toContain(
      `gSdfEmissionClass = vec4<f32>(glow, ${SURFACE_CLASS_FLESH}.0);`,
    );
    expect(MARCH_SURFACE_TAIL).toContain('return vec4<f32>(albedo, t);');
  });

  it('maps roughness off the shared specPow exponent and the wetness term', () => {
    // Inverts the light pass’s shin = exp2((1 - rough) * 8) + 2 against the
    // legacy exponent, then lets wet tighten/char widen. Pin the shape, not
    // the tuning — the mapping is a documented M1 approximation.
    expect(MARCH_SURFACE_TAIL).toContain('1.0 - log2(max(specPow - 2.0, 1.0)) / 8.0');
    expect(MARCH_SURFACE_TAIL).toContain('mix(1.0, surfRough, min(wet, 1.0)) / max(wet, 1.0)');
    // specPow is defined once, in the SHARED section, and the legacy shine
    // consumes that same definition.
    expect(MARCH_BODY_SURFACE_PREP).toContain('let specPow = mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss);');
    expect(MARCH_BODY_LIGHT).toContain('let shine = pow(max(dot(n, H), 0.0), specPow);');
  });

  it('resets every output global per invocation, including the entry prologue', () => {
    for (const g of ['gSdfAlbedoRough', 'gSdfNormalMetal', 'gSdfEmissionClass']) {
      expect(SDF_SURFACE_STATE).toContain(`var<private> ${g}: vec4<f32>;`);
      expect(SDF_SURFACE_STATE.indexOf(`${g} = vec4<f32>(`)).toBeGreaterThan(-1);
    }
    expect(MARCH_SURFACE_PROLOGUE).toContain('_ = sdfSurfaceStateReset();');
  });

  it('emits the four task-1 attachment names, surfaceDepth from the traced clip depth', () => {
    // Call the assembly with stub TSL-ish values and read the MRT node's
    // output names back off the built node.
    const traced = { dep: true };
    const depth = { z: true };
    const node = sdfSurfaceMrtNodes(traced, depth);
    expect(node).toBeTruthy();
    // The MRTNode keeps the outputs object; names must be exactly the
    // contract's four, no more.
    const outputNames = Object.keys((node as unknown as { outputNodes?: Record<string, unknown> }).outputNodes ?? {});
    for (const name of SURFACE_ATTACHMENT_NAMES) expect(outputNames).toContain(name);
    expect(outputNames.sort()).toEqual([...SURFACE_ATTACHMENT_NAMES].sort());
  });

  it('accepts the M2 class-value override and stays name-stable with it', () => {
    // The receiver uniform rides the emission readback only — the other
    // three attachments and the names are untouched.
    const node = sdfSurfaceMrtNodes({ dep: true }, { z: true }, { value: 18 });
    const outputNames = Object.keys((node as unknown as { outputNodes?: Record<string, unknown> }).outputNodes ?? {});
    expect(outputNames.sort()).toEqual([...SURFACE_ATTACHMENT_NAMES].sort());
  });

  it('substitutes only the CLASS channel at the readback; emission RGB is the traced glow', () => {
    // Text pin of the M2 substitution: xyz from the traced global, w from
    // the uniform-fed input. The default (no override) is the plain flesh
    // class constant — the pre-M2 encoding — pinned by the tail test above.
    expect(SDF_SURFACE_READ_EMISSION).toContain('return vec4<f32>(gSdfEmissionClass.xyz, classVal);');
  });
});

describe('legacy expansion preserved', () => {
  it('reassembles MARCH_BODY from the sections in order', () => {
    expect(MARCH_BODY).toBe(
      `fn marchBody${MARCH_BODY_PARAMS}${MARCH_BODY_TRACE}${MARCH_BODY_SURFACE_PREP}${MARCH_BODY_LIGHT}`,
    );
  });

  it('keeps the wet/glow hoist arithmetic-neutral: identical statements, ordered before the flashlight', () => {
    // The hoisted statements are verbatim — pin them in the shared section…
    expect(MARCH_BODY_SURFACE_PREP).toContain(
      'var wet = mix(surfCfg2.x * mix(1.0, woundWetBoost, wetWound) * (1.0 - cm) * select(1.0, 1.8, isOrgan), 1.0, gloss);',
    );
    expect(MARCH_BODY_SURFACE_PREP).toContain(
      'let glow = faceGlowColor * faceGlow * faceCfg2.w\n           * flicker(faceCfg3.y, faceCfg3.x) * (1.0 - cm)',
    );
    // …and the legacy lighting tail consumes them, with the compose untouched.
    expect(MARCH_BODY_LIGHT).toContain('var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow;');
    expect(MARCH_BODY.indexOf('let wetWound')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    expect(MARCH_BODY.indexOf('let glow')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    // Each hoisted symbol is defined exactly once across the whole entry.
    expect(MARCH_BODY.match(/let specPow/g)).toHaveLength(1);
    expect(MARCH_BODY.match(/var wet =/g)).toHaveLength(1);
    expect(MARCH_BODY.match(/let glow =/g)).toHaveLength(1);
  });

  it('keeps the lighting tail’s field probes and display conversion exactly where they were', () => {
    for (const marker of [
      'mapBody(p + L * 0.06', // backlit scatter probe
      'mapBody(p + n * 0.06', // AO probe
      'woundShadow(p, L,', 'levelShadow(p, n,', 'ambientAt(p, n,',
      'c <= vec3<f32>(0.04045)', // legacy display compensation
    ]) {
      expect(MARCH_BODY_LIGHT).toContain(marker);
      expect(MARCH_BODY).toContain(marker);
    }
  });
});

describe('node chain', () => {
  it('builds a distinct surface entry node with the shared helper chain', () => {
    expect(sdfSurfaceMarch).toBeTruthy();
    expect(typeof sdfSurfaceMarch).toBe('function');
  });
});

describe('surfaceParams packing mirrors (M2 task 7)', () => {
  it('the surface tail packs with the exact CPU constants and strides', () => {
    // wgslFn takes one fn per string, so the packing arithmetic is DUPLICATED
    // in WGSL (tail) and TS (packSurfaceParams). These pins are the lockstep
    // contract — changing a constant on one side must fail here.
    expect(MARCH_SURFACE).toContain('paramsSpecA = mix(surfCfg.x, 1.5, gloss)');
    expect(MARCH_SURFACE).toContain('paramsFresB = surfCfg.z * (1.0 - wmRim) * mix(1.0, 2.5, gloss)');
    expect(MARCH_SURFACE).toContain('paramsSpecA * wet / 3.5');
    expect(MARCH_SURFACE).toContain('paramsFresB * wet / 5.0');
    expect(MARCH_SURFACE).toContain('paramsP8 * 65536.0 + paramsQ8 * 256.0');
    expect(MARCH_SURFACE).toContain('mapBody(p + n * 0.06');
    expect(MARCH_SURFACE).toContain('clamp(mapBody(p + n * 0.06');
  });

  it('the AO probe stays lodCfg.x-gated and hard-diffuse-only shape', () => {
    expect(MARCH_SURFACE).toContain('paramsAo = clamp(');
    expect(MARCH_SURFACE).toContain('0.35, 1.0)');
  });
});
