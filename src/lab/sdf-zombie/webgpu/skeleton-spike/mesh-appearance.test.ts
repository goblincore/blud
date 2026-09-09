import { describe, expect, it } from 'vitest';
import {
  meshAppearanceCoord, meshGlossMask, meshSkullCavity, meshSocketVessels, meshToothRow,
  skullFeatureMasks, soldierSteelMask, tissuePatchClasses, MESH_GLOSS_DRY,
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

describe('soldier steel reinforcement',()=>{
  it('is localized to the front left temple and gated to Soldier heads',()=>{
    expect(soldierSteelMask([-.48,.08,.9],1)).toBeGreaterThan(.8);
    expect(soldierSteelMask([.48,.08,.9],1)).toBeLessThan(.05);
    expect(soldierSteelMask([-.48,.08,-.9],1)).toBe(0);
    expect(soldierSteelMask([-.48,.08,.9],0)).toBe(0);
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

  it('restores broad skull ivory while keeping body tissue unchanged', () => {
    let skullIvory = 0, ribIvory = 0, n = 0;
    for (let r = 0; r < 6; r++) for (let i = 0; i < 60; i++) for (let j = 0; j < 25; j++) {
      const p: [number, number, number] = [r * 0.31 + i * 0.16 / 59, r * 0.13 + j * 0.05 / 24, r * 0.07];
      if (tissuePatchClasses(p, 1).ivory > 0.5) skullIvory++;
      if (tissuePatchClasses(p, 0).ivory > 0.5) ribIvory++;
      n++;
    }
    expect(skullIvory / n).toBeGreaterThan(0.35);
    expect(skullIvory).toBeGreaterThan(ribIvory);
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
    const upper = skullFeatureMasks(face(0.034, -0.34));
    const lower = skullFeatureMasks(face(0.034, -0.42));
    const bite = skullFeatureMasks(face(0.034, -0.38));
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
    expect(skullFeatureMasks([0.22, -0.34, -0.8]).upperTeeth).toBe(0);
    expect(skullFeatureMasks([0.22, -0.42, -0.8]).lowerTeeth).toBe(0);
    expect(skullFeatureMasks([0.22, -0.38, -0.8]).cavity).toBe(0);
    expect(skullFeatureMasks(face(0.8, -0.38)).cavity).toBeLessThan(0.01);
  });

  it('lays out an irregular human tooth row, not a uniform fence', () => {
    const y = -0.38 + 0.03; // mid-crown of the upper row
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

describe('meshSocketVessels', () => {
  /** Annulus around either socket, in the ring's own normalized units. */
  const ringDistance = (x: number, y: number) => Math.min(
    Math.hypot((x + 0.36) / 0.30, (y - 0.22) / 0.28),
    Math.hypot((x - 0.36) / 0.30, (y - 0.22) / 0.28),
  );

  const scan = () => {
    let ringMax = 0, ringOn = 0, ringN = 0, outsideMax = 0;
    for (let i = 0; i <= 100; i++) for (let j = 0; j <= 100; j++) {
      const x = -1 + i / 100 * 2, y = -1 + j / 100 * 2;
      const v = meshSocketVessels([x, y, 0.9], 1);
      const d = ringDistance(x, y);
      if (d >= 0.7 && d <= 1.2) {
        ringN++;
        if (v > 0.5) ringOn++;
        ringMax = Math.max(ringMax, v);
      } else if (d > 1.5) {
        outsideMax = Math.max(outsideMax, v);
      }
    }
    return { ringMax, ringOn, ringN, outsideMax };
  };

  it('paints irregular vessels in the eye-socket ring only', () => {
    const s = scan();
    expect(s.ringMax).toBeGreaterThan(0.6);
    expect(s.ringOn / s.ringN).toBeGreaterThan(0.05);
    expect(s.ringOn / s.ringN).toBeLessThan(0.7);
    // Nothing outside the ring: the markings do not wrap the skull.
    expect(s.outsideMax).toBe(0);
  });

  it('is head- and front-scoped: nothing on other bones or the back of the skull', () => {
    expect(meshSocketVessels([-0.12, 0.22, 0.9], 0)).toBe(0);
    expect(meshSocketVessels([0, 0.9, 0.9], 1)).toBe(0);
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2;
      expect(meshSocketVessels([Math.cos(a) * 0.8, Math.sin(a) * 0.8, -0.6], 1)).toBe(0);
    }
  });

  it('keeps the vessel sheen local: veins stay wet while the socket recess is matte', () => {
    let vein: [number, number, number] | null = null;
    for (let i = 0; i <= 200 && !vein; i++) {
      const x = -1 + i / 200 * 2;
      for (let j = 0; j <= 200; j++) {
        const y = -1 + j / 200 * 2;
        const q: [number, number, number] = [x, y, 0.9];
        if (meshSocketVessels(q, 1) > 0.4) { vein = q; break; }
      }
    }
    expect(vein).not.toBeNull();
    const p: [number, number, number] = [0.01, 1.6, 0.05];
    expect(meshGlossMask(p, vein!, 1, 0)).toBeGreaterThan(0.12);
    expect(meshGlossMask(p, [-0.36, 0.22, 0.9], 1, 0)).toBeLessThan(0.05);
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
