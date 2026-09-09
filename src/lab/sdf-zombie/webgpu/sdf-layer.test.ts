import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createSdfLayer, isHoldFrame, sortFrontToBack, SDF_LAYER, FIELD_MESH_LAYER, COMPOSITE_WGSL, FIELD_INTERLEAVE_WGSL, DEPTH_PREPASS_BLOCK_PX, DEPTH_PREPASS_DIV, depthPrepassSize } from './sdf-layer';

describe('depth prepass sizing (close-up task 3)', () => {
  it('the block footprint constant stays in step with the downsample factor', () => {
    // THE PROOF'S ONE NUMBER. The coarse cone's radius must cover the block's
    // half-diagonal — (DIV/2, DIV/2) SDF pixels from the texel-centre ray —
    // or a full-res ray near a block corner can escape the cone and the
    // "start is a lower bound" proof dies. If DIV ever changes, this fails
    // until DEPTH_PREPASS_BLOCK_PX is recomputed with it.
    expect(DEPTH_PREPASS_BLOCK_PX).toBeCloseTo((DEPTH_PREPASS_DIV / 2) * Math.SQRT2, 12);
  });

  it('coarse target size ceils, never zeroes, and a partial block stays covered', () => {
    expect(depthPrepassSize(960, 540)).toEqual({ width: 240, height: 135 });
    expect(depthPrepassSize(961, 541)).toEqual({ width: 241, height: 136 });
    expect(depthPrepassSize(3, 2)).toEqual({ width: 1, height: 1 });
    // A partial edge block is SMALLER than a full one, so its corners sit
    // nearer the texel centre than DEPTH_PREPASS_BLOCK_PX assumes — ceil is
    // conservative in exactly the direction the proof wants.
    expect(depthPrepassSize(1, 1).width).toBe(1);
  });
});

describe('sortFrontToBack', () => {
  it('orders objects by distance from the camera, nearest first, without mutating the input', () => {
    const mk = (x: number) => { const o = new THREE.Object3D(); o.position.set(x, 0, 0); return o; };
    const far = mk(10), near = mk(1), mid = mk(5);
    const input = [far, near, mid];
    const out = sortFrontToBack(input, new THREE.Vector3(0, 0, 0));
    expect(out).toEqual([near, mid, far]);
    expect(input).toEqual([far, near, mid]);
  });
});

describe('SDF-layer material precompile', () => {
  it('compiles in the real float-target context and restores renderer/camera state', async () => {
    const previousTarget = new THREE.RenderTarget(2, 2);
    let currentTarget: THREE.RenderTarget | null = previousTarget;
    let targetDuringCompile: THREE.RenderTarget | null = null;
    let maskDuringCompile = 0;
    const camera = new THREE.PerspectiveCamera();
    const compileAsync = vi.fn(async () => {
      targetDuringCompile = currentTarget;
      maskDuringCompile = camera.layers.mask;
    });
    const renderer = {
      getRenderTarget: () => currentTarget,
      setRenderTarget: (target: THREE.RenderTarget | null) => { currentTarget = target; },
      compileAsync,
    } as unknown as THREE.WebGPURenderer;
    const layer = createSdfLayer(renderer);
    const scene = new THREE.Scene();
    camera.layers.set(7);
    const previousMask = camera.layers.mask;
    const object = new THREE.Object3D();

    await layer.precompile(object, scene, camera);

    const compileTarget = compileAsync.mock.invocationCallOrder.length > 0
      ? compileAsync.mock.calls[0]
      : undefined;
    expect(compileTarget).toEqual([object, camera, scene]);
    expect(targetDuringCompile).toBeInstanceOf(THREE.RenderTarget);
    expect(targetDuringCompile).not.toBe(previousTarget);
    const compiledTarget = targetDuringCompile as unknown as THREE.RenderTarget;
    expect(compiledTarget.texture.type).toBe(THREE.FloatType);
    expect(maskDuringCompile).toBe(1 << SDF_LAYER);
    expect(currentTarget).toBe(previousTarget);
    expect(camera.layers.mask).toBe(previousMask);

    layer.dispose();
    previousTarget.dispose();
  });
});

describe('half-rate hold decision (C2)', () => {
  it('alternates fresh/hold by frame parity while enabled', () => {
    // Even index = fresh march, odd = hold, forever.
    expect(isHoldFrame(0, true, false)).toBe(false);
    expect(isHoldFrame(1, true, false)).toBe(true);
    expect(isHoldFrame(2, true, false)).toBe(false);
    expect(isHoldFrame(41, true, false)).toBe(true);
  });
  it('never holds while disabled or while a fresh frame is forced', () => {
    expect(isHoldFrame(1, false, false)).toBe(false);
    expect(isHoldFrame(1, true, true)).toBe(false);
    // The first frame ever is fresh even on an odd index.
    expect(isHoldFrame(1, true, true)).toBe(false);
  });
  it('alternation survives a forced-fresh frame (enable/resize mid-run)', () => {
    // frameIndex keeps counting; the forced frame is fresh, the next odd
    // frame holds again — enabling mid-session cannot put the layer in a
    // permanent all-fresh or all-hold state.
    const idxAfterForce = 6;              // even index anyway
    expect(isHoldFrame(idxAfterForce, true, true)).toBe(false);
    expect(isHoldFrame(idxAfterForce + 1, true, false)).toBe(true);
    const idxAfterForceOdd = 7;
    expect(isHoldFrame(idxAfterForceOdd, true, true)).toBe(false);
    expect(isHoldFrame(idxAfterForceOdd + 1, true, false)).toBe(false);
    expect(isHoldFrame(idxAfterForceOdd + 2, true, false)).toBe(true);
  });
});

describe("'bodies' field style — the skeleton mesh pass", () => {
  /** A renderer fake that records, for every render() call, the state the
   *  pass actually ran under. Everything the field paths touch is stubbed;
   *  nothing here goes near a GPU. */
  function fakeRenderer() {
    type Call = { target: THREE.RenderTarget | null; autoClear: boolean; mask: number };
    const calls: Call[] = [];
    const copies: { src: THREE.Texture; dst: THREE.Texture }[] = [];
    let currentTarget: THREE.RenderTarget | null = null;
    let clearAlpha = 1;
    const r = {
      autoClear: true,
      getRenderTarget: () => currentTarget,
      setRenderTarget: (t: THREE.RenderTarget | null) => { currentTarget = t; },
      render: (_scene: THREE.Scene, camera: THREE.Camera) => {
        calls.push({ target: currentTarget, autoClear: r.autoClear, mask: camera.layers.mask });
      },
      clear: vi.fn(),
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (a: number) => { clearAlpha = a; },
      getClearColor: (c: THREE.Color) => c,
      setClearColor: vi.fn(),
      getClearDepth: () => 1,
      setClearDepth: vi.fn(),
      copyTextureToTexture: (src: THREE.Texture, dst: THREE.Texture) => { copies.push({ src, dst }); },
      compileAsync: vi.fn(async () => {}),
    };
    return { renderer: r as unknown as THREE.WebGPURenderer, calls, copies };
  }

  it('draws the mesh field with autoClear OFF, so its alpha-0 coverage clear survives', () => {
    const { renderer, calls } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(64, 48);
    layer.setFieldStyle('bodies');
    layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    const meshPass = calls.filter(c => c.mask === (1 << FIELD_MESH_LAYER));
    expect(meshPass).toHaveLength(1);
    // autoClear ON re-clears with the renderer's own clear alpha (1) at the
    // top of render(), which silently undoes the alpha-0 clear the weave's
    // coverage gate depends on: every empty texel then claims to be bone.
    expect(meshPass[0]!.autoClear).toBe(false);
    layer.dispose();
  });

  it('renders to every depth-copy destination before copying into it', () => {
    const { renderer, calls, copies } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(64, 48);
    layer.setFieldStyle('bodies');
    layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // RenderTarget.setSize resizes the colour textures only; a DepthTexture
    // keeps its 1x1 image until the target is actually rendered to, and a
    // copyTextureToTexture into a 1x1 depth texture is a WebGPU validation
    // error (depth copies must cover the whole subresource). So a target that
    // is only ever a copy destination must still be rendered to once.
    const rendered = new Set(calls.map(c => c.target));
    const depthCopies = copies.filter(c => (c.src as THREE.DepthTexture).isDepthTexture);
    expect(depthCopies.length).toBeGreaterThan(0);
    for (const { dst } of depthCopies) {
      const owner = [...rendered].find(t => t?.depthTexture === dst);
      expect(owner, 'depth copy destination was never rendered to').toBeDefined();
    }
    layer.dispose();
  });
});

describe('field weave shaders — depth is never interpolated', () => {
  // Both weaves republish their .w as depth. A mix() of two depths is a
  // surface that exists nowhere; the composite's field branch regressed on
  // this after the interleave was fixed (7bfd3b29), so pin BOTH sources.
  it('the composite field branch returns the held depth verbatim on a held row', () => {
    const branch = COMPOSITE_WGSL.slice(COMPOSITE_WGSL.indexOf('if (fieldMode > 0.5)'), COMPOSITE_WGSL.indexOf('// holdMode:'));
    expect(branch).toContain('held.w)');
    expect(branch).not.toMatch(/mix\(\(a \+ b\)/);
    expect(branch).toContain('if (held.w >= 1.0) { discard; }');
  });
  it('the interleave returns the held depth verbatim on a held row', () => {
    expect(FIELD_INTERLEAVE_WGSL).toContain('return vec4<f32>(woven.xyz, dHeld);');
  });
  it('both weaves bracket a held row with the parity-corrected fresh rows', () => {
    expect(COMPOSITE_WGSL).toContain('let base = tRow - i32(fieldParityF);');
    expect(FIELD_INTERLEAVE_WGSL).toContain('let base = tRow - i32(parity);');
  });
});

describe('field jitter placement', () => {
  type ViewRec = { mask: number; viewOn: boolean; fullHeight: number; offsetY: number };
  function rendererRecordingView() {
    const calls: ViewRec[] = [];
    let currentTarget: THREE.RenderTarget | null = null;
    const r = {
      autoClear: true,
      getRenderTarget: () => currentTarget,
      setRenderTarget: (t: THREE.RenderTarget | null) => { currentTarget = t; },
      render: (_scene: THREE.Scene, camera: THREE.Camera) => {
        const v = (camera as THREE.PerspectiveCamera).view;
        calls.push({ mask: camera.layers.mask, viewOn: !!v?.enabled, fullHeight: v?.fullHeight ?? -1, offsetY: v?.offsetY ?? 0 });
      },
      clear: vi.fn(), getClearAlpha: () => 1, setClearAlpha: vi.fn(),
      getClearColor: (c: THREE.Color) => c, setClearColor: vi.fn(),
      getClearDepth: () => 1, setClearDepth: vi.fn(),
      copyTextureToTexture: vi.fn(), compileAsync: vi.fn(async () => {}),
    };
    return { renderer: r as unknown as THREE.WebGPURenderer, calls };
  }
  const polyPassOf = (calls: ViewRec[]) => calls.find(c => c.mask !== 0 && (c.mask & (1 << SDF_LAYER)) === 0 && c.mask !== (1 << FIELD_MESH_LAYER));

  it("'sdf' and 'bodies' draw the full-res polygonal pass UNJITTERED, and jitter the half-height passes", () => {
    for (const style of ['sdf', 'bodies'] as const) {
      const { renderer, calls } = rendererRecordingView();
      const layer = createSdfLayer(renderer);
      layer.setSize(64, 48);
      layer.setFieldStyle(style);
      layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
      const poly = polyPassOf(calls);
      expect(poly, style).toBeDefined();
      // The jitter exists so half-target row r lands on output row 2r+parity.
      // An unjittered poly pass already lines up with that; a jittered one is
      // half a row off and makes the whole level crawl at field rate.
      expect(poly!.viewOn, `${style}: poly pass jittered`).toBe(false);
      const jittered = calls.filter(c => c.viewOn);
      expect(jittered.length, `${style}: no jittered pass`).toBeGreaterThan(0);
      layer.dispose();
    }
  });

  it("'frame' jitters everything on the OUTPUT grid, not the sdfScale'd one", () => {
    const { renderer, calls } = rendererRecordingView();
    const layer = createSdfLayer(renderer);
    layer.setSize(64, 48);
    layer.setScale(0.5);
    layer.setFieldStyle('frame');
    layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    const poly = polyPassOf(calls);
    expect(poly).toBeDefined();
    expect(poly!.viewOn).toBe(true);
    // fieldFull is (fullW, ceil(fullH/2)) — output resolution. A jitter (and
    // an outHeight) in scaled rows weaves the wrong grid: at scale 0.7 the
    // frame stretches 1/0.7 vertically and the fields land 1/0.7 rows apart.
    expect(poly!.fullHeight).toBe(48);
    layer.dispose();
  });
});
