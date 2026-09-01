// src/game/level/stone-textures.ts
//
// PROCEDURAL STONE. Generated, never shipped as art — which sidesteps the
// extracted-Blood-asset guardrail entirely (see CLAUDE.md) and, more usefully,
// makes normal-map strength a tunable number instead of a repaint.
//
// The CORE is pure: no canvas, no three, no DOM. That is what lets the look be
// gated by unit test in a codebase where nothing compiles a shader.
export const STONE_SIZE = 256;

export type StoneKind = 'wallBrick' | 'floorCobble' | 'ceilingVault';

export interface StoneTuning {
  /** Height→normal gain. THE primary Doom 3 knob: this is what the moving
   *  flashlight highlight slides across. */
  normalStrength: number;
  /** Roughness of bone-dry stone. */
  dryRoughness: number;
  /** Roughness of soaked stone. Wet == glossy == LOW roughness. */
  wetRoughness: number;
  /** How much wet stone darkens its albedo. */
  wetDarkening: number;
}

export const DEFAULT_TUNING: StoneTuning = {
  normalStrength: 1.0,
  dryRoughness: 0.82,
  wetRoughness: 0.22,
  wetDarkening: 0.45,
};

export interface StoneMaps {
  albedo: Uint8ClampedArray;    // RGBA, sRGB
  normal: Uint8ClampedArray;    // RGBA, LINEAR — tangent-space normal
  roughness: Uint8ClampedArray; // RGBA, LINEAR — value in .r
  /** Single channel, 0..255. Exposed so tests (and tuning) can find wet spots. */
  wetMask: Uint8ClampedArray;
}

/** Deterministic hash-noise. Not the prettiest noise; it is reproducible,
 *  which matters more here than beauty — the tests pin generated pixels. */
function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number, seed: number, scale: number): number {
  const sx = x / scale, sy = y / scale;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const ex = fx * fx * (3 - 2 * fx), ey = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed), n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed), n11 = hash2(x0 + 1, y0 + 1, seed);
  return (n00 * (1 - ex) + n10 * ex) * (1 - ey) + (n01 * (1 - ex) + n11 * ex) * ey;
}

function fbm(x: number, y: number, seed: number, scale: number, octaves = 4): number {
  let sum = 0, amp = 0.5, s = scale;
  for (let o = 0; o < octaves; o++) {
    sum += smoothNoise(x, y, seed + o * 101, s) * amp;
    s *= 0.5; amp *= 0.5;
  }
  return sum;
}

/** Height field for one stone kind, 0..1. Mortar courses sit LOW so the light
 *  rakes across the brick faces and catches their edges. */
function heightAt(kind: StoneKind, x: number, y: number, seed: number): number {
  const grain = fbm(x, y, seed, 18) * 0.35 + fbm(x, y, seed + 7, 5) * 0.12;
  if (kind === 'floorCobble') {
    const cx = Math.floor(x / 22), cy = Math.floor(y / 22);
    const jitter = hash2(cx, cy, seed) * 6;
    const lx = ((x + jitter) % 22) / 22 - 0.5, ly = ((y + jitter) % 22) / 22 - 0.5;
    const dome = Math.max(0, 1 - (lx * lx + ly * ly) * 4.2);
    return Math.min(1, dome * 0.7 + grain);
  }
  const courseH = kind === 'ceilingVault' ? 20 : 28;
  const row = Math.floor(y / courseH);
  const stagger = (row % 2) * 0.5;
  const brickW = kind === 'ceilingVault' ? 40 : 56;
  const u = (x / brickW + stagger) % 1;
  const v = (y % courseH) / courseH;
  const mortar = 0.09;
  const inBrick = u > mortar && u < 1 - mortar && v > mortar && v < 1 - mortar;
  const edge = Math.min(
    Math.min(u, 1 - u) / mortar,
    Math.min(v, 1 - v) / mortar,
  );
  const face = inBrick ? 1 : Math.max(0, edge) * 0.55;
  const chip = hash2(Math.floor(x / brickW), row, seed + 3) * 0.14;
  return Math.min(1, face * (0.82 - chip) + grain);
}

/** Wetness, 0..1. Runs DOWN: streaks, and a soaked band at the bottom of the
 *  image, which maps to the base of a wall where damp actually collects. */
function wetAt(kind: StoneKind, x: number, y: number, seed: number): number {
  const t = y / STONE_SIZE;
  if (kind === 'ceilingVault') {
    // Ceilings get seep patches, not gravity streaks.
    return Math.max(0, fbm(x, y, seed + 31, 40) * 1.7 - 0.62);
  }
  const base = kind === 'floorCobble'
    ? Math.max(0, fbm(x, y, seed + 17, 34) * 1.9 - 0.72)   // puddles
    : Math.pow(t, 2.2) * 0.85;                              // damp rises up the wall
  const streak = Math.max(0, fbm(x * 0.25, y, seed + 5, 26) * 1.6 - 0.72) * (1 - t * 0.4);
  return Math.min(1, base + streak);
}

export function generateStone(
  kind: StoneKind,
  seed: number,
  tuning: Partial<StoneTuning> = {},
): StoneMaps {
  const t = { ...DEFAULT_TUNING, ...tuning };
  const n = STONE_SIZE * STONE_SIZE;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const roughness = new Uint8ClampedArray(n * 4);
  const wetMask = new Uint8ClampedArray(n);

  // Height first — the normal map is its derivative, so it must exist whole.
  const h = new Float32Array(n);
  for (let y = 0; y < STONE_SIZE; y++) {
    for (let x = 0; x < STONE_SIZE; x++) h[y * STONE_SIZE + x] = heightAt(kind, x, y, seed);
  }

  // COLD GRAY, deliberately. Warm light on warm stone gives soft golden
  // highlights that fight the specular this whole feature exists to deliver.
  const BASE: Record<StoneKind, [number, number, number]> = {
    wallBrick: [116, 119, 122],
    floorCobble: [86, 88, 90],
    ceilingVault: [98, 101, 105],
  };

  const wrap = (i: number) => (i + STONE_SIZE) % STONE_SIZE;
  for (let y = 0; y < STONE_SIZE; y++) {
    for (let x = 0; x < STONE_SIZE; x++) {
      const i = y * STONE_SIZE + x;
      const wet = wetAt(kind, x, y, seed);
      wetMask[i] = Math.round(wet * 255);

      const [br, bg, bb] = BASE[kind];
      const shade = 0.6 + h[i]! * 0.5;
      const damp = 1 - wet * t.wetDarkening;
      albedo[i * 4 + 0] = br * shade * damp;
      albedo[i * 4 + 1] = bg * shade * damp;
      albedo[i * 4 + 2] = bb * shade * damp * (1 + wet * 0.05); // damp reads cooler
      albedo[i * 4 + 3] = 255;

      const r = t.dryRoughness + (t.wetRoughness - t.dryRoughness) * wet;
      roughness[i * 4 + 0] = r * 255;
      roughness[i * 4 + 1] = r * 255;
      roughness[i * 4 + 2] = r * 255;
      roughness[i * 4 + 3] = 255;

      // Sobel-lite central difference → tangent-space normal.
      const hl = h[y * STONE_SIZE + wrap(x - 1)]!, hr = h[y * STONE_SIZE + wrap(x + 1)]!;
      const hd = h[wrap(y - 1) * STONE_SIZE + x]!, hu = h[wrap(y + 1) * STONE_SIZE + x]!;
      const dx = (hl - hr) * t.normalStrength * 3;
      const dy = (hd - hu) * t.normalStrength * 3;
      const len = Math.hypot(dx, dy, 1);
      normal[i * 4 + 0] = (dx / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (dy / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = 255;
    }
  }
  return { albedo, normal, roughness, wetMask };
}
