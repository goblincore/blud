import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../gibs/particles';
import { SHOTGUN_BLAST } from '../gibs/tuning';

// ——— Pure math (TDD'd) ————————————————————————————

/**
 * Straight-line pellet position after traveling `t` seconds at `speed` m/s.
 * No gravity — shotgun pellets are flat-trajectory.
 */
export function pelletPosition(spawn: Vec3, dir: Vec3, t: number, speed: number): Vec3 {
  return {
    x: spawn.x + dir.x * speed * t,
    y: spawn.y + dir.y * speed * t,
    z: spawn.z + dir.z * speed * t,
  };
}

/**
 * Compute a unit direction vector for pellet `angleIdx` of `total` pellets,
 * fanned across a cone of half-angle `coneDeg` degrees around `forward`.
 *
 * The pellets fan in the horizontal (XZ) plane by rotating `forward` around
 * the world Y axis.
 */
export function pelletDirInCone(
  forward: Vec3,
  angleIdx: number,
  total: number,
  coneDeg: number,
): Vec3 {
  const offsetDeg = -coneDeg + (angleIdx / (total - 1)) * coneDeg * 2;
  const offsetRad = (offsetDeg * Math.PI) / 180;

  // Rotate forward around Y axis by offsetRad
  const cos = Math.cos(offsetRad);
  const sin = Math.sin(offsetRad);
  return {
    x: forward.x * cos - forward.z * sin,
    y: forward.y,
    z: forward.x * sin + forward.z * cos,
  };
}

// ——— Raycast result shape ——————————————————————————
// Mirrors flare.ts's raycast pattern to avoid importing RAPIER directly.

export interface PelletHit {
  pos: Vec3;
  body: RAPIER.RigidBody | null;
}

export type RaycastFn = (from: Vec3, dir: Vec3, maxDist: number) => PelletHit | null;

// ——— Pellet entity ——————————————————————————————————

export class Pellet {
  private readonly spawn: Vec3;
  private prevPos: Vec3;
  private readonly dir: Vec3;
  private readonly speed: number;
  private readonly damage: number;
  private readonly spawnTime: number;
  private expired = false;

  constructor(
    spawn: Vec3,
    dir: Vec3,
    speed: number,
    spawnTime: number,
    damage: number,
  ) {
    this.spawn = { ...spawn };
    this.prevPos = { ...spawn };
    this.dir = { ...dir };
    this.speed = speed;
    this.damage = damage;
    this.spawnTime = spawnTime;
  }

  /** Current position (computed from spawn + elapsed time). */
  get currentPos(): Vec3 {
    if (this.expired) return this.prevPos;
    const elapsed = performance.now() / 1000 - this.spawnTime;
    return pelletPosition(this.spawn, this.dir, elapsed, this.speed);
  }

  /**
   * Advance pellet by one timestep. Returns true if still alive, false if
   * expired (hit something or exceeded max range).
   *
   * @param now wall-clock seconds (performance.now() / 1000)
   * @param raycastFn swept raycast from prevPos to currentPos
   * @param applyDamageToPlayer callback for player-hit damage + impulse
   * @param playerBody the RAPIER rigid body handle to check against
   */
  update(
    now: number,
    raycastFn: RaycastFn,
    applyDamageToPlayer: (damage: number, impulse: Vec3) => void,
    playerBody: RAPIER.RigidBody | null,
  ): boolean {
    if (this.expired) return false;

    const elapsed = now - this.spawnTime;
    const totalDist = elapsed * this.speed;
    if (totalDist > SHOTGUN_BLAST.pelletMaxRangeM) {
      this.expired = true;
      return false;
    }

    // Compute current position from spawn
    const oldPos = this.prevPos;
    const newPos = pelletPosition(this.spawn, this.dir, elapsed, this.speed);

    // Swept raycast from oldPos to newPos
    const sweepDir = {
      x: newPos.x - oldPos.x,
      y: newPos.y - oldPos.y,
      z: newPos.z - oldPos.z,
    };
    const sweepDist = Math.hypot(sweepDir.x, sweepDir.y, sweepDir.z);

    // Update prevPos for next frame
    this.prevPos = { ...newPos };

    if (sweepDist < 0.001) return true; // barely moved — next frame

    const sweepNorm = {
      x: sweepDir.x / sweepDist,
      y: sweepDir.y / sweepDist,
      z: sweepDir.z / sweepDist,
    };

    const hit = raycastFn(oldPos, sweepNorm, sweepDist);
    if (hit) {
      // Hit something — extinguish
      this.expired = true;

      // If hit the player, apply damage + impulse
      if (playerBody && hit.body && hit.body.handle === playerBody.handle) {
        const impulse = {
          x: sweepNorm.x * this.speed * 0.05,
          y: sweepNorm.y * this.speed * 0.05,
          z: sweepNorm.z * this.speed * 0.05,
        };
        applyDamageToPlayer(this.damage, impulse);
      }
      return false;
    }

    return true;
  }
}
