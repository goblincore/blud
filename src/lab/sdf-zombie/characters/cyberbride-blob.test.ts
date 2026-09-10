// src/lab/sdf-zombie/characters/cyberbride-blob.test.ts
//
// Pins the cyberbride's authored INTENT, not a mesh fit — no reference mesh
// exists (description-authored, the soldier/widow route), so like
// gargoyle-blob.test.ts these are structural pins. The brief (owner,
// 2026-09-09): a cyborg terminator — chrome MESH endoskeleton under
// translucent SDF flesh — with a Willendorf female silhouette, a monster's
// maw, pointed ears and strand hair. What this file cannot check is whether
// she READS (the chrome ghost, the grotesque balance); that is the
// turntable's job. The translucency itself is registry data (fleshAlpha) +
// sdf-layer's ghost pass, not .blob geometry.
import { describe, it, expect } from 'vitest';
import src from './cyberbride.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { packBody, PRIM_STRIDE } from '../pack';
import { checkStance, clearOf, daylightOf, fusedOf } from '../blob-checks';
import type { BuiltBody } from '../types';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: BuiltBody, name: string) => b.clusters.find(c => c.limb === name)!;

describe('cyberbride.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, so a
  // key typo is invisible unless each block is compiled explicitly (the
  // cyclops/clown trap). She declares NO sheet block — her face is the
  // registry's flat zombie mask — but the block must still be absent cleanly.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
    expect(compilePalette(doc)).not.toBeNull();
  });

  it('declares humanoid and folds the knee forward of the hip->ankle line', () => {
    expect(doc.stance).toBe('humanoid');
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  // THE WILLENDORF TAPER — the brief's female read, in order: hips widest,
  // then the bust, then the soft waist. Measured on the authored prims
  // (half-widths, metres). The soldier pot-belly lesson runs FORWARD here:
  // the ribcage is WIDER than the belly below it.
  it('is hips > bust > waist, with the ribcage wider than the belly', () => {
    const lines = doc.parts;
    const halfWidth = (l: { radius: number; wide: number }) => l.radius * l.wide;
    // Hips: the pelvis blob (the widest torso mass on the pelvis bone).
    const hip = lines
      .filter(l => l.kind === 'blob' && l.limb === 'torso' && l.bone === 'pelvis')
      .map(halfWidth)
      .sort((a, b) => b - a)[0]!;
    // Bust: the drooped mounds — torso blobs on chest carrying a downward
    // tip= droop; outer reach is centre x + half-width.
    const bust = lines
      .filter(l => l.kind === 'blob' && l.limb === 'torso' && l.bone === 'chest' && l.tip && l.tip[1] < -0.02)
      .map(l => Math.abs(l.offset![0]) + halfWidth(l))
      .sort((a, b) => b - a)[0]!;
    // Waist: the belly bar's top radius (where the skirt waistband sits).
    const waist = lines
      .filter(l => l.kind === 'bar' && l.limb === 'torso' && l.bone === 'spine1')
      .map(l => l.radiusB!)
      .sort((a, b) => a - b)[0]!;
    // Ribcage: the chest bar's far-end (top) radius.
    const ribs = lines
      .filter(l => l.kind === 'bar' && l.limb === 'torso' && l.bone === 'chest')
      .map(l => l.radiusB!)
      .sort((a, b) => b - a)[0]!;
    expect(hip).toBeGreaterThan(bust); // Willendorf: hips own the silhouette
    expect(bust).toBeGreaterThan(waist);
    expect(ribs).toBeGreaterThan(waist); // NOT a pot belly
    // The mounds droop: tip points down-and-forward from the centre.
    for (const l of lines) {
      if (l.kind === 'blob' && l.limb === 'torso' && l.bone === 'chest' && l.tip && l.tip[1] < -0.02) {
        expect(l.tip[1]).toBeLessThan(0); // sag
        expect(l.tip[2]).toBeGreaterThan(0); // and forward
      }
    }
  });

  // THE MAW — teeth are GEOMETRY (the gnasher lesson: teeth need the dark
  // interior behind them, and every maw in the cast is prims). Seven fangs:
  // five hanging from the upper line, two rising to interlock.
  it('wears a fang row over a dark maw, pale bone painted', () => {
    const lines = doc.parts;
    // Seven pale-bone pointed prims on the head: the five uppers (authored
    // individually, splayed) + the two rising lowers (`both` doubles). They
    // are the ONLY tiny-tipped painted prims on the head — the ears are two
    // of the tips too, so the tip filter alone is not enough; paint is.
    const fangs = lines.filter(
      l => l.kind === 'blob' && l.limb === 'head' && l.radiusB !== null && l.radiusB < 0.005
        && l.color !== null && l.glow === null && (l.tip === null || Math.abs(l.tip[1]!) < Math.abs(l.tip[0] ?? 0) + 0.02 || l.tip[1]! > 0 || l.offset![1]! < -0.02),
    );
    expect(fangs.length).toBe(6);
    // All fangs hang near the mouth line (local y between -0.08 and -0.04 at
    // the base) and come to a point (r2 tiny against r).
    for (const f of fangs) {
      expect(f.offset![1]).toBeGreaterThan(-0.08);
      expect(f.offset![1]).toBeLessThan(-0.04);
      expect(f.radiusB!).toBeLessThan(f.radius * 0.3);
    }
    // The dark interior behind them.
    const maw = lines.find(
      l => l.limb === 'head' && l.color && l.color[0] < 0.05 && l.color[1] < 0.03,
    );
    expect(maw).toBeDefined();
  });

  // THE EYES — exactly two glow prims (one authored line, `both` doubles).
  // Mirrors the GLOW_PRIMS allowlist in pack.test.ts; keep the two in step.
  it('glows through exactly two red eyes', () => {
    const b = built();
    const packed = packBody(b);
    let glowing = 0;
    for (let i = 0; i < b.prims.length; i++)
      if (Math.abs(packed.primClip[i * PRIM_STRIDE + 3]!) > 0) glowing++;
    expect(glowing).toBe(2);
  });

  // THE EARS — imp points: a true point (r2 near zero), swept out and UP,
  // one line mirrored to a pair.
  it('has two pointed ears standing clear of the cranium', () => {
    const ears = doc.parts.filter(
      l => l.limb === 'head' && l.tip && l.tip[0] > 0.02 && l.tip[1] > 0.02 && l.radiusB !== null && l.radiusB < 0.01,
    );
    expect(ears.length).toBe(1); // authored once, `both` mirrors
    expect(ears[0]!.both).toBe(true);
    const ear = ears[0]!;
    // The point stands clear: tip x + r exceeds the cranium half-width
    // (headRadius * headWidth = 0.068).
    expect(Math.abs(ear.tip![0]) + ear.radius).toBeGreaterThan(0.068);
  });

  // THE HAIR — the schoolgirl-described strand system: a crown MASS plus
  // three strand bundles, every bundle within STRAND_COUNT_MAX (16) and
  // wave <= 0.27 (blob-compile rejects worse, but pin the intent).
  it('hers is strand hair: a crown mass and three bundles, counts legal', () => {
    const lines = doc.parts;
    const strands = lines.filter(l => l.strand !== null && l.strand !== undefined);
    expect(strands.length).toBe(3);
    for (const s of strands) {
      expect(s.strand!).toBeLessThanOrEqual(16);
      expect(s.strand!).toBeGreaterThanOrEqual(1);
      expect(s.strandWave).toBeLessThanOrEqual(0.27);
    }
    // The crown mass itself carries NO strand (a silhouette is a volume).
    const crown = lines.filter(
      l => l.limb === 'head' && l.kind === 'blob' && !l.tip && l.radius > 0.06,
    );
    expect(crown.length).toBeGreaterThanOrEqual(1);
    expect(crown.every(l => l.strand === null || l.strand === undefined)).toBe(true);
  });

  // THE ARMS MUST READ AS ARMS on a body whose hips are nearly twice the
  // waist: daylightOf, not clearOf (the goblin's twice-bitten lesson). The
  // bound applies below the elbow; the deltoid merge is wanted. Measured
  // against the torso's FLESH only — the burial skirt is a cloth SHELL in
  // the same cluster, and cloth brushing the resting forearm is what cloth
  // does; it was the shell's hem, not the hips, that failed the first
  // drafts. The flesh prims are what must never swallow the arm.
  it.each(['armL', 'armR'] as const)('%s hangs free of the torso flesh below the elbow', arm => {
    const b = built();
    const torso = limb(b, 'torso');
    const slice = b.prims.slice(torso.start, torso.start + torso.count);
    const flesh = slice.filter(p => p.shell === undefined); // drop the skirt shell
    const fleshTorso = { ...torso, start: 0, count: flesh.length };
    const fleshBody = {
      ...b,
      prims: [...b.prims.slice(0, torso.start), ...flesh],
      clusters: b.clusters.map(c => (c === torso ? fleshTorso : c)),
    };
    const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
    expect(daylightOf(fleshBody, limb(fleshBody, arm), fleshTorso, shoulder, 0.135))
      .toBeGreaterThan(0.015);
  });

  it.each(['armL', 'armR'] as const)('%s is nonetheless fused to the torso', arm => {
    const b = built();
    expect(fusedOf(b, limb(b, arm), limb(b, 'torso'))).toBeLessThan(0);
  });

  it.each([['armL', 'legL'], ['armR', 'legR']] as const)('%s does not pass through %s', (a, l) => {
    const b = built();
    expect(clearOf(b, limb(b, a), limb(b, l))).toBeGreaterThan(0.005);
  });

  // Ordinary-human scale, the schoolgirl's vertical budget: ankle just off
  // the floor, legs about half the standing height.
  it('stands at the cast\'s human scale', () => {
    const b = built();
    const ankle = b.bones.get('shin.l')!.tail;
    expect(ankle[1]).toBeGreaterThan(0.08);
    expect(ankle[1]).toBeLessThan(0.18);
    const crown = b.bones.get('skull')!.tail;
    expect(crown[1]).toBeGreaterThan(1.55);
    expect(crown[1]).toBeLessThan(1.75);
  });

  // The interior bones block: wound-reveal anatomy exists (skull + cage),
  // and the melt effect has something to bare.
  it('authors interior reveal bones (skull, ribs, sternum, spine)', () => {
    expect(doc.bonesBlock).not.toBeNull();
    const boneLines = doc.bonesBlock?.parts ?? [];
    const onSkull = boneLines.filter(l => l.bone === 'skull');
    const onChest = boneLines.filter(l => l.bone === 'chest');
    // Cranium only — the chin flesh is too thin to hide a jaw prim (see
    // the .blob); the jaw's reveal is the kit's chrome.
    expect(onSkull.length).toBeGreaterThanOrEqual(1);
    expect(onChest.length).toBeGreaterThanOrEqual(8); // 3 rib pairs + sternum + spine
  });
});
