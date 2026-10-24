// Dawn-in-Node probe: adapter info, then a tiny SDF compute kernel checked against the same field in JS.
import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);
const gpu = create(process.env.DAWN_FLAGS ? process.env.DAWN_FLAGS.split(' ') : []);
const adapter = await gpu.requestAdapter();
if (!adapter) { console.error('PROBE: no adapter'); process.exit(1); }
const info = adapter.info ?? {};
console.log('PROBE adapter', JSON.stringify({ vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }));
const device = await adapter.requestDevice();
const N = 1 << 16;
const code = /* wgsl */`
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
fn capsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
@group(0) @binding(0) var<storage, read> pts: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outD: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= arrayLength(&outD)) { return; }
  let p = pts[i].xyz;
  var d = capsule(p, vec3f(0.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), 0.2);
  d = smin(d, capsule(p, vec3f(-0.3, 0.8, 0.0), vec3f(0.3, 0.8, 0.1), 0.08), 0.05);
  outD[i] = d;
}`;
const mod = device.createShaderModule({ code });
const ci = await mod.getCompilationInfo();
for (const m of ci.messages) console.log('PROBE wgsl', m.type, m.message);
const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
const pts = new Float32Array(N * 4);
for (let i = 0; i < N; i++) { pts[i * 4] = Math.random() - 0.5; pts[i * 4 + 1] = Math.random() * 1.4 - 0.2; pts[i * 4 + 2] = Math.random() - 0.5; }
const bp = device.createBuffer({ size: pts.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(bp, 0, pts);
const bo = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
const br = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bp } }, { binding: 1, resource: { buffer: bo } }] });
const t0 = performance.now();
const enc = device.createCommandEncoder();
const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(N / 64); pass.end();
enc.copyBufferToBuffer(bo, 0, br, 0, N * 4);
device.queue.submit([enc.finish()]);
await br.mapAsync(GPUMapMode.READ);
const got = new Float32Array(br.getMappedRange().slice(0));
const ms = performance.now() - t0;
const smin = (a, b, k) => { const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };
const cap = (p, a, b, r) => { const pa = p.map((v, j) => v - a[j]), ba = b.map((v, j) => v - a[j]); const h = Math.min(1, Math.max(0, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2))); return Math.hypot(...pa.map((v, j) => v - ba[j] * h)) - r; };
let maxErr = 0;
for (let i = 0; i < N; i++) {
  const p = [pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2]];
  const d = smin(cap(p, [0, 0, 0], [0, 1, 0], 0.2), cap(p, [-0.3, 0.8, 0], [0.3, 0.8, 0.1], 0.08), 0.05);
  maxErr = Math.max(maxErr, Math.abs(d - got[i]));
}
console.log(`PROBE ${N} points, ${ms.toFixed(1)} ms, max |gpu - cpu| = ${maxErr.toExponential(2)}`);
device.destroy();
process.exit(maxErr < 1e-5 ? 0 : 1);
