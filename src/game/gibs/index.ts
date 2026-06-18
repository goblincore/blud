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
  ZOMBIE_GIB_PROFILE,
  EXPLOSION_LAUNCH,
  GIB_CHUNK_VELOCITY_SCALE,
  GROUND_BURST_THRESHOLD_M,
  EXPLOSION_VFX_HEIGHT_SCALE,
  type GibProfile,
} from './tuning';
import { resolveDeathOutcome, KDamage, type DeathOutcomeConfig } from '../notblood/death-outcome';
import { gibSpawnToMps } from '../notblood/outcome-adapter';
import { KDude } from '../notblood/notblood-tables.gen';
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
  takeDamage(amount: number, vel: Vec3): void;
  /** Called by the gib system when this dude is gibbed (damage ≥ GIB_THRESHOLD).
   *  Implementations should hide the body's sprite immediately — chunks replace it. */
  onGibbed?(): void;
  /** True when dead-but-not-gibbed — a persistent corpse. Corpses re-gib
   *  unconditionally on any explosion contact (NotBlood: kThingBloodChunks
   *  thing with health 8, actor.cpp:7887). */
  readonly isCorpse?: boolean;
  kind: 'player' | 'axe-zombie' | 'cultist-shotgun';
  /** M3: per-enemy gib customization. Required on all dudes. */
  gibProfile: GibProfile;
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
  if (len < 1e-6) return { x: 0, y: 0, z: 0 }; // zero is right for impulse; concussionVelocity deliberately differs (straight-up)
  return { x: (dx / len) * magnitude, y: (dy / len) * magnitude, z: (dz / len) * magnitude };
}

/**
 * Concussion launch velocity for a dude in explosion range — NotBlood
 * ConcussSprite (actor.cpp:2677): radial direction with an upward bias
 * (ground blast kicks dudes up), magnitude in m/s. Applied to alive dudes
 * AND corpses — physics is decoupled from damage.
 */
export function concussionVelocity(origin: Vec3, target: Vec3, impulseMag: number): Vec3 {
  const speed = impulseMag * EXPLOSION_LAUNCH.velocityScale;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return { x: 0, y: Math.max(speed, EXPLOSION_LAUNCH.minUpKickMps), z: 0 };
  const ux = dx / len;
  const uy = dy / len + EXPLOSION_LAUNCH.upwardBias;
  const uz = dz / len;
  const ulen = Math.sqrt(ux * ux + uy * uy + uz * uz);
  return {
    x: (ux / ulen) * speed,
    // Vertical-kick floor: every concussion launch gets a readable arc
    // (NotBlood's z-kick reads near-constant — slapstick is the point).
    y: Math.max((uy / ulen) * speed, EXPLOSION_LAUNCH.minUpKickMps),
    z: (uz / ulen) * speed,
  };
}

/**
 * Air-vs-ground explosion animation selection — ports NotBlood actExplodeSprite's
 * `florhit` branch (actor.cpp ~5995): a detonation that came to rest on the floor
 * plays the ground SEQ (dome→mushroom), one in open air plays the air SEQ
 * (compact fireball). `floorDistM` is the distance to the nearest static floor
 * below the blast (`null` = no floor found → treat as air). At-or-under
 * `thresholdM` is a ground burst.
 */
export function isAirBurst(floorDistM: number | null, thresholdM: number): boolean {
  return floorDistM === null || floorDistM > thresholdM;
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

/** Blood's kExplosionStandard applies 20 damage over 60 ticks (500ms @ 120 TPS) =
 *  total 1200 damage. Blud collapses multi-tick into single shot. 12× gives
 *  point-blank damage ≈ 240 which reliably gibs zombies (> 160 threshold),
 *  with a mid-ring for "hurt but not gibbed." */
const DAMAGE_TICK_STACK = 12;

/** Map a Blud dude kind to its NotBlood kDude* value so the pure
 *  resolveDeathOutcome DECISION (corpse re-gib, sub-160 demote, zombie
 *  head-spawn) can run source-faithfully. The player is not a NotBlood dude —
 *  aliased to a non-zombie type so the module's `isZombie` head-spawn gate is
 *  false (matches PlayerGibAdapter.spawnsKickableHead=false). */
function dudeTypeForKind(kind: GibbableDude['kind']): number {
  switch (kind) {
    case 'axe-zombie': return KDude.kDudeZombieAxeNormal;
    case 'cultist-shotgun': return KDude.kDudeCultistShotgun;
    case 'player': return KDude.kDudeCultistShotgun; // not a dude — non-zombie alias (no head)
  }
}

/** Blud deviations from source-faithful actKillDude, applied at the GibSystem
 *  edge. Explosion deaths are source-faithful here — the only decision-level
 *  Blud deviation (burnHeadChance) belongs to the burn-death path wired in
 *  main.ts (onBurnDeath), not to this explosion AOE path. */
const BLUD_DEATH_CONFIG: DeathOutcomeConfig = {};

export class GibSystem {
  private dudes: GibbableDude[] = [];

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly particles: ParticlePool,
    private readonly chunks: ChunkSystem,
    private readonly decals: DecalPool,
    private readonly explosionVfx: ExplosionVfx,
    /** Dome→mushroom SEQ, played when the blast rests on the floor. */
    private readonly groundExplosionAtlas: ExplosionAtlas,
    /** Compact fireball SEQ, played for mid-air detonations. */
    private readonly airExplosionAtlas: ExplosionAtlas,
    private readonly screenshake: Screenshake,
    /** Called when a player-gib occurs — main.ts shows game-over overlay. */
    private readonly onPlayerGibbed: () => void,
  ) {}

  registerDude(d: GibbableDude): void { this.dudes.push(d); }
  unregisterDude(id: string): void {
    this.dudes = this.dudes.filter((d) => d.id !== id);
  }

  /** Drop all registered dudes except the player (the player adapter is
   *  registered once at boot and survives restarts). */
  reset(): void {
    this.dudes = this.dudes.filter((d) => d.kind === 'player');
  }

  /** Distance from `pos` straight down to the nearest STATIC floor, or null if
   *  none within range. Kinematic (dudes) and dynamic (the still-live dynamite
   *  body, corpses) colliders are excluded so only world geometry counts —
   *  mirrors NotBlood's florhit, which tracks floor contact only. */
  private floorDistanceBelow(pos: Vec3): number | null {
    const ray = new RAPIER.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(
      ray,
      50, // max 50 m down — beyond any arena drop
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    return hit ? hit.timeOfImpact : null;
  }

  spawnExplosion(pos: Vec3, info: ExplosionInfo, now: number): void {
    // VFX — radius scaled up for spatial feel (see RADIUS_SCALE_FACTOR note).
    // Air vs ground SEQ + anchor chosen from floor proximity (NotBlood florhit).
    const radiusM = (info.radius / BU_PER_METER) * RADIUS_SCALE_FACTOR;
    const air = isAirBurst(this.floorDistanceBelow(pos), GROUND_BURST_THRESHOLD_M);
    const atlas = air ? this.airExplosionAtlas : this.groundExplosionAtlas;
    this.explosionVfx.spawn(pos, radiusM * EXPLOSION_VFX_HEIGHT_SCALE, atlas, air ? 'center' : 'bottom');
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
      // NotBlood ConcussSprite: physics decoupled from damage — every dude in
      // range gets launch velocity, alive or dead (m/s, with upward bias).
      // Velocity falloff has a FLOOR (unlike damage): NotBlood's inverse-square
      // baseline keeps concussion strong at the radius edge, so survivors out
      // there still fly — the slapstick launched-alive outcome.
      const launchFall =
        EXPLOSION_LAUNCH.falloffFloor + (1 - EXPLOSION_LAUNCH.falloffFloor) * linearFall;
      const launchVel = concussionVelocity(pos, dude.pos, info.impulse * launchFall);

      console.log(`[gibs]   ${dude.kind} ${dude.id} at dist=${dist.toFixed(2)}m → damage=${damage.toFixed(0)} (gib@${GIB_THRESHOLD})${dude.isCorpse ? ' [corpse]' : ''}`);

      // — Death/gib DECISION routed through the pure resolveDeathOutcome port of
      //   NotBlood actKillDude: the corpse re-gib (kThingBloodChunks), the
      //   sub-160 explode→kDamageFall demotion, and the zombie head-spawn
      //   (GIBTYPE_27) all live there now. damageType=kDamageExplode because this
      //   IS an explosion; the module demotes sub-160 hits itself. The EFFECTS
      //   (chunk burst via gibSpawns, concussion launch, SFX) stay here — Blud
      //   physics. The outcome's source-faithful gibSpawns now drive ChunkSystem:
      //   gibSpawnToMps descales the MoveThing xvel>>12 integration by /4096, then
      //   the velocities are axis-remapped Build→Three and feel-scaled here.
      const outcome = resolveDeathOutcome(
        {
          dudeType: dudeTypeForKind(dude.kind),
          damageType: KDamage.kDamageExplode,
          damage,
          isCorpse: dude.isCorpse ?? false,
          rng: Math.random,
        },
        BLUD_DEATH_CONFIG,
      );

      if (outcome.gibbed) {
        // Source-faithful body chunks: convert the NotBlood gibSpawns (raw Build
        // xvel/yvel/zvel fields → m/s via gibSpawnToMps, which descales the
        // MoveThing xvel>>12 integration by /4096), then axis-remap Build→Three
        // and apply the GIB_CHUNK_VELOCITY_SCALE feel knob. Mirrors GibThing's
        // one-sprite-per-thing spawn (gib.cpp:409-414). NOTE the load-bearing
        // sign-flip: Build is -z = up, Three.js is +y = up, so three.y = -vz;
        // the two horizontal axes are symmetric random spreads so the x/z
        // assignment is cosmetic — get the y flip right or chunks dive into the
        // floor instead of arcing up.
        const gibs = outcome.gibSpawns.map((spawn) => {
          const mps = gibSpawnToMps(spawn);
          return {
            picnum: mps.tile,
            vel: {
              x: mps.vx * GIB_CHUNK_VELOCITY_SCALE,
              y: -mps.vz * GIB_CHUNK_VELOCITY_SCALE, // Build -z=up → Three +y
              z: mps.vy * GIB_CHUNK_VELOCITY_SCALE,
            } as Vec3,
          };
        });
        // Kickable head — still derived from the concussion launch velocity +
        // EXPLOSION_LAUNCH, gated on outcome.spawnsHead (zombie explode death
        // only; corpses + cultists + player never). Mirrors triggerGib's
        // headLaunch so the head is identical across paths.
        const headLaunch = outcome.spawnsHead
          ? {
              origin: { x: dude.pos.x, y: dude.pos.y + EXPLOSION_LAUNCH.headSpawnHeightM, z: dude.pos.z },
              vel: {
                x: launchVel.x * EXPLOSION_LAUNCH.headVelInherit,
                y: EXPLOSION_LAUNCH.headUpKickMps,
                z: launchVel.z * EXPLOSION_LAUNCH.headVelInherit,
              },
            }
          : undefined;
        this.chunks.spawnChunksFromGibs(dude.pos, gibs, now, headLaunch);
        // FX_13 blood-particle spray — the separate gFXData[13] fx, NOT part of
        // gibSpawns. Kept alongside the source-faithful chunks (values match the
        // triggerGib radial path so the spray is identical).
        const burstCount = dude.gibProfile.chunkCount.max * 2;
        this.particles.emitBurst(dude.pos, {
          tile: GIB_BURST.tile,
          count: burstCount,
          speedMin: GIB_BURST.speedMin,
          speedMax: GIB_BURST.speedMax,
          gravity: 9.8,
          airdrag: 0.3,
          lifetimeSec: 2.0,
          size: 0.5,
        });
        console.log(`[gibs] GIB! at (${dude.pos.x.toFixed(1)},${dude.pos.y.toFixed(1)},${dude.pos.z.toFixed(1)})`);
        dude.onGibbed?.();
        if (dude.kind === 'player') this.onPlayerGibbed();
        else this.unregisterDude(dude.id);
      } else {
        // Sub-threshold (demoted to kDamageFall): dude takes damage + the
        // concussion velocity. If it dies, the entity flings the corpse
        // ballistically and STAYS registered as a re-gibgable corpse.
        dude.takeDamage(damage, launchVel);
      }
    }
  }

  triggerGib(pos: Vec3, launchVel: Vec3, profile: GibProfile, now: number): void {
    console.log(`[gibs] GIB! at (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`);
    // NotBlood actor.cpp:3196 — head gib spawns at the sprite TOP with
    // (xvel/2, yvel/2, -0xccccc up-kick), alongside the body-chunk burst.
    const headLaunch = profile.spawnsKickableHead
      ? {
          origin: { x: pos.x, y: pos.y + EXPLOSION_LAUNCH.headSpawnHeightM, z: pos.z },
          vel: {
            x: launchVel.x * EXPLOSION_LAUNCH.headVelInherit,
            y: EXPLOSION_LAUNCH.headUpKickMps,
            z: launchVel.z * EXPLOSION_LAUNCH.headVelInherit,
          },
        }
      : undefined;
    this.chunks.spawnChunks(pos, launchVel, profile, now, Math.random, headLaunch);
    const burstCount = profile.chunkCount.max * 2;
    this.particles.emitBurst(pos, {
      tile: GIB_BURST.tile,
      count: burstCount,
      speedMin: GIB_BURST.speedMin,
      speedMax: GIB_BURST.speedMax,
      gravity: 9.8,
      airdrag: 0.3,
      lifetimeSec: 2.0,
      size: 0.5,
    });
  }

  /** Blood signature: 25% of normal zombie deaths pop the head off with a
   *  blood burst (NotBlood actor.cpp:3205, Chance(0x4000) + GIBTYPE_27). */
  popHead(pos: Vec3, now: number): void {
    this.chunks.spawnHeadChunk(
      { x: pos.x, y: pos.y + EXPLOSION_LAUNCH.headSpawnHeightM, z: pos.z },
      {
        x: (Math.random() - 0.5) * 1.5,
        y: EXPLOSION_LAUNCH.headPopUpKickMps,
        z: (Math.random() - 0.5) * 1.5,
      },
      now,
    );
    this.particles.emitBurst(pos, {
      tile: GIB_BURST.tile,
      count: 6,
      speedMin: 1.5,
      speedMax: 4.0,
      gravity: 9.8,
      airdrag: 0.3,
      lifetimeSec: 1.5,
      size: 0.4,
    });
  }
}
