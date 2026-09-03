// draft-emit.test.ts — Task 9: the measurements become .blob TEXT, in budget.
//
// The six behaviours the plan pins, each against a SYNTHETIC fit: the fits
// themselves are already pinned in draft-fit.test.ts and draft-paint.test.ts,
// and what is under test here is the EMITTING — grammar, budget, sourced
// numbers — not the measuring. Hand-built MedialLine/Band literals keep the
// fixtures honest about that split.
//
// The one place the fixture must be geometrically REAL is the parse/compile/
// build test: the emitted numbers have to make a connected, validating body,
// so the biped below carries a chunky figure's actual proportions and the
// band tiling covers every bone end to end (the joints are where the
// connectivity probe walks).

import { describe, it, expect } from 'vitest';
import type { Vec3 } from './types';
import type { MedialLine, Band } from './draft-fit';
import type { BandPaint } from './draft-paint';
import type { RefSkin, RefVertex } from './ref-skin';
import { detectRig } from './ref-align';
import { assembleDraft } from './draft-skeleton';
import {
  emitDraft, DRAFT_BUDGET_TOTAL, DRAFT_BUDGET_CLUSTER,
  type DraftInput, type DraftBone, type DraftSideFit,
} from './draft-emit';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { DEFAULT_FACE, facePrims } from './face';
import { MAX_PRIMS } from './validate';
import { cross, dot, len, normalize, scale as vscale, sub } from './vec';

const NAME = 'draftling';

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
// dirVector('down', 0, 12): an arm hanging down-and-out. Chosen as the
// grammar's OWN composition so inferDir's inversion round-trips it exactly.
const ARM_DIR: Vec3 = [0.2079, -0.9781, 0];

/** A straight medial line: origin at the cloud centroid, extent t0..t1. */
function line(origin: Vec3, dir: Vec3, t0: number, t1: number, residual = 0.008): MedialLine {
  return { dir, origin, t0, t1, residual };
}

/** A hand-built band. `rotated` is small but nonzero — a real fit never
 *  lands exactly on 0, and the emitter must not treat the noise as a flag. */
function band(t0: number, t1: number, r: number, samples = 900): Band {
  return { t0, t1, r, wide: 1, deep: 1, rotated: 0.02, samples };
}

/** Paint that says "one colour, nothing to split" — the unpainted-band case
 *  the emitter must carry without emitting a color= arg. */
function fit(l: MedialLine, bands: Band[]): DraftSideFit {
  const paint: BandPaint[] = bands.map(() => ({ split: 0, bimodal: false, samples: 0 }));
  return { line: l, bands, paint };
}

// The skeleton's line fixtures, shared with makeFatFit so the fat variant
// overrides only the band lists.
const L_PELVIS = line([0, 1.06, 0], UP, -0.08, 0.08);
const L_SPINE = line([0, 1.39, 0], UP, -0.25, 0.25);
const L_SKULL = line([0, 1.75, 0], UP, -0.11, 0.11);
const L_ARM = line([0.22, 1.49, 0], ARM_DIR, -0.15, 0.15);
const L_HAND = line([0.2524, 1.2666, 0], DOWN, -0.08, 0.08);
const L_THIGH = line([0.1, 0.77, 0], DOWN, -0.21, 0.21);
const L_SHIN = line([0.1, 0.35, 0], DOWN, -0.21, 0.21);

/** An even sphere of points — the unmapped Head cloud the face block is
 *  sized from. Fibonacci distribution: even coverage, no rng. */
function headBall(centre: Vec3, r: number, n = 300): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    out.push([centre[0] + r * rad * Math.cos(th), centre[1] + r * y, centre[2] + r * rad * Math.sin(th)]);
  }
  return out;
}

/** A small chunky biped: pelvis→spine→skull chain plus mirrored arm and leg
 *  pairs, every bone banded end to end. Built and validated as-is by the
 *  parse/compile test, so its numbers are load-bearing. */
function makeFit(): DraftInput {
  return {
    name: NAME,
    height: 1.9,
    stance: { stance: 'humanoid', forwardOffset: 0.06 },
    paint: { mean: [120, 100, 80], spread: 42, samples: 5000 },
    headCloud: headBall([0, 1.78, 0.005], 0.11),
    bones: [
      {
        name: 'pelvis', parent: null, limb: 'torso', at: 0.98, line: L_PELVIS,
        shared: fit(L_PELVIS, [band(-0.08, 0.08, 0.15, 4000)]),
      },
      {
        name: 'spine', parent: 'pelvis', limb: 'torso', line: L_SPINE,
        shared: fit(L_SPINE, [band(-0.25, -0.02, 0.13, 3200), band(-0.02, 0.25, 0.17, 3600)]),
      },
      {
        name: 'skull', parent: 'spine', limb: 'head', line: L_SKULL,
        shared: fit(L_SKULL, [band(-0.11, 0.11, 0.10, 2600)]),
      },
      {
        name: 'upperarm', parent: 'spine', limb: 'arm', pairSide: 0.19, line: L_ARM,
        shared: fit(L_ARM, [band(-0.15, 0, 0.115, 2400), band(0, 0.15, 0.05, 1500)]),
      },
      {
        name: 'hand', parent: 'upperarm', limb: 'arm', pairSide: 0, line: L_HAND,
        shared: fit(L_HAND, [band(-0.08, 0.08, 0.05, 1100)]),
      },
      {
        name: 'thigh', parent: 'pelvis', limb: 'leg', pairSide: 0.10, line: L_THIGH,
        shared: fit(L_THIGH, [band(-0.21, 0.02, 0.10, 2800), band(0.02, 0.21, 0.07, 1600)]),
      },
      {
        name: 'shin', parent: 'thigh', limb: 'leg', pairSide: 0, line: L_SHIN,
        shared: fit(L_SHIN, [band(-0.21, 0.21, 0.055, 1900)]),
      },
    ],
  };
}

/** `n` equal-sample bands tiling [t0,t1] at radius r — a fit far over
 *  budget, to prove the emitter trims rather than emits past the shader. */
function manyBands(n: number, t0: number, t1: number, r: number, samples = 300): Band[] {
  const out: Band[] = [];
  for (let i = 0; i < n; i++)
    out.push(band(t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 1)) / n, r, samples));
  return out;
}

/** The biped with absurdly banded bones: far over the total budget AND over
 *  the per-cluster ceiling on the legs. Spine bands carry FEWER samples than
 *  the limb bands, so the trim order (least evidence first) keeps the limbs —
 *  which is also what stops the fixture drafting down to a torso alone. */
function makeFatFit(): DraftInput {
  const f = makeFit();
  const bone = (name: string): DraftBone => f.bones.find((b) => b.name === name)!;
  bone('spine').shared = fit(L_SPINE, manyBands(60, -0.25, 0.25, 0.15));
  bone('upperarm').shared = fit(L_ARM, manyBands(30, -0.15, 0.15, 0.115));
  bone('hand').shared = fit(L_HAND, manyBands(20, -0.08, 0.08, 0.05));
  bone('thigh').shared = fit(L_THIGH, manyBands(30, -0.21, 0.21, 0.10));
  bone('shin').shared = fit(L_SHIN, manyBands(30, -0.21, 0.21, 0.055));
  return f;
}

function build(text: string) {
  return buildBody(compileBlob(parseBlob(text)));
}

describe('emitDraft', () => {
  it('emits text that PARSES and COMPILES', () => {
    // The only test that matters: the draft is worthless if the author's
    // first `npx vitest run` on it shows a parse error. The whole gate, end
    // to end, on the emitted TEXT — nothing is mocked.
    const built = build(emitDraft(makeFit()));
    expect(built.errors).toEqual([]);
  });

  it('puts a # fit: comment on every emitted number', () => {
    // The house rule, enforced by construction: a line carrying a numeric arg
    // states where the number came from. (The fixture name carries no digits;
    // a digit-bearing name would need this scan taught about it.)
    const text = emitDraft(makeFit());
    const bare: string[] = [];
    for (const raw of text.split('\n')) {
      const l = raw.trim();
      if (l === '' || l.startsWith('#')) continue;
      if (!/\d/.test(l)) continue;
      if (!l.includes('# fit:')) bare.push(l);
    }
    expect(bare).toEqual([]);
  });

  it('stays inside the primitive budget', () => {
    // MAX_CLUSTER_PRIMS is 64 and SILENT — the shader stops folding past it
    // and the surface loses geometry with no error anywhere. So the draft
    // must budget: this fit is far over BOTH ceilings and the emitted body
    // must come back inside 80 total / 40 per cluster, still clean, and not
    // lazily emptied (a draft that trims to nothing "passes" those three).
    const text = emitDraft(makeFatFit());
    const built = build(text);
    expect(built.errors).toEqual([]);
    expect(built.prims.length).toBeLessThanOrEqual(DRAFT_BUDGET_TOTAL);
    expect(built.prims.length).toBeGreaterThanOrEqual(50);
    for (const c of built.clusters) expect(c.count).toBeLessThanOrEqual(DRAFT_BUDGET_CLUSTER);
    // The budget arithmetic's real subject is FLESH PLUS DERIVED BONES
    // against the shader's hard 128. This fixture sits exactly on that line —
    // its equal-radius bands make every band derive, so the derived-bone
    // constraint binds before the 80-total line — which is what gives this
    // pin teeth on the estimate's composition: it caught the face block's
    // own derivable prims (they ride `skull` as mass) being left out, which
    // let a real character emit at 130 while the header claimed inside-budget.
    const boneN = built.bonePrims?.length ?? 0;
    expect(built.prims.length + boneN).toBeLessThanOrEqual(MAX_PRIMS);
    // The trim is reported, not silent — the header says what was dropped.
    expect(text).toMatch(/trim/i);
  });

  it('emits a side= pair unmirrored when asymmetry is high', () => {
    // The minotaur prosthetic case: mirroring the .l cloud over the .r one
    // would lie. The pair's prims go out per side, each carrying its OWN
    // radii, with no `mirror` word — and the body still builds.
    const f = makeFit();
    const thigh = f.bones.find((b) => b.name === 'thigh')!;
    thigh.l = fit(L_THIGH, [band(-0.21, 0.02, 0.10, 2800), band(0.02, 0.21, 0.07, 1600)]);
    thigh.r = fit(L_THIGH, [band(-0.21, 0.05, 0.15, 6000), band(0.05, 0.21, 0.13, 5200)]);
    thigh.asym = { score: 0.63, countSkew: 0.63, radSkew: 0.25, mirrorable: false };
    delete thigh.shared;

    const text = emitDraft(f);
    const thighPrims = text.split('\n').filter((l) => l.includes(' on thigh '));
    expect(thighPrims.length).toBe(4); // two bands per side
    expect(thighPrims.some((l) => l.includes('side=l') && l.includes('r=0.1 '))).toBe(true);
    expect(thighPrims.some((l) => l.includes('side=r') && l.includes('r=0.15 '))).toBe(true);
    for (const l of thighPrims) expect(l).not.toMatch(/\bmirror\b/);
    // The verdict is cited, so the author knows WHY the pair is split.
    expect(text).toContain('0.63');
    expect(build(text).errors).toEqual([]);
  });

  it('emits no pitch/tilt on a side-based bone', () => {
    // dirVector's pitch is a no-op on side/fwd bases, so angles there are not
    // just wrong but MEANINGLESS — the honest emission is the bare base plus
    // the measured error in the comment.
    const f = makeFit();
    const footLine = line([0.1, 0.14, 0], [0, 0, 1], -0.09, 0.09);
    f.bones.push({
      name: 'foot', parent: 'shin', limb: 'leg', pairSide: 0, line: footLine,
      shared: fit(footLine, [band(-0.09, 0.09, 0.05, 800)]),
    });
    const text = emitDraft(f);
    const foot = text.split('\n').find((l) => l.trim().startsWith('bone foot'));
    expect(foot).toBeDefined();
    expect(foot!).toContain('dir=fwd');
    expect(foot!).not.toContain('pitch=');
    expect(foot!).not.toContain('tilt=');
    // The refusal is not silent: the line carries the angle the bare base
    // misses by, so the author can judge the debt.
    expect(foot!).toMatch(/errs? \d/);
  });

  it('pre-wires the face decal and the bake reminder', () => {
    // The draft never paints a face (three dispatches proved agents cannot);
    // it wires the sheet so the author's only step is running the bake.
    const text = emitDraft(makeFit());
    expect(text).toMatch(/^sheet$/m);
    expect(text).toMatch(new RegExp(`^  image ${NAME}-face\\.png`, 'm'));
    expect(text).toMatch(/^  decal 1 /m);
    expect(text).toContain(`# run: npm run blob:face-bake -- ${NAME}`);
  });

  // The face block is the one surface statement whose PLACEMENT never
  // consulted its own cloud: it rode the skull bone's fixed at=0.45 point
  // (the rig chain's frame) while its size params were measured about the
  // head cloud's centre. Measured on the first real character through here
  // (the minotaur, 2026-09-03): the block's centre sat 84 mm behind the
  // cloud's centre and its back pole protruded 78 mm outside the cloud's
  // own back surface — the block was not even on the head it belongs to.
  // These pins hold it to the principle the bands already follow
  // (chain-drift: the rig supplies the frame, the cloud supplies the surface).
  describe('the face block sits in its head cloud’s frame', () => {
    /** The fixture's skull bone spans y 1.64..1.86, so at=0.45 puts the
     *  block at [0, 1.759, 0]; a head carried forward of that (every animal
     *  muzzle, the minotaur's whole head) lands nowhere near its cloud. */
    const HEAD_CENTRE: Vec3 = [0, 1.78, 0.09];

    /** The built body's cranium prim — the fattest of the face prims
     *  compileBlob appends (they carry no .blob source line). */
    function craniumOf(b: ReturnType<typeof build>) {
      const face = b.prims.filter((p) => p.src === undefined);
      expect(face.length).toBeGreaterThan(0);
      return face.reduce((a, p) => (p.radius > a.radius ? p : a), face[0]!);
    }

    it('places the block at its head cloud, not at the bone', () => {
      const f = makeFit();
      f.headCloud = headBall(HEAD_CENTRE, 0.11);
      const built = build(emitDraft(f));
      const c = craniumOf(built);
      // The build GROUNDS the body (a rigid root shift), so the assertion
      // is relative to the same body's skull bone — both sides of the
      // comparison move together, and what must hold is the block's offset
      // FROM its bone, equal to the cloud's offset from the fit's bone.
      const skull = built.bones.get('skull');
      expect(skull).toBeDefined();
      const bone045: Vec3 = [
        skull!.head[0]! + 0.45 * (skull!.tail[0]! - skull!.head[0]!),
        skull!.head[1]! + 0.45 * (skull!.tail[1]! - skull!.head[1]!),
        skull!.head[2]! + 0.45 * (skull!.tail[2]! - skull!.head[2]!),
      ];
      const centre: Vec3 = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];
      // The fixture's bone@0.45 is [0, 1.739, 0] (origin 1.75, t0 -0.11,
      // t1 0.11), so the cloud rides [0, +0.041, +0.09] off it — the
      // rise/lead the block must carry.
      expect(centre[0] - bone045[0]).toBeCloseTo(0, 3);
      expect(centre[1] - bone045[1]).toBeCloseTo(0.041, 3);
      expect(centre[2] - bone045[2]).toBeCloseTo(0.09, 3);
    });

    it('the block spans its head cloud even when the cloud is SKEWED', () => {
      // A muzzle: the +z half of the sphere stretched 2.5x. A symmetric
      // block cannot fill an asymmetric span from the centroid frame — the
      // p98 basis reads the stack on the fat side and the block overshoots
      // there (the minotaur's depth param was beard-driven: p98 half-extent
      // 0.1385 against a front extent of 0.081). The span frame — centre at
      // the per-axis midspan, half-extent at the per-axis half-span — fits.
      const cloud = headBall(HEAD_CENTRE, 0.11).map(
        (p): Vec3 => p[2]! > HEAD_CENTRE[2]!
          ? [p[0], p[1], HEAD_CENTRE[2]! + (p[2]! - HEAD_CENTRE[2]!) * 2.5]
          : p,
      );
      const f = makeFit();
      f.headCloud = cloud;
      const zs = cloud.map((p) => p[2]).sort((a, b) => a - b);
      const zLo = zs[0]!, zHi = zs[zs.length - 1]!;
      const c = craniumOf(build(emitDraft(f)));
      const halfDepth = Math.max(c.radius, c.radiusB ?? c.radius) * c.scale[2];
      expect((c.a[2] + c.b[2]) / 2 - halfDepth).toBeGreaterThanOrEqual(zLo - 2e-3);
      expect((c.a[2] + c.b[2]) / 2 + halfDepth).toBeLessThanOrEqual(zHi + 2e-3);
      // ...and centred on the span, not on the vertex-weighted centroid
      // (which the skew drags toward the muzzle).
      expect((c.a[2] + c.b[2]) / 2).toBeCloseTo((zLo + zHi) / 2, 3);
    });

    it('headRise/headLead default to zero and move the whole block', () => {
      // The grammar's defaults must leave every hand-authored file bit-
      // identical (the schoolgirl's skull bone was hand-positioned on the
      // assumption of no face offset), and when set, ALL FOUR face prims
      // ride the shift — jaw, brow and nose are positioned relative to the
      // head centre, so they must follow it.
      const base = facePrims(DEFAULT_FACE);
      const zero = facePrims({ ...DEFAULT_FACE, headRise: 0, headLead: 0 });
      expect(zero).toEqual(base);
      const moved = facePrims({ ...DEFAULT_FACE, headRise: 0.02, headLead: 0.05 });
      expect(moved.length).toBe(base.length);
      for (let i = 0; i < moved.length; i++) {
        // PrimDefs carry placement as bone+at+offset (a/b come later, from
        // buildBody), so the shift IS the offset delta — the bone point is
        // identical between the two calls.
        const bo = base[i]!.offset ?? [0, 0, 0];
        const mo = moved[i]!.offset ?? [0, 0, 0];
        expect(mo[0]! - bo[0]!).toBeCloseTo(0, 6);
        expect(mo[1]! - bo[1]!).toBeCloseTo(0.02, 6);
        expect(mo[2]! - bo[2]!).toBeCloseTo(0.05, 6);
      }
    });
  });
});

// The chain-drift emitter surface: the cloud keeps the bands and answers for
// where the SURFACE sits (offset=), while len=/dir= move to the rig; a cloud
// axis that disagrees with the rig chain is REPORTED, never substituted
// (the old >45° steering). Spec:
// docs/superpowers/specs/2026-09-02-blob-draft-chain-drift-design.md.
describe('emitDraft offsets', () => {
  it('emits offset= on a prim whose fit carries one', () => {
    // The 9-13 cm joint-vs-skin trap's fix: the prim moves to the surface,
    // the bone stays on the rig chain. The offset is a world-axis vector
    // (placePrims adds it after lerping along the bone), so it must round-trip
    // through the grammar — asserted by BUILDING the body, not just grepping.
    const f = makeFit();
    const spine = f.bones.find((b) => b.name === 'spine')!;
    spine.shared!.offset = [0.03, 0, -0.02];
    const text = emitDraft(f);
    const spinePrims = text.split('\n').filter((l) => l.includes(' on spine '));
    expect(spinePrims.length).toBeGreaterThan(0);
    for (const l of spinePrims) expect(l).toContain('offset=(0.03,0,-0.02)');
    expect(build(text).errors).toEqual([]);
  });

  it('emits NO offset= when the fit has none', () => {
    // A zero offset must not appear as `offset=(0,0,0)` noise: an absent arg
    // and a measured-zero displacement are the same statement about the
    // surface, and the extra arg would sit on every prim line forever.
    // Prim lines only: the HEADER may name the grammar's own arguments in
    // prose, and did once the header described the rig/cloud split.
    const primLines = (t: string): string =>
      t.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n');
    const text = emitDraft(makeFit());
    expect(primLines(text)).not.toContain('offset=');
    // An explicitly measured-zero fit is the absent case, not a special one.
    const f = makeFit();
    f.bones.find((b) => b.name === 'spine')!.shared!.offset = [0, 0, 0];
    expect(primLines(emitDraft(f))).not.toContain('offset=');
  });

  it('notes a cloud/rig axis disagreement in the # fit: comment', () => {
    // The >45-degree case is now a REPORTED CHECK, not a silent correction:
    // the schoolgirl dress cloud measured 86° off its bone, and the old CLI
    // silently steered the axis. The author must see the disagreement where
    // the numbers are.
    const f = makeFit();
    const spine = f.bones.find((b) => b.name === 'spine')!;
    spine.chain = { rigBone: 'spine1', scale: 1.23, head: 'Spine02', tail: 'Spine01' };
    spine.shared!.axisDisagreeDeg = 86;
    const text = emitDraft(f);
    const spineStatement = text.split('\n').find((l) => l.trim().startsWith('bone spine '));
    expect(spineStatement).toBeDefined();
    expect(spineStatement!).toContain('86°');
    expect(spineStatement!).toMatch(/off the rig chain/);
    // And the statement's len= names its new source: the rig segment times
    // the one global scale, with the rig JOINTS the span runs between so the
    // artifact carries its own source.
    expect(spineStatement!).toContain('rig spine1');
    expect(spineStatement!).toContain('Spine02->Spine01');
    expect(spineStatement!).toContain('1.23');
    expect(build(text).errors).toEqual([]);
  });
});

// The chain-drift acceptance properties, end to end on a SYNTHETIC RIG: the
// pipeline under test is the real one — detectRig → assembleDraft (grouping,
// fits, chain assembly) → emitDraft → parse → compile → build — because the
// properties are properties of the EMITTED DOCUMENT's built geometry, not of
// any one fit function. The rig mirrors the two real references' failure
// modes on purpose:
//   - the legs and the spine BRANCH at Hips (a rig is a tree; `.blob` is a
//     chain — the unmodelled branch stubs were the residual sole/height drift
//     after chain drift: schoolgirl's soles +0.25 m);
//   - the head cloud is a HAIR blob whose principal axis is ~60° off
//     vertical (schoolgirl's measured 75°) — a skull bone that leans
//     sideways steals the crown extent the height line checks;
//   - nothing grounds the figure: the raw rig anchor is not y = 0.
// Determinism: every cloud is generated from golden-angle/fibonacci sweeps,
// no rng — the same fixture builds the same body every run.
const RIG_NAME = 'rigling';

/** Joint positions in mesh units — a 1.5-ish standing biped, soles at y≈0. */
const JOINTS = new Map<string, Vec3>([
  ['Hips', [0, 0.99, 0.02]], ['Spine02', [0, 1.1, 0.02]], ['Spine01', [0, 1.21, 0.01]],
  ['Spine', [0, 1.32, 0]], ['neck', [0, 1.38, 0]], ['Head', [0, 1.435, 0.005]],
  ['LeftShoulder', [0.06, 1.385, 0]], ['LeftArm', [0.23, 1.385, 0]],
  ['LeftForeArm', [0.44, 1.385, 0]], ['LeftHand', [0.62, 1.385, 0]],
  ['RightShoulder', [-0.06, 1.385, 0]], ['RightArm', [-0.23, 1.385, 0]],
  ['RightForeArm', [-0.44, 1.385, 0]], ['RightHand', [-0.62, 1.385, 0]],
  ['LeftUpLeg', [0.065, 0.9, 0.02]], ['LeftLeg', [0.085, 0.5, 0]],
  ['LeftFoot', [0.1, 0.13, -0.03]], ['LeftToeBase', [0.1, 0.03, 0.05]],
  ['RightUpLeg', [-0.065, 0.9, 0.02]], ['RightLeg', [-0.085, 0.5, 0]],
  ['RightFoot', [-0.1, 0.13, -0.03]], ['RightToeBase', [-0.1, 0.03, 0.05]],
]);

/** Orthonormal frame across `dir`, seeded from the least-aligned world axis
 *  (fixed inputs, so draft-fit's tie-safety concern does not arise here). */
function frame(dir: Vec3): { u: Vec3; v: Vec3 } {
  const w = normalize(dir);
  const seed: Vec3 = Math.abs(w[0]!) <= Math.abs(w[1]!) && Math.abs(w[0]!) <= Math.abs(w[2]!)
    ? [1, 0, 0]
    : Math.abs(w[1]!) <= Math.abs(w[2]!) ? [0, 1, 0] : [0, 0, 1];
  const u = normalize(cross(seed, w));
  return { u, v: cross(w, u) };
}

/** Straight tube of points around a->b: the limb cloud a Meshy mesh yields. */
function tube(a: Vec3, b: Vec3, r: number, n: number): Vec3[] {
  const axis = sub(b, a), alen = len(axis), dir = vscale(axis, 1 / alen);
  const { u, v } = frame(dir);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = alen * (i + 0.5) / n, th = i * 2.399963;
    out.push([
      a[0] + dir[0]! * t + r * (Math.cos(th) * u[0]! + Math.sin(th) * v[0]!),
      a[1] + dir[1]! * t + r * (Math.cos(th) * u[1]! + Math.sin(th) * v[1]!),
      a[2] + dir[2]! * t + r * (Math.cos(th) * u[2]! + Math.sin(th) * v[2]!),
    ]);
  }
  return out;
}

/** Fibonacci ball. */
function ballAt(centre: Vec3, r: number, n: number): Vec3[] {
  return headBall(centre, r, n);
}

/** Ellipsoid with a LONG axis deliberately off-vertical — the hair blob.
 *  Its principal axis is `tiltDeg` from +y in the x-y plane, which is what
 *  the pre-fix skull leaf (principal-axis line, rig-signed) inherits. */
function hairBlob(centre: Vec3, tiltDeg: number, aLong: number, rPerp: number, n: number): Vec3[] {
  const t = tiltDeg * Math.PI / 180;
  const { u, v } = frame([Math.sin(t), Math.cos(t), 0]);
  const d: Vec3 = [Math.sin(t), Math.cos(t), 0];
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    const radial: Vec3 = [
      s * (Math.cos(th) * u[0]! + Math.sin(th) * v[0]!),
      s * (Math.cos(th) * u[1]! + Math.sin(th) * v[1]!),
      s * (Math.cos(th) * u[2]! + Math.sin(th) * v[2]!),
    ];
    out.push([
      centre[0] + aLong * y * d[0]! + rPerp * radial[0]!,
      centre[1] + aLong * y * d[1]! + rPerp * radial[1]!,
      centre[2] + aLong * y * d[2]! + rPerp * radial[2]!,
    ]);
  }
  return out;
}

function vertsOf(joint: string, pts: Vec3[]): RefVertex[] {
  return pts.map((position) => ({ joint, position }));
}

/** The mirrored pair of a left cloud, x-flipped (the fixture's right side). */
const flipX = (pts: Vec3[]): Vec3[] => pts.map((p) => [-p[0]!, p[1]!, p[2]!] as Vec3);

const RIG_SKIN: RefSkin = (() => {
  const lThigh = tube(JOINTS.get('LeftUpLeg')!, JOINTS.get('LeftLeg')!, 0.08, 300);
  const lShin = tube(JOINTS.get('LeftLeg')!, JOINTS.get('LeftFoot')!, 0.05, 300);
  const lFoot = tube(JOINTS.get('LeftFoot')!, JOINTS.get('LeftToeBase')!, 0.045, 200);
  const lUpper = tube(JOINTS.get('LeftArm')!, JOINTS.get('LeftForeArm')!, 0.055, 200);
  const lFore = tube(JOINTS.get('LeftForeArm')!, JOINTS.get('LeftHand')!, 0.045, 200);
  const verts: RefVertex[] = [
    ...vertsOf('Hips', ballAt([0, 1.0, 0.02], 0.13, 400)),
    ...vertsOf('Spine02', tube(JOINTS.get('Spine02')!, JOINTS.get('Spine01')!, 0.11, 200)),
    ...vertsOf('Spine01', tube(JOINTS.get('Spine01')!, JOINTS.get('Spine')!, 0.12, 200)),
    ...vertsOf('Spine', tube(JOINTS.get('Spine')!, JOINTS.get('neck')!, 0.1, 200)),
    ...vertsOf('neck', tube(JOINTS.get('neck')!, JOINTS.get('Head')!, 0.045, 200)),
    // THE HAIR TRAP: principal axis 60° off the neck's vertical.
    ...vertsOf('Head', hairBlob([0, 1.36, 0.005], 60, 0.13, 0.075, 400)),
    ...vertsOf('LeftShoulder', tube(JOINTS.get('LeftShoulder')!, JOINTS.get('LeftArm')!, 0.06, 200)),
    ...vertsOf('LeftArm', lUpper),
    ...vertsOf('LeftForeArm', lFore),
    ...vertsOf('LeftHand', ballAt(JOINTS.get('LeftHand')!, 0.06, 200)),
    ...vertsOf('LeftUpLeg', lThigh),
    ...vertsOf('LeftLeg', lShin),
    ...vertsOf('LeftFoot', lFoot),
    ...vertsOf('LeftToeBase', tube(JOINTS.get('LeftToeBase')!, [0.1, 0.025, 0.12], 0.03, 100)),
    ...vertsOf('RightShoulder', flipX(tube(JOINTS.get('LeftShoulder')!, JOINTS.get('LeftArm')!, 0.06, 200))),
    ...vertsOf('RightArm', flipX(lUpper)),
    ...vertsOf('RightForeArm', flipX(lFore)),
    ...vertsOf('RightHand', flipX(ballAt(JOINTS.get('LeftHand')!, 0.06, 200))),
    ...vertsOf('RightUpLeg', flipX(lThigh)),
    ...vertsOf('RightLeg', flipX(lShin)),
    ...vertsOf('RightFoot', flipX(lFoot)),
    ...vertsOf('RightToeBase', flipX(tube(JOINTS.get('LeftToeBase')!, [0.1, 0.025, 0.12], 0.03, 100))),
  ];
  return { verts, jointWorld: JOINTS, total: verts.length, dropped: 0 };
})();

const RIG = detectRig([...RIG_SKIN.jointWorld.keys()]);

/** The drafted RIGLING: assemble → emit → parse → compile → build. */
export function draftedRigling() {
  const { input, g } = assembleDraft(RIG_SKIN, RIG, null, { name: RIG_NAME, height: 1.9 });
  const text = emitDraft(input);
  const body = buildBody(compileBlob(parseBlob(text), compileFace(parseBlob(text))));
  return { input, text, body, g };
}

/** The built body's lowest and highest SURFACE point (capsule caps, taper
 *  aware) — what "soles on the floor" and "crown" physically mean. */
function surfaceExtent(body: ReturnType<typeof buildBody>): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const p of body.prims) {
    const r = Math.max(p.radius, p.radiusB ?? p.radius);
    min = Math.min(min, p.a[1] - r, p.b[1] - r);
    max = Math.max(max, p.a[1] + r, p.b[1] + r);
  }
  return { min, max };
}

// THE ACCEPTANCE PROPERTIES (chain-drift spec): both are properties of the
// emitted draft, checkable without an eye. The pre-fix numbers on this
// fixture: soles ~+0.36 m (the Hips branch stubs), extent ~19% short.
describe('drafted chain closes', () => {
  it('lands the soles on the floor', () => {
    // Build the whole pipeline and assert the body's lowest point sits at
    // y = 0 within 2 cm of a 1.9 m figure — 0.1%: float/format noise only,
    // the grounding is derived from the same build the test measures.
    const { body } = draftedRigling();
    expect(body.errors).toEqual([]);
    const { min } = surfaceExtent(body);
    expect(Math.abs(min)).toBeLessThanOrEqual(0.02);
  });

  it('matches its own height line', () => {
    // Crown-to-sole extent within tolerance of the requested height. The
    // tolerance must absorb what a capsule-surface body CANNOT match: the
    // end caps add ~one crown radius above the skeleton (the sole side is
    // grounded away), a few % on a figure this size — while the pre-fix
    // failures this exists to catch were 8% and 19% SHORT.
    const { body } = draftedRigling();
    const { min, max } = surfaceExtent(body);
    expect(Math.abs(max - min - 1.9)).toBeLessThanOrEqual(0.05 * 1.9);
  });

  it('emits len= equal to the rig distance times the global scale', () => {
    // For every mapped bone, read off the ARTIFACT (parse what was emitted)
    // and compare against the rig's own joint-to-joint distance — the
    // property bonewalker had by construction and the first draft did not.
    // The declared joints come from the assembler's chain metadata and are
    // resolved against the FIXTURE's joint table, so the check is against
    // the rig, not against the pipeline's own arithmetic.
    const { input, text, g } = draftedRigling();
    const doc = parseBlob(text);
    const byName = new Map(doc.bones.map((b) => [b.name, b]));
    const docLen = (name: string): number =>
      name === doc.rootBone ? doc.rootLen : byName.get(name)!.len;
    // The chain must also COMPOSE: a mapped child's declared span starts
    // exactly where its .blob parent's declared span ends — that identity is
    // what makes each len= a chain quantity rather than a per-bone one.
    const chainOf = new Map(input.bones.map((b) => [b.name, b.chain]));
    for (const db of input.bones) {
      if (db.chain && db.parent !== null) {
        const parentChain = chainOf.get(db.parent);
        if (parentChain) expect(db.chain.head).toBe(parentChain.tail);
      }
    }
    let checked = 0;
    for (const db of input.bones) {
      if (!db.chain) {
        // Unmapped leaves (skull, hands) carry no rig chain — there is no
        // rig distance for them, which is why they must be chain leaves.
        continue;
      }
      const head = RIG_SKIN.jointWorld.get(db.chain.head);
      const tail = RIG_SKIN.jointWorld.get(db.chain.tail);
      if (!head || !tail) throw new Error(`declared chain joints missing from the rig: ${db.chain.head}->${db.chain.tail}`);
      // 3 decimals, not 6: the artifact formats numbers to 4 decimal places
      // (emitDraft's fmt), so the tightest honest bound is the format's own
      // rounding — 5e-4 m is still 100x tighter than the drift class this
      // exists to catch.
      expect(docLen(db.name)).toBeCloseTo(len(sub(tail, head)) * g, 3);
      checked++;
    }
    // Guard against the vacuous pass: the rig maps 11 bones (pelvis, four
    // spine bones, and three limb pairs); a scan that checked nothing would
    // prove nothing.
    expect(checked).toBe(11);
  });

  it('says where the skull line came from — the parent rig axis, not a principal axis', () => {
    // axisFromParent was set on the assembler's internal Built record but
    // dropped in assembly, so the statement claimed "medial axis of the
    // skull cloud" for the very number that carries the crown extent — a lie
    // about the source, which is the one thing a # fit: comment may not be.
    const { text } = draftedRigling();
    const skull = text.split('\n').find((l) => l.trim().startsWith('bone skull '));
    expect(skull).toBeDefined();
    expect(skull!).toContain("parent's rig axis");
    expect(skull!).not.toContain('medial axis of the skull cloud');
  });
});

// ---------------------------------------------------------------------------
// BANDING IS IN THE BONE'S FRAME (frame/face plan, Task 1).
//
// The defect, measured on the committed minotaur draft: the prosthetic
// shin.r cloud's principal axis sits ~88° off the statement chain, and
// `bandRange` transfers cloud-frame band edges onto the statement line by
// projection — at 88° the axis itself projects to a ~0.045-wide fraction
// sliver (artifact: bands 4-9 all inside [0.196, 0.233], four with
// from > to), stacking the prosthetic's bulk at one knee. The same
// compression stacks the fixture pelvis below into from=0 to=0 prims.
// Past the fit's own report bar (AXIS_REPORT_DEG in draft-skeleton — the
// same measured angle `# fit:` already reports), the cloud's principal axis
// is not a limb axis, so the BANDING frame moves to the chain's; at or
// under it banding must not move at all (most limb clouds are aligned,
// which is what the snapshot guard pins).

/** The `bar` prims of one bone (one `side=`) parsed to their from/to/r. */
function barPrims(text: string, bone: string, side: 'l' | 'r'): { from: number; to: number; r: number }[] {
  return text.split('\n')
    .filter((l) => l.startsWith('  bar ') && l.includes(` on ${bone} `) && l.includes(` side=${side} `))
    .map((l) => {
      const from = Number(l.match(/from=([\d.]+)/)![1]);
      const to = Number(l.match(/to=([\d.]+)/)![1]);
      const r = Number(l.match(/ r=([\d.]+)/)![1]);
      return { from, to, r };
    });
}

/** Ellipsoid of points: semi-axes `across`/`along`/`thin` along the given
 *  unit directions. Fibonacci sweep — deterministic, even coverage, no rng
 *  (headBall's discipline). This is a PROSTHETIC PLATE: its principal axis
 *  is the plate's width, not the leg's length. */
function ellipsoidCloud(centre: Vec3, acrossDir: Vec3, alongDir: Vec3, across: number, along: number, thin: number, n: number): Vec3[] {
  const third = normalize(cross(acrossDir, alongDir));
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    const cx = across * rad * Math.cos(th) * acrossDir[0]!
      + along * y * alongDir[0]! + thin * rad * Math.sin(th) * third[0]!;
    const cy = across * rad * Math.cos(th) * acrossDir[1]!
      + along * y * alongDir[1]! + thin * rad * Math.sin(th) * third[1]!;
    const cz = across * rad * Math.cos(th) * acrossDir[2]!
      + along * y * alongDir[2]! + thin * rad * Math.sin(th) * third[2]!;
    out.push([centre[0]! + cx, centre[1]! + cy, centre[2]! + cz]);
  }
  return out;
}

/** The rigling with its right leg SPLAYED (a brawler stance — the real
 *  minotaur's leg pair is 20° apart in 3D) and its right shin cloud replaced
 *  by an oblique plate. The plate's mass spans ~65% of the segment's length
 *  while its principal axis points across it at 82° — signed along the
 *  rig's RIGHT segment by `orient`, yet past perpendicular against the LEFT
 *  statement chain (their directions differ by the splay), which is exactly
 *  the real prosthetic's geometry: reported 76° off, projecting onto the
 *  statement line with a NEGATIVE slope, emitting from > to. The left shin
 *  stays a tube, so the pair is honestly NOT mirrorable (count skew 0.667,
 *  the real prosthetic's metric is 0.627) and emits per side. */
export const OBLIQUE_SKIN: RefSkin = (() => {
  const OBLIQUE_JOINTS = new Map(JOINTS);
  OBLIQUE_JOINTS.set('RightLeg', [-0.16, 0.5, 0.06]);
  OBLIQUE_JOINTS.set('RightFoot', [-0.22, 0.13, -0.02]);
  const a = OBLIQUE_JOINTS.get('RightLeg')!, b = OBLIQUE_JOINTS.get('RightFoot')!;
  const seg = sub(b, a), segLen = len(seg);
  const segDir = vscale(seg, 1 / segLen);
  // The statement chain is the LEFT segment (the .blob statement is shared;
  // the mirror block flips it for the right copy).
  const l = JOINTS.get('LeftLeg')!, lf = JOINTS.get('LeftFoot')!;
  const leftDir = vscale(sub(lf, l), 1 / len(sub(lf, l)));
  // The plate axis: 82° off the RIGHT segment (past the fit's report bar),
  // in the plane of the two legs, on the side AWAY from the statement chain.
  // Components vs the two directions: +cos82° along the right segment (so
  // `orient`'s anatomical signing keeps it), and vs the statement chain
  // cos82°·0.97 − sin82°·0.23 < 0 — the negative projection slope that made
  // the pre-fix emitter run from/to backward.
  const w = sub(leftDir, vscale(segDir, dot(leftDir, segDir)));
  const away = vscale(normalize(w), -1);
  const t = (82 * Math.PI) / 180;
  const acrossDir = normalize([
    segDir[0]! * Math.cos(t) + away[0]! * Math.sin(t),
    segDir[1]! * Math.cos(t) + away[1]! * Math.sin(t),
    segDir[2]! * Math.cos(t) + away[2]! * Math.sin(t),
  ]);
  const centre: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  // along = 0.12 of a 0.38 segment: the plate's honest footprint along the
  // statement bone is ≈0.24/0.37 ≈ 0.65 of [0,1] — the number the span
  // assertion is calibrated against.
  const plate = ellipsoidCloud(centre, acrossDir, segDir, 0.20, 0.12, 0.05, 900);
  const verts: RefVertex[] = [
    ...RIG_SKIN.verts.filter((v) => v.joint !== 'RightLeg'),
    ...plate.map((position) => ({ joint: 'RightLeg', position })),
  ];
  return { verts, jointWorld: OBLIQUE_JOINTS, total: verts.length, dropped: 0 };
})();

/** The drafted oblique variant: assemble → emit (the real pipeline, like
 *  draftedRigling). */
export function draftedOblique() {
  const { input } = assembleDraft(OBLIQUE_SKIN, RIG, null, { name: RIG_NAME, height: 1.9 });
  const text = emitDraft(input);
  return { input, text };
}

describe('banding is in the bone frame', () => {
  it('spans the bone for an OBLIQUE cloud', () => {
    // The plate's honest footprint along the statement bone is ~0.65 of
    // [0,1] (geometry above). The pre-fix pipeline measured band edges along
    // the plate's own axis and projected: cos(80°) collapses that to a
    // ~0.04 sliver (the real artifact measured 0.045 wide). Interior bands
    // — excluding the first and last, which are PINNED to the bone ends for
    // joint fusion and so say nothing about the frame transfer — must still
    // tile at least 0.30 of the bone: half the honest footprint minus the
    // end margins. The pre-fix sliver fails this by ~8×; a cloud under the
    // report bar (≤45°, cos ≥ 0.7) passes it without moving.
    const { text } = draftedOblique();
    const prims = barPrims(text, 'shin', 'r');
    // The scan must see a real per-side prosthetic, not an empty bone.
    expect(prims.length).toBeGreaterThanOrEqual(4);
    const interior = prims.slice(1, -1);
    const lo = Math.min(...interior.map((p) => Math.min(p.from, p.to)));
    const hi = Math.max(...interior.map((p) => Math.max(p.from, p.to)));
    expect(hi - lo).toBeGreaterThanOrEqual(0.30);
    // The radii, too, are surface statements ABOUT THE CLOUD: the plate's
    // honest tube radius about its own centroid-parallel axis lands at a
    // ~0.10-0.14 median (semi-axes 0.20/0.12/0.05). Anchoring the banding
    // line at the rig JOINT instead — the plan-literal variant — inflates
    // every radius by √(d²+r²) ≈ 0.17+ (the centroid sits ~0.125 off the
    // joint axis) and then DOUBLE-COUNTS the displacement with offset=.
    // The median bound kills that variant.
    const rs = prims.map((p) => p.r).sort((a, b) => a - b);
    const medianR = rs[rs.length >> 1]!;
    expect(medianR).toBeGreaterThanOrEqual(0.09);
    expect(medianR).toBeLessThanOrEqual(0.15);
  });

  it('never emits from > to', () => {
    // The oblique case emitted INVERTED ranges (real artifact: shin.r bands
    // 4, 5, 6, 8) because the cloud axis is signed along the RIG's right
    // segment while the statement line is the LEFT one — past perpendicular
    // the projection runs backward. `resolve` lerps so the numbers stay
    // harmless, but the PLACEMENT is wrong. Ordering is asserted over every
    // band of every bone of BOTH drafted bodies, so a fix that merely
    // re-sorts the sliver cannot pass.
    for (const { text } of [draftedRigling(), draftedOblique()]) {
      const bars = text.split('\n').filter((l) => l.startsWith('  bar '));
      // The scan must see both drafted bodies' prim sets.
      expect(bars.length).toBeGreaterThanOrEqual(20);
      for (const l of bars) {
        const from = Number(l.match(/from=([\d.]+)/)![1]);
        const to = Number(l.match(/to=([\d.]+)/)![1]);
        expect(to, l).toBeGreaterThanOrEqual(from);
      }
    }
  });

  it('leaves an ALIGNED cloud unchanged', () => {
    // The regression guard: the fixture's LIMB tubes are long and thin, so
    // their principal axes ARE their rig segments — the case of most real
    // bones. Where the axes agree, the banding-frame choice cannot matter,
    // so the emitted numbers must be BIT-identical to the pre-fix pipeline
    // — pinned here (comments stripped: prose may move, numbers may not).
    // NOT pinned: the pelvis ball and the short-fat torso tubes — their
    // principal axes are radial/eigenvector noise that MEASURES past the
    // report bar (the spine tubes 89.9°), so they ride the chain-frame path
    // by measurement, and their pre-fix output was the pinned-ends-plus-
    // mid-sliver collapse this plan fixes. The hand band rides the budget
    // trim boundary and moves with any bone's band count; it pins nothing.
    const { text } = draftedRigling();
    const words = text.split('\n')
      .filter((l) => l.startsWith('  bar '))
      .map((l) => l.split('  # ')[0]!);
    const limbs = words.filter((l) =>
      ['clavicle', 'upperarm', 'forearm', 'thigh', 'shin', 'foot'].some((b) => l.includes(` on ${b} `)));
    // The scan must see the aligned limb set, not an empty filter.
    expect(limbs.length).toBeGreaterThanOrEqual(10);
    expect(limbs).toEqual(ALIGNED_RIGLING_BAR_WORDS);
  });
});

const ALIGNED_RIGLING_BAR_WORDS: string[] = [
    "  bar arm on clavicle from=0 to=1 r=0.0748 wide=1.0002 deep=0.9998 blend=0.006 offset=(-0.0001,0.0023,-0.0004) mirror core",
    "  bar arm on upperarm from=0 to=1 r=0.0686 wide=1.0001 deep=0.9999 blend=0.0055 offset=(0,0,-0.0003) mirror",
    "  bar arm on forearm from=0 to=1 r=0.0561 wide=1.0001 deep=0.9999 blend=0.0045 offset=(0,0,-0.0003) mirror",
    "  bar leg on thigh from=0 to=1 r=0.0997 wide=1 deep=1 blend=0.008 offset=(0.0227,0.0031,0.0045) mirror core",
    "  bar leg on shin from=0 to=1 r=0.0623 wide=1 deep=1 blend=0.005 offset=(0.0001,0,-0.0002) mirror",
    "  bar leg on foot from=0 to=0 r=0.04 wide=0.8558 deep=1.1442 blend=0.004 offset=(-0,0.0065,0.0082) mirror",
    "  bar leg on foot from=0.0773 to=0.1349 r=0.0568 wide=1.0007 deep=0.9993 blend=0.0045 offset=(-0,0.0065,0.0082) mirror",
    "  bar leg on foot from=0.1455 to=0.1968 r=0.0619 wide=1.0575 deep=0.9425 blend=0.0049 offset=(-0,0.0065,0.0082) mirror",
    "  bar leg on foot from=0.2018 to=0.886 r=0.0566 wide=1.0349 deep=0.9651 blend=0.0045 offset=(-0,0.0065,0.0082) mirror",
    "  bar leg on foot from=0.8954 to=0.9525 r=0.0421 wide=0.8317 deep=1.1683 blend=0.004 offset=(-0,0.0065,0.0082) mirror",
    "  bar leg on foot from=0.9543 to=1 r=0.0386 wide=1.0534 deep=0.9466 blend=0.004 offset=(-0,0.0065,0.0082) mirror",
    "  bar leg on foot from=1 to=1 r=0.0205 wide=0.7134 deep=1.2866 blend=0.004 offset=(-0,0.0065,0.0082) mirror",
];