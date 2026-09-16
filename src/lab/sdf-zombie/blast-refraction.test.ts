// src/lab/sdf-zombie/blast-refraction.test.ts
//
// THE OPTICAL BLAST WAVE, measured on the CPU. The owner's report
// (2026-09-16) was that `?blastdistort=1` was INDISTINGUISHABLE from off; these
// tests pin the two defects that made it so, not the look:
//   * the band's WORLD radius — it must be born at the fireball's rendered edge
//     and expand past it, not live at 0.3x the fireball where the opaque fire
//     covers every pixel it could have bent;
//   * the band's WAVEFORM and life — a broad shell that survives the flash,
//     not a hairline that is 25% strength by the time the fireball clears.
// They also pin the projection (the band's screen radius shrinks with distance,
// behind-camera blasts are dropped) because getting that wrong is invisible in
// telemetry and obvious in the frame.
import { describe, it, expect } from 'vitest';
import {
  BLAST_REFRACTION, blastRefractionBand, blastRefractionBirthRadiusM,
  blastRefractionLife, blastRefractionOffset, blastRefractionPhase,
  blastRefractionStrength, projectBlastPoint, projectBlastRefraction,
} from './blast-refraction';
import type { Vec3 } from './types';

/** Column-major symmetric perspective matrix, camera at the origin looking -Z. */
function perspective(fovYRad: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

const FOV = Math.PI / 2; // f = 1, so the screen radius is worldRadius / distance.
const VP = perspective(FOV, 1, 0.1, 100);
/** The shipped burst's rendered half-height (game-main scaleBurstVisual). */
const FIREBALL_M = 0.83;

describe('blast refraction scheduling', () => {
  it('grows the band from the fireball edge and out past it', () => {
    // The defect: `0.3 x heightM` = 0.25 m put the whole band inside the opaque
    // 0.83 m fireball. The birth radius must clear the fireball's own surface.
    expect(blastRefractionBirthRadiusM(FIREBALL_M)).toBeGreaterThan(FIREBALL_M);
    // ...and it is the FIREBALL's size that sizes it, not a constant, so a
    // bigger blast gets a bigger wave.
    expect(blastRefractionBirthRadiusM(1.2)).toBeGreaterThan(blastRefractionBirthRadiusM(0.6));
  });

  it('expands monotonically over a life longer than the old 0.3 s', () => {
    expect(blastRefractionLife()).toBeGreaterThan(0.3);
    const p0 = blastRefractionPhase(0)!;
    expect(p0.radiusScale).toBeCloseTo(1, 6);
    let prev = 0;
    for (let age = 0; age < blastRefractionLife(); age += blastRefractionLife() / 60) {
      const p = blastRefractionPhase(age)!;
      expect(p.radiusScale).toBeGreaterThan(prev);
      prev = p.radiusScale;
    }
    // It ends: at and past the life there is no band.
    expect(blastRefractionPhase(blastRefractionLife())).toBeNull();
    expect(blastRefractionPhase(blastRefractionLife() * 3)).toBeNull();
    // The final radius is a real expansion, not a nudge.
    const last = blastRefractionPhase(blastRefractionLife() * 0.999)!;
    expect(last.radiusScale).toBeGreaterThan(1.8);
  });

  it('attacks quickly and then decays, so the band is visible after the flash', () => {
    const early = blastRefractionPhase(blastRefractionLife() * 0.15)!;
    const mid = blastRefractionPhase(blastRefractionLife() * 0.4)!;
    const late = blastRefractionPhase(blastRefractionLife() * 0.85)!;
    expect(early.decay).toBeGreaterThan(0.6);
    expect(mid.decay).toBeGreaterThan(0.3);
    expect(late.decay).toBeLessThan(mid.decay);
    // At the moment the opaque fireball has faded the band still has real
    // strength — this is the frame the owner never saw.
    expect(mid.decay).toBeGreaterThan(0.2);
    // Never negative.
    for (let age = 0; age <= blastRefractionLife(); age += blastRefractionLife() / 100) {
      expect(blastRefractionPhase(age)!.decay).toBeGreaterThanOrEqual(0);
    }
  });

  it('bounded, height-scaled strength with a hard cap', () => {
    const s = blastRefractionStrength(FIREBALL_M);
    expect(s).toBeGreaterThan(0.02);
    expect(s).toBeLessThanOrEqual(BLAST_REFRACTION.strengthMax);
    expect(blastRefractionStrength(1.4)).toBe(BLAST_REFRACTION.strengthMax);
    expect(blastRefractionStrength(-3)).toBeGreaterThan(0);
    // Larger blast, larger peak, but never unbounded.
    expect(blastRefractionStrength(0.9)).toBeGreaterThan(blastRefractionStrength(0.5));
    expect(blastRefractionStrength(1e6)).toBe(BLAST_REFRACTION.strengthMax);
  });

  it('uses a BROAD shell waveform, not the old hairline', () => {
    expect(blastRefractionBand(0)).toBeCloseTo(0, 6);
    expect(blastRefractionBand(1)).toBeCloseTo(0, 6);
    expect(blastRefractionBand(0.5)).toBeCloseTo(1, 6);
    // Symmetric about the mid-band.
    for (const x of [0.1, 0.25, 0.4]) {
      expect(blastRefractionBand(x)).toBeCloseTo(blastRefractionBand(1 - x), 6);
    }
    // The old profile was sin^4: 0.25 at t=0.25. A broad shell keeps real
    // displacement well inside the band.
    expect(blastRefractionBand(0.25)).toBeGreaterThan(0.4);
    expect(blastRefractionBand(0.75)).toBeGreaterThan(0.4);
    // Bounded everywhere.
    for (let x = 0; x <= 1; x += 0.01) {
      const b = blastRefractionBand(x);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
    // Zero outside the band's own span.
    expect(blastRefractionBand(-0.2)).toBe(0);
    expect(blastRefractionBand(1.2)).toBe(0);
  });

  it('the offset peaks mid-band and stays inside the strength budget', () => {
    const s = 0.03;
    expect(blastRefractionOffset(0.5, s)).toBeCloseTo(s, 6);
    expect(blastRefractionOffset(0, s)).toBe(0);
    expect(blastRefractionOffset(1, s)).toBe(0);
    expect(blastRefractionOffset(0.3, s)).toBeLessThan(s);
    expect(blastRefractionOffset(0.3, s)).toBeGreaterThan(0);
  });
});

describe('blast refraction projection', () => {
  it('projects the blast centre to screen UV', () => {
    const centre = projectBlastPoint([0, 0, -4], VP)!;
    expect(centre.u).toBeCloseTo(0.5, 6);
    expect(centre.v).toBeCloseTo(0.5, 6);
    const right = projectBlastPoint([1, 0, -4], VP)!;
    expect(right.u).toBeCloseTo(0.625, 6);
  });

  it('drops a blast behind the camera instead of mirroring it onto the screen', () => {
    expect(projectBlastPoint([0, 0, 4], VP)).toBeNull();
    expect(projectBlastRefraction([0, 0, 4], VP, 1)).toBeNull();
    expect(projectBlastPoint([NaN, 0, -4], VP)).toBeNull();
  });

  it('the screen radius shrinks with distance and clears the fireball it is born outside', () => {
    const near = projectBlastRefraction([0, 0, -3], VP, FIREBALL_M)!;
    const far = projectBlastRefraction([0, 0, -6], VP, FIREBALL_M)!;
    expect(near.radiusUv).toBeGreaterThan(far.radiusUv);
    // f=1, so the height-fraction radius is 0.5 * r / distance.
    expect(near.radiusUv).toBeCloseTo(0.5 * FIREBALL_M / 3, 6);
    // The born band is OUTSIDE the fireball's own projected radius at every
    // playable standoff (3-6 m) — the property the old feed violated.
    for (const d of [3, 4, 5, 6]) {
      const shell = projectBlastRefraction([0, 0, -d], VP, blastRefractionBirthRadiusM(FIREBALL_M))!;
      const fire = projectBlastRefraction([0, 0, -d], VP, FIREBALL_M)!;
      expect(shell.radiusUv).toBeGreaterThan(fire.radiusUv);
      // ...and it still fits on screen rather than becoming a full-frame lens.
      expect(shell.radiusUv).toBeLessThan(0.6);
    }
  });

  it('is finite and positive for a degenerate radius', () => {
    const p = projectBlastRefraction([0, 0, -4], VP, 0)!;
    expect(Number.isFinite(p.u)).toBe(true);
    expect(Number.isFinite(p.v)).toBe(true);
    expect(p.radiusUv).toBeGreaterThan(0);
  });

  it('the band radius the shader receives is a height fraction, aspect independent', () => {
    const wide = perspective(FOV, 2, 0.1, 100);
    const p = projectBlastRefraction([0, 0, -4], wide, FIREBALL_M)!;
    // Same world sphere, same distance: the radius is a fraction of HEIGHT, so
    // the wider viewport does not inflate it.
    expect(p.radiusUv).toBeCloseTo(0.5 * FIREBALL_M / 4, 6);
  });
});

/** A blast that cannot be seen must not warp the frame (feed-side contract). */
describe('blast refraction feed contract', () => {
  it('the tuning keeps the offset budget a few percent, not a full-screen lens', () => {
    expect(BLAST_REFRACTION.maxOffsetUv).toBeGreaterThan(0.02);
    expect(BLAST_REFRACTION.maxOffsetUv).toBeLessThanOrEqual(0.06);
  });

  it('a Vec3 world position is what the wave is anchored to', () => {
    const world: Vec3 = [1, 2, -3];
    const p = projectBlastPoint(world, VP)!;
    expect(Number.isFinite(p.u)).toBe(true);
  });
});
