// src/lab/sdf-zombie/webgpu/crowd-capacity.ts
//
// HOW MANY BODIES A CROWD TYPE HOLDS (2026-11-01). A type's prim atlas, records and instance buffers are allocated up
// front for every body it might hold. There is one type per character and spawn room (game-crowd-types.ts: the room's
// lighting rides on the type), so MAP28's 111 bodies made 30 types, each built for 64. A level knows its cast at boot,
// so each type is built for the bodies it will have. A body past that (a dev spawn) opens another type of the same
// character and room, built for CROWD_OVERFLOW_CAPACITY.
//
// `?crowdsize=0` builds every type at the full MAX_CROWD_INSTANCES (the A/B). A test arena respawns and cycles its
// enemy at will, so it is not sized.

export const CROWD_OVERFLOW_CAPACITY = 8;

export function crowdSizeOn(search: string): boolean {
  return new URLSearchParams(search).get('crowdsize') !== '0';
}

/** The one key of a character's crowd type in a room; `overflow` 0 is the type the level's cast was counted for. */
export function crowdTypeKey(name: string, roomId: number, overflow = 0): string {
  return overflow === 0 ? `${name}@${roomId}` : `${name}@${roomId}#${overflow + 1}`;
}

/** The level's cast counted per crowd type. */
export function crowdCapacities(cast: readonly { name: string; roomId: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cast) {
    const key = crowdTypeKey(c.name, c.roomId);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
