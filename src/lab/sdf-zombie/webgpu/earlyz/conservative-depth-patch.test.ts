// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { WGSLNodeBuilder } from 'three/webgpu';
import { float, vec4, positionLocal } from 'three/tsl';
import {
  installConservativeDepthPatch, conservativeDepthPatchHits, detectConservativeDepth,
  CONSERVATIVE_DEPTH_BUILTIN, EARLYZ_DETECT_WGSL,
} from './conservative-depth-patch';
import { applyConservativeDepth } from './conservative-depth-material';

function fakeProto() {
  return {
    material: null as null | Record<string, unknown>,
    calls: [] as string[],
    getBuiltin(name: string, property: string, ..._rest: string[]) { this.calls.push(name); return property; },
    getFragDepth() { return 'output.' + this.getBuiltin('frag_depth', 'depth', 'f32', 'output'); },
  };
}

describe('conservative depth patch (spec §4 A)', () => {
  it('emits the greater builtin only for an opted-in material', () => {
    const p = fakeProto();
    expect(installConservativeDepthPatch(p as never, '186')).toEqual({ installed: true, reason: null });
    const before = conservativeDepthPatchHits();
    p.material = { conservativeDepth: 'greater' };
    expect(p.getFragDepth()).toBe('output.depth');
    expect(p.calls.at(-1)).toBe(CONSERVATIVE_DEPTH_BUILTIN);
    expect(conservativeDepthPatchHits()).toBe(before + 1);
    p.material = {};
    p.getFragDepth();
    expect(p.calls.at(-1)).toBe('frag_depth');
  });
  it('refuses any three revision but 186 and leaves the prototype untouched', () => {
    const p = fakeProto();
    const original = p.getFragDepth;
    expect(installConservativeDepthPatch(p as never, '187')).toEqual({
      installed: false, reason: 'three r187; the patch is written for r186',
    });
    expect((p as { __earlyzPatched?: boolean }).__earlyzPatched).toBeUndefined();
    expect(p.getFragDepth).toBe(original);
  });
  it('is idempotent', () => {
    const p = fakeProto();
    installConservativeDepthPatch(p as never, '186');
    const patched = p.getFragDepth;
    installConservativeDepthPatch(p as never, '186');
    expect(p.getFragDepth).toBe(patched);
    p.material = { conservativeDepth: 'greater' };
    p.getFragDepth();
    expect(p.calls.filter((c) => c === CONSERVATIVE_DEPTH_BUILTIN).length).toBe(1);
  });
  it('against the real r186 builder the struct member reads @builtin( frag_depth, greater )', () => {
    expect(THREE.REVISION).toBe('186');
    expect(installConservativeDepthPatch().installed).toBe(true);
    const b = Object.create(WGSLNodeBuilder.prototype) as {
      builtins: Record<string, Map<string, unknown>>; shaderStage: string; material: unknown;
      getFragDepth(): string; getBuiltins(stage: string): string;
    };
    b.builtins = {};
    b.shaderStage = 'fragment';
    b.material = { conservativeDepth: 'greater' };
    expect(b.getFragDepth()).toBe('output.depth');
    expect(b.getBuiltins('output')).toBe('@builtin( frag_depth, greater ) depth : f32');
  });
});

/** Run a real MeshBasicNodeMaterial through three 0.186's real WGSL node builder (no GPU). */
function buildFragmentWgsl(opts: { optIn: boolean }): string {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec4(1, 0, 0, 1) as never;
  material.depthNode = float(0.5) as never;
  if (opts.optIn) applyConservativeDepth(material);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const stubCanvas = { getContext: () => null, addEventListener() { /* stub */ }, style: {}, width: 100, height: 100 };
  const renderer = new THREE.WebGPURenderer({ canvas: stubCanvas as unknown as HTMLCanvasElement });
  const builder = new WGSLNodeBuilder(mesh, renderer) as unknown as {
    scene: unknown; material: unknown; camera: unknown; context: { material: unknown };
    build(): unknown; fragmentShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.material = material;
  builder.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  builder.context.material = material;
  builder.build();
  return builder.fragmentShader;
}

describe('end to end through the real r186 node builder', () => {
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  it('an opted-in material emits frag_depth, greater once, clamped to the raster depth', () => {
    expect(installConservativeDepthPatch().installed).toBe(true);
    const before = conservativeDepthPatchHits();
    const frag = buildFragmentWgsl({ optIn: true });
    expect(conservativeDepthPatchHits()).toBeGreaterThan(before);
    expect(count(frag, '@builtin( frag_depth, greater )')).toBe(1);
    expect(frag).not.toMatch(/@builtin\( frag_depth \)/);
    const line = frag.split('\n').find((l) => l.includes('output.depth = max('));
    expect(line, 'output.depth = max( ... ) assignment').toBeDefined();
    // the max() operand is the raster-depth reconstruction from the interpolated view z
    expect(line).toContain('v_positionView.z');
    // and the right-hand side never reads the output member it is assigning
    expect(line!.slice(line!.indexOf('=') + 1)).not.toContain('output.depth');
  });
  it('an opted-out material still emits plain frag_depth', () => {
    expect(installConservativeDepthPatch().installed).toBe(true);
    const before = conservativeDepthPatchHits();
    const frag = buildFragmentWgsl({ optIn: false });
    expect(conservativeDepthPatchHits()).toBe(before);
    expect(count(frag, '@builtin( frag_depth )')).toBe(1);
    expect(frag).not.toContain('frag_depth, greater');
  });
});

describe('applyConservativeDepth', () => {
  it('refuses a material without a depth node (the wrapped node is pinned by Task 7)', () => {
    expect(() => applyConservativeDepth(new THREE.MeshBasicNodeMaterial())).toThrow(/no depthNode/);
  });
  it('refuses a material with a vertexNode (raster depth is not projection * positionView)', () => {
    const m = new THREE.MeshBasicNodeMaterial();
    m.depthNode = float(0.5) as never;
    m.vertexNode = vec4(positionLocal, 1) as never;
    const depthNode = m.depthNode;
    expect(() => applyConservativeDepth(m)).toThrow(/vertexNode/);
    expect(m.depthNode).toBe(depthNode);
    expect((m as unknown as { conservativeDepth?: string }).conservativeDepth).toBeUndefined();
  });
  it('wraps the depth node and sets the opt-in once; a second call is a no-op', () => {
    const m = new THREE.MeshBasicNodeMaterial();
    const original = float(0.5);
    m.depthNode = original as never;
    applyConservativeDepth(m);
    expect((m as unknown as { conservativeDepth?: string }).conservativeDepth).toBe('greater');
    const wrapped = m.depthNode;
    expect(wrapped).not.toBe(original);
    applyConservativeDepth(m);
    expect(m.depthNode).toBe(wrapped);
  });
});

interface FakeOpts {
  compileErr?: string; pipelineThrows?: string; scopeErr?: string;
  compileInfoRejects?: string; shaderModuleThrows?: string; popRejects?: string;
}

function fakeDevice(o: FakeOpts) {
  const scopes = { pushed: 0, popped: 0 };
  return {
    scopes,
    pushErrorScope() { scopes.pushed++; },
    popErrorScope: async () => {
      scopes.popped++;
      if (o.popRejects) throw new Error(o.popRejects);
      return o.scopeErr ? { message: o.scopeErr } : null;
    },
    createShaderModule: () => {
      if (o.shaderModuleThrows) throw new Error(o.shaderModuleThrows);
      return {
        getCompilationInfo: async () => {
          if (o.compileInfoRejects) throw new Error(o.compileInfoRejects);
          return { messages: o.compileErr ? [{ type: 'error', message: o.compileErr }] : [] };
        },
      };
    },
    createRenderPipelineAsync: async () => { if (o.pipelineThrows) throw new Error(o.pipelineThrows); return {}; },
  };
}

describe('detectConservativeDepth (spec D8)', () => {
  const cases: [string, FakeOpts, { ok: boolean; reason: string | null }][] = [
    ['ok when the probe compiles and the pipeline builds', {}, { ok: true, reason: null }],
    ['reports a compile error', { compileErr: 'unknown builtin' }, { ok: false, reason: 'compile: unknown builtin' }],
    ['reports a pipeline rejection', { pipelineThrows: 'bad depth' }, { ok: false, reason: 'pipeline: bad depth' }],
    ['reports a validation-scope error', { scopeErr: 'invalid' }, { ok: false, reason: 'validation: invalid' }],
    ['reports getCompilationInfo rejecting', { compileInfoRejects: 'lost' }, { ok: false, reason: 'threw: Error: lost' }],
    ['reports createShaderModule throwing', { shaderModuleThrows: 'no module' }, { ok: false, reason: 'threw: Error: no module' }],
  ];
  for (const [name, opts, expected] of cases) {
    it(name + ' and leaves the error scope balanced', async () => {
      const device = fakeDevice(opts);
      expect(await detectConservativeDepth(device)).toEqual(expected);
      expect(device.scopes.pushed).toBe(1);
      expect(device.scopes.popped).toBe(1);
    });
  }
  it('does not turn a failing cleanup pop into a rejection', async () => {
    const device = fakeDevice({ compileInfoRejects: 'lost', popRejects: 'gone' });
    expect(await detectConservativeDepth(device)).toEqual({ ok: false, reason: 'threw: Error: lost' });
    expect(device.scopes.popped).toBe(1);
  });
  it('probes the exact builtin the patch emits', () => {
    expect(EARLYZ_DETECT_WGSL).toContain(`@builtin(${CONSERVATIVE_DEPTH_BUILTIN})`);
    expect(EARLYZ_DETECT_WGSL).toContain('frag_depth, greater');
  });
});
