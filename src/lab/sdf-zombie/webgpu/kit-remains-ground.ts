// src/lab/sdf-zombie/webgpu/kit-remains-ground.ts
//
// What a gibbed body's kit and gun land on (kit-remains.ts): the sector debris ground on a sector level; on a room
// level the same walls the gib chunks stop at, one cached ground per collider list. A blast throws these far harder than
// the drop a collapsing body's gun takes, so unlike that drop they cannot ignore a room's walls.
import type { DebrisGround } from '../debris-ground';
import { roomDebrisGround } from '../gib-chunks';
import type { GameContext } from './game-context';
import { ceilingAt, debrisGround } from './game-hit-trace';

const rooms = new WeakMap<object, DebrisGround>();

export function kitRemainsGround(ctx: GameContext): DebrisGround {
  const sector = debrisGround(ctx);
  if (sector) return sector;
  const boxes = ctx.world.colliders;
  let g = rooms.get(boxes);
  if (!g) rooms.set(boxes, g = roomDebrisGround(boxes, (x, z) => ceilingAt(ctx, x, z)));
  return g;
}
