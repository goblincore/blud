import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (same as march.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { createSdfLayer, isHoldFrame, rotateHeldCameras, sortFrontToBack, SDF_LAYER, FIELD_MESH_LAYER, COMPOSITE_WGSL, FIELD_INTERLEAVE_WGSL, TEMPORAL_ACCUM_WGSL, DEPTH_PREPASS_BLOCK_PX, DEPTH_PREPASS_DIV, depthPrepassSize } from './sdf-layer';

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
    const clears: { target: THREE.RenderTarget | null; alpha: number }[] = [];
    let currentTarget: THREE.RenderTarget | null = null;
    let clearAlpha = 1;
    const r = {
      autoClear: true,
      getRenderTarget: () => currentTarget,
      setRenderTarget: (t: THREE.RenderTarget | null) => { currentTarget = t; },
      render: (_scene: THREE.Scene, camera: THREE.Camera) => {
        calls.push({ target: currentTarget, autoClear: r.autoClear, mask: camera.layers.mask });
      },
      clear: () => { clears.push({ target: currentTarget, alpha: clearAlpha }); },
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (a: number) => { clearAlpha = a; },
      getClearColor: (c: THREE.Color) => c,
      setClearColor: vi.fn(),
      getClearDepth: () => 1,
      setClearDepth: vi.fn(),
      copyTextureToTexture: (src: THREE.Texture, dst: THREE.Texture) => { copies.push({ src, dst }); },
      compileAsync: vi.fn(async () => {}),
    };
    return { renderer: r as unknown as THREE.WebGPURenderer, calls, copies, clears };
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

  it('seeds the retained mesh field at alpha 0, so the first held rows read "no bone" rather than "bone everywhere"', () => {
    const { renderer, calls, copies, clears } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(64, 48);
    layer.setFieldStyle('bodies');
    layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    const depthCopy = copies.find(c => (c.src as THREE.DepthTexture).isDepthTexture)!;
    const retained = [...new Set(calls.map(c => c.target))].find(t => t?.depthTexture === depthCopy.dst)!;
    expect(clears.some(c => c.target === retained && c.alpha === 0)).toBe(true);
    layer.dispose();
  });
});

describe('weave shaders parse to their REAL parameter list — no comment phantoms', () => {
  // WGSLNodeFunction sweeps the whole parameter list, comments included, with
  // /name\s*:\s*type/. A `word: word` inside a signature comment becomes a
  // PHANTOM input, the call site binds float(0) into it, the call has one
  // argument too many and the pipeline never compiles. Seen 2026-09-10: the
  // fieldCount comment's "deliberately: these" killed the composite on the
  // DEFAULT page — no flesh, only the skeleton mesh. Same class as the
  // 2026-09-02 MARCH_BODY phantom (march.wgsl.test.ts), which had no pin here.
  const declared = (src: string) => {
    const params = src.slice(src.indexOf('(') + 1, src.indexOf(') ->')).replace(/\/\/[^\n]*/g, '');
    return [...params.matchAll(/([A-Za-z_0-9]+)\s*:/g)].map((m) => m[1]);
  };
  it.each([
    ['COMPOSITE_WGSL', COMPOSITE_WGSL],
    ['FIELD_INTERLEAVE_WGSL', FIELD_INTERLEAVE_WGSL],
    // The accumulation resolve: it carries DEPTH in alpha like the weaves do, and
    // it takes the shared flipY convention, so a phantom input here would break a
    // pass the owner sees as his own bodies upside down.
    ['TEMPORAL_ACCUM_WGSL', TEMPORAL_ACCUM_WGSL],
  ])('%s', (_name, src) => {
    const parsed = new WGSLNodeFunction(src);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names).toEqual(declared(src));
    expect(parsed.inputs.every((i: { type?: string }) => i.type !== undefined)).toBe(true);
  });
});

describe('field weave shaders — depth is never interpolated', () => {
  // Both weaves republish their .w as depth. A mix() of two depths is a
  // surface that exists nowhere; the composite's field branch regressed on
  // this after the interleave was fixed (7bfd3b29), so pin BOTH sources.
  it('the composite field branch republishes ONE surface\'s depth on a held row', () => {
    const branch = COMPOSITE_WGSL.slice(COMPOSITE_WGSL.indexOf('if (fieldMode > 0.5)'), COMPOSITE_WGSL.indexOf('// holdMode:'));
    // WAS `toContain('held.w)')` — true while the held row returned the held
    // sample verbatim. The held-row reprojection (2026-09-10) republishes either
    // that same sample's depth OR its reprojected depth, and the invariant the
    // pin exists for is that it is never a BLEND: a mix of two depths describes a
    // surface that exists nowhere.
    expect(branch).toContain('var heldDepth = held.w;');
    expect(branch).toContain('heldDepth = clamp(clipCur.z / clipCur.w, 0.0, 0.9999);');
    expect(branch).not.toMatch(/mix\(\(a \+ b\)/);
    // heldDepth is passed through the vec4, never into the mix() with the colour.
    expect(branch).not.toMatch(/mix\([^)]*heldDepth/);
    expect(branch).toContain('if (held.w >= 1.0) { discard; }');
  });
  it('the composite draws a held row\'s sample from the camera that wrote ITS slot', () => {
    // Three ring slots, three different frames, three different cameras. Reading
    // the wrong one is SILENT — it reprojects through a neighbouring frame's
    // camera and reads as a plausible smear — so the slot -> camera mapping and
    // the rotation order are both pinned here (the host rotates the matrices in
    // the same source->destination order it rotates the textures).
    const branch = COMPOSITE_WGSL.slice(COMPOSITE_WGSL.indexOf('if (fieldMode > 0.5)'), COMPOSITE_WGSL.indexOf('// holdMode:'));
    expect(branch).toContain('var heldInvSlot = heldInv1;');
    expect(branch).toContain('heldInvSlot = heldInv;');
    expect(branch).toContain('heldInvSlot = heldInv1;');
    expect(branch).toContain('heldInvSlot = heldInv2;');
    // Repo-relative, like dev-save.test.ts: process cwd is the repo root under
    // vitest, and import.meta.url is not a file: URL through the transform.
    // The matrices rotate with the textures, in the same order, and that order
    // is the whole function — see rotateHeldCameras' own note.
    const slots = [0, 1, 2].map((k) => new THREE.Matrix4().makeTranslation(k, k, k));
    const current = new THREE.Matrix4().makeTranslation(9, 9, 9);
    rotateHeldCameras(slots, current);
    const tx = (m: THREE.Matrix4) => [m.elements[12], m.elements[13], m.elements[14]];
    expect(tx(slots[0]!)).toEqual([9, 9, 9]);   // this frame
    expect(tx(slots[1]!)).toEqual([0, 0, 0]);   // was slot 0
    expect(tx(slots[2]!)).toEqual([1, 1, 1]);   // was slot 1, NOT the overwritten slot 0
  });
  it('the held-row reprojection is HORIZONTAL only, by construction', () => {
    // A held row's sample must stay in the row it belongs to — that IS the field
    // structure — so the reprojected coordinate contributes a COLUMN and never a
    // row. Resampling the reprojected row would tear one sample across several and
    // defeat the weave; see the shader's own note.
    const branch = COMPOSITE_WGSL.slice(COMPOSITE_WGSL.indexOf('if (fieldMode > 0.5)'), COMPOSITE_WGSL.indexOf('// holdMode:'));
    expect(branch).toContain('let cRep = clamp(i32(floor(stRep.x * dims.x)), 0, i32(dims.x) - 1);');
    expect(branch).not.toMatch(/stRep\.y/);
  });
  it('the interleave returns the held depth verbatim on a held row', () => {
    expect(FIELD_INTERLEAVE_WGSL).toContain('return vec4<f32>(woven.xyz, dHeld);');
  });
  it('the composite brackets a held row with the GENERALISED neighbour form', () => {
    // WAS a literal check for "let base = tRow - i32(fieldParityF);" — the
    // two-field expression. The field count is configurable now, so the shader
    // carries the integer derivation instead; the nf = 2 EQUIVALENCE is proven
    // behaviourally in field-render.test.ts (fieldHeldNeighboursInteger against
    // the shipped tRow - parity on every row and parity), which is a stronger
    // gate than a substring. These assertions only guard against the shader
    // drifting away from that proven form.
    expect(COMPOSITE_WGSL).toContain('let own = tRow0 * nf + i32(fieldParityF);');
    expect(COMPOSITE_WGSL).toContain('let base = select(tRow0 - 1, tRow0, own <= outRow);');
    // And the clamp that keeps a missing fieldCount binding from becoming a
    // division by zero in the composite.
    expect(COMPOSITE_WGSL).toContain('let nf = clamp(i32(fieldCount + 0.5), 1, 8);');
  });
  it('the interleave uses the SAME generalised neighbour form as the composite', () => {
    // THIS IS A CORRECTNESS REQUIREMENT, not tidiness, and it was learned from a
    // live defect (2026-09-10, owner): on h/3 and h/4 the skeleton rendered
    // OUTSIDE the body. This weave is what puts BONE on the flesh's grid, so when
    // it still computed rows as `outRow / 2` while the composite used h/3, the two
    // weaves disagreed about which rows were fresh and the bone landed where the
    // flesh had not drawn. The two weaves must therefore derive their rows
    // IDENTICALLY — if one changes, this test should stop whoever changed it.
    expect(FIELD_INTERLEAVE_WGSL).toContain('let own = tRow0 * nf + i32(parity);');
    expect(FIELD_INTERLEAVE_WGSL).toContain('let base = select(tRow0 - 1, tRow0, own <= outRow);');
    expect(FIELD_INTERLEAVE_WGSL).toContain('let nf = clamp(i32(fieldCount + 0.5), 1, 8);');
    // And the same derivation as the composite, character for character, apart
    // from the parity uniform's name.
    // Compare the CODE, not the prose: strip comment lines and blank lines, so a
    // longer explanation in one shader cannot make this fail while the maths is
    // identical (it did on the first cut), and so a genuine drift in the maths
    // cannot hide behind matching comments.
    const derive = (src: string) => src
      // The two shaders take their fresh texture under different names
      // (layerTex vs curTex) — that is intentional, so normalise it rather than
      // let a naming difference stand in for a maths difference.
      .replace(/fieldParityF/g, 'parity')
      .replace(/layerTex/g, 'curTex')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'))
      .filter((l) => /tRow0|own|base|nf =|outRow % nf/.test(l))
      .join('\n');
    expect(derive(FIELD_INTERLEAVE_WGSL)).toBe(derive(COMPOSITE_WGSL));
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
