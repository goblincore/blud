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
  type UpscaleModel, type UpscaleModelId, type UpscaleModelSource,
} from './upscale-model';
import { planUpscalePasses, UPSCALE_RECONSTRUCT_WGSL, type PassSpec } from './upscale-wgsl';

export interface UpscaleStage {
  readonly config: UpscaleConfig;
  readonly model: UpscaleModel;
  readonly passes: readonly PassSpec[];
  /** Output-sized RGBA32F: rgb + clip depth, alpha 1.0 = no flesh. */
  readonly output: THREE.RenderTarget;
  readonly inSize: { width: number; height: number };
  readonly outSize: { width: number; height: number };
  /** The render target a pass writes (feature MRT, or `output`). */
  targetFor(passName: string): THREE.RenderTarget;
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
  inSize: { width: number; height: number } | null;
  outSize: { width: number; height: number } | null;
}

export function upscaleInfoOf(stage: UpscaleStage | null): UpscaleInfo {
  if (!stage) {
    return {
      on: false, model: null, layout: null, inputs: null, seed: null, weightHash: null,
      source: null, run: null, step: null, passes: [], inSize: null, outSize: null,
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
    inSize: { ...stage.inSize },
    outSize: { ...stage.outSize },
  };
}

type Built = { spec: PassSpec; target: THREE.RenderTarget; scene: THREE.Scene; mesh: THREE.Mesh; material: THREE.MeshBasicNodeMaterial };

/**
 * @param marchTexture the march target's texture (a stable object; resizing the
 *   target does not replace it).
 * @param flipY the layer's shared flipY uniform node (sdf-layer.ts `uFlipY`).
 * @param trained weights from parseUpscaleModelJson; absent = seeded random weights from `config`.
 *   Its id and inputs must match `config`.
 */
export function createUpscaleStage(
  config: UpscaleConfig, marchTexture: THREE.Texture, flipY: unknown, trained?: UpscaleModel,
): UpscaleStage {
  if (trained && (trained.id !== config.model || trained.inputs !== config.inputs)) {
    throw new Error(`upscale: model ${trained.id}/${trained.inputs} does not match config ${config.model}/${config.inputs}`);
  }
  const model = trained ?? createUpscaleModel(config.model, config.inputs, config.seed);
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

  const targets = new Map<string, THREE.RenderTarget>();
  const built: Built[] = [];
  const textureOf = (ref: string): THREE.Texture => {
    if (ref === 'march') return marchTexture;
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
    if (spec.kind === 'conv') {
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
      target = output;
      const run = wgslFn(spec.run, [reconstructNode] as never);
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
      return t;
    },
    setSize(inW, inH, outW, outH) {
      inSize.width = inW; inSize.height = inH;
      outSize.width = outW; outSize.height = outH;
      for (const b of built) if (b.spec.outputRes === 'low') b.target.setSize(inW, inH);
      output.setSize(outW, outH);
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
        renderer.setRenderTarget(b.target);
        void renderer.render(b.scene, quadCam);
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
    },
  };
}
