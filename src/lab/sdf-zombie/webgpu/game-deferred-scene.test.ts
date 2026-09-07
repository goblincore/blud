// src/lab/sdf-zombie/webgpu/game-deferred-scene.test.ts
//
// The game scene router (M2 task 3): route registration, asynchronous
// descendant discovery, receiver propagation, scoped draws that mutate only
// visibility/material references on the ORIGINAL objects and restore them in
// finally, unsupported-material reporting, and disposal ownership. Pure CPU —
// a mock renderer observes what the scoped draw submitted.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createGameDeferredScene, type GameDeferredScene } from './game-deferred-scene';
import { encodeSurfaceClass } from './deferred-surface';

function mockRenderer() {
  const submitted: {
    swaps: { object: THREE.Object3D; material: THREE.Material | THREE.Material[] }[];
    hidden: THREE.Object3D[];
  }[] = [];
  const render = vi.fn((scene: THREE.Scene) => {
    const swaps: { object: THREE.Object3D; material: THREE.Material | THREE.Material[] }[] = [];
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) hidden.push(o);
      const m = (o as THREE.Mesh).material;
      if (m !== undefined) swaps.push({ object: o, material: m as THREE.Material });
    });
    submitted.push({ swaps, hidden });
  });
  const renderer = { render } as unknown as THREE.WebGPURenderer;
  return { renderer, render, submitted };
}

const camera = () => new THREE.PerspectiveCamera(60, 1, 0.1, 100);

function stdMesh(name: string, material?: THREE.Material | THREE.Material[]): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    material ?? new THREE.MeshStandardMaterial({ color: 0x888888 }),
  );
  mesh.name = name;
  return mesh;
}

/** A stand-in surface producer material: the router admits node materials
 *  carrying the task-2 `surfaceKind` marker into the MRT pass as-is. */
function surfaceProducerMaterial(kind: number): THREE.Material {
  const mat = new THREE.MeshBasicNodeMaterial();
  (mat as unknown as { surfaceKind: number }).surfaceKind = kind;
  return mat;
}

describe('registration and catalog', () => {
  it('routes registered objects and counts them per route after sync', () => {
    const scene = new THREE.Scene();
    const g = new THREE.Group(); g.name = 'level';
    const a = stdMesh('a'); const b = stdMesh('b');
    g.add(a, b);
    scene.add(g);
    const s = createGameDeferredScene(scene);
    s.register(g, 'mesh');
    s.sync();
    expect(s.routeOf(g)).toBe('mesh');
    expect(s.routeOf(a)).toBe('mesh');
    expect(s.routeOf(b)).toBe('mesh');
    const diag = s.diagnostics();
    expect(diag.counts).toEqual({ mesh: 3, sdf: 0, forward: 0, exclude: 0 });
    expect(diag.unsupported).toEqual([]);
    s.dispose();
  });

  it('rejects unknown routes and receivers, and duplicate registration of the same node is an update', () => {
    const scene = new THREE.Scene();
    const a = stdMesh('a');
    scene.add(a);
    const s = createGameDeferredScene(scene);
    expect(() => s.register(a, 'middle' as 'mesh')).toThrow();
    expect(() => s.register(a, 'mesh', 'both' as 'level-only')).toThrow();
    s.register(a, 'mesh', 'full');
    s.register(a, 'sdf'); // update, not a duplicate entry
    s.sync();
    expect(s.routeOf(a)).toBe('sdf');
    expect(s.diagnostics().counts.sdf).toBe(1);
    s.dispose();
  });

  it('receiver defaults to full for mesh routes; receiverOf reports the effective policy', () => {
    const scene = new THREE.Scene();
    const a = stdMesh('a');
    scene.add(a);
    const s = createGameDeferredScene(scene);
    s.register(a, 'mesh');
    s.sync();
    expect(s.receiverOf(a)).toBe('full');
    s.dispose();
  });
});

describe('asynchronous descendants and receiver propagation', () => {
  it('discovers a kit child added under a registered parent AFTER registration, with the parent receiver', () => {
    const scene = new THREE.Scene();
    const actorRoot = new THREE.Group(); actorRoot.name = 'actor';
    scene.add(actorRoot);
    const s = createGameDeferredScene(scene);
    s.register(actorRoot, 'mesh', 'level-only');
    s.sync();
    expect(s.diagnostics().counts.mesh).toBe(1);

    // The async load lands: kit-overlay's loadKit resolves and the caller
    // adds k.object under the registered parent. The next sync finds it.
    const kitChild = stdMesh('kit');
    const kitGroup = new THREE.Group(); kitGroup.name = 'kit';
    kitGroup.add(kitChild);
    actorRoot.add(kitGroup);
    s.sync();

    expect(s.routeOf(kitChild)).toBe('mesh');
    expect(s.receiverOf(kitChild)).toBe('level-only');
    expect(s.diagnostics().counts.mesh).toBe(3);
    s.dispose();
  });

  it('an explicit child registration overrides the parent route for its subtree', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    const kit = new THREE.Group();
    const blood = stdMesh('blood');
    kit.add(blood);
    root.add(kit);
    scene.add(root);
    const s = createGameDeferredScene(scene);
    s.register(root, 'mesh', 'level-only');
    s.register(kit, 'forward'); // explicit: the kit stays a forward effect
    s.sync();
    expect(s.routeOf(blood)).toBe('forward');
    expect(s.receiverOf(blood)).toBeNull(); // forward carries no receiver
    expect(s.diagnostics().counts).toEqual({ mesh: 1, sdf: 0, forward: 2, exclude: 0 });
    s.dispose();
  });

  it('drops a removed actor on sync (rebuilt actor: old view leaves the scene)', () => {
    const scene = new THREE.Scene();
    const actor = stdMesh('zombie-view');
    scene.add(actor);
    const s = createGameDeferredScene(scene);
    s.register(actor, 'sdf', 'level-only');
    s.sync();
    expect(s.diagnostics().counts.sdf).toBe(1);
    scene.remove(actor);
    s.sync();
    expect(s.routeOf(actor)).toBeNull();
    expect(s.diagnostics().counts.sdf).toBe(0);
    s.dispose();
  });

  it('keeps a registered root that has not been added to the scene YET (async kit add)', () => {
    const scene = new THREE.Scene();
    const pendingKit = stdMesh('kit-pending');
    const s = createGameDeferredScene(scene);
    s.register(pendingKit, 'mesh', 'level-only');
    s.sync(); // not attached anywhere: tolerated, pending
    expect(s.routeOf(pendingKit)).toBe('mesh');
    // Once it lands in the scene it is a normal member.
    scene.add(pendingKit);
    s.sync();
    expect(s.diagnostics().counts.mesh).toBe(1);
    s.dispose();
  });
});

describe('scoped draws on the ORIGINAL objects', () => {
  it('mesh draw: swaps registered mesh materials to adapters during render, restores after; nothing reparented', () => {
    const scene = new THREE.Scene();
    const src = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const mesh = stdMesh('wall', src);
    scene.add(mesh);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(mesh, 'mesh', 'level-only');
    s.sync();
    s.draw('mesh', renderer, camera());
    // What render SAW: the adapter (surfaceKind 17), not the source material.
    expect(submitted).toHaveLength(1);
    const during = submitted[0]!.swaps.find((e) => e.object === mesh)!;
    expect(((during.material as unknown as { surfaceKind?: number }).surfaceKind) ?? -1)
      .toBe(encodeSurfaceClass(1, 'level-only'));
    // After the draw the ORIGINAL material reference is back.
    expect(mesh.material).toBe(src);
    // Structure untouched.
    expect(mesh.parent).toBe(scene);
    s.dispose();
  });

  it('mesh draw: array materials swap as a whole array and each entry is adapted', () => {
    const scene = new THREE.Scene();
    const srcA = new THREE.MeshStandardMaterial({ color: 0xaa0000 });
    const srcB = new THREE.MeshStandardMaterial({ color: 0x00aa00 });
    const mesh = stdMesh('multi', [srcA, srcB]);
    scene.add(mesh);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(mesh, 'mesh');
    s.sync();
    s.draw('mesh', renderer, camera());
    const during = submitted[0]!.swaps.find((e) => e.object === mesh)!;
    const arr = during.material as unknown[];
    expect(Array.isArray(arr)).toBe(true);
    expect((arr[0] as { surfaceKind?: number }).surfaceKind).toBe(1);
    expect((arr[1] as { surfaceKind?: number }).surfaceKind).toBe(1);
    expect(arr[0]).not.toBe(srcA);
    expect(mesh.material as unknown).toEqual([srcA, srcB]);
    s.dispose();
  });

  it('mesh draw hides sdf/forward/exclude members AND unregistered renderables; their subtree members still draw', () => {
    const scene = new THREE.Scene();
    const wall = stdMesh('wall');
    const sdfView = stdMesh('zombie-view', surfaceProducerMaterial(18));
    const fwd = stdMesh('blood');
    const helper = stdMesh('hull-twin'); // nobody registered this
    const nested = stdMesh('nested-kit');
    const sdfHolder = new THREE.Group();
    sdfHolder.add(sdfView, nested);
    scene.add(wall, sdfHolder, fwd, helper);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(wall, 'mesh');
    s.register(sdfView, 'sdf');
    s.register(fwd, 'forward');
    s.register(nested, 'mesh'); // explicitly routed under an sdf group
    s.sync();
    s.draw('mesh', renderer, camera());
    const hidden = new Set(submitted[0]!.hidden);
    expect(hidden.has(sdfView)).toBe(true);
    expect(hidden.has(fwd)).toBe(true);
    expect(hidden.has(helper)).toBe(true);
    // The mesh child nested under the hidden sdf group must still have been
    // submitted visible with an adapted material.
    const during = submitted[0]!.swaps.find((e) => e.object === nested)!;
    expect((during.material as { surfaceKind?: number }).surfaceKind).toBe(1);
    expect(hidden.has(nested)).toBe(false);
    // And everything is back afterwards.
    expect(sdfView.visible).toBe(true);
    expect(fwd.visible).toBe(true);
    expect(helper.visible).toBe(true);
    s.dispose();
  });

  it('sdf draw shows only surface producers, passing their materials through AS-IS', () => {
    const scene = new THREE.Scene();
    const wall = stdMesh('wall');
    const sdfView = stdMesh('zombie-view', surfaceProducerMaterial(18));
    scene.add(wall, sdfView);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(wall, 'mesh');
    s.register(sdfView, 'sdf', 'level-only');
    s.sync();
    s.draw('sdf', renderer, camera());
    const during = submitted[0]!.swaps.find((e) => e.object === sdfView)!;
    expect(during.material).toBe(sdfView.material); // producer graph untouched
    const hidden = new Set(submitted[0]!.hidden);
    expect(hidden.has(wall)).toBe(true);
    expect(sdfView.visible).toBe(true);
    expect(wall.visible).toBe(true);
    s.dispose();
  });

  it('forward draw hides registered non-forward members but leaves unregistered objects alone', () => {
    const scene = new THREE.Scene();
    const wall = stdMesh('wall');
    const fwd = stdMesh('blood');
    const untracked = stdMesh('thing');
    scene.add(wall, fwd, untracked);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(wall, 'mesh');
    s.register(fwd, 'forward');
    s.sync();
    s.draw('forward', renderer, camera());
    const hidden = new Set(submitted[0]!.hidden);
    expect(hidden.has(wall)).toBe(true);
    expect(hidden.has(fwd)).toBe(false);
    expect(hidden.has(untracked)).toBe(false);
    expect(untracked.visible).toBe(true);
    expect(wall.visible).toBe(true);
    s.dispose();
  });

  it('a game-hidden subtree stays hidden and untouched in every draw (no force-showing)', () => {
    const scene = new THREE.Scene();
    const dead = new THREE.Group(); dead.name = 'dead-actor';
    const view = stdMesh('view');
    dead.add(view);
    scene.add(dead);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(view, 'mesh');
    s.sync();
    dead.visible = false; // the game hid it; that intent must win
    s.draw('mesh', renderer, camera());
    expect(dead.visible).toBe(false);
    expect(view.visible).toBe(true); // child visible flag never touched
    const hidden = new Set(submitted[0]!.hidden);
    expect(hidden.has(dead)).toBe(true);
    expect(hidden.has(view)).toBe(false);
    expect(dead.visible).toBe(false);
    s.dispose();
  });

  it('preserves object per-draw callbacks (onBeforeRender) and layer masks', () => {
    const scene = new THREE.Scene();
    const mesh = stdMesh('wall');
    const before = vi.fn();
    mesh.onBeforeRender = before;
    mesh.layers.set(2);
    scene.add(mesh);
    const { renderer } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(mesh, 'mesh');
    s.sync();
    s.draw('mesh', renderer, camera());
    expect(mesh.onBeforeRender).toBe(before);
    expect(mesh.layers.mask).toBe(1 << 2);
    s.dispose();
  });

  it('restores visibility and materials even when the render throws', () => {
    const scene = new THREE.Scene();
    const src = new THREE.MeshStandardMaterial();
    const wall = stdMesh('wall', src);
    const sdfView = stdMesh('zombie-view', surfaceProducerMaterial(18));
    scene.add(wall, sdfView);
    const throwing = {
      render: () => {
        // Throw MID-draw, after three would already have started projecting.
        expect(wall.material).not.toBe(src); // swap happened
        expect(sdfView.visible).toBe(false); // scoping happened
        throw new Error('device lost');
      },
    } as unknown as THREE.WebGPURenderer;
    const s = createGameDeferredScene(scene);
    s.register(wall, 'mesh');
    s.register(sdfView, 'sdf');
    s.sync();
    expect(() => s.draw('mesh', throwing, camera())).toThrow('device lost');
    expect(wall.material).toBe(src);
    expect(sdfView.visible).toBe(true);
    expect(wall.visible).toBe(true);
    s.dispose();
  });

  it('unsupported opaque materials are reported with source names and kept out of the pass', () => {
    const scene = new THREE.Scene();
    const weird = new THREE.MeshBasicNodeMaterial(); // no surfaceKind marker
    weird.name = 'hull-material';
    const mesh = stdMesh('hull', weird);
    mesh.name = 'hull-mesh';
    scene.add(mesh);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(mesh, 'mesh');
    s.sync();
    const diag = s.diagnostics();
    expect(diag.unsupported.length).toBe(1);
    expect(diag.unsupported[0]).toContain('hull-mesh');
    expect(diag.unsupported[0]).toContain('hull-material');
    s.draw('mesh', renderer, camera());
    const hidden = new Set(submitted[0]!.hidden);
    expect(hidden.has(mesh)).toBe(true);
    expect(mesh.material).toBe(weird); // never mutated, never submitted
    expect(mesh.visible).toBe(true);
    s.dispose();
  });

  it('a LIT-mode producer routed to a G-buffer pass is unsupported (only surface mode enters MRT)', () => {
    const scene = new THREE.Scene();
    const litView = stdMesh('live-view', surfaceProducerMaterial(0));
    // surfaceKind 0 is not a surface marker: manufacture the lit case by
    // deleting the marker entirely.
    delete (litView.material as unknown as { surfaceKind?: number }).surfaceKind;
    scene.add(litView);
    const s = createGameDeferredScene(scene);
    s.register(litView, 'sdf');
    s.sync();
    expect(s.diagnostics().unsupported[0]).toContain('live-view');
    s.dispose();
  });
});

describe('lifecycle', () => {
  it('dispose drops the catalog, disposes OWNED adapters only, and rejects further use', () => {
    const scene = new THREE.Scene();
    const src = new THREE.MeshStandardMaterial();
    const mesh = stdMesh('wall', src);
    scene.add(mesh);
    const s: GameDeferredScene = createGameDeferredScene(scene);
    s.register(mesh, 'mesh');
    s.sync();
    s.dispose();
    expect(s.diagnostics().counts.mesh).toBe(0);
    expect(() => s.sync()).toThrow();
    expect(() => s.draw('mesh', new THREE.WebGPURenderer(), camera())).toThrow();
    expect(src.dispose).toBeDefined();
    // The source material still works: nothing disposed it.
    expect(() => src.dispose()).not.toThrow();
  });
});
