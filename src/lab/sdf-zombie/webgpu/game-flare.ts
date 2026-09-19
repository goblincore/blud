// src/lab/sdf-zombie/webgpu/game-flare.ts
//
// WEAPON SLOT 3: THE FLARE TEST HARNESS (2026-09-18), lifted beside
// game-main.ts. Deliberately minimal: a placeholder model in hand and an
// ignite-on-hit verb. No projectile, no damage, no stagger. The rig is slot 3's
// whole subtree, so the switch is one transform exactly like the other two.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import type { GameBurning } from './game-burning';
import { slotLowerAmount, slotReady } from './game-weapon-slots';

const FLARE_GLB = '/assets/lab/flaregun-placeholder.glb';
const FLARE_REST = {
  pos: new THREE.Vector3(0.055, -0.135, -0.30), rollDeg: 0,
} as const;
/** Seconds between flare shots. Ignition is idempotent, so this is feel only —
 *  it stops one held click from re-firing every frame. */
const FLARE_COOLDOWN_SEC = 0.3;

export interface FlareHarnessDeps {
  burning: GameBurning;
  /** The ballistic slug march, from an arbitrary ray (game-main's
   *  traceSlugHitFrom). */
  traceSlugHitFrom(origin: Vec3, dir: Vec3): { actorId: number };
  eye(): Vec3;
  aimDir(): Vec3;
}

export interface FlareHarness {
  /** A mousedown while slot 3 is live. True = consumed. */
  onMouseDown(button: number): boolean;
  /** The tick's edge consumer (slot 3 is not a recorded DemoFrame verb). */
  consumeEdge(): void;
  tickCooldown(dt: number): void;
  /** Holster travel, from the same slot state the other rigs read. */
  updateRig(): void;
  /** Fire now (console seam). */
  fire(): boolean;
}

export function createFlareHarness(ctx: GameContext, deps: FlareHarnessDeps): FlareHarness {
  const flareRig = new THREE.Group();
  flareRig.name = 'flare-rig';
  ctx.weapon.aimRig!.add(flareRig);
  let pending = false;
  let cooldown = 0;

  // PRIMITIVE FIRST, GLB OVER IT. The reference GLB is a gitignored dev
  // placeholder, so a fresh clone has no file at all — the game must never
  // fail to boot for want of one. This orange cylinder + grip box is the
  // fallback and is replaced (and hidden) the instant the GLB loads.
  const placeholder = new THREE.Group();
  placeholder.name = 'flare-placeholder';
  {
    const orange = new THREE.MeshStandardMaterial({
      color: 0xff6a22, roughness: 0.55, metalness: 0.0,
      emissive: 0x531400, emissiveIntensity: 1,
    });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 16), orange);
    barrel.rotation.x = Math.PI / 2;           // cylinder axis → view -Z
    barrel.position.set(0, 0, -0.02);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.10, 0.05), orange);
    grip.position.set(0, -0.075, 0.035);
    grip.rotation.x = THREE.MathUtils.degToRad(-18);
    placeholder.add(barrel, grip);
  }
  placeholder.position.copy(FLARE_REST.pos);
  placeholder.rotation.y = Math.PI;   // primitive's cylinder axis → -Z
  flareRig.add(placeholder);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(flareRig, 'mesh', 'level-only');

  // Probe, don't gate: load the reference model in the background and swap it
  // in when it arrives. A miss logs once and leaves the primitive in place.
  void (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(FLARE_GLB);
      const root = gltf.scene;
      // Same per-material env the grapeshot takes: PBR metal is black without
      // something to reflect and this page has no environment.
      const pmrem = new THREE.PMREMGenerator(ctx.boot.handle.renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) {
            std.envMap = env; std.envMapIntensity = 1.1; std.needsUpdate = true;
          }
        }
      });
      // Normalise an unknown-unit placeholder: longest axis → 0.24 m, centred
      // on its bounding box, then posed roughly like the grapeshot. The model
      // ships in an unknown orientation, so its LONGEST axis is taken as the
      // barrel and rotated to point down the camera's -Z. Longest-axis order is
      // scale-invariant, and the uniform scale below cannot change it.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      root.scale.setScalar(0.24 / maxDim);
      const centred = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
      root.position.sub(centred);
      const holder = new THREE.Group();
      holder.name = 'flare-model';
      holder.add(root);
      holder.position.copy(FLARE_REST.pos);
      const longY = size.y >= size.x && size.y >= size.z;
      const longX = !longY && size.x >= size.z;
      if (longY) holder.rotation.x = -Math.PI / 2;      // +Y → -Z
      // The reference GLB's barrel is the +X end (owner playtest 2026-09-19:
      // at -90° the barrel pointed back at the player), so +90° sends it down
      // -Z. Re-measure before flipping this if the placeholder asset is replaced.
      else holder.rotation.y = longX ? Math.PI / 2 : Math.PI;
      holder.rotation.z = THREE.MathUtils.degToRad(FLARE_REST.rollDeg);
      flareRig.add(holder);
      placeholder.visible = false;
    } catch {
      // Absent on a fresh clone, which is expected — the primitive is the gun.
      console.warn('[sdf-game] flaregun-placeholder.glb absent or unreadable — using the orange primitive');
    }
  })();

  /**
   * Slot 3's only verb: run the SAME ballistic hit test the grapeshot slug
   * uses and, if it names an actor, set that actor alight. Deliberately NOT a
   * projectile and NOT a hit: no damage, no stagger, no wound.
   */
  function fire(): boolean {
    if (ctx.weapon.slotState.live !== 'flare' || !slotReady(ctx.weapon.slotState)) return false;
    if (cooldown > 0) return false;
    cooldown = FLARE_COOLDOWN_SEC;
    // It is still a weapon: the shot makes a noise and turns heads.
    ctx.weapon.shotAlert = true;
    // FROM THE EYE, not the grapeshot muzzle: the shotgun is holstered while
    // slot 3 is live, so its muzzle has dropped out of frame.
    const hit = deps.traceSlugHitFrom(deps.eye(), deps.aimDir());
    if (hit.actorId >= 0) {
      const a = ctx.world.actors.find(x => x.id === hit.actorId);
      if (a) deps.burning.igniteActor(a);
    }
    return true;
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'flare') return false;
      // Left click only: no second barrel and no projectile to aim.
      if (button === 0) pending = true;
      return true;
    },
    consumeEdge() {
      if (pending) { pending = false; fire(); }
    },
    tickCooldown(dt) { cooldown = Math.max(0, cooldown - dt); },
    updateRig() {
      // The same one-transform holster travel the grapeshot takes, so a switch
      // to and from it reads as putting a gun away.
      const lower = slotLowerAmount(ctx.weapon.slotState, 'flare');
      flareRig.position.set(0, -0.42 * lower, 0.06 * lower);
      flareRig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      flareRig.visible = lower < 0.999;
    },
    fire,
  };
}
