// src/lab/sdf-zombie/webgpu/goo-layer.test.ts
//
// Nothing here compiles a shader — these are the same text guards
// march.wgsl.test.ts applies, extended to the goo surface pass: the wgslFn
// parse contract (source must start with `fn`, three's declarationRegexp is
// ^-anchored) and the reserved-word lint on declarations. Plus value pins
// on the tuning that the mist/goo split depends on.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  GOO_TUNING, GOO_SURFACE_WGSL, GOO_ALPHA_WGSL, GOO_BLUR_WGSL,
  GOO_DENSITY_BLUE_IS_GUT_MASK,
} from './goo-layer';

/** The reserved words WGSL reserves even without implementing (spec appendix). */
const RESERVED_WORDS = [
  'active', 'alignas', 'alignof', 'as', 'asm', 'asm_fragment', 'async',
  'attribute', 'auto', 'await', 'become', 'binding_array', 'cast', 'catch',
  'class', 'co_await', 'co_return', 'co_yield', 'coherent', 'column_major',
  'common', 'compile', 'compile_fragment', 'concept', 'const_cast',
  'consteval', 'constexpr', 'constinit', 'crate', 'debugger',
  'decltype', 'delete', 'demote', 'demote_to_helper', 'do', 'dynamic_cast',
  'enum', 'explicit', 'export', 'extends', 'extern', 'external', 'fallthrough',
  'filter', 'final', 'finally', 'friend', 'from', 'fxgroup', 'get', 'goto',
  'groupshared', 'highp', 'impl', 'implements', 'import', 'inline',
  'instanceof', 'interface', 'layout', 'lowp', 'macro', 'macro_rules',
  'match', 'mediump', 'meta', 'mod', 'module', 'move', 'mut', 'mutable',
  'namespace', 'new', 'nil', 'noexcept', 'noinline', 'nointerpolation',
  'noperspective', 'null', 'nullptr', 'of', 'operator', 'package', 'packoffset',
  'partition', 'pass', 'patch', 'pixelfragment', 'precise', 'precision',
  'premerge', 'priv', 'protected', 'pub', 'public', 'readonly', 'ref',
  'regardless', 'register', 'reinterpret_cast', 'require', 'resource',
  'restrict', 'self', 'set', 'shared', 'sizeof', 'smooth', 'snorm',
  'static', 'static_assert', 'static_cast', 'std', 'subroutine', 'super',
  'target', 'template', 'this', 'thread_local', 'throw', 'trait', 'try',
  'type', 'typedef', 'typeof', 'union', 'unorm', 'use', 'using', 'varying',
  'virtual', 'volatile', 'where', 'while', 'write', 'writeonly', 'yield',
];

/** Declared names (let/var plus params/fields) in a WGSL string. */
function declaredNames(wgsl: string): string[] {
  return [
    ...wgsl.matchAll(/\b(?:let|var)\s+([a-z_][a-z_0-9]*)/gi),
    ...wgsl.matchAll(/[(,]\s*([a-z_][a-z_0-9]*)\s*:/gi),
  ].map(m => m[1]!);
}

describe('goo surface WGSL', () => {
  it('starts with fn, since three anchors its parse to ^', () => {
    expect(/^fn\s+gooSurface\s*\(/.test(GOO_SURFACE_WGSL)).toBe(true);
  });

  it('declares nothing reserved', () => {
    const clashes = declaredNames(GOO_SURFACE_WGSL).filter(d => RESERVED_WORDS.includes(d));
    expect(clashes).toEqual([]);
  });

  it('shades and depth-writes the metaball surface as specced', () => {
    // The metaball core: threshold discard, gradient normal, average-depth
    // fake depth, and the deep-red specular family.
    expect(GOO_SURFACE_WGSL).toContain('discard');
    expect(GOO_SURFACE_WGSL).toContain('textureLoad');
    expect(GOO_SURFACE_WGSL).toContain('smoothstep');
    expect(GOO_SURFACE_WGSL).toContain('vec3<f32>(0.62, 0.11, 0.10)');
    // The WebGPU [0,1] depth mapping three's perspective matrix produces.
    expect(GOO_SURFACE_WGSL).toContain('far * (viewDepth - near)');
  });
});

describe('goo blur WGSL (X1.21.1: grapes→sheets)', () => {
  it('starts with fn, since three anchors its parse to ^', () => {
    expect(/^fn\s+gooBlur\s*\(/.test(GOO_BLUR_WGSL)).toBe(true);
  });

  it('declares nothing reserved', () => {
    const clashes = declaredNames(GOO_BLUR_WGSL).filter(d => RESERVED_WORDS.includes(d));
    expect(clashes).toEqual([]);
  });

  it('is a 9-tap kernel whose weights derive from sigma and normalise', () => {
    // -4..4 inclusive is the 9 taps; runtime weights (not a baked table)
    // keep the slider live, and the wsum division preserves total density
    // so the surface threshold stays calibrated at any blurPx.
    expect(GOO_BLUR_WGSL).toContain('for (var i = -4; i <= 4;');
    expect(GOO_BLUR_WGSL).toMatch(/exp\(-f32\(i \* i\)\s*\/\s*\(2\.0 \* sigma \* sigma\)\)/);
    expect(GOO_BLUR_WGSL).toContain('wsum');
  });

  it('blurs every channel with the same weights (g/b depth ratio survives)', () => {
    // r=density, g=density*depth, b=density must all take the SAME kernel,
    // else the downstream g/b ratio stops being a smoothed depth estimate.
    expect(GOO_BLUR_WGSL).toMatch(/var sum = vec4<f32>\(0\.0\)/);
    expect(GOO_BLUR_WGSL).toMatch(/sum \+ textureLoad\(srcTex, c, 0\) \* w/);
    expect(GOO_BLUR_WGSL).toMatch(/return sum \/ wsum/);
  });
});

describe('goo blur wiring (source tripwires)', () => {
  // render() needs a live WebGPURenderer, so the bypass path is pinned as
  // text guards on the module source — the same discipline the WGSL tests
  // apply to strings that cannot execute in CI. Cwd-relative (vitest runs
  // from the repo root; import.meta.url is not a file URL under happy-dom).
  const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');

  it('bypasses both blur passes entirely at blurPx = 0', () => {
    // One hoisted gate, three consequences: the two blur renders and the
    // surface's choice of blurred-vs-raw texture. No degenerate copy pass.
    expect(src).toContain('const blurred = uBlurPx.value > 0');
    expect(src).toContain('if (blurred && passGate.blur) {');
    expect(src).toContain("surfMats[mode][blurred ? 'blur' : 'raw']");
    expect(src).toContain('void renderer.render(blurH.scene, quadCam)');
    expect(src).toContain('void renderer.render(blurV.scene, quadCam)');
  });

  it('the surface reads the blurred buffer, and the pair rides the density size', () => {
    expect(src).toContain('makeOverlayMat(blurB.texture)');
    expect(src).toContain('makeDepthMat(blurB.texture)');
    expect(src).toContain('makeBlurMat(blurA.texture, 0, 1)');
    // Same explicit-first-clear treatment as the density target (the
    // lazy-init trap) and the same resize in setSize — now including task
    // 4's low-res surface target.
    expect(src).toContain('for (const t of [target, blurA, blurB, surfaceLow])');
    expect(src).toContain('blurB.setSize(w, h)');
    expect(src).toContain('surfaceLow.setSize(w, h)');
  });
});

describe('goo tuning pins', () => {
  it('mist cutoff sits inside the burst droplet band (0.03-0.06)', () => {
    // burst() sizes droplets 0.03 + rng*0.03, so a cutoff inside that band
    // keeps SOME burst beads as mist while every trail droplet (0.22 ±
    // jitter) feeds the density field.
    expect(GOO_TUNING.mistMaxSize).toBeGreaterThan(0.03);
    expect(GOO_TUNING.mistMaxSize).toBeLessThan(0.06);
  });

  it('threshold leaves headroom for a lone blob to bead', () => {
    // A single falloff peaks near 1.0; the threshold must sit below that or
    // sparse drops vanish entirely instead of beading.
    expect(GOO_TUNING.threshold).toBeGreaterThan(0);
    expect(GOO_TUNING.threshold).toBeLessThan(1);
  });

  it('the density cap covers a fully-loaded sim plus scraps', () => {
    // The sim caps droplets at 600; scraps ride the same array, so 700
    // bounds any droplet population the sim can hold.
    expect(GOO_TUNING.maxParticles).toBeGreaterThanOrEqual(600);
  });

  it('blurPx defaults inside its slider range and 0 is a legal bypass', () => {
    // Panel slider is 0–5 step 0.5; the default must sit strictly inside so
    // the shipped look is the blurred one (the whole point of X1.21.1),
    // while 0 remains the documented bypass value.
    expect(GOO_TUNING.blurPx).toBeGreaterThan(0);
    expect(GOO_TUNING.blurPx).toBeLessThanOrEqual(5);
    expect(GOO_TUNING.blurPx).toBe(2.5);
    expect(Number.isInteger(GOO_TUNING.blurPx * 2)).toBe(true);
  });

  it('absorb/spec/gloss/rim defaults sit inside their own setter clamp range', () => {
    // A default outside its own clamp is a real bug class: the console
    // could never restore the shipped value once a knob was slid away from
    // it (M-5).
    expect(GOO_TUNING.absorb).toBeGreaterThanOrEqual(0);
    expect(GOO_TUNING.absorb).toBeLessThanOrEqual(3);
    expect(GOO_TUNING.spec).toBeGreaterThanOrEqual(0);
    expect(GOO_TUNING.spec).toBeLessThanOrEqual(4);
    expect(GOO_TUNING.gloss).toBeGreaterThanOrEqual(8);
    expect(GOO_TUNING.gloss).toBeLessThanOrEqual(400);
    expect(GOO_TUNING.rim).toBeGreaterThanOrEqual(0);
    expect(GOO_TUNING.rim).toBeLessThanOrEqual(1);
    expect(GOO_TUNING.shadowRed).toBeGreaterThanOrEqual(0);
    expect(GOO_TUNING.shadowRed).toBeLessThanOrEqual(0.6);
  });
});

describe('goo thickness shading (blood-viscosity spec §d)', () => {
  it('absorbs green and blue harder than red, so a thick core goes dark crimson', () => {
    const m = GOO_SURFACE_WGSL.match(
      /exp\(-thick \* vec3<f32>\(([\d.]+), ([\d.]+), ([\d.]+)\)\)/,
    );
    expect(m, 'the Beer-Lambert absorption vector must be present').not.toBeNull();
    const [r, g, b] = [Number(m![1]), Number(m![2]), Number(m![3])];
    // Blood is red because red survives the path length. If red were absorbed
    // as hard as green, thick blood would go grey, not crimson.
    expect(r).toBeLessThan(g);
    expect(r).toBeLessThan(b);
  });

  it('measures thickness from the field ABOVE the threshold, not raw density', () => {
    // dens alone would make the whole surface dark the moment the threshold
    // moves; (dens - thresh) keeps the thin fringe bright at any setting.
    expect(GOO_SURFACE_WGSL).toMatch(/let thick = max\(dens - thresh, 0\.0\) \* gooCfg2\.x/);
  });

  it('takes specular strength, exponent and rim from aliased uniform locals, not literals', () => {
    // I-4: gooCfg2's swizzles are aliased near `thresh` (the same convention
    // gooCfg.x already uses), so the shading terms below must read the
    // ALIAS, not a bare gooCfg2.y/.z/.w — that's what proves the uniform
    // actually reaches the shading term instead of sitting as a dead
    // binding that only appears in a comment.
    expect(GOO_SURFACE_WGSL).toMatch(/let specStr = gooCfg2\.y;/);
    expect(GOO_SURFACE_WGSL).toMatch(/let glossPow = gooCfg2\.z;/);
    expect(GOO_SURFACE_WGSL).toMatch(/let rimStr = gooCfg2\.w;/);
    expect(GOO_SURFACE_WGSL).toMatch(/pow\(max\(dot\(n, H\), 0\.0\),\s*glossPow\)/);
    expect(GOO_SURFACE_WGSL).toMatch(/glint\s*\*\s*specStr/);
    expect(GOO_SURFACE_WGSL).toMatch(/fres\s*\*\s*rimStr/);
    // No numeric literal exponent left on the glint pow — a hard-coded
    // number there (the old 90.0) would mean the uniform is dead code.
    expect(GOO_SURFACE_WGSL).not.toMatch(/pow\(max\(dot\(n, H\), 0\.0\),\s*[\d.]+\)/);
  });

  it('adds highlights OUTSIDE the absorbed body, not scaled by transmittance', () => {
    // The central claim of this commit: a surface reflection never
    // travelled through the blood, so the glint term must NOT carry the
    // `trans` (Beer-Lambert transmittance) factor the base colour does.
    // Without this guard, `lit = lit + trans * keyColor * glint * ...`
    // would pass every other test in this file.
    const glintLine = GOO_SURFACE_WGSL.match(/lit = lit \+ [^;]*glint[^;]*;/);
    expect(glintLine, 'a glint highlight line must be present').not.toBeNull();
    expect(glintLine![0]).not.toMatch(/\btrans\b/);
  });

  it('declares gooCfg2 as a vec4 parameter', () => {
    expect(GOO_SURFACE_WGSL).toMatch(/gooCfg2: vec4<f32>/);
  });
});

describe('goo shading setters (blood-viscosity spec: clamp ranges)', () => {
  // The clamp trap, in test form: setThreshold was clamped at 0.95 while a
  // lone blob peaks near 1.0, so no reachable value could reject a single
  // droplet and three rounds of tuning were unwinnable. Every new setter gets
  // its ceiling checked against the range the shader actually produces.
  it('exposes absorb/spec/gloss/rim on the layer interface', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');
    for (const fn of ['setAbsorb', 'setSpec', 'setGloss', 'setRim']) {
      expect(src, `${fn} must exist`).toContain(`${fn}(`);
    }
  });

  it('clamps all four setters to the range the shader actually produces', () => {
    // Whitespace-tolerant (not pinned to one-line formatting) so a reformat
    // doesn't break this, but still asserts the exact bounds per setter —
    // absorb and gloss per the 2D prototype range, spec and rim previously
    // unpinned entirely.
    const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');
    const clamp = (fn: string, uniformName: string, lo: string, hi: string) => {
      const re = new RegExp(
        `${fn}\\(v\\)\\s*\\{\\s*${uniformName}\\.value\\s*=\\s*Math\\.max\\(${lo},\\s*Math\\.min\\(${hi},\\s*v\\)\\)\\s*;\\s*\\}`,
      );
      expect(src, `${fn} must clamp to [${lo}, ${hi}]`).toMatch(re);
    };
    clamp('setAbsorb', 'uAbsorb', '0', '3');
    clamp('setSpec', 'uSpec', '0', '4');
    // CEILING 220 -> 400 (2026-08-31). The owner's own tuning pass landed on
    // gloss EXACTLY 220 — the old ceiling — which is the signature of a clamp
    // capping intent rather than guarding a range. Same story for stretch
    // (4 -> 8, pinned below). Both originals were guesses; do not "restore"
    // them without measuring what the shader produces up there.
    clamp('setGloss', 'uGloss', '8', '400');
    clamp('setRim', 'uRim', '0', '1');
    // shadowRed: the deep-red floor that stops absorption or a grazing light
    // from driving blood to black. Ceiling 0.6 — past that the floor swamps
    // the thickness gradient it exists to preserve.
    clamp('setShadowRed', 'uShadowRed', '0', '0.6');
  });
});

describe('goo alpha WGSL (overlay mode)', () => {
  it('starts with fn, since three anchors its parse to ^', () => {
    expect(GOO_ALPHA_WGSL.startsWith('fn ')).toBe(true);
  });

  it('declares nothing reserved', () => {
    for (const name of declaredNames(GOO_ALPHA_WGSL)) {
      expect(RESERVED_WORDS, `"${name}" is a WGSL reserved word`).not.toContain(name);
    }
  });

  it('discards below the threshold, exactly as the surface pass does', () => {
    // If the two passes disagreed on the cutoff, overlay mode would blend a
    // colour the surface pass never shaded.
    expect(GOO_ALPHA_WGSL).toContain('if (dens < thresh) { discard; }');
  });

  it('returns the soft-edge band in w so strands feather instead of hard-cutting', () => {
    expect(GOO_ALPHA_WGSL).toMatch(/smoothstep\(thresh, thresh \* gooCfg\.y, dens\)/);
    expect(GOO_ALPHA_WGSL).toMatch(/return vec4<f32>\(0\.0, 0\.0, 0\.0, a\)/);
  });
});

describe('goo overlay mode wiring (source tripwires)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');

  it('builds a material per (mode x blurred) combination', () => {
    // Asserted on the table literal and the dynamic lookup, NOT on
    // "surfMats.depth.blur"-style paths: render() indexes the pair with
    // computed keys, so those strings never appear in the source.
    expect(src).toMatch(/overlay: \{ raw: makeOverlayMat\(target\.texture\), blur: makeOverlayMat\(blurB\.texture\) \}/);
    expect(src).toMatch(/depth: \{ raw: makeDepthMat\(target\.texture\), blur: makeDepthMat\(blurB\.texture\) \}/);
    expect(src).toContain("surfMats[mode][blurred ? 'blur' : 'raw']");
  });

  it('overlay materials neither test nor write depth, and are transparent', () => {
    expect(src).toMatch(/m\.depthWrite = false;\s*\n\s*m\.depthTest = false;\s*\n\s*m\.transparent = true;/);
  });

  it('overlay materials do not bind a depthNode', () => {
    // Binding depthNode in overlay mode would silently reinstate the
    // reconstruction this mode exists to delete.
    const overlayFn = src.slice(src.indexOf('function makeOverlayMat'), src.indexOf('function makeDepthMat'));
    expect(overlayFn).not.toContain('depthNode');
  });

  it('retires setDepthTest in favour of setMode', () => {
    expect(src).not.toContain('setDepthTest');
    expect(src).toContain("setMode(m: 'overlay' | 'depth')");
  });

  it('defaults to overlay — the shipped answer to the depth blocker', () => {
    expect(src).toMatch(/let mode: 'overlay' \| 'depth' = 'overlay';/);
  });
});

describe('goo sync wiring (the bug that hid the whole layer)', () => {
  // The game-page port shipped WITHOUT a gooLayer.sync() call. sync() poses
  // the InstancedMesh density quads from sim state; without it every instance
  // matrix stays zeroed, the density field is empty on every frame, and no
  // threshold can ever be crossed — the pass renders nothing at all. That
  // presented as "the goo does not work in game", and cost five threshold
  // sweeps plus a depth-reconstruction investigation before anyone checked
  // whether the field had anything in it.
  //
  // These are source tripwires, in the same style as the blur-wiring guards
  // above: nothing here constructs a renderer.
  it('the game page syncs the density quads every frame', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');
    expect(src).toMatch(/gooLayer\?\.sync\(bloodSim, camera\)/);
  });

  it('the game page syncs AFTER the camera is final, so the quads billboard correctly', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');
    const cam = src.indexOf('camera.updateMatrixWorld();');
    const sync = src.indexOf('gooLayer?.sync(bloodSim, camera)');
    expect(cam, 'camera.updateMatrixWorld() must be present').toBeGreaterThan(-1);
    expect(sync, 'the goo sync must be present').toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(cam);
  });

  it('the lab still syncs too — this contract belongs to both pages', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/lab-main.ts', 'utf8');
    expect(src).toMatch(/gooLayer\.sync\(bloodSim, camera\)/);
  });
});

describe('goo surface normals (world-oriented reconstruction)', () => {
  it('reconstructs a VIEW POSITION per texel, not just a density gradient', () => {
    // The unnormalised ray with z = -1 scaled by view depth is the view
    // position; that is the whole trick, and it is what lets the normal
    // respond to where the surface points in the world.
    expect(GOO_SURFACE_WGSL).toMatch(/let pC = vec3<f32>\([^;]*-1\.0\) \* dC;/);
    expect(GOO_SURFACE_WGSL).toContain('let texel = vec2<f32>(2.0, 2.0) / dims;');
  });

  it('crosses the screen-space derivatives of that position', () => {
    expect(GOO_SURFACE_WGSL).toMatch(/var nSurf = cross\(ddx, ddy\);/);
  });

  it('uses min-difference so silhouettes do not bend the normal', () => {
    // At a blob edge one neighbour sits on empty field, where g/b is a ratio
    // of near-zeros. Using it would ring every mass with a bright rim.
    expect(GOO_SURFACE_WGSL).toMatch(/if \(cr\.r < 1e-4 \|\| abs\(ddxB\.z\) < abs\(ddx\.z\)\)/);
    expect(GOO_SURFACE_WGSL).toMatch(/if \(cu\.r < 1e-4 \|\| abs\(ddyB\.z\) < abs\(ddy\.z\)\)/);
  });

  it('falls back to the gradient normal rather than emitting a NaN', () => {
    // An isolated texel has no valid difference in either axis; normalising a
    // zero-length cross product would blacken the pixel.
    expect(GOO_SURFACE_WGSL).toMatch(/if \(nSurfLen < 1e-8\) \{\s*nSurf = nGrad;/);
  });

  it('keeps the normal facing the camera', () => {
    expect(GOO_SURFACE_WGSL).toMatch(/if \(nSurf\.z < 0\.0\) \{ nSurf = -nSurf; \}/);
  });

  it('keeps BOTH normals reachable, selected by a uniform', () => {
    // The gradient path is the A/B control, not dead code — it is how the two
    // get compared on the live panel.
    expect(GOO_SURFACE_WGSL).toContain('let nCam = select(nGrad, nSurf, normalMode > 0.5);');
    expect(GOO_SURFACE_WGSL).toMatch(/normalMode: f32/);
  });

  it('reuses ONE set of neighbour taps for both normals', () => {
    // Loading .r for the gradient and g/b for the position separately would
    // double the sample count for no gain.
    const taps = GOO_SURFACE_WGSL.match(/textureLoad\(densTex, clamp\(px [+-]/g) ?? [];
    expect(taps.length).toBe(4);
  });

  it('defaults to the surface normal', () => {
    expect(GOO_TUNING.surfaceNormals).toBe(true);
  });
});

describe('gut tint (organs r3)', () => {
  it('density writes the gut mask into the redundant BLUE channel', () => {
    // .r is density, .g/.b reconstruct view depth (c.g / max(c.b,1e-4)).
    // .a was written as a constant 1 and never read — that is the free slot.
    expect(GOO_DENSITY_BLUE_IS_GUT_MASK).toBe(true);
  });

  it('the surface lerps toward the organ colour by the gut fraction', () => {
    expect(GOO_SURFACE_WGSL).toContain('gutFrac');
    // Blood NEAR a rope must stay blood — a disembowelled body bleeds heavily
    // exactly there — so the lerp is per-pixel by ratio, not a global switch.
    expect(GOO_SURFACE_WGSL).toMatch(/gutFrac\s*=\s*c\.b\s*\/\s*max\(c\.r/);
  });

  it('takes organColor as a parameter and mixes the base with it', () => {
    // A plain fn parameter bound to one shared uniform node, the same shape
    // as every other colour the pass takes (keyColor) — so both surface
    // materials (raw/blurred) and both modes read one value.
    expect(GOO_SURFACE_WGSL).toContain('organColor: vec3<f32>');
    expect(GOO_SURFACE_WGSL)
      .toMatch(/mix\(vec3<f32>\(0\.62, 0\.11, 0\.10\), organColor, gutFrac\)/);
  });
});

describe('gut mask wiring (source tripwires)', () => {
  it('the gut mask rides BLUE, never alpha', () => {
    // Alpha is unavailable here and the failure is SILENT: the density pass
    // writes through a node material's colorNode, and three forces that
    // alpha to `opacity`. A custom alpha term is discarded, so .a accumulated
    // a constant 1 per quad and gutFrac = a/r came out >= 1 nearly
    // everywhere — every blood pixel painted with the organ colour. Caught
    // only by A/B against main, never by a source assertion.
    expect(GOO_DENSITY_BLUE_IS_GUT_MASK).toBe(true);
    expect(GOO_SURFACE_WGSL).not.toMatch(/gutFrac\s*=\s*c\.a/);
  });

  it('view depth divides by .r, which is what makes .b free', () => {
    // .r and .b both held `fall`, so .g/.b and .g/.r are the same number.
    // Dividing by .r frees .b at zero cost — it was redundant, not spare.
    expect(GOO_SURFACE_WGSL).toMatch(/c\.g \/ max\(c\.r, 1e-4\)/);
    expect(GOO_SURFACE_WGSL).not.toMatch(/c\.g \/ max\(c\.b, 1e-4\)/);
  });

  it('with no gut droplets the blood colour is the original literal', () => {
    // REWRITTEN. Task 6's version pinned "the inertness chain link by link"
    // through the ALPHA channel and concluded the feature was inert. Every
    // link was true AS SOURCE TEXT and the conclusion was false: three
    // discards a node material's colorNode alpha (forced to `opacity`), so
    // .a accumulated a constant 1 per quad and gutFrac came out >= 1 on
    // BLOOD too — every blood pixel painted with the organ colour.
    //
    // That is the shape of the mistake worth remembering: a test can verify
    // each step of a chain and still be wrong about the chain, when a step
    // it cannot see silently drops the value. It was caught by comparing
    // against main in a browser, not here.
    //
    // The mask now rides .b, which is genuinely free — .r and .b both held
    // `fall`, so dividing depth by .r instead of .b costs nothing.
    const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');
    expect(src).toMatch(
      /colorNode\s*=\s*vec4\(weightedFall,\s*weightedFall\.mul\(viewDepth\),\s*weightedFall\.mul\(gutMask\),\s*1\)/,
    );
    // The weight multiplies ALL THREE accumulated channels — if it scaled
    // density but not density*depth, faded splats would reconstruct a WRONG
    // depth (g/r no longer the same depth), shifting surface normals.
    expect(src).toMatch(/const weightedFall = fall\.mul\(fallMask\);/);
    expect(GOO_SURFACE_WGSL).toMatch(/gutFrac = clamp\(gutFrac, 0\.0, 1\.0\)/);
    expect(GOO_SURFACE_WGSL).toContain('let baseCol = mix(vec3<f32>(0.62, 0.11, 0.10), organColor, gutFrac)');
  });
});

// -------------------------------------------------------------------------
// CLOSE-UP TASK 4 — goo perf levers. Pure decision code is tested directly;
// the render-path seams cannot run without a WebGPU device, so their OFF
// defaults and the invariants that keep the shipped path intact are pinned
// as source tripwires (the same discipline the blur-wiring guards use).
// -------------------------------------------------------------------------

import {
  projectedTexelRadius, splatDensityWeight, orderIndicesByAreaDesc,
  GOO_UPSAMPLE_WGSL,
} from './goo-layer';

describe('projectedTexelRadius (item 2a decision code)', () => {
  it('a world half-extent of half the view-plane height projects to targetH/2 texels', () => {
    // View-plane half-height at distance d is d*tan(fov/2); pick d and tan so
    // the extent equals it: the projection must be exactly half the target.
    const d = 10;
    const tan = 0.5; // view-plane half-height 5
    const px = projectedTexelRadius(5, d, tan, 400);
    expect(px).toBeCloseTo(400 / 2, 6);
  });

  it('scales linearly with extent and target height, inversely with distance', () => {
    const base = projectedTexelRadius(0.1, 5, 1, 400);
    expect(projectedTexelRadius(0.2, 5, 1, 400)).toBeCloseTo(base * 2, 9);
    expect(projectedTexelRadius(0.1, 5, 1, 800)).toBeCloseTo(base * 2, 9);
    expect(projectedTexelRadius(0.1, 10, 1, 400)).toBeCloseTo(base / 2, 9);
  });

  it('degenerate inputs project to Infinity (never skip on bad state)', () => {
    expect(projectedTexelRadius(0.1, 0, 1, 400)).toBe(Infinity);
    expect(projectedTexelRadius(0.1, -1, 1, 400)).toBe(Infinity);
    expect(projectedTexelRadius(0.1, 5, 1, 0)).toBe(Infinity);
  });
});

describe('splatDensityWeight (item 3 decision code)', () => {
  it('off (fadeTail 0) is weight 1 everywhere', () => {
    expect(splatDensityWeight(0, 256, 0)).toBe(1);
    expect(splatDensityWeight(255, 256, 0)).toBe(1);
    expect(splatDensityWeight(3, 10, -1)).toBe(1);
  });

  it('the newest splat is always full weight; the oldest approaches 0 in a saturated ring', () => {
    expect(splatDensityWeight(0, 256, 128)).toBe(1);
    const oldest = splatDensityWeight(255, 256, 128);
    expect(oldest).toBeGreaterThan(0);
    expect(oldest).toBeLessThan(0.01);
  });

  it('is monotonically non-increasing from newest to oldest', () => {
    let prev = 1.01;
    for (let rank = 0; rank < 256; rank++) {
      const w = splatDensityWeight(rank, 256, 128);
      expect(w).toBeLessThanOrEqual(prev);
      expect(w).toBeGreaterThan(0);
      prev = w;
    }
  });

  it('an unsaturated ring keeps nearly-full weight (no fade before accumulation)', () => {
    // 10 splats with a 128 tail: everything is "recent" — the pool must not
    // thin before the ring has actually accumulated.
    expect(splatDensityWeight(0, 10, 128)).toBe(1);
    expect(splatDensityWeight(9, 10, 128)).toBeGreaterThan(0.9);
  });

  it('crosses 0.5 mid-tail and is smooth there (no visible band in the pool)', () => {
    const total = 256;
    const tail = 128;
    const mid = splatDensityWeight(total - tail / 2 - 1, total, tail);
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
  });
});

describe('orderIndicesByAreaDesc (item 2b decision code)', () => {
  it('orders by area descending and fills exactly count entries', () => {
    const out = orderIndicesByAreaDesc([3, 1, 9, 4], 4, []);
    expect(out).toEqual([2, 3, 0, 1]);
  });

  it('breaks ties by index ascending (deterministic frames)', () => {
    const out = orderIndicesByAreaDesc([5, 5, 5], 3, []);
    expect(out).toEqual([0, 1, 2]);
  });

  it('handles count 0 and sorts only the first count indices (caller fills the cap)', () => {
    expect(orderIndicesByAreaDesc([1, 2], 0, [])).toEqual([]);
    // The helper sorts the FIRST count indices, not a top-count selection —
    // sync() always hands it every candidate and truncates at the cap after.
    const out = orderIndicesByAreaDesc([7, 8, 9], 2, []);
    expect(out).toEqual([1, 0]);
  });
});

describe('goo perf seams (source tripwires)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');

  it('every lever defaults to the shipped state', () => {
    expect(src).toContain('let surfaceAtDensityRes = false;');
    expect(src).toContain('let minTexelRadius = 0;');
    expect(src).toContain('let areaPriority = false;');
    expect(src).toContain('let splatFadeTail = 0;');
    expect(src).toContain('const passGate = { density: true, blur: true, surface: true };');
  });

  it('the low-res surface target carries no depth attachment and half-float', () => {
    const block = src.slice(src.indexOf('const surfaceLow = new THREE.RenderTarget'), src.indexOf('function makeLowDepthMat'));
    expect(block).toContain('depthBuffer: false');
    expect(block).toContain('THREE.HalfFloatType');
  });

  it('the low DEPTH variant packs depth into the colour alpha, never depthNode', () => {
    // The shading pass must not depth-test (its own buffer is empty); the
    // hardware depth test happens in the upsample against the scene.
    const block = src.slice(src.indexOf('function makeLowDepthMat'), src.indexOf('const lowMats'));
    expect(block).toContain('vec4(shaded.xyz as never, shaded.w as never)');
    expect(block).toContain('m.depthWrite = false;');
    expect(block).not.toContain('depthNode');
  });

  it('the upsample DEPTH variant is the only new place depthNode is bound', () => {
    const block = src.slice(src.indexOf('function makeUpsampleMat'), src.indexOf('const lowQuad'));
    expect(block).toContain('m.depthNode = c.w as never;');
    expect(block).toMatch(/if \(depth\) \{/);
    expect(block).toContain('m.depthTest = true;');
  });

  it('the low pass clears black with ALPHA 0 — the upsample empty sentinel', () => {
    // A cleared alpha of 1 would be a depth of 1 (or an opaque, gut-masked
    // sludge) in every unshaded texel; the restored scene clear is the
    // background with alpha 1, so the low pass owns its clear explicitly.
    expect(src).toContain('renderer.setClearColor(0x000000, 0);');
    expect(src).toContain('renderer.setClearColor(prevClear, prevClearAlpha);');
  });

  it('the density pass clear is untouched', () => {
    // Ground rule: the density target's clear colour is black with alpha 0,
    // explicitly and for two documented reasons. (The shipped code's
    // setClearColor(0x000000) predates task 4 and is not ours to restate.)
    expect(src).toContain('renderer.setClearColor(0x000000);');
    expect(src).toContain('void renderer.render(gooScene, camera);');
  });

  it('passGate only skips work; it never changes what the kept passes read', () => {
    // The surface must keep reading the BLURRED buffer when blurPx > 0 even
    // when the blur passes are gate-skipped, so a gated surface leg times the
    // same shader, not a cheaper raw-buffer one.
    expect(src).toContain('const blurred = uBlurPx.value > 0;');
    expect(src).toContain('if (blurred && passGate.blur) {');
    expect(src).toContain('if (!passGate.surface) return;');
    expect(src).toContain('if (passGate.density) void renderer.render(gooScene, camera);');
  });

  it('the item-1 branch returns after the upsample — the shipped pass B is the else arm', () => {
    expect(src).toContain('if (surfaceAtDensityRes) {');
    expect(src).toContain('const wantMat = surfMats[mode][blurred ? \'blur\' : \'raw\'];');
  });

  it('the minTexel skip is inert at 0 without touching the mist gates', () => {
    expect(src).toContain('if (minTexelRadius <= 0) return false;');
    // Both collection paths keep the mist/size gates ahead of any skip.
    const drops = src.match(/if \(d\.kind === 'mist'\) continue;/g) ?? [];
    expect(drops.length).toBe(2); // once per sync path
  });

  it('sync still updates the fallMask buffer and draws only live instances', () => {
    expect(src).toContain('fallAttr.needsUpdate = true;');
    expect(src).toContain('quads.count = n;');
  });
});

describe('goo upsample WGSL (item 1)', () => {
  it('starts with fn, since three anchors its parse to ^', () => {
    expect(/^fn\s+gooUpsample\s*\(/.test(GOO_UPSAMPLE_WGSL)).toBe(true);
  });

  it('declares nothing reserved', () => {
    const clashes = declaredNames(GOO_UPSAMPLE_WGSL).filter(d => RESERVED_WORDS.includes(d));
    expect(clashes).toEqual([]);
  });

  it('carries NO flipY — target-to-target sampling is orientation-preserving', () => {
    // The shading pass already paid the canvas-boundary flip when it read the
    // density field; flipping here would render the goo upside-down.
    expect(GOO_UPSAMPLE_WGSL).not.toContain('flipY');
  });

  it('discards on the cleared-alpha sentinel and passes the packed alpha through', () => {
    expect(GOO_UPSAMPLE_WGSL).toContain('if (c.a < 9.99e-5) { discard; }');
    expect(GOO_UPSAMPLE_WGSL).toContain('return vec4<f32>(c.rgb, c.a);');
  });
});

describe('goo perf page seam (source tripwires)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');

  it('exposes setGooPerf and reports the lever state in the goo getter', () => {
    expect(src).toContain('setGooPerf(o: {');
    expect(src).toContain('surfaceAtDensityRes: gooLayer.surfaceAtDensityRes,');
    expect(src).toContain('passGate: gooLayer.passGate,');
  });

  it('keeps the perf seams OUT of setGooTuning', () => {
    // The goo panel's copy button emits setGooTuning keys; a perf lever in
    // that schema would let a tuning paste silently move a bench seam.
    const block = src.slice(src.indexOf('setGooTuning(o: {'), src.indexOf('setGooPerf(o: {'));
    expect(block).not.toContain('surfaceAtDensityRes');
    expect(block).not.toContain('minTexelRadius');
  });
});

// -------------------------------------------------------------------------
// BLOOD-SURFACE COMPARISON (2026-09-13) — the opt-in smooth reconstruction.
// The interpolation/coverage maths is factored PURE so it can be pinned here;
// the WGSL that mirrors it cannot compile in CI, so its structure is pinned
// as text the same way the rest of this file does.
// -------------------------------------------------------------------------

import {
  GOO_SURFACE_SMOOTH_WGSL, GOO_COVERAGE_SMOOTH_WGSL,
  GOO_FIELD_EMPTY_EPS, GOO_NEIGHBOR_MIN_FRACTION,
  GOO_FIELD_DEPTH_REL, GOO_FIELD_DEPTH_MIN,
  sampleGooField, silhouetteCoverage, gooFieldGradient, neighborDensityUsable,
  densityTexelsPerOutputPixel,
  type GooDensityBlob,
} from './goo-layer';

/** Builds an interleaved RGBA field from per-texel [r,g,b] triples. */
function makeField(texels: number[][]): Float32Array {
  const out = new Float32Array(texels.length * 4);
  texels.forEach((t, i) => {
    out[i * 4] = t[0] ?? 0;
    out[i * 4 + 1] = t[1] ?? 0;
    out[i * 4 + 2] = t[2] ?? 0;
    out[i * 4 + 3] = 1;
  });
  return out;
}

describe('sampleGooField (smooth reconstruction maths)', () => {
  it('reads exact texel centres and clamps at the edges', () => {
    const f = makeField([[1, 2, 0.3], [5, 6, 0.7]]); // 2x1
    const a = sampleGooField(f, 2, 1, 0.25, 0.5); // centre of texel 0
    expect(a.density).toBeCloseTo(1, 6);
    expect(a.viewDepth).toBeCloseTo(2, 6);
    expect(a.gutFrac).toBeCloseTo(0.3, 6);
    // u=0 and u=1 clamp to the edge texels, not extrapolate.
    expect(sampleGooField(f, 2, 1, 0, 0.5).density).toBeCloseTo(1, 6);
    expect(sampleGooField(f, 2, 1, 1, 0.5).density).toBeCloseTo(5, 6);
  });

  it('interpolates density-weighted channels as a weighted MEAN, not a mean of ratios', () => {
    // Texel A: density 1, depth 1 (g=1). Texel B: density 3, depth 1.2
    // (g=3.6). At the midpoint density is 2 and g is 2.3, so depth is 1.15 —
    // the density-weighted mean. Averaging the ratios directly gives 1.1.
    // The depth spread (0.2) stays under the layer tolerance so the blend is
    // exercised rather than the discontinuity fallback.
    const f = makeField([[1, 1, 0.2], [3, 3.6, 3.0]]);
    const mid = sampleGooField(f, 2, 1, 0.5, 0.5);
    expect(mid.discontinuous).toBe(false);
    expect(mid.density).toBeCloseTo(2, 6);
    expect(mid.viewDepth).toBeCloseTo(1.15, 6);
    // gut = (0.5*0.2 + 0.5*3.0) / (0.5*1 + 0.5*3) = 1.6 / 2 = 0.8
    expect(mid.gutFrac).toBeCloseTo(0.8, 6);
  });

  it('reports an empty sample below the sentinel, with zeroed ratios', () => {
    const empty = sampleGooField(makeField([[0, 0, 0], [0, 0, 0]]), 2, 1, 0.5, 0.5);
    expect(empty.occupied).toBe(false);
    expect(empty.density).toBe(0);
    expect(empty.viewDepth).toBe(0);
    expect(empty.gutFrac).toBe(0);
  });

  it('half-empty interpolation keeps a finite, occupancy-gated result', () => {
    // One live texel beside an empty one: mid density is half, and the
    // ratio still divides by the interpolated density. The important
    // property for the surface pass is that the caller discards on density
    // below threshold, so a noisy ratio near the empty edge is never shaded.
    const f = makeField([[2, 4, 0], [0, 0, 0]]);
    const mid = sampleGooField(f, 2, 1, 0.5, 0.5);
    expect(mid.occupied).toBe(true);
    expect(mid.density).toBeCloseTo(1, 6);
    expect(mid.viewDepth).toBeCloseTo(2, 6); // (0.5*4 + 0.5*0) / 1
    expect(Number.isFinite(mid.viewDepth)).toBe(true);
  });

  it('returns empty for degenerate dimensions rather than NaN', () => {
    const s = sampleGooField([], 0, 0, 0.5, 0.5);
    expect(s.occupied).toBe(false);
    expect(Number.isFinite(s.density)).toBe(true);
  });

  it('rejects a bilinear blend across two separate layers (no phantom depth)', () => {
    // Texel A: foreground, density 1, depth 1. Texel B: background, density 1,
    // depth 9. A density-weighted blend would report depth 5 — a phantom
    // half-way between two blood bodies. The guard must report one of the
    // real layers instead.
    const f = makeField([[1, 1, 0], [1, 9, 0]]);
    const mid = sampleGooField(f, 2, 1, 0.5, 0.5);
    expect(mid.discontinuous).toBe(true);
    expect(mid.viewDepth).not.toBeCloseTo(5, 1);
    expect([1, 9].some(d => Math.abs(d - mid.viewDepth) < 1e-6)).toBe(true);
    // Density still interpolates: the field itself is additive.
    expect(mid.density).toBeCloseTo(1, 6);
  });

  it('keeps a same-layer blend continuous (below the tolerance)', () => {
    // Depths 1.0 and 1.1 differ far less than the relative tolerance, so the
    // weighted mean must survive untouched.
    const f = makeField([[1, 1, 0], [3, 3.3, 0]]);
    const mid = sampleGooField(f, 2, 1, 0.5, 0.5);
    expect(mid.discontinuous).toBe(false);
    // (0.5*1 + 0.5*3.3) / 2 = 1.075
    expect(mid.viewDepth).toBeCloseTo(1.075, 6);
  });

  it('does not treat an empty corner as an infinite depth', () => {
    const f = makeField([[2, 4, 0], [0, 0, 0]]);
    const mid = sampleGooField(f, 2, 1, 0.5, 0.5);
    expect(mid.discontinuous).toBe(false);
  });
});

describe('silhouetteCoverage — output-pixel footprint', () => {
  it('uses one DENSITY texel when density == output (footprint 1)', () => {
    expect(silhouetteCoverage(0.7, 0.65, 0.1, 1)).toBeCloseTo(1, 6);
    expect(silhouetteCoverage(0.6, 0.65, 0.1, 1)).toBeCloseTo(0, 6);
    expect(silhouetteCoverage(0.65, 0.65, 0.1, 1)).toBeCloseTo(0.5, 6);
  });

  it('narrows the ramp by the density-to-output footprint', () => {
    // densityScale 0.5 => one density texel is TWO output pixels, so the
    // footprint is 0.5 and the feather must halve in density-texel units to
    // stay one output pixel wide.
    const fp = densityTexelsPerOutputPixel(200, 150, 800, 600);
    expect(fp).toBeCloseTo(0.25, 6);
    // A delta that is half an output pixel in density-texel units saturates.
    const grad = 1;
    const halfOutPx = 0.5 * fp * grad;
    expect(silhouetteCoverage(0.65 + halfOutPx, 0.65, grad, fp)).toBeCloseTo(1, 6);
    expect(silhouetteCoverage(0.65 - halfOutPx, 0.65, grad, fp)).toBeCloseTo(0, 6);
    // The un-scaled call would still be mid-ramp at that delta.
    expect(silhouetteCoverage(0.65 + halfOutPx, 0.65, grad, 1)).toBeCloseTo(0.625, 6);
  });

  it('never changes the flat-field degeneracy', () => {
    expect(silhouetteCoverage(0.9, 0.65, 0, 0.25)).toBe(1);
    expect(silhouetteCoverage(0.1, 0.65, 0, 0.25)).toBe(0);
  });
});

describe('silhouetteCoverage (antialiased silhouette)', () => {
  it('is half-covered exactly on the threshold', () => {
    expect(silhouetteCoverage(0.65, 0.65, 0.1)).toBeCloseTo(0.5, 6);
  });

  it('ramps over one gradient-texel: +/- half a gradient saturates', () => {
    expect(silhouetteCoverage(0.65 + 0.05, 0.65, 0.1)).toBeCloseTo(1, 6);
    expect(silhouetteCoverage(0.65 - 0.05, 0.65, 0.1)).toBeCloseTo(0, 6);
  });

  it('is a hard 0/1 on a flat field (no phantom coverage)', () => {
    // A uniform field either wholly clears the threshold or wholly misses;
    // a fractional alpha there would paint a full-frame translucent sheet.
    expect(silhouetteCoverage(0.9, 0.65, 0)).toBe(1);
    expect(silhouetteCoverage(0.1, 0.65, 0)).toBe(0);
  });

  it('is monotonic in density and clamped to [0,1]', () => {
    let prev = -1;
    for (let d = 0; d <= 1.5; d += 0.05) {
      const a = silhouetteCoverage(d, 0.65, 0.2);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
  });
});

describe('gooFieldGradient', () => {
  it('recovers the per-texel slope of a linear ramp', () => {
    // Densities 0, 1, 2, 3 across four texels: the slope is 1 per texel.
    // The raw central difference spans TWO texels (so dx = 2), which is why
    // the WGSL's gradMag applies the 0.5 factor to report per-texel slope.
    const f = makeField([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    const g = gooFieldGradient(f, 4, 1, 0.5, 0.5);
    expect(g.dx).toBeCloseTo(2, 5);
    expect(g.mag).toBeCloseTo(1, 5);
  });

  it('is zero on a flat field', () => {
    const f = makeField([[2, 0, 0], [2, 0, 0]]);
    expect(gooFieldGradient(f, 2, 1, 0.5, 0.5).mag).toBeCloseTo(0, 6);
  });
});

describe('neighborDensityUsable (empty/depth-discontinuous rejection)', () => {
  it('rejects neighbours below a quarter of the threshold', () => {
    expect(GOO_NEIGHBOR_MIN_FRACTION).toBe(0.25);
    expect(neighborDensityUsable(0.65 * 0.25, 0.65)).toBe(true);
    expect(neighborDensityUsable(0.65 * 0.25 - 1e-4, 0.65)).toBe(false);
  });

  it('keeps a thin strand that is above the threshold', () => {
    expect(neighborDensityUsable(0.7, 0.65)).toBe(true);
  });

  it('never accepts a below-empty density', () => {
    expect(neighborDensityUsable(GOO_FIELD_EMPTY_EPS / 2, 0.65)).toBe(false);
  });
});

describe('smooth reconstruction WGSL', () => {
  it('both entry points start with fn (three anchors its parse to ^)', () => {
    expect(/^fn\s+gooSurfaceSmooth\s*\(/.test(GOO_SURFACE_SMOOTH_WGSL)).toBe(true);
    expect(/^fn\s+gooCoverageSmooth\s*\(/.test(GOO_COVERAGE_SMOOTH_WGSL)).toBe(true);
  });

  it('declares nothing reserved', () => {
    for (const wgsl of [GOO_SURFACE_SMOOTH_WGSL, GOO_COVERAGE_SMOOTH_WGSL]) {
      const clashes = declaredNames(wgsl).filter(d => RESERVED_WORDS.includes(d));
      expect(clashes).toEqual([]);
    }
  });

  it('reconstructs the field bilinearly with textureLoad, never textureSample', () => {
    // The density target is NearestFilter by design; only manual bilinear
    // fetches keep the file's integer-load discipline (and its behaviour at
    // the edges). A sampler would silently reintroduce filtering choices.
    for (const wgsl of [GOO_SURFACE_SMOOTH_WGSL, GOO_COVERAGE_SMOOTH_WGSL]) {
      expect(wgsl).toContain('textureLoad');
      expect(wgsl).not.toContain('textureSample');
      expect(wgsl).not.toContain('textureSampleLevel');
      // Five fetches per function: centre plus four neighbours.
      expect((wgsl.match(/textureLoad\(densTex/g) ?? []).length).toBe(20);
    }
  });

  it('derives coverage from the field gradient, scaled by the output footprint', () => {
    // The signed distance is converted from density texels to OUTPUT pixels
    // before the one-pixel ramp, so the density-resolution slider cannot
    // change the feather width.
    const coverage = /cov = clamp\(\(dens - thresh\) \/ gradMag \/ max\(coverageTexels, 1e-6\) \+ 0\.5, 0\.0, 1\.0\);/;
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(coverage);
    expect(GOO_COVERAGE_SMOOTH_WGSL).toMatch(coverage);
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/let gradMag = 0\.5 \* length\(vec2<f32>\(dR, dU\)\);/);
    // Both entry points take the footprint as a parameter.
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/coverageTexels: f32/);
    expect(GOO_COVERAGE_SMOOTH_WGSL).toMatch(/coverageTexels: f32/);
  });

  it('refuses to blend a depth across two separate layers (TS/WGSL matched)', () => {
    // The TS mirror's constants must appear as literals in the shared block.
    expect(GOO_FIELD_DEPTH_REL).toBe(0.25);
    expect(GOO_FIELD_DEPTH_MIN).toBe(0.02);
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('0.250 * max(cLo, 0.020)');
    expect(GOO_COVERAGE_SMOOTH_WGSL).toContain('0.250 * max(cLo, 0.020)');
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let cDiscont = (cHi - cLo) > cDepthTol;');
    // The centre ratios fall back to the densest occupied corner.
    expect(GOO_SURFACE_SMOOTH_WGSL)
      .toMatch(/let cDepth = select\(c\.g \/ max\(c\.r, 1e-4\), cDom\.g \/ max\(cDom\.r, 1e-4\), cDiscont\);/);
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let viewDepth = cDepth;');
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('var gutFrac = cGut;');
    // Occupied-corner bounds ignore empty AND zero-weight corners (a
    // zero-weight corner is not part of this sample).
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/if \(cT0\.r > 1e-4 && cW00 > 1e-6\) \{ cLo = min\(cLo, cD0\);/);
  });

  it('rejects depth-incompatible neighbours in the normal reconstruction', () => {
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/let depthTol = 0\.250 \* max\(dC, 0\.020\);/);
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let rBad = cR.r < minR || abs(dR2 - dC) > depthTol;');
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let lBad = cL.r < minR || abs(dL - dC) > depthTol;');
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let dBad = cD.r < minR || abs(dD - dC) > depthTol;');
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let uBad = cU.r < minR || abs(dU2 - dC) > depthTol;');
    // Both-neighbours-rejected zeroes the difference so the cross product
    // degenerates to the gradient-normal fallback instead of a phantom.
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('if (!ddxOk) { ddx = vec3<f32>(0.0); }');
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('if (!ddyOk) { ddy = vec3<f32>(0.0); }');
  });

  it('discards fully uncovered pixels in BOTH passes, so they cannot disagree', () => {
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('if (cov <= 0.0) { discard; }');
    expect(GOO_COVERAGE_SMOOTH_WGSL).toContain('if (cov <= 0.0) { discard; }');
  });

  it('floors neighbour density before it is used for a reconstructed depth', () => {
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(
      /let minR = max\(thresh \* 0\.25, 1e-4\);/,
    );
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let rBad = cR.r < minR');
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let uBad = cU.r < minR');
  });

  it('keeps the baseline shading family (base colour, absorption, glint, rim)', () => {
    // The candidate must not become a second look: same literals, same
    // spec/gloss/rim aliases, same half-texel-free soft edge.
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('vec3<f32>(0.62, 0.11, 0.10)');
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/exp\(-thick \* vec3<f32>\(0\.30, 2\.40, 2\.00\)\)/);
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/let specStr = gooCfg2\.y;/);
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/let glossPow = gooCfg2\.z;/);
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/let rimStr = gooCfg2\.w;/);
    // Normals keep both paths and the NaN fallback.
    expect(GOO_SURFACE_SMOOTH_WGSL).toContain('let nCam = select(nGrad, nSurf, normalMode > 0.5);');
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/if \(nSurfLen < 1e-8\) \{/);
  });

  it('returns coverage in alpha for the composite, depth in w from the surface', () => {
    expect(GOO_COVERAGE_SMOOTH_WGSL).toMatch(/return vec4<f32>\(0\.0, 0\.0, 0\.0, cov\)/);
    expect(GOO_SURFACE_SMOOTH_WGSL).toMatch(/return vec4<f32>\(lit, depthBuf\)/);
  });
});

describe('smooth reconstruction wiring (source tripwires)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');

  it('defaults to the ORIGINAL path', () => {
    expect(src).toContain("let reconstruction: GooReconstruction = 'original';");
    expect(src).toMatch(/setReconstruction\(m: GooReconstruction\) \{ reconstruction = m; \}/);
  });

  it('keeps the baseline materials and adds a parallel smooth table', () => {
    // The shipped table must still be built exactly as before; the candidate
    // is a second table, never a rewrite of the first.
    expect(src).toMatch(/overlay: \{ raw: makeOverlayMat\(target\.texture\), blur: makeOverlayMat\(blurB\.texture\) \}/);
    expect(src).toMatch(/depth: \{ raw: makeDepthMat\(target\.texture\), blur: makeDepthMat\(blurB\.texture\) \}/);
    expect(src).toMatch(/overlay: \{ raw: makeSmoothOverlayMat\(target\.texture\), blur: makeSmoothOverlayMat\(blurB\.texture\) \}/);
    expect(src).toMatch(/depth: \{ raw: makeSmoothDepthMat\(target\.texture\), blur: makeSmoothDepthMat\(blurB\.texture\) \}/);
  });

  it('the smooth DEPTH material blends coverage but never writes depth', () => {
    // The candidate's atomic depth-compositing change: coverage alpha, depth
    // test on (occlusion respected), depth write off (a fringe must not
    // occlude the scene behind it). Scoped to the candidate table.
    const block = src.slice(src.indexOf('function makeSmoothDepthMat'), src.indexOf('const smoothSurfMats'));
    expect(block).toContain('vec4(shaded.xyz as never, cov.w as never)');
    expect(block).toContain('m.depthNode = shaded.w as never;');
    expect(block).toContain('m.depthTest = true;');
    expect(block).toContain('m.depthWrite = false;');
    expect(block).toContain('m.transparent = true;');
  });

  it('the smooth composite returns after the full-res draw (density-res not combined)', () => {
    expect(src).toContain("if (reconstruction === 'smooth') {");
    expect(src).toContain("const wantSmooth = smoothSurfMats[mode][blurred ? 'blur' : 'raw'];");
    // The baseline composite line must still be present below it.
    expect(src).toContain("const wantMat = surfMats[mode][blurred ? 'blur' : 'raw'];");
  });

  it('the candidate reports why the density-res seam is bypassed', () => {
    expect(src).toContain('smoothForcesFullResComposite: reconstruction === ');
  });

  it('reports source, density and output resolution separately', () => {
    expect(src).toContain('get densityDiagnostics()');
    expect(src).toContain('sourceWidth: lastSdfW,');
    expect(src).toContain('outputWidth: lastOutputW,');
    expect(src).toContain('texelsPerSourcePixelX: lastSdfW > 0 ? target.width / lastSdfW : 0,');
    expect(src).toContain('texelsPerOutputPixelX: lastOutputW > 0 ? target.width / lastOutputW : 0,');
    expect(src).toContain('texelsPerOutputPixelY: lastOutputH > 0 ? target.height / lastOutputH : 0,');
  });

  it('tracks the real composite destination for the coverage footprint', () => {
    expect(src).toContain('lastOutputW = outputTarget ? outputTarget.width : renderer.domElement.width;');
    expect(src).toContain('uCoverageTexels.value = densityTexelsPerOutputPixel(');
  });

  it('extra connection blobs ride the SAME density instancer and cap', () => {
    // Strands and sheets are shaded by the existing wet surface pass because
    // they are density quads, not a second flat material. They are posed
    // after droplets/splats and inside the cap.
    expect(src).toContain('setExtraBlobs(blobs: readonly GooDensityBlob[])');
    expect(src).toContain('const extraBudget = Math.min(extraCount, Math.max(0, particleCap - n));');
    expect(src).toContain('extraHalfW[i] = b.halfW; extraHalfH[i] = b.halfH; extraRoll[i] = b.roll;');
    expect(src).toContain('get extraBlobCount() { return extraCount; }');
  });

  it('defaults to no extras, so the shipped frame is unchanged', () => {
    expect(src).toContain('let extraCount = 0;');
  });
});

describe('connection blob shape', () => {
  it('accepts optional weight/gut and requires finite placement fields', () => {
    const blob: GooDensityBlob = { x: 0, y: 1, z: 2, halfW: 0.1, halfH: 0.1, roll: 0 };
    expect(blob).toBeDefined();
    const weighted: GooDensityBlob = { ...blob, weight: 0.5, gut: 1 };
    expect(weighted.weight).toBe(0.5);
    expect(weighted.gut).toBe(1);
  });
});
