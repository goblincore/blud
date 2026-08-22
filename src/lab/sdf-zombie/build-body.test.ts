// src/lab/sdf-zombie/build-body.test.ts
import { describe, it, expect } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE, makeZombie } from './body';
import { DEFAULT_FACE, facePrims } from './face';
import { CLUSTER_ORDER } from './types';
import { MAX_PRIMS } from './validate';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';

describe('buildBody with the shipped zombie', () => {
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

  it('produces a body that passes every check', () => {
    expect(built.errors).toEqual([]);
  });

  it('has all six clusters, in fold order', () => {
    expect(built.clusters.map(c => c.limb)).toEqual([...CLUSTER_ORDER]);
  });

  it('stays within the shader ceilings', () => {
    expect(built.prims.length).toBeGreaterThanOrEqual(15);
    expect(built.prims.length).toBeLessThanOrEqual(MAX_PRIMS);
  });

  it('is bilaterally symmetric in x', () => {
    const flip = (n: number) => Math.round(n * 1e6) / 1e6;
    const left = built.prims.filter(p => p.limb === 'armL').map(p => flip(p.a[0]));
    const right = built.prims.filter(p => p.limb === 'armR').map(p => flip(-p.a[0]));
    expect(left).toEqual(right);
  });

  it('applies an override layer over the base definition', () => {
    const o = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, { primRadius: { 0: 0.99 } });
    expect(o.prims[0]!.radius).toBe(0.99);
    // The base definition is not mutated.
    expect(buildBody(ZOMBIE, DEFAULT_BUILD_OPTS).prims[0]!.radius).not.toBe(0.99);
  });

  it('reports errors instead of throwing when an override breaks a check', () => {
    const o = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, { primBlendK: { 0: 0 } });
    expect(Array.isArray(o.errors)).toBe(true);
  });
});

describe('makeZombie', () => {
  const built = buildBody(makeZombie(DEFAULT_FACE), DEFAULT_BUILD_OPTS);

  it('builds a valid body with the face attached', () => {
    expect(built.errors).toEqual([]);
  });

  it('adds the head to the head cluster and nowhere else', () => {
    const head = built.clusters.find(c => c.limb === 'head')!;
    // body.ts contributes only the neck; face.ts emits the skull itself.
    const faceCount = facePrims(DEFAULT_FACE)
      .reduce((n, p) => n + (p.mirrorOffset ? 2 : 1), 0);
    expect(head.count).toBe(1 + faceCount);
    for (const p of built.prims.slice(head.start, head.start + head.count))
      expect(p.limb).toBe('head');
  });

  it('carries no carves — the face is texture, so nothing is cut out', () => {
    // The carve machinery is still exercised by wounds and by sever.ts; it is
    // simply unused by the body's own definition.
    expect(built.prims.every(p => p.op !== 'sub')).toBe(true);
  });

  it('stays inside the shader primitive cap', () => {
    expect(built.prims.length).toBeLessThanOrEqual(MAX_PRIMS);
  });
});

describe('source-line provenance survives the build', () => {
  // `skull` is required (facePrims, always emitted, reference it — see
  // compileBlob's doc comment), and the pelvis-anchored second torso blob is
  // required for `legL`/`legR` connectivity: the mirrored thigh bones have
  // nothing else nearby to fuse to. Same shape as compileBlob's own fixture,
  // minus the carve line this test doesn't need.
  const SRC = `model t
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
  blob torso on pelvis at=0.40 r=0.16 wide=1.10 tall=0.9 deep=0.92 blend=0.03
`;
  const torsoLine = 11;
  const legLine = 12;
  const torso2Line = 13;

  const doc = parseBlob(SRC);
  const body = buildBody(compileBlob(doc, compileFace(doc)));

  it('builds clean', () => {
    expect(body.errors).toEqual([]);
  });

  it('every authored prim still carries its .blob line after mirror + resolve + clusters', () => {
    // facePrims (always appended by compileBlob) carry no .blob line, so
    // they show up as `undefined` here — filtered out, since this test is
    // about what the AUTHORED parts carry, not the generated face.
    const authored = body.prims.map(p => p.src).filter((n): n is number => n !== undefined);
    expect(authored.sort((a, b) => a - b)).toEqual([torsoLine, legLine, legLine, torso2Line].sort((a, b) => a - b));
  });

  it('carries the CONCRETE bone name, so a mirrored prim names its own side', () => {
    // `bone` rides the same route as `src` and is what turns a prim index into
    // "the leg on thigh.l" — the half of the provenance a line number alone
    // cannot give, since one mirrored line authors two prims.
    const legs = body.prims.filter(p => p.src === legLine).map(p => p.bone);
    expect(legs.sort()).toEqual(['thigh.l', 'thigh.r']);
    expect(body.prims.find(p => p.src === torsoLine)!.bone).toBe('spine');
  });
});
