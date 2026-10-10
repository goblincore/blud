// src/lab/sdf-zombie/webgpu/viewmodel-lights.ts
//
// A HELD WEAPON'S OWN LIGHT LIST (extracted from game-flail.ts, which ported it from the censer, commit 8c24de2a; the
// axe, game-axe.ts, is the second user). The torch hangs about 1 m above the eye with a 1.6 decay, so a view model
// 0.5-0.9 m from it renders white: the flail's brown haft measured 84% clipped (docs/dev-notes/2026-09-26-flail/NOTES.md
// "Blow-out"), the axe's 92% (docs/dev-notes/2026-10-04-axe/NOTES.md).
//
// `material.lightsNode` REPLACES the scene's light list for that material (the level does this per room, game-main
// "LEVEL SURFACES"). THE LIST (since 2026-10-08): the scene's ambient and hemisphere lights, the PROXIES of
// near-lights.ts (the few point, spot and directional lights that matter at the eye, copied into fixed lights each
// frame), and the torch. Until then it mirrored the default list, every light the camera sees: on Night Train 69
// lights, 26 with a shadow map, shaded by every pixel of the weapon (docs/dev-notes/2026-10-08-frame-cost).
// `?nearlights=0` puts that list back, for a side-by-side.
//
// THE TORCH is one of two things. `torch: 'fill'` (the flail, the axe): the torch is swapped for a FILL, the torch's
// pose, cone and colour, no falloff, at `fillScale` of its live intensity. `torch: 'real'` (the shotgun and the
// arms, which never had the swap): the flashlight's own spot and its shadow twin, as the default list held them.
//
// Re-listed on events, not polled: at creation (the level's lights and the flashlight exist before the weapons) and
// via relist() when game-main adds the muzzle flash with the gun. With the proxies a re-list finds the same lights
// and changes nothing; the proxies' CONTENTS follow the player every frame (game-main syncs them beside the fill).
// Forward route only (deferred has its own lighting): every call is a no-op in deferred mode.
import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import type { GameContext } from './game-context';
import { FLAIL_FILL_LAYER } from './gib-motion-blur';
import { createNearLights, NEAR_LIGHTS_ON } from './near-lights';

export interface ViewmodelLights {
  /** The list (a LightsNode): point a material's `lightsNode` at it, then track() that material. */
  readonly list: ReturnType<typeof lights>;
  /** A material whose `lightsNode` is `list`: rebuilt whenever the list changes. */
  track(m: THREE.Material): void;
  /** Point every mesh under `root` at the list (a node-material copy per source material, cached). */
  ownLights(root: THREE.Object3D): void;
  /** Point every lit material under `root` at the list IN PLACE, no copy: for meshes whose materials are theirs alone
   *  and are tuned live afterwards (the shotgun: setGunTuning writes its materials). */
  adoptLights(root: THREE.Object3D): void;
  /** Re-list; true when the list changed. */
  relist(): boolean;
  /** The fill takes this frame's torch (call right after flashlight.update(camera)). Returns whether the torch, and so
   *  the fill, is lit; false in deferred mode too. */
  syncFill(): boolean;
}

export function createViewmodelLights(ctx: GameContext, opts: { name: string; fillScale: number; torch?: 'fill' | 'real' }): ViewmodelLights {
  const realTorch = opts.torch === 'real';
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
  const shownInTree = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  /** Whether relist() last found the torch's spot drawn (`torch: 'real'`). */
  let torchListed = false;
  function syncFill(): boolean {
    if (ctx.boot.deferredMode) return false;
    const spot = ctx.lighting.flashlight?.spot;
    if (realTorch) {
      // The real torch is in the list only while its rig shows it (an outdoor rig hides it): follow that here, as
      // three's default list did by itself.
      const on = !!spot && shownInTree(spot);
      if (on !== torchListed) relist();
      return on;
    }
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
  if (!ctx.boot.deferredMode && !realTorch) ctx.boot.handle.scene.add(fill, fill.target);
  // One set of proxies for every held weapon: they are all at the eye.
  const near = ctx.boot.deferredMode || !NEAR_LIGHTS_ON ? null : (ctx.lighting.nearLights ??= createNearLights(ctx));
  const litMaterials = new Set<THREE.Material>();
  function relist(): boolean {
    if (ctx.boot.deferredMode) return false;
    const next: THREE.Light[] = [];
    const torch = ctx.lighting.flashlight;
    const camera = ctx.boot.handle.camera;
    const seen = (l: THREE.Light): boolean => l.layers.test(camera.layers) && shownInTree(l);
    ctx.boot.handle.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (!l.isLight || l === torch?.spot || l === torch?.levelShadow) return;
      // With the proxies only the lights that have no position stay as themselves.
      if (near && !(l as THREE.AmbientLight).isAmbientLight && !(l as THREE.HemisphereLight).isHemisphereLight) return;
      if (seen(l)) next.push(l);
    });
    if (near) { near.rescan(); next.push(...near.proxies); }
    if (realTorch) { for (const l of [torch?.spot, torch?.levelShadow]) if (l && seen(l)) next.push(l); torchListed = !!torch?.spot && shownInTree(torch.spot); }
    else if (fill.parent) next.push(fill);
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
  function adoptLights(root: THREE.Object3D): void {
    if (ctx.boot.deferredMode) return;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        // A material that already carries a list (the flail's, the axe's, a kit's) keeps it.
        if (litMaterials.has(mat) || !isLit(mat) || (mat as unknown as { lightsNode?: unknown }).lightsNode) continue;
        // A core material carries `lightsNode` across three's own conversion to a node material (NodeLibrary
        // fromMaterial copies every enumerable key: kit-lights.ts applyKitBeam relies on the same).
        (mat as unknown as { lightsNode: unknown }).lightsNode = list;
        mat.needsUpdate = true;
        litMaterials.add(mat);
      }
    });
  }
  return { list, track: (m) => { litMaterials.add(m); }, ownLights, adoptLights, relist, syncFill };
}

/** Frames between two passes over the view-model anchor for materials that arrived since (a weapon's model loads
 *  after the gun; a bundle is built when first lit). */
const ADOPT_FRAMES = 120;
let sinceAdopt = 0;

/**
 * EVERYTHING ELSE HELD (the shotgun, the arms, the shells in hand, the bundle, the launcher): one list with the real
 * torch, adopted in place by every lit material under the view-model anchor that has no list of its own (the flail
 * and the axe keep theirs). Called once the gun is in; a no-op in deferred mode and with `?nearlights=0` (those
 * meshes then keep three's default list, as before 2026-10-08).
 */
export function lightHeldMeshes(ctx: GameContext): void {
  if (ctx.boot.deferredMode || !NEAR_LIGHTS_ON) return;
  const held = ctx.weapon.heldLights ??= createViewmodelLights(ctx, { name: 'held-near', fillScale: 0, torch: 'real' });
  held.relist();
  held.adoptLights(ctx.weapon.viewModelAnchor);
  sinceAdopt = 0;
}

/** Per frame, right after flashlight.update(camera): the proxies take the lights at the eye, and the held list follows
 *  the torch's rig. */
export function syncHeldLights(ctx: GameContext, camera: THREE.Camera): void {
  ctx.lighting.nearLights?.sync(camera);
  const held = ctx.weapon.heldLights;
  if (!held) return;
  held.syncFill();
  if (++sinceAdopt >= ADOPT_FRAMES) { sinceAdopt = 0; held.adoptLights(ctx.weapon.viewModelAnchor); }
}

function isLit(mat: THREE.Material): boolean {
  const f = mat as unknown as Record<string, unknown>;
  if (f.isNodeMaterial === true) return f.lights === true;
  return f.isMeshStandardMaterial === true || f.isMeshLambertMaterial === true || f.isMeshPhongMaterial === true;
}
