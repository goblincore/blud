import { describe, expect, it } from 'vitest';
import { fitMeshBeam, meshBeamFalloff, sdfBeamFalloff, MESH_BEAM_WINDOW } from './mesh-beam-fit';

// The game's live beam: gain = beamTuning.gain (4), range = the flashlight
// SpotLight's distance (16 m). See dungeon-lighting.ts / game-main.ts.
const BEAM = { gain: 4, range: 16 };

describe('sdfBeamFalloff (the march beam, on axis)', () => {
  it('is gain * (1 - d/range)^2 — the numbers the kit-brightness investigation measured', () => {
    expect(sdfBeamFalloff(BEAM, 1)).toBeCloseTo(3.52, 2);
    expect(sdfBeamFalloff(BEAM, 1.8)).toBeCloseTo(3.15, 2);
    expect(sdfBeamFalloff(BEAM, 4)).toBeCloseTo(2.25, 2);
    expect(sdfBeamFalloff(BEAM, 16)).toBe(0);
    expect(sdfBeamFalloff(BEAM, 20)).toBe(0);
  });
});

describe('meshBeamFalloff (three SpotLight, physical, Lambert)', () => {
  it('reproduces the shipped flashlight blowing kits out: 28.6x albedo at 1 m, 11.2x at 1.8 m', () => {
    const shipped = { intensity: 90, decay: 1.6, distance: 16 };
    expect(meshBeamFalloff(shipped, 1)).toBeCloseTo(28.6, 1);
    expect(meshBeamFalloff(shipped, 1.8)).toBeCloseTo(11.2, 1);
  });
});

describe('fitMeshBeam', () => {
  const fit = fitMeshBeam(BEAM);

  it('tracks the SDF beam within 15% across the whole fit window', () => {
    for (let d = MESH_BEAM_WINDOW.near; d <= MESH_BEAM_WINDOW.far; d += 0.1) {
      const ratio = meshBeamFalloff(fit, d) / sdfBeamFalloff(BEAM, d);
      expect(ratio, `d=${d.toFixed(1)}`).toBeGreaterThan(0.85);
      expect(ratio, `d=${d.toFixed(1)}`).toBeLessThan(1.15);
    }
    expect(fit.maxRatioError).toBeLessThan(0.15);
  });

  it('matches at melee and room distances (0.7 / 1 / 1.8 / 4 m) within 12%', () => {
    for (const d of [0.7, 1, 1.8, 4]) {
      const ratio = meshBeamFalloff(fit, d) / sdfBeamFalloff(BEAM, d);
      expect(Math.abs(ratio - 1), `d=${d}`).toBeLessThan(0.12);
    }
  });

  it('is a gentle beam, not the shipped one: >5x dimmer than intensity 90/decay 1.6 at 1 m', () => {
    expect(meshBeamFalloff({ intensity: 90, decay: 1.6, distance: 16 }, 1) / meshBeamFalloff(fit, 1)).toBeGreaterThan(5);
    expect(fit.decay).toBeLessThan(1);
  });

  it('scales intensity linearly with gain and leaves the shape (decay, distance) alone', () => {
    const doubled = fitMeshBeam({ gain: 8, range: 16 });
    expect(doubled.intensity).toBeCloseTo(fit.intensity * 2, 6);
    expect(doubled.decay).toBe(fit.decay);
    expect(doubled.distance).toBe(fit.distance);
    expect(fit.intensityPerGain * BEAM.gain).toBeCloseTo(fit.intensity, 6);
  });

  it('keeps the cutoff past the fit window so nothing inside it goes dark', () => {
    expect(fit.distance).toBeGreaterThan(MESH_BEAM_WINDOW.far);
    expect(meshBeamFalloff(fit, MESH_BEAM_WINDOW.far)).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(fitMeshBeam(BEAM)).toEqual(fit);
  });
});
