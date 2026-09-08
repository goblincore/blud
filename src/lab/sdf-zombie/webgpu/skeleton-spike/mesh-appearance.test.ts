import { describe, expect, it } from 'vitest';
import {
  meshAppearanceCoord, meshGlossMask, meshSkullCavity, meshToothRow,
  skullFeatureMasks, tissuePatchClasses, MESH_GLOSS_DRY,
} from './mesh-appearance';

const headBounds = {
  min: [-0.09, 1.49, 0.01] as [number, number, number],
  max: [0.09, 1.74, 0.22] as [number, number, number],
};

/** Front-of-skull normalized point (z>0, headFlag 1). */
const face = (x: number, y: number): [number, number, number] => [x, y, 0.9];

describe('meshAppearanceCoord', () => {
  it('maps source-local head bounds to a stable signed frame', () => {
    meshAppearanceCoord(headBounds, [0, 1.615, 0.115]).forEach(v => expect(v).toBeCloseTo(0, 12));
    expect(meshAppearanceCoord(headBounds, headBounds.min)).toEqual([-1, -1, -1]);
    expect(meshAppearanceCoord(headBounds, headBounds.max)).toEqual([1, 1, 1]);
  });
});

describe('tissuePatchClasses', () => {
  // Sample several rib-length segments so the assertions cover real
  // realizations, not one lucky blob.
  const sample = () => {
    const out = { blood: 0, connect: 0, ivory: 0, both: 0, n: 0 };
    for (let r = 0; r < 6; r++) for (let i = 0; i < 60; i++) for (let j = 0; j < 25; j++) {
      const p: [number, number, number] = [r * 0.31 + i * 0.16 / 59, r * 0.13 + j * 0.05 / 24, r * 0.07];
      const c = tissuePatchClasses(p, 0);
      out.n++;
      if (c.blood > 0.5) out.blood++;
      if (c.connect > 0.5) out.connect++;
      if (c.ivory > 0.5) out.ivory++;
      if (c.blood > 0.4 && c.connect > 0.4) out.both++;
    }
    return out;
  };

  it('produces all three tissue classes at readable coverage', () => {
    const s = sample();
    const blood = s.blood / s.n, connect = s.connect / s.n, ivory = s.ivory / s.n;
    // Dark burgundy attachment, pink connective tissue and a limited ivory
    // reveal all have to be present, none of them dominating.
    expect(blood).toBeGreaterThan(0.15);
    expect(blood).toBeLessThan(0.7);
    expect(connect).toBeGreaterThan(0.15);
    expect(connect).toBeLessThan(0.7);
    expect(ivory).toBeGreaterThan(0.005);
    expect(ivory).toBeLessThan(0.12);
  });

  it('keeps blood and connective patches mostly disjoint (painted, not blended)', () => {
    const s = sample();
    expect(s.both / s.n).toBeLessThan(0.1);
  });

  it('changes sharply over a few millimetres (discontinuous patches)', () => {
    let maxDelta = 0;
    for (let i = 0; i < 31; i++) {
      const a = tissuePatchClasses([i * 0.005, 0.02, 0.02], 0).blood;
      const b = tissuePatchClasses([(i + 1) * 0.005, 0.02, 0.02], 0).blood;
      maxDelta = Math.max(maxDelta, Math.abs(a - b));
    }
    expect(maxDelta).toBeGreaterThan(0.25);
  });

  it('suppresses exposed ivory on the skull while keeping it on other bones', () => {
    let skullIvory = 0, ribIvory = 0, n = 0;
    for (let r = 0; r < 6; r++) for (let i = 0; i < 60; i++) for (let j = 0; j < 25; j++) {
      const p: [number, number, number] = [r * 0.31 + i * 0.16 / 59, r * 0.13 + j * 0.05 / 24, r * 0.07];
      if (tissuePatchClasses(p, 1).ivory > 0.5) skullIvory++;
      if (tissuePatchClasses(p, 0).ivory > 0.5) ribIvory++;
      n++;
    }
    expect(skullIvory / n).toBeLessThan(0.02);
    expect(ribIvory).toBeGreaterThan(skullIvory);
  });
});

describe('skullFeatureMasks', () => {
  it('makes both eye sockets broad and symmetric on the frontal cranium', () => {
    const left = skullFeatureMasks(face(-0.36, 0.22));
    const right = skullFeatureMasks(face(0.36, 0.22));
    expect(left.sockets).toBeGreaterThan(0.75);
    expect(right.sockets).toBeCloseTo(left.sockets, 8);
    expect(skullFeatureMasks(face(0, 0.22)).sockets).toBeLessThan(0.1);
  });

  it('keeps the nasal cavity central and distinct from the sockets', () => {
    const nose = skullFeatureMasks(face(0, -0.08));
    expect(nose.nose).toBeGreaterThan(0.7);
    expect(nose.sockets).toBeLessThan(0.15);
    expect(skullFeatureMasks(face(0.3, -0.08)).nose).toBeLessThan(0.05);
  });

  it('reads as TWO tooth rows separated by the mouth line', () => {
    const upper = skullFeatureMasks(face(0.034, -0.49));
    const lower = skullFeatureMasks(face(0.034, -0.57));
    const bite = skullFeatureMasks(face(0.034, -0.53));
    expect(upper.upperTeeth).toBeGreaterThan(0.7);
    expect(upper.lowerTeeth).toBe(0);
    expect(lower.lowerTeeth).toBeGreaterThan(0.7);
    expect(lower.upperTeeth).toBe(0);
    // The gap at the bite line is cavity, so the two rows stay legible.
    expect(bite.upperTeeth).toBe(0);
    expect(bite.lowerTeeth).toBe(0);
    expect(bite.cavity).toBeGreaterThan(0.9);
  });

  it('confines teeth and cavities to the front of the skull', () => {
    expect(skullFeatureMasks([0.22, -0.49, -0.8]).upperTeeth).toBe(0);
    expect(skullFeatureMasks([0.22, -0.57, -0.8]).lowerTeeth).toBe(0);
    expect(skullFeatureMasks([0.22, -0.53, -0.8]).cavity).toBe(0);
    expect(skullFeatureMasks(face(0.8, -0.53)).cavity).toBeLessThan(0.01);
  });

  it('lays out an irregular human tooth row, not a uniform fence', () => {
    const y = -0.53 + 0.03; // mid-crown of the upper row
    const runs: number[] = [];
    let inRun = false, start = 0;
    for (let x = -0.6; x <= 0.6; x += 0.001) {
      const on = meshToothRow([x, y, 0.9], 1) > 0.5;
      if (on && !inRun) { inRun = true; start = x; }
      if (!on && inRun) { inRun = false; runs.push(x - start); }
    }
    const teeth = runs.filter(w => w > 0.02);
    // Seven per side, mirrored, minus partially clipped outer teeth.
    expect(teeth.length).toBeGreaterThanOrEqual(12);
    // Widths and gaps vary; a uniform fence would have identical runs.
    expect(Math.max(...teeth) - Math.min(...teeth)).toBeGreaterThan(0.008);
  });
});

describe('meshGlossMask', () => {
  it('varies gloss across a segment: wet patches and matte areas coexist', () => {
    let min = 2, max = -1;
    for (let i = 0; i < 80; i++) for (let j = 0; j < 30; j++) {
      const g = meshGlossMask([i * 0.16 / 79, j * 0.05 / 29, 0.02], [0, 0, 0.5], 0, 0);
      min = Math.min(min, g); max = Math.max(max, g);
    }
    expect(max).toBeGreaterThan(0.6);
    expect(min).toBeLessThan(0.15);
    expect(min).toBeGreaterThanOrEqual(MESH_GLOSS_DRY * 0.8);
  });

  it('kills gloss inside skull cavities (localized, head-scoped)', () => {
    const socket = [-0.36, 0.22, 0.9] as [number, number, number];
    expect(meshSkullCavity(socket, 1)).toBeGreaterThan(0.9);
    const occluded = meshGlossMask([0.01, 1.6, 0.05], socket, 1, 0);
    const sameGeometryNotHead = meshGlossMask([0.01, 1.6, 0.05], socket, 0, 0);
    expect(occluded).toBeLessThan(0.05);
    // The suppression is a head-cavity rule, not a global darkening.
    expect(sameGeometryNotHead).toBeGreaterThan(0.2);
  });

  it('raises gloss with wound exposure (fresh crater is blood-slick)', () => {
    const p: [number, number, number] = [0.01, 1.6, 0.05];
    const q: [number, number, number] = [0, -0.2, 0.9];
    const dry = meshGlossMask(p, q, 0, 0);
    const fresh = meshGlossMask(p, q, 0, 1);
    expect(fresh).toBeGreaterThan(dry);
  });
});
