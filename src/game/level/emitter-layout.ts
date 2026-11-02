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

// --- the sim clock the glow reads ----------------------------------------------------------------
/** The emitter and pool glow clock wraps at this many seconds (f32 keeps ~0.25 ms of precision up to
 *  it, so the 20 Hz sign slots and the 12 Hz troffer slots stay exact; the glow skips once an hour).
 *  3600 is a whole number of every window and slot period here (3 s, 1/10, 1/12, 1/20 s). */
export const GLOW_PERIOD_S = 3600;
export const wrapGlowTime = (t: number): number => t - Math.floor(t / GLOW_PERIOD_S) * GLOW_PERIOD_S;

// --- colours (the WGSL interpolates these; a CPU bake uses the same) -------------------------------
export type RGB3 = readonly [number, number, number];
export const SCREEN_GREEN: RGB3 = [0.22, 1.0, 0.36];
export const SCREEN_AMBER: RGB3 = [1.0, 0.58, 0.12];
/** The share of screens that are amber (an LED panel's readout, type 2, always is). */
export const SCREEN_AMBER_RATE = 0.4;
/** A screen's phosphor: amber or green, per screen (sid, wy) of cell type `ty`. */
export function screenIsAmber(ty: number, sid: number, wy: number): boolean {
  return ty === 2 || emRand(sid, wy + 1) < SCREEN_AMBER_RATE;
}
export const screenColour = (ty: number, sid: number, wy: number): RGB3 => (screenIsAmber(ty, sid, wy) ? SCREEN_AMBER : SCREEN_GREEN);

/** LED lens hues by a 0..1 hash: red below LED_HUE_CUTS[0], green below [1], else amber. */
export const LED_RED: RGB3 = [1.0, 0.10, 0.05];
export const LED_GREEN: RGB3 = [0.25, 1.0, 0.2];
export const LED_AMBER: RGB3 = [1.0, 0.55, 0.08];
export const LED_HUE_CUTS: readonly [number, number] = [0.45, 0.8];
export const ledColour = (hue: number): RGB3 => (hue > LED_HUE_CUTS[1] ? LED_AMBER : hue > LED_HUE_CUTS[0] ? LED_GREEN : LED_RED);
/** An LED's look: below LED_KIND[0] always on, above LED_KIND[1] always dark, else it blinks on with
 *  a phase hash above LED_BLINK_CUT (on 58 % of phases). LED_GAIN is its brightness over a screen's. */
export const LED_KIND: readonly [number, number] = [0.3, 0.88];
export const LED_BLINK_CUT = 0.42;
export const LED_GAIN = 1.4;
/** Is LED `lid` of screen (sid, wy) lit at sim time t? `calm` (?flashes=reduced) freezes the blink at
 *  its phase-0 state: no LED blinks under reduced flashes. */
export function ledOn(sid: number, lid: number, wy: number, t: number, calm: boolean): boolean {
  const k = sid * 16 + lid;
  const kind = emRand(k, wy + 9);
  if (kind < LED_KIND[0]) return true;
  if (kind > LED_KIND[1]) return false;
  const rate = 0.4 + 2.2 * emRand(k, wy + 7);
  const phase = calm ? 0 : Math.floor(t * rate + 7 * emRand(k, wy + 8));
  return emRand(k + phase * 23, wy + 10) > LED_BLINK_CUT;
}

/** Cold blue-white troffers; each panel shifts warm or cool by up to ±FLUORO_WARM / 2. */
export const FLUORO_RGB: RGB3 = [0.78, 0.88, 1.0];
export const FLUORO_WARM = 0.04;
export function fluoroTint(a: number, b: number): RGB3 {
  const w = FLUORO_WARM * (emRand(a, b + 1) - 0.5);
  return [FLUORO_RGB[0] + w, FLUORO_RGB[1], FLUORO_RGB[2] - w];
}
/** A flickering troffer's tube A sags a little with tube B's bursts (none when calm): WGSL
 *  mix(1, 0.92 + 0.08 tb, 1 - calm). */
export const fluoroTubeA = (tb: number, calm: boolean): number => (calm ? 1 : 0.92 + 0.08 * tb);
/** A dim troffer: tube A at DIM_TUBE[0], tube B (nearly out) at DIM_TUBE[1]. */
export const FL_DIM_TUBES: readonly [number, number] = [0.8, 0.06];

export const SIGN_RGB: RGB3 = [1.0, 0.07, 0.04];
/** The sign's backlit panel (mask.g) against its letters (mask.r). */
export const SIGN_BACKLIT = 0.16;

/** The viewscreen display: base glass (plus BASE_UP toward the top), stars, planets, the limb glow. */
export const VS_BASE: RGB3 = [0.008, 0.012, 0.03];
export const VS_BASE_UP: RGB3 = [0.0, 0.01, 0.03];
export const VS_STAR: RGB3 = [0.75, 0.82, 1.0];
export const VS_RIM: RGB3 = [0.3, 0.55, 1.0];
export const VS_PLANET_CHANCE = 0.55;
/** Planet band colours [dark, light]: warm (hue <= 0.5) and cool. */
export const VS_PLANET_WARM: readonly [RGB3, RGB3] = [[0.55, 0.32, 0.16], [0.85, 0.62, 0.36]];
export const VS_PLANET_COOL: readonly [RGB3, RGB3] = [[0.12, 0.38, 0.42], [0.42, 0.70, 0.66]];
/** Screen (wx, wy)'s planet (its centre and radius in screen units 0..1, warm or cool), or null. */
export function viewscreenPlanet(wx: number, wy: number): { c: [number, number]; r: number; cool: boolean } | null {
  if (emRand(wx, wy + 3) >= VS_PLANET_CHANCE) return null;
  return { c: [0.35 + 0.3 * emRand(wx, wy + 4), 0.32 + 0.3 * emRand(wx, wy + 5)], r: 0.18 + 0.14 * emRand(wx, wy + 6), cool: emRand(wx, wy + 7) > 0.5 };
}

// --- mean radiance (what a surface throws on the room: the CPU bake and the converter's lights) -----
/** The glow masks' mean per cell (panel-textures.ts, measured over the 512 px tile; pinned by
 *  emitter-layout.test.ts): screen glass (mask.r) and LED lenses (mask.g) per cell type, the
 *  viewscreen's glass, the troffer's two tubes, the sign's letters and backlit panel. */
export const SB_GLASS_COVER: readonly number[] = [0.250, 0.211, 0.051, 0.355];
export const SB_LED_COVER: readonly number[] = [0.0045, 0.0061, 0.0223, 0.0021];
export const VS_GLASS_COVER = 0.468;
export const FL_TUBE_COVER: readonly [number, number] = [0.150, 0.150];
export const EX_COVER: readonly [number, number] = [0.100, 0.515];
/** The CRT text's mean dot density (the shader fades far text to it), and the screen's other means:
 *  far scanlines 0.89, the rolling bar ~0.99, the vignette ~0.84. */
export const SB_TEXT_MEAN = 0.22;
export const SB_SCREEN_MEAN = (0.07 + 0.95 * SB_TEXT_MEAN) * 0.89 * 0.99 * 0.84;
const LED_ON_MEAN = LED_KIND[0] + (LED_KIND[1] - LED_KIND[0]) * (1 - LED_BLINK_CUT);
const LED_MEAN_RGB: RGB3 = [0, 1, 2].map(i => LED_HUE_CUTS[0] * LED_RED[i]! + (LED_HUE_CUTS[1] - LED_HUE_CUTS[0]) * LED_GREEN[i]!
  + (1 - LED_HUE_CUTS[1]) * LED_AMBER[i]!) as unknown as RGB3;
const stateLevel = (s: PanelState): number => (s === 'dead' ? DEAD_LEVEL : s === 'dim' ? DIM_LEVEL : 1);
const mod4 = (v: number): number => ((v % 4) + 4) % 4;
/** The sector seed the WGSL adds to a panel's row index (i32(sec + 0.5) * 977). */
export const sectorRowSeed = (sector: number): number => Math.round(sector) * 977;

/** Screen-bank cell `wx` (the shader's tile.x * 4 + cell.x) in row `j` (tile.y * 4 + cell.y) of sector
 *  `sector`: its mean linear glow, both readouts of a two-screen cell and its LEDs, dead / dim / flickering
 *  screens included. */
export function screenCellMean(wx: number, j: number, sector: number): [number, number, number] {
  const ty = SB_CELL_TYPES[mod4(j) * 4 + mod4(wx)]!;
  const wy = j + sectorRowSeed(sector);
  const subs = ty === 1 ? 2 : 1;
  const out: [number, number, number] = [0, 0, 0];
  for (let sub = 0; sub < subs; sub++) {
    const sid = wx * 2 + sub;
    const st = panelState(sid, wy, SCREEN_RATES);
    const F = SCREEN_FLICKER;
    const flick = 1 - (st === 'flicker' ? F.flickerChance : F.chance) * (1 - F.dip);
    const col = screenColour(ty, sid, wy);
    const k = SB_SCREEN_MEAN * stateLevel(st) * flick * (SB_GLASS_COVER[ty]! / subs);
    const led = LED_ON_MEAN * LED_GAIN * (SB_LED_COVER[ty]! / subs) * (st === 'dead' ? 0.25 : 1);
    for (let i = 0; i < 3; i++) out[i]! += col[i]! * k + LED_MEAN_RGB[i]! * led;
  }
  return out;
}

/** Viewscreen screen `wx` (tile.x * 2 + cell.x) in row `j` of sector `sector`: its mean linear glow. */
export function viewscreenMean(wx: number, j: number, sector: number): [number, number, number] {
  const wy = j + sectorRowSeed(sector);
  // The glass's mean before the planet: base + half the upward ramp, plus the star layers' ~1 %.
  const base = [0, 1, 2].map(i => VS_BASE[i]! + 0.5 * VS_BASE_UP[i]! + 0.011 * VS_STAR[i]!);
  const out = base.slice() as [number, number, number];
  const p = viewscreenPlanet(wx, wy);
  if (p) {
    const area = Math.min(0.6, Math.PI * p.r * p.r);
    const [c0, c1] = p.cool ? VS_PLANET_COOL : VS_PLANET_WARM;
    // Mean of the disc's lit term (0.03 + 0.9 lit), lit averaging ~0.45 over the disc, × 0.42.
    const shade = (0.03 + 0.9 * 0.45) * 0.42;
    const rim = 0.12 * 0.7 * p.r * p.r;
    for (let i = 0; i < 3; i++) out[i] = base[i]! * (1 - area) + 0.5 * (c0[i]! + c1[i]!) * shade * area + VS_RIM[i]! * rim;
  }
  // Scanlines far (0.86), the vignette's 0.25 + 0.75 × ~0.61, the glass mask.
  const k = 0.86 * (0.25 + 0.75 * 0.61) * VS_GLASS_COVER;
  return [out[0] * k, out[1] * k, out[2] * k];
}

/** The mean level of a flickering troffer's tube B (bursts in `burst` of the windows, `duty` of each,
 *  `off` of the slots at `low`). */
export function fluoroFlickerMean(calm: boolean): number {
  const F = FLUORO_FLICKER;
  return 1 - F.burst * F.duty * F.off * (1 - (calm ? F.calmLow : F.low));
}
/** Troffer `a` (tile.x * 4 + cell.x) in row `j` (tile.y * 2 + cell.y) of sector `sector`: its mean glow. */
export function fluoroCellMean(a: number, j: number, sector: number, calm = false): [number, number, number] {
  const b = j + sectorRowSeed(sector);
  const st = panelState(a, b, FLUORO_RATES);
  let ta = 1, tb = 1;
  if (st === 'dead') { ta = DEAD_LEVEL; tb = DEAD_LEVEL; }
  else if (st === 'dim') { [ta, tb] = FL_DIM_TUBES; }
  else if (st === 'flicker') { tb = fluoroFlickerMean(calm); ta = fluoroTubeA(tb, calm); }
  const tint = fluoroTint(a, b);
  const k = FL_TUBE_COVER[0] * ta + FL_TUBE_COVER[1] * tb;
  return [tint[0] * k, tint[1] * k, tint[2] * k];
}

/** An exit sign's mean glow (letters, backlit panel, its buzz). */
export function signMean(calm = false): [number, number, number] {
  const F = SIGN_BUZZ;
  const k = (EX_COVER[0] + SIGN_BACKLIT * EX_COVER[1]) * (1 - F.chance * (1 - (calm ? F.calmDip : F.dip)));
  return [SIGN_RGB[0] * k, SIGN_RGB[1] * k, SIGN_RGB[2] * k];
}
