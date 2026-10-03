// src/lab/sdf-zombie/pose-library.ts
//
// Which pose clips each character has, by the name the lab and the game use for it. Data only; the clips live beside the
// characters (characters/<name>-poses.ts). A character with no entry simply has no poses.
import { GOBLIN_POSES } from './characters/goblin-poses';
import type { PoseClip } from './pose';

const LIBRARY: Readonly<Record<string, Readonly<Record<string, PoseClip>>>> = { goblin: GOBLIN_POSES };

export function posesFor(character: string): Readonly<Record<string, PoseClip>> {
  return LIBRARY[character] ?? {};
}
