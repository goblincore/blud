// src/lab/sdf-zombie/webgpu/game-seams-doors.ts
//
// Door seams (game-doors.ts): the level's doors as plain data, forcing one open or shut, the phase-change log,
// and `doorRay` — the same sector ray every shot, pellet, projectile and sight line uses (sector-ray.ts), so a
// probe can show a shut door stopping it. Empty / null on levels without doors.
import type * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import type { GameContext } from './game-context';
import type { DoorPhase } from './sector-doors';
import type { SectorGround } from './sector-ground';
import { sectorSegmentHit } from './sector-ray';
import { doorLampGain, doorSpillGain } from './game-doors';

export function createDoorSeams(ctx: GameContext) {
  return {
    doors: () => ctx.world.doors?.snapshot() ?? [],
    forceDoor: (id: string, open: number, phase?: DoorPhase) => ctx.world.doors?.force(id, open, phase) ?? false,
    /** The leaf meshes: name, zone room, culling, whether the level pre-warm can see them (in the level group). */
    doorMeshes: () => ctx.world.doors?.meshes.map(m => ({ name: m.name, room: m.userData.room as number, frustumCulled: m.frustumCulled,
      inLevelGroup: m.parent === ctx.world.levelGroup, material: (m.material as THREE.Material).type, lit: !!(m.material as { lightsNode?: unknown }).lightsNode })) ?? [],
    /** The readability cues in force (`?doorcues=`) and each door's status lamp colour now. */
    doorCues: () => ctx.world.doors ? { cues: ctx.world.doors.cues, lamps: ctx.world.doors.lampColours(),
      lampGain: doorLampGain.value as number, spillGain: doorSpillGain.value as number } : null,
    /** Retune the status lamp's brightness and its spill (shared by every door). */
    setDoorLamp: (gain?: number, spill?: number) => {
      if (gain !== undefined) doorLampGain.value = gain;
      if (spill !== undefined) doorSpillGain.value = spill;
      return { lampGain: doorLampGain.value as number, spillGain: doorSpillGain.value as number };
    },
    doorEvents: () => ctx.world.doors?.events.map(e => ({ ...e, id: ctx.world.doors!.field.defs[e.door]!.id })) ?? [],
    doorRay: (a: Vec3, b: Vec3) => {
      const map = ctx.world.level.def?.sectors;
      if (!map) return null;
      const h = sectorSegmentHit(map, ctx.world.level.ground as SectorGround, a, b);
      return h ? { t: h.t, point: [...h.point], kind: h.kind, line: h.line, door: (ctx.world.level.ground as SectorGround).doors.lineDoor[h.line] ?? -1 } : null;
    },
  };
}
