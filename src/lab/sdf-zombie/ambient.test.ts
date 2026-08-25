import { describe, it, expect } from 'vitest';
import { ambientAt, type EnclosureWalls, type Box } from './ambient';

/** A 4m cube centred on the origin's floor: the lab's default enclosure. */
const BOX: Box = { min: [-2, 0, -2], max: [2, 4, 2] };

/** Neutral grey everywhere — no wall should be able to tint anything. */
const GREY: EnclosureWalls = {
  negX: [0.5, 0.5, 0.5], posX: [0.5, 0.5, 0.5],
  negY: [0.5, 0.5, 0.5], posY: [0.5, 0.5, 0.5],
  negZ: [0.5, 0.5, 0.5], posZ: [0.5, 0.5, 0.5],
};

/** Left wall red, everything else near-black: the spike's headline test. */
const RED_LEFT: EnclosureWalls = {
  negX: [0.9, 0.05, 0.05], posX: [0.02, 0.02, 0.02],
  negY: [0.02, 0.02, 0.02], posY: [0.02, 0.02, 0.02],
  negZ: [0.02, 0.02, 0.02], posZ: [0.02, 0.02, 0.02],
};

const KEY: [number, number, number] = [1.0, 0.96, 0.92];
const FILL = 0.06;
const CENTRE: [number, number, number] = [0, 1.4, 0];

describe('ambientAt — the parity guarantee', () => {
  it('returns exactly fillIntensity * keyColor when probeWeight is 0', () => {
    // This is the whole safety story for the spike. If this breaks, every
    // owner-blessed visual silently moves the moment the code lands.
    const got = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 0, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(got[0]).toBeCloseTo(FILL * KEY[0], 12);
    expect(got[1]).toBeCloseTo(FILL * KEY[1], 12);
    expect(got[2]).toBeCloseTo(FILL * KEY[2], 12);
  });

  it('holds parity for every normal direction, not just one', () => {
    const dirs: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [0.577, 0.577, 0.577],
    ];
    for (const n of dirs) {
      const got = ambientAt(CENTRE, n, BOX, RED_LEFT, {
        probeWeight: 0, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
      });
      expect(got[0]).toBeCloseTo(FILL * KEY[0], 12);
    }
  });
});

describe('ambientAt — colour, not brightness', () => {
  it('keeps the fill LEVEL when bounce is fully on at gain 1', () => {
    // The house rule from the spec: the shadow side stays as dark as
    // practical-hard-key makes it, and only its hue changes. Luminance in
    // must equal luminance out.
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const flat = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 0, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const bounced = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(lum(bounced)).toBeCloseTo(lum(flat), 6);
  });

  it('tints the shadow side toward the wall it faces', () => {
    // A normal pointing at the red wall must come back redder than one
    // pointing away from it. This is the effect the spike exists to judge.
    const toward = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const away = ambientAt(CENTRE, [1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const redness = (c: readonly number[]) => c[0]! / Math.max(c[1]! + c[2]!, 1e-6);
    expect(redness(toward)).toBeGreaterThan(redness(away) * 1.5);
  });

  it('gets redder as the character walks toward the red wall', () => {
    // Positional, not a constant ambient cube: this is why bounce lights
    // have distance falloff at all.
    //
    // The all-near-black RED_LEFT fixture cannot show this: with a single
    // coloured wall and unit-luminance renormalisation, the hue ratio is
    // constant regardless of where the point sits, because only that one
    // wall is ever visible. So this test uses a red left wall over a
    // neutral-grey floor and an angled normal that sees BOTH — now the two
    // genuinely compete by distance, and stepping toward the red wall shifts
    // the mix toward red.
    const redness = (c: readonly number[]) => c[0]! / Math.max(c[1]! + c[2]!, 1e-6);
    const RED_FLOOR: EnclosureWalls = {
      negX: [0.9, 0.05, 0.05], posX: [0.02, 0.02, 0.02],
      negY: [0.5, 0.5, 0.5], posY: [0.02, 0.02, 0.02],
      negZ: [0.02, 0.02, 0.02], posZ: [0.02, 0.02, 0.02],
    };
    const n: [number, number, number] = [-0.7, -0.7, 0.2];
    const far = ambientAt([1.5, 1.4, 0], n, BOX, RED_FLOOR, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const near = ambientAt([-1.5, 1.4, 0], n, BOX, RED_FLOOR, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(redness(near)).toBeGreaterThan(redness(far));
  });

  it('leaves a neutral-grey room neutral', () => {
    // No wall is special, so no hue may appear from the maths itself.
    const got = ambientAt(CENTRE, [0.3, -0.5, 0.81], BOX, GREY, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(got[0]).toBeCloseTo(got[1], 3);
    expect(got[1]).toBeCloseTo(got[2], 3);
  });

  it('adds hue with chromaGain WITHOUT touching luminance', () => {
    // The point of the knob. A Cornell box is 4/6 white walls, so the
    // accumulation renormalises to something nearly neutral and the owner sees
    // almost no colour — measured 2026-08-25 as a (+2.1, +0.6, -4.6) shift.
    // chromaGain pushes the tint AWAY from neutral. Both white and the unit
    // tint have luminance 1 and luminance is linear, so the mix is exactly
    // luminance-preserving for any gain: more colour, same brightness, which
    // is the spec's house rule taken literally.
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const at = (chromaGain: number) => ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const plain = at(1), punchy = at(2.5);
    expect(lum(punchy)).toBeCloseTo(lum(plain), 6);
    const chroma = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
    expect(chroma(punchy)).toBeGreaterThan(chroma(plain));
  });

  it('rescues a MOSTLY-WHITE room, which is the case it exists for', () => {
    // RED_LEFT is already near-saturated, so chromaGain has little room there.
    // The real target is a plausible Cornell box: one red wall, one green, four
    // white. Its accumulation renormalises to nearly grey — measured as a
    // (+2.1, +0.6, -4.6) shift on the character, which the owner could not
    // see. This is the fixture that must respond to the knob.
    const CORNELL: EnclosureWalls = {
      negX: [0.63, 0.06, 0.05], posX: [0.15, 0.48, 0.09],
      negY: [0.73, 0.71, 0.68], posY: [0.73, 0.72, 0.70],
      negZ: [0.73, 0.71, 0.68], posZ: [0.73, 0.71, 0.68],
    };
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const chroma = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
    // ANGLED normal, deliberately. With an axis-aligned normal only ONE wall
    // has positive n.L (the others' closest points sit perpendicular to it),
    // so the tint is that wall's pure colour and is already saturated —
    // chromaGain would have nothing to work on and the test could not fail
    // for the right reason. An angled normal makes the red wall and the white
    // floor/back compete, which is what actually washes a Cornell box out.
    const at = (chromaGain: number) => ambientAt([-1.2, 1.4, 0], [-0.66, -0.66, 0.36], BOX, CORNELL, {
      probeWeight: 1, ambientGain: 1, chromaGain, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const plain = at(1), punchy = at(4);
    // Substantially more hue...
    expect(chroma(punchy)).toBeGreaterThan(chroma(plain) * 2);
    // ...at the same brightness. That is the whole promise of the knob.
    expect(lum(punchy)).toBeCloseTo(lum(plain), 6);
  });

  it('chromaGain 0 washes the hue out entirely, still at the same level', () => {
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const grey = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 0, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const plain = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(grey[0]).toBeCloseTo(grey[1], 4);
    expect(grey[1]).toBeCloseTo(grey[2], 4);
    expect(lum(grey)).toBeCloseTo(lum(plain), 6);
  });

  it('keeps every channel non-negative at absurd chromaGain', () => {
    // Extrapolating past neutral drives the weak channels below zero; they are
    // clamped and the result renormalised, so the level survives the clamp.
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const wild = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 12, ceiling: true, fill: FILL, keyColor: KEY,
    });
    for (const c of wild) { expect(Number.isFinite(c)).toBe(true); expect(c).toBeGreaterThanOrEqual(0); }
    const plain = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(lum(wild)).toBeCloseTo(lum(plain), 4);
  });

  it('scales level, and only level, with ambientGain', () => {
    const one = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const two = ambientAt(CENTRE, [-1, 0, 0], BOX, RED_LEFT, {
      probeWeight: 1, ambientGain: 2, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    expect(two[0]).toBeCloseTo(one[0]! * 2, 6);
    expect(two[1]).toBeCloseTo(one[1]! * 2, 6);
  });

  it('never returns a negative or NaN channel anywhere in the box', () => {
    // Degenerate inputs: on a wall, in a corner, and facing straight into it.
    const probes: [number, number, number][] = [
      [-2, 0, -2], [2, 4, 2], [0, 0, 0], [-1.999, 0.001, 0],
    ];
    for (const p of probes) {
      for (const n of [[1, 0, 0], [-1, 0, 0], [0, 1, 0]] as [number, number, number][]) {
        const got = ambientAt(p, n, BOX, RED_LEFT, {
          probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
        });
        for (const c of got) {
          expect(Number.isFinite(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('drops the ceiling contribution when the ceiling is off', () => {
    // Open-topped arena vs Cornell box — spec open question 2.
    const withCeil = ambientAt(CENTRE, [0, 1, 0], BOX, GREY, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: true, fill: FILL, keyColor: KEY,
    });
    const without = ambientAt(CENTRE, [0, 1, 0], BOX, GREY, {
      probeWeight: 1, ambientGain: 1, chromaGain: 1, ceiling: false, fill: FILL, keyColor: KEY,
    });
    // Luminance is renormalised either way, so the LEVEL matches; what
    // changes is that an up-facing normal no longer sees a lit surface.
    expect(withCeil.every((c, i) => Math.abs(c - without[i]!) < 1e-9)).toBe(false);
  });
});
