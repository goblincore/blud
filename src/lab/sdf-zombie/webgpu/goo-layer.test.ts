// src/lab/sdf-zombie/webgpu/goo-layer.test.ts
//
// Nothing here compiles a shader — these are the same text guards
// march.wgsl.test.ts applies, extended to the goo surface pass: the wgslFn
// parse contract (source must start with `fn`, three's declarationRegexp is
// ^-anchored) and the reserved-word lint on declarations. Plus value pins
// on the tuning that the mist/goo split depends on.

// NOTE (2026-09-17, game-main decomposition): the receivers pinned below moved
// from main()-scope locals onto the GameContext (`gooLayer` -> `ctx.goo.layer`,
// `gibShutter` -> `ctx.gibs.shutter`, ...). Only the SPELLING changed — every
// pinned number and method name is untouched, so this drift gate still gates
// exactly what it did before. See docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  GOO_TUNING, GOO_SURFACE_WGSL, GOO_ALPHA_WGSL, GOO_BLUR_WGSL,
  GOO_DENSITY_BLUE_IS_GUT_MASK,
} from './goo-layer';
import { gooLayerFixture, gooSim, gooDroplets, type GooLogEntry } from './goo-layer-test-support';
import type { BloodSim, Droplet } from '../blood-sim';
import { createFxSeams } from './game-seams-fx';
import type { GameContext } from './game-context';
import type { GooLayer } from './goo-layer';

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

describe('goo blur wiring (live layer on a stub renderer)', () => {
  // The audit's finding: render() no longer needs a live WebGPURenderer —
  // these run the real layer over the recording stub in
  // goo-layer-test-support.ts and assert what it DID.
  it('bypasses both blur passes entirely at blurPx = 0', () => {
    const f = gooLayerFixture();
    f.render();
    // With the default blurPx > 0 the chain is density -> blurH -> blurV ->
    // composite: two intermediate targets between the density target and
    // the canvas, and the composite draws the BLURRED material.
    const drawn = f.log.drawnTargets();
    expect(drawn).toHaveLength(4);
    expect(drawn[0]).toBe(f.layer.debugTargets.density);
    expect(drawn[1]).not.toBe(drawn[0]);
    expect(drawn[2]).toBe(f.layer.debugTargets.blurred);
    expect(drawn[3]).toBeNull();
    const blurredMat = f.log.draws().at(-1)!.material;

    f.log.reset();
    f.layer.setBlurPx(0);
    f.render();
    // blurPx = 0: not even a degenerate copy pass — the only draws left are
    // the density pass and the composite, and the composite switched to the
    // RAW material (a texture binding is baked into the node graph, so
    // raw-vs-blurred is a different material object).
    expect(f.log.drawnTargets()).toEqual([f.layer.debugTargets.density, null]);
    const rawMat = f.log.draws().at(-1)!.material;
    expect(rawMat).not.toBe(blurredMat);

    // Restoring the blur restores the blurred material: the pick is made
    // per frame, not latched.
    f.log.reset();
    f.layer.setBlurPx(GOO_TUNING.blurPx);
    f.render();
    expect(f.log.draws().at(-1)!.material).toBe(blurredMat);
    f.dispose();
  });

  it('the blur pair and the low-res surface target ride the density size, with a lazy first clear', () => {
    const f = gooLayerFixture();
    f.layer.setSize(400, 300);
    f.render();
    const { density, blurred } = f.layer.debugTargets;
    // densityScale 0.5: the density target and the blur pair live at half
    // the SDF grid — one blur texel per density texel.
    expect(density.width).toBe(200);
    expect(density.height).toBe(150);
    expect(blurred.width).toBe(200);
    expect(blurred.height).toBe(150);
    // First render: every (re)allocated target gets an explicit first clear
    // — four distinct targets probed with the empty scene (density, blurA,
    // blurB and the low-res surface target). A lazily-initialised texture
    // inside the same encoder as the pass that samples it gets the whole
    // WebGPU submit rejected, so this clear is load-bearing.
    const firstInit = f.log.initClears();
    expect(firstInit).toHaveLength(4);
    expect(new Set(firstInit.map((r) => r.target)).size).toBe(4);
    expect(firstInit.map((r) => r.target)).toContain(density);
    expect(firstInit.map((r) => r.target)).toContain(blurred);
    // Steady state: nothing re-clears...
    f.log.reset();
    f.render();
    expect(f.log.initClears()).toHaveLength(0);
    // ...and a resize re-arms the first clear (setSize reallocates the
    // backing texture, so the lazy-init conflict would come back).
    f.layer.setSize(800, 600);
    f.log.reset();
    f.render();
    expect(f.log.initClears()).toHaveLength(4);
    expect(density.width).toBe(400);
    expect(blurred.width).toBe(400);
    expect(blurred.height).toBe(300);
    f.dispose();
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
  // its ceiling checked against the range the shader actually produces —
  // read back through the layer's own getters on a live layer.
  it('clamps all shading setters to the range the shader actually produces', () => {
    const f = gooLayerFixture();
    // absorb and gloss per the 2D prototype range; spec and rim previously
    // unpinned entirely. Both ends of every range, via the getters the
    // console's goo readout uses.
    f.layer.setAbsorb(-1); expect(f.layer.absorb).toBe(0);
    f.layer.setAbsorb(99); expect(f.layer.absorb).toBe(3);
    f.layer.setSpec(-1); expect(f.layer.spec).toBe(0);
    f.layer.setSpec(99); expect(f.layer.spec).toBe(4);
    // CEILING 220 -> 400, FLOOR 8 (2026-08-31): the owner's own tuning pass
    // landed on gloss EXACTLY 220 — the old ceiling — which is the signature
    // of a clamp capping intent rather than guarding a range. Below ~8 the
    // lobe is wider than the blob and the whole surface reads flat white.
    f.layer.setGloss(1); expect(f.layer.gloss).toBe(8);
    f.layer.setGloss(1e9); expect(f.layer.gloss).toBe(400);
    f.layer.setRim(-1); expect(f.layer.rim).toBe(0);
    f.layer.setRim(9); expect(f.layer.rim).toBe(1);
    // shadowRed: the deep-red floor that stops absorption or a grazing
    // light from driving blood to black. Ceiling 0.6 — past that the floor
    // swamps the thickness gradient it exists to preserve.
    f.layer.setShadowRed(-1); expect(f.layer.shadowRed).toBe(0);
    f.layer.setShadowRed(9); expect(f.layer.shadowRed).toBe(0.6);
    f.dispose();
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

describe('goo overlay mode wiring (live layer on a stub renderer)', () => {
  it('overlay materials neither test nor write depth, are transparent, and bind no depthNode', () => {
    const f = gooLayerFixture();
    // Default mode is overlay: the composite draws over the finished frame
    // with no depth involvement. This DELETES the depth blocker rather than
    // fixing it, so the flags below are the mode's whole contract — read
    // off the material the composite actually drew with.
    f.render();
    const composite = f.log.draws().filter((r) => r.target === null).at(-1)!;
    const m = composite.material!;
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(false);
    expect(m.transparent).toBe(true);
    // Binding depthNode in overlay mode would silently reinstate the
    // reconstruction this mode exists to delete. (Unset node slots read
    // back as null, not undefined.)
    expect(m.depthNode).toBeNull();

    // Contrast: the escape hatch restores depth interleaving — the composite
    // material under setMode('depth') tests AND writes depth through a
    // depthNode, so the flags above cannot pass vacuously.
    f.layer.setMode('depth');
    f.log.reset();
    f.render();
    const depthM = f.log.draws().filter((r) => r.target === null).at(-1)!.material!;
    expect(depthM).not.toBe(m);
    expect(depthM.depthTest).toBe(true);
    expect(depthM.depthWrite).toBe(true);
    expect(depthM.depthNode).toBeDefined();
    f.dispose();
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
  // The first two tests are source tripwires on the tick order (KEEP per the
  // audit: tick() has no unit seam); the third runs the layer live.
  it('the game page syncs AFTER the camera is final, so the quads billboard correctly', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/game-tick.ts', 'utf8');
    const cam = src.indexOf('ctx.boot.handle.camera.updateMatrixWorld();');
    const sync = src.indexOf('ctx.goo.layer?.sync(ctx.vfx.bloodSim, ctx.boot.handle.camera)');
    expect(cam, 'camera.updateMatrixWorld() must be present').toBeGreaterThan(-1);
    expect(sync, 'the goo sync must be present').toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(cam);
  });

  it('the lab still syncs too — this contract belongs to both pages', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/lab-main.ts', 'utf8');
    expect(src).toMatch(/gooLayer\.sync\(bloodSim, camera\)/);
  });

  it('the selection seam partitions droplets in BOTH sync fill paths', () => {
    // Shutter integration: the sharp/selected split is only exact if every
    // droplet fill path filters. One unfiltered loop would draw the selected
    // blood twice (once sharp, once blurred). liveCount is the layer's own
    // diagnostic mirror of the instancer's count, so both insertion-order
    // and area-priority paths are checked through the public API.
    const f = gooLayerFixture();
    const sim = gooSim(6, (i) => ({ kind: i % 3 === 0 ? 'mist' : (i % 3 === 1 ? 'drop' : 'gut') }), 2);
    f.layer.setSelection({ droplet: (d) => d.kind === 'gut', splats: false, extras: false });
    f.layer.sync(sim, f.camera);
    expect(f.layer.liveCount).toBe(2); // only the gut droplets, no splats
    f.layer.setAreaPriority(true);
    f.layer.sync(sim, f.camera);
    expect(f.layer.liveCount).toBe(2); // the area-priority path filters too
    // Null selection restores the shipped one-pass pose: drops + guts ride
    // the field, mist never does, and the splats come back.
    f.layer.setSelection(null);
    f.layer.sync(sim, f.camera);
    expect(f.layer.liveCount).toBe(6); // 2 drops + 2 guts + 2 splats
    f.dispose();
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
// CLOSE-UP TASK 4 — goo perf levers. Pure decision code is tested directly
// above; the render-path seams run live on the recording stub, asserting
// their OFF defaults and the invariants that keep the shipped path intact.
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

describe('goo perf seams (live layer on a stub renderer)', () => {
  /** First render entry at/after `idx` (narrows the union for the trace
   *  tests below). */
  const renderAfter = (entries: GooLogEntry[], idx: number) =>
    entries.slice(idx + 1).find((e): e is Extract<GooLogEntry, { kind: 'render' }> => e.kind === 'render');
  const clearAfter = (entries: GooLogEntry[], idx: number) =>
    entries.slice(idx + 1).find((e): e is Extract<GooLogEntry, { kind: 'clear' }> => e.kind === 'clear');
  const canvasMat = (f: ReturnType<typeof gooLayerFixture>) =>
    f.log.draws().filter((r) => r.target === null).at(-1)!.material!;

  it('every lever defaults to the shipped state', () => {
    const f = gooLayerFixture();
    expect(f.layer.surfaceAtDensityRes).toBe(false);
    expect(f.layer.minTexelRadius).toBe(0);
    expect(f.layer.areaPriority).toBe(false);
    expect(f.layer.splatFadeTail).toBe(0);
    expect(f.layer.passGate).toEqual({ density: true, blur: true, surface: true });
    f.dispose();
  });

  it('the low DEPTH variant packs depth into the colour alpha, never depthNode', () => {
    // The shading pass must not depth-test (its own buffer is empty); the
    // hardware depth test happens in the upsample against the scene, per
    // output pixel, from the value packed into .a.
    const f = gooLayerFixture();
    f.layer.setSurfaceAtDensityRes(true);
    f.layer.setMode('depth');
    f.render();
    // The low pass is the draw made while the black-with-alpha-0 clear is
    // active — see the next test for that clear's own contract.
    const entries = f.log.entries;
    const lowClear = entries.findIndex((e) => e.kind === 'clear' && e.color === 0 && e.alpha === 0);
    expect(lowClear).toBeGreaterThan(-1);
    const lowMat = renderAfter(entries, lowClear)!.material!;
    expect(lowMat.depthWrite).toBe(false);
    expect(lowMat.depthTest).toBe(false);
    expect(lowMat.depthNode).toBeNull();
    // The upsample that follows is where the interleaving contract lives:
    // it binds a depthNode and writes/tests depth — so the low pass's flags
    // above cannot pass vacuously.
    const upMat = canvasMat(f);
    expect(upMat).not.toBe(lowMat);
    expect(upMat.depthNode).not.toBeNull();
    expect(upMat.depthWrite).toBe(true);
    expect(upMat.depthTest).toBe(true);
    f.dispose();
  });

  it('the low pass clears black with ALPHA 0 — the upsample empty sentinel', () => {
    // A cleared alpha of 1 would be a depth of 1 (or an opaque, gut-masked
    // sludge) in every unshaded texel; the restored scene clear is the
    // background with alpha 1, so the low pass owns its clear explicitly.
    const f = gooLayerFixture();
    f.layer.setSurfaceAtDensityRes(true);
    f.render();
    const entries = f.log.entries;
    const lowClear = entries.findIndex((e) => e.kind === 'clear' && e.color === 0 && e.alpha === 0);
    expect(lowClear).toBeGreaterThan(-1);
    const lowRender = entries.findIndex((e, i) => i > lowClear && e.kind === 'render');
    // Restore: the renderer's previous colour AND alpha — 0x1a1116/1 is the
    // stub's scene-background default, read back through getClearColor and
    // getClearAlpha, not a value this test handed the layer.
    expect(clearAfter(entries, lowRender)).toMatchObject({ kind: 'clear', color: 0x1a1116, alpha: 1 });
    f.dispose();
  });

  it('passGate only skips work; it never changes what the kept passes read', () => {
    const f = gooLayerFixture();
    f.render();
    const blurredMat = canvasMat(f);
    // Gating the blur OFF (blurPx still > 0): no renders to the blur pair —
    // the only draws are the density pass and the composite — but the
    // surface still draws the SAME blurred material, so a gated surface leg
    // times the same shader, not a cheaper raw-buffer one.
    f.log.reset();
    f.layer.setPassGate({ blur: false });
    f.render();
    expect(f.log.drawnTargets()).toEqual([f.layer.debugTargets.density, null]);
    expect(canvasMat(f)).toBe(blurredMat);
    // What DOES switch the surface to the raw buffer is blurPx = 0 — the
    // gate never changes what the kept passes read.
    f.log.reset();
    f.layer.setBlurPx(0);
    f.render();
    expect(canvasMat(f)).not.toBe(blurredMat);
    // Gating the surface off: between() still runs (the host frame is
    // intact) and nothing composites to the canvas after it.
    f.log.reset();
    let betweenRan = 0;
    f.layer.setPassGate({ surface: false });
    f.render(() => { betweenRan++; f.log.mark('between'); });
    expect(betweenRan).toBe(1);
    const markIdx = f.log.entries.findIndex((e) => e.kind === 'mark');
    expect(f.log.entries.slice(markIdx).some((e) => e.kind === 'render' && e.target === null)).toBe(false);
    f.dispose();
  });

  it('the minTexel skip is inert at 0 without touching the mist gates', () => {
    const f = gooLayerFixture();
    f.layer.setSize(400, 300);
    f.layer.setMinTexelRadius(0);
    const sim = gooSim(5, (i): Partial<Droplet> => ({
      kind: i === 1 ? 'mist' : 'drop',
      ...(i === 4 ? { size: 0.01 } : {}), // under mistMaxSize: billboard mist
    }));
    for (const area of [false, true]) {
      f.layer.setAreaPriority(area);
      f.layer.sync(sim, f.camera);
      // Both fill paths keep the mist and size gates ahead of any skip: of
      // the five droplets only 0, 2 and 3 pose.
      expect(f.layer.liveCount).toBe(3);
    }
    // The lever is live when on: a droplet 300 m away projects under one
    // density texel and is skipped as pure overdraw; the near one stays.
    f.layer.setMinTexelRadius(1);
    f.layer.sync({
      droplets: [
        ...gooDroplets(1),
        ...gooDroplets(1, (): Partial<Droplet> => ({ pos: [0, 1, -300] })),
      ],
      splats: [],
    } as unknown as BloodSim, f.camera);
    expect(f.layer.liveCount).toBe(1);
    f.dispose();
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

describe('goo perf page seam (createFxSeams over a recording layer)', () => {
  // The whole goo seam group moved out of the __sdfGame literal in the
  // 2026-09-17 decomposition: `setGooPerf` into game-seams-spawn-goo.ts, and
  // the `goo` getter plus setGooTuning/setGooCandidate into game-seams-fx.ts.
  it('keeps the perf seams OUT of setGooTuning', () => {
    // The goo panel's copy button emits setGooTuning keys; a perf lever in
    // that schema would let a tuning paste silently move a bench seam. Run
    // the real setGooTuning against a layer that records every method call.
    const calls: string[] = [];
    const layer = new Proxy({} as Record<string, unknown>, {
      get(_, key) { return () => { calls.push(String(key)); }; },
    }) as unknown as GooLayer;
    const ctx = {
      boot: { handle: { scene: {}, camera: {} } },
      goo: { layer },
    } as unknown as GameContext;
    createFxSeams(ctx).setGooTuning({
      gloss: 120,
      // Perf-lever keys the schema must not know about: if any of these
      // ever routed to a setter, a pasted tuning would silently flip a
      // bench seam.
      surfaceAtDensityRes: true,
      minTexelRadius: 4,
      areaPriority: true,
      passGate: { density: false },
    } as never);
    // The look knob lands (the recording works) and nothing else moves.
    expect(calls).toEqual(['setGloss']);
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

import {
  GOO_STREAM_COMBINE_WGSL, GOO_STREAM_CHANNELS, GOO_STREAM_DEDICATED,
  GOO_STREAM_SHARED_CHANNEL, streamChannelFor, streamFusionRamp,
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

  it('tracks the real composite destination for the coverage footprint', () => {
    expect(src).toContain('lastOutputW = outputTarget ? outputTarget.width : renderer.domElement.width;');
    expect(src).toContain('uCoverageTexels.value = densityTexelsPerOutputPixel(');
  });

  it('extra connection blobs ride the SAME density instancer and cap', () => {
    // Strands and sheets are shaded by the existing wet surface pass because
    // they are density quads, not a second flat material. They are posed
    // after droplets/splats and inside the cap.
    expect(src).toContain('setExtraBlobs(blobs: readonly GooDensityBlob[])');
    // The cap now also honours the shutter selection (extras belong to the
    // selected/blurred half), so the expression gained a gate.
    expect(src).toContain('const extraBudget = selection !== null && !selection.extras');
    expect(src).toContain('Math.min(extraCount, Math.max(0, particleCap - n));');
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

// -------------------------------------------------------------------------
// PER-STREAM FUSION (blood-per-stream spike, 2026-09-18). The mechanism is
// pure decision code (channel assignment + fuse ramp) plus one WGSL combine
// pass; the render path itself needs a WebGPU device and is pinned as source
// tripwires, the same discipline the rest of this file uses.
// -------------------------------------------------------------------------

describe('streamChannelFor (per-stream partition)', () => {
  it('gives the first streams dedicated channels and shares the rest', () => {
    const a = new Map<number, number>();
    expect(streamChannelFor(1, a)).toBe(0);
    expect(streamChannelFor(2, a)).toBe(1);
    // Only GOO_STREAM_DEDICATED channels exist; the third stream and beyond
    // fall back to the shared channel rather than growing the field.
    expect(streamChannelFor(3, a)).toBe(GOO_STREAM_SHARED_CHANNEL);
    expect(streamChannelFor(99, a)).toBe(GOO_STREAM_SHARED_CHANNEL);
  });

  it('is stable within a frame: one stream always maps to one channel', () => {
    const a = new Map<number, number>();
    const first = streamChannelFor(7, a);
    expect(streamChannelFor(7, a)).toBe(first);
    expect(streamChannelFor(7, a)).toBe(first);
  });

  it('sends untagged droplets to the shared channel (never guesses a source)', () => {
    const a = new Map<number, number>();
    expect(streamChannelFor(undefined, a)).toBe(GOO_STREAM_SHARED_CHANNEL);
    expect(a.size).toBe(0);
  });

  it('reuses a cleared map, so a fresh frame re-assigns the same first stream', () => {
    const a = new Map<number, number>();
    streamChannelFor(4, a);
    a.clear();
    expect(streamChannelFor(4, a)).toBe(0);
  });
});

describe('streamFusionRamp (launch pulse tame)', () => {
  it('ramp 0 is off and returns exactly 1', () => {
    expect(streamFusionRamp(0, 0)).toBe(1);
    expect(streamFusionRamp(0.5, 0)).toBe(1);
    expect(streamFusionRamp(5, -1)).toBe(1);
  });

  it('starts at minFactor and reaches 1 at rampSec, monotonically', () => {
    expect(streamFusionRamp(0, 0.5)).toBeCloseTo(0.35, 6);
    expect(streamFusionRamp(0.5, 0.5)).toBe(1);
    expect(streamFusionRamp(9, 0.5)).toBe(1);
    let prev = -1;
    for (let age = 0; age <= 0.5; age += 0.02) {
      const w = streamFusionRamp(age, 0.5);
      expect(w).toBeGreaterThanOrEqual(prev);
      expect(w).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
  });
});

describe('per-stream combine: the behavioural requirement, at the maths level', () => {
  it('two sub-threshold sprays cannot invent a shared goo pixel (max, not sum)', () => {
    const thresh = 0.65;
    const a = 0.5, b = 0.5; // neither stream alone clears the threshold
    // Stream-blind additive: a + b = 1.0 fuses them into one shape.
    expect(silhouetteCoverage(a + b, thresh, 0.1, 1)).toBe(1);
    // Per-stream: the dominant single stream is still 0.5 — no goo.
    expect(silhouetteCoverage(Math.max(a, b), thresh, 0.1, 1)).toBe(0);
  });

  it('one stream above threshold still reads as connected goo', () => {
    expect(silhouetteCoverage(Math.max(0.9, 0.1), 0.65, 0.1, 1)).toBe(1);
  });
});

describe('goo combine WGSL', () => {
  it('starts with fn (three anchors its parse to ^)', () => {
    expect(/^fn\s+gooStreamCombine\s*\(/.test(GOO_STREAM_COMBINE_WGSL)).toBe(true);
  });

  it('declares nothing reserved', () => {
    const clashes = declaredNames(GOO_STREAM_COMBINE_WGSL).filter(d => RESERVED_WORDS.includes(d));
    expect(clashes).toEqual([]);
  });

  it('takes the strongest SINGLE channel, never their sum', () => {
    // Three packed channels (GOO_STREAM_CHANNELS); the shared one is BLUE, so
    // the alpha channel is never read.
    expect(GOO_STREAM_CHANNELS).toBe(3);
    expect(GOO_STREAM_DEDICATED).toBe(2);
    expect(GOO_STREAM_SHARED_CHANNEL).toBe(2);
    expect(GOO_STREAM_COMBINE_WGSL).toMatch(/let dens = max\(max\(s\.r, s\.g\), s\.b\);/);
    expect(GOO_STREAM_COMBINE_WGSL).not.toMatch(/s\.a/);
  });

  it('keeps the canonical layout so the surface pass needs no fork', () => {
    // r = density, g = density*viewDepth, b = density*gut.
    expect(GOO_STREAM_COMBINE_WGSL).toContain('c.g / max(c.r, 1e-4)');
    expect(GOO_STREAM_COMBINE_WGSL).toContain('c.b / max(c.r, 1e-4)');
    expect(GOO_STREAM_COMBINE_WGSL).toMatch(/return vec4<f32>\(dens, dens \* depth, dens \* gutFrac, 0\.0\);/);
  });

  it('pre-flips its single-pass sampling so the goo is not upside down', () => {
    // The canonical blur is two passes (flip twice = none); this combine is
    // one, so it must read flipped to land the output in the blur's
    // orientation. Without this the whole goo mass renders vertically mirrored
    // (captured and measured on the crossing/landing frames).
    expect(GOO_STREAM_COMBINE_WGSL).toMatch(/flipY: f32/);
    expect(GOO_STREAM_COMBINE_WGSL).toContain('if (flipY > 0.5) { st.y = 1.0 - st.y; }');
    expect(GOO_STREAM_COMBINE_WGSL).toContain('floor(st * dims)');
  });
});

describe('per-stream wiring (source tripwires)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');

  it('defaults OFF, so the shipped stream-blind frame is byte-identical', () => {
    expect(src).toContain('let perStreamOn = false;');
    expect(src).toContain('let streamRampSec = 0;');
  });

  it('exposes the raw-channel diagnostic, default off', () => {
    // Used to PROVE the partition in a capture (R/G streams, yellow overlap).
    expect(GOO_STREAM_COMBINE_WGSL).toContain('if (debug > 0.5) { return vec4<f32>(s.r, s.g, s.b, 1.0); }');
    expect(GOO_STREAM_COMBINE_WGSL).toMatch(/debug: f32/);
  });

  it('routes each instance into its stream channel and uploads the mask only while on', () => {
    expect(src).toContain("const streamMask = attribute<'vec4'>('streamMask', 'vec4');");
    expect(src).toContain("quads.geometry.setAttribute('streamMask', streamAttr);");
    expect(src).toContain('if (perStreamOn) writeStreamMask(');
    expect(src).toContain('if (perStreamOn && n > 0) {');
    expect(src).toContain('streamAttr.addUpdateRange(0, n * 4);');
    // The channel map is rebuilt every sync (channels are per-frame scratch).
    expect(src).toContain('streamChannelMap.clear();');
  });

  it('runs the extra density/blur/combine passes only under the switch', () => {
    expect(src).toContain('if (perStreamOn) {');
    expect(src).toContain("setPassLabel('goo:stream-density');");
    expect(src).toContain("setPassLabel('goo:stream-blur');");
    expect(src).toContain("setPassLabel('goo:stream-combine');");
    // The combine writes a field the surface reads; it uses the blurred pair
    // when the canonical blur ran and the raw pair when it did not.
    expect(src).toContain('const combineBlurMat = makeCombineMat(blurB.texture, streamBlurB.texture);');
    expect(src).toContain('const combineRawMat = makeCombineMat(target.texture, streamTarget.texture);');
    // The combine's orientation uniform is explicit and separable from uFlipY.
    expect(src).toContain('const uStreamFlipY = uniform(1);');
    expect(src).toContain('flipY: uStreamFlipY,');
  });

  it('the lazy first clear covers every new target (the submit-rejection trap)', () => {
    expect(src).toContain('for (const t of [streamTarget, streamBlurA, streamBlurB, perStreamField])');
    expect(src).toContain('streamTargetsNeedInit = true;');
  });
});
