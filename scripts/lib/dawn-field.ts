// scripts/lib/dawn-field.ts
//
// WebGPU from Node through Dawn (the `webgpu` npm package), and the bake field (src/lab/sdf-zombie/body-normal-bake/
// bake.wgsl.ts) evaluated at points on it. Spec: docs/superpowers/specs/2026-10-24-gpu-body-normal-bake-design.md.
//
// Lives under scripts/ because it loads a native module: nothing under src/ may (the app typecheck and the browser
// build). On a GitHub runner the adapter is Mesa's llvmpipe through Vulkan (`apt install mesa-vulkan-drivers`); on a
// Mac it is Metal.
import { fieldShaderSource } from '../../src/lab/sdf-zombie/body-normal-bake/bake.wgsl';
import type { BakePacked } from '../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';

export interface DawnGpu { device: GPUDevice; adapter: string }

/** The GPU instance MUST outlive every device made from it: dawn.node 0.6.2 frees the instance when it is garbage
 *  collected, and the next callback into it (a mapAsync, a pipeline compile) segfaults the process (exit 139). */
let instance: GPU | null = null;

/** A device, or null when this machine has no WebGPU adapter (no GPU, no driver, or no prebuilt dawn.node). */
export async function dawnDevice(): Promise<DawnGpu | null> {
  let mod: typeof import('webgpu');
  try { mod = await import('webgpu'); } catch { return null; }
  Object.assign(globalThis, mod.globals);
  instance ??= mod.create([]);
  const adapter = await instance.requestAdapter();
  if (!adapter) return null;
  const i = adapter.info;
  const device = await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } });
  return { device, adapter: `${i.vendor} ${i.architecture} ${i.device} (${i.description})`.trim() };
}

/** Compile WGSL, failing with every compiler message rather than a bare pipeline error. */
async function compile(device: GPUDevice, code: string, entryPoint: string): Promise<GPUComputePipeline> {
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(m => m.type === 'error');
  if (errors.length) {
    const lines = code.split('\n');
    throw new Error(errors.map(m => `WGSL ${m.lineNum}:${m.linePos} ${m.message}\n  ${lines[m.lineNum - 1] ?? ''}`).join('\n'));
  }
  return device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } });
}

/** One packed body on the GPU; evaluate() runs bakeField at points. */
export class GpuField {
  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    private readonly texture: GPUTexture,
    private readonly listBuf: GPUBuffer,
    readonly listLength: number,
  ) {}

  static async create(gpu: DawnGpu, packed: BakePacked): Promise<GpuField> {
    const { device } = gpu;
    const max = device.limits.maxTextureDimension2D;
    if (packed.width > max) throw new Error(`bake field: ${packed.width} prims exceed this adapter's ${max}-texel texture`);
    const texture = device.createTexture({
      size: [packed.width, packed.height], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture }, packed.texels, { bytesPerRow: packed.width * 16, rowsPerImage: packed.height }, [packed.width, packed.height]);
    const listBuf = device.createBuffer({ size: Math.max(16, packed.list.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(listBuf, 0, packed.list);
    return new GpuField(device, await compile(device, fieldShaderSource(), 'fieldMain'), texture, listBuf, packed.list.length);
  }

  /** bakeField at each point (xyz triples) over list entries [off, off + n) (default: the whole list). */
  async evaluate(points: Float32Array, off = 0, n = this.listLength): Promise<Float32Array> {
    const { device } = this;
    const count = points.length / 3;
    const pts4 = new Float32Array(Math.max(1, count) * 4);
    for (let j = 0; j < count; j++) pts4.set(points.subarray(j * 3, j * 3 + 3), j * 4);
    const ptsBuf = device.createBuffer({ size: pts4.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ptsBuf, 0, pts4);
    const outBuf = device.createBuffer({ size: Math.max(16, count * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readBuf = device.createBuffer({ size: Math.max(16, count * 4), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const cfgBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(cfgBuf, 0, new Uint32Array([off, n, count, 0]));
    const bind = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: { buffer: this.listBuf } },
        { binding: 2, resource: { buffer: ptsBuf } },
        { binding: 3, resource: { buffer: outBuf } },
        { binding: 4, resource: { buffer: cfgBuf } },
      ],
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, Math.max(16, count * 4));
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readBuf.getMappedRange().slice(0, count * 4));
    readBuf.unmap();
    for (const b of [ptsBuf, outBuf, readBuf, cfgBuf]) b.destroy();
    return out;
  }

  destroy(): void { this.texture.destroy(); this.listBuf.destroy(); }
}
