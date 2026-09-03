// src/lab/sdf-zombie/webgpu/flash-sprite.ts
//
// Procedural sprites for the muzzle flash and its smoke.
//
// The first pass drew the flash as two untextured PlaneGeometry quads with a
// flat colour, and it read as exactly what it was: a bright rectangle. A muzzle
// flash is a ragged star of burning gas -- the shape IS the effect -- so both
// sprites are generated here as alpha-carrying textures instead.
//
// Generated rather than baked, for the reasons goblin-skin.ts already gives:
// deterministic, testable by pixel comparison, live-tunable, no load path.

/** Deterministic hash -> [0,1). */
function hash1(i: number, seed: number): number {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A muzzle-flash star, RGBA `size` x `size`, premultiplied-ish for additive
 * blending: white-hot core, warm mid, dark falloff, with `points` irregular
 * spikes whose lengths come from `seed`. Different seeds give visibly
 * different flashes, which is what stops repeat fire from strobing one shape.
 */
export function flashPixels(size: number, seed: number, points = 7): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  // Per-spike length multipliers, so the star is ragged rather than a neat asterisk.
  const spikes: number[] = [];
  for (let i = 0; i < points; i++) spikes.push(0.55 + 0.75 * hash1(i, seed));
  const phase = hash1(97, seed) * Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(nx, ny);
      let a = 0;
      if (r < 1) {
        const th = Math.atan2(ny, nx) + phase;
        // Interpolate spike length around the circle so it is continuous.
        const f = ((th / (Math.PI * 2)) % 1 + 1) % 1 * points;
        const i0 = Math.floor(f) % points;
        const i1 = (i0 + 1) % points;
        const k = f - Math.floor(f);
        const sm = k * k * (3 - 2 * k);
        const reach = (spikes[i0] ?? 1) * (1 - sm) + (spikes[i1] ?? 1) * sm;
        // Core is round; the star only modulates the OUTER falloff, so the
        // middle always reads as a hot ball rather than a spiky hole.
        const core = Math.max(0, 1 - r / 0.34);
        const arms = Math.max(0, 1 - r / Math.max(0.2, reach));
        a = Math.min(1, core * core * 1.4 + arms * arms * arms * 0.9);
      }
      const i = (y * size + x) * 4;
      // White-hot centre grading out through amber.
      px[i]     = Math.round(255 * Math.min(1, 0.55 + a * 0.45));
      px[i + 1] = Math.round(255 * Math.min(1, 0.30 + a * 0.62));
      px[i + 2] = Math.round(255 * Math.min(1, 0.10 + a * 0.72));
      px[i + 3] = Math.round(255 * a);
    }
  }
  return px;
}

/**
 * A soft smoke puff, RGBA `size` x `size`: grey, round, with a lumpy edge so a
 * handful of them at different scales read as a cloud rather than as discs.
 */
export function smokePixels(size: number, seed = 3): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const lobes = 5;
  const off: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < lobes; i++) {
    const th = hash1(i * 3 + 1, seed) * Math.PI * 2;
    const rad = 0.16 + 0.20 * hash1(i * 3 + 2, seed);
    off.push({
      x: Math.cos(th) * rad,
      y: Math.sin(th) * rad,
      r: 0.34 + 0.22 * hash1(i * 3 + 3, seed),
    });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      let a = Math.max(0, 1 - Math.hypot(nx, ny) / 0.72);
      for (const o of off) {
        a = Math.max(a, Math.max(0, 1 - Math.hypot(nx - o.x, ny - o.y) / o.r));
      }
      // Square it for a soft, non-linear edge, and hard-clip the corners so the
      // sprite never shows its own bounding box.
      a = Math.hypot(nx, ny) > 0.99 ? 0 : a * a * 0.85;
      const i = (y * size + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 190;
      px[i + 3] = Math.round(255 * a);
    }
  }
  return px;
}
