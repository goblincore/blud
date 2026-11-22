// src/lab/sdf-zombie/webgpu/game-barrels.ts
//
// BARRELS IN PLAY (plan 2026-10-25-sector-levels-3b Task 13): the level's barrels on ctx.world.barrels — the pure
// core (barrel-runtime.ts: states, boxes in ctx.world.colliders, the chain log) wired to the game. A barrel that
// goes up swaps its drum for the stub, lays a scorch at its feet (as big as the floor there takes), detonates THROUGH the dynamite blast (detonateAt:
// wounds, gibs, launches, light, VFX, kick — and its closing catchBlast is the chain), then hurts the player by
// BLAST_PROFILES.barrel unless sector geometry shields the capsule centre. Dynamite itself never hurts the player
// (owner, 2026-10-25); only this module and the rockets apply a blast share.
//
// Sector levels only: game-main builds this only when the level has barrels.
import type { Vec3 } from '../types';
import { BLAST_PROFILES, blastToPlayer, playerBlastDamage } from '../blast-player';
import type { GameContext } from './game-context';
import type { BarrelDef } from './level-def';
import type { SectorGround } from './sector-ground';
import { barrelYaw, scorchFit } from './barrel-look';
import { createBarrelCore, type BarrelRuntime } from './barrel-runtime';
import { createBarrelBatches, createBarrelMaterials, createBarrelView, createScorchPool, type BarrelView } from './game-barrel-view';
import { groupByZone, levelBatchOn } from './level-batch';
import { detonateAt } from './game-dynamite-step';
import { blastShielded } from './game-hit-trace';
import { damagePlayer } from './game-loop';
import { PLAYER } from './game-player';

export type { BarrelRuntime } from './barrel-runtime';

export interface GameBarrels extends BarrelRuntime {
  /** Materials the barrels made (2 per zone with barrels: drum/stub and lid). */
  materialCount(): number;
  /** The floor scorches laid so far (their centres, gate readback). */
  scorches(): [number, number, number][];
  /** The per-zone merges (level-batch.ts): intact drums each; null with `?batch=0`. */
  batches(): { zoneRoom: number; drums: number }[] | null;
  /** In-boot A/B of the per-zone merges (game-level-batch.ts setLevelBatchLive). */
  setBatchLive(on: boolean): void;
}

export function createBarrelRuntime(ctx: GameContext, defs: readonly BarrelDef[]): GameBarrels {
  const map = ctx.world.level.def!.sectors!;
  const ground = ctx.world.level.ground as SectorGround;
  const mats = createBarrelMaterials(ctx);
  const views = new Map<string, BarrelView>();
  const batched = levelBatchOn(location.search);
  const zoneOf = new Map<string, number>();
  for (const b of defs) {
    const sector = ground.sectorAt(b.pos[0], b.pos[2]);
    const zoneRoom = map.sectors[sector]!.zone + 1;          // the zone's synthesized room (game-sector-mesh)
    views.set(b.id, createBarrelView(ctx, b, sector, zoneRoom, mats, batched));
    zoneOf.set(b.id, zoneRoom);
  }
  // One merged drum and lid per zone (level-batch.ts; `?batch=0`: a drum and a lid per barrel).
  const batches = batched ? createBarrelBatches(ctx, new Map(groupByZone(defs.map(b => ({ id: b.id, zone: zoneOf.get(b.id)! })))
    .map(([zoneRoom, ids]) => [zoneRoom, ids.map(id => { const view = views.get(id)!; return { view, intact: () => view.drum.visible }; })])), mats) : null;
  const scorches = createScorchPool(ctx);
  const shielded = (from: Vec3, to: Vec3, inside?: Vec3) => blastShielded(ctx, from, to, inside);

  const core = createBarrelCore(defs, ctx.world.colliders, {
    shielded,
    explode(id, at, feet) {
      views.get(id)?.explode();
      batches?.rebuild(zoneOf.get(id)!);
      // As wide as the floor round the feet takes (BARREL_LOOK.scorchM, shrunk so it never hangs off a ledge).
      const size = scorchFit((x, z) => ground.floorAt(x, z), feet[0], feet[2], feet[1]);
      scorches.add(feet[0], feet[1], feet[2], size, barrelYaw(`${id}:scorch`));
      detonateAt(ctx, at);
      const pp = ctx.player.player.pos;
      const d = blastToPlayer(at, pp, PLAYER.height);
      const hurt = playerBlastDamage(d, BLAST_PROFILES.barrel);
      if (hurt > 0 && !shielded(at, [pp[0], pp[1] + PLAYER.height * 0.5, pp[2]])) damagePlayer(ctx, hurt, 'blast');
      ctx.telemetry.telemetry.event('barrel-explode', { id, x: at[0], y: at[1], z: at[2], t: core.clock });
    },
  });
  console.info(`[barrels] ${defs.length} barrels, ${mats.count()} materials (2 per zone with barrels)`);
  return Object.assign(core, { materialCount: () => mats.count(), scorches: () => scorches.positions(), batches: () => batches?.report() ?? null,
    setBatchLive: (on: boolean) => batches?.setLive(on) });
}
