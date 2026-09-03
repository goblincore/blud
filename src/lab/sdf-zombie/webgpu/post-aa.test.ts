// src/lab/sdf-zombie/webgpu/post-aa.test.ts
//
// X1.25 post chain. Nothing here compiles a shader — the WGSL tests are the
// same text guards goo-layer.test.ts applies (the wgslFn ^-anchored parse
// contract, the reserved-word lint, and kernel tripwires), plus value pins
// on the owner-approved defaults. The one BEHAVIOURAL test is the all-off
// parity path: render() with every effect off must be an exact pass-through
// — the same code path the pre-post-aa draw took — which a stub renderer
// can prove (no redirect, no extra passes, the chain called exactly once).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  POST_AA_DEFAULTS, POST_AA_SMEAR_MAX,
  POST_AA_FXAA_WGSL, POST_AA_BLEND_WGSL, POST_AA_BLIT_WGSL,
  createPostAa,
} from './post-aa';

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

/** Declared names (let/var plus params) in a WGSL string. */
function declaredNames(wgsl: string): string[] {
  return [
    ...wgsl.matchAll(/\b(?:let|var)\s+([a-z_][a-z_0-9]*)/gi),
    ...wgsl.matchAll(/[(,]\s*([a-z_][a-z_0-9]*)\s*:/gi),
  ].map(m => m[1]!);
}

const ALL_WGSL = {
  fxaa: POST_AA_FXAA_WGSL,
  blend: POST_AA_BLEND_WGSL,
  blit: POST_AA_BLIT_WGSL,
} as const;

describe('post-aa WGSL parse contract', () => {
  it('every pass starts with its main fn (three anchors the parse to ^)', () => {
    expect(/^fn\s+postAaFxaa\s*\(/.test(POST_AA_FXAA_WGSL)).toBe(true);
    expect(/^fn\s+postAaBlend\s*\(/.test(POST_AA_BLEND_WGSL)).toBe(true);
    expect(/^fn\s+postAaBlit\s*\(/.test(POST_AA_BLIT_WGSL)).toBe(true);
  });

  it('declares nothing reserved', () => {
    for (const wgsl of Object.values(ALL_WGSL)) {
      const clashes = declaredNames(wgsl).filter(d => RESERVED_WORDS.includes(d));
      expect(clashes).toEqual([]);
    }
  });
});

describe('post-aa FXAA kernel tripwires', () => {
  it('is the Lottes reduced kernel: 3x3 luma cross, span clamp, range guard', () => {
    // Rec 601 luma — the weights the classic kernel's tuning assumes.
    expect(POST_AA_FXAA_WGSL).toContain('0.299, 0.587, 0.114');
    // dirReduce: 1/32 of the cross sum, floored at 1/128.
    expect(POST_AA_FXAA_WGSL).toContain('* 0.03125, 0.0078125');
    // SPAN_MAX 8 texels.
    expect(POST_AA_FXAA_WGSL).toContain('vec2<f32>(-8.0, -8.0)');
    // The false-edge guard: rgbB outside the neighbourhood luma range falls
    // back to rgbA.
    expect(POST_AA_FXAA_WGSL).toContain('lumaB < lumaMin || lumaB > lumaMax');
    // Integer fetches only — no sampler state to go stale on.
    expect(POST_AA_FXAA_WGSL).toContain('textureLoad');
  });

  it('blends in DISPLAY space: every tap goes through the OETF first', () => {
    // The fetch helper encodes; there is no raw-fetch path in the FXAA pass.
    expect(POST_AA_FXAA_WGSL).toContain('fn postAaFetch');
    expect(POST_AA_FXAA_WGSL).toMatch(/fn postAaFetch[\s\S]*postAaOetf\(textureLoad/);
  });
});

describe('post-aa colour chain (the hard constraint)', () => {
  // Rendering into a RenderTarget applies NO output transform in three r185
  // (Renderer.currentColorSpace is the working space off-canvas), so the
  // capture holds pre-encode values. The post chain must mirror the canvas
  // with three's OWN transfer constants — anything else adds or drops an
  // encode. Pinned against nodes/display/ColorSpaceFunctions.js.
  it('mirrors three sRGBTransferOETF exactly', () => {
    for (const wgsl of Object.values(ALL_WGSL)) {
      expect(wgsl).toContain('0.41666');
      expect(wgsl).toContain('* 1.055');
      expect(wgsl).toContain('* 12.92');
      expect(wgsl).toContain('0.0031308');
    }
  });

  it('the blit decodes with three sRGBTransferEOTF constants', () => {
    expect(POST_AA_BLIT_WGSL).toContain('0.9478672986');
    expect(POST_AA_BLIT_WGSL).toContain('0.0521327014');
    expect(POST_AA_BLIT_WGSL).toContain('0.0773993808');
    expect(POST_AA_BLIT_WGSL).toContain('0.04045');
    // …and ALWAYS on the way out, so the canvas OETF cancels it.
    expect(POST_AA_BLIT_WGSL).toMatch(/return vec4<f32>\(postAaEotf\(c\), 1\.0\)/);
  });
});

describe('post-aa smear + sharp-upscale tripwires', () => {
  it('smear is mix(current, history, smear) over display-space taps', () => {
    expect(POST_AA_BLEND_WGSL).toContain('mix(cur, hist, cfg.x)');
    // cfg.y gates the entry encode — the blend is the entry pass when FXAA
    // is off, and must not double-encode the FXAA output when it is on.
    expect(POST_AA_BLEND_WGSL).toContain('if (cfg.y < 0.5) { cur = postAaOetf(cur); }');
  });

  it('sharp mode re-ramps the fractional part by the magnification ratio', () => {
    // The snapped-bilinear core: interpolation only in a one-dst-pixel band
    // at texel borders.
    expect(POST_AA_BLIT_WGSL).toContain('let ratio = dstSize / srcDims;');
    expect(POST_AA_BLIT_WGSL).toMatch(/\(fr - vec2<f32>\(0\.5, 0\.5\)\) \* ratio/);
  });

  it('orientation invariant: intermediate passes flip entry sampling, the blit flips the canvas boundary', () => {
    // Measured (X1.25b): every target-bound quad pass inverts Y once, so
    // the FXAA/blend passes flip their sampling to keep every target in
    // the capture's orientation, and the blit's uniform flip handles the
    // one canvas boundary for ANY number of active passes. An odd-count
    // regression here is what the first run mistook for a colour shift.
    expect(POST_AA_BLIT_WGSL).toContain('st.y = 1.0 - st.y;');
    expect(POST_AA_FXAA_WGSL).toContain('1.0 - texCoord.y');
    expect(POST_AA_BLEND_WGSL).toContain('1.0 - texCoord.y');
  });
});

describe('post-aa defaults (owner brief)', () => {
  it('FXAA on, smear 0.25, sharp upscale off', () => {
    expect(POST_AA_DEFAULTS.fxaa).toBe(true);
    expect(POST_AA_DEFAULTS.smear).toBe(0.25);
    expect(POST_AA_DEFAULTS.sharpUpscale).toBe(false);
  });

  it('the smear slider spans 0 to the documented ghosting ceiling', () => {
    expect(POST_AA_SMEAR_MAX).toBe(0.6);
    expect(POST_AA_DEFAULTS.smear).toBeGreaterThan(0);
    expect(POST_AA_DEFAULTS.smear).toBeLessThan(POST_AA_SMEAR_MAX);
  });
});

describe('post-aa module wiring', () => {
  // Cwd-relative (vitest runs from the repo root) — the same discipline the
  // goo-layer source tripwires apply.
  const src = readFileSync('src/lab/sdf-zombie/webgpu/post-aa.ts', 'utf8');

  it('history is a ping-pong pair, never sampled where written', () => {
    expect(src).toContain('blendHistTex.value = histRead.texture');
    expect(src).toContain('renderer.setRenderTarget(histWrite)');
  });

  it('every target gets the explicit first clear after (re)allocation', () => {
    expect(src).toContain('for (const t of [sceneTarget, fxaaTarget, histA, histB])');
    expect(src).toContain('targetsNeedInit = true;');
  });

  it('a sink added AFTER the redirect is handed the current target', () => {
    // The redirect loop only fires on the transition, so a late sink would
    // keep drawing to the canvas and be blitted over every frame. That is
    // what hid the goo layer entirely on the game page: game-main awaits the
    // gun GLB between registering sdfLayer and registering gooLayer, so the
    // redirect had already happened by the time the goo arrived.
    expect(src).toMatch(/addSink\(s\) \{[\s\S]*?if \(redirected\) s\.setOutputTarget\(sceneTarget\);[\s\S]*?\}/);
  });

  it('the scene capture target carries a depth buffer', () => {
    // The sdf composite and goo surface depth-test against what the
    // polygonal pass left — without depth the flesh paints over the floor.
    expect(src).toMatch(/const sceneTarget = new THREE\.RenderTarget\(1, 1, \{\s*depthBuffer: true/);
  });
});

/** A renderer stand-in: the all-off path must not touch it at all. */
function stubRenderer() {
  const calls = { setRenderTarget: 0, render: 0, setSize: 0 };
  const renderer = {
    domElement: { style: {} as Record<string, string> },
    autoClear: true,
    setSize() { calls.setSize++; },
    setRenderTarget() { calls.setRenderTarget++; },
    render() { calls.render++; },
    getDrawingBufferSize(v: THREE.Vector2) { return v.set(960, 540); },
  } as unknown as THREE.WebGPURenderer;
  return { renderer, calls };
}

describe('post-aa all-off parity (the hard gate)', () => {
  it('is an exact pass-through: chain called once, renderer untouched', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    calls.setRenderTarget = 0; // ignore refit/init bookkeeping
    calls.render = 0;

    post.setFxaa(false);
    post.setSmear(0);
    // sharpUpscale defaults off — all three effects off.

    let chainCalls = 0;
    const sink = { target: 'unset' as unknown as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });
    post.render(() => { chainCalls++; });

    expect(chainCalls).toBe(1);
    expect(calls.setRenderTarget).toBe(0);
    expect(calls.render).toBe(0);
    // …and the sink was never redirected away from the canvas.
    expect(sink.target).toBe('unset');
  });

  it('an active effect redirects the sinks and runs the passes', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });

    let chainCalls = 0;
    // FXAA defaults on — the DEFAULT path is the redirected one.
    post.render(() => { chainCalls++; });

    expect(chainCalls).toBe(1);
    expect(sink.target).not.toBeNull();
    expect(calls.render).toBeGreaterThan(0);
  });

  it('setSmear clamps to the slider range', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setSmear(99);
    expect(post.smear).toBe(POST_AA_SMEAR_MAX);
    post.setSmear(-1);
    expect(post.smear).toBe(0);
  });
});

describe('post-aa fisheye in the blit', () => {
  it('the blit takes a lens parameter', () => {
    expect(POST_AA_BLIT_WGSL).toMatch(/lens\s*:\s*vec3<f32>/);
  });

  it('carries the fisheye helper, and still starts with its own main fn', () => {
    // three anchors the wgslFn parse to ^, so the helper must be APPENDED.
    expect(/^fn\s+postAaBlit\s*\(/.test(POST_AA_BLIT_WGSL)).toBe(true);
    expect(POST_AA_BLIT_WGSL).toContain('fn fisheyeWarp(');
    expect(POST_AA_BLIT_WGSL.indexOf('fn fisheyeWarp('))
      .toBeGreaterThan(POST_AA_BLIT_WGSL.indexOf('fn postAaBlit('));
  });

  it('supersedes sharp mode rather than stacking with it', () => {
    // The warped branch is taken FIRST; sharp's fractional ramp assumes an
    // axis-aligned magnification the warp does not provide.
    const warpAt = POST_AA_BLIT_WGSL.indexOf('if (lens.x > 0.0)');
    const sharpAt = POST_AA_BLIT_WGSL.indexOf('} else if (cfg.z > 0.5)');
    expect(warpAt).toBeGreaterThan(-1);
    expect(sharpAt).toBeGreaterThan(warpAt);
  });

  it('prefilters the warped fetch with four taps', () => {
    // Pinning the corner minifies the periphery ~2x; a single point fetch
    // there shimmers. Four rotated-grid taps, warped independently, spread
    // themselves by the local Jacobian for free.
    expect(POST_AA_BLIT_WGSL).toContain('var offs: array<vec2<f32>, 4>');
    expect(POST_AA_BLIT_WGSL).toContain('acc * 0.25');
  });
});
