// src/lab/sdf-zombie/webgpu/emitter-glow.wgsl.ts
//
// EMITTER GLOW (hand-off item 2g, part A): the animated self-light of the four emitter panel kinds,
// drawn in the fragment shader on the sim clock. Each fn takes the panel uv (tile units: one tile is
// one 512 px panel map), the kind's static glow MASK (panel-textures.ts: linear, R/G channels per
// kind), sim seconds, the sector index (a per-sector seed), `calm` (1 under ?flashes=reduced: no
// strong flicker) and `fw` (the uv footprint in texels per pixel, for fading fine text and scanlines
// at a distance). Returns linear RGB before the kind's gain and the sector factor.
//
// Every per-panel decision uses emRand, the exact u32 mirror of emitter-layout.ts emHash/emRand; the
// layout numbers are interpolated from emitter-layout.ts, so the textures and the shader agree.
// Deterministic: no state, only (uv, t, sector).

import {
  DEAD_LEVEL, DIM_LEVEL, EMIT_TILE_PX, FLUORO_FLICKER, FLUORO_RATES, FL_CELL_H, FL_CELL_W,
  SB_CELL_PX, SB_CELL_TYPES, SB_GLASS, SB_GLYPH_PX, SB_LEDS, SB_LED_R, SB_ROW_PX, SCREEN_FLICKER, SCREEN_RATES,
  SIGN_BUZZ, VS_CELL_PX, VS_FRAME_PX,
} from '../../../game/level/emitter-layout';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const EM_HASH = /* wgsl */ `fn emHash(a: u32, b: u32) -> u32 {
  var h = (a * 0x9E3779B1u) ^ ((b + 0x7F4A7C15u) * 0x85EBCA77u);
  h = h ^ (h >> 15u);
  h = h * 0x2C1B3C6Du;
  h = h ^ (h >> 12u);
  h = h * 0x297A2D39u;
  h = h ^ (h >> 15u);
  return h;
}`;

export const EM_RAND = /* wgsl */ `fn emRand(a: i32, b: i32) -> f32 {
  return f32(emHash(bitcast<u32>(a), bitcast<u32>(b)) >> 8u) / 16777216.0;
}`;

/** 0 dead, 1 dim, 2 flicker, 3 steady (emitter-layout.ts panelState). */
const stateFn = (name: string, r: { dead: number; dim: number; flicker: number }) => /* wgsl */ `fn ${name}(a: i32, b: i32) -> f32 {
  let h = emRand(a, b);
  if (h < ${f(r.dead)}) { return 0.0; }
  if (h < ${f(r.dead + r.dim)}) { return 1.0; }
  if (h < ${f(r.dead + r.dim + r.flicker)}) { return 2.0; }
  return 3.0;
}`;
export const EM_SCREEN_STATE = stateFn('emScreenState', SCREEN_RATES);
export const EM_FLUORO_STATE = stateFn('emFluoroState', FLUORO_RATES);

/** A screen's glass rect in its cell (type 1 picks the half the pixel is in). */
const glassRects = SB_GLASS.map((rs, ty) => rs.map((r, k) => {
  const cond = rs.length > 1 ? (k === 0 ? ' && l.x < 64.0' : ' && l.x >= 64.0') : '';
  return `  if (ty == ${ty}${cond}) { return vec4<f32>(${r.map(f).join(', ')}); }`;
}).join('\n')).join('\n');

export const EM_SB_GLASS = /* wgsl */ `fn emSbGlass(ty: i32, l: vec2<f32>) -> vec4<f32> {
${glassRects}
  return vec4<f32>(0.0, 0.0, 1.0, 1.0);
}`;

const ledRows = SB_LEDS.map((r, ty) => `  if (ty == ${ty}) { return vec4<f32>(${f(r[0])}, ${f(r[1])}, ${f(r[2])}, ${f(r[5])}); }`).join('\n');
/** x0, y, dx, dy of a type's LED lattice. */
export const EM_SB_LEDS = /* wgsl */ `fn emSbLeds(ty: i32) -> vec4<f32> {
${ledRows}
  return vec4<f32>(0.0, 0.0, 1.0, 1.0);
}`;

/** The screen bank: CRT text (3 × 5 dot glyphs in rows that scroll up), phosphor base, scanlines, a
 *  rolling bar, vignette, dips; green or amber per screen; dead / dim / flickering screens; LEDs that
 *  blink each at its own slow rate. mask.r = glass (with its grime), mask.g = LED lenses. */
export const EM_SCREEN_BANK = /* wgsl */ `fn emScreenBank(uv: vec2<f32>, mask: vec4<f32>, t: f32, sec: f32, calm: f32, fw: f32) -> vec3<f32> {
  let tile = floor(uv);
  let p = (uv - tile) * ${f(EMIT_TILE_PX)};
  let cell = min(floor(p / ${f(SB_CELL_PX)}), vec2<f32>(3.0));
  let l = p - cell * ${f(SB_CELL_PX)};
  var types = array<i32, 16>(${SB_CELL_TYPES.join(', ')});
  let ty = types[i32(cell.y) * 4 + i32(cell.x)];
  let wx = i32(tile.x) * 4 + i32(cell.x);
  let wy = i32(tile.y) * 4 + i32(cell.y) + i32(sec + 0.5) * 977;
  let r = emSbGlass(ty, l);
  let sub = select(0, 1, ty == 1 && l.x >= 64.0);
  let sid = wx * 2 + sub;
  let state = emScreenState(sid, wy);
  var lvl = 1.0;
  if (state < 0.5) { lvl = ${f(DEAD_LEVEL)}; } else if (state < 1.5) { lvl = ${f(DIM_LEVEL)}; }
  let amber = ty == 2 || emRand(sid, wy + 1) < 0.4;
  let col = select(vec3<f32>(0.22, 1.0, 0.36), vec3<f32>(1.0, 0.58, 0.12), amber);
  let size = r.zw - r.xy;
  let s = clamp((l - r.xy) / size, vec2<f32>(0.0), vec2<f32>(1.0));
  let rows = floor(size.y / ${f(SB_ROW_PX)});
  let cols = floor(size.x / ${f(SB_GLYPH_PX)});
  let speed = select(0.35 + 0.9 * emRand(sid, wy + 2), 0.0, ty == 2);
  let yy = (1.0 - s.y) * rows + t * speed;
  let row = i32(floor(yy));
  let fy = fract(yy) * ${f(SB_ROW_PX)};
  let cx = s.x * cols;
  let c = i32(floor(cx));
  let fx = fract(cx) * ${f(SB_GLYPH_PX)};
  // A line's length and indent per row; a fifth of the rows are blank.
  let lineLen = floor(cols * (0.25 + 0.8 * emRand(row + sid * 97, wy + 3)));
  let indent = floor(3.0 * emRand(row + sid * 97, wy + 4)) * 2.0;
  let blank = emRand(row + sid * 97, wy + 5) < 0.2;
  let dx = i32(floor(fx));
  let dy = i32(floor(fy));
  var dot = 0.0;
  if (!blank && f32(c) >= indent && f32(c) < indent + lineLen && dx < 3 && dy >= 1) {
    // The glyph is one of 61 shapes per (row, column), 15 dots each.
    // The LED panel's one-line readout changes its digits now and then instead of scrolling.
    let tick = select(0, i32(floor(t * 0.7 + emRand(sid, wy + 6) * 5.0)), ty == 2);
    let g = i32(floor(emRand(row * 131 + c + tick * 977, sid) * 61.0));
    dot = select(0.0, 1.0, emRand(g * 15 + (dy - 1) * 3 + dx, 4242) < 0.56);
  }
  // Far away the dots alias, so fade them toward their average density.
  let aa = smoothstep(0.7, 1.8, fw);
  let text = mix(dot, 0.22, aa);
  let scan = mix(0.78 + 0.22 * sin(fy * 3.14159265), 0.89, aa);
  let roll = 1.0 - 0.10 * smoothstep(0.0, 0.08, fract(s.y - t * 0.13)) * (1.0 - smoothstep(0.08, 0.2, fract(s.y - t * 0.13)));
  let ex = min(s.x, 1.0 - s.x);
  let ey = min(s.y, 1.0 - s.y);
  let vig = 0.5 + 0.5 * smoothstep(0.0, 0.18, ex) * smoothstep(0.0, 0.18, ey);
  let flick = screenFlicker(t, sid, wy, state > 1.5 && state < 2.5, calm);
  let screen = col * (0.07 + 0.95 * text) * scan * roll * vig * flick * lvl * mask.r;
  // LEDs, the lattice slot under this pixel, each blinking at its own rate (some steady, some dark).
  let lr = emSbLeds(ty);
  let li = i32(floor((l.x - lr.x) / lr.z + 0.5));
  let lj = select(0, i32(floor((l.y - lr.y) / lr.w + 0.5)), lr.w > 0.0);
  let lid = li + lj * 8 + 16;
  let rate = 0.4 + 2.2 * emRand(sid * 16 + lid, wy + 7);
  let blinkPhase = floor(t * rate + 7.0 * emRand(sid * 16 + lid, wy + 8));
  let kind = emRand(sid * 16 + lid, wy + 9);
  var on = select(0.0, 1.0, emRand(sid * 16 + lid + i32(blinkPhase) * 23, wy + 10) > 0.42);
  if (kind < 0.3) { on = 1.0; }
  if (kind > 0.88) { on = 0.0; }
  let hue = emRand(sid * 16 + lid, wy + 11);
  var lc = vec3<f32>(1.0, 0.10, 0.05);
  if (hue > 0.45) { lc = vec3<f32>(0.25, 1.0, 0.2); }
  if (hue > 0.8) { lc = vec3<f32>(1.0, 0.55, 0.08); }
  let led = lc * on * mask.g * select(1.0, 0.25, state < 0.5);
  return screen + led * 1.4;
}`;

/** A screen's dips (emitter-layout.ts screenFlicker). */
export const EM_SCREEN_FLICKER = /* wgsl */ `fn screenFlicker(t: f32, a: i32, b: i32, flickering: bool, calm: f32) -> f32 {
  let p = emRand(a + i32(floor(t * ${f(SCREEN_FLICKER.slotHz)})) * 131, b + 5);
  let chance = select(${f(SCREEN_FLICKER.chance)}, ${f(SCREEN_FLICKER.flickerChance)}, flickering);
  return select(1.0, mix(${f(SCREEN_FLICKER.dip)}, ${f(SCREEN_FLICKER.calmDip)}, calm), p < chance);
}`;

/** The viewscreen: a dark blue-black display of two drifting star layers, and on some screens a
 *  slowly turning banded planet with a lit limb; scanlines, a strong vignette. mask.r = glass. */
export const EM_VIEWSCREEN = /* wgsl */ `fn emViewscreen(uv: vec2<f32>, mask: vec4<f32>, t: f32, sec: f32, calm: f32, fw: f32) -> vec3<f32> {
  let tile = floor(uv);
  let p = (uv - tile) * ${f(EMIT_TILE_PX)};
  let cell = min(floor(p / ${f(VS_CELL_PX)}), vec2<f32>(1.0));
  let l = p - cell * ${f(VS_CELL_PX)};
  let s = clamp((l - ${f(VS_FRAME_PX)}) / ${f(VS_CELL_PX - 2 * VS_FRAME_PX)}, vec2<f32>(0.0), vec2<f32>(1.0));
  let wx = i32(tile.x) * 2 + i32(cell.x);
  let wy = i32(tile.y) * 2 + i32(cell.y) + i32(sec + 0.5) * 977;
  var col = vec3<f32>(0.008, 0.012, 0.03) + vec3<f32>(0.0, 0.01, 0.03) * s.y;
  // Two star layers drifting at different speeds (parallax), a few twinkling.
  for (var k = 0; k < 2; k++) {
    let dens = select(14.0, 26.0, k == 1);
    let drift = vec2<f32>(t * select(0.010, 0.004, k == 1), t * 0.002);
    let q = (s + drift + vec2<f32>(f32(wx) * 0.37, f32(wy) * 0.21)) * dens;
    let ci = floor(q);
    let fq = q - ci;
    let a = i32(ci.x) + k * 7001;
    let b = i32(ci.y) + wy * 3;
    let h = emRand(a, b);
    let pos = vec2<f32>(emRand(a, b + 1), emRand(a, b + 2)) * 0.8 + 0.1;
    // The star's distance in texels (one screen is ${VS_CELL_PX - 2 * VS_FRAME_PX} texels across).
    let d = length(fq - pos) / dens * ${f(VS_CELL_PX - 2 * VS_FRAME_PX)};
    let rad = select(1.6, 1.1, k == 1) + 0.5 * fw;
    let tw = 0.75 + 0.25 * sin(t * (1.0 + 3.0 * h) + h * 40.0);
    let star = select(0.0, 1.0, h > 0.78) * (1.0 - smoothstep(0.0, rad, d)) * tw;
    col += vec3<f32>(0.75, 0.82, 1.0) * star * select(0.9, 0.45, k == 1);
  }
  // A planet on about half the screens.
  if (emRand(wx, wy + 3) < 0.55) {
    let c = vec2<f32>(0.35 + 0.3 * emRand(wx, wy + 4), 0.32 + 0.3 * emRand(wx, wy + 5));
    let rad = 0.18 + 0.14 * emRand(wx, wy + 6);
    let d = (s - c) / rad;
    let r2 = dot(d, d);
    if (r2 < 1.0) {
      let z = sqrt(1.0 - r2);
      let lat = d.y;
      let lon = d.x / max(z, 0.05) + t * 0.03;
      let band = 0.5 + 0.5 * sin(lat * 13.0 + 1.7 * sin(lon * 2.0 + lat * 4.0));
      let hue = emRand(wx, wy + 7);
      let c0 = select(vec3<f32>(0.55, 0.32, 0.16), vec3<f32>(0.12, 0.38, 0.42), hue > 0.5);
      let c1 = select(vec3<f32>(0.85, 0.62, 0.36), vec3<f32>(0.42, 0.70, 0.66), hue > 0.5);
      let lit = clamp(dot(vec3<f32>(d.x, d.y, z), normalize(vec3<f32>(-0.6, 0.35, 0.7))), 0.0, 1.0);
      col = mix(c0, c1, band) * (0.03 + 0.9 * lit) * 0.42;
    }
    let rim = exp(-abs(sqrt(r2) - 1.0) * 18.0) * 0.12;
    col += vec3<f32>(0.3, 0.55, 1.0) * rim;
  }
  let scan = mix(0.72 + 0.28 * sin(l.y * 1.5707963), 0.86, smoothstep(0.6, 1.6, fw));
  let ex = min(s.x, 1.0 - s.x);
  let ey = min(s.y, 1.0 - s.y);
  let vig = smoothstep(0.0, 0.22, ex) * smoothstep(0.0, 0.22, ey);
  let hum = mix(0.94 + 0.06 * sin(t * 0.7 + f32(wx)), 1.0, calm * 0.5);
  return col * scan * (0.25 + 0.75 * vig) * hum * mask.r;
}`;

/** A fluorescent troffer: two tubes (mask.r tube A and its share of the diffuser, mask.g tube B's),
 *  cold blue-white; per panel dead / dim (tube B out) / flickering (tube B bursts) / steady. */
export const EM_FLUORESCENT = /* wgsl */ `fn emFluorescent(uv: vec2<f32>, mask: vec4<f32>, t: f32, sec: f32, calm: f32, fw: f32) -> vec3<f32> {
  let tile = floor(uv);
  let p = (uv - tile) * ${f(EMIT_TILE_PX)};
  let cell = floor(p / vec2<f32>(${f(FL_CELL_W)}, ${f(FL_CELL_H)}));
  let a = i32(tile.x) * 4 + i32(cell.x);
  let b = i32(tile.y) * 2 + i32(cell.y) + i32(sec + 0.5) * 977;
  let state = emFluoroState(a, b);
  var ta = 1.0;
  var tb = 1.0;
  if (state < 0.5) { ta = ${f(DEAD_LEVEL)}; tb = ${f(DEAD_LEVEL)}; }
  else if (state < 1.5) { ta = 0.8; tb = 0.06; }
  else if (state < 2.5) { tb = fluoroFlicker(t, a, b, calm); ta = mix(1.0, 0.92 + 0.08 * tb, 1.0 - calm); }
  let warm = 0.04 * (emRand(a, b + 1) - 0.5);
  let col = vec3<f32>(0.78 + warm, 0.88, 1.0 - warm);
  return col * (mask.r * ta + mask.g * tb);
}`;

/** A flickering tube (emitter-layout.ts fluoroFlicker). */
export const EM_FLUORO_FLICKER = /* wgsl */ `fn fluoroFlicker(t: f32, a: i32, b: i32, calm: f32) -> f32 {
  let w = floor(t / ${f(FLUORO_FLICKER.window)});
  let inBurst = emRand(a + i32(w) * 7919, b) < ${f(FLUORO_FLICKER.burst)} && (t / ${f(FLUORO_FLICKER.window)} - w) < ${f(FLUORO_FLICKER.duty)};
  let off = inBurst && emRand(a + i32(floor(t * ${f(FLUORO_FLICKER.slotHz)})) * 31, b + 17) < ${f(FLUORO_FLICKER.off)};
  return select(1.0, mix(${f(FLUORO_FLICKER.low)}, ${f(FLUORO_FLICKER.calmLow)}, calm), off);
}`;

/** The exit sign: red letters (mask.r) on a dim red backlit panel (mask.g), a slight buzz. */
export const EM_EXIT_SIGN = /* wgsl */ `fn emExitSign(uv: vec2<f32>, mask: vec4<f32>, t: f32, sec: f32, calm: f32, fw: f32) -> vec3<f32> {
  let tile = floor(uv);
  let a = i32(tile.x);
  let b = i32(tile.y) + i32(sec + 0.5) * 977;
  let F = ${f(SIGN_BUZZ.slotHz)};
  let dip = select(1.0, mix(${f(SIGN_BUZZ.dip)}, ${f(SIGN_BUZZ.calmDip)}, calm), emRand(a + i32(floor(t * F)) * 53, b + 9) < ${f(SIGN_BUZZ.chance)});
  return vec3<f32>(1.0, 0.07, 0.04) * (mask.r + 0.16 * mask.g) * dip;
}`;

/** The fn names per emitter kind, and every helper string (includes go in dependency order). */
export const EMITTER_FN = {
  screenBank: { name: 'emScreenBank', src: EM_SCREEN_BANK, deps: [EM_SCREEN_STATE, EM_SB_GLASS, EM_SB_LEDS, EM_SCREEN_FLICKER] },
  viewscreen: { name: 'emViewscreen', src: EM_VIEWSCREEN, deps: [] },
  fluorescent: { name: 'emFluorescent', src: EM_FLUORESCENT, deps: [EM_FLUORO_STATE, EM_FLUORO_FLICKER] },
  exitSign: { name: 'emExitSign', src: EM_EXIT_SIGN, deps: [] },
} as const;
export type EmitterKind = keyof typeof EMITTER_FN;
export const EMITTER_KINDS = Object.keys(EMITTER_FN) as EmitterKind[];
