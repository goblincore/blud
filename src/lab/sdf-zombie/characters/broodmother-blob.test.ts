// src/lab/sdf-zombie/characters/broodmother-blob.test.ts
//
// Pins the broodmother's DESIGN INTENT. Prose-authored (no mesh, no plate), so
// as ogre-blob.test.ts says of its own file these are STRUCTURAL PINS, not
// mesh-derived thresholds. Each names a beat from the .blob header and fails
// if it is quietly undone:
//
//   * eight spider legs, fanned by yaw, every one fused and every tip on the
//     floor;
//   * the hourglass — a waist narrower than both the hips and the ribcage;
//   * three orbs, set in a triangle, each with a glowing gland pore;
//   * the face as prims: slim nose, full painted lips, slanted glowing eyes
//     and four spider eyes;
//   * the prim budget (the first pass was 174 against a 128 ceiling).
//
// What this file CANNOT check is whether she reads. That took the turntable
// frames (docs/dev-notes/2026-09-22-broodmother/).
import { describe, it, expect } from 'vitest';
import src from './broodmother.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { clearOf, daylightOf, fusedOf, strandedOf, worstFieldOnSegment } from '../blob-checks';
import { characterEntry } from '../character-registry';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
type Built = ReturnType<typeof built>;
const limb = (b: Built, l: string) => b.clusters.find(c => c.limb === l)!;
const clusterPrims = (b: Built, l: string) => {
  const c = limb(b, l);
  return b.prims.slice(c.start, c.start + c.count);
};
const HEIGHT = 1.97;
const LEGS = [1, 2, 3, 4] as const;

function clusterBounds(b: Built, l: string) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of clusterPrims(b, l)) {
    if (p.op === 'sub') continue;
    for (const e of [p.a, p.b]) {
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i]!, e[i]! - p.radius * p.scale[i]!);
        mx[i] = Math.max(mx[i]!, e[i]! + p.radius * p.scale[i]!);
      }
    }
  }
  return { mn, mx };
}

describe('broodmother.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('is registered, flesh only, with the generated sheet switched off', () => {
    const e = characterEntry('broodmother');
    expect(e.kit).toBeUndefined();
    // With no sheet block the lab multiplies the default sheet over the head;
    // on this face it painted white greasepaint round the eyes.
    expect(compileSheet(doc)?.enabled).toBe(0);
  });

  // THE BUDGET. flesh + bone must stay under the shader's 128 (validate.ts).
  // The leg nails are thin on purpose so deriveBones skips them (thicken one
  // past half its tarsus and eight bones come back), and the upper-arm and
  // leg2-femur bones are authored to replace two derived ones each. 124
  // after the hair pass (4 hair prims, no bones — the skull's bone is
  // authored), leaving 4.
  it('stays inside the primitive budget with room to spare', () => {
    const b = built();
    expect(b.prims.length + b.bonePrims.length).toBeLessThanOrEqual(124);
  });

  it('crowns at the declared height and stands every leg tip on the floor', () => {
    const b = built();
    expect(doc.height).toBe(HEIGHT);
    const head = clusterBounds(b, 'head');
    expect(head.mx[1]).toBeGreaterThan(HEIGHT - 0.03);
    expect(head.mx[1]).toBeLessThan(HEIGHT + 0.03);
    for (const side of ['l', 'r'] as const) {
      for (const n of LEGS) {
        const tip = b.bones.get(`tarsus${n}.${side}`)!.tail;
        expect(tip[1], `tarsus${n}.${side}`).toBeGreaterThan(-0.02);
        expect(tip[1], `tarsus${n}.${side}`).toBeLessThan(0.03);
      }
    }
  });

  // BEAT 1 — EIGHT LEGS, FANNED. Tips spread front to back past both her
  // face and the abdomen's tail (a spider, not a centipede), and every knee
  // stands proud of the body.
  it('fans eight legs from ahead of her to behind the abdomen, knees high', () => {
    const b = built();
    const zs = LEGS.map(n => b.bones.get(`tarsus${n}.l`)!.tail[2]);
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeLessThan(zs[i - 1]!);
    expect(zs[0]!).toBeGreaterThan(clusterBounds(b, 'head').mx[2]!);
    expect(zs[3]!).toBeLessThan(clusterBounds(b, 'torso').mn[2]! + 0.1);
    const back = clusterBounds(b, 'torso').mx[1]!;
    for (const n of LEGS) {
      const knee = b.bones.get(`femur${n}.l`)!.tail;
      expect(knee[1], `knee ${n}`).toBeGreaterThan(1.2);
      expect(knee[1], `knee ${n}`).toBeLessThan(back);
    }
  });

  // fusedOf probes the cluster CORE only (leg2's coxa). Pin the other three
  // legs' roots individually: the line from each socket to the cephalothorax
  // centre must stay inside flesh.
  it('roots every leg in the cephalothorax', () => {
    const b = built();
    const centre: [number, number, number] = [0, 0.90, -0.08];
    for (const side of ['l', 'r'] as const) {
      for (const n of LEGS) {
        const socket = b.bones.get(`femur${n}.${side}`)!.head;
        expect(worstFieldOnSegment(b, socket, centre), `leg${n}.${side}`).toBeLessThan(0);
      }
    }
  });

  it('is one body, and the legs and arms keep daylight', () => {
    const b = built();
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'] as const)
      expect(fusedOf(b, limb(b, l), limb(b, 'torso')), l).toBeLessThan(0);
    expect(clearOf(b, limb(b, 'legL'), limb(b, 'legR'))).toBeGreaterThan(0.05);
    // Arms against the front femurs — the tightest pass on the body.
    expect(clearOf(b, limb(b, 'armL'), limb(b, 'legL'))).toBeGreaterThan(0.02);
    for (const c of b.clusters) {
      const gap = strandedOf(b, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });

  // Just under the skill's 2%-of-height rule (39 mm): her arms hang close to
  // a slim waist by design; the 3 m frames show them separate from every yaw.
  it.each(['armL', 'armR'] as const)('%s hangs free of the torso below the shoulder', arm => {
    const b = built();
    const shoulder = b.bones.get(arm === 'armL' ? 'clavicle.l' : 'clavicle.r')!.tail;
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.30)).toBeGreaterThan(0.030);
  });

  // BEAT 1 — THE HOURGLASS. The waist is the narrowest thing between the
  // hips and the ribs.
  it('has a wasp waist narrower than both hips and ribcage', () => {
    const b = built();
    const half = (p: ReturnType<typeof clusterPrims>[number]) =>
      Math.max(Math.abs(p.a[0]), Math.abs(p.b[0])) + p.radius * p.scale[0]!;
    const torso = clusterPrims(b, 'torso');
    const onBone = (bone: string) => torso.filter(p => p.bone === bone && p.color === undefined);
    const waist = half(onBone('spine').find(p => p.radiusB !== undefined)!);
    const ribs = Math.max(...onBone('spine').map(half));
    const hips = half(onBone('pelvis').find(p => p.a[1] > 0.95)!);
    expect(waist).toBeLessThan(ribs - 0.02);
    expect(waist).toBeLessThan(hips - 0.05);
  });

  // BEAT 2 — THREE ORBS, in a triangle, each with a glowing pore. The top
  // pair must NOT merge (centres further apart than a diameter).
  it('carries three painted orbs in a triangle, each with a glowing pore', () => {
    const b = built();
    const torso = clusterPrims(b, 'torso');
    const orbs = torso.filter(p => p.bone === 'chest' && p.color !== undefined && !(p.glow ?? 0) && p.radius > 0.07);
    expect(orbs).toHaveLength(3);
    const [low, ...top] = orbs.slice().sort((p, q) => p.a[1] - q.a[1]);
    expect(Math.abs(top[0]!.a[0] - top[1]!.a[0])).toBeGreaterThan(top[0]!.radius + top[1]!.radius);
    expect(Math.abs(low!.a[0])).toBeLessThan(0.001);
    expect(low!.a[1]).toBeLessThan(top[0]!.a[1] - 0.06);
    const pores = torso.filter(p => (p.glow ?? 0) > 0);
    expect(pores).toHaveLength(3);
    for (const o of orbs) {
      // Each pore sits on its orb's forward pole.
      const near = pores.some(p => Math.hypot(p.a[0] - o.a[0], p.a[1] - o.a[1]) < 0.01 && p.a[2] > o.a[2] + 0.06);
      expect(near).toBe(true);
    }
  });

  // BEAT 3 — THE FACE. Two slanted glowing eyes, four dimmer spider eyes, all
  // the same colour as the pores; two painted lips WIDER than the nose is
  // long; a nose that is fine (r <= 1 cm).
  it('has slanted glowing eyes, four spider eyes, full lips and a slim nose', () => {
    const b = built();
    const head = clusterPrims(b, 'head');
    const glow = head.filter(p => (p.glow ?? 0) > 0).sort((p, q) => q.radius - p.radius);
    expect(glow).toHaveLength(6);
    const [eyeA, eyeB, ...spider] = glow;
    for (const e of [eyeA!, eyeB!]) {
      expect(e.glow!).toBeGreaterThan(0.9);
      expect(e.b[1]).toBeGreaterThan(e.a[1]); // outer corner up: slanted
      expect(Math.abs(e.b[0])).toBeGreaterThan(Math.abs(e.a[0]));
    }
    for (const s of spider) {
      expect(s.a[1]).toBeGreaterThan(eyeA!.a[1]);
      expect(s.glow!).toBeLessThan(eyeA!.glow!);
    }
    const lips = head.filter(p => p.color !== undefined && !(p.glow ?? 0) && p.bend !== undefined && !p.strand);
    expect(lips).toHaveLength(2);
    for (const l of lips) expect(Math.abs(l.b[0] - l.a[0])).toBeGreaterThan(0.05);
    const nose = head.find(p => p.blendProfile === 'chamfer' && p.radiusB !== undefined && Math.abs(p.a[0]) < 1e-6 && p.a[1] > lips[0]!.a[1] && p.a[1] < eyeA!.a[1] + 0.02);
    expect(nose).toBeDefined();
    expect(nose!.radius).toBeLessThanOrEqual(0.01);
  });

  // THE HAIR (hairlock pass, 2026-09-22): a ponytail and two face-framing
  // locks as strand bundles, all one platinum. The ponytail hangs down her
  // BACK, clear of the spine; the locks stop above the top orbs.
  it('wears a strand ponytail and two face-framing locks', () => {
    const b = built();
    const head = clusterPrims(b, 'head');
    const strands = head.filter(p => p.strand);
    expect(strands).toHaveLength(3);
    const [pony, ...locks] = strands.slice().sort((p, q) => q.strand!.count - p.strand!.count);
    expect(pony!.b[1]).toBeLessThan(pony!.a[1] - 0.35);
    expect(pony!.b[2]).toBeLessThan(-0.15);
    const topOrb = Math.max(...clusterPrims(b, 'torso').filter(p => p.bone === 'chest' && p.radius > 0.07).map(p => p.a[1] + p.radius));
    for (const l of locks) expect(l.b[1]).toBeGreaterThan(topOrb);
    for (const p of strands) expect(p.color).toEqual(strands[0]!.color);
  });
});
