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
    const text = emitDraft(makeFit());
    expect(text).not.toContain('offset=');
    // An explicitly measured-zero fit is the absent case, not a special one.
    const f = makeFit();
    f.bones.find((b) => b.name === 'spine')!.shared!.offset = [0, 0, 0];
    expect(emitDraft(f)).not.toContain('offset=');
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
function draftedRigling() {
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
