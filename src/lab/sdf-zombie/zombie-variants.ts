// src/lab/sdf-zombie/zombie-variants.ts
//
// WHICH ZOMBIE a zombie spawn slot gets. A level's spawn list says `zombie`; a share of those slots spawn a VARIANT
// body on the zombie's skeleton and gait instead (the fat zombie, zombie-fat.blob), so a crowd is not one man copied.
//
// Picked per spawn ID by a stable hash, not a random roll: the same level always puts the fat zombie in the same seats
// (a capture, a bench or a playtest note can name "the fat one by the coal tender"), and adding a spawn never reshuffles
// the others. Each variant is a new crowd type per room (game-crowd-types.ts keys types by character@room), so the
// share stays a minority: every type is one more draw and one more kit in flight.
//
// The ?spawn=<character> playtest override still wins over this (game-spawn.ts spawnAll).

export interface ZombieVariant {
  /** The registry character (character-registry.ts CHARACTERS). */
  name: string;
  /** The share of zombie slots it takes, 0..1. Shares stack in list order; the remainder is the plain zombie. */
  share: number;
}

/** One in four zombies is fat (by the hash, 5 of Night Train's 23 and 5 of The Wake's 20: zombie-variants.test.ts). */
export const ZOMBIE_VARIANTS: readonly ZombieVariant[] = [
  { name: 'zombie-fat', share: 0.25 },
];

/** FNV-1a over the id's UTF-16 units, folded to [0, 1). */
export function spawnRoll(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // A final avalanche: FNV's low bits are weak on ids that differ only in a trailing digit (coats-1, coats-2, ...).
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** The character a `zombie` spawn slot with this id becomes. */
export function zombieVariantFor(id: string, variants: readonly ZombieVariant[] = ZOMBIE_VARIANTS): string {
  const r = spawnRoll(id);
  let acc = 0;
  for (const v of variants) {
    acc += v.share;
    if (r < acc) return v.name;
  }
  return 'zombie';
}
