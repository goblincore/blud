// src/lab/sdf-zombie/characters/venus-blob.test.ts
//
// Pins the venus's DESIGN INTENT. Authored from the brief (no mesh, no plate),
// so these are STRUCTURAL PINS, not mesh-derived thresholds. Each names a beat
// from the .blob header and fails if it is quietly undone:
//
//   * THE MASS: hips the widest thing on her, a waist well inside them, a rear
//     shelf behind the waist, thighs as thick as a waist;
//   * the cyberbride's head, ported: fang row, two glow eyes, strand hair;
//   * one body whose arms and legs keep daylight;
//   * a small marched budget (the biomech rule: detail is normal map and kit).
//
// What this file cannot check is whether she reads. That took the turntable
// frames (docs/dev-notes/2026-10-22-venus/).
import { describe, it, expect } from 'vitest';
import src from './venus.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { clearOf, daylightOf, fusedOf, strandedOf } from '../blob-checks';
import { characterEntry } from '../character-registry';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
type Built = ReturnType<typeof built>;
const limb = (b: Built, l: string) => b.clusters.find(c => c.limb === l)!;
const clusterPrims = (b: Built, l: string) => {
  const c = limb(b, l);
  return b.prims.slice(c.start, c.start + c.count);
};

/** Distance from `from` along `dir` to where the CPU field first leaves flesh. */
function reach(b: Built, from: Vec3, dir: Vec3): number {
  for (let t = 0; t <= 0.6; t += 0.002) {
    if (sdBody([from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t], b) > 0) return t;
  }
  return Infinity;
}

describe('venus.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  // The machinery is the Blender kit, the walk is the heavy STOMP, and the attack is the zombie mind's unarmed
  // swing (no gunner, no melee prop): with talons on her hands it is a rake.
  it('is registered with her kit, a heavy walk and the zombie mind', () => {
    const e = characterEntry('venus');
    expect(e.kit).toBe('/assets/lab/venus-kit.gltf');
    expect(e.profile.name).toBe('venus');
    expect(e.profile.gait.walk.name).toBe('stomp');
    expect(e.profile.gunner).toBeUndefined();
    expect(e.profile.melee).toBeUndefined();
    expect(e.profile.prop).toBeUndefined();
  });

  // The biomech rule: few, large marched prims. The torso (incl. its raw
  // lumps) is the twinhead's 35 or fewer.
  it('keeps the marched budget small', () => {
    const b = built();
    expect(clusterPrims(b, 'torso').length).toBeLessThanOrEqual(16);
    expect(b.prims.length + b.bonePrims.length).toBeLessThanOrEqual(110);
  });

  // BEAT 1 — THE MASS. Measured on the CPU field at the centreline: the hips
  // (y 0.95) half-width beats the waist (y 1.12) by 6 cm or more, the rear
  // stands 8 cm or more behind the waist's back, and the thigh is at least
  // 22 cm across a hand below the crotch.
  it('is heavy: hips past the waist, a rear shelf, thick thighs', () => {
    const b = built();
    const hipHalf = reach(b, [0, 0.95, 0], [1, 0, 0]);
    const waistHalf = reach(b, [0, 1.12, 0], [1, 0, 0]);
    expect(hipHalf).toBeGreaterThan(0.26);
    expect(waistHalf).toBeLessThan(hipHalf - 0.06);
    const rear = reach(b, [0.09, 0.93, 0], [0, 0, -1]);
    const waistBack = reach(b, [0.0, 1.12, 0], [0, 0, -1]);
    expect(rear).toBeGreaterThan(waistBack + 0.08);
    const knee = b.bones.get('thigh.l')!.tail;
    const hip = b.bones.get('thigh.l')!.head;
    const y = hip[1] - 0.15;
    const t = (hip[1] - y) / (hip[1] - knee[1]);
    const cx = hip[0] + (knee[0] - hip[0]) * t;
    const across = reach(b, [cx, y, 0], [1, 0, 0]) + reach(b, [cx, y, 0], [-1, 0, 0]);
    expect(across).toBeGreaterThan(0.22);
  });

  // BEAT 3 — THE CYBERBRIDE'S HEAD. Five upper fangs + an underbite pair, two
  // glowing eyes, four strand bundles of one ash grey.
  it('wears the cyberbride face and hair', () => {
    const b = built();
    const head = clusterPrims(b, 'head');
    const fangs = head.filter(p => p.radiusB !== undefined && p.radius <= 0.010 && p.color !== undefined && !(p.glow ?? 0));
    expect(fangs).toHaveLength(7);
    expect(head.filter(p => (p.glow ?? 0) > 0)).toHaveLength(2);
    const strands = head.filter(p => p.strand);
    expect(strands).toHaveLength(4);
    for (const p of strands) expect(p.color).toEqual(strands[0]!.color);
  });

  it('is one body, and the legs and arms keep daylight', () => {
    const b = built();
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'] as const)
      expect(fusedOf(b, limb(b, l), limb(b, 'torso')), l).toBeLessThan(0);
    expect(clearOf(b, limb(b, 'legL'), limb(b, 'legR'))).toBeGreaterThan(0);
    for (const c of b.clusters) {
      const gap = strandedOf(b, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });

  // Under the skill's 2%-of-height rule (36 mm) on purpose: hips 0.57 m
  // across leave a heavy woman's forearms little room. The tightest pass is
  // the forearm going forward over the hip band (~18 mm); the frames show the
  // arm separate from every yaw.
  it.each(['armL', 'armR'] as const)('%s hangs free of the torso below the shoulder', arm => {
    const b = built();
    const shoulder = b.bones.get(arm === 'armL' ? 'clavicle.l' : 'clavicle.r')!.tail;
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.30)).toBeGreaterThan(0.015);
  });
});
