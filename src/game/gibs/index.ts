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
    // VFX
    const radiusM = info.radius / BU_PER_METER;
    this.explosionVfx.spawn(pos, radiusM * 0.4, this.explosionAtlas);
    // Screenshake — map Blood quake (0-255) to 1-4 magnitude range
    this.screenshake.shake(info.quake / 40, 0.3);
    // TODO audio hook — wire to a sound system when M8 lands

    // AOE: naive iteration (< 20 dudes tops for M2)
    for (const dude of [...this.dudes]) {
      const dx = dude.pos.x - pos.x;
      const dy = dude.pos.y - pos.y;
      const dz = dude.pos.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= radiusM) continue;

      const damage = falloffDamage(dist, info);
      const impulseMag = falloffImpulse(dist, info);
      const impulseVec = radialImpulseVector(pos, dude.pos, impulseMag);

      if (damage >= GIB_THRESHOLD) {
        this.triggerGib(dude.pos, impulseVec, dude.kind, now);
        if (dude.kind === 'player') this.onPlayerGibbed();
        else this.unregisterDude(dude.id);
      } else {
        dude.takeDamage(damage, impulseVec);
      }
    }
  }

  triggerGib(pos: Vec3, impulse: Vec3, kind: GibbableDude['kind'], now: number): void {
    this.chunks.spawnChunks(pos, impulse, now);
    this.particles.emitBurst(pos, {
      tile: GIB_BURST.tile,
      count: GIB_BURST.count,
      speedMin: GIB_BURST.speedMin,
      speedMax: GIB_BURST.speedMax,
      gravity: buPerTicSquaredToMpsSquared(GIB_BURST.gravityBlood),
      airdrag: 0.3, // hand-tuned; Blood's raw airdrag doesn't map directly
      lifetimeSec: GIB_BURST.lifetimeSec,
      size: 0.15,
    });
  }
}
