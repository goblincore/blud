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
  POST_AA_FXAA_WGSL, POST_AA_BLEND_WGSL, POST_AA_BLIT_WGSL, POST_AA_COPY_WGSL,
  VHS_TERM_RANGES,
  createPostAa,
} from './post-aa';
import { POST_VHS_WGSL, VHS_PRESETS } from './post-vhs';
import { POST_GLOW_EXTRACT_WGSL, POST_GLOW_BLUR_WGSL } from './post-glow';
import { getRenderCap, setRenderCap } from './lab-renderer';

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
    expect(src).toContain(
      'for (const t of [sceneTarget, fxaaTarget, histA, histB, vhsInA, vhsInB, vhsTarget, sscsTarget, glowA, glowB, fireTarget, fireHistA, fireHistB])',
    );
    expect(src).toContain('targetsNeedInit = true;');
  });

  it('round 2b: the fire composite blends into the capture, no copy draw', () => {
    // out = scene * T + emission via dstFactor = srcAlpha (srcAlpha is T).
    expect(src).toContain('fireCompositeMat.blending = THREE.CustomBlending;');
    expect(src).toContain('fireCompositeMat.blendSrc = THREE.OneFactor;');
    expect(src).toContain('fireCompositeMat.blendDst = THREE.SrcAlphaFactor;');
    expect(src).toContain('fireCompositeMat.blendSrcAlpha = THREE.OneFactor;');
    expect(src).toContain('fireCompositeMat.blendDstAlpha = THREE.ZeroFactor;');
    // The separate full-res composite target and its copy draw are gone.
    expect(src).not.toContain('fireOut');
    expect(src).not.toContain('fireCopyMat');
  });

  it('round 2b: the fire resolve + history run at the march resolution', () => {
    expect(src).toContain('fireHistA.setSize(fireTarget.width, fireTarget.height);');
    expect(src).toContain('fireHistB.setSize(fireTarget.width, fireTarget.height);');
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

  it('every declared WGSL parameter is supplied at the call site', () => {
    // fa57506 shipped a blit whose header declared `lens` that the wgslFn
    // call never bound: green tests, dead renderer (three resolves
    // wgslFn(...)({...}) keys against the parsed header by name, so a
    // missing key is silently unbound rather than a build error). Parse
    // both sides and diff them instead of trusting the two stay in sync.
    const headerParams = (wgsl: string): string[] => {
      const header = wgsl.match(/^fn\s+\w+\(([\s\S]*?)\)\s*->/);
      expect(header).not.toBeNull();
      return header![1]!
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.split(':')[0]!.trim())
        .sort();
    };
    const callSiteKeys = (constName: string): string[] => {
      const re = new RegExp(String.raw`wgslFn\(${constName}\)\(\{([\s\S]*?)\}\)`);
      const m = src.match(re);
      expect(m).not.toBeNull();
      return [...m![1]!.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)]
        .map(x => x[1]!)
        .sort();
    };
    const callSites: Array<[string, string]> = [
      ['POST_AA_FXAA_WGSL', POST_AA_FXAA_WGSL],
      ['POST_AA_BLEND_WGSL', POST_AA_BLEND_WGSL],
      ['POST_AA_BLIT_WGSL', POST_AA_BLIT_WGSL],
      ['POST_AA_COPY_WGSL', POST_AA_COPY_WGSL],
      // The VHS stage binds by name too, sampler included: three's wgslFn
      // resolves keys against the parsed header, so a missing `samp` would be
      // silently unbound (and generateInput would substitute float(0)).
      ['POST_VHS_WGSL', POST_VHS_WGSL],
      // The glow pair: the blur declares a sampler the extract does not, so
      // each call site must match ITS header — the same silent-unbind trap.
      ['POST_GLOW_EXTRACT_WGSL', POST_GLOW_EXTRACT_WGSL],
      ['POST_GLOW_BLUR_WGSL', POST_GLOW_BLUR_WGSL],
    ];
    for (const [constName, wgsl] of callSites) {
      expect(callSiteKeys(constName)).toEqual(headerParams(wgsl));
    }
  });

  it('the VHS stage owns a filterable input pair, never histA/histB', () => {
    // three emits NO <tex>_sampler for a nearest/nearest target
    // (WGSLNodeBuilder.isUnfilterable), so POST_VHS_WGSL's textureSample
    // needs the pair to be LinearFilter; and the motion gate must read a
    // dedicated INPUT pair — the smear history is the pass's own output
    // family and would latch the gate on.
    expect(src).toMatch(/const vhsInA = new THREE\.RenderTarget\(1, 1, vhsPairOpts\);/);
    expect(src).toMatch(/const vhsInB = new THREE\.RenderTarget\(1, 1, vhsPairOpts\);/);
    expect(src).toMatch(/vhsPairOpts = \{[\s\S]*?minFilter: THREE\.LinearFilter[\s\S]*?\}/);
    expect(src).toContain('samp: vhsCurTex');
    expect(src).toContain('vhsCurTex.value = vhsWrite.texture');
    expect(src).toContain('vhsPrevTex.value = vhsRead.texture');
    expect(src).not.toMatch(/vhsPrevTex\.value = hist(Read|A|B)\.texture/);
  });
});

/**
 * A renderer stand-in: the all-off path must not touch it at all. `passes`
 * records each rendered scene's material name so a test can tell WHICH stage
 * ran (the counts alone cannot: fxaa+smear and vhs+blit are both three calls).
 */
function stubRenderer() {
  const calls = { setRenderTarget: 0, render: 0, setSize: 0, passes: [] as string[] };
  const renderer = {
    domElement: { style: {} as Record<string, string> },
    autoClear: true,
    setSize() { calls.setSize++; },
    setRenderTarget() { calls.setRenderTarget++; },
    render(scene: THREE.Scene) {
      calls.render++;
      const mesh = scene.children[0] as THREE.Mesh | undefined;
      const material = mesh?.material as THREE.Material | undefined;
      calls.passes.push(material?.name || 'unnamed');
    },
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

  it('setFireVolume(false) is a no-op on the all-off parity path', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setFireVolume(false);
    calls.setRenderTarget = 0;
    calls.render = 0;

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    expect(chainCalls).toBe(1);
    expect(calls.setRenderTarget).toBe(0);
    expect(calls.render).toBe(0);
  });

  it('setFireVolume(true) runs the three fire passes into the capture', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    const frame = {
      tuning: {
        resolutionScale: 0.5, steps: 32, tempGain: 1.6, sootGain: 0.6,
        rise: 1.1, sootRise: 2.2, curlStrength: 0.35, curlScale: 1.2,
        lag: 0.3, lagMaxM: 0.6, history: 0.85, cardsPerBody: 5, smokeTailSec: 2,
        noiseScale: 2.4, noiseStretch: 0.5, erode: 0.55, erodeRise: 0.6,
        edgeSharp: 2.5, coreR: 0.12, smokeAlbedo: 0.5, smokeAmbient: 0.55,
        smokeFireLit: 1.0, smokeSpread: 0.4, maxBodies: 4, density: 1, skin: 1, headRise: 1, headClear: 1,
      },
      time: 1, frame: 3,
      invViewProj: new THREE.Matrix4(),
      prevViewProj: new THREE.Matrix4(),
      near: 0.05, far: 60, capsuleCount: 2,
      boundsMin: [-1, 0, -1] as [number, number, number],
      boundsMax: [1, 3, 1] as [number, number, number],
    };
    post.setFireVolume(true, frame);
    // The first render settles the target init loop; then the fire passes are
    // the ONLY draws for a frame with every other effect off.
    post.render(() => {});
    calls.setRenderTarget = 0;
    calls.render = 0;
    calls.passes.length = 0;

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    expect(chainCalls).toBe(1);
    // Three fire draws (march, resolve, composite-into-capture), then the
    // chain's own final blit. Round 2's separate composite target + copy draw
    // are gone: the composite BLENDS into the capture.
    expect(calls.render).toBe(4);
    expect(calls.passes.slice(0, 3)).toEqual([
      'post:fire-march', 'post:fire-resolve', 'post:fire-composite',
    ]);
  });

  it('exposes the real capture target with sampleable depth (prewarm seam)', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    // The shutter layer binds this texture + depth at prewarm; it must be the
    // same target the chain draws into, not a copy.
    expect(post.captureTarget).toBeInstanceOf(THREE.RenderTarget);
    expect(post.captureTarget.depthTexture).not.toBeNull();
    expect(post.captureTarget.width).toBeGreaterThan(0);
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

  it('a capture stage forces the captured path even with every effect off', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });

    const stageOut = new THREE.RenderTarget(8, 8);
    let stageCalls = 0;
    let seen: THREE.RenderTarget | null = null;
    post.setCaptureStage((capture) => { stageCalls++; seen = capture; return stageOut; });
    calls.setRenderTarget = 0;
    calls.render = 0;

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    // The stage is the only active stage, yet the chain was still captured:
    // the sinks were redirected and the stage received the capture target.
    expect(chainCalls).toBe(1);
    expect(stageCalls).toBe(1);
    expect(seen).not.toBeNull();
    expect(sink.target).toBe(seen);
    expect(calls.render).toBeGreaterThan(0);
  });

  it('clearing the capture stage restores the all-off parity path', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setCaptureStage(() => new THREE.RenderTarget(8, 8));
    post.render(() => {});
    // Now off.
    post.setCaptureStage(null);
    calls.setRenderTarget = 0;
    calls.render = 0;
    let chainCalls = 0;
    post.render(() => { chainCalls++; });
    expect(chainCalls).toBe(1);
    expect(calls.render).toBe(0);
  });

  it('setSmear clamps to the slider range', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setSmear(99);
    expect(post.smear).toBe(POST_AA_SMEAR_MAX);
    post.setSmear(-1);
    expect(post.smear).toBe(0);
  });

  it('a lens is off by default, and off is an exact identity', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    expect(post.lens.k).toBe(0);
  });

  it('all-off parity survives a lens that is set but not narrowing', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setLens(90, 90); // centre not narrower than render -> k = 0
    calls.setRenderTarget = 0;
    calls.render = 0;

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    expect(post.lens.k).toBe(0);
    expect(chainCalls).toBe(1);
    expect(calls.setRenderTarget).toBe(0);
    expect(calls.render).toBe(0);
  });

  it('a narrowing lens is an active effect: it redirects and runs the passes', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setLens(90, 60);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    expect(post.lens.k).toBeGreaterThan(0);
    expect(chainCalls).toBe(1);
    expect(sink.target).not.toBeNull();
    expect(calls.render).toBeGreaterThan(0);
  });

  it('resolves the lens against the CONTENT aspect, not the window', () => {
    // Under the default 'fit' cap, computeRenderSize preserves the window's
    // aspect by construction (see lab-renderer.ts), so no window size can
    // ever separate content aspect from window aspect there. Only a 'fixed'
    // cap decouples them — set one whose aspect (2:1) differs from
    // happy-dom's 4:3 window, so this test can actually fail.
    const priorCap = getRenderCap();
    try {
      setRenderCap({ mode: 'fixed', width: 800, height: 400 });
      const { renderer } = stubRenderer();
      const post = createPostAa(renderer);
      post.setLens(90, 60);
      const windowAspect = window.innerWidth / window.innerHeight;
      expect(post.lens.aspect).toBeCloseTo(2, 9);
      expect(post.lens.aspect).not.toBeCloseTo(windowAspect, 1);
    } finally {
      setRenderCap(priorCap);
    }
  });

  it('re-resolves the lens on resize', () => {
    // 'fit' keeps content aspect == window aspect, so changing the window's
    // aspect and dispatching resize is a discriminating probe: if refit()
    // ever drops (or reorders before setSize) its recomputeLens() call, this
    // is the test that notices — every other current test would still pass.
    const priorW = window.innerWidth;
    const priorH = window.innerHeight;
    try {
      const { renderer } = stubRenderer();
      const post = createPostAa(renderer);
      post.setLens(90, 60);
      const before = post.lens.aspect;

      Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
      window.dispatchEvent(new Event('resize'));

      const after = post.lens.aspect;
      expect(after).not.toBeCloseTo(before, 1);
      expect(after).toBeCloseTo(post.contentSize.width / post.contentSize.height, 9);
      // k is aspect-dependent, which is the entire reason the FOVs are
      // stored rather than a single precomputed k.
      expect(post.lens.k).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: priorW, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: priorH, configurable: true });
    }
  });

  it('a NaN FOV resolves to the lens being off, not a silent warp', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setLens(NaN, 60);
    calls.setRenderTarget = 0;
    calls.render = 0;

    expect(post.lens.k).toBe(0);
    expect(Number.isFinite(post.lens.k)).toBe(true);

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    expect(chainCalls).toBe(1);
    expect(calls.setRenderTarget).toBe(0);
    expect(calls.render).toBe(0);
  });
});

describe('post-aa VHS stage (default OFF)', () => {
  it('null preset: effectiveSmear tracks the user setting and VHS never renders', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0.4);

    expect(post.vhs).toBeNull();
    expect(post.effectiveSmear).toBe(0.4);

    post.render(() => {});

    expect(calls.passes).toContain('post:smear');
    expect(calls.passes).not.toContain('post:vhs');
    expect(calls.passes).not.toContain('post:vhs-input');
  });

  it("'soft': VHS runs after FXAA, skips smear, and the blit reads display space", () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    // FXAA defaults on, so this also pins the stage ORDER.
    post.setSmear(0.4);
    post.setVhs('soft');

    expect(post.vhs).toBe('soft');
    expect(post.effectiveSmear).toBe(0);

    post.render(() => {});

    const stages = calls.passes.filter(p => p.startsWith('post:'));
    expect(stages).toEqual(['post:fxaa', 'post:vhs-input', 'post:vhs', 'post:blit']);
    expect(calls.passes).not.toContain('post:smear');
    // VHS output is display-encoded (it grades the taps itself).
    expect(post.blitSrcIsDisplay).toBe(true);
  });

  it('setVhs(null) after a preset restores the previous smear setting exactly', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setSmear(0.35);
    post.setVhs('soft');
    expect(post.effectiveSmear).toBe(0);

    post.setVhs(null);

    expect(post.vhs).toBeNull();
    expect(post.smear).toBe(0.35);
    expect(post.effectiveSmear).toBe(0.35);
  });

  it('setVhsTerm clamps to the club-mutant slider ranges', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setVhs('soft');

    post.setVhsTerm('noiseAmount', 99);
    expect(post.vhsTerms.noiseAmount).toBe(VHS_TERM_RANGES.noiseAmount[1]);
    post.setVhsTerm('noiseAmount', -5);
    expect(post.vhsTerms.noiseAmount).toBe(0);
    post.setVhsTerm('chromaAmount', 3.25);
    expect(post.vhsTerms.chromaAmount).toBe(3.25);
    post.setVhsTerm('chromaBurstRate', 1e9);
    expect(post.vhsTerms.chromaBurstRate).toBe(60);
  });

  it('every term has a range that contains every preset', () => {
    const keys = Object.keys(VHS_PRESETS.soft) as (keyof typeof VHS_PRESETS.soft)[];
    for (const k of keys) {
      const [lo, hi] = VHS_TERM_RANGES[k];
      expect(lo).toBeLessThanOrEqual(hi);
      for (const p of ['blud', 'soft', 'balanced', 'chaotic'] as const) {
        expect(VHS_PRESETS[p][k]).toBeGreaterThanOrEqual(lo);
        expect(VHS_PRESETS[p][k]).toBeLessThanOrEqual(hi);
      }
    }
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
    expect(POST_AA_BLIT_WGSL).toContain('acc * 0.25');

    // fisheyeWarp appears exactly twice: its declaration, and the one call
    // site inside the tap loop. A tidy-up that hoists the warp out of the
    // loop and fetches four neighbours of a single warped point would keep
    // this string containing "fisheyeWarp(" once for the call — this guards
    // against exactly that, which destroys the Jacobian-spread argument the
    // comment above makes.
    const warpCalls = POST_AA_BLIT_WGSL.match(/fisheyeWarp\(/g) ?? [];
    expect(warpCalls.length).toBe(2);

    // The per-tap offset must be added to st BEFORE the warp call, not
    // applied to an already-warped point.
    expect(POST_AA_BLIT_WGSL).toMatch(/fisheyeWarp\(st \+ offs\[i\] \* \w+, lens\)/);

    // Tap spacing must be sized in DESTINATION pixels. Sizing by srcDims
    // instead would give the wrong prefilter width whenever the destination
    // is larger than the source (sharp mode's case) — invisible until sharp
    // mode is also on.
    expect(POST_AA_BLIT_WGSL).toMatch(/vec2<f32>\(1\.0, 1\.0\) \/ dstSize/);

    // Extract the offsets from the array<vec2<f32>, 4>(...) initializer
    // specifically, not by slicing the first four vec2<f32>(...) literals
    // in the whole string — the sharp branch and fisheyeWarp itself contain
    // other such literals, so a positional slice would be fragile.
    const arrayMatch = POST_AA_BLIT_WGSL.match(/array<vec2<f32>, 4>\(([\s\S]*?)\);/);
    expect(arrayMatch).not.toBeNull();
    const offsets = [...arrayMatch![1]!.matchAll(
      /vec2<f32>\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*\)/g,
    )].map(m => [Number(m[1]), Number(m[2])] as const);
    expect(offsets).toHaveLength(4);

    // A rotated grid, not a box: four distinct x values and four distinct y
    // values, so no two taps share a row or column. A "tidier" 0.25-spaced
    // box (±0.125, ±0.125 combinations) would collapse this to two distinct
    // values per axis.
    expect(new Set(offsets.map(([x]) => x)).size).toBe(4);
    expect(new Set(offsets.map(([, y]) => y)).size).toBe(4);

    // Centred on the pixel: the four taps sum to zero on both axes.
    expect(offsets.reduce((sum, [x]) => sum + x, 0)).toBeCloseTo(0);
    expect(offsets.reduce((sum, [, y]) => sum + y, 0)).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// BLAST REFRACTION — the bounded experiment (2026-09-16 playtest task 4).
// These pin the BOUNDS, not the look: the ring is at most four blasts, ages on
// sim time, drops off-screen/behind-camera feeds, and is inert while off.
// ---------------------------------------------------------------------------
describe('blast refraction (bounded experiment)', () => {
  /** A camera at the origin looking down -Z; f = 1 at 90 deg vertical FOV. */
  const camera = () => {
    const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    return cam;
  };

  it('is off and empty by default, and inert in the parity path', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    expect(post.blastDistort).toBe(false);
    expect(post.blastDistortCount).toBe(0);
    post.setFxaa(false);
    post.setSmear(0);
    calls.setRenderTarget = 0;
    calls.render = 0;
    post.pushBlastDistort([0, 0, -4], 1, 0.03);
    // A push while off records it, but the pass stays inactive.
    expect(post.blastDistortCount).toBe(1);
    post.render(() => {});
    expect(calls.render).toBe(0);
  });

  it('runs the blit once enabled with a live blast', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setBlastDistortCamera(camera());
    post.setBlastDistort(true);
    post.pushBlastDistort([0, 0, -4], 1, 0.03);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });
    post.render(() => {});
    expect(sink.target).not.toBeNull();
    expect(calls.render).toBeGreaterThan(0);
  });

  // TASK-2 REVIEW SEAM. `blastDistortSlots` is the read-back a capture rig uses
  // to prove the band is centred on the blast and follows a moving camera. It
  // reports exactly what the last blit PUSHED, so a wrong `u`/`v` (or a silent
  // drop) is visible from the page instead of being inferred from a pixel diff.
  it('reports the resolved slot it pushed, centred on the blast', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setBlastDistortCamera(camera());
    post.setBlastDistort(true);
    post.pushBlastDistort([0, 0, -4], 1, 0.03);
    // Past the attack ramp: at age 0 the decay is deliberately 0.
    post.stepBlastDistort(0.1);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });
    expect(post.blastDistortSlots).toEqual([]);
    post.render(() => {});
    const slots = post.blastDistortSlots;
    expect(slots).toHaveLength(1);
    expect(slots[0]!.reason).toBe('ok');
    // The camera looks straight down -Z, so an origin-centred blast is centred.
    expect(slots[0]!.u).toBeCloseTo(0.5, 5);
    expect(slots[0]!.v).toBeCloseTo(0.5, 5);
    expect(slots[0]!.radiusUv).toBeGreaterThan(0);
    expect(slots[0]!.strength).toBeGreaterThan(0);
  });

  it('reports WHY a live blast was dropped (behind the camera)', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setBlastDistortCamera(camera());
    post.setBlastDistort(true);
    // Behind the origin camera (which faces -Z).
    post.pushBlastDistort([0, 0, 4], 1, 0.03);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });
    post.render(() => {});
    expect(post.blastDistortSlots).toHaveLength(1);
    expect(post.blastDistortSlots[0]!.reason).toBe('behind');
    expect(post.blastDistortSlots[0]!.u).toBeNull();
  });

  it('resolves every live blast and reports the ring bound at four', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setBlastDistortCamera(camera());
    post.setBlastDistort(true);
    for (let i = 0; i < 5; i++) post.pushBlastDistort([0, 0, -4 - i], 1, 0.03);
    // The push is the bound: the ring never holds more than four, so the
    // shader's four unrolled slots can never index out of range.
    expect(post.blastDistortCount).toBe(4);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });
    post.render(() => {});
    const reasons = post.blastDistortSlots.map(s => s.reason);
    expect(reasons).toHaveLength(4);
    expect(reasons.every(r => r === 'ok')).toBe(true);
  });


  it('keeps at most FOUR blasts and drops the oldest', () => {    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    for (let i = 0; i < 7; i++) post.pushBlastDistort([0, 0, -4 - i * 0.5], 1, 0.03);
    expect(post.blastDistortCount).toBe(4);
  });

  it('drops non-finite and degenerate feeds at the push', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.pushBlastDistort([NaN, 0, -4], 1, 0.03);
    post.pushBlastDistort([0, 0, -4], NaN, 0.03);
    post.pushBlastDistort([0, 0, -4], 0, 0.03);
    post.pushBlastDistort([0, 0, -4], 1, 0);
    post.pushBlastDistort([0, 0, -4], 1, NaN);
    expect(post.blastDistortCount).toBe(0);
    // A behind-camera blast is STORED (there is no camera at the feed), and the
    // per-frame projection drops it: `projectBlastRefraction` is the gate, and
    // its own behind-camera contract is pinned in blast-refraction.test.ts.
    post.pushBlastDistort([0, 0, 4], 1, 0.03);
    expect(post.blastDistortCount).toBe(1);
  });

  it('ages on sim time and expires, so a frozen capture stays deterministic', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.pushBlastDistort([0, 0, -4], 1, 0.03);
    expect(post.blastDistortCount).toBe(1);
    post.stepBlastDistort(1 / 60);
    expect(post.blastDistortCount).toBe(1);
    // Long enough to exceed the ~0.55 s life regardless of its exact value.
    post.stepBlastDistort(0.7);
    expect(post.blastDistortCount).toBe(0);
    // Wall-clock is never consulted: a second identical run gives the same
    // state for the same dt sequence.
    post.pushBlastDistort([0, 0, -4], 1, 0.03);
    post.stepBlastDistort(0.1);
    expect(post.blastDistortCount).toBe(1);
  });

  it('clamps strength into a bounded multiplier', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setBlastDistortStrength(99);
    expect(post.blastDistortStrength).toBe(4);
    post.setBlastDistortStrength(-3);
    expect(post.blastDistortStrength).toBe(0);
    post.setBlastDistortStrength(NaN);
    expect(post.blastDistortStrength).toBe(1);
  });

  it('the WGSL loop is unrolled, bounded to four, and clamped', () => {
    expect(POST_AA_BLIT_WGSL).toContain('fn postAaBlastWarp(');
    expect(POST_AA_BLIT_WGSL.indexOf('fn postAaBlastWarp('))
      .toBeGreaterThan(POST_AA_BLIT_WGSL.indexOf('fn postAaBlit('));
    // One loop of four iterations and a per-blast slot guard.
    expect(POST_AA_BLIT_WGSL).toMatch(/for \(var i: i32 = 0; i < 4; i = i \+ 1\)/);
    expect(POST_AA_BLIT_WGSL).toContain('f32(i) + 0.5 > dist.x');
    // The summed offset is clamped to the uniform max.
    expect(POST_AA_BLIT_WGSL).toMatch(/if \(l > dist\.y\) \{ off = off \* \(dist\.y \/ l\); \}/);
    // Inert gate.
    expect(POST_AA_BLIT_WGSL).toContain('if (dist.w < 0.5 || dist.x < 0.5) { return uvIn; }');
    // The BROAD shell, not the old sin^4 hairline.
    expect(POST_AA_BLIT_WGSL).toContain('let ring = s * s;');
    expect(POST_AA_BLIT_WGSL).not.toContain('ring = ring * ring;');
  });
});
