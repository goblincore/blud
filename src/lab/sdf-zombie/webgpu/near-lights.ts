// src/lab/sdf-zombie/webgpu/near-lights.ts
//
// THE LIGHTS NEAR THE EYE, AS A FIXED SET OF PROXY LIGHTS: a few point, spot and directional lights that copy, every
// frame, the scene lights that matter where the player stands (near-light-pick.ts ranks them). A light list built
// from the proxies never changes its membership, so the materials that use it are never rebuilt, however the real
// lights come and go around the player.
//
// WHO USES IT. viewmodel-lights.ts: the held weapons (shotgun, flail, axe) and the player's arms. Before this they
// shaded three's default list, every light of the level (near-light-pick.ts has the numbers).
//
// WHAT A PROXY IS NOT. It casts no shadow: a tube's shadow map no longer falls on the gun (the torch keeps its own
// light and shadow; viewmodel-lights.ts lists it beside the proxies). And only the strongest NEAR_SLOTS lights at the
// eye are carried; in the carriages that is every light of the room.
//
// THE PROXIES ARE IN NO OTHER LIST: they sit on FLAIL_FILL_LAYER, which no camera renders (three's per-camera lists
// skip them), and carry an empty `onlyRooms` (the level's per-room lists skip them, game-level-lights). They are in
// the scene graph only so that their matrices exist.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import { FLAIL_FILL_LAYER } from './gib-motion-blur';
import { accentRoomsFor } from './game-level-lights';
import { roomIdAt } from './game-level-rooms';
import { pickNearLights, type NearLightCand, type NearLightSlots } from './near-light-pick';

/** Proxies per kind. A carriage holds 2 to 4 shadowed tubes and its own and its neighbours' accents; the Boiler Room,
 *  the largest, 4 tubes and 2 beacons. Directional: the ring's key light, a window's storm light, the moon. */
export const NEAR_SLOTS = { point: 6, spot: 4, directional: 2 } as const;
/** `?nearlights=0`: the held weapons and the arms shade three's whole default list again (the A/B). Read once. */
export const NEAR_LIGHTS_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('nearlights') !== '0';
/** Frames between two walks of the scene for its lights (they are made at boot and pooled, never added in play; the
 *  walk is insurance, and relist() forces one). */
const RESCAN_FRAMES = 120;

export interface NearLights {
  /** The proxies, in a fixed order. */
  readonly proxies: readonly THREE.Light[];
  /** Fill the proxies for this frame (after the camera has moved). */
  sync(camera: THREE.Camera): void;
  /** Walk the scene for its lights at the next sync (a light was added). */
  rescan(): void;
  /** What each proxy holds: the real light's name or type, null for an empty slot. */
  slots(): { point: (string | null)[]; spot: (string | null)[]; directional: (string | null)[]; candidates: number };
}

const luma = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export function createNearLights(ctx: GameContext): NearLights {
  const scene = ctx.boot.handle.scene;
  const own = (l: THREE.Light): void => {
    l.castShadow = false;
    l.layers.set(FLAIL_FILL_LAYER);
    l.userData.onlyRooms = new Set<number>();
    l.userData.nearProxy = true;
  };
  const points = Array.from({ length: NEAR_SLOTS.point }, (_, i) => { const l = new THREE.PointLight(0xffffff, 0, 0, 2); l.name = `near-point-${i}`; own(l); return l; });
  const spots = Array.from({ length: NEAR_SLOTS.spot }, (_, i) => { const l = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0, 2); l.name = `near-spot-${i}`; own(l); l.target.layers.set(FLAIL_FILL_LAYER); return l; });
  const dirs = Array.from({ length: NEAR_SLOTS.directional }, (_, i) => { const l = new THREE.DirectionalLight(0xffffff, 0); l.name = `near-directional-${i}`; own(l); l.target.layers.set(FLAIL_FILL_LAYER); return l; });
  for (const l of points) scene.add(l);
  for (const l of [...spots, ...dirs]) scene.add(l, l.target);

  let real: (THREE.PointLight | THREE.SpotLight)[] = [];
  let realDirs: THREE.DirectionalLight[] = [];
  let stale = true, sinceScan = 0;
  let prev: NearLightSlots | undefined;
  let held: { point: (THREE.Light | null)[]; spot: (THREE.Light | null)[]; directional: (THREE.Light | null)[] } = { point: [], spot: [], directional: [] };
  const shown = (o: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };

  function scan(camera: THREE.Camera): void {
    const torch = ctx.lighting.flashlight;
    real = []; realDirs = [];
    scene.traverse((o) => {
      const l = o as THREE.Light;
      // The same lights three's default list holds (on the camera's layers), less the torch, which keeps its own
      // entry in the viewmodel's list.
      if (!l.isLight || l.userData.nearProxy || !l.layers.test(camera.layers)) return;
      if (l === torch?.spot || l === torch?.levelShadow) return;
      if ((l as THREE.PointLight).isPointLight || (l as THREE.SpotLight).isSpotLight) real.push(l as THREE.PointLight | THREE.SpotLight);
      else if ((l as THREE.DirectionalLight).isDirectionalLight) realDirs.push(l as THREE.DirectionalLight);
    });
    stale = false; sinceScan = 0;
  }

  const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _eye = new THREE.Vector3();
  function sync(camera: THREE.Camera): void {
    if (ctx.boot.deferredMode) return;
    if (stale || ++sinceScan >= RESCAN_FRAMES) scan(camera);
    camera.getWorldPosition(_eye);
    const eye: Vec3 = [_eye.x, _eye.y, _eye.z];
    // A room's walls shade its own lights and its neighbours' (game-level-lights accentRoomsFor); so does the hand.
    // In a tunnel or the void (no room) every light is a candidate: distance alone ranks them.
    const room = roomIdAt(ctx, eye[0], eye[2]);
    const allowed = room >= 0 ? accentRoomsFor(ctx, room) : null;
    const inReach = (l: THREE.Light): boolean => {
      if (!allowed) return true;
      const accent = l.userData.accentRoom as number | undefined;
      if (accent !== undefined && !allowed.has(accent)) return false;
      const only = l.userData.onlyRooms as ReadonlySet<number> | undefined;
      if (only !== undefined) { let any = false; for (const r of only) if (allowed.has(r)) { any = true; break; } if (!any) return false; }
      return true;
    };
    const byId = new Map<number, THREE.PointLight | THREE.SpotLight>();
    const cands: NearLightCand[] = [];
    for (const l of real) {
      if (!(l.intensity > 0) || !inReach(l) || !shown(l)) continue;
      l.getWorldPosition(_p);
      const c: NearLightCand = { id: l.id, kind: (l as THREE.SpotLight).isSpotLight ? 'spot' : 'point', pos: [_p.x, _p.y, _p.z], power: l.intensity * luma(l.color), distance: l.distance, decay: l.decay };
      if (c.kind === 'spot') {
        const s = l as THREE.SpotLight;
        s.target.getWorldPosition(_t).sub(_p);
        const len = _t.length();
        if (len > 1e-6) { c.axis = [_t.x / len, _t.y / len, _t.z / len]; c.cosOuter = Math.cos(s.angle); }
      }
      cands.push(c); byId.set(l.id, l);
    }
    prev = pickNearLights(cands, eye, NEAR_SLOTS, prev);
    held = { point: [], spot: [], directional: [] };
    prev.point.forEach((id, i) => {
      const src = id >= 0 ? byId.get(id) as THREE.PointLight | undefined : undefined, dst = points[i]!;
      held.point.push(src ?? null);
      if (!src) { dst.intensity = 0; return; }
      src.getWorldPosition(dst.position);
      dst.color.copy(src.color); dst.intensity = src.intensity; dst.distance = src.distance; dst.decay = src.decay;
      dst.updateMatrixWorld();
    });
    prev.spot.forEach((id, i) => {
      const src = id >= 0 ? byId.get(id) as THREE.SpotLight | undefined : undefined, dst = spots[i]!;
      held.spot.push(src ?? null);
      if (!src) { dst.intensity = 0; return; }
      src.getWorldPosition(dst.position);
      src.target.getWorldPosition(dst.target.position);
      dst.color.copy(src.color); dst.intensity = src.intensity; dst.distance = src.distance; dst.decay = src.decay;
      dst.angle = src.angle; dst.penumbra = src.penumbra;
      dst.updateMatrixWorld(); dst.target.updateMatrixWorld();
    });
    // Directional lights have no distance: the brightest ones the player's room is lit by (a window's storm light,
    // the moon in an open room).
    const lit = realDirs.filter((l) => l.intensity > 0 && inReach(l) && shown(l)).sort((a, b) => b.intensity * luma(b.color) - a.intensity * luma(a.color) || a.id - b.id);
    dirs.forEach((dst, i) => {
      const src = lit[i];
      held.directional.push(src ?? null);
      if (!src) { dst.intensity = 0; return; }
      src.getWorldPosition(dst.position);
      src.target.getWorldPosition(dst.target.position);
      dst.color.copy(src.color); dst.intensity = src.intensity;
      dst.updateMatrixWorld(); dst.target.updateMatrixWorld();
    });
  }
  const nameOf = (l: THREE.Light | null): string | null => (l ? l.name || l.type : null);
  return {
    proxies: [...points, ...spots, ...dirs],
    sync,
    rescan: () => { stale = true; },
    slots: () => ({ point: held.point.map(nameOf), spot: held.spot.map(nameOf), directional: held.directional.map(nameOf), candidates: real.length + realDirs.length }),
  };
}
