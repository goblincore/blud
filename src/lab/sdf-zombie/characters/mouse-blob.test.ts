// src/lab/sdf-zombie/characters/mouse-blob.test.ts
//
// The mouse has no TypeScript twin to diff against the way zombie.blob has
// `makeZombie()`, so there is nothing to pin it to except its own measured
// properties — every threshold below is a number the owner rejected the
// geometry over, or a measurement taken straight off
// docs/dev-notes/refs/mouse-reference.png, not a round figure picked for
// looks. See goblin-blob.test.ts for the pattern's origin.
//
// What this file CANNOT check is whether the mouse reads as the reference
// mouse. That needs the turntable and an eye (see the authoring skill).
import { describe, it, expect } from 'vitest';
import src from './mouse.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf } from '../blob-checks';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

describe('mouse.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, and
  // the lab always passes one — so a face-key typo is invisible unless
  // something calls compileFace explicitly. Same for the sheet block.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  // TOY YELLOW, not the lab default. Asserted as relations rather than exact
  // channels so art direction stays free to move, but the hue must be yellow:
  // red and green high and FAR above blue.
  it('wears its own yellow flesh rather than the lab default', () => {
    const m = compilePalette(doc)!;
    expect(m).not.toBeNull();
    const [r, g, b] = m.baseColor;
    expect(r).toBeGreaterThan(0.8);
    expect(g).toBeGreaterThan(0.7);
    expect(b).toBeLessThan(0.05);
    // Wounds stay red — a yellow creature bleeding yellow reads as a plant.
    expect(m.deepColor[0]).toBeGreaterThan(m.deepColor[1]);
    // And the body is NOT blotched like the goblin: the reference skin is a
    // flat even tone, so the mottle stays near-off.
    expect(m.mottleAmp).toBeLessThan(0.15);
  });

  // SMOOTH CLAY — the owner's explicit correction, and the one a previous
  // run concluded was impossible ("palette can't touch surface noise"), which
  // shipped warty. compilePalette accepts any FleshMaterial key; both noise
  // amplitudes must stay exactly zero or the micro-detail comes back.
  it('renders smooth clay: no surface or silhouette noise', () => {
    const m = compilePalette(doc)!;
    expect(m.surfaceNoiseAmp).toBe(0);
    expect(m.silhouetteNoiseAmp).toBe(0);
  });

  it('folds its knees the way it declared', () => {
    const b = built();
    expect(checkStance(b.bones, doc.stance)).toEqual([]);
  });

  // =====================================================================
  // THE EARS — round discs, not columns. The first version of this character
  // was rejected over exactly this: two tall narrow columns standing off the
  // skull. The reference discs measure 0.254 wide x 0.254 tall (a CIRCLE),
  // centred at (+/-0.174, 0.960), reaching y 1.099 — the tallest thing on
  // the body. Every assertion below pins one of those facts against the
  // compiled prim, so a future retune cannot quietly regrow the columns.
  // =====================================================================
  const earPrims = () => {
    const b = built();
    const head = limb(b, 'head');
    return b.prims.slice(head.start, head.start + head.count)
      // The discs dwarf every other head prim AND are the only ones flattened
      // in z — the cranium is a 0.131-radius ellipsoid with scale z 0.95, so
      // radius alone would catch it too.
      .filter(p => p.radius > 0.10 && p.scale[2] < 0.5);
  };

  it('has exactly two ears, one per side', () => {
    const ears = earPrims();
    expect(ears.length).toBe(2);
    // Mirror pair: equal and opposite x.
    expect(ears[0]!.a[0]).toBeCloseTo(-ears[1]!.a[0], 3);
  });

  it('each ear is a ROUND plate — as wide as it is tall', () => {
    for (const p of earPrims()) {
      // wide==tall==1 by construction here; the assertion is on the EFFECT,
      // so it survives a future retune of the scales: the disc's horizontal
      // and vertical extents must agree within 25%, where the rejected
      // columns ran ~0.30 tall for 0.10 wide (ratio 3).
      const halfW = p.radius * p.scale[0];
      const halfH = p.radius * p.scale[1];
      expect(halfW / halfH).toBeGreaterThan(0.8);
      expect(halfW / halfH).toBeLessThan(1.25);
      // Flat in z: a plate, not a ball. The Mickey failure is the opposite.
      expect(p.scale[2]).toBeLessThan(0.5);
      // Big: the reference disc is 0.254 across on a 1.10 m body — a
      // quarter of the standing height EACH. Anything under 0.20 reads as a
      // teddy bear's ear sticker rather than the silhouette's whole top.
      expect(p.radius * 2).toBeGreaterThan(0.20);
    }
  });

  it('the ears, not the crown, own the standing height', () => {
    // Reference: disc tops at y 1.099 of a 1.10 m body; the crown pokes to
    // 0.972 BETWEEN them. If the crown ever crowns the discs the character
    // becomes a ball with ear stickers.
    const ears = earPrims();
    const earTop = ears[0]!.a[1] + ears[0]!.radius * ears[0]!.scale[1];
    expect(earTop).toBeGreaterThan(1.05);
    // And they sit high but not floating: the disc centres at 0.955, i.e.
    // within the top sixth of the body.
    expect(ears[0]!.a[1]).toBeGreaterThan(0.90);
  });

  it('the ear discs weld into the skull, not onto air', () => {
    // The disc's inner rim must sit INSIDE the cranium's half-width at the
    // disc's own height, or the plate hangs off the temple by its blend
    // alone. Measured: rim 0.042 against the crown's 0.059 there.
    const b = built();
    for (const p of earPrims()) {
      const inner = Math.abs(p.a[0]) - p.radius;
      expect(inner).toBeLessThan(0.06);
      // and fused: the head is one cluster, so this is really asserting the
      // disc centre is not so far out that smin cannot reach the skull —
      // 0.21 is the reference centre 0.174 plus retune margin.
      expect(Math.abs(p.a[0])).toBeLessThan(0.21);
    }
    expect(b.errors).toEqual([]);
  });

  // =====================================================================
  // THE SNOUT — the fix this character exists for. Two runs authored from
  // the flat front reference alone and built a flat face; the side profile
  // (mouse-reference-1.png) shows a muzzle AS LONG AS THE CRANIUM IS DEEP.
  // Thresholded off that image: head front-to-back = 250 px of a 755 px
  // body = 33% of standing height. These assertions march the compiled
  // field (camera-free), so a future retune cannot quietly shrink the
  // muzzle back into a bump — reach is the whole game (see the goblin
  // nose's two rejections).
  // =====================================================================
  const surfaceZ = (b: ReturnType<typeof built>, y: number, x = 0) => {
    let front = NaN, back = NaN;
    for (let z = -0.4; z <= 0.6; z += 0.001)
      if (sdBody([x, y, z], b) < 0) { if (Number.isNaN(back)) back = z; front = z; }
    return { front, back };
  };

  it('has a muzzle, not a bump: head depth is a third of standing height', () => {
    const b = built();
    // The deepest line is the snout tip's own latitude, y ~0.82 after the 2026-08-22
    // proportion rebuild (the whole head moved up with the raised neck).
    let depth = 0;
    for (let y = 0.70; y <= 0.92; y += 0.01) {
      const { front, back } = surfaceZ(b, y);
      depth = Math.max(depth, front - back);
    }
    // Reference: 0.364 m on a 1.10 m body. The rejected flat-face passes
    // measured ~0.25 (cranium + pout). 0.33 keeps the muzzle a major mass
    // without pinning the exact centimetre. Measured 0.374 (34%).
    expect(depth).toBeGreaterThan(0.33);
    expect(depth / doc.height!).toBeGreaterThan(0.30);
  });

  it('the snout tip clears the cranium front by a real margin', () => {
    const b = built();
    // Cranium front at its upper equator (y 0.895, above the muzzle) vs the
    // front at the tip latitude. The reference muzzle projects roughly the
    // cranium's own depth; the goblin ships 44 mm proud and the flat-face
    // passes that fell short both read as bumps. 80 mm is the floor, not the
    // target. Measured tip z 0.253 vs cranium front ~0.12.
    const equator = surfaceZ(b, 0.895).front;
    let tip = 0;
    for (let y = 0.75; y <= 0.88; y += 0.005)
      tip = Math.max(tip, surfaceZ(b, y).front);
    expect(tip - equator).toBeGreaterThan(0.080);
    // And the tip sits BELOW the eye line: the profile's muzzle leaves the
    // face at cheek/under-eye level and holds near-horizontal, ~49 mm under
    // the eyes. With the head raised (2026-08-22), the eye line sits ~0.864
    // (snout tip 0.815 + 49 mm); a tip at forehead height is a trunk.
    // 0.15, not the 0.2 this used to demand: the reference MESH's own tip
    // is at z 0.186 (marched off maus-biped, scaled to 1.10), so 0.2 could
    // only ever be passed by a snout LONGER than the reference — which is
    // exactly what every earlier version of this character was.
    let tipY = 0;
    for (let y = 0.72; y <= 0.90; y += 0.005)
      if (surfaceZ(b, y).front > tip - 0.002 && surfaceZ(b, y).front > 0.15) tipY = y;
    expect(tipY).toBeLessThan(0.868);
    expect(tipY).toBeGreaterThan(0.74);
  });

  // THE ARMS MUST READ AS ARMS — the goblin's twice-bitten regression, and
  // live here too because the mouse's torso is smaller than the goblin's and
  // the arms are stubbier, so the daylight budget is tighter per limb.
  it.each(['armL', 'armR'] as const)('%s hangs free below the elbow', arm => {
    const b = built();
    const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
    // The upper arm is 0.095 long; below it there is no anatomical excuse
    // for touching the body. 2% of standing height (~22 mm) is roughly where
    // separation became visible from every yaw on the goblin.
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.095))
      .toBeGreaterThan(0.020);
  });

  // ...but still attached: pushing the shoulder out far enough to clear
  // detaches the arm outright and validateBody reports the cluster dangling.
  it.each(['armL', 'armR'] as const)('%s is nonetheless fused to the torso', arm => {
    const b = built();
    expect(fusedOf(b, limb(b, arm), limb(b, 'torso'))).toBeLessThan(0);
  });

  // The hands are HELD OUT at ~47 degrees with spread fingers (the pose is
  // load-bearing — see the skeleton comment), and must clear the thighs for
  // the walk cycle to come.
  it.each([['armL', 'legL'], ['armR', 'legR']] as const)('%s does not pass through %s', (a, l) => {
    const b = built();
    expect(clearOf(b, limb(b, a), limb(b, l))).toBeGreaterThan(0.010);
  });

  // THE LOLLIPOP: the head is a third of the standing height and the neck is
  // a stick under it. The first pass crowned at 0.878 and read as a ball in
  // a helmet; the reference crown is 0.972.
  it('crowns between the ears near the top of the file', () => {
    const b = built();
    // The cranium is the biggest sphere in the head cluster.
    const head = limb(b, 'head');
    const cranium = b.prims.slice(head.start, head.start + head.count)
      .reduce((best, p) => (p.radius > best.radius ? p : best));
    const crown = cranium.a[1] + cranium.radius * cranium.scale[1];
    expect(crown).toBeGreaterThan(0.94);
    expect(crown).toBeLessThan(1.0); // the discs still own the height
    // Head width: the reference measures 0.262 across at y 0.85.
    expect(cranium.radius * cranium.scale[0] * 2).toBeGreaterThan(0.24);
  });

  // Legs are HALF the goblin's proportion — the reference hip line sits at
  // 0.28 of height. A torso that creeps down over the legs undoes the
  // lollipop read the same way the goblin's egg did.
  it('keeps stubby legs under a small torso', () => {
    const b = built();
    expect(doc.height).not.toBeNull();
    const hip = b.bones.get('thigh.l')!.head[1];
    expect(hip / doc.height!).toBeLessThan(0.33);
    expect(hip / doc.height!).toBeGreaterThan(0.24);
  });
});

describe('the shoes, as painted SDF', () => {
  // They replaced the kit lofts on 2026-08-22. The mesh has no visible foot:
  // the leg enters a soft grey shoe at the ankle, and the shoes are the
  // character's ground contact.
  it('are two mirrored painted groups in the leg clusters, touching the ground', () => {
    const b = built();
    // Shoe grey, as opposed to the shorts' blue on the thighs and knees.
    const grey = (p: typeof b.prims[number]) => !!p.color && p.color[0] > 0.3 && Math.abs(p.color[0] - p.color[2]) < 0.05;
    const shoes = b.prims.filter(p => grey(p) && (p.limb === 'legL' || p.limb === 'legR'));
    expect(shoes.length).toBe(8);                       // four prims a side:
    // cone + ball + ankle collar + the WALL (2026-08-22) — a flattened
    // tapered capsule bridging collar to ball, because the mesh shoe's
    // side swells gradually from ankle to ball and no single sphere can
    // produce that onset (band 0.88 swung +0.045/-0.039 with tall alone).
    expect(shoes.filter(p => p.limb === 'legL').length).toBe(4);
    // Left and right are reflections of each other in x.
    const l = shoes.filter(p => p.limb === 'legL').map(p => p.a[0]).sort();
    const r = shoes.filter(p => p.limb === 'legR').map(p => -p.a[0]).sort();
    l.forEach((x, i) => expect(x).toBeCloseTo(r[i]!, 6));
    // Both shoes are OUTBOARD of the body's centreline, not on it — the
    // failure expandMirror's x-flip was added for.
    for (const p of shoes) expect(Math.abs(p.a[0])).toBeGreaterThan(0.03);
    // Lowest shoe flesh is on the floor: march down from the ball.
    let lowest = 1;
    for (let x = 0.02; x <= 0.25; x += 0.005)
      for (let z = -0.1; z <= 0.25; z += 0.005)
        for (let y = 0; y < 0.03; y += 0.002)
          if (sdBody([x, y, z], b) < 0) lowest = Math.min(lowest, y);
    expect(lowest).toBeLessThan(0.005);
  });
});
