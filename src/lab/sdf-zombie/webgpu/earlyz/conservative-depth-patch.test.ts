// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { WGSLNodeBuilder } from 'three/webgpu';
import {
  installConservativeDepthPatch, conservativeDepthPatchHits, detectConservativeDepth,
  CONSERVATIVE_DEPTH_BUILTIN,
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
  it('refuses any three revision but 186', () => {
    expect(installConservativeDepthPatch(fakeProto() as never, '187')).toEqual({
      installed: false, reason: 'three r187; the patch is written for r186',
    });
  });
  it('is idempotent', () => {
    const p = fakeProto();
    installConservativeDepthPatch(p as never, '186');
    installConservativeDepthPatch(p as never, '186');
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

describe('applyConservativeDepth', () => {
  it('refuses a material without a depth node (the wrapped node is pinned by Task 7)', () => {
    expect(() => applyConservativeDepth(new THREE.MeshBasicNodeMaterial())).toThrow(/no depthNode/);
  });
});

function fakeDevice(o: { compileErr?: string; pipelineThrows?: string; scopeErr?: string }) {
  return {
    pushErrorScope() { /* scope opened */ },
    popErrorScope: async () => (o.scopeErr ? { message: o.scopeErr } : null),
    createShaderModule: () => ({
      getCompilationInfo: async () => ({ messages: o.compileErr ? [{ type: 'error', message: o.compileErr }] : [] }),
    }),
    createRenderPipelineAsync: async () => { if (o.pipelineThrows) throw new Error(o.pipelineThrows); return {}; },
  };
}

describe('detectConservativeDepth (spec D8)', () => {
  it('ok when the probe compiles and the pipeline builds', async () => {
    expect(await detectConservativeDepth(fakeDevice({}))).toEqual({ ok: true, reason: null });
  });
  it('reports a compile error', async () => {
    expect(await detectConservativeDepth(fakeDevice({ compileErr: 'unknown builtin' }))).toEqual({ ok: false, reason: 'compile: unknown builtin' });
  });
  it('reports a pipeline rejection', async () => {
    expect(await detectConservativeDepth(fakeDevice({ pipelineThrows: 'bad depth' }))).toEqual({ ok: false, reason: 'pipeline: bad depth' });
  });
  it('reports a validation-scope error', async () => {
    expect(await detectConservativeDepth(fakeDevice({ scopeErr: 'invalid' }))).toEqual({ ok: false, reason: 'validation: invalid' });
  });
});
