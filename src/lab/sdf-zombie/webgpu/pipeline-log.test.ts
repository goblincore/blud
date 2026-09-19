import { describe, expect, it } from 'vitest';
import {
  hashText,
  pipelineDescriptorSignature,
  vertexBuffersSignature,
  targetsSignature,
  depthStencilSignature,
  wgslFingerprint,
  type ShaderModuleHashes,
  type PipelineLayoutHashes,
} from './pipeline-log';

// CORRECTED PIPELINE ATTRIBUTION (2026-09-16 reviewer follow-up).
//
// The pre-2026-09-16 detector compared only topology/cull/frontFace, a few
// depth/stencil scalars, multisample count, colour-target FORMATS and entry
// points. It could not tell two genuinely different pipelines apart — so its
// "byte-identical descriptors, therefore pipeline-cache churn" conclusion was
// unfounded. These tests pin the replacement: the full descriptor signature
// must differ whenever a shader, a layout, a blend mode, a write mask, a
// vertex-buffer format or a stencil op differs, and must be stable for genuinely
// identical descriptors.

/** The retired partial signature, kept ONLY here so the collision it caused is
 *  an executable fact rather than a claim in a doc. */
function legacySignature(desc: any): string {
  const d = desc ?? {};
  const p = d.primitive ?? {};
  const ds = d.depthStencil ?? {};
  const ms = d.multisample ?? {};
  const targets = (d.fragment?.targets ?? []).map((t: any) => t?.format ?? '-').join('|');
  return [
    p.topology, p.cullMode, p.frontFace,
    ds.format, ds.depthWriteEnabled, ds.depthCompare, ds.depthBias, ds.depthBiasSlopeScale,
    ms.count,
    targets,
    d.fragment?.entryPoint, d.vertex?.entryPoint,
  ].join(',');
}

const mods = () => {
  const m: ShaderModuleHashes = new WeakMap();
  const layouts: PipelineLayoutHashes = new WeakMap();
  const v = {} as object;
  const f = {} as object;
  const l = {} as object;
  m.set(v, 'vertex-A');
  m.set(f, 'fragment-A');
  layouts.set(l, 'layout-A');
  return { m, layouts, v, f, l };
};

function baseDesc() {
  const { m, layouts, v, f, l } = mods();
  return {
    desc: {
      label: 'renderPipeline_MeshStandardMaterial_7',
      layout: l,
      vertex: { entryPoint: 'main', module: v, buffers: [{ arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: {
        entryPoint: 'main', module: f,
        targets: [{ format: 'rgba16float', writeMask: 15, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      multisample: { count: 1 },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less', stencilFront: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' }, stencilReadMask: 0xff, stencilWriteMask: 0xff },
    },
    m, layouts, v, f, l,
  };
}

function sig(mutate: (d: any) => void): string {
  const { desc, m, layouts } = baseDesc();
  mutate(desc);
  return pipelineDescriptorSignature(desc, m, layouts);
}

describe('pipelineDescriptorSignature — full fidelity', () => {
  it('is stable for two genuinely identical descriptors', () => {
    const a = baseDesc();
    const b = baseDesc();
    // Different object identities throughout, same content hashes.
    expect(pipelineDescriptorSignature(a.desc, a.m, a.layouts))
      .toBe(pipelineDescriptorSignature(b.desc, b.m, b.layouts));
  });

  it('distinguishes SHADER CODE that the old signature collapsed', () => {
    const { desc, m, layouts } = baseDesc();
    const legacyBefore = legacySignature(desc);
    const before = pipelineDescriptorSignature(desc, m, layouts);
    // Same structural state, different vertex shader content (e.g. a different
    // light count / shadow variant emits different WGSL).
    const d2 = baseDesc();
    (d2.m as WeakMap<object, string>).set(d2.v, 'vertex-B');
    expect(legacySignature(d2.desc)).toBe(legacyBefore); // the old detector said "identical"
    expect(pipelineDescriptorSignature(d2.desc, d2.m, d2.layouts)).not.toBe(before);
  });

  it('distinguishes PIPELINE LAYOUTS the old signature ignored', () => {
    const a = baseDesc();
    const aSig = pipelineDescriptorSignature(a.desc, a.m, a.layouts);
    const b = baseDesc();
    (b.layouts as WeakMap<object, string>).set(b.l, 'layout-B-different-bindings');
    expect(legacySignature(b.desc)).toBe(legacySignature(a.desc));
    expect(pipelineDescriptorSignature(b.desc, b.m, b.layouts)).not.toBe(aSig);
  });

  it('distinguishes BLEND state the old signature ignored', () => {
    const a = baseDesc();
    const aSig = pipelineDescriptorSignature(a.desc, a.m, a.layouts);
    const b = baseDesc();
    (b.desc.fragment.targets[0] as any).blend.color.srcFactor = 'one';
    expect(legacySignature(b.desc)).toBe(legacySignature(a.desc));
    expect(pipelineDescriptorSignature(b.desc, b.m, b.layouts)).not.toBe(aSig);
  });

  it('distinguishes COLOUR WRITE MASKS the old signature ignored', () => {
    const a = baseDesc();
    const aSig = pipelineDescriptorSignature(a.desc, a.m, a.layouts);
    const b = baseDesc();
    b.desc.fragment.targets[0]!.writeMask = 7;
    expect(legacySignature(b.desc)).toBe(legacySignature(a.desc));
    expect(pipelineDescriptorSignature(b.desc, b.m, b.layouts)).not.toBe(aSig);
  });

  it('distinguishes VERTEX BUFFER FORMATS the old signature ignored', () => {
    const a = baseDesc();
    const aSig = pipelineDescriptorSignature(a.desc, a.m, a.layouts);
    const b = baseDesc();
    (b.desc.vertex.buffers[0]!.attributes[0] as any).format = 'float32x4';
    expect(legacySignature(b.desc)).toBe(legacySignature(a.desc));
    expect(pipelineDescriptorSignature(b.desc, b.m, b.layouts)).not.toBe(aSig);
  });

  it('distinguishes STENCIL OPS the old signature ignored', () => {
    const a = baseDesc();
    const aSig = pipelineDescriptorSignature(a.desc, a.m, a.layouts);
    const b = baseDesc();
    (b.desc.depthStencil.stencilFront as any).passOp = 'replace';
    expect(legacySignature(b.desc)).toBe(legacySignature(a.desc));
    expect(pipelineDescriptorSignature(b.desc, b.m, b.layouts)).not.toBe(aSig);
  });

  it('does NOT misclassify legitimate render-target / sample-count variants', () => {
    const hdr = sig(() => {});
    const ldr = sig((d) => { d.fragment.targets[0].format = 'bgra8unorm'; });
    const msaa = sig((d) => { d.multisample.count = 4; });
    const a2c = sig((d) => { d.multisample.alphaToCoverageEnabled = true; });
    expect(new Set([hdr, ldr, msaa, a2c]).size).toBe(4);
  });

  it('includes compute shader constants', () => {
    const { m, layouts, v } = mods();
    const d1 = { compute: { entryPoint: 'main', module: v, constants: { workgroupSize: 64 } } };
    const d2 = { compute: { entryPoint: 'main', module: v, constants: { workgroupSize: 128 } } };
    expect(pipelineDescriptorSignature(d1, m, layouts)).not.toBe(pipelineDescriptorSignature(d2, m, layouts));
  });
});

describe('signature component helpers', () => {
  it('vertexBuffersSignature names stride, step mode and attribute formats', () => {
    expect(vertexBuffersSignature([{ arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]))
      .toContain('12');
    expect(vertexBuffersSignature([{ arrayStride: 16, stepMode: 'instance', attributes: [] }])).toContain('i');
    expect(vertexBuffersSignature(undefined)).toBe('none');
  });

  it('targetsSignature names blend factors and write masks', () => {
    expect(targetsSignature([{ format: 'rgba16float', writeMask: 15, blend: { color: { operation: 'add', srcFactor: 'one', dstFactor: 'zero' } } }]))
      .toContain('add,one,zero');
    expect(targetsSignature([{ format: 'rgba16float', writeMask: 15 }])).toContain('noblend');
  });

  it('depthStencilSignature names both stencil faces', () => {
    const s = depthStencilSignature({ format: 'depth24plus', stencilFront: { passOp: 'replace' }, stencilBack: { passOp: 'keep' } });
    expect(s).toContain('F');
    expect(s).toContain('B');
    expect(s).toContain('replace');
    expect(depthStencilSignature(null)).toBe('none');
  });
});

describe('hashText', () => {
  it('is deterministic, length-suffixed and separates near-identical inputs', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('abc')).toMatch(/:3$/);
    expect(hashText('')).toMatch(/:0$/);
  });
});

// COMPILE CENSUS (2026-09-19). The fingerprint is what lets the census say
// WHICH march variant a huge compile was (include list / bindings), not just
// how big it was. These pin the three facts the Node-side analysis reads.
describe('wgslFingerprint', () => {
  const SRC = `
struct MarchOut { @location(0) color: vec4f, @location(1) depth: f32 };
@group(0) @binding(0) var<uniform> marchCfg: vec4f;
@group(0) @binding(1) var<uniform> noiseCfg: vec4f;
fn hash13(p: vec3f) -> f32 { return 0.0; }
fn noise3(p: vec3f) -> f32 { return hash13(p); }
fn marchBody(ray: vec3f) -> MarchOut { return MarchOut(vec4f(1.0), 0.0); }
`;

  it('reports bytes, sorted/deduped fn names and counts', () => {
    const f = wgslFingerprint(SRC);
    expect(f.bytes).toBe(SRC.length);
    expect(f.fns).toEqual(['hash13', 'marchBody', 'noise3']);
    expect(f.fnCount).toBe(3);
    expect(f.structs).toEqual(['MarchOut']);
    expect(f.structCount).toBe(1);
    expect(f.bindings).toBe(2);
    expect(f.locations).toBe(2);
  });

  it('caps the name lists without lying about the counts', () => {
    const f = wgslFingerprint(SRC, 1);
    expect(f.fns).toHaveLength(1);
    expect(f.fnCount).toBe(3);
    expect(f.structs).toHaveLength(1);
    expect(f.structCount).toBe(1);
  });

  it('is a stable identity for a variant: identical source, identical fingerprint', () => {
    expect(wgslFingerprint(SRC)).toEqual(wgslFingerprint(SRC));
  });

  it('separates two marchers whose include list differs', () => {
    const a = wgslFingerprint(SRC);
    const b = wgslFingerprint(SRC.replace('fn marchBody', 'fn sdfSurfaceMarch'));
    expect(b.fns).not.toContain('marchBody');
    expect(b.fns).toContain('sdfSurfaceMarch');
  });
});
