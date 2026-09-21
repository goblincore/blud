// src/lab/sdf-zombie/webgpu/game-state-weapon.ts
//
// WEAPON slice of the sdf-game GameContext decomposition. It lifts the
// shotgun/dynamite rig state that used to be `let`/`const` bindings inside
// main() in game-main.ts into one addressable object: the gun rig handles
// (groups, nodes, materials, the arms), the muzzle flash and its point light,
// the aim/slide/recoil scalars, the magazine, reload and burst state, the
// pellet and tracer views, the weapon-slot machine and the in-hand prop.
//
// Shape mirrors game-state-boot.ts / game-state-lighting.ts (and
// game-weapon-slots.ts before them): interface + factory + a binding map the
// codemod consumes. Fields are PLAIN MUTABLE values — no getters, setters,
// `readonly` or freezing — because the codemod rewrites `let x = y` into
// `ctx.weapon.x = y` in place, and any accessor would change evaluation timing
// around the pixel gate.
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js/WebGPU dependency. Computed
// initializers (`new THREE.Group()`, `makeWeaponSlotState(...)`,
// `MAGAZINE_CAPACITY`, the `?ammo` / `?slug` URL reads) get a type-correct
// placeholder in the factory; the in-place assignment at the binding's
// original line supplies the real value before any code reads it.
//
// `TracerView` and `BurstSlot` are declared here because game-main.ts declares
// them INSIDE main() and does not export them, and the codemod needs the fields
// to stay structurally usable after the rewrite.

import type { FlareHarness } from './game-flare';
import type * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import type { StickProp } from './fpv-view';
import type { AimPoint } from './free-aim';
import type { GoblinArms } from './game-arms';
import type { Projectile } from './game-weapon';
import type { WeaponSlotState } from './game-weapon-slots';

/** `game-main.ts`'s local `TracerView`: a tracer's two billboard quads. */
interface TracerView {
  streak: THREE.Mesh;
  ember: THREE.Mesh;
}

/** `game-main.ts`'s local `BurstSlot`: one pooled muzzle-burst sprite triplet. */
interface BurstSlot {
  core: THREE.Sprite;
  halo: THREE.Sprite;
  smoke: THREE.Sprite;
  age: number;
  life: number;
  h: number;
}

/**
 * Placeholder for a binding whose real value is a live Three.js/weapon handle
 * built at that binding's original line. The field is non-null in game-main.ts,
 * so the placeholder must satisfy the declared type even though no code reads
 * it before the original assignment runs.
 */
function unbuilt<T>(): T {
  return null as unknown as T;
}

/** Mutable state owned by the weapon slice. */
export interface WeaponState {
  /** Seconds since the muzzle flash fired; `Infinity` = idle. */
  flashAge: number;
  /** Point light at the muzzle, or null before the rig is built. */
  muzzleLight: THREE.PointLight | null;
  /** True while a recent shot has the world alert. */
  shotAlert: boolean;
  /** Queued fire request, or 0. */
  pendingFire: 0 | 1 | 2;
  /** True while a reload has been requested but not yet started. */
  pendingReload: boolean;
  /**
   * The view model's FOV-compensation rig: the camera's own child, carrying
   * nothing but the non-uniform scale from viewmodelFovScale() so the
   * weapons stay framed as authored whatever the world FOV is. Everything
   * else — viewModelAnchor and down — hangs off THIS, not off the camera, so
   * the anchor's own ride height is scaled with the rest of the rig.
   */
  fovRig: THREE.Group;
  /** Root the whole view model hangs from; the codemod supplies the real group. */
  viewModelAnchor: THREE.Group;
  /** The aim (yaw/pitch) pivot for the gun rig, or null before it is built. */
  aimRig: THREE.Group | null;
  /** Slot 3 (flare test harness, game-flare.ts); null until the aim rig exists. */
  flare: FlareHarness | null;
  /** The gun's own rig group; the codemod supplies the real group. */
  gunRig: THREE.Group;
  /** The top-lever hinge pivot, or null before it is built. */
  hingePivot: THREE.Group | null;
  /** Muzzle-flash anchor nodes, one per barrel. */
  muzzleNodes: THREE.Object3D[];
  /** Ejected-shell anchor nodes, one per shell in the magazine. */
  shellNodes: THREE.Object3D[];
  /** Breech anchor nodes the loaded shells sit in. */
  breechNodes: THREE.Object3D[];
  /** The extractor claw node, or null before it is built. */
  extractorNode: THREE.Object3D | null;
  /** The top-lever node, or null before it is built. */
  topLeverNode: THREE.Object3D | null;
  /** Per-shell rest Z along the tube; filled when the rig is built. */
  shellRestZ: number[];
  /** The extractor's rest Z along the tube. */
  extractorRestZ: number;
  /** The support hand group, or null before it is built. */
  gripHandGroup: THREE.Group | null;
  /** The fore hand group, or null before it is built. */
  foreHandGroup: THREE.Group | null;
  /** The gun geometry group, or null before it is built. */
  gunGroup: THREE.Group | null;
  /** The muzzle-flash group, or null before it is built. */
  flashGroup: THREE.Group | null;
  /** The muzzle-flash material, or null before it is built. */
  flashMaterial: THREE.MeshBasicMaterial | null;
  /** Alias of the muzzle point light; null before it is built. */
  flashLight: THREE.PointLight | null;
  /** The arms' hand material, or null before it is built. */
  handMaterial: THREE.MeshStandardMaterial | null;
  /** The goblin arms rig, or null when the arms failed to load. */
  arms: GoblinArms | null;
  /** Per-material list the gun shares for its env/env-intensity pass. */
  gunMaterials: THREE.MeshStandardMaterial[];
  /** Procedural muzzle-flash textures, one per frame. */
  flashTextures: THREE.DataTexture[];
  /** Pooled ejected-shell groups. */
  ejectedShells: THREE.Group[];
  /** Pooled loaded-shell groups (the shells still in the magazine). */
  loadShells: THREE.Group[];
  /** World origin of the last ejection, or null before the first shot. */
  lastEjectOrigin: Vec3 | null;
  /** Seconds since the last shot; `Infinity` = never fired. */
  fireAge: number;
  /** Barrels fired by the current shot: 1 = single, 2 = both. */
  fireBarrels: 1 | 2;
  /** Aim point, in the free-aim convention. Fresh per factory call. */
  aim: AimPoint;
  /** Weapon yaw, in degrees. */
  yawDeg: number;
  /** Weapon pitch, in degrees. */
  pitchDeg: number;
  /** Weapon lateral slide, in metres. */
  slideXm: number;
  /** Weapon vertical slide, in metres. */
  slideYm: number;
  /** True once the gun GLB and its rig are ready. */
  gunReady: boolean;
  /** Resolves when the gun finishes loading (or fails and boots anyway). */
  gunReadyPromise: Promise<void>;
  /** Live player pellets in flight. */
  pellets: Projectile[];
  /** Live soldier pellets in flight. */
  soldierPellets: Projectile[];
  /** Tracer views for the soldier pellets, pooled. */
  soldierPelletViews: TracerView[];
  /** The one shared plane geometry every tracer quad reuses. */
  pelletGeo: THREE.PlaneGeometry;
  /** Tracer views for the player pellets, pooled. */
  pelletViews: TracerView[];
  /** Seconds until the next shot is allowed. */
  cooldown: number;
  /** Shells left in the magazine; the codemod supplies `MAGAZINE_CAPACITY`. */
  shells: number;
  /** `?ammo` — true unless `?ammo=finite` was passed. */
  infiniteAmmo: boolean;
  /** Seconds into the reload animation; `Infinity` = not reloading. */
  reloadAge: number;
  /** Seed handed to the shell staging for the current reload. */
  reloadSeed: number;
  /** Reload seed pinned by a diagnostic capture, or null. */
  pinnedReloadSeed: number | null;
  /** Reload animation speed multiplier (`?reloadspeed`). */
  reloadSpeed: number;
  /** Recoil pitch applied to the gun this shot, in radians. */
  recoilPitch: number;
  /** `?slug` — true when the single-slug round is selected. */
  slugMode: boolean;
  /** The shotgun/dynamite three-phase switch machine. */
  slotState: WeaponSlotState;
  /** The dynamite prop currently in hand, or null while one is in flight. */
  heldProp: StickProp | null;
  /** Pooled muzzle-burst sprite triplets. */
  burstSlots: BurstSlot[];
  /** Round-robin cursor into `burstSlots`. */
  burstCursor: number;
}

/** Every call returns a fresh object, nested arrays and objects included. */
export function makeWeaponState(): WeaponState {
  return {
    flashAge: Infinity,
    muzzleLight: null,
    shotAlert: false,
    pendingFire: 0,
    pendingReload: false,
    fovRig: unbuilt<THREE.Group>(),
    viewModelAnchor: unbuilt<THREE.Group>(),
    aimRig: null,
    flare: null,
    gunRig: unbuilt<THREE.Group>(),
    hingePivot: null,
    muzzleNodes: [],
    shellNodes: [],
    breechNodes: [],
    extractorNode: null,
    topLeverNode: null,
    shellRestZ: [],
    extractorRestZ: 0,
    gripHandGroup: null,
    foreHandGroup: null,
    gunGroup: null,
    flashGroup: null,
    flashMaterial: null,
    flashLight: null,
    handMaterial: null,
    arms: null,
    gunMaterials: [],
    flashTextures: [],
    ejectedShells: [],
    loadShells: [],
    lastEjectOrigin: null,
    fireAge: Infinity,
    fireBarrels: 1,
    aim: { x: 0, y: 0 },
    yawDeg: 0,
    pitchDeg: 0,
    slideXm: 0,
    slideYm: 0,
    gunReady: false,
    gunReadyPromise: Promise.resolve(),
    pellets: [],
    soldierPellets: [],
    soldierPelletViews: [],
    pelletGeo: unbuilt<THREE.PlaneGeometry>(),
    pelletViews: [],
    cooldown: 0,
    shells: 0,
    infiniteAmmo: false,
    reloadAge: Infinity,
    reloadSeed: 0,
    pinnedReloadSeed: null,
    reloadSpeed: 1,
    recoilPitch: 0,
    slugMode: false,
    slotState: unbuilt<WeaponSlotState>(),
    heldProp: null,
    burstSlots: [],
    burstCursor: 0,
  };
}

/** Old `game-main.ts` binding name → path on the `weapon` slice. */
export const WEAPON_BINDINGS = {
  flashAge: 'weapon.flashAge',
  muzzleLight: 'weapon.muzzleLight',
  shotAlert: 'weapon.shotAlert',
  pendingFire: 'weapon.pendingFire',
  pendingReload: 'weapon.pendingReload',
  fovRig: 'weapon.fovRig',
  viewModelAnchor: 'weapon.viewModelAnchor',
  aimRig: 'weapon.aimRig',
  gunRig: 'weapon.gunRig',
  hingePivot: 'weapon.hingePivot',
  muzzleNodes: 'weapon.muzzleNodes',
  shellNodes: 'weapon.shellNodes',
  breechNodes: 'weapon.breechNodes',
  extractorNode: 'weapon.extractorNode',
  topLeverNode: 'weapon.topLeverNode',
  shellRestZ: 'weapon.shellRestZ',
  extractorRestZ: 'weapon.extractorRestZ',
  gripHandGroup: 'weapon.gripHandGroup',
  foreHandGroup: 'weapon.foreHandGroup',
  gunGroup: 'weapon.gunGroup',
  flashGroup: 'weapon.flashGroup',
  flashMaterial: 'weapon.flashMaterial',
  flashLight: 'weapon.flashLight',
  handMaterial: 'weapon.handMaterial',
  arms: 'weapon.arms',
  gunMaterials: 'weapon.gunMaterials',
  flashTextures: 'weapon.flashTextures',
  ejectedShells: 'weapon.ejectedShells',
  loadShells: 'weapon.loadShells',
  lastEjectOrigin: 'weapon.lastEjectOrigin',
  fireAge: 'weapon.fireAge',
  fireBarrels: 'weapon.fireBarrels',
  aim: 'weapon.aim',
  weaponYawDeg: 'weapon.yawDeg',
  weaponPitchDeg: 'weapon.pitchDeg',
  weaponSlideXm: 'weapon.slideXm',
  weaponSlideYm: 'weapon.slideYm',
  gunReady: 'weapon.gunReady',
  gunReadyPromise: 'weapon.gunReadyPromise',
  pellets: 'weapon.pellets',
  soldierPellets: 'weapon.soldierPellets',
  soldierPelletViews: 'weapon.soldierPelletViews',
  pelletGeo: 'weapon.pelletGeo',
  pelletViews: 'weapon.pelletViews',
  cooldown: 'weapon.cooldown',
  shells: 'weapon.shells',
  infiniteAmmo: 'weapon.infiniteAmmo',
  reloadAge: 'weapon.reloadAge',
  reloadSeed: 'weapon.reloadSeed',
  pinnedReloadSeed: 'weapon.pinnedReloadSeed',
  reloadSpeed: 'weapon.reloadSpeed',
  recoilPitch: 'weapon.recoilPitch',
  slugMode: 'weapon.slugMode',
  slotState: 'weapon.slotState',
  heldProp: 'weapon.heldProp',
  burstSlots: 'weapon.burstSlots',
  burstCursor: 'weapon.burstCursor',
} as const;
