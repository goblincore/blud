// src/game/level/emitter-layout.ts
//
// EMITTER SURFACES (hand-off item 2g, part A): the shared layout and the deterministic per-panel
// decisions of the four self-lit panel kinds — screen banks (CRT readouts, LEDs), the viewscreen
// (star field / planet display), fluorescent troffers and exit signs. The static maps (bezel, glass,
// diffuser, letters, grime) are drawn by panel-textures.ts from these numbers; the ANIMATED content is
// drawn in the fragment shader (webgpu/emitter-glow.wgsl.ts) on the sim clock from the same numbers,
// interpolated into the WGSL, so the two never drift.
//
// Every per-panel decision (dead, dim, flickering, colour, blink) comes from an INTEGER hash that the
// WGSL mirrors exactly (u32 arithmetic in both), so the reference functions here are what the shader
// does and tests can pin rates and determinism. All our own procedural looks: no WAD or extracted art.
//
// Pure: no three.js, no DOM.

/** Panel maps are 512 px over 4 m (panel-textures.ts PANEL_SIZE / PANEL_TILE_M). */
export const EMIT_TILE_PX = 512;

// --- screen bank ---------------------------------------------------------------------------------
/** 1 m cells, 4 × 4 per tile. */
export const SB_CELL_PX = 128;
/** Cell types per (cy * 4 + cx) of the tile: 0 one CRT, 1 two readouts, 2 LED / switch panel with a
 *  one-line readout, 3 a big CRT. A fixed table (not a hash) so texture and shader agree exactly. */
export const SB_CELL_TYPES: readonly number[] = [0, 1, 2, 3, 3, 0, 1, 0, 1, 2, 0, 1, 0, 3, 1, 2];
/** Glass rects per type, cell-local px [x0, y0, x1, y1] (row y runs UP the wall). Type 1 has two. */
export const SB_GLASS: readonly (readonly [number, number, number, number])[][] = [
  [[14, 22, 114, 100]],
  [[10, 28, 60, 98], [68, 28, 118, 98]],
  [[16, 92, 112, 112]],
  [[8, 14, 120, 108]],
];
/** Glass corner radius px. */
export const SB_GLASS_R = 7;
/** LED rows per type: [x0, y, dx, count, rows, dy] (rows stacked up by dy). */
export const SB_LEDS: readonly (readonly [number, number, number, number, number, number])[] = [
  [24, 112, 14, 6, 1, 0],
  [20, 112, 12, 8, 1, 0],
  [22, 20, 17, 6, 4, 17],
  [96, 118, 9, 3, 1, 0],
];
export const SB_LED_R = 2.6;
/** Text rows are 6 px tall, glyphs 4 px wide (a 3 × 5 dot glyph and a 1 px gap). */
export const SB_ROW_PX = 6;
export const SB_GLYPH_PX = 4;

// --- viewscreen ----------------------------------------------------------------------------------
/** 2 m screens, 2 × 2 per tile, a heavy frame. */
export const VS_CELL_PX = 256;
export const VS_FRAME_PX = 18;

// --- fluorescent ---------------------------------------------------------------------------------
/** 1 m × 2 m troffers (x across, y along the tubes), 4 × 2 per tile. */
export const FL_CELL_W = 128;
export const FL_CELL_H = 256;
export const FL_FRAME_PX = 10;
/** The two tubes' centres across the cell (px) and their half width. */
export const FL_TUBES: readonly [number, number] = [42, 86];
export const FL_TUBE_HALF = 9;
/** Tube ends (cathodes) are dark this far in from the frame (px). */
export const FL_END_PX = 14;

// --- exit sign -----------------------------------------------------------------------------------
/** One sign per tile (the mesh fits the tile to each sign quad): housing frame px. */
export const EX_FRAME_PX = 40;
/** Our own 5 × 7 block letters (rows top to bottom, '#' lit): E X I T. Not a copied sign or font. */
export const EX_GLYPHS: readonly (readonly string[])[] = [
  ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
];
/** The lettering box inside the tile (px, row y UP): letters 5 dots wide, 1 dot gap. */
export const EX_TEXT_BOX: readonly [number, number, number, number] = [72, 120, 440, 392];

/** Is the exit sign's letter dot at tile px (x, y) lit? (glyph row 0 is the TOP, image row y runs up). */
export function exitLetterAt(x: number, y: number): boolean {
  const [x0, y0, x1, y1] = EX_TEXT_BOX;
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cols = EX_GLYPHS.length * 6 - 1;            // 4 letters × (5 + 1 gap) - the last gap
  const c = Math.floor(((x - x0) / (x1 - x0)) * cols);
  const r = 6 - Math.floor(((y - y0) / (y1 - y0)) * 7);
  const letter = Math.floor(c / 6), dx = c % 6;
  if (dx === 5 || letter >= EX_GLYPHS.length || r < 0 || r > 6) return false;
  return EX_GLYPHS[letter]![r]![dx] === '#';
}

// --- the integer hash the WGSL mirrors -------------------------------------------------------------
/** A 32-bit avalanche hash of two signed integers (WGSL emHash: the same u32 ops). */
export function emHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}
/** 0..1 from emHash (24 bits, exact in f32: WGSL emRand). */
export const emRand = (a: number, b: number): number => (emHash(a, b) >>> 8) / 16777216;

/** A panel's standing state from its id pair: dead (off), dim, flickering, else steady. Rates per kind. */
export type PanelState = 'dead' | 'dim' | 'flicker' | 'steady';
export interface StateRates { dead: number; dim: number; flicker: number }
export const SCREEN_RATES: StateRates = { dead: 0.09, dim: 0.12, flicker: 0.10 };
export const FLUORO_RATES: StateRates = { dead: 0.05, dim: 0.08, flicker: 0.07 };
export function panelState(a: number, b: number, rates: StateRates): PanelState {
  const h = emRand(a, b);
  if (h < rates.dead) return 'dead';
  if (h < rates.dead + rates.dim) return 'dim';
  if (h < rates.dead + rates.dim + rates.flicker) return 'flicker';
  return 'steady';
}
/** A dim panel's level. */
export const DIM_LEVEL = 0.35;
/** A dead panel's residual (a faint afterglow / pilot, never quite black glass). */
export const DEAD_LEVEL = 0.02;

/** A flickering fluorescent's level at sim time t: bursts in some 3 s windows, 12 Hz on/off slots in
 *  them. `calm` (?flashes=reduced) keeps it within 0.85..1, never an on/off strobe. */
export const FLUORO_FLICKER = { window: 3, burst: 0.35, duty: 0.4, slotHz: 12, off: 0.55, low: 0.12, calmLow: 0.85 };
export function fluoroFlicker(t: number, a: number, b: number, calm: boolean): number {
  const F = FLUORO_FLICKER;
  const w = Math.floor(t / F.window);
  const inBurst = emRand(a + w * 7919, b) < F.burst && t / F.window - w < F.duty;
  const off = inBurst && emRand(a + Math.floor(t * F.slotHz) * 31, b + 17) < F.off;
  if (!off) return 1;
  return calm ? F.calmLow : F.low;
}

/** A screen's brief brightness dips (every screen: a 0.1 s slot dips with this chance; flickering
 *  screens far more often). Calm keeps the dip shallow. */
export const SCREEN_FLICKER = { slotHz: 10, chance: 0.012, flickerChance: 0.18, dip: 0.45, calmDip: 0.9 };
export function screenFlicker(t: number, a: number, b: number, flickering: boolean, calm: boolean): number {
  const F = SCREEN_FLICKER;
  const p = emRand(a + Math.floor(t * F.slotHz) * 131, b + 5);
  return p < (flickering ? F.flickerChance : F.chance) ? (calm ? F.calmDip : F.dip) : 1;
}

/** The exit sign's buzz: short dips in 0.05 s slots. */
export const SIGN_BUZZ = { slotHz: 20, chance: 0.05, dip: 0.72, calmDip: 0.95 };
export function signBuzz(t: number, a: number, b: number, calm: boolean): number {
  const F = SIGN_BUZZ;
  return emRand(a + Math.floor(t * F.slotHz) * 53, b + 9) < F.chance ? (calm ? F.calmDip : F.dip) : 1;
}

/** How much of an emitter's glow survives its sector's light: a powered screen stays lit in a dark
 *  room. `lvl` is the sector's current self-lit level, `ref` the level of a full-bright sector (the
 *  curve's max), `k` the kind's floor: max(min(lvl / ref, 1), k). Flicker and strobe sectors still
 *  dim their emitters down to k. */
export function emitterFactor(lvl: number, ref: number, k: number): number {
  const f = ref > 0 ? Math.min(1, Math.max(0, lvl / ref)) : 0;
  return Math.max(f, k);
}
