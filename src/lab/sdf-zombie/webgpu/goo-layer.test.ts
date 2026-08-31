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
import { GOO_TUNING, GOO_SURFACE_WGSL, GOO_ALPHA_WGSL, GOO_BLUR_WGSL } from './goo-layer';

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
    expect(src).toContain('if (blurred) {');
    expect(src).toContain("surfMats[mode][blurred ? 'blur' : 'raw']");
    expect(src).toContain('void renderer.render(blurH.scene, quadCam)');
    expect(src).toContain('void renderer.render(blurV.scene, quadCam)');
  });

  it('the surface reads the blurred buffer, and the pair rides the density size', () => {
    expect(src).toContain('makeOverlayMat(blurB.texture)');
    expect(src).toContain('makeDepthMat(blurB.texture)');
    expect(src).toContain('makeBlurMat(blurA.texture, 0, 1)');
    // Same explicit-first-clear treatment as the density target (the
    // lazy-init trap) and the same resize in setSize.
    expect(src).toContain('for (const t of [target, blurA, blurB])');
    expect(src).toContain('blurB.setSize(w, h)');
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
    expect(GOO_TUNING.gloss).toBeLessThanOrEqual(220);
    expect(GOO_TUNING.rim).toBeGreaterThanOrEqual(0);
    expect(GOO_TUNING.rim).toBeLessThanOrEqual(1);
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
    clamp('setGloss', 'uGloss', '8', '220');
    clamp('setRim', 'uRim', '0', '1');
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
