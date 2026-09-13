/**
 * NEURAL UPSCALE — the three.js stage (spec §1, §3, §6).
 *
 * Contract: reads the low-res march texture (rgb + clip depth in alpha, alpha
 * >= 1 = no flesh) and writes `output`, an output-sized RGBA32F texture in
 * the SAME convention, which the composite reads. Depth is never produced by
 * the network (spec §4).
 */
import * as THREE from 'three/webgpu';
import { mrt, texture, uniform, uv, vec4, wgslFn } from 'three/tsl';
import { setPassLabel } from '../gpu-pass-timing';
import {
  createUpscaleModel, type UpscaleConfig, type UpscaleInputSet, type UpscaleLayout,
  type UpscaleModel, type UpscaleModelId, type UpscaleModelSource, type HeadInputs,
  inputsUseNormals,
} from './upscale-model';
import { planUpscalePasses, UPSCALE_RECONSTRUCT_WGSL, UPSCALE_SHARPEN_WGSL, type PassSpec } from './upscale-wgsl';

export interface UpscaleStage {
  readonly config: UpscaleConfig;
  readonly model: UpscaleModel;
  readonly passes: readonly PassSpec[];
  /** Output-sized RGBA32F: rgb + clip depth, alpha 1.0 = no flesh. */
  readonly output: THREE.RenderTarget;
  readonly inSize: { width: number; height: number };
  readonly outSize: { width: number; height: number };
  /** The render target a pass writes (feature MRT, or `output`; the network output target while
   *  the sharpen pass is on). */
  targetFor(passName: string): THREE.RenderTarget;
  /** Post-sharpen strength 0..1 (UPSCALE_SHARPEN_WGSL). 0 = the pass does not run and the network
   *  writes `output` directly (bit-identical to before the pass existed). */
  setSharpen(strength: number): void;
  readonly sharpen: number;
  /** 'cas' (adaptive, clamped, strength 0..1) or 'unsharp' (plain 3x3 unsharp mask, no clamp,
   *  strength = amount 0..4). */
  setSharpenMode(mode: 'cas' | 'unsharp'): void;
  readonly sharpenMode: 'cas' | 'unsharp';
  setSize(inW: number, inH: number, outW: number, outH: number): void;
  render(renderer: THREE.WebGPURenderer, quadCam: THREE.Camera, camera: THREE.Camera): void;
  dispose(): void;
}

export interface UpscaleInfo {
  on: boolean;
  model: UpscaleModelId | null;
  layout: UpscaleLayout | null;
  inputs: UpscaleInputSet | null;
  seed: number | null;
  weightHash: string | null;
  /** 'trained' for loaded weights, 'random' for seeded cost/parity weights. */
  source: UpscaleModelSource | null;
  run: string | null;
  step: number | null;
  passes: string[];
  /** Run-4 full-res head present. */
  head: boolean;
  /** Which channel set the head's first layer reads; null when there is no stage. */
  headInputs: HeadInputs | null;
  /** Post-sharpen strength (0 = off). */
  sharpen: number;
  sharpenMode: 'cas' | 'unsharp';
  inSize: { width: number; height: number } | null;
  outSize: { width: number; height: number } | null;
}

export function upscaleInfoOf(stage: UpscaleStage | null): UpscaleInfo {
  if (!stage) {
    return {
      on: false, model: null, layout: null, inputs: null, seed: null, weightHash: null,
      source: null, run: null, step: null, passes: [], head: false, headInputs: null, sharpen: 0, sharpenMode: 'cas', inSize: null, outSize: null,
    };
  }
  return {
    on: true,
    model: stage.config.model,
    layout: stage.config.layout,
    inputs: stage.config.inputs,
    seed: stage.config.seed,
    weightHash: stage.model.weightHash,
    source: stage.model.source ?? 'random',
    run: stage.model.run ?? null,
    step: stage.model.step ?? null,
    passes: stage.passes.map((p) => p.name),
    head: !!stage.model.head,
    headInputs: stage.model.headInputs ?? null,
    sharpen: stage.sharpen,
    sharpenMode: stage.sharpenMode,
    inSize: { ...stage.inSize },
    outSize: { ...stage.outSize },
  };
}

type Built = { spec: PassSpec; target: THREE.RenderTarget; scene: THREE.Scene; mesh: THREE.Mesh; material: THREE.MeshBasicNodeMaterial };

/** The two output-res refine attachments the 'detail+refine' head reads (sdf-layer `refineTarget`:
 *  texture 1 = world normal, texture 0 = re-lit rgb with clip depth in w). */
export type UpscaleRefineTextures = { n: THREE.Texture; c: THREE.Texture };

/**
 * @param marchTexture the march target's texture (a stable object; resizing the
 *   target does not replace it).
 * @param flipY the layer's shared flipY uniform node (sdf-layer.ts `uFlipY`).
 * @param trained weights from parseUpscaleModelJson; absent = seeded random weights from `config`.
 *   Its id and inputs must match `config`.
 * @param refine the output-res refine attachments, required by a 'detail+refine' head model.
 */
export function createUpscaleStage(
  config: UpscaleConfig, marchTexture: THREE.Texture, flipY: unknown, trained?: UpscaleModel,
  normalTexture?: THREE.Texture, detailTexture?: THREE.Texture, refine?: UpscaleRefineTextures,
): UpscaleStage {
  if (trained && (trained.id !== config.model || trained.inputs !== config.inputs)) {
    throw new Error(`upscale: model ${trained.id}/${trained.inputs} does not match config ${config.model}/${config.inputs}`);
  }
  if (inputsUseNormals(config.inputs) && !normalTexture) {
    throw new Error(`upscale: input set ${config.inputs} needs the march normal texture (boot with ?upscale so the layer allocates it)`);
  }
  const model = trained ?? createUpscaleModel(config.model, config.inputs, config.seed, config.head === true, config.headInputs);
  if (model.head && !detailTexture) {
    throw new Error('upscale: this model has a run-4 head and needs the detail field texture (normals boot: ?upscalenormals=1 or an rgbn model)');
  }
  if (model.headInputs === 'detail+refine' && !refine) {
    throw new Error('upscale: this model has a refine head (headInputs detail+refine) and needs the refine textures (boot with ?refine=1)');
  }
  const passes = planUpscalePasses(model, config.layout);
  const uNearFar = uniform(new THREE.Vector2(0.1, 100));
  const uOutSize = uniform(new THREE.Vector2(1, 1));
  const reconstructNode = wgslFn(UPSCALE_RECONSTRUCT_WGSL);
  const inSize = { width: 1, height: 1 };
  const outSize = { width: 1, height: 1 };

  const output = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });

  // Sharpen: the network writes `netOut` and the sharpen pass writes `output` while on; off, the
  // network writes `output` directly, so strength 0 costs nothing and keeps parity exact.
  let sharpen = 0;
  let sharpenMode: 'cas' | 'unsharp' = 'cas';
  const uSharpen = uniform(0);
  const uSharpenMode = uniform(0);
  const netOut = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
  });
  const sharpenMat = new THREE.MeshBasicNodeMaterial();
  sharpenMat.depthTest = false; sharpenMat.depthWrite = false; sharpenMat.blending = THREE.NoBlending;
  {
    const out = wgslFn(UPSCALE_SHARPEN_WGSL)({ src: texture(netOut.texture), texCoord: uv(), flipY, strength: uSharpen, mode: uSharpenMode } as never) as unknown as { xyz: unknown; w: unknown };
    sharpenMat.colorNode = vec4(out.xyz as never, out.w as never);
    sharpenMat.outputNode = vec4(out.xyz as never, out.w as never);
  }
  const sharpenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sharpenMat);
  sharpenMesh.frustumCulled = false;
  const sharpenScene = new THREE.Scene();
  sharpenScene.add(sharpenMesh);
  const fullResTarget = () => (sharpen > 0 ? netOut : output);

  const targets = new Map<string, THREE.RenderTarget>();
  const built: Built[] = [];
  const textureOf = (ref: string): THREE.Texture => {
    if (ref === 'march') return marchTexture;
    if (ref === 'normal') return normalTexture!;
    if (ref === 'detail') return detailTexture!;
    if (ref === 'refineN') return refine!.n;
    if (ref === 'refineC') return refine!.c;
    const [name, index] = ref.split(':');
    const t = targets.get(name!);
    if (!t) throw new Error(`upscale: pass input ${ref} is not produced by an earlier pass`);
    return t.textures[Number(index)]!;
  };

  for (const spec of passes) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = THREE.NoBlending;
    const args: Record<string, unknown> = { texCoord: uv(), flipY };
    spec.inputs.forEach((ref, k) => { args[spec.params[k]!] = texture(textureOf(ref)); });
    if (spec.usesNearFar) args.nearFar = uNearFar;
    if (spec.outputRes === 'full') args.outSize = uOutSize;

    let target: THREE.RenderTarget;
    if (spec.kind === 'conv' || spec.kind === 'head1') {
      target = new THREE.RenderTarget(1, 1, { count: spec.targets, depthBuffer: false });
      target.textures.forEach((tex, k) => {
        tex.name = `f${k}`;
        tex.format = THREE.RGBAFormat;
        tex.type = THREE.HalfFloatType;
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.NoColorSpace;
        tex.generateMipmaps = false;
      });
      const state = wgslFn(spec.state);
      // Includes are cast: three's types reject an inline node array (same runtime shape deferred-sdf.ts passes).
      const run = wgslFn(spec.run, [state] as never);
      // NOT `upRun${name}`: the cached TSL var becomes a module-scope
      // `var<private>` and WGSL shares one namespace with the generated
      // `fn upRun${name}` — the collision is a redeclaration and every pipeline
      // fails to compile (caught by scripts/upscale-smoke.mjs).
      const cached = (run(args as never) as unknown as { toVar: (n: string) => unknown }).toVar(`upCache${spec.name}`);
      const outs: Record<string, unknown> = {};
      spec.reads.forEach((src, k) => { outs[`f${k}`] = wgslFn(src, [state] as never)({ dep: cached as never }); });
      material.mrtNode = mrt(outs as never) as never;
    } else {
      // A full-res single-output pass: the FINAL one writes `output`; an intermediate one (the
      // placement under a run-4 head) gets its own rgba32f target so depth survives.
      target = spec.final ? output : new THREE.RenderTarget(1, 1, {
        type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
      });
      const run = wgslFn(spec.run, spec.kind === 'head2' ? [] as never : [reconstructNode] as never);
      const out = run(args as never) as unknown as { xyz: unknown; w: unknown };
      material.colorNode = vec4(out.xyz as never, out.w as never);
      material.outputNode = vec4(out.xyz as never, out.w as never);
    }
    targets.set(spec.name, target);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    built.push({ spec, target, scene, mesh, material });
  }

  return {
    config: { ...config },
    model,
    passes,
    output,
    get inSize() { return inSize; },
    get outSize() { return outSize; },
    targetFor(passName) {
      const t = targets.get(passName);
      if (!t) throw new Error(`upscale: no pass named ${passName}`);
      return t === output ? fullResTarget() : t;
    },
    setSharpen(strength) {
      sharpen = Math.max(0, Math.min(4, Number.isFinite(strength) ? strength : 0));
      (uSharpen.value as number) = sharpen;
    },
    get sharpen() { return sharpen; },
    setSharpenMode(mode) {
      sharpenMode = mode === 'unsharp' ? 'unsharp' : 'cas';
      (uSharpenMode.value as number) = sharpenMode === 'unsharp' ? 1 : 0;
    },
    get sharpenMode() { return sharpenMode; },
    setSize(inW, inH, outW, outH) {
      inSize.width = inW; inSize.height = inH;
      outSize.width = outW; outSize.height = outH;
      for (const b of built) {
        if (b.target === output) continue;
        if (b.spec.outputRes === 'low') b.target.setSize(inW, inH); else b.target.setSize(outW, outH);
      }
      output.setSize(outW, outH);
      netOut.setSize(outW, outH);
      (uOutSize.value as THREE.Vector2).set(outW, outH);
    },
    render(renderer, quadCam, camera) {
      const cam = camera as THREE.PerspectiveCamera;
      (uNearFar.value as THREE.Vector2).set(cam.near, cam.far);
      const previous = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      // Every pass writes every pixel (no discard), so a clear would be wasted work.
      renderer.autoClear = false;
      for (const b of built) {
        setPassLabel(`sdf:upscale:${b.spec.name}`);
        renderer.setRenderTarget(b.target === output ? fullResTarget() : b.target);
        void renderer.render(b.scene, quadCam);
      }
      if (sharpen > 0) {
        setPassLabel('sdf:upscale:sharpen');
        renderer.setRenderTarget(output);
        void renderer.render(sharpenScene, quadCam);
      }
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(previous);
    },
    dispose() {
      for (const b of built) {
        b.mesh.geometry.dispose();
        b.material.dispose();
        if (b.target !== output) b.target.dispose();
      }
      output.dispose();
      netOut.dispose();
      sharpenMesh.geometry.dispose();
      sharpenMat.dispose();
    },
  };
}
