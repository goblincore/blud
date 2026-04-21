import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3 } from './particles';
import { ParticlePool } from './particles';
import { ChunkSystem } from './chunks';
import { DecalPool } from './decals';
import { ExplosionVfx } from '../../vfx/explosion';
import type { ExplosionAtlas } from '../../vfx/explosion';
import { Screenshake } from '../../vfx/screenshake';
import {
  EXPLOSION_STANDARD,
  GIB_THRESHOLD,
  GIB_BURST,
  BU_PER_METER,
  buPerTicSquaredToMpsSquared,
} from './tuning';

export interface ExplosionInfo {
  radius: number;       // Build units
  damage: number;
  damageRange: number;
  impulse: number;
  quake: number;
  lifetimeTics: number;
  flash: number;
}

/** Reference-only type for gibbable entities (player, zombies). */
export interface GibbableDude {
  pos: Vec3;
  hp: number;
  id: string;                         // stable identity
  takeDamage(amount: number, impulse: Vec3): void;
  /** Called by the gib system when this dude is gibbed (damage ≥ GIB_THRESHOLD).
   *  Implementations should hide the body's sprite immediately — chunks replace it. */
  onGibbed?(): void;
  kind: 'player' | 'axe-zombie';
}

// ——— Pure falloff math (exported for TDD) ——————————————

/** Linear falloff: full at d=0, zero at d≥radius. Meters in, damage out. */
export function falloffDamage(distanceM: number, info: ExplosionInfo): number {
  const radiusM = info.radius / BU_PER_METER;
  if (distanceM >= radiusM) return 0;
  const scale = 1 - distanceM / radiusM;
  return (info.damage + info.damageRange) * scale;
}

export function falloffImpulse(distanceM: number, info: ExplosionInfo): number {
  const radiusM = info.radius / BU_PER_METER;
  if (distanceM >= radiusM) return 0;
  const scale = 1 - distanceM / radiusM;
  return info.impulse * scale;
}

export function radialImpulseVector(origin: Vec3, target: Vec3, magnitude: number): Vec3 {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: (dx / len) * magnitude, y: (dy / len) * magnitude, z: (dz / len) * magnitude };
}

// ——— Orchestrator ———————————————————————————————————

/**
 * Empirical scale factors calibrated against M1 arena (1 unit = 1 meter).
 *
 * BU_PER_METER=256 is correct for velocity conversion (dynamite velocity
 * 6.4 BU/tic × 120 TPS / 256 ≈ 3 m/s, which feels right) but produces a
 * radius of 0.6m for Blood's 150 BU dynamite bundle — way too small to
 * cover a zombie cluster. `RADIUS_SCALE_FACTOR` bumps spatial radius to
 * ~4.7m without disturbing velocity.
 */
const RADIUS_SCALE_FACTOR = 8;

/**
 * Blood's explosion applies damage over `repeat` tics (80 for kExplosionStandard)
 * — total damage at blast center ≈ 20 × 80 = 1600, vastly above GIB_THRESHOLD=160.
 * We collapse Blood's multi-tick damage into a single shot with this multiplier
 * as a rough equivalent; 8× gives close-range damage ≈ 240 which reliably gibs
 * zombies (> 160 threshold), tapering below threshold near the edge for
 * "hurt but not gibbed" outer ring.
 */
const DAMAGE_TICK_STACK = 8;

export class GibSystem {
  private dudes: GibbableDude[] = [];

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly particles: ParticlePool,
    private readonly chunks: ChunkSystem,
    private readonly decals: DecalPool,
    private readonly explosionVfx: ExplosionVfx,
    private readonly explosionAtlas: ExplosionAtlas,
    private readonly screenshake: Screenshake,
    /** Called when a player-gib occurs — main.ts shows game-over overlay. */
    private readonly onPlayerGibbed: () => void,
  ) {}

  registerDude(d: GibbableDude): void { this.dudes.push(d); }
  unregisterDude(id: string): void {
    this.dudes = this.dudes.filter((d) => d.id !== id);
  }

  spawnExplosion(pos: Vec3, info: ExplosionInfo, now: number): void {
    // VFX — radius scaled up for spatial feel (see RADIUS_SCALE_FACTOR note)
    const radiusM = (info.radius / BU_PER_METER) * RADIUS_SCALE_FACTOR;
    this.explosionVfx.spawn(pos, radiusM * 0.6, this.explosionAtlas);
    // Screenshake — map Blood quake (0-255) to ~1-4 magnitude range
    this.screenshake.shake(info.quake / 40, 0.3);
    console.log(`[gibs] explosion at (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) radius=${radiusM.toFixed(1)}m dudes=${this.dudes.length}`);

    // AOE: naive iteration (< 20 dudes tops for M2)
    for (const dude of [...this.dudes]) {
      const dx = dude.pos.x - pos.x;
      const dy = dude.pos.y - pos.y;
      const dz = dude.pos.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= radiusM) continue;

      // Damage scaled by Blood's tick-stack equivalent (see DAMAGE_TICK_STACK)
      const linearFall = 1 - dist / radiusM;
      const damage = (info.damage + info.damageRange) * DAMAGE_TICK_STACK * linearFall;
      const impulseMag = info.impulse * linearFall;
      const impulseVec = radialImpulseVector(pos, dude.pos, impulseMag);

      console.log(`[gibs]   ${dude.kind} ${dude.id} at dist=${dist.toFixed(2)}m → damage=${damage.toFixed(0)} (gib@${GIB_THRESHOLD})`);

      if (damage >= GIB_THRESHOLD) {
        this.triggerGib(dude.pos, impulseVec, dude.kind, now);
        dude.onGibbed?.();
        if (dude.kind === 'player') this.onPlayerGibbed();
        else this.unregisterDude(dude.id);
      } else {
        dude.takeDamage(damage, impulseVec);
      }
    }
  }

  triggerGib(pos: Vec3, impulse: Vec3, kind: GibbableDude['kind'], now: number): void {
    console.log(`[gibs] GIB! ${kind} at (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`);
    this.chunks.spawnChunks(pos, impulse, now);
    this.particles.emitBurst(pos, {
      tile: GIB_BURST.tile,
      count: GIB_BURST.count * 2, // double count for denser spray
      speedMin: GIB_BURST.speedMin,
      speedMax: GIB_BURST.speedMax,
      // Real gravity rather than the buPerTicSquaredToMpsSquared conversion
      // (which yields ~2.6M m/s² from Blood's raw 46603 — particles vanish).
      gravity: 9.8,
      airdrag: 0.3,
      lifetimeSec: 2.0, // down from 4s; Blood burst is denser-and-shorter feel
      size: 0.5,
    });
  }
}
