// scripts/lib/dawn-bake.ts
//
// The GPU body-normal bake: src/lab/sdf-zombie/body-normal-bake/bake.wgsl.ts `bakeMain` through Dawn (dawn-field.ts
// has the device and its gotchas). Spec: docs/superpowers/specs/2026-10-24-gpu-body-normal-bake-design.md.
//
// The split of work keeps one implementation of everything but the field: the CPU does the per-row prim cull
// (regions.ts nearList), the ray origins and directions (frame.ts) and the texel encode (frame.ts writeTexel); the
// GPU marches the plain and detailed skins and takes their gradients. A region's rows go in chunks, one submit each,
// so no single command buffer runs long enough to trip a GPU watchdog.
import { bakeShaderSource } from '../../src/lab/sdf-zombie/body-normal-bake/bake.wgsl';
import { packBakeBody } from '../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { colAngle, rayDir, regionFrame, rowAxisPoint, writeFlat, writeTexel, type V } from '../../src/lab/sdf-zombie/body-normal-bake/frame';
import { nearList, type Body, type Region } from '../../src/lab/sdf-zombie/body-normal-bake/regions';
import { compile, type DawnGpu } from './dawn-field';

const ROWS_PER_SUBMIT = 8;

export class GpuBaker {
  private constructor(
    private readonly gpu: DawnGpu,
    private readonly pipeline: GPUComputePipeline,
    private readonly textures: [GPUTexture, GPUTexture],
    private readonly base: Body,
    private readonly detail: Body,
  ) {}

  /** `source` overrides the shader module (debugging, A/B); default bakeShaderSource(). */
  static async create(gpu: DawnGpu, base: Body, detail: Body, source = bakeShaderSource()): Promise<GpuBaker> {
    const { device } = gpu;
    const upload = (body: Body): GPUTexture => {
      const packed = packBakeBody(body);
      const max = device.limits.maxTextureDimension2D;
      if (packed.width > max) throw new Error(`bake: ${packed.width} prims exceed this adapter's ${max}-texel texture`);
      const tex = device.createTexture({ size: [packed.width, packed.height], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: tex }, packed.texels, { bytesPerRow: packed.width * 16, rowsPerImage: packed.height }, [packed.width, packed.height]);
      return tex;
    };
    const pipeline = await compile(device, source, 'bakeMain');
    return new GpuBaker(gpu, pipeline, [upload(base), upload(detail)], base, detail);
  }

  /** Bake region R's band into `rgba` (`width` wide), exactly as cpu-bake.ts bakeRegionCpu does. Returns how many
   *  texels hit the plain skin. `hits`, when given (one byte per image texel), is set to 1 where the plain skin was
   *  hit: the bytes cannot say, since a hit with no detail encodes exactly the flat (128, 128, 255) a miss writes. */
  async bakeRegion(rgba: Uint8Array, width: number, R: Region, hits?: Uint8Array): Promise<number> {
    const { device } = this.gpu;
    const F = regionFrame(R.head, R.tail);
    // Per row: the axis point and the two prim lists, from the same functions the CPU bake uses.
    const rowsIn = new Float32Array(R.rows * 4), rowLists = new Uint32Array(R.rows * 4), list: number[] = [];
    for (let row = 0; row < R.rows; row++) {
      const P = rowAxisPoint(R.head, R.tail, row, R.rows);
      rowsIn.set(P, row * 4);
      const lb = nearList(this.base, R.limb, P, R.r0), ld = nearList(this.detail, R.limb, P, R.r0);
      rowLists.set([list.length, lb.length, list.length + lb.length, ld.length], row * 4);
      list.push(...lb, ...ld);
    }
    const ths: number[] = [], cols = new Float32Array(width * 4);
    for (let col = 0; col < width; col++) { ths.push(colAngle(col, width)); cols.set(rayDir(F, ths[col]!), col * 4); }

    const buf = (data: ArrayBufferView, usage: number) => {
      const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(b, 0, data as BufferSource);
      return b;
    };
    const S = GPUBufferUsage.STORAGE;
    const listBuf = buf(Uint32Array.from(list), S), rowsBuf = buf(rowsIn, S), rowListBuf = buf(rowLists, S), colsBuf = buf(cols, S);
    const chunkTexels = width * ROWS_PER_SUBMIT;
    const outBuf = device.createBuffer({ size: chunkTexels * 32, usage: S | GPUBufferUsage.COPY_SRC });
    const readBuf = device.createBuffer({ size: chunkTexels * 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const cfgBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cfgFBuf = buf(new Float32Array([R.r0, 0, 0, 0]), GPUBufferUsage.UNIFORM);
    const bind = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures[0].createView() }, { binding: 1, resource: this.textures[1].createView() },
        { binding: 2, resource: { buffer: listBuf } }, { binding: 3, resource: { buffer: rowsBuf } },
        { binding: 4, resource: { buffer: rowListBuf } }, { binding: 5, resource: { buffer: colsBuf } },
        { binding: 6, resource: { buffer: outBuf } }, { binding: 7, resource: { buffer: cfgBuf } }, { binding: 8, resource: { buffer: cfgFBuf } },
      ],
    });
    let covered = 0;
    for (let row0 = 0; row0 < R.rows; row0 += ROWS_PER_SUBMIT) {
      const n = Math.min(ROWS_PER_SUBMIT, R.rows - row0);
      device.queue.writeBuffer(cfgBuf, 0, new Uint32Array([width, row0, n, 0]));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(width * n / 64));
      pass.end();
      enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, width * n * 32);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ, 0, width * n * 32);
      const out = new Float32Array(readBuf.getMappedRange(0, width * n * 32).slice(0));
      readBuf.unmap();
      for (let r = 0; r < n; r++) for (let col = 0; col < width; col++) {
        const k = (r * width + col) * 8;
        const o = ((R.row0 + row0 + r) * width + col) * 4;
        writeFlat(rgba, o);
        if (out[k + 3]! < 0.5) continue;
        const nb: V = [out[k]!, out[k + 1]!, out[k + 2]!], nd: V = [out[k + 4]!, out[k + 5]!, out[k + 6]!];
        writeTexel(rgba, o, F, ths[col]!, nb, nd);
        if (hits) hits[o / 4] = 1;
        covered++;
      }
    }
    for (const b of [listBuf, rowsBuf, rowListBuf, colsBuf, outBuf, readBuf, cfgBuf, cfgFBuf]) b.destroy();
    return covered;
  }

  destroy(): void { for (const t of this.textures) t.destroy(); }
}
