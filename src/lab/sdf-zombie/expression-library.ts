// src/lab/sdf-zombie/expression-library.ts
//
// Which expression clips (and which tuning) each character has, by the name the lab and the game use for it. Data only; the clips
// live beside the characters (characters/<name>-expressions.ts). The twin of pose-library.ts. A character with no entry has none.
import { GOBLIN_EXPRESSIONS, GOBLIN_EXPRESSION_TUNING } from './characters/goblin-expressions';
import type { ExpressionClip, ExpressionTuning } from './expression';

export interface ExpressionSet {
  readonly clips: Readonly<Record<string, ExpressionClip>>;
  readonly tuning: ExpressionTuning;
}

const LIBRARY: Readonly<Record<string, ExpressionSet>> = {
  // The CINEMATIC goblin only (Task 13, owner 2026-10-15): the base goblin has no jaw, teeth or morphs, so no expressions.
  'goblin-cinematic': { clips: GOBLIN_EXPRESSIONS, tuning: GOBLIN_EXPRESSION_TUNING },
};

export function expressionsFor(character: string): ExpressionSet | null {
  return LIBRARY[character] ?? null;
}
