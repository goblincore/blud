// The sculpted skull's variants in the segment renderer: which paint each recipe's materials call, that the second
// paint's screen derivatives are taken ahead of the split copies' branch, and that the eyes are seated on the sculpt
// the recipe extracts. The renderer builds node materials without a device, as mesh-renderer.test.ts does.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import type { MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { getCurrentStack, setCurrentStack, stack } from 'three/tsl';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig, applyRig, headQuatOf } from '../../rig-bind';
import zombieSrc from '../../characters/zombie.blob?raw';
import { createSkeletonSources } from './contract';
import { MESH_CELL, SegmentMeshCache } from './mesh';
import { createSegmentMeshRenderer } from './mesh-renderer';
import { forcedSplit, headFrameOf, splitWarpOf, type SplitWarp } from '../../head-split';
import { headShape } from '../flame-anchors';
import { meshBoneSource } from './mesh-skull';
import { meshEyePlacements } from './mesh-eyes';
import { SCULPT_VARIANTS, sculptRecipe, type SculptVariant } from './sculpt-variant';
import { createBoneMeshCache } from './sculpt-cache';
import { createSkeletonSeams } from '../game-seams-skeleton';
import type { GameContext } from '../game-context';

const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const sources = createSkeletonSources(body, bound, { character: 'zombie' });
const headSrc = sources.find(s => s.segment === 'head')!;
const limbSrc = sources.find(s => s.segment !== 'head')!;

type R = ReturnType<typeof createSegmentMeshRenderer>;
type Graph = Node & { functionNode?: { code: string }; isVarNode?: boolean; intent?: boolean; node?: Node; ifNode?: unknown };
const make = (variant: SculptVariant | null) => {
  const cache = new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe(variant));
  return { cache, renderer: createSegmentMeshRenderer(cache) };
};
const batch = (r: R, name: string) => r.object.children.find(c => c.name === name) as THREE.InstancedMesh | undefined;
const reach = (roots: readonly Node[], stop: ReadonlySet<Node> = new Set()): Graph[] => {
  const seen = new Set<Node>(), todo = [...roots];
  while (todo.length) {
    const n = todo.pop()!;
    if (seen.has(n) || stop.has(n)) continue;
    seen.add(n);
    for (const c of n.getChildren()) todo.push(c as Node);
  }
  return [...seen] as Graph[];
};
const calls = (nodes: readonly Graph[]) => new Set(nodes.flatMap(n => (n.functionNode ? [/\bfn (\w+)/.exec(n.functionNode.code)![1]!] : [])));
/** A split material's colour as three builds it: `held` the values declared ahead of the branch on the clip (real
 *  variables), `branch` what the branch stacks. */
const colourOf = (m: MeshBasicNodeMaterial) => {
  const fn = (m.colorNode as unknown as { node: { shaderNode: { jsFunc(): unknown } } }).node.shaderNode;
  const was = getCurrentStack(), outer = stack();
  try {
    setCurrentStack(outer); fn.jsFunc();
    const nodes = outer.nodes as Graph[], at = nodes.findIndex(n => n.ifNode !== undefined);
    expect(at).toBeGreaterThan(0);
    const inner = stack();
    setCurrentStack(inner); (nodes[at]!.ifNode as { jsFunc(): unknown }).jsFunc();
    return { held: nodes.slice(0, at).filter(n => n.isVarNode === true && n.intent !== true), branch: inner.nodes as Graph[] };
  } finally { setCurrentStack(was); }
};
const warp = (): SplitWarp => {
  const posed = applyRig(body, bound, 0);
  return splitWarpOf(forcedSplit('middle', 0, 0, 1)!, headFrameOf(headShape(posed)!, headQuatOf(bound, 0) ?? [0, 0, 0, 1]))!;
};
const FIRST = ['boneShade', 'meshBoneSurface', 'meshBoneWet'];
const SECOND = ['boneShade', 'sculptPaintNormal', 'sculptPaintSurface', 'sculptPaintWet'];

describe('the sculpted skull\'s variants in the segment renderer', () => {
  it.each([[null, FIRST], ['shape', FIRST], ['shape-fine', FIRST], ['paint', SECOND], ['full', SECOND]] as const)('%s: the bone material calls its paint', (variant, expected) => {
    const { cache, renderer } = make(variant);
    renderer.update([[headSrc, limbSrc]], [{ id: 1 }]);
    const m = batch(renderer, 'skeleton-segments')!.material as MeshBasicNodeMaterial;
    expect([...calls(reach([m.colorNode!]))].sort()).toEqual([...expected]);
    // One material for every bone: a limb and the head are on the same one.
    expect(new Set(renderer.object.children.filter(c => c.name === 'skeleton-segments').map(c => (c as THREE.InstancedMesh).material)).size).toBe(1);
    renderer.dispose(); cache.dispose();
  });

  it.each([[null, FIRST], ['shape', FIRST], ['paint', SECOND], ['full', SECOND]] as const)('%s: the split copies call the same paint, behind the clip', (variant, expected) => {
    const { cache, renderer } = make(variant);
    renderer.update([[headSrc]], [{ id: 1 }], undefined, undefined, undefined, { warp: (_o, seg) => (seg === 'head' ? warp() : null) });
    const m = batch(renderer, 'skeleton-segments-split')!.material as MeshBasicNodeMaterial;
    const c = colourOf(m);
    expect([...calls(reach([...c.held, ...c.branch]))].sort()).toEqual([...expected, 'meshSplitClip', 'meshSplitInside'].sort());
    const ahead = calls(reach(c.held.map(v => v.node!)));
    if (expected === SECOND) {
      // The tilt takes screen derivatives: it is a real variable declared ahead of the branch, and nothing the branch
      // stacks reaches it except through that variable.
      expect([...ahead]).toEqual(['sculptPaintNormal']);
      expect(calls(reach(c.branch, new Set(c.held))).has('sculptPaintNormal')).toBe(false);
    } else {
      // The first paint needs nothing ahead of the branch.
      expect(ahead.size).toBe(0);
    }
    renderer.dispose(); cache.dispose();
  });

  it.each(SCULPT_VARIANTS)('%s: the eyes are seated on the sculpt the recipe extracts', (variant) => {
    const { cache, renderer } = make(variant);
    const owner = { id: 1 };
    renderer.update([[headSrc]], [owner]);
    const seats = meshEyePlacements(meshBoneSource(headSrc, sculptRecipe(variant).shape));
    const eyes = renderer.drawn.filter(d => d.eye);
    expect(eyes).toHaveLength(2);
    const pose = headSrc.pose();
    eyes.forEach((d, i) => {
      const at = new THREE.Vector3().setFromMatrixPosition(d.matrix);
      const want = new THREE.Vector3(...seats[i]!.center).applyQuaternion(new THREE.Quaternion(...pose.quat)).add(new THREE.Vector3(...pose.origin));
      expect(at.distanceTo(want)).toBeLessThan(1e-6);
    });
    // The head's geometry is the recipe's mesh.
    const head = renderer.drawn.find(d => !d.eye)!;
    expect(head.geometry).toBe(cache.get(headSrc).geometry);
    expect(cache.get(headSrc).key).toBe(cache.keyOf(headSrc));
    renderer.dispose(); cache.dispose();
  });

  it('the two sculpts seat the eyes on the same line, at their own depths', () => {
    const a = meshEyePlacements(meshBoneSource(headSrc)), b = meshEyePlacements(meshBoneSource(headSrc, 2));
    expect(b).toHaveLength(a.length);
    a.forEach((e, i) => {
      expect(b[i]!.center[0]).toBe(e.center[0]);
      expect(b[i]!.center[1]).toBe(e.center[1]);
      expect(b[i]!.radius).toBe(e.radius);
      expect(Math.abs(b[i]!.center[2] - e.center[2])).toBeLessThan(0.02);
    });
  });
});

describe('createBoneMeshCache', () => {
  it.each(SCULPT_VARIANTS)('?sculpt=%s is the sculpted skull in that variant, whatever ?skull= says', async (variant) => {
    for (const search of [`?sculpt=${variant}`, `?skull=anatomical&sculpt=${variant}`, `?seed=1&sculpt=${variant}&skull=sculpt`]) {
      const cache = await createBoneMeshCache(search);
      expect(cache.skullKit).toBeNull();
      expect(cache.sculpt).toBe(sculptRecipe(variant));
      expect(cache.cellSize).toBe(MESH_CELL);
      cache.dispose();
    }
  });
  it('?skull=sculpt alone is the default sculpt: no recipe but the default one', async () => {
    for (const search of ['?skull=sculpt', '?skull=sculpt&sculpt=', '?skull=sculpt&sculpt=nonsense']) {
      const cache = await createBoneMeshCache(search);
      expect(cache.skullKit).toBeNull();
      expect(cache.sculpt).toBe(sculptRecipe(null));
      expect(cache.keyOf(headSrc)).toBe(new SegmentMeshCache().keyOf(headSrc));
      cache.dispose();
    }
  });
});

describe('__sdfGame.skeletonDiagnostics: which sculpted skull the page draws', () => {
  const diagnosticsOf = (cache: SegmentMeshCache | null) => createSkeletonSeams({
    render: { skeletonMode: 'mesh', segMeshCache: cache, segMeshRenderer: null, skeletonVolumes: new Map(), segVolumeCache: null },
  } as unknown as GameContext).skeletonDiagnostics();
  it('reports the recipe: the default sculpt\'s for ?skull=sculpt, a variant\'s for ?sculpt=', () => {
    const plain = new SegmentMeshCache();
    expect(diagnosticsOf(plain)).toMatchObject({ skull: 'sculpt', sculpt: { shape: 1, headCell: null, paint: 1 } });
    for (const variant of SCULPT_VARIANTS) {
      const cache = new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe(variant));
      expect(diagnosticsOf(cache)).toMatchObject({ skull: 'sculpt', sculpt: { ...sculptRecipe(variant) } });
      cache.dispose();
    }
    expect(diagnosticsOf(null).sculpt).toBeNull();
    plain.dispose();
  });
});
