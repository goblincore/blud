// src/lab/sdf-zombie/webgpu/sector-moods.ts
//
// ROOM MOODS (owner playtest 2026-11-01: "everything feels the same"). The converter gives each zone a mood from its Doom
// wall textures (scripts/levels/doom_tables.py MOODS): a sector `tint` on its ambient level (colour and how dark), and the
// colour of the zone's fill light. `?moods=0` strips both, the old even warm white, for the A/B.
//
// Pure: no three.js, no DOM.

import type { LevelDef } from './level-def';

/** The fill lights' colour without moods (doom_map.py). */
export const NEUTRAL_FILL = [1, 0.92, 0.82] as const;

/** Removes the moods from a parsed level, in place: no sector tints; fill lights (no fixture, no mood of their own) neutral. */
export function stripMoods(def: LevelDef): void {
  for (const s of def.sectors?.sectors ?? []) delete s.tint;
  for (const r of def.rooms) for (const l of r.accents) {
    if (l.fixture === 'none' && !l.mood) l.color = [...NEUTRAL_FILL];
  }
}
