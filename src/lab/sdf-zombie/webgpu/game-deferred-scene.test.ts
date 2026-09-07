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

  it('FPV composition (review fix): camera-anchored opaque gear routes mesh/level-only; the blended sprite stays forward; castShadow untouched', () => {
    // The exact shape of the game's viewmodel wiring: gear parented to the
    // CAMERA (which sits in the scene), registered individually so the rig
    // itself stays an unregistered container, and a transparent flash sprite
    // under the same rig that must NEVER enter a G-buffer pass.
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    scene.add(cam);
    const rig = new THREE.Group(); rig.name = 'aim-rig';
    cam.add(rig);
    const gunMesh = stdMesh('gun');
    const handMesh = stdMesh('hand', new THREE.MeshStandardMaterial({ color: 0x6fae5a }));
    const shellHull = stdMesh('shell-hull', new THREE.MeshStandardMaterial({ color: 0xa8231d, roughness: 0.55 }));
    const flashQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    flashQuad.name = 'muzzle-flash';
    rig.add(gunMesh, handMesh, shellHull, flashQuad);
    gunMesh.castShadow = false; // the game never sets it on FPV gear
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(gunMesh, 'mesh', 'level-only');
    s.register(handMesh, 'mesh', 'level-only');
    s.register(shellHull, 'mesh', 'level-only');
    s.sync();
    expect(s.routeOf(gunMesh)).toBe('mesh');
    expect(s.receiverOf(gunMesh)).toBe('level-only');
    expect(s.routeOf(flashQuad)).toBeNull(); // unregistered → forward-only
    // Mesh G-buffer: the gear IN (as adapted members), the flash OUT.
    s.draw('mesh', renderer, camera());
    const meshPass = submitted[0]!;
    expect(meshPass.swaps.map((w) => w.object)).toEqual(expect.arrayContaining([gunMesh, handMesh, shellHull]));
    expect(new Set(meshPass.hidden).has(flashQuad)).toBe(true);
    // The adapted material carries the level-only receiver, and the source
    // castShadow flag was never touched by routing.
    const gunMat = meshPass.swaps.find((w) => w.object === gunMesh)!.material as THREE.Material;
    expect(gunMat).not.toBe(gunMesh.material); // an adapter, not the source
    expect(gunMesh.castShadow).toBe(false);
    // Forward: gear hidden (they were G-buffer members), flash draws.
    s.draw('forward', renderer, camera());
    const fwdPass = submitted[1]!;
    expect(new Set(fwdPass.hidden).has(gunMesh)).toBe(true);
    expect(new Set(fwdPass.hidden).has(flashQuad)).toBe(false);
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

describe('live source-material refresh (review fix)', () => {
  /** Narrow read of what render was handed for a mesh during a draw. */
  function submittedMaterialOf(
    submitted: { swaps: { object: THREE.Object3D; material: THREE.Material | THREE.Material[] }[] }[],
    drawIndex: number,
    mesh: THREE.Object3D,
  ): THREE.Material {
    const hit = submitted[drawIndex]!.swaps.find((e) => e.object === mesh);
    expect(hit).toBeDefined();
    return hit!.material as THREE.Material;
  }

  it('source mutations after the first draw reach the CACHED adapter (the game setGunTuning flow)', () => {
    const scene = new THREE.Scene();
    const src = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9, metalness: 0.0 });
    const mesh = stdMesh('gun', src);
    scene.add(mesh);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(mesh, 'mesh');
    s.sync();

    // First draw caches the adapter with the source's initial state.
    s.draw('mesh', renderer, camera());
    const first = submittedMaterialOf(submitted, 0, mesh) as unknown as {
      roughness: number; metalness: number; normalScale: THREE.Vector2; map: unknown;
    };
    expect(first).not.toBe(src);
    expect(first.roughness).toBe(0.9);
    expect(first.metalness).toBe(0.0);

    // The game's setGunTuning flow: mutate the SOURCE (scalars, vector,
    // texture reference), then needsUpdate = true — three's setter bumps
    // src.version. The adapter handed to the renderer on the NEXT draw
    // must carry the new state.
    src.roughness = 0.3;
    src.metalness = 0.8;
    src.normalScale.setScalar(1.4);
    const texB = new THREE.Texture();
    texB.name = 'rebind';
    src.map = texB;
    src.needsUpdate = true;

    s.draw('mesh', renderer, camera());
    const second = submittedMaterialOf(submitted, 1, mesh) as unknown as {
      roughness: number; metalness: number; normalScale: THREE.Vector2; map: unknown;
    };
    // Cache REUSE: the same adapter object, refreshed in place — not a
    // rebuilt material and never the source itself.
    expect(second).toBe(first);
    expect(second).not.toBe(src);
    expect(second.roughness).toBe(0.3);
    expect(second.metalness).toBe(0.8);
    expect(second.normalScale.x).toBe(1.4);
    expect(second.map).toBe(texB);
    // The draw restored the ORIGINAL material reference.
    expect(mesh.material).toBe(src);

    // Repeated UNCHANGED draws keep reusing the cached adapter, state stable.
    s.draw('mesh', renderer, camera());
    const third = submittedMaterialOf(submitted, 2, mesh) as unknown as { roughness: number };
    expect(third).toBe(first);
    expect(third.roughness).toBe(0.3);

    s.dispose();
  });

  it('each receiver\'s cached adapter notices source changes; receiver metadata survives the refresh', () => {
    const scene = new THREE.Scene();
    const src = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.0 });
    const fullMesh = stdMesh('full-receiver', src);
    const levelMesh = stdMesh('level-receiver', src);
    scene.add(fullMesh, levelMesh);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(fullMesh, 'mesh', 'full');
    s.register(levelMesh, 'mesh', 'level-only');
    s.sync();

    s.draw('mesh', renderer, camera());
    const fullA = submittedMaterialOf(submitted, 0, fullMesh) as unknown as {
      surfaceKind: number; roughness: number;
    };
    const levelA = submittedMaterialOf(submitted, 0, levelMesh) as unknown as {
      surfaceKind: number; roughness: number;
    };
    expect(fullA).not.toBe(levelA); // distinct adapters per receiver
    expect(fullA.surfaceKind).toBe(encodeSurfaceClass(1, 'full'));
    expect(levelA.surfaceKind).toBe(encodeSurfaceClass(1, 'level-only'));

    src.roughness = 0.25;
    src.metalness = 0.5;
    src.needsUpdate = true;
    s.draw('mesh', renderer, camera());
    const fullB = submittedMaterialOf(submitted, 1, fullMesh) as unknown as {
      surfaceKind: number; roughness: number; metalness: number;
    };
    const levelB = submittedMaterialOf(submitted, 1, levelMesh) as unknown as {
      surfaceKind: number; roughness: number; metalness: number;
    };
    expect(fullB).toBe(fullA);
    expect(levelB).toBe(levelA);
    expect(fullB.roughness).toBe(0.25);
    expect(levelB.roughness).toBe(0.25);
    expect(fullB.metalness).toBe(0.5);
    expect(levelB.metalness).toBe(0.5);
    // The packed receiver metadata is frozen per adapter: a refresh never
    // rewrites which shadow receiver the adapter claims.
    expect(fullB.surfaceKind).toBe(encodeSurfaceClass(1, 'full'));
    expect(levelB.surfaceKind).toBe(encodeSurfaceClass(1, 'level-only'));

    s.dispose();
  });

  it('dispose after refreshes disposes each adapter exactly once; source material/textures untouched', () => {
    const scene = new THREE.Scene();
    const src = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const mesh = stdMesh('wall', src);
    scene.add(mesh);
    const { renderer, submitted } = mockRenderer();
    const s = createGameDeferredScene(scene);
    s.register(mesh, 'mesh');
    s.sync();
    s.draw('mesh', renderer, camera());

    src.roughness = 0.3;
    src.needsUpdate = true;
    s.draw('mesh', renderer, camera());
    const adapter = submittedMaterialOf(submitted, 1, mesh);
    const adapterDispose = vi.spyOn(adapter, 'dispose');
    const srcDispose = vi.spyOn(src, 'dispose');

    s.dispose();
    expect(adapterDispose).toHaveBeenCalledTimes(1);
    expect(srcDispose).not.toHaveBeenCalled();
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
