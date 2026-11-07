// src/lab/sdf-zombie/webgpu/game-switches.ts
//
// GUN SWITCHES IN PLAY (2026-11-01): the level's `switches` on ctx.world.switches. The rules are sector-switches.ts;
// game-tick.ts tells it which line a player's round hit (enemy rounds never do), and a press fires the switch's level
// event through the game loop, where the doors hear it (game-doors.ts levelEvent). Each plate is one mesh in the level
// group, so the light-list loop lights it by its zone and the level pre-warm builds it: the door frames' material
// (game-doors.ts frameMaterial), its lamp red until pressed, then green. `?locks=0`: no switches.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { bakeAttributes, FRAME_RGB, frameMaterial, makeStatus } from './game-doors';
import { emitLevelEvent } from './game-loop';
import { LAMP_RGB } from './door-frame-geometry';
import { createSwitchField, shootLine, switchPlateMesh, type SwitchField } from './sector-switches';

export interface GameSwitches {
  readonly field: SwitchField;
  readonly meshes: readonly THREE.Mesh[];
  /** A player's shot hit `line`. */
  shot(line: number): void;
  /** Seam: press switch `id` as a shot would. */
  press(id: string): boolean;
}

export function createGameSwitches(ctx: GameContext): GameSwitches | null {
  const map = ctx.world.level.def?.sectors;
  const fx = ctx.world.sectorFx;
  if (!map?.switches?.length || !fx) return null;
  if (new URLSearchParams(location.search).get('locks') === '0') return null;
  const field = createSwitchField(map.switches, map.lines.length);
  const statuses = map.switches.map(() => makeStatus());
  const meshes = map.switches.map((def, i) => {
    const g = switchPlateMesh(map, def);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('mottleUv', new THREE.Float32BufferAttribute(g.mottleUv, 2));
    bakeAttributes(geo, g.count, g.sector, g);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, frameMaterial(FRAME_RGB, fx, statuses[i]!));
    mesh.name = `switch-${def.id}`;
    mesh.userData.room = map.sectors[g.sector]!.zone + 1;    // the zone's synthesized room id (game-sector-mesh)
    ctx.world.levelGroup.add(mesh);
    return mesh;
  });
  const fire = (s: number) => {
    const c = LAMP_RGB.open;
    statuses[s]!.value.set(c[0], c[1], c[2]);
    const def = field.defs[s]!;
    ctx.telemetry.telemetry.event('switch', { id: def.id, event: def.event });
    emitLevelEvent(ctx, def.event);
  };
  return {
    field, meshes,
    shot(line) { const s = shootLine(field, line); if (s >= 0) fire(s); },
    press(id) {
      const s = field.defs.findIndex(d => d.id === id);
      if (s < 0 || field.pressed[s]) return false;
      field.pressed[s] = 1;
      fire(s);
      return true;
    },
  };
}
