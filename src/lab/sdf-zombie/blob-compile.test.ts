// src/lab/sdf-zombie/blob-compile.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { BlobError } from './blob-ast';
import { compileBlob, compileFace, dirVector } from './blob-compile';

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, Math.round(-Math.log10(eps))));

describe('dirVector', () => {
  it('maps the four base directions', () => {
    near(dirVector('up', 0, 0), [0, 1, 0]);
    near(dirVector('down', 0, 0), [0, -1, 0]);
    near(dirVector('side', 0, 0), [1, 0, 0]);
    near(dirVector('fwd', 0, 0), [0, 0, 1]);
  });

  // The zombie's spine is authored as [0,1,0.12]; atan(0.12) = 6.843 degrees.
  it('pitches up toward +z, matching the authored spine', () => {
    const v = dirVector('up', 6.842773, 0);
    near([v[2] / v[1], 0, 0], [0.12, 0, 0], 1e-6);
  });

  // upperArm is [0.30,-1,0]; atan(0.30) = 16.699 degrees of tilt off down.
  it('tilts down toward +x, matching the authored upper arm', () => {
    const v = dirVector('down', 0, 16.699244);
    near([v[0] / -v[1], 0, 0], [0.30, 0, 0], 1e-6);
  });

  // shin is [0,-1,0.05]; atan(0.05) = 2.862405 degrees. Neither existing
  // test above combines pitch with a `down` base — the previous
  // implementation applied pitch as a literal rotation about world X, so its
  // sign depended on the sign of the base's y, and this case produced
  // z ≈ -0.0499 (flipped) instead of +0.05. Pitch is an author-facing
  // convention ("tip forward") that must mean the same thing on a
  // downward-pointing bone as on an upward one.
  it('pitches down toward +z too, matching the authored shin', () => {
    const v = dirVector('down', 2.862405, 0);
    near([v[2] / -v[1], 0, 0], [0.05, 0, 0], 1e-6);
  });

  // foreArm is [0.05,-1,0.1]; atan(0.1) = 5.710593 degrees of pitch and
  // atan(0.05) = 2.862405 degrees of tilt, combined on a `down` base — the
  // one case the plan's original two tests never covered together. This is
  // exactly the combination that was silently wrong before the pitch fix
  // (z ≈ -0.1001 instead of +0.1001).
  //
  // x/-y matches tan(tilt) to float precision regardless of pitch: tilt
  // rotates (0, y1) rigidly, and that rotation preserves the ratio of its
  // own two components no matter how big y1 is. z, however, is fixed by
  // pitch BEFORE tilt runs and tilt never touches it, while tilt DOES shrink
  // |y| by cos(tilt) — so z/-y comes out as tan(pitch) / cos(tilt), not
  // tan(pitch) exactly. That is a real, name-able ~sec(tilt) coupling
  // between sequential single-axis rotations, not slop: at tilt =
  // 2.862405°, sec(tilt) - 1 ≈ 1.25e-3 relative, i.e. ≈ 1.25e-4 absolute on
  // a 0.1 target — hence the looser (but still tight, 5e-4) epsilon on the
  // z assertion only; `near`'s eps→decimal-places conversion needs it above
  // 2e-4 to actually buy that many digits (toBeCloseTo(x, 4)'s threshold of
  // 5e-5 is tighter than the residual and would still fail).
  it('combines pitch and tilt on a down base, matching the authored forearm', () => {
    const v = dirVector('down', 5.710593, 2.862405);
    near([v[0] / -v[1]], [0.05], 1e-6);
    near([v[2] / -v[1]], [0.1], 5e-4);
  });
});

describe('compileBlob', () => {
  // `skull` and the second `torso` blob (on the root `pelvis` bone) aren't in
  // the plan's original fixture, and both are needed:
  //
  // Without a `skull` bone, facePrims (always emitted — see compileBlob's doc
  // comment) reference a bone that doesn't exist, and buildBody throws
  // outright ("prim references unknown bone \"skull\"") before validation
  // even runs.
  //
  // Add just the `skull` bone and buildBody gets past that throw, but
  // validateBody's connectivity check then reports `legL`/`legR` as
  // disconnected — NOT the head. The spine's torso blob (at=0.8) already
  // sits close enough to fuse with the skull on its own; it's the mirrored
  // `thigh` bones, parented straight onto `pelvis` with no torso mass nearby,
  // that have nothing to fuse to. The pelvis-anchored `blob torso` below
  // (mirroring the real zombie's own pelvis blob in body.ts) bridges that
  // gap. Every real `.blob` character carries geometry like it; this fixture
  // needs it too to exercise the "existing builder accepts without errors"
  // test honestly rather than vacuously.
  const doc = parseBlob(`model t
skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=0 len=0.34
  bone skull parent=spine dir=up len=0.16
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end

body
  blob torso on spine at=0.8 r=0.15 wide=1.28 deep=0.78 blend=0.014
  bar  leg on thigh from=0.05 to=0.95 r=0.082 blend=0.0175 mirror
  carve on spine at=0.55 r=0.022 offset=(0.035,0.01,0.06) hard both
  blob torso on pelvis at=0.40 r=0.16 wide=1.10 tall=0.9 deep=0.92 blend=0.03
`);

  it('carries the root height through as BodyDef.root', () => {
    expect(compileBlob(doc).root).toEqual([0, 0.92, 0]);
  });

  it('emits the root bone with a null parent', () => {
    expect(compileBlob(doc).bones[0]).toMatchObject({ name: 'pelvis', parent: null });
  });

  it('turns wide/tall/deep into the scale triple', () => {
    expect(compileBlob(doc).prims[0]!.scale).toEqual([1.28, 1, 0.78]);
  });

  it('turns a bar into a capsule with capTo', () => {
    expect(compileBlob(doc).prims[1]).toMatchObject({ at: 0.05, capTo: 0.95, mirror: true });
  });

  it('turns carve into a subtract op, and hard into blendK 0', () => {
    expect(compileBlob(doc).prims[2]).toMatchObject({
      op: 'sub', blendK: 0, mirrorOffset: true, offset: [0.035, 0.01, 0.06],
    });
  });

  it('produces a BodyDef the existing builder accepts without errors', async () => {
    const { buildBody } = await import('./build-body');
    expect(buildBody(compileBlob(doc)).errors).toEqual([]);
  });
});

describe('compileFace', () => {
  // Line 6, col 3: "  headRadus 0.3" — indent 2, so the key starts at column 3.
  const TYPO_SRC = `model t
skeleton
  root pelvis at 0.92
face
  headRadius 0.2
  headRadus 0.3
`;

  it('rejects an unknown face parameter, naming the offending key', () => {
    const doc = parseBlob(TYPO_SRC);
    expect(() => compileFace(doc)).toThrow(BlobError);
    expect(() => compileFace(doc)).toThrow(/unknown face parameter "headRadus"/);
  });

  it('reports the real source line and column of the bad key, not a synthetic 0', () => {
    const doc = parseBlob(TYPO_SRC);
    let err: BlobError | undefined;
    try {
      compileFace(doc);
    } catch (e) {
      err = e as BlobError;
    }
    expect(err).toBeInstanceOf(BlobError);
    // "headRadus 0.3" is source line 6; the key is the first word after a
    // 2-space indent, so it starts at column 3.
    expect(err!.line).toBe(6);
    expect(err!.col).toBe(3);
  });

  it('compiles a document whose face keys are all valid, overriding only the named defaults', () => {
    const doc = parseBlob(`model t
skeleton
  root pelvis at 0.92
face
  headRadius 0.2
  jawDrop 0.05
`);
    const face = compileFace(doc);
    expect(face.headRadius).toBe(0.2);
    expect(face.jawDrop).toBe(0.05);
    // Every other field keeps DEFAULT_FACE's value — spot-check one.
    expect(face.headWidth).toBe(0.76);
  });
});
