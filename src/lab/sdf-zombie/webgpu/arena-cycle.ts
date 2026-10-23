// src/lab/sdf-zombie/webgpu/arena-cycle.ts
//
// The TEST ARENA's character cycling (game-arena.ts), pure: which registry characters it steps through, and the next
// one from the current. Kept apart from game-arena.ts so it tests without the game's browser-bound spawn chain.
import { characterNames } from '../character-registry';

/** The characters the arena cycles through: the registry, minus the renderer's test fixtures. */
export function arenaCharacters(names: readonly string[] = characterNames()): string[] {
  return names.filter(n => !n.endsWith('-fixture'));
}

/** The character `step` places from `current` in `list` (wrapping); an unknown current starts from the first. */
export function arenaStep(list: readonly string[], current: string, step: number): string {
  const i = list.indexOf(current);
  if (i < 0) return list[0] ?? current;
  return list[((i + step) % list.length + list.length) % list.length]!;
}
