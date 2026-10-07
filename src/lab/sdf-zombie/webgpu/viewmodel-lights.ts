// src/lab/sdf-zombie/webgpu/viewmodel-lights.ts
//
// A HELD WEAPON'S OWN LIGHT LIST (extracted from game-flail.ts, which ported it from the censer, commit 8c24de2a; the
// axe, game-axe.ts, is the second user). The torch hangs about 1 m above the eye with a 1.6 decay, so a view model
// 0.5-0.9 m from it renders white: the flail's brown haft measured 84% clipped (docs/dev-notes/2026-09-26-flail/NOTES.md
// "Blow-out"), the axe's 92% (docs/dev-notes/2026-10-04-axe/NOTES.md).
//
// `material.lightsNode` REPLACES the scene's light list for that material (the level does this per room, game-main
// "LEVEL SURFACES"). This list mirrors the default one -- every light the camera sees whose whole ancestor chain is
// visible -- EXCEPT the torch, which is swapped for a FILL: the torch's pose, cone and colour, no falloff, at
// `fillScale` of its live intensity. Re-listed on events, not polled: at creation (the level's lights and the
// flashlight exist before the weapons) and via relist() when game-main adds the muzzle flash with the gun. Forward
// route only (deferred has its own lighting): every call is a no-op in deferred mode.
import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import type { GameContext } from './game-context';
import { FLAIL_FILL_LAYER } from './gib-motion-blur';

export interface ViewmodelLights {
  /** The list (a LightsNode): point a material's `lightsNode` at it, then track() that material. */
  readonly list: ReturnType<typeof lights>;
  /** A material whose `lightsNode` is `list`: rebuilt whenever the list changes. */
  track(m: THREE.Material): void;
  /** Point every mesh under `root` at the list (a node-material copy per source material, cached). */
  ownLights(root: THREE.Object3D): void;
  /** Re-list; true when the list changed. */
  relist(): boolean;
  /** The fill takes this frame's torch (call right after flashlight.update(camera)). Returns whether the torch, and so
   *  the fill, is lit; false in deferred mode too. */
  syncFill(): boolean;
}

export function createViewmodelLights(ctx: GameContext, opts: { name: string; fillScale: number }): ViewmodelLights {
  const list = lights([]);
  let listed: THREE.Light[] = [];
  // THE FILL: on a layer no camera renders (so three's default per-camera lists skip it) and with `onlyRooms` empty
  // (so the level's per-room lists skip it too -- game-level-lights levelSceneLights). Parented to the scene root,
  // never hidden; its pose and intensity follow the torch every frame (syncFill).
  const fill = new THREE.SpotLight(0xffffff, 0, 16, Math.PI * 0.12, 0.45, 0);
  fill.name = opts.name;
  fill.castShadow = false;
  fill.layers.set(FLAIL_FILL_LAYER);
  fill.userData.onlyRooms = new Set<number>();
  fill.target.layers.set(FLAIL_FILL_LAYER);
  const _fp = new THREE.Vector3();
  function syncFill(): boolean {
    if (ctx.boot.deferredMode) return false;
    const spot = ctx.lighting.flashlight?.spot;
    if (!spot || !spot.visible) { fill.intensity = 0; return false; }   // the torch is off in this rig (outdoor)
    spot.updateMatrixWorld();
    spot.target.updateMatrixWorld();
    fill.position.copy(spot.getWorldPosition(_fp));
    fill.target.position.copy(spot.target.getWorldPosition(_fp));
    fill.color.copy(spot.color);
    fill.angle = spot.angle;
    fill.penumbra = spot.penumbra;
    fill.distance = spot.distance;
    fill.intensity = spot.intensity * opts.fillScale;
    fill.updateMatrixWorld();
    fill.target.updateMatrixWorld();
    return true;
  }
  if (!ctx.boot.deferredMode) ctx.boot.handle.scene.add(fill, fill.target);
  const litMaterials = new Set<THREE.Material>();
  const shownInTree = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  function relist(): boolean {
    if (ctx.boot.deferredMode) return false;
    const next: THREE.Light[] = [];
    const torch = ctx.lighting.flashlight;
    const camera = ctx.boot.handle.camera;
    ctx.boot.handle.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (!l.isLight || l === torch?.spot || l === torch?.levelShadow) return;
      if (l.layers.test(camera.layers) && shownInTree(l)) next.push(l);
    });
    if (fill.parent) next.push(fill);
    if (next.length === listed.length && next.every((l, i) => l === listed[i])) return false;
    listed = next;
    list.setLights(next);
    // setLights() does not bump the node's version, so the materials' cache keys would never change and three would
    // never rebuild them with the new list: bump the node, then the materials (the censer's verified fix).
    list.needsUpdate = true;
    for (const m of litMaterials) m.needsUpdate = true;
    return true;
  }
  const library = ctx.boot.handle.renderer.library as unknown as { fromMaterial(m: THREE.Material): THREE.NodeMaterial | null };
  const lit = new Map<THREE.Material, THREE.Material>();
  function ownLights(root: THREE.Object3D): void {
    if (ctx.boot.deferredMode) return;
    const conv = (m: THREE.Material): THREE.Material => {
      let nm = lit.get(m);
      if (!nm) {
        // A material that is ALREADY a node material (the goblin skin) may be shared with other meshes: give this
        // weapon its own copy rather than re-point someone else's lights.
        const node = (m as THREE.NodeMaterial).isNodeMaterial
          ? (m as THREE.NodeMaterial).clone() as THREE.NodeMaterial
          : library.fromMaterial(m);
        if (!node) return m;
        node.lightsNode = list;
        lit.set(m, node);
        lit.set(node, node);
        litMaterials.add(node);
        nm = node;
      }
      return nm;
    };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    });
  }
  return { list, track: (m) => { litMaterials.add(m); }, ownLights, relist, syncFill };
}
