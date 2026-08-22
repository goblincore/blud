// src/lab/sdf-zombie/characters/clown-blob.test.ts
//
// Pins the clown's flesh the way goblin-blob.test.ts pins the goblin: every
// threshold below is either an owner complaint about attempt one (head too
// small, nose not reading, cap swallowing the face) or a measured property
// that silently regresses when a torso ring moves. What these CANNOT check is
// whether the clown reads as a clown — that needs the turntable and an eye.
import { describe, it, expect } from 'vitest';
import src from './clown.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { checkStance, clearOf, daylightOf, fusedOf } from '../blob-checks';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

describe('clown.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, and
  // the lab always passes one — so a face-key typo is invisible unless
  // something calls compileFace explicitly. Same for the sheet and palette.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  // Attempt one's skin was liked and carried over: pale cream, rosy mottle.
  // Asserted loosely so art direction stays free to move — what must NOT
  // happen is falling back to a green/pink stock preset, which is what a
  // missing palette block silently does.
  it('wears its own pale cream flesh rather than the lab default', () => {
    const m = compilePalette(doc)!;
    expect(m).not.toBeNull();
    const [r, g, b] = m.baseColor;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(0.7);
    // Wounds stay red under the paint.
    expect(m.deepColor[0]).toBeGreaterThan(m.deepColor[2]);
    // This used to assert `mottleAmp > 0` on the reasoning that stage makeup
    // is "even, but not flat". Owner review said the opposite: the mottle read
    // as grime on a pale face ("the texture makes it look rough"), and the
    // face is now WHITE GREASEPAINT — flat, smooth and shiny.
    //
    // The invariant that assertion actually protected is still worth having:
    // that this character carries its OWN palette rather than silently falling
    // back to a stock preset. Assert that against the things the block now
    // sets deliberately AGAINST every preset — both noise terms at zero (no
    // preset ships 0 for surfaceNoiseAmp) and a tight, bright specular.
    expect(m.surfaceNoiseAmp).toBe(0);
    expect(m.silhouetteNoiseAmp).toBe(0);
    expect(m.specIntensity).toBeGreaterThan(0.7);
    expect(m.specRoughness).toBeLessThan(0.3);
  });

  it('folds its knees the way it declared', () => {
    const b = built();
    expect(checkStance(b.bones, doc.stance)).toEqual([]);
  });

  // THE HEAD IS THE CHARACTER. This is the number attempt one got wrong (38%
  // where the brief says roughly HALF), and it is exactly the kind of value a
  // well-meaning proportion pass quietly shrinks back toward "normal". The
  // cranium ball must stay nearly half the standing height.
  it('keeps the head at roughly half the standing height', () => {
    const b = built();
    // The cranium is the biggest primitive in the head cluster — facePrims'
    // skull sphere, radius = headRadius.
    const head = limb(b, 'head');
    const cranium = b.prims
      .slice(head.start, head.start + head.count)
      .reduce((best, p) => (p.radius > best.radius ? p : best));
    expect(doc.height).not.toBeNull();
    expect((2 * cranium.radius) / doc.height!).toBeGreaterThan(0.44);
  });

  // THE NOSE MUST READ. Attempt one's verdict was "no red nose reading"; the
  // colour lives on the kit now (flesh shares one material), but the
  // SILHOUETTE is this bead's job, and a bead that stops inside the cranium
  // reads as a bump no matter what colour the shell over it is. The reach
  // arithmetic lives in clown.blob's comment; here we re-derive both sides
  // from the compiled geometry so a retune of either the head or the bead
  // re-runs the race rather than trusting a stale constant.
  it('nose bead stands proud of the cranium, not buried in it', () => {
    const b = built();
    const head = limb(b, 'head');
    const prims = b.prims.slice(head.start, head.start + head.count);
    const cranium = prims.reduce((best, p) => (p.radius > best.radius ? p : best));
    // The bead: a round blob on the skull (no taper, unit scale, one point),
    // which on this head is uniquely the nose — every other authored skull
    // part is either a bar (neck), a groove (scaled flat), or a face prim.
    const nose = prims.find(
      p =>
        p.radius > 0.02 &&
        Math.abs(p.a[0] - p.b[0]) + Math.abs(p.a[1] - p.b[1]) + Math.abs(p.a[2] - p.b[2]) < 1e-9 &&
        p.scale.every(s => Math.abs(s - 1) < 1e-9) &&
        p.op !== 'groove',
    );
    expect(nose).toBeDefined();
    const [sx, sy, sz] = cranium.scale.map(s => s * cranium.radius) as [number, number, number];
    const dy = Math.abs(nose!.a[1] - cranium.a[1]);
    // Cranium surface z at the bead's own height — the ellipsoid shrinks as
    // you drop below its equator, which is exactly how a buried bead hides.
    const surfaceZ = cranium.a[2] + sz * Math.sqrt(Math.max(0, 1 - (dy / sy) ** 2));
    const noseFront = nose!.a[2] + nose!.radius * nose!.scale[2];
    // Measured at 37 mm proud; 25 mm is roughly where the ball stops reading
    // as "stuck on" at this scale (a third of the bead's diameter).
    expect(noseFront - surfaceZ).toBeGreaterThan(0.025);
  });

  // THE SMILE IS A GROOVE. Three segments draw one arc (corners up); this
  // checks the middle segment actually bites the assembled face rather than
  // floating embedded in flesh cutting nothing. Going inward along the smile
  // line, the field must lift back toward zero (the channel) BEFORE the skin
  // goes fully negative — on unwounded skin both crossings coincide.
  it('smile groove cuts a channel into the face', () => {
    const b = built();
    const crossing = (limit: number) => {
      for (let z = 0.24; z > 0.10; z -= 0.0005)
        if (sdBody([0, 0.655, z], b) < limit) return z;
      return NaN;
    };
    const bite = crossing(-0.0035);
    const skin = crossing(-0.010);
    expect(Number.isFinite(bite)).toBe(true);
    expect(bite - skin).toBeGreaterThan(0.005);
  });

  // THE ARMS MUST READ AS ARMS — the goblin's twice-bitten regression, on a
  // body whose belly is nearly as wide as its shoulders. daylightOf, not
  // clearOf: centrelines can sit a hair apart with both surfaces kissing.
  //
  // Split like the goblin's: the deltoid merge above is wanted (an arm that
  // springs free of the shoulder ball reads as glued on), so the bound only
  // applies below the elbow — 0.135 m from the shoulder IS the elbow plus
  // the forearm start. Measured 26.8 mm.
  it.each(['armL', 'armR'] as const)('%s hangs free below the elbow', arm => {
    const b = built();
    const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.135))
      .toBeGreaterThan(0.020);
  });

  it.each(['armL', 'armR'] as const)('%s is nonetheless fused to the torso', arm => {
    const b = built();
    expect(fusedOf(b, limb(b, arm), limb(b, 'torso'))).toBeLessThan(0);
  });

  // The mitts hang beside the thighs at rest; the reference holds them out
  // at the skirt wall. Measured 30.5 mm of centreline clearance.
  it.each([['armL', 'legL'], ['armR', 'legR']] as const)('%s does not pass through %s', (a, l) => {
    const b = built();
    expect(clearOf(b, limb(b, a), limb(b, l))).toBeGreaterThan(0.010);
  });
});

