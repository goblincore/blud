import { describe, expect, it } from 'vitest';
import {
  TRACER, emberPixels, faceEyeBasis, tracerBasis, tracerHeadOn, tracerLength,
  tracerNearFade, tracerNearScale, tracerPixels, type Vec3Tuple,
} from './tracer-sprite';

const at = (px: Uint8Array, w: number, x: number, y: number, c: number) =>
  px[(y * w + x) * 4 + c] ?? 0;
const alphaAt = (px: Uint8Array, w: number, x: number, y: number) => at(px, w, x, y, 3);

const dot = (a: Vec3Tuple, b: Vec3Tuple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3Tuple) => Math.hypot(a[0], a[1], a[2]);

describe('tracerPixels', () => {
  it('is deterministic', () => {
    expect(Array.from(tracerPixels(32, 8))).toEqual(Array.from(tracerPixels(32, 8)));
  });

  it('is a STREAK, not a dot — the head end is far brighter than the tail end', () => {
    const w = 128, h = 32, px = tracerPixels(w, h), mid = h / 2;
    const head = alphaAt(px, w, w - 3, mid);
    const tail = alphaAt(px, w, 2, mid);
    expect(head).toBeGreaterThan(200);
    expect(tail).toBeLessThan(head * 0.15);
  });

  it('brightens monotonically along the streak up to the tip', () => {
    const w = 128, h = 32, px = tracerPixels(w, h), mid = h / 2;
    // Sample the ramp well clear of the rounded tip cap (last 10%).
    let prev = -1;
    for (let x = 1; x < Math.floor(w * 0.88); x++) {
      const a = alphaAt(px, w, x, mid);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it('is BLURRY across the streak — a soft falloff, no hard edge', () => {
    const w = 128, h = 64, px = tracerPixels(w, h);
    const x = Math.floor(w * 0.8);
    const centre = alphaAt(px, w, x, h / 2);
    expect(centre).toBe(255);   // the head is a saturated hot core...
    // ...and alpha never RISES on the way out from it: no ring, no hard rim.
    let prev = 256;
    for (let y = h / 2; y < h; y++) {
      const a = alphaAt(px, w, x, y);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
    expect(alphaAt(px, w, x, h - 1)).toBeLessThan(20);
    // A hard-edged stripe would drop from the plateau to nothing in a step or
    // two; the blur must spend a real fraction of the half-width on the ramp.
    let ramp = 0;
    for (let y = h / 2; y < h; y++) {
      const a = alphaAt(px, w, x, y);
      if (a > 20 && a < 235) ramp++;
    }
    expect(ramp).toBeGreaterThan(h * 0.15);
  });

  it('never shows its own bounding box — the whole border is empty', () => {
    const w = 128, h = 64, px = tracerPixels(w, h);
    for (let x = 0; x < w; x++) {
      expect(alphaAt(px, w, x, 0)).toBe(0);
      expect(alphaAt(px, w, x, h - 1)).toBe(0);
    }
    for (let y = 0; y < h; y++) expect(alphaAt(px, w, 0, y)).toBe(0);
  });

  it('rounds the leading tip off rather than cutting it square', () => {
    const w = 256, h = 32, px = tracerPixels(w, h), mid = h / 2;
    expect(alphaAt(px, w, w - 1, mid)).toBeLessThan(alphaAt(px, w, Math.floor(w * 0.93), mid));
  });

  it('tapers: the tail is narrower than the head', () => {
    const w = 128, h = 64, px = tracerPixels(w, h);
    const reach = (x: number) => {
      let last = 0;
      for (let y = h / 2; y < h; y++) if (alphaAt(px, w, x, y) > 10) last = y - h / 2;
      return last;
    };
    expect(reach(Math.floor(w * 0.85))).toBeGreaterThan(reach(Math.floor(w * 0.35)));
  });

  it('goes white-hot in the core while the halo stays warm', () => {
    const w = 128, h = 64, px = tracerPixels(w, h);
    const x = Math.floor(w * 0.85);
    const coreBlue = at(px, w, x, h / 2, 2);
    const haloBlue = at(px, w, x, Math.floor(h * 0.80), 2);
    expect(coreBlue).toBeGreaterThan(haloBlue);
    // Warm everywhere: blue never leads red.
    for (const y of [h / 2, Math.floor(h * 0.7), Math.floor(h * 0.85)]) {
      expect(at(px, w, x, y, 2)).toBeLessThanOrEqual(at(px, w, x, y, 0));
    }
  });
});

describe('tracerBasis', () => {
  it('pins X to the direction of travel and returns an orthonormal frame', () => {
    const b = tracerBasis([0, 0, -35], [1, 2, 3])!;
    expect(b).not.toBeNull();
    expect(b.x).toEqual([0, 0, -1]);
    for (const v of [b.x, b.y, b.z]) expect(len(v)).toBeCloseTo(1, 6);
    expect(dot(b.x, b.y)).toBeCloseTo(0, 6);
    expect(dot(b.x, b.z)).toBeCloseTo(0, 6);
    expect(dot(b.y, b.z)).toBeCloseTo(0, 6);
  });

  it('rolls the quad so its normal faces the eye', () => {
    const toEye: Vec3Tuple = [0.3, 1, 0.2];
    const b = tracerBasis([1, 0, 0], toEye)!;
    // z is the component of toEye perpendicular to x, so it must point at the
    // eye (positive dot) and carry no travel-axis component.
    expect(dot(b.z, toEye)).toBeGreaterThan(0);
    expect(dot(b.z, b.x)).toBeCloseTo(0, 6);
  });

  it('stays right-handed (x cross y == z)', () => {
    const b = tracerBasis([2, -1, 4], [-1, 3, 0.5])!;
    const xy: Vec3Tuple = [
      b.x[1] * b.y[2] - b.x[2] * b.y[1],
      b.x[2] * b.y[0] - b.x[0] * b.y[2],
      b.x[0] * b.y[1] - b.x[1] * b.y[0],
    ];
    for (let i = 0; i < 3; i++) expect(xy[i]).toBeCloseTo(b.z[i]!, 6);
  });

  it('survives a shot fired straight down the view axis', () => {
    const b = tracerBasis([0, 0, -1], [0, 0, 1])!;
    expect(b).not.toBeNull();
    expect(len(b.y)).toBeCloseTo(1, 6);
    expect(dot(b.x, b.y)).toBeCloseTo(0, 6);
  });

  it('returns null for a zero-length direction', () => {
    expect(tracerBasis([0, 0, 0], [0, 0, 1])).toBeNull();
  });
});

describe('tracerLength', () => {
  it('scales with speed but never collapses', () => {
    expect(tracerLength(35)).toBeCloseTo(35 * TRACER.lengthSec, 6);
    expect(tracerLength(0)).toBe(TRACER.minLength);
    expect(tracerLength(35)).toBeGreaterThan(tracerLength(30));
  });
});

describe('tracerNearFade', () => {
  it('hides the streak at the muzzle and shows it downrange', () => {
    expect(tracerNearFade(0)).toBe(0);
    expect(tracerNearFade(TRACER.fadeInStart)).toBe(0);
    expect(tracerNearFade(TRACER.fadeInEnd)).toBe(1);
    expect(tracerNearFade(50)).toBe(1);
  });

  it('ramps smoothly and monotonically through the band', () => {
    let prev = -1;
    for (let d = 0; d <= 2; d += 0.05) {
      const f = tracerNearFade(d);
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      prev = f;
    }
    // Smoothstep, not linear: the midpoint is 0.5 but the quarter point is not.
    const mid = (TRACER.fadeInStart + TRACER.fadeInEnd) / 2;
    expect(tracerNearFade(mid)).toBeCloseTo(0.5, 6);
    expect(tracerNearFade(TRACER.fadeInStart + (TRACER.fadeInEnd - TRACER.fadeInStart) * 0.25))
      .toBeLessThan(0.25);
  });
});

describe('emberPixels', () => {
  it('is a round soft mote: hot centre, nothing at the rim or corners', () => {
    const n = 64, px = emberPixels(n), c = n / 2;
    expect(alphaAt(px, n, c, c)).toBe(255);
    expect(alphaAt(px, n, 0, 0)).toBe(0);
    expect(alphaAt(px, n, n - 1, n - 1)).toBe(0);
    expect(alphaAt(px, n, c, 0)).toBe(0);
    expect(alphaAt(px, n, 0, c)).toBe(0);
  });

  it('falls off monotonically with radius — no ring, no hard rim', () => {
    const n = 64, px = emberPixels(n), c = n / 2;
    let prev = 256;
    for (let x = c; x < n; x++) {
      const a = alphaAt(px, n, x, c);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it('is radially symmetric', () => {
    // An even-sized texture has no centre texel: with endpoint-inclusive
    // sampling the mirror line sits between rows n/2 - 1 and n/2.
    const n = 64, px = emberPixels(n), lo = n / 2 - 1, hi = n / 2;
    for (const d of [0, 4, 9, 15, 22]) {
      const out = alphaAt(px, n, hi + d, hi);
      expect(alphaAt(px, n, lo - d, hi)).toBe(out);
      expect(alphaAt(px, n, hi, hi + d)).toBe(out);
      expect(alphaAt(px, n, hi, lo - d)).toBe(out);
    }
  });
});

describe('faceEyeBasis', () => {
  it('points the quad normal straight at the eye', () => {
    const toEye: Vec3Tuple = [1, 2, -3];
    const b = faceEyeBasis(toEye)!;
    const l = len(toEye);
    for (let i = 0; i < 3; i++) expect(b.z[i]).toBeCloseTo(toEye[i]! / l, 6);
    expect(dot(b.x, b.z)).toBeCloseTo(0, 6);
    expect(dot(b.y, b.z)).toBeCloseTo(0, 6);
    expect(len(b.x)).toBeCloseTo(1, 6);
    expect(len(b.y)).toBeCloseTo(1, 6);
  });

  it('handles an eye straight above and returns null when there is no direction', () => {
    expect(faceEyeBasis([0, 1, 0])).not.toBeNull();
    expect(faceEyeBasis([0, 0, 0])).toBeNull();
  });
});

describe('tracerHeadOn', () => {
  it('is off broadside — that is where the streak reads on its own', () => {
    expect(tracerHeadOn([1, 0, 0], [0, 0, 1])).toBe(0);
    expect(tracerHeadOn([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('is full head-on AND tail-on — both collapse the streak', () => {
    expect(tracerHeadOn([0, 0, -35], [0, 0, 1])).toBe(1);   // going away
    expect(tracerHeadOn([0, 0, 35], [0, 0, 1])).toBe(1);    // coming at you
  });

  it('rises monotonically as the streak foreshortens', () => {
    // deg = angle between travel and the line of sight: 90 is broadside,
    // 0 is straight down it.
    const at = (deg: number) => tracerHeadOn(
      [Math.sin(deg * Math.PI / 180), 0, Math.cos(deg * Math.PI / 180)], [0, 0, 1]);
    let prev = -1;
    for (let deg = 90; deg >= 0; deg -= 5) {
      const w = at(deg);
      expect(w).toBeGreaterThanOrEqual(prev);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
    expect(at(90)).toBe(0);
    expect(at(0)).toBe(1);
  });

  it('treats a degenerate direction as fully head-on rather than vanishing', () => {
    expect(tracerHeadOn([0, 0, 0], [0, 0, 1])).toBe(1);
  });
});

describe('tracerNearScale', () => {
  // A pellet radius of 0.05 m gives an ember disc of 0.17 m. Arriving at the
  // eye (a soldier's shot at the player), the ember is still allowed by the
  // near fade at 0.65 m, where 0.17 m fills ~13% of the screen width: a flat
  // additive yellow disc over the level (owner screenshot, 2026-09-09). The
  // near fade was tuned for a pellet LEAVING the muzzle under the flash, not
  // one arriving with nothing to hide it.
  it('is 1 at and beyond the reference distance — downrange sizes are untouched', () => {
    expect(tracerNearScale(TRACER.nearRef)).toBe(1);
    expect(tracerNearScale(TRACER.nearRef * 4)).toBe(1);
    expect(tracerNearScale(50)).toBe(1);
  });
  it('shrinks the quad linearly inside it, so the ON-SCREEN size never grows past its size at the reference', () => {
    // Screen size ∝ metres / distance. With the clamp, metres ∝ distance
    // inside nearRef, so metres / distance is constant: the screen size at
    // 0.65 m equals the screen size at nearRef.
    const d = 0.05 * TRACER.emberScale;
    const screenAtRef = d / TRACER.nearRef;
    for (const dist of [0.3, 0.65, 0.95, 2.0]) {
      const screen = (d * tracerNearScale(dist)) / dist;
      expect(screen).toBeCloseTo(screenAtRef, 9);
    }
  });
  it('never returns a negative or NaN scale', () => {
    expect(tracerNearScale(0)).toBe(0);
    expect(tracerNearScale(-1)).toBe(0);
  });
});
