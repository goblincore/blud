// Life-state prims (`when=alive|dead`, cultist hood drop, 2026-09-24).
import { describe, expect, it } from 'vitest';
import cultistSrc from './characters/cultist.blob?raw';
import cowledSrc from './characters/cultist-cowled.blob?raw';
import zombieSrc from './characters/zombie.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { applyDeathState, hasDeathState } from './death-state';
import { cutLimbs } from './connectivity';
import { BlobError } from './blob-ast';

const build = (src: string) => { const d = parseBlob(src); return buildBody(compileBlob(d, compileFace(d))); };

describe('when= life-state prims', () => {
  it('parses alive/dead and rejects anything else', () => {
    const line = cultistSrc.split('\n').find(l => l.includes('when=alive'))!;
    expect(() => parseBlob(cultistSrc.replace(line, line.replace('when=alive', 'when=later')))).toThrow(BlobError);
  });
  for (const [name, src] of [['cultist', cultistSrc], ['cultist-cowled', cowledSrc]] as const) {
    it(`${name}: the hood is alive-only, the fallen hood starts hidden`, () => {
      const b = build(src);
      const alive = b.prims.filter(p => p.when === 'alive');
      const dead = b.prims.filter(p => p.when === 'dead');
      expect(alive.length).toBe(2);
      expect(alive.every(p => p.limb === 'head' && !p.dead)).toBe(true);
      expect(dead.length).toBe(2);
      expect(dead.every(p => p.limb === 'torso' && p.dead)).toBe(true);
      expect(b.errors).toEqual([]);
    });
    it(`${name}: applyDeathState swaps the two sets and touches nothing else`, () => {
      const b = build(src);
      const d = applyDeathState(b);
      d.prims.forEach((p, i) => {
        const q = b.prims[i]!;
        if (q.when === 'alive') expect(p.dead).toBe(true);
        else if (q.when === 'dead') expect(p.dead).toBeUndefined();
        else expect(p).toBe(q);
      });
    });
  }
  it('a body without life-state prims comes back as the same object', () => {
    const z = build(zombieSrc);
    expect(hasDeathState(z)).toBe(false);
    expect(applyDeathState(z)).toBe(z);
  });
  it('the fallen hood does not reappear on a severed cluster', () => {
    const b = build(cultistSrc);
    const i = b.prims.findIndex(p => p.when === 'dead');
    const clusters = b.clusters.map(c => (i >= c.start && i < c.start + c.count ? { ...c, alive: false } : c));
    expect(applyDeathState({ ...b, clusters }).prims[i]!.dead).toBe(true);
  });
});

describe('cloth decals cut nothing', () => {
  it('a decal wound on the chest severs no limb; the same wound carved would', () => {
    const b = build(cultistSrc);
    const i = b.prims.findIndex(p => p.limb === 'torso' && !p.shell && p.color !== undefined);
    const p = b.prims[i]!;
    const w = { primIdx: i, local: [0, 0, 0] as [number, number, number], radius: 0.07, type: 'blast' as const, ageSec: 0, severRadius: 0.6 };
    const torsoC = b.clusters.find(c => c.limb === 'torso')!.center;
    expect(cutLimbs(b, [w], torsoC).length).toBeGreaterThan(0);
    expect(cutLimbs(b, [{ ...w, decal: true }], torsoC)).toEqual([]);
    expect(p).toBeDefined();
  });
  it('a decal on a SLEEVE still cuts the arm (owner: arms can be shot off)', () => {
    const b = build(cultistSrc);
    const i = b.prims.findIndex(p => p.limb === 'armR' && p.bone === 'upperArm.r');
    const w = { primIdx: i, local: [0, 0, 0] as [number, number, number], radius: 0.07, type: 'blast' as const, ageSec: 0, severRadius: 0.13, decal: true };
    const torsoC = b.clusters.find(c => c.limb === 'torso')!.center;
    expect(cutLimbs(b, [w], torsoC)).toContain('armR');
  });
  it('the hood-down roll does not appear once the head (and its hood) is gone', () => {
    const b = build(cultistSrc);
    const clusters = b.clusters.map(c => (c.limb === 'head' ? { ...c, alive: false } : c));
    const d = applyDeathState({ ...b, clusters });
    expect(d.prims.filter(p => p.when === 'dead').every(p => p.dead)).toBe(true);
  });
});
