// src/lab/sdf-zombie/webgpu/emergence-entry.ts
//
// How the Flat's emergence is entered (spec 2026-10-21 §3.3). Pure: a function of the query string.
/** The debug flag's autostart delay after the level is ready (sim seconds; game-emergence.ts AUTOSTART_S before this module). */
export const AUTOSTART_DEBUG_S = 2;
/** From the Night Train the player just waited through the bridge: start almost at once. */
export const AUTOSTART_TRAIN_S = 0.5;
/** The black the sequence opens from when arriving from the train (s). */
export const FADE_IN_TRAIN_S = 0.8;

export interface EmergenceEntry { fromTrain: boolean; autostart: boolean; delayS: number; fadeInS: number }

export function emergenceEntry(search: string): EmergenceEntry {
  const q = new URLSearchParams(search);
  const fromTrain = q.get('from') === 'night-train';
  const flag = q.get('emergence');
  const autostart = flag !== '0' && (flag === '1' || fromTrain);
  return { fromTrain, autostart, delayS: fromTrain ? AUTOSTART_TRAIN_S : AUTOSTART_DEBUG_S, fadeInS: fromTrain ? FADE_IN_TRAIN_S : 0 };
}
