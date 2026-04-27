import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3 } from '../gibs/particles';
import { BURN } from '../gibs/tuning';

// ——— Pure math (TDD'd) ————————————————————————————

/**
 * Seconds of burn remaining at wall-clock `now`.
 * Returns a value in [0, duration]; zero when expired.
 */
export function burnRemainingSec(spawnTime: number, now: number, duration: number): number {
  return Math.max(0, duration - (now - spawnTime));
}

/**
 * Damage dealt by a single DoT tick of length `dt` at the given dps rate.
 */
export function dotDamageThisFrame(dt: number, dps: number): number {
  return dt * dps;
}

/**
 * True when the flare has been burning for at least `duration` seconds.
 */
export function isExpired(spawnTime: number, now: number, duration: number): boolean {
  return (now - spawnTime) >= duration;
}

// ——— Flare entity ——————————————————————————————————

/**
 * A flare that has hit a surface or enemy body and is now burning.
 *
 * When attached to a RAPIER RigidBody, the flare follows that body each frame.
 * When the body is removed (e.g. enemy gibbed), the caller calls `detach()`
 * and the flare continues burning at its last known position.
 */
export class StuckFlare {
  readonly id: string;
  pos: Vec3;
  attachedBody: RAPIER.RigidBody | null;
  readonly spawnTime: number;
  readonly duration: number = BURN.durationSec;
  private extinguished = false;

  /** Billboard mesh — created externally (main.ts), owned and cleaned up here. */
  mesh: THREE.Mesh | null = null;

  constructor(
    id: string,
    pos: Vec3,
    attachedBody: RAPIER.RigidBody | null,
    now: number,
  ) {
    this.id = id;
    this.pos = { ...pos };
    this.attachedBody = attachedBody;
    this.spawnTime = now;
  }

  /** Update position from attached body if any. Returns false when expired. */
  update(now: number): boolean {
    if (this.extinguished) return false;
    if (this.attachedBody) {
      const t = this.attachedBody.translation();
      this.pos = { x: t.x, y: t.y, z: t.z };
    }
    if (isExpired(this.spawnTime, now, this.duration)) {
      this.extinguished = true;
      return false;
    }
    return true;
  }

  /** Get the render position: enemy center + small Y offset so the flare sits in the body. */
  getRenderPos(): Vec3 {
    return { x: this.pos.x, y: this.pos.y + 0.6, z: this.pos.z };
  }

  /** Dispose the billboard mesh. Called when the flare is cleaned up. */
  disposeMesh(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
  }

  /**
   * True when the flare has ignited (past the initial smoke-only delay).
   * Before ignition: smoke only, no DoT. After ignition: DoT begins, sprite swap triggers.
   */
  isIgnited(now: number): boolean {
    return (now - this.spawnTime) >= BURN.igniteDelaySec;
  }

  /** Damage to apply this frame to the attached body (or 0 if no body or not yet ignited). */
  damageThisTick(dt: number, now: number): number {
    if (!this.attachedBody || this.extinguished) return 0;
    if (!this.isIgnited(now)) return 0;
    return dotDamageThisFrame(dt, BURN.dpsPerFlare);
  }

  /** Detach from body (e.g. body was removed mid-burn). Flare continues at last known pos. */
  detach(): void {
    this.attachedBody = null;
  }

  isExtinguished(): boolean { return this.extinguished; }
}
