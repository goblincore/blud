import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Weapon, FrameCtx, ViewCtx, HudCtx } from './types';
import type { Vec3 } from '../gibs/particles';
import { DYNAMITE_COOK, EXPLOSION_STANDARD } from '../gibs/tuning';
import { SfxEvent } from '../../audio/events';

// ——— Projectile billboard rendering (flying dynamite bundle sprite) ————
//
// Authentic Blood behavior (see docs/dev-notes/2026-04-22-notblood-source-reference.md,
// "Thrown TNT projectile in flight" section):
//   - Thrown bundle is a face-aligned billboard (cstat=256, no alignment flags).
//   - pSprite->ang is set once at spawn and never updated — no tumble.
//   - "Liveness" comes from SEQ-driven picnum cycling through fuse-burn frames
//     (bundle frames 3432→3435; stick frames 3422→3427).
//
// Blud deviation: in addition to authentic fuse-frame cycling, we add a mild
// screen-space spin (around the camera-forward axis, i.e. the mesh's local +Z
// after lookAt) for modern trajectory readability. This preserves the 2D-sprite
// aesthetic — the bundle always faces the camera, it just rotates in the
// screen plane.

let projectileScene: THREE.Scene | null = null;
let projectileFrames: THREE.Texture[] = [];
let projectileCamera: THREE.Camera | null = null;

/**
 * Configure the shared resources used by all live projectiles.
 *
 * @param frames Ordered list of fuse-burn frame textures, from "just-thrown"
 *   (full fuse) to "about-to-detonate" (fuse exhausted). Blood bundle order:
 *   3432 → 3433 → 3434 → 3435. A single-element array is valid (no cycling).
 */
export function configureProjectileRendering(scene: THREE.Scene, frames: THREE.Texture[]): void {
  projectileScene = scene;
  projectileFrames = frames;
}
export function setProjectileCamera(cam: THREE.Camera): void { projectileCamera = cam; }

// ——— Pure math (TDD'd) ————————————————————————————————

export function chargeFraction(heldSec: number): number {
  return Math.max(0, Math.min(1, heldSec / DYNAMITE_COOK.maxChargeSec));
}

export function throwVelocityMps(chargeFrac: number): number {
  const c = Math.max(0, Math.min(1, chargeFrac));
  return DYNAMITE_COOK.minVelocityMps
       + c * (DYNAMITE_COOK.maxVelocityMps - DYNAMITE_COOK.minVelocityMps);
}

export function remainingFuse(cookSec: number): number {
  return DYNAMITE_COOK.fuseMaxSec - cookSec;
}

/**
 * Select which fuse-burn frame to show given remaining fuse.
 *
 * Maps fuse-remaining fraction to a frame index: full fuse → frame 0, no fuse
 * left → last frame. Matches Blood SEQ progression for bundle tiles
 * 3432 (fresh) → 3435 (about to detonate).
 *
 * Pure function, TDD'd.
 */
export function fuseFrameIndex(fuseLeft: number, fuseMax: number, numFrames: number): number {
  if (numFrames <= 1) return 0;
  if (fuseMax <= 0) return numFrames - 1;
  const frac = Math.max(0, Math.min(1, fuseLeft / fuseMax));
  const idx = Math.floor((1 - frac) * numFrames);
  return Math.min(idx, numFrames - 1);
}

/**
 * Build the throw velocity vector.
 *
 * Port of Blood's `actFireThing` dispatch (actor.cpp:7106):
 *   xvel, yvel = nSpeed * cos/sin(ang)
 *   zvel       = nSpeed * (slope + -9460)
 *
 * We take the player's forward vector (already includes yaw + pitch from look),
 * rotate it *upward* by `pitchLobDeg` around the player's right axis (so it
 * stays aim-relative regardless of pitch), then scale by `speed`.
 *
 * Result: aiming level → ~30° arc, aiming up → ~30° higher still, aiming
 * straight down → the lob pulls it back up to ~-60° instead of vertical,
 * which matches how Blood's throw always has an upward bias on top of aim.
 */
export function throwVector(
  forward: Vec3,
  speed: number,
  pitchLobDeg: number = DYNAMITE_COOK.pitchLobDeg,
): Vec3 {
  // Normalize forward (caller should pass unit vectors, but guard anyway).
  const fLen = Math.hypot(forward.x, forward.y, forward.z) || 1;
  const fx = forward.x / fLen;
  const fy = forward.y / fLen;
  const fz = forward.z / fLen;

  // Player's "right" axis is forward × worldUp (Y-up, right-handed):
  //   (fx, fy, fz) × (0, 1, 0) = (-fz, 0, fx)
  // Only the horizontal components matter for the right-axis direction.
  const rLen = Math.hypot(fz, fx) || 1;
  const rx = -fz / rLen;
  const rz = fx / rLen;

  // Rotate forward around `right` by +pitchLobDeg (upward).
  // Rodrigues: v' = v cosθ + (r × v) sinθ + r (r·v)(1 - cosθ)
  // r·v = rx*fx + 0*fy + rz*fz = (fz*fx + -fx*fz)/rLen = 0, so the last term drops.
  // r × v = (0*fz - rz*fy, rz*fx - rx*fz, rx*fy - 0*fx)
  //       = (-rz*fy, rz*fx - rx*fz, rx*fy)
  const theta = (pitchLobDeg * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const crossX = -rz * fy;
  const crossY = rz * fx - rx * fz;
  const crossZ = rx * fy;

  const dx = fx * cosT + crossX * sinT;
  const dy = fy * cosT + crossY * sinT;
  const dz = fz * cosT + crossZ * sinT;

  return { x: dx * speed, y: dy * speed, z: dz * speed };
}

// ——— Projectile (per-shot entity) ——————————————————————

interface DynamiteProjectile {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh | null;
  fuseLeft: number;
  fuseMax: number;        // for frame-cycle math; captured at spawn
  spinRate: number;       // rad/s, signed — screen-space spin
  spinPhase: number;      // cumulative rad; applied after lookAt each frame
  lastFrameIdx: number;   // last-applied texture index, to skip redundant swaps
  spawnTime: number;
  spawnPos: Vec3;         // captured at spawn — used to gate impact checks behind a
                          // displacement threshold so the projectile doesn't self-detonate
                          // on the player's own collider when it spawns inside the hand.
  impactMode: boolean;    // true: detonate on first collider contact (NotBlood primary fire);
                          // false: pure fuse-countdown (used by selfExplode at-feet drop).
}

/** Global registry of live dynamite projectiles; ticked each frame from dynamite.ts */
const liveProjectiles: DynamiteProjectile[] = [];

/**
 * Spawn a dynamite projectile. Called by Dynamite.onRelease and Dynamite.selfExplode.
 * If `fuseLeft` is ≤ 0 the projectile detonates on the first tick (in-flight = 0 s).
 *
 * `impactMode` (default true) routes through NotBlood's primary-fire path: the
 * projectile detonates on first collider contact after a 50 ms grace period
 * (so the projectile clears the player's hand). The fuse timer becomes a
 * safety-timeout — projectiles that miss everything still detonate eventually.
 * Set `impactMode=false` for pure fuse-countdown drops (alt-fire path / suicide
 * bomb / future ProxBomb-style variants).
 *
 * Source: NotBlood weapon.cpp:2728 sets fuseTime=-1 from idle-state-3-bShoot
 * (primary fire), which routes ThrowBundle through `pXSprite->Impact = 1`
 * (weapon.cpp:1221). The fuse-cooked path is only reached via the shoot2-then-shoot1
 * combo (state 5 → state 6 with fuseTime=0).
 */
export function spawnProjectile(
  world: RAPIER.World,
  pos: Vec3,
  vel: Vec3,
  fuseLeft: number,
  now: number,
  impactMode: boolean = true,
): DynamiteProjectile {
  // Port of Blood thingInfo[kThingArmedTNTStick - kThingBase] (actor.cpp:1998):
  //   mass=14, clipdist=16, elastic=24576, dmgResist=1600, cstat=256
  // elastic is Blood's 16.16 fixed-point bounce coefficient: 24576 / 65536 ≈ 0.375.
  // clipdist=16 BU ≈ 0.0625 m; our ball collider at 0.1 m is a touch larger so it
  // doesn't tunnel through thin colliders.
  // Low linear damping so the stick actually carries through its arc — Blood
  // only applies gravity + xy-airdrag (very small) to thrown things.
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setLinearDamping(0.02);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.ball(0.08)
    .setRestitution(0.375)
    .setFriction(0.5)
    .setDensity(0.4); // lighter than default so the same velocity carries further
  world.createCollider(colliderDesc, body);
  body.setLinvel(vel, true);
  // Authentic Blood projectile has no body rotation (sprite is face-aligned
  // and pSprite->ang never updates in flight). Screen-space spin is applied
  // to the mesh in updateProjectiles; the body stays rotationally inert.

  let mesh: THREE.Mesh | null = null;
  if (projectileScene && projectileFrames.length > 0) {
    // Bundle silhouette: horizontal wrapped-stick bundle with lit fuse.
    // Blood tile 3433 is ~48×16 px — wider than tall.
    const geom = new THREE.PlaneGeometry(0.42, 0.18);
    const mat = new THREE.MeshBasicMaterial({
      map: projectileFrames[0]!,
      transparent: true,
      depthWrite: false,
    });
    mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    projectileScene.add(mesh);
  }

  // Screen-space spin: ~115–230°/s, random sign. Mild enough to read as
  // kinetic tumble without making the sprite strobe.
  const spinRate = (2 + Math.random() * 2) * (Math.random() < 0.5 ? 1 : -1);

  const proj: DynamiteProjectile = {
    body,
    mesh,
    fuseLeft,
    fuseMax: Math.max(fuseLeft, DYNAMITE_COOK.fuseMaxSec),
    spinRate,
    spinPhase: 0,
    lastFrameIdx: -1,
    spawnTime: now,
    spawnPos: { x: pos.x, y: pos.y, z: pos.z },
    impactMode,
  };
  liveProjectiles.push(proj);
  return proj;
}

/**
 * Grace gates before contactPairsWith is checked. Without these, the projectile
 * would self-detonate the moment it overlaps the player's own collider on spawn.
 * Both must be satisfied: 50 ms minimum age AND 0.7 m minimum displacement from
 * spawn position. Either alone could miss edge cases (player standing still →
 * displacement check could pass while still inside the player capsule; or an
 * enemy 0.5 m away → time-grace could expire before displacement check would).
 */
const IMPACT_GRACE_SEC = 0.05;
const IMPACT_SAFE_DIST_SQ = 0.7 * 0.7;

/** Advance all projectiles; detonate any whose fuse hit zero or that hit something. Call per fixed step. */
export function updateProjectiles(ctx: FrameCtx, dt: number): void {
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i]!;
    p.fuseLeft -= dt;
    p.spinPhase += p.spinRate * dt;

    // Impact-detonate check (NotBlood primary-fire mode). Once the projectile
    // has cleared both the time grace AND the displacement-from-spawn safety
    // radius, the first time Rapier reports any contact pair on the projectile's
    // collider, force fuse to 0 so the existing detonate path below fires.
    if (p.impactMode && p.fuseLeft > 0 && (ctx.now - p.spawnTime) >= IMPACT_GRACE_SEC) {
      const trans = p.body.translation();
      const dx = trans.x - p.spawnPos.x;
      const dy = trans.y - p.spawnPos.y;
      const dz = trans.z - p.spawnPos.z;
      if (dx*dx + dy*dy + dz*dz >= IMPACT_SAFE_DIST_SQ) {
        const collider = p.body.collider(0);
        let hasContact = false;
        ctx.world.contactPairsWith(collider, () => { hasContact = true; });
        if (hasContact) p.fuseLeft = 0;
      }
    }
    const t = p.body.translation();
    if (p.mesh) {
      p.mesh.position.set(t.x, t.y, t.z);
      if (projectileCamera) {
        // Billboard: face the camera (authentic Blood face-alignment).
        p.mesh.lookAt(projectileCamera.position);
        // Then spin in screen plane — mesh's local +Z now points at the
        // camera, so rotateZ is a rotation around the camera-forward axis.
        p.mesh.rotateZ(p.spinPhase);
      }
      // Cycle fuse-burn frame: full fuse → frame 0, exhausted → last frame.
      if (projectileFrames.length > 1) {
        const idx = fuseFrameIndex(p.fuseLeft, p.fuseMax, projectileFrames.length);
        if (idx !== p.lastFrameIdx) {
          const mat = p.mesh.material as THREE.MeshBasicMaterial;
          mat.map = projectileFrames[idx]!;
          mat.needsUpdate = true;
          p.lastFrameIdx = idx;
        }
      }
    }
    if (p.fuseLeft <= 0) {
      ctx.sfx?.play(SfxEvent.DYNAMITE_BOOM, { x: t.x, y: t.y, z: t.z });
      ctx.gibs.spawnExplosion({ x: t.x, y: t.y, z: t.z }, EXPLOSION_STANDARD, ctx.now);
      if (p.mesh) {
        projectileScene?.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      }
      ctx.world.removeRigidBody(p.body);
      liveProjectiles.splice(i, 1);
    }
  }
}

export function resetProjectiles(world: RAPIER.World): void {
  for (const p of liveProjectiles) {
    if (p.mesh) {
      projectileScene?.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    world.removeRigidBody(p.body);
  }
  liveProjectiles.length = 0;
}

// ——— Weapon implementation ————————————————————————————

// Blood QAV mapping (see docs/dev-notes/2026-04-22-notblood-source-reference.md):
//   dynamite-raise     = BUNUP2 (10 frames, 420ms) — weapon-equip animation: hands rise
//                        into view, lighter flicks, flame meets wick, bundle settles into
//                        hold pose. Plays ONCE on equip (not on every trigger press).
//   dynamite-idle      = BUNIDLE (6 frames, loops) — idle holding pose, fuse visually lit,
//                        waiting for trigger press.
//   dynamite-fuse-burn = BUNFUSE (66 frames, time-scaled to 1980ms to fit our 2s fuseMaxSec) —
//                        authentic fuse-burndown with sparks appearing near the end; non-looping so
//                        the animation visibly climaxes right before the state machine self-explodes.
//   dynamite-throw     = BUNTHRO (17 frames, 714ms)
type DynPhase = 'equipping' | 'idle' | 'cooking' | 'throwing';

const PHASE_DURATIONS = {
  equippingMs: 420,  // BUNUP2 runtime
  throwingMs: 336,
} as const;

export class Dynamite implements Weapon {
  readonly id = 'dynamite';
  readonly ammoMax = Number.POSITIVE_INFINITY;
  ammo = Number.POSITIVE_INFINITY;

  // New weapon instance always starts by equipping — either at game boot or
  // (future) on weapon-switch from another weapon. Lazy-inits in onFrame.
  private _phase: DynPhase = 'equipping';
  private phaseEnteredAt = -1;  // sentinel: lazy-init on first onFrame
  private cookStart = 0;
  private _fuseHissSrc: AudioBufferSourceNode | null = null;

  phase(): DynPhase { return this._phase; }

  /** Called by WeaponRegistry when switching TO the dynamite. Resets to equipping phase. */
  equip(ctx: FrameCtx): void {
    this._fuseHissSrc?.stop();
    this._fuseHissSrc = null;
    this.enter('equipping', ctx);
  }

  /** Called by WeaponRegistry when switching AWAY from the dynamite. Kills fuse hiss. */
  unequip(_ctx: FrameCtx): void {
    this._fuseHissSrc?.stop();
    this._fuseHissSrc = null;
  }

  /** Fuse is visually lit from the moment BUNUP2 completes (end of equipping) onward. */
  isFuseLit(): boolean {
    return this._phase === 'idle' || this._phase === 'cooking' || this._phase === 'throwing';
  }

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0) return;
    // Trigger only works from idle — during equipping, throwing, or cooking it's a no-op.
    if (this._phase !== 'idle') return;
    this.cookStart = ctx.now;
    this.enter('cooking', ctx);
  }

  onRelease(ctx: FrameCtx): void {
    if (this._phase !== 'cooking') return;
    this.doThrow(ctx);
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    // Lazy init: first frame we see, enter the starting phase properly so the animator
    // gets the equip animation and phaseEnteredAt gets a valid timestamp.
    if (this.phaseEnteredAt < 0) {
      this.enter(this._phase, ctx);
    }

    const elapsedMs = (ctx.now - this.phaseEnteredAt) * 1000;

    switch (this._phase) {
      case 'equipping':
        if (elapsedMs >= PHASE_DURATIONS.equippingMs) {
          this.enter('idle', ctx);
        }
        break;
      case 'cooking': {
        const heldSec = ctx.now - this.cookStart;
        if (heldSec >= DYNAMITE_COOK.fuseMaxSec) {
          ctx.gibs.spawnExplosion(ctx.player.pos, EXPLOSION_STANDARD, ctx.now);
          this.enter('idle', ctx);
        }
        break;
      }
      case 'throwing':
        if (elapsedMs >= PHASE_DURATIONS.throwingMs) {
          this.enter('idle', ctx);
        }
        break;
    }

    updateProjectiles(ctx, dt);
  }

  private enter(next: DynPhase, ctx: FrameCtx): void {
    this._phase = next;
    this.phaseEnteredAt = ctx.now;
    // Stop looping fuse hiss on any phase exit (throwing / idle / overcook explosion)
    if (next === 'throwing' || next === 'idle') {
      this._fuseHissSrc?.stop();
      this._fuseHissSrc = null;
    }
    switch (next) {
      case 'equipping':
        ctx.fpAnimator?.restart('dynamite-raise', ctx.now);
        ctx.sfx?.play(SfxEvent.LIGHTER_STRIKE);
        break;
      case 'idle':
        ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
        break;
      case 'cooking':
        ctx.fpAnimator?.restart('dynamite-fuse-burn', ctx.now);
        {
          const src = ctx.sfx?.play(SfxEvent.FUSE_HISS) ?? null;
          if (src) { src.loop = true; this._fuseHissSrc = src; }
        }
        break;
      case 'throwing':
        ctx.fpAnimator?.restart('dynamite-throw', ctx.now);
        ctx.sfx?.play(SfxEvent.THROW_GRUNT);
        break;
    }
  }

  private doThrow(ctx: FrameCtx): void {
    const heldSec = ctx.now - this.cookStart;
    const frac = chargeFraction(heldSec);
    const speed = throwVelocityMps(frac);
    // Primary-fire = impact-detonate (NotBlood weapon.cpp:2728 → ThrowBundle's
    // pXSprite->Impact=1 path). Cook still drives throw velocity; the in-flight
    // fuse is repurposed as a safety timeout — if the bundle misses everything,
    // it still detonates after IMPACT_SAFETY_FUSE_SEC. 5s is generous and lets
    // a fully-cooked-then-thrown bundle clear the entire arena before fallback.
    const fuseLeft = DYNAMITE_COOK.impactSafetyFuseSec;
    const vel = throwVector(ctx.player.forward, speed);
    spawnProjectile(ctx.world, ctx.player.handPos, vel, fuseLeft, ctx.now, /*impactMode*/ true);
    this.ammo--;
    this.enter('throwing', ctx);
  }

  chargeFraction(): number { return 0; }

  chargeFractionAt(now: number): number {
    if (this._phase !== 'cooking') return 0;
    return chargeFraction(now - this.cookStart);
  }

  isCooking(): boolean { return this._phase === 'cooking'; }

  renderView(_ctx: ViewCtx): void { /* handled by fpAnimator */ }
  renderHud(_ctx: HudCtx): void { /* handled by ChargeHud */ }
}
