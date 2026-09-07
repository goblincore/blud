// src/lab/sdf-zombie/webgpu/game-deferred-scene.ts
//
// THE GAME SCENE ROUTER (hybrid deferred M2 task 3, spec
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m2-design.md). One
// registry mapping the game's scene objects to their deferred draw route —
// mesh G-buffer, SDF G-buffer, forward effect, or excluded helper — plus the
// scoped draw that renders ONE route into the CURRENT render target using
// the ORIGINAL scene, with no reparenting and no copied scene.
//
// HOW A DRAW WORKS. The deferred layer calls the draw hooks at its producer
// targets (deferred-layer.ts render(..., hooks)); the hook closes over this
// module: draw('mesh', renderer, camera) walks the scene top-down, flips
// VISIBILITY on non-members (and, for the mesh route, swaps material
// REFERENCES to cached surface adapters), calls renderer.render(scene,
// camera) once, and restores every flipped field in finally — including
// through a throw. Objects the GAME had hidden stay hidden (their whole
// subtree is intended off and is never force-shown); a member nested under a
// node WE hid is force-shown, which is what lets a kit mesh draw under a
// group routed elsewhere.
//
// UNREGISTERED OBJECTS ARE HIDDEN from the mesh/sdf passes. That is the
// mechanism that keeps the body/proxy helpers (cone twins, occluder and
// shell hulls, shadow proxies) out of the G-buffer without enumerating them:
// nothing renders into a producer pass unless a route owns it. Forward draws
// leave unregistered objects alone — that pass composites over the presented
// frame and its contents are the game-wiring task's business.
//
// MATERIAL ADAPTERS. Mesh-routed THREE.MeshStandardMaterials are adapted per
// SOURCE MATERIAL IDENTITY and receiver (deferred-mesh.ts
// createDeferredMeshMaterial): texture references shared, alpha-test cutout,
// side, vertexColors, emissive preserved; envMap dropped (unlit G-buffer);
// adapters are OWNED here and disposed with the router — source materials,
// geometries and textures are never disposed. Live tuning: the cache also
// records the SOURCE material's version at copy time; a draw that sees a
// moved version (the game's setGunTuning mutates roughness/metalness/
// normalScale/maps and sets needsUpdate, which bumps three's version
// counter) refreshes the copied surface state onto the SAME adapter — no
// rebuild, no extra disposal, surfaceKind (the receiver metadata) frozen.
// Scalar/vector changes propagate through the node uniforms; the refresh's
// needsUpdate bump lets the renderer re-read the graph when a texture
// REFERENCE was rebound. Surface producers (the task-2
// factories' node materials, recognised by their `surfaceKind` marker) pass
// through AS-IS with their graphs untouched. Anything else routed into a
// G-buffer pass — custom node materials, transparent materials, lit-mode
// producers — is kept OUT of the pass and reported in diagnostics().unsupported
// with object and material names; geometry is never silently blackened.
//
// RECEIVER METADATA. register(object, 'mesh', receiver) packs the flashlight
// shadow receiver into that object's adapters' emissionClass.a
// (encodeSurfaceClass). Registering a parent propagates the policy to
// everything catalogued under it, including children that arrive later (the
// async kit/prop loads) — an explicit registration nearer the object always
// wins. Surface producers already carry their receiver from construction
// (task 2); for them the registration is authoritative bookkeeping, exposed
// through receiverOf(), and is NOT written into their (possibly shared)
// materials.
//
// LIFECYCLE. sync() re-walks the registered roots: it discovers late-added
// descendants, re-derives inherited routes/receivers, drops roots whose
// parent chain left the owned scene (a rebuilt/disposed actor's old view —
// detected by REMOVAL, since three cannot be asked whether an object was
// disposed), and refreshes counts and the unsupported list. A root that has
// never been attached is tolerated as pending (the kit is registered before
// its glTF resolves and is added to the scene on load).
//
// SCOPE. The router owns exactly ONE scene (the one passed at construction);
// registered objects are catalogued only while their parent chain reaches
// that scene. A two-scene fixture creates two routers.

import * as THREE from 'three/webgpu';
import {
  copyDeferredMeshSurfaceState,
  createDeferredMeshMaterial,
  type DeferredMeshMaterial,
} from './deferred-mesh';
import type { ShadowReceiver } from './deferred-surface';

export type GameDrawRoute = 'mesh' | 'sdf' | 'forward' | 'exclude';

export const GAME_DRAW_ROUTES: readonly GameDrawRoute[] = ['mesh', 'sdf', 'forward', 'exclude'];

export interface GameDeferredSceneDiagnostics {
  /** Catalogued object count per route (objects, not draw calls). */
  counts: Record<GameDrawRoute, number>;
  /** Materials that cannot enter a G-buffer pass, as
   *  "object ← material [reason]" with the source names. */
  unsupported: string[];
}

export interface GameDeferredScene {
  register(object: THREE.Object3D, route: GameDrawRoute, receiver?: ShadowReceiver): void;
  unregister(object: THREE.Object3D): void;
  sync(): void;
  draw(
    route: 'mesh' | 'sdf' | 'forward',
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
  ): void;
  diagnostics(): GameDeferredDiagnostics;
  /** The object's effective route, or null when it is not catalogued. */
  routeOf(object: THREE.Object3D): GameDrawRoute | null;
  /** The object's effective shadow receiver — always 'full'|'level-only' for
   *  mesh-routed objects (default 'full'), the registered value for surface
   *  producers, null for forward/exclude without an explicit one. */
  receiverOf(object: THREE.Object3D): ShadowReceiver | null;
  dispose(): void;
}

// 'forward' is exported as GameDeferredDiagnostics for the diagnostics()
// return type alias used in the interface above.
export type GameDeferredDiagnostics = GameDeferredSceneDiagnostics;

/** A cached adapter plus the source version its surface state was copied
 *  from. The game mutates its Standard materials live (setGunTuning bumps
 *  needsUpdate, three's setter does version++); adapterFor compares
 *  src.version against this and refreshes the copied state in place when
 *  they diverge. */
interface AdapterEntry {
  adapter: DeferredMeshMaterial;
  sourceVersion: number;
}

interface RootEntry {
  route: GameDrawRoute;
  receiver?: ShadowReceiver;
  /** True once the root's parent chain reached the owned scene at least one
   *  sync; a root that loses attachment AFTER that is treated as removed. */
  wasAttached: boolean;
}

interface CatalogEntry {
  route: GameDrawRoute;
  receiver: ShadowReceiver | null;
}

const MAX_UNSUPPORTED = 64;

function isShadowReceiver(v: unknown): v is ShadowReceiver {
  return v === 'full' || v === 'level-only';
}

/** Adapter-eligible check: the material either adapts to a surface producer
 *  (Standard family) or already IS a surface producer (the task-2 factories'
 *  marker). Returns 'adapt' | 'asis' | the reason it cannot enter.
 *
 *  EXPORTED FOR REGRESSION (M2 task 5): the bone-instancer and baked-chunk
 *  factories must carry `surfaceKind` ON THE MATERIAL — this function reads
 *  the material, never the factory handle, and the task-5 boot check found
 *  handle-only exposure hiding both producers as unsupported. The tests in
 *  bone-instancer.test.ts / baked-chunks.test.ts drive THIS function against
 *  real factory materials so a removed stamp fails here, not on a live
 *  game boot. */
export function materialEligibility(mat: THREE.Material): 'adapt' | 'asis' | string {
  if (mat.transparent) {
    return 'transparent; route it forward';
  }
  if ((mat as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) {
    return 'adapt';
  }
  if (typeof (mat as unknown as { surfaceKind?: unknown }).surfaceKind === 'number') {
    return 'asis';
  }
  return 'unsupported material for the opaque MRT pass';
}

export function createGameDeferredScene(scene: THREE.Scene): GameDeferredScene {
  const roots = new Map<THREE.Object3D, RootEntry>();
  /** Every catalogued object: registered roots AND everything inherited
   *  under them, nearest explicit registration winning. Rebuilt by sync(). */
  const catalog = new Map<THREE.Object3D, CatalogEntry>();
  /** (source material, receiver) -> cached adapter + observed source
   *  version. Adapter MATERIALS are owned here; source materials/textures
   *  are never disposed by this module. */
  const adapterCache = new Map<THREE.Material, Map<ShadowReceiver, AdapterEntry>>();
  const unsupported = new Set<string>();
  let disposed = false;
  /** Unsupported entries discovered at DRAW time (material swapped under us
   *  between syncs) — reported on the same list, bounded the same way. */
  const reportedLive = new Set<string>();

  function assertAlive(): void {
    if (disposed) throw new Error('game deferred scene is disposed');
  }

  function reportUnsupported(object: THREE.Object3D, mat: THREE.Material, reason: string): void {
    if (unsupported.size >= MAX_UNSUPPORTED && !unsupported.has(key(object, mat, reason))) return;
    unsupported.add(key(object, mat, reason));
  }
  function key(object: THREE.Object3D, mat: THREE.Material, reason: string): string {
    const objName = object.name || object.type;
    const matName = mat.name || mat.type;
    return `${objName} ← ${matName} (${reason})`;
  }

  function adapterFor(src: THREE.Material, receiver: ShadowReceiver): DeferredMeshMaterial | null {
    const verdict = materialEligibility(src);
    if (verdict === 'adapt') {
      let perReceiver = adapterCache.get(src);
      if (!perReceiver) {
        perReceiver = new Map<ShadowReceiver, AdapterEntry>();
        adapterCache.set(src, perReceiver);
      }
      const observed = src.version;
      let entry = perReceiver.get(receiver);
      if (!entry) {
        // materialEligibility vetted `src` as the Standard family.
        const adapter = createDeferredMeshMaterial(src as THREE.MeshStandardMaterial, { output: 'surface', shadowReceiver: receiver });
        entry = { adapter, sourceVersion: observed };
        perReceiver.set(receiver, entry);
      } else if (observed !== entry.sourceVersion) {
        // The SOURCE changed since this adapter copied it (the game's
        // setGunTuning flow mutates scalars/normalScale/maps then sets
        // needsUpdate — three's setter does version++). Refresh the copied
        // surface state IN PLACE: the same adapter object keeps its cached
        // graph identity (no rebuild, no disposal churn), and needsUpdate
        // lets the renderer re-read the graph for texture-reference
        // changes. surfaceKind is untouched — the receiver metadata is
        // frozen per (source, receiver) pair.
        copyDeferredMeshSurfaceState(src as THREE.MeshStandardMaterial, entry.adapter);
        entry.adapter.needsUpdate = true;
        entry.sourceVersion = observed;
      }
      return entry.adapter;
    }
    return null;
  }

  function isUnderScene(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object;
    while (node) {
      if (node === scene) return true;
      node = node.parent;
    }
    return false;
  }

  function resolveReceiver(route: GameDrawRoute, explicit?: ShadowReceiver): ShadowReceiver | null {
    if (explicit) return explicit;
    return route === 'mesh' ? 'full' : null;
  }

  /** Rebuilds the catalog from the surviving roots. Nearest explicit
   *  registration wins: an explicitly registered node starts a new scope
   *  for its subtree. */
  function rebuildCatalog(): void {
    catalog.clear();
    const visit = (node: THREE.Object3D, route: GameDrawRoute, receiver: ShadowReceiver | null) => {
      const own = roots.get(node);
      if (own) {
        route = own.route;
        receiver = resolveReceiver(own.route, own.receiver);
      }
      catalog.set(node, { route, receiver });
      for (const child of node.children) visit(child, route, receiver);
    };
    for (const root of roots.keys()) visit(root, 'mesh', 'full');
  }

  function recomputeDiagnostics(): void {
    unsupported.clear();
    // Only RENDERABLES carry a material contract; Groups are containers and
    // are diagnosed through their children.
    const isRenderable = (o: THREE.Object3D): boolean =>
      (o as THREE.Mesh).isMesh === true
      || (o as THREE.Points).isPoints === true
      || (o as THREE.Line).isLine === true;
    for (const [object, entry] of catalog) {
      if (entry.route !== 'mesh' && entry.route !== 'sdf') continue;
      if (!isRenderable(object)) continue;
      const mesh = object as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const mat of mats) {
        const verdict = materialEligibility(mat);
        // 'mesh' admits adapted Standard materials and surface producers;
        // 'sdf' admits ONLY surface producers — an unadapted material in the
        // SDF pass has no mrtNode and would write lit colour into attachment
        // 0 of the G-buffer.
        const eligible = entry.route === 'mesh'
          ? (verdict === 'adapt' || verdict === 'asis')
          : verdict === 'asis';
        if (!eligible) {
          reportUnsupported(object, mat, verdict === 'adapt' ? 'standard materials belong to the mesh route' : verdict);
        }
      }
    }
  }

  function recomputeCounts(): Record<GameDrawRoute, number> {
    const counts: Record<GameDrawRoute, number> = { mesh: 0, sdf: 0, forward: 0, exclude: 0 };
    for (const entry of catalog.values()) counts[entry.route]++;
    return counts;
  }

  return {
    register(object, route, receiver) {
      assertAlive();
      if (!GAME_DRAW_ROUTES.includes(route)) {
        throw new RangeError(`unknown game draw route '${route}' (expected ${GAME_DRAW_ROUTES.join('|')})`);
      }
      if (receiver !== undefined && !isShadowReceiver(receiver)) {
        throw new RangeError(`unknown shadow receiver '${String(receiver)}' (expected 'full' | 'level-only')`);
      }
      roots.set(object, { route, receiver, wasAttached: roots.get(object)?.wasAttached ?? false });
    },

    unregister(object) {
      assertAlive();
      roots.delete(object);
    },

    sync() {
      assertAlive();
      // Drop roots whose parent chain left the owned scene (removed/rebuilt
      // actors); tolerate never-attached roots as pending.
      for (const [object, root] of [...roots]) {
        if (isUnderScene(object)) {
          root.wasAttached = true;
        } else if (root.wasAttached) {
          roots.delete(object);
        }
      }
      rebuildCatalog();
      for (const id of reportedLive) unsupported.delete(id);
      reportedLive.clear();
      recomputeDiagnostics();
    },

    draw(route, renderer, camera) {
      assertAlive();
      const restoreVisible: Array<[THREE.Object3D, boolean]> = [];
      const restoreMaterial: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
      try {
        // SCOPING PRIMITIVE. Only RENDERABLES are hidden; groups render
        // nothing themselves and stay visible so members nested under them
        // (a kit mesh under an unregistered group) still draw. A hidden
        // renderable blocks its whole subtree (three's projectObject
        // early-outs on visible=false) — meshes-with-mesh-children of mixed
        // routes do not occur in this game and are not supported. A node the
        // GAME had hidden is never touched: that subtree is intended off.
        const isRenderable = (object: THREE.Object3D): boolean =>
          (object as THREE.Mesh).isMesh === true
          || (object as THREE.Points).isPoints === true
          || (object as THREE.Line).isLine === true;
        const visit = (object: THREE.Object3D): void => {
          if (!object.visible) return; // game-hidden: subtree off, untouched
          const entry = catalog.get(object);
          const member = entry ? entry.route === route : undefined;
          if (!member && isRenderable(object)) {
            // Unregistered renderables are hidden from the G-buffer passes
            // (that is what keeps the cone/occluder/shell/shadow helpers out);
            // forward draws leave unregistered objects alone.
            if (route !== 'forward' || member === false) {
              restoreVisible.push([object, true]);
              object.visible = false;
              return; // a hidden renderable blinds its subtree by design
            }
          }
          if (member === true && route === 'mesh' && isRenderable(object)) {
            const mesh = object as THREE.Mesh;
            if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
              // A renderable that is neither Mesh nor a surface producer
              // (Points/Lines routed mesh) cannot carry the MRT contract.
              // GROUPS never land here — they fall through to their children.
              const k = key(object, (mesh.material ?? mesh) as THREE.Material, 'non-mesh renderable routed mesh');
              if (!unsupported.has(k) && !reportedLive.has(k) && reportedLive.size < MAX_UNSUPPORTED) {
                reportedLive.add(k);
              }
              restoreVisible.push([mesh, true]);
              mesh.visible = false;
              return;
            }
            const mat = mesh.material;
            if (mat !== undefined) {
              // member===true means catalog.get(object) exists (member is
              // derived from it) — the receiver is the effective policy.
              const receiver = (entry as CatalogEntry).receiver ?? 'full';
              const mats = Array.isArray(mat) ? mat : [mat];
              const adapted: THREE.Material[] = [];
              let ok = true;
              for (const src of mats) {
                const verdict = materialEligibility(src);
                if (verdict === 'adapt') {
                  const a = adapterFor(src, receiver);
                  if (a) { adapted.push(a); continue; }
                  ok = false;
                  break;
                }
                if (verdict === 'asis') { adapted.push(src); continue; }
                const k = key(object, src, verdict);
                if (!unsupported.has(k) && !reportedLive.has(k) && reportedLive.size < MAX_UNSUPPORTED) {
                  reportedLive.add(k);
                }
                ok = false;
                break;
              }
              if (ok) {
                restoreMaterial.push([mesh, mat]);
                mesh.material = Array.isArray(mat) ? adapted : adapted[0]!;
              } else {
                // Unsupported member: kept OUT of the pass and reported,
                // never mutated and never silently blackened on screen —
                // the diagnostics list carries the source names.
                restoreVisible.push([mesh, true]);
                mesh.visible = false;
                return;
              }
            }
          }
          if (member === true && route === 'sdf' && isRenderable(object)) {
            // SDF members must be surface producers; anything else is kept
            // out of the pass (an unadapted material has no mrtNode).
            const mesh = object as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
            const producerOnly = mats.every((m) => materialEligibility(m) === 'asis');
            if (!producerOnly) {
              for (const src of mats) {
                if (materialEligibility(src) !== 'asis') {
                  const k = key(object, src, 'standard materials belong to the mesh route');
                  if (!unsupported.has(k) && !reportedLive.has(k) && reportedLive.size < MAX_UNSUPPORTED) {
                    reportedLive.add(k);
                  }
                }
              }
              restoreVisible.push([mesh, true]);
              mesh.visible = false;
              return;
            }
          }
          for (const child of object.children) visit(child);
        };
        visit(scene);
        renderer.render(scene, camera);
      } finally {
        for (const [object, v] of restoreVisible) object.visible = v;
        for (const [mesh, mat] of restoreMaterial) mesh.material = mat;
      }
    },

    diagnostics() {
      if (disposed) {
        return { counts: { mesh: 0, sdf: 0, forward: 0, exclude: 0 }, unsupported: [] };
      }
      return {
        counts: recomputeCounts(),
        unsupported: [...unsupported, ...reportedLive].slice(0, MAX_UNSUPPORTED),
      };
    },

    routeOf(object) {
      return catalog.get(object)?.route ?? null;
    },

    receiverOf(object) {
      return catalog.get(object)?.receiver ?? null;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      roots.clear();
      catalog.clear();
      unsupported.clear();
      reportedLive.clear();
      for (const perReceiver of adapterCache.values()) {
        for (const entry of perReceiver.values()) entry.adapter.dispose();
      }
      adapterCache.clear();
    },
  };
}
