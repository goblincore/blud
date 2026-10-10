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
import { SCULPT_VARIANTS, sculptPaintOf, sculptRecipe, type SculptVariant } from './sculpt-variant';
import { createBoneMeshCache, startBoneMeshCache, SKULL_ASSET_WAIT_MS } from './sculpt-cache';
import { AnatomicalSkullKit, type SkullFitPlan } from './anatomical-skull';
import { BALL_HEADS, HUMANOIDS, ballHeadFit } from './skull-cast';
import { createSkeletonSeams } from '../game-seams-skeleton';
import type { GameContext } from '../game-context';

const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const sources = createSkeletonSources(body, bound, { character: 'zombie' });
const headSrc = sources.find(s => s.segment === 'head')!;
const limbSrc = sources.find(s => s.segment !== 'head')!;

type R = ReturnType<typeof createSegmentMeshRenderer>;
type Graph = Node & { functionNode?: { code: string }; isVarNode?: boolean; intent?: boolean; node?: Node; ifNode?: unknown };
const make = (variant: SculptVariant) => {
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
  it.each([['classic', FIRST], ['shape', FIRST], ['shape-fine', FIRST], ['paint', SECOND], ['full-1cm', SECOND], ['full', SECOND]] as const)('%s: the bone material calls its paint', (variant, expected) => {
    const { cache, renderer } = make(variant);
    renderer.update([[headSrc, limbSrc]], [{ id: 1 }]);
    const m = batch(renderer, 'skeleton-segments')!.material as MeshBasicNodeMaterial;
    expect([...calls(reach([m.colorNode!]))].sort()).toEqual([...expected]);
    // One material for every bone: a limb and the head are on the same one.
    expect(new Set(renderer.object.children.filter(c => c.name === 'skeleton-segments').map(c => (c as THREE.InstancedMesh).material)).size).toBe(1);
    renderer.dispose(); cache.dispose();
  });

  it.each([['classic', FIRST], ['shape', FIRST], ['paint', SECOND], ['full-1cm', SECOND], ['full', SECOND]] as const)('%s: the split copies call the same paint, behind the clip', (variant, expected) => {
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

describe('the second paint is drawn on the characters it is fitted to, and the first on the others', () => {
  // The zombie's body under another character's name: the paint is chosen by the name. An unlisted character's head
  // is its plain bone (neither sculpt carves it).
  const as = (character: string) => { const all = createSkeletonSources(body, bound, { character }); return { head: all.find(s => s.segment === 'head')!, limb: all.find(s => s.segment !== 'head')! }; };
  const cultist = as('cultist'), juggernaut = as('juggernaut');
  const rendererOf = (recipe: Parameters<typeof sculptPaintOf>[0]) => { const cache = new SegmentMeshCache(MESH_CELL, undefined, null, recipe); return { cache, renderer: createSegmentMeshRenderer(cache) }; };
  const batchOf = (r: R, geometry: THREE.BufferGeometry) => r.object.children.find(c => (c as THREE.InstancedMesh).geometry === geometry) as THREE.InstancedMesh;
  const paintOn = (m: THREE.Material | THREE.Material[]) => [(m as THREE.Material).name, (m as THREE.Material).userData.sculptPaint, [...calls(reach([(m as MeshBasicNodeMaterial).colorNode!]))].sort()];

  it('full: the zombie\'s and the juggernaut\'s bones on the second paint\'s material, the cultist\'s on the first\'s, in one renderer', () => {
    const { cache, renderer } = rendererOf(sculptRecipe('full'));
    renderer.update([[headSrc, limbSrc], [cultist.head, cultist.limb], [juggernaut.head, juggernaut.limb]], [{ id: 1 }, { id: 2 }, { id: 3 }]);
    for (const s of [headSrc, limbSrc, juggernaut.head, juggernaut.limb]) expect(paintOn(batchOf(renderer, cache.get(s).geometry).material), s.revision).toEqual(['skeleton-bone', 2, SECOND]);
    for (const s of [cultist.head, cultist.limb]) expect(paintOn(batchOf(renderer, cache.get(s).geometry).material), s.revision).toEqual(['skeleton-bone', 1, FIRST]);
    // Two bone materials in all, each character's bones on one.
    expect(new Set(renderer.object.children.filter(c => c.name === 'skeleton-segments').map(c => (c as THREE.InstancedMesh).material)).size).toBe(2);
    expect(batchOf(renderer, cache.get(cultist.head).geometry).material).toBe(batchOf(renderer, cache.get(cultist.limb).geometry).material);
    expect(batchOf(renderer, cache.get(headSrc).geometry).material).toBe(batchOf(renderer, cache.get(juggernaut.limb).geometry).material);
    renderer.dispose(); cache.dispose();
  });

  it('full: a character it is not fitted to is drawn exactly as classic draws it (the same mesh, the same paint)', () => {
    const full = rendererOf(sculptRecipe('full')), classic = rendererOf(sculptRecipe('classic'));
    full.renderer.update([[cultist.head]], [{ id: 1 }]); classic.renderer.update([[cultist.head]], [{ id: 1 }]);
    expect(full.cache.keyOf(cultist.head)).toBe(classic.cache.keyOf(cultist.head));
    expect(paintOn(batchOf(full.renderer, full.cache.get(cultist.head).geometry).material)).toEqual(paintOn(batchOf(classic.renderer, classic.cache.get(cultist.head).geometry).material));
    full.renderer.dispose(); full.cache.dispose(); classic.renderer.dispose(); classic.cache.dispose();
  });

  it('classic: every character on the first paint, and no second material is built', () => {
    const { cache, renderer } = rendererOf(sculptRecipe('classic'));
    renderer.update([[headSrc, limbSrc], [cultist.head], [juggernaut.head]], [{ id: 1 }, { id: 2 }, { id: 3 }]);
    for (const s of [headSrc, limbSrc, cultist.head, juggernaut.head]) expect(paintOn(batchOf(renderer, cache.get(s).geometry).material)).toEqual(['skeleton-bone', 1, FIRST]);
    expect(new Set(renderer.object.children.filter(c => c.name === 'skeleton-segments').map(c => (c as THREE.InstancedMesh).material)).size).toBe(1);
    renderer.dispose(); cache.dispose();
  });

  it('every head (?sculptheads=all): the second paint on the cultist too', () => {
    const { cache, renderer } = rendererOf({ ...sculptRecipe('full'), everyHead: true });
    renderer.update([[headSrc], [cultist.head, cultist.limb]], [{ id: 1 }, { id: 2 }]);
    for (const s of [headSrc, cultist.head, cultist.limb]) expect(paintOn(batchOf(renderer, cache.get(s).geometry).material)).toEqual(['skeleton-bone', 2, SECOND]);
    renderer.dispose(); cache.dispose();
  });

  it('a split head\'s copies are on its own paint\'s split material', () => {
    const { cache, renderer } = rendererOf(sculptRecipe('full'));
    renderer.update([[headSrc], [cultist.head]], [{ id: 1 }, { id: 2 }], undefined, undefined, undefined, { warp: (_o, seg) => (seg === 'head' ? warp() : null) });
    const splits = renderer.object.children.filter(c => c.name === 'skeleton-segments-split') as THREE.InstancedMesh[];
    expect(splits).toHaveLength(2);
    const of = (src: typeof headSrc) => splits.find(b => b.geometry.getAttribute('position') === cache.get(src).geometry.getAttribute('position'))!.material as MeshBasicNodeMaterial;
    expect([of(headSrc).name, of(headSrc).userData.sculptPaint]).toEqual(['skeleton-bone-split', 2]);
    expect([of(cultist.head).name, of(cultist.head).userData.sculptPaint]).toEqual(['skeleton-bone-split', 1]);
    expect(calls(reach([...colourOf(of(headSrc)).held, ...colourOf(of(headSrc)).branch])).has('sculptPaintSurface')).toBe(true);
    const first = colourOf(of(cultist.head));
    expect([...calls(reach([...first.held, ...first.branch]))].sort()).toEqual([...FIRST, 'meshSplitClip', 'meshSplitInside'].sort());
    renderer.dispose(); cache.dispose();
  });
});

describe('createBoneMeshCache', () => {
  const said = () => { const lines: string[] = []; return { lines, say: (line: string) => { lines.push(line); } }; };
  const noKit = () => Promise.reject(new Error('no asset in this test'));
  // A stand-in for the loaded plates: the cache only keeps it. It fits no head (head() answers null), so every key
  // asked of a cache that holds it is the sculpted bone's.
  const kit = { head: () => null, size: 0, totals: { verts: 0, tris: 0 }, supports: () => false, dispose: () => {} } as unknown as AnatomicalSkullKit;
  const loaded = () => Promise.resolve(kit);

  it('no skull parameter is the sculpted skull, full: the recipe, the fine head, and nothing said; the plates are loaded for the characters that draw them', async () => {
    for (const search of ['', '?seed=1&frozen=1', '?skull=sculpt', '?skull=sculpt&sculpt=']) {
      const { lines, say } = said();
      const cache = await createBoneMeshCache(search, say, loaded);
      expect(cache.skullKit, search).toBe(search.includes('skull=sculpt') ? null : kit);
      expect(cache.sculpt, search).toBe(sculptRecipe('full'));
      expect(cache.cellSize).toBe(MESH_CELL);
      expect(cache.keyOf(headSrc)).toBe(new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe('full')).keyOf(headSrc));
      expect(cache.keyOf(headSrc)).not.toBe(new SegmentMeshCache().keyOf(headSrc));
      expect(lines).toEqual([]);
      cache.dispose();
    }
  });
  it('a word of the query that was not honoured is said once, IN ANY BUILD: an unknown value, an overruled one', async () => {
    for (const search of ['?skull=bones', '?sculpt=huge', '?skull=anatomical&sculpt=full', '?skull=anatomical&skullfit=huge']) {
      const calls: [string, boolean | undefined][] = [];
      const cache = await createBoneMeshCache(search, (line, always) => { calls.push([line, always]); }, loaded);
      expect(calls, search).toHaveLength(1);
      // `always`: the line is not kept to a dev build's console.
      expect(calls[0]![1], search).toBe(true);
      cache.dispose();
    }
  });
  it('THE BOOT STARTS THE CACHE EARLY AND TAKES IT LATER (startBoneMeshCache): one cache made, at the start; a boot that draws no mesh skeleton disposes it', async () => {
    const made: string[] = [], disposed: string[] = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((ok) => { release = ok; });
    const make = async (search: string) => {
      made.push(search);
      await gate;
      const cache = new SegmentMeshCache(MESH_CELL, undefined, { ...kit, awaitedMs: null } as unknown as AnatomicalSkullKit, sculptRecipe('full'));
      const dispose = cache.dispose.bind(cache);
      cache.dispose = () => { disposed.push(search); dispose(); };
      return cache;
    };
    // Started at once, before anyone takes it.
    const early = startBoneMeshCache('?seed=1', true, make);
    expect(made).toEqual(['?seed=1']);
    const taking = early.take(true);
    release!();
    const cache = (await taking)!;
    expect(made).toEqual(['?seed=1']);
    expect(cache.skullKit!.awaitedMs).toBeGreaterThanOrEqual(0);
    expect(disposed).toEqual([]);
    // A boot that turns out not to draw the mesh skeleton: null, and the started cache is disposed.
    const unused = startBoneMeshCache('?mode=deferred', true, make);
    expect(await unused.take(false)).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    expect(disposed).toEqual(['?mode=deferred']);
    // A query that rules the mesh skeleton out starts nothing.
    const none = startBoneMeshCache('?skeleton=procedural', false, make);
    expect(made).toHaveLength(2);
    expect(await none.take(false)).toBeNull();
    expect(made).toHaveLength(2);
    cache.dispose();
  });
  it.each(SCULPT_VARIANTS)('?sculpt=%s is the sculpted skull in that variant, whatever ?skull= says', async (variant) => {
    for (const search of [`?sculpt=${variant}`, `?skull=anatomical&sculpt=${variant}`, `?seed=1&sculpt=${variant}&skull=sculpt`]) {
      const { lines, say } = said();
      const cache = await createBoneMeshCache(search, say, noKit);
      expect(cache.skullKit).toBeNull();
      expect(cache.sculpt).toBe(sculptRecipe(variant));
      expect(cache.cellSize).toBe(MESH_CELL);
      // The overruled ?skull=anatomical is said, once; nothing else is.
      expect(lines).toHaveLength(search.includes('anatomical') ? 1 : 0);
      cache.dispose();
    }
  });
  it('?sculpt=classic is the first look: the cache a bare SegmentMeshCache is', async () => {
    const cache = await createBoneMeshCache('?sculpt=classic', said().say, noKit);
    expect(cache.sculpt).toBe(sculptRecipe('classic'));
    expect(cache.keyOf(headSrc)).toBe(new SegmentMeshCache().keyOf(headSrc));
    cache.dispose();
  });
  it('?skull=anatomical loads the plates and draws the other bones under classic', async () => {
    const { lines, say } = said();
    let loads = 0;
    const cache = await createBoneMeshCache('?skull=anatomical', say, () => { loads++; return Promise.resolve(kit); });
    expect(cache.skullKit).toBe(kit);
    expect(cache.sculpt).toBe(sculptRecipe('classic'));
    expect(loads).toBe(1);
    // The wait for the asset is timed onto the kit.
    expect(kit.loadMs).toBeGreaterThanOrEqual(0);
    expect(lines).toEqual([]);
  });
  it('the plates are loaded only by a page on which somebody draws them: not under the sculpted skull on every character', async () => {
    const loadsOf = async (search: string) => { let loads = 0; (await createBoneMeshCache(search, said().say, () => { loads++; return Promise.resolve(kit); })).dispose(); return loads; };
    for (const search of ['?skull=sculpt', '?skull=procedural', '?sculpt=full', '?sculpt=classic', '?skull=anatomical&sculpt=paint', '?skull=sculpt&skullfit=snug']) expect(await loadsOf(search), search).toBe(0);
    // The default page draws them on the eight ball-headed humanoids; ?skull=anatomical on every humanoid.
    for (const search of ['', '?level=night-train', '?skull=nonsense', '?skullfit=tight', '?skull=anatomical', '?skull=anatomical&skullfit=snug']) expect(await loadsOf(search), search).toBe(1);
  });
  it('the kit is loaded with the resolver\'s plan: who draws the plates, each under its fit', async () => {
    const plans: Record<string, ReturnType<typeof ballHeadFit>[]> = {};
    for (const search of ['', '?skull=anatomical', '?skullfit=tight']) {
      (await createBoneMeshCache(search, said().say, (plan) => { plans[search] = ['cultist', 'female', 'zombie', 'soldier', 'ogre'].map(plan); return Promise.resolve(kit); })).dispose();
    }
    expect(plans['']).toEqual([ballHeadFit('cultist'), ballHeadFit('female'), null, null, null]);
    expect(plans['?skull=anatomical']).toEqual([{ fit: 'envelope' }, { fit: 'envelope' }, { fit: 'envelope' }, { fit: 'envelope' }, null]);
    expect(plans['?skullfit=tight']).toEqual([{ fit: 'tight' }, { fit: 'tight' }, null, null, null]);
  });
  it('plates that do not load: the boot goes on, every character on its sculpted bone, and one line says so in any build', async () => {
    for (const [search, variant] of [['?skull=anatomical', 'full'], ['', 'full'], ['?level=night-train', 'full'], ['?skullfit=snug', 'full']] as const) {
      const said2: [string, boolean | undefined][] = [];
      const cache = await createBoneMeshCache(search, (line, always) => { said2.push([line, always]); }, noKit);
      expect(cache.skullKit, search).toBeNull();
      expect(cache.sculpt, search).toBe(sculptRecipe(variant));
      expect(said2, search).toHaveLength(1);
      expect(said2[0]![0]).toContain('did not load');
      expect(said2[0]![0]).toContain('no asset in this test');
      expect(said2[0]![0]).toContain('sculpted bone');
      expect(said2[0]![1]).toBe(true);
      cache.dispose();
    }
  });
  it('plates whose load never ends: the page waits `waitMs` and boots without them, saying so once', async () => {
    const said2: [string, boolean | undefined][] = [];
    const began = performance.now();
    const cache = await createBoneMeshCache('', (line, always) => { said2.push([line, always]); }, () => new Promise<AnatomicalSkullKit>(() => {}), 30);
    expect(performance.now() - began).toBeLessThan(1000);
    expect(cache.skullKit).toBeNull();
    expect(cache.sculpt).toBe(sculptRecipe('full'));
    expect(said2).toEqual([[expect.stringContaining('no answer in 30 ms'), true]]);
    expect(SKULL_ASSET_WAIT_MS).toBeGreaterThanOrEqual(2000);
    cache.dispose();
  });
  it('an unknown value is passed over and said once', async () => {
    for (const [search, want] of [['?skull=plates', 'full'], ['?sculpt=nonsense', 'full'], ['?skull=sculpt&sculpt=nonsense', 'full']] as const) {
      const { lines, say } = said();
      const cache = await createBoneMeshCache(search, say, loaded);
      expect(cache.skullKit).toBe(search.includes('skull=sculpt') ? null : kit);
      expect(cache.sculpt, search).toBe(sculptRecipe(want));
      expect(lines, search).toHaveLength(1);
      cache.dispose();
    }
  });
});

describe('__sdfGame.skeletonDiagnostics: which skull the page draws', () => {
  const diagnosticsOf = (cache: SegmentMeshCache | null) => createSkeletonSeams({
    render: { skeletonMode: 'mesh', segMeshCache: cache, segMeshRenderer: null, skeletonVolumes: new Map(), segVolumeCache: null },
  } as unknown as GameContext).skeletonDiagnostics();
  it('reports the skull, the recipe in force and the variant it is', async () => {
    for (const variant of SCULPT_VARIANTS) {
      const cache = new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe(variant));
      expect(diagnosticsOf(cache)).toMatchObject({ skull: 'sculpt', sculpt: { ...sculptRecipe(variant) }, sculptVariant: variant });
      cache.dispose();
    }
    // The page's own caches: the default, and the first look.
    const noKit = () => Promise.reject(new Error('no asset in this test'));
    // (The default page, its plates' asset failing: every character on its sculpted bone.)
    const byDefault = await createBoneMeshCache('', () => {}, noKit);
    expect(diagnosticsOf(byDefault)).toMatchObject({ skull: 'sculpt', sculpt: { shape: 2, headCell: 0.005, paint: 2 }, sculptVariant: 'full', anatomical: {}, skullFit: null, skullFits: [] });
    const classic = await createBoneMeshCache('?sculpt=classic', () => {}, noKit);
    expect(diagnosticsOf(classic)).toMatchObject({ skull: 'sculpt', sculpt: { shape: 1, headCell: null, paint: 1 }, sculptVariant: 'classic' });
    // The anatomical skull: its other bones under classic.
    const kitWith = (plan: SkullFitPlan) => new AnatomicalSkullKit([], new THREE.Texture(), new THREE.Vector2(1, 1), plan);
    const plates = await createBoneMeshCache('?skull=anatomical', () => {}, plan => Promise.resolve(kitWith(plan)));
    expect(diagnosticsOf(plates)).toMatchObject({ skull: 'anatomical', sculpt: { shape: 1, headCell: null, paint: 1 }, sculptVariant: 'classic' });
    expect(diagnosticsOf(plates).anatomical).toEqual(Object.fromEntries(HUMANOIDS.map(name => [name, 'envelope'])));
    // The default page with its plates: the page's skull is still the sculpted one, `full`, and the eight are listed
    // with their fits.
    const cast = await createBoneMeshCache('', () => {}, plan => Promise.resolve(kitWith(plan)));
    expect(diagnosticsOf(cast)).toMatchObject({ skull: 'sculpt', sculpt: { shape: 2, headCell: 0.005, paint: 2 }, sculptVariant: 'full', skullFit: null });
    expect(diagnosticsOf(cast).anatomical).toEqual(Object.fromEntries(Object.entries(BALL_HEADS).map(([name, head]) => [name, head.spec.fit])));
    cast.dispose(); plates.dispose();
    expect(diagnosticsOf(null)).toMatchObject({ sculpt: null, sculptVariant: null });
    byDefault.dispose(); classic.dispose();
  });
});
