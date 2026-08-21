// src/lab/sdf-zombie/blob-compile.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { compileBlob, dirVector } from './blob-compile';

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
});

describe('compileBlob', () => {
  // `skull` and the second `torso` blob (on the root `pelvis` bone) aren't in
  // the plan's original fixture: without a `skull` bone, facePrims (always
  // emitted — see compileBlob's doc comment) reference a bone that doesn't
  // exist, and without a pelvis-region blob bridging the spine's torso blob
  // down to the legs, buildBody's connectivity check reports the head and
  // both legs as disconnected — exactly what it's supposed to catch. Every
  // real `.blob` character (the pelvis-anchored zombie included) carries
  // both; this fixture needs them too to exercise the "existing builder
  // accepts without errors" test honestly rather than vacuously.
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
