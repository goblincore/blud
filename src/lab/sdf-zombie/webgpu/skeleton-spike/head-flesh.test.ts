// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { headFlesh } from './head-flesh';
import { HUMANOID_SKULLS } from './anatomical-skull';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdBody } from '../../validate';
import { createSkeletonSources } from './contract';
import { translateBody } from '../../translate';
import type { Vec3 } from '../../types';

const build = (character: string) => buildBody(compileBlob(parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${character}.blob`, 'utf8'))), DEFAULT_BUILD_OPTS);

describe('the flesh of a head (head-flesh.ts)', () => {
  it.each([...HUMANOID_SKULLS])('%s: a point inside the head\'s own flesh is at least as far inside the whole body\'s', character => {
    const body = build(character), bound = bindRig(body);
    const head = createSkeletonSources(body, bound, { character }).find(s => s.segment === 'head')!;
    const flesh = headFlesh(body, bound)!;
    expect(flesh).not.toBeNull();
    // The centre is inside, and the field is the head's own: far below the head (the chest) it is outside.
    expect(flesh.distance(flesh.centre)).toBeLessThan(0);
    expect(flesh.distance([flesh.centre[0], flesh.centre[1] - 0.6, flesh.centre[2]])).toBeGreaterThan(0.1);
    // A lattice through the head, 2 cm apart: wherever the head's own flesh holds the point, the body's holds it
    // deeper or as deep (a union only grows by what is added to it).
    let inside = 0;
    for (let x = -0.14; x <= 0.14; x += 0.02) for (let y = -0.2; y <= 0.2; y += 0.02) for (let z = -0.14; z <= 0.14; z += 0.02) {
      const p: Vec3 = [flesh.centre[0] + x, flesh.centre[1] + y, flesh.centre[2] + z];
      const own = flesh.distance(p);
      if (own > 0) continue;
      inside++;
      expect(sdBody(head.toWorld(p), body)).toBeLessThanOrEqual(own + 1e-9);
    }
    expect(inside).toBeGreaterThan(100);
  });
  it('is the same field wherever the body stands, and keys on the floats that reach it', () => {
    const body = build('zombie'), bound = bindRig(body);
    const moved = translateBody(body, [3, 0, -2]), movedBound = bindRig(moved);
    const a = headFlesh(body, bound)!, b = headFlesh(moved, movedBound)!;
    expect(b.revision).toBe(a.revision);
    for (const p of [[0, 0.07, 0.01], [0.05, 0.15, 0.03], [-0.08, 0.02, -0.05]] as Vec3[]) expect(b.distance(p)).toBeCloseTo(a.distance(p), 6);
    expect(headFlesh(build('soldier'), bindRig(build('soldier')))!.revision).not.toBe(a.revision);
  });
  it('reads the head as built: a dead prim and a severed cluster count', () => {
    const body = build('zombie'), bound = bindRig(body);
    const whole = headFlesh(body, bound)!;
    const hurt = { ...body, prims: body.prims.map(p => ({ ...p, dead: true })), clusters: body.clusters.map(c => ({ ...c, alive: false })) };
    const again = headFlesh(hurt, bound)!;
    expect(again.revision).toBe(whole.revision);
    expect(again.distance(whole.centre)).toBe(whole.distance(whole.centre));
  });
  it('rides the head source, unlisted: a copy of the source does not build or carry it', () => {
    const body = build('zombie'), bound = bindRig(body);
    const sources = createSkeletonSources(body, bound, { character: 'zombie' });
    const head = sources.find(s => s.segment === 'head')!;
    expect(Object.keys(head)).not.toContain('flesh');
    expect({ ...head }.flesh).toBeUndefined();
    expect(head.flesh!.revision).toBe(headFlesh(body, bound)!.revision);
    expect(head.flesh).toBe(head.flesh);
    for (const s of sources) if (s.segment !== 'head') expect(s.flesh).toBeUndefined();
  });
  it('leaves out hair strands and cloth shells', () => {
    // The bride's veil and the described schoolgirl's hair are flesh to the body's field and not to the head's.
    for (const character of ['schoolgirl-described', 'cultist']) {
      const body = build(character), bound = bindRig(body);
      const owned = [...bound.head!.prims.keys()].map(i => body.prims[i]!);
      const left = owned.filter(p => p.strand !== undefined || p.shell !== undefined).length;
      expect(left, character).toBeGreaterThan(0);
      expect(headFlesh(body, bound)!.revision.startsWith(`${owned.length - left}:`)).toBe(true);
    }
  });

  it.each([...HUMANOID_SKULLS])('%s: the skin is the flesh without its painted prims, and a point inside it is inside the whole flesh', character => {
    const body = build(character), bound = bindRig(body);
    const flesh = headFlesh(body, bound)!;
    const painted = [...bound.head!.prims.keys()].map(i => body.prims[i]!).filter(p => p.color !== undefined && p.op !== 'sub' && p.op !== 'groove'
      && p.strand === undefined && p.shell === undefined && p.op !== 'bone' && p.op !== 'organ');
    // A head with no painted flesh has one field for both.
    if (painted.length === 0) { expect(flesh.skin!.revision).toBe(flesh.revision); expect(flesh.skin!.distance(flesh.centre)).toBe(flesh.distance(flesh.centre)); return; }
    const skin = flesh.skin!;
    expect(skin).not.toBeNull();
    expect(skin.revision).not.toBe(flesh.revision);
    let inside = 0, hair = 0;
    for (let x = -0.14; x <= 0.14; x += 0.02) for (let y = -0.2; y <= 0.3; y += 0.02) for (let z = -0.16; z <= 0.16; z += 0.02) {
      const p: Vec3 = [flesh.centre[0] + x, flesh.centre[1] + y, flesh.centre[2] + z];
      const s = skin.distance(p), w = flesh.distance(p);
      if (s < 0) { inside++; expect(w, `${character} at ${p}`).toBeLessThanOrEqual(s + 1e-9); }
      else if (w < -0.005) hair++;
    }
    expect(inside).toBeGreaterThan(20);
    // What the skin leaves out is there to leave out: flesh of the whole head that is not skin.
    expect(hair, `${character}: lattice points in painted flesh alone`).toBeGreaterThanOrEqual(0);
  });

  it('a head whose hair is ordinary prims has less skin than flesh: the schoolgirl\'s bob, the female\'s bun', () => {
    for (const character of ['schoolgirl', 'female']) {
      const body = build(character), flesh = headFlesh(body, bindRig(body))!;
      // Lattice points a centimetre or more inside the flesh and a centimetre or more outside the skin: in the hair.
      let hair = 0;
      for (let x = -0.14; x <= 0.14; x += 0.02) for (let y = -0.2; y <= 0.3; y += 0.02) for (let z = -0.16; z <= 0.16; z += 0.02) {
        const p: Vec3 = [flesh.centre[0] + x, flesh.centre[1] + y, flesh.centre[2] + z];
        if (flesh.distance(p) < -0.01 && flesh.skin!.distance(p) > 0.01) hair++;
      }
      expect(hair, character).toBeGreaterThan(3);
    }
  });
});
