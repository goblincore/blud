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
import {
  emitDraft, DRAFT_BUDGET_TOTAL, DRAFT_BUDGET_CLUSTER,
  type DraftInput, type DraftBone, type DraftSideFit,
} from './draft-emit';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody } from './build-body';
import { MAX_PRIMS } from './validate';

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
});
