/**
 * NEURAL UPSCALE — in-page GPU vs CPU-twin comparison (spec gate G1-parity).
 * Float readbacks stay in the page; only statistics cross CDP.
 *
 * PRECONDITION: the caller froze the simulation and turned the render lock on
 * (__sdfGame.freeze(true); __sdfGame.setRenderLock(true)), so re-rendering does
 * not change the march target. `marchStable` in the result verifies it.
 */
import type * as THREE from 'three/webgpu';
import type { SdfLayer } from '../sdf-layer';
import type { UpscaleLayout } from './upscale-model';
import { upscaleReference, type FloatImage } from './upscale-reference';

export interface SelfCheckDeps {
  renderer: THREE.WebGPURenderer;
  layer: SdfLayer;
  camera: THREE.PerspectiveCamera;
  renderFrames: (n: number) => void;
  resolveGpu: () => Promise<unknown>;
}

export interface LayoutCheck {
  layout: UpscaleLayout;
  pixels: number;
  covered: number;
  /** max over covered-in-both pixels and rgb channels of |gpu - cpu| / max(1, |cpu|) */
  maxRelRgb: number;
  coverageMismatch: number;
  /** coverage mismatches whose CPU decision sits outside ±band of the threshold */
  coverageMismatchFar: number;
  depthMismatch: number;
}

export interface SelfCheckResult {
  model: string;
  inputs: string;
  seed: number;
  weightHash: string;
  marchSize: { width: number; height: number };
  marchStable: boolean;
  gpuVsCpu: LayoutCheck[];
  layouts: { pixels: number; bothCovered: number; maxRelRgb: number; coverageMismatch: number } | null;
  ms: number;
}

export const COVERAGE_BAND = 4e-3;

/** RGBA32F render-target readback with WebGPU row padding removed; row 0 = texel row 0. */
export async function readFloatTarget(renderer: THREE.WebGPURenderer, rt: THREE.RenderTarget): Promise<FloatImage> {
  const w = rt.width;
  const h = rt.height;
  const raw = new Float32Array(await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h) as unknown as ArrayLike<number>);
  const stride = Math.ceil((w * 16) / 256) * 64;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
  return { w, h, c: 4, data };
}

function sameImage(a: FloatImage, b: FloatImage): boolean {
  if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length) return false;
  for (let k = 0; k < a.data.length; k++) if (a.data[k] !== b.data[k]) return false;
  return true;
}

function compare(gpu: FloatImage, cpu: FloatImage, margin: Float32Array, layout: UpscaleLayout): LayoutCheck {
  const pixels = gpu.w * gpu.h;
  let covered = 0, maxRelRgb = 0, coverageMismatch = 0, coverageMismatchFar = 0, depthMismatch = 0;
  for (let p = 0; p < pixels; p++) {
    const b = p * 4;
    const gc = gpu.data[b + 3]! < 1;
    const cc = cpu.data[b + 3]! < 1;
    if (gc !== cc) {
      coverageMismatch++;
      if (Math.abs(margin[p]!) > COVERAGE_BAND) coverageMismatchFar++;
      continue;
    }
    if (!gc) continue;
    covered++;
    if (gpu.data[b + 3] !== cpu.data[b + 3]) depthMismatch++;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(gpu.data[b + c]! - cpu.data[b + c]!) / Math.max(1, Math.abs(cpu.data[b + c]!));
      if (d > maxRelRgb) maxRelRgb = d;
    }
  }
  return { layout, pixels, covered, maxRelRgb, coverageMismatch, coverageMismatchFar, depthMismatch };
}

function compareOutputs(a: FloatImage, b: FloatImage) {
  const pixels = a.w * a.h;
  let bothCovered = 0, maxRelRgb = 0, coverageMismatch = 0;
  for (let p = 0; p < pixels; p++) {
    const k = p * 4;
    const ac = a.data[k + 3]! < 1;
    const bc = b.data[k + 3]! < 1;
    if (ac !== bc) { coverageMismatch++; continue; }
    if (!ac) continue;
    bothCovered++;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[k + c]! - b.data[k + c]!) / Math.max(1, Math.abs(b.data[k + c]!));
      if (d > maxRelRgb) maxRelRgb = d;
    }
  }
  return { pixels, bothCovered, maxRelRgb, coverageMismatch };
}

export async function runUpscaleSelfCheck(deps: SelfCheckDeps, opts: { compareLayouts?: boolean } = {}): Promise<SelfCheckResult> {
  const t0 = performance.now();
  const initial = deps.layer.upscaleStage;
  if (!initial) throw new Error('upscaleSelfCheck: the upscale stage is off — call __sdfGame.setUpscale first');
  const original = { ...initial.config };
  // REACH THE STEADY STAGE BEFORE MEASURING. Enabling the stage, and (once) its
  // first re-creation, each perturb the march target — a localized change in
  // ~1% of the texels that is stable afterwards under the render lock. Settle
  // both here so the two layouts are read on the SAME march; without this the
  // first layout is measured one stage-generation earlier than the second.
  deps.renderFrames(4);
  deps.layer.setUpscale(original);
  deps.renderFrames(8);
  const layouts: UpscaleLayout[] = opts.compareLayouts ? ['sp', 'dc'] : [original.layout];
  const outputs = new Map<UpscaleLayout, FloatImage>();
  const gpuVsCpu: LayoutCheck[] = [];
  let marchRef: FloatImage | null = null;
  let marchStable = true;
  for (const layout of layouts) {
    if (deps.layer.upscaleStage!.config.layout !== layout) deps.layer.setUpscale({ ...original, layout });
    // A new stage compiles its pipelines on first use: render several frames, measure the last.
    deps.renderFrames(8);
    await deps.resolveGpu();
    const stage = deps.layer.upscaleStage!;
    const march = await readFloatTarget(deps.renderer, deps.layer.marchTarget);
    const gpu = await readFloatTarget(deps.renderer, stage.output);
    if (marchRef) marchStable = marchStable && sameImage(marchRef, march);
    else marchRef = march;
    const margin = new Float32Array(gpu.w * gpu.h);
    const cpu = upscaleReference(march, stage.model, layout, deps.camera.near, deps.camera.far, gpu.w, gpu.h, {
      halfFloatStorage: true,
      marginOut: margin,
    });
    gpuVsCpu.push(compare(gpu, cpu, margin, layout));
    outputs.set(layout, gpu);
  }
  if (deps.layer.upscaleStage!.config.layout !== original.layout) deps.layer.setUpscale(original);
  const s = deps.layer.upscaleStage!;
  return {
    model: s.config.model,
    inputs: s.config.inputs,
    seed: s.config.seed,
    weightHash: s.model.weightHash,
    marchSize: { width: marchRef!.w, height: marchRef!.h },
    marchStable,
    gpuVsCpu,
    layouts: opts.compareLayouts ? compareOutputs(outputs.get('sp')!, outputs.get('dc')!) : null,
    ms: performance.now() - t0,
  };
}
