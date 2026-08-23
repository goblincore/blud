// src/lab/sdf-zombie/characters/schoolgirl-blob.test.ts
//
// The schoolgirl has no TypeScript twin, so like the mouse this pins its own
// MEASURED properties — every threshold below is a number taken off
// docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb (the T-pose bind,
// 1.70 m tall) via blob:measure / head-profile, not a round figure picked
// for looks. What this file CANNOT check is whether she reads as the
// reference; that needs the turntable and an eye (see the authoring skill).
import { describe, it, expect } from 'vitest';
import src from './schoolgirl.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet, compileSheetImage } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf } from '../blob-checks';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

describe('schoolgirl.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('folds the way it declared', () => {
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  // SKIN, not the lab default pink: baseColor is dab18a (sRGB 218,177,138)
  // -> linear (0.699, 0.439, 0.254) — warm, red over green over blue, and
  // wounds stay red.
  it('wears skin-toned flesh rather than the lab default', () => {
    const m = compilePalette(doc)!;
    const [r, g, b] = m.baseColor;
    expect(r).toBeGreaterThan(0.6);
    expect(r).toBeGreaterThan(g + 0.2);
    expect(g).toBeGreaterThan(b);
    expect(m.deepColor[0]).toBeGreaterThan(m.deepColor[1]);
  });

  // TOY-CLEAN (Tanida): no surface or silhouette noise, no mottle to speak
  // of — the brief's "no mottle, no surface noise", pinned so a future
  // retune cannot quietly ship grit.
  it('renders smooth: no surface or silhouette noise, near-off mottle', () => {
    const m = compilePalette(doc)!;
    expect(m.surfaceNoiseAmp).toBe(0);
    expect(m.silhouetteNoiseAmp).toBe(0);
    expect(m.mottleAmp).toBeLessThan(0.05);
  });

  // =====================================================================
  // THE OUTFIT IS PAINT. Every garment is color= on a prim boundary, as in
  // the mesh's own texture: navy 01046d skirt + collar + scarf, white
  // ececed top, sock d9d8d9, hair/shoes 201109, sole bdb9bc, accent 66537c.
  // The colour checks are RELATIONS (dark blue, bright white, near-black)
  // so art direction stays free to move.
  // =====================================================================
  const painted = (limbId: string) => {
    const b = built();
    const cl = limb(b, limbId);
    return b.prims.slice(cl.start, cl.start + cl.count).filter(p => p.color);
  };

  it('skirts the torso in navy paint', () => {
    const navy = painted('torso').filter(p => p.color![2] > p.color![0] * 2 && p.color![2] < 0.3);
    // v2 (2026-08-23): the smooth rebuild carries navy on exactly THREE
    // prims — the one-cone skirt, the one-plate sailor collar, the scarf.
    // v1 needed 7+ (cone, two hem rings, four pleat bars); the pleats are
    // grooves now, and grooves carry no paint.
    expect(navy.length).toBe(3);
  });

  it('socks are white paint and fatter than the knee — the slouch', () => {
    const socks = painted('legL').filter(p => {
      const [r, g, bl] = p.color!;
      return r > 0.6 && g > 0.6 && bl > 0.6;
    });
    expect(socks.length).toBeGreaterThanOrEqual(2); // sock bar + ankle cuff
    // The mesh's sock cuff (0.292 total, the leg's widest ring below the
    // knee) versus its knee band 0.245: the slouch sock BULGES past the
    // knee. Pin that relation on the compiled radii.
    const b = built();
    const sockBar = b.prims.find(p => p.limb === 'legL' && p.radiusB !== undefined && p.radius! > 0.07)!;
    const kneeBall = b.prims.find(p => p.limb === 'legL' && p.radius! > 0.04 && p.radius! < 0.06)!;
    expect(sockBar.radius!).toBeGreaterThan(kneeBall.radius! + 0.015);
  });

  it('shoes are near-black paint with grey soles on the floor', () => {
    const shoes = painted('legL').filter(p => {
      const [r, g, bl] = p.color!;
      return r < 0.1 && g < 0.08;
    });
    expect(shoes.length).toBeGreaterThanOrEqual(2); // upper + sole plate
    // The sole plate is the pair's ground contact: march down for flesh.
    const b = built();
    let lowest = 1;
    for (let x = 0.02; x <= 0.25; x += 0.005)
      for (let z = -0.12; z <= 0.14; z += 0.005)
        for (let y = 0.012; y >= 0; y -= 0.002)
          if (sdBody([x, y, z], b) < 0) lowest = Math.min(lowest, y);
    expect(lowest).toBeLessThan(0.014); // sole sits at the floor, not floating
  });

  it('wears the baked mesh face as a decal, with no painted eye/mouth prims', () => {
    // The purple eye and mouth prims of v1/v2 read as a navy visor band, and
    // a painted prim sits on TOP of the sheet, so they would cover the decal.
    const head = painted('head');
    const accent = head.filter(p => {
      const [r, g, b] = p.color!;
      return b > r && r > g && b < 0.35;
    });
    expect(accent.length).toBe(0);
    const sheet = compileSheet(parseBlob(src))!;
    expect(sheet.decal).toBe(1);
    expect(compileSheetImage(parseBlob(src))).toBe('schoolgirl-face.png');
  });

  // =====================================================================
  // MEASURED SILHOUETTE PINS — marched off the compiled field, camera-free.
  // =====================================================================

  // The measure aligns both subjects by their own bounding boxes, so the
  // standing height must be EXACTLY the mesh's 1.70: crown = the fringe
  // peak, feet = the sole plates.
  it('stands exactly 1.70 m — crown to sole', () => {
    const b = built();
    let top = 0, bottom = 2;
    for (let y = 1.4; y <= 1.8; y += 0.002)
      if (sdBody([0, y, 0.02], b) < 0) top = Math.max(top, y);
    for (let x = 0.02; x <= 0.25; x += 0.005)
      for (let z = -0.12; z <= 0.14; z += 0.005)
        if (sdBody([x, 0.002, z], b) < 0) bottom = 0.002;
    expect(top).toBeGreaterThan(1.695);
    expect(top).toBeLessThan(1.705);
    expect(bottom).toBeLessThan(0.005);
  });

  // THE SMOOTH SKIRT (v2, 2026-08-23 — replaces the hem-cliff pin). v1
  // matched the mesh's hem cliff (0.406 -> 0.308 across 2 cm) with two flat
  // ellipsoid RINGS plus six pleat-fragment bars: every band width right,
  // and the owner read it as "a cylinder with a flat disc at the hem". v2
  // is ONE flared cone whose squashed end cap rounds under smoothly — the
  // cliff is a hard-edge read no smooth mass can do, traded away on
  // purpose. What this pin guards instead: the flare reaches the hem
  // latitude, the width falls MONOTONICALLY below it (no second ring, no
  // disc, no flat run), and the torso carries its whole mass in at most 8
  // additive prims (v1 needed 20 for the same silhouette).
  it('has a single flared skirt: widest at 0.79, rounding smoothly under', () => {
    const b = built();
    const width = (y: number) => {
      let lo = NaN, hi = NaN;
      for (let x = -0.4; x <= 0.4; x += 0.002)
        if (sdBody([x, y, 0], b) < 0) { if (Number.isNaN(lo)) lo = x; hi = x; }
      return hi - lo;
    };
    expect(width(0.79)).toBeGreaterThan(0.36);       // the flare (mesh 0.406)
    expect(width(0.75)).toBeLessThan(width(0.79));   // falling…
    expect(width(0.72)).toBeLessThan(width(0.75));   // …monotonically…
    expect(width(0.70)).toBeLessThan(width(0.72));   // …to the bare legs
    // The smooth-construction budget: 8 additive torso prims, 12 with the
    // four pleat grooves. If this grows, someone is re-stacking discs.
    const t = limb(b, 'torso');
    const prims = b.prims.slice(t.start, t.start + t.count);
    expect(prims.filter(p => p.op === 'add').length).toBeLessThanOrEqual(8);
    expect(prims.length).toBeLessThanOrEqual(12);
  });

  // KNEES TOGETHER (the mesh's stance — 0.245 at the knee, inner edges
  // touching) with calves and socks spreading below. A future edit that
  // splays the legs breaks the stance read this pin guards.
  it("stands knees-together: the knee band is the leg's narrowest split", () => {
    const b = built();
    const extent = (y: number) => {
      let lo = NaN, hi = NaN, segs = 0, prev = false;
      for (let x = -0.4; x <= 0.4; x += 0.002) {
        const s = sdBody([x, y, 0], b) < 0;
        if (s) { if (Number.isNaN(lo)) lo = x; hi = x; if (!prev) segs++; }
        prev = s;
      }
      return { w: hi - lo, segs };
    };
    const knee = extent(0.473);
    expect(knee.segs).toBe(2);              // two legs, a gap between
    expect(knee.w).toBeLessThan(0.26);      // mesh 0.245
    const sock = extent(0.28);
    expect(sock.w).toBeGreaterThan(knee.w + 0.02); // the slouch spreads past the knee
  });

  // CHIN at the mesh's 1.4535 (0.855 of height): the head is 6.9 bodies
  // tall — mildly stylised, NOT chibi. A chin that drifts up makes her a
  // lollipop; down, a jaw.
  it('carries its chin at 1.45 m, not chibi', () => {
    const b = built();
    // lowest flesh on the face's front-bottom quadrant = the chin's tip
    let chin = 2;
    for (let y = 1.40; y <= 1.52; y += 0.002)
      if (sdBody([0.015, y, 0.085], b) < 0) chin = Math.min(chin, y);
    expect(chin).toBeGreaterThan(1.44);
    expect(chin).toBeLessThan(1.47);
  });

  // The resting hands ride slightly FORWARD of the arm line so they clear
  // the thighs (the pose note in the skeleton) — checked as non-penetration.
  it.each([['armL', 'legL'], ['armR', 'legR']] as const)('%s does not pass through %s', (a, l) => {
    const b = built();
    expect(clearOf(b, limb(b, a), limb(b, l))).toBeGreaterThan(0.005);
  });
});
