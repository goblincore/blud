// src/lab/sdf-zombie/webgpu/earlyz/front-material.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three/webgpu';
import { WGSLNodeBuilder } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createCrowdMaterial, defaultUniforms, blankFaceTexture } from '../zombie-gpu';
import { createCrowdRecords } from '../crowd-records';
import { createComputeTileBinding } from '../tile-bin-compute';
import { installConservativeDepthPatch } from './conservative-depth-patch';

const renderer = { compute() { /* GPU dispatch stub, as crowd-type.test.ts */ } } as unknown as THREE.WebGPURenderer;
const make = (dispatch: 'boxes' | 'quad', earlyz?: { front: boolean }) => {
  const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const rec = createCrowdRecords();
  return createCrowdMaterial(
    tex, defaultUniforms(blankFaceTexture()),
    { inst: rec.node, instCfg: uniform(new THREE.Vector4(0, 1, 0, 0)) },
    createComputeTileBinding(renderer, 256, 256), undefined, dispatch, undefined, earlyz,
  ).material as THREE.MeshBasicNodeMaterial & { conservativeDepth?: string };
};

describe('front-face crowd material (spec D2-D4)', () => {
  it('the shipped call is unchanged: BackSide, no opt-in property', () => {
    const m = make('boxes');
    expect(m.side).toBe(THREE.BackSide);
    expect('conservativeDepth' in m).toBe(false);
  });
  it('earlyz front: FrontSide + conservativeDepth greater + a depth node', () => {
    const m = make('boxes', { front: true });
    expect(m.side).toBe(THREE.FrontSide);
    expect(m.conservativeDepth).toBe('greater');
    expect(m.depthNode).not.toBeNull();
    expect(m.depthWrite).toBe(true);
  });
  it('the quad dispatch never takes the front path (silently ignored)', () => {
    const m = make('quad', { front: true });
    expect('conservativeDepth' in m).toBe(false);
    expect(m.side).toBe(THREE.DoubleSide);
  });
});

// ---------------------------------------------------------------------------
// The GENERATED WGSL. The structural checks above cannot tell a front material that hands the march
// the ENTRY point (worldPos: positionWorld, every front body would vanish) or a wrong startT from
// the real thing; the emitted fragment text can. Built through three r186's real WGSLNodeBuilder,
// no GPU.
// ---------------------------------------------------------------------------

/** Build one material's vertex and fragment WGSL through three r186's real node builder. */
function buildWgsl(material: THREE.Material): { vs: string; fs: string } {
  // The crowd's instanced box: iCentre / iHalf / iSlot interleaved, as crowd-type.ts lays it out.
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(2, 2, 2) as never);
  const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(7 * 4), 7);
  geo.setAttribute('iCentre', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute('iHalf', new THREE.InterleavedBufferAttribute(ib, 3, 3));
  geo.setAttribute('iSlot', new THREE.InterleavedBufferAttribute(ib, 1, 6));
  const mesh = new THREE.Mesh(geo, material);
  const stubCanvas = { getContext: () => null, addEventListener() { /* stub */ }, style: {}, width: 100, height: 100 };
  const stubRenderer = new THREE.WebGPURenderer({ canvas: stubCanvas as unknown as HTMLCanvasElement });
  // The march material samples textures and storage: the builder wants a backend that never initialised.
  (stubRenderer as unknown as { hasFeature: () => boolean }).hasFeature = () => false;
  (stubRenderer as unknown as { backend: { renderer: unknown } }).backend.renderer = stubRenderer;
  const builder = new WGSLNodeBuilder(mesh, stubRenderer) as unknown as {
    scene: unknown; material: unknown; camera: unknown; context: { material: unknown };
    build(): unknown; fragmentShader: string; vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.material = material;
  builder.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  builder.context.material = material;
  builder.build();
  return { vs: builder.vertexShader, fs: builder.fragmentShader };
}

/** three numbers its generated names from a global node counter, so the same graph built twice (or
 * with one extra uniform ahead of it) spells every id differently. Renumber each id class by order
 * of first appearance: two builds of the same graph then read identically, while a different
 * uniform in the same slot (marchCfg swapped for another) still shows as a different token. */
function canonicalIds(wgsl: string): string {
  const seen = new Map<string, Map<string, number>>();
  return wgsl.replace(/\b(nodeUniform|nodeVarying|nodeVar|NodeBuffer_|nodeUBO|nodeStorage)(\d+)/g, (_m, cls: string, id: string) => {
    let ids = seen.get(cls);
    if (!ids) seen.set(cls, ids = new Map());
    if (!ids.has(id)) ids.set(id, ids.size);
    return `${cls}#${ids.get(id)}`;
  });
}

/** The top-level arguments of the first `callee(` call in `wgsl` (balanced parens, depth-0 commas). */
function callArgs(wgsl: string, callee: string): string[] {
  const at = wgsl.indexOf(`${callee}(`);
  expect(at, `${callee}( call in the fragment`).toBeGreaterThanOrEqual(0);
  const open = at + callee.length;
  const args: string[] = [];
  let depthParen = 0;
  let start = open + 1;
  for (let i = open; i < wgsl.length; i++) {
    const c = wgsl[i];
    if (c === '(') depthParen++;
    else if (c === ')') {
      depthParen--;
      if (depthParen === 0) { args.push(wgsl.slice(start, i).trim()); return args; }
    } else if (c === ',' && depthParen === 1) {
      args.push(wgsl.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error(`unbalanced call to ${callee}`);
}

describe('front-face crowd material, generated WGSL (spec D2-D4)', () => {
  let shipped: { vs: string; fs: string };
  let flagOff: { vs: string; fs: string };
  let front: { vs: string; fs: string };

  beforeAll(() => {
    expect(installConservativeDepthPatch().installed).toBe(true);
    shipped = buildWgsl(make('boxes'));
    flagOff = buildWgsl(make('boxes', { front: false }));
    front = buildWgsl(make('boxes', { front: true }));
  }, 180000);

  it('front: the march gets the analytic box EXIT as worldPos', () => {
    const args = callArgs(front.fs, 'marchBody');
    expect(args[0]).toMatch(/^earlyzBoxExitPoint\(/);
    // the exit is computed from the camera and the fragment's world position (the ray), nothing else
    expect(args[0]).toContain('render.cameraPosition');
    expect(args[0]).toContain('v_positionWorld');
    // ...and the shipped back-face material hands the march the raw interpolated position
    expect(callArgs(shipped.fs, 'marchBody')[0]).toBe('v_positionWorld');
  });

  it('front: every marchBody argument after worldPos matches the shipped one (startT and marchCfg included)', () => {
    const f = callArgs(canonicalIds(front.fs), 'marchBody');
    const s = callArgs(canonicalIds(shipped.fs), 'marchBody');
    expect(f.length).toBe(s.length);
    expect(f.slice(1)).toEqual(s.slice(1));
  });

  it('front: exactly one frag_depth, greater, clamped to the reconstructed raster depth', () => {
    const count = (hay: string, needle: string) => hay.split(needle).length - 1;
    expect(count(front.fs, '@builtin( frag_depth, greater )')).toBe(1);
    expect(front.fs).not.toMatch(/@builtin\( frag_depth \)/);
    const line = front.fs.split('\n').find((l) => l.includes('output.depth = max('));
    expect(line, 'output.depth = max( ... ) assignment').toBeDefined();
    expect(line).toContain('v_positionView.z');
  });

  it('shipped: no analytic exit, plain frag_depth', () => {
    expect(shipped.fs).not.toContain('earlyzBoxExitPoint(');
    expect(shipped.fs).not.toContain('frag_depth, greater');
    expect(shipped.fs).toContain('@builtin( frag_depth )');
    expect(shipped.fs).not.toContain('output.depth = max(');
  });

  it('{ front: false } generates the same shader as omitting the argument', () => {
    expect(canonicalIds(flagOff.fs)).toBe(canonicalIds(shipped.fs));
    expect(canonicalIds(flagOff.vs)).toBe(canonicalIds(shipped.vs));
  });
});
