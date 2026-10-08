// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-cast.test.ts
//
// The eight ball-headed humanoids' skulls, made again on the shipped asset and each character's own body: every fit
// of skull-cast.ts BALL_HEADS measures what its entry says, keeps its flesh over the bone, and sits where the entry
// says it sits against the painted eyes.
// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AnatomicalSkullKit } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdBody } from '../../validate';
import { createSkeletonSources } from './contract';
import { headShape } from '../game-zombie-face';
import { BALL_HEADS, HUMANOIDS, ballHeadFit, type SkullFill } from './skull-cast';
import { SKULL_FITS } from './skull-fit';
import { SECOND_PAINT_CHARACTERS } from './sculpt-variant';

const source = anatomicalSkullSource();
const blobOf = (character: string): string => readFileSync(`src/lab/sdf-zombie/characters/${character}.blob`, 'utf8');
const cast = (character: string) => {
  const body = buildBody(compileBlob(parseBlob(blobOf(character))), DEFAULT_BUILD_OPTS);
  return { body, head: createSkeletonSources(body, bindRig(body), { character }).find(s => s.segment === 'head')! };
};
/** A number of the character's `sheet` block. */
const sheetNumber = (character: string, key: string): number => {
  const block = blobOf(character).split(/^sheet\s*$/m)[1]!;
  return Number(new RegExp(`^\\s+${key}\\s+(-?[\\d.]+)`, 'm').exec(block)![1]);
};

/** The character's skull under its entry's fit, and what it measures. */
function measure(character: string) {
  const { body, head } = cast(character);
  const kit = new AnatomicalSkullKit(source, new THREE.Texture(), new THREE.Vector2(1, 1), ballHeadFit);
  const skull = kit.head(head)!, fit = skull.fit!, flesh = fit.result.affine.flesh;
  const whole = { ...body, bonePrims: [] };
  let cover = Infinity;
  for (const piece of skull.pieces) for (let i = 0; i < piece.positions.length; i += 3) {
    cover = Math.min(cover, -sdBody(head.toWorld([piece.positions[i]!, piece.positions[i + 1]!, piece.positions[i + 2]!]), whole));
  }
  const sheet = head.flesh!.sheet!, entry = BALL_HEADS[character]!;
  const painted = sheet.centre[1] + entry.paintedHs * sheet.axes[1];
  const orbitY = skull.orbits.reduce((sum, o) => sum + o.centre[1], 0) / skull.orbits.length;
  const fill: SkullFill = {
    wide: (fit.max[0] - fit.min[0]) / (2 * flesh.half), deep: (fit.max[2] - fit.min[2]) / (flesh.front + flesh.back),
    cover: cover * 1000, eyesOff: (orbitY - painted) * 1000, moved: fit.result.warp.maxMove * 1000,
  };
  return { skull, fit, fill, head, body, size: [0, 1, 2].map(k => (fit.max[k]! - fit.min[k]!) * 1000) };
}

describe('the eight ball-headed humanoids', () => {
  it('are eight of the thirteen humanoids, and none of them is a character whose bone the sculpted skull is fitted to', () => {
    expect(Object.keys(BALL_HEADS)).toEqual(['cultist', 'cultist-cowled', 'bride', 'female', 'schoolgirl', 'schoolgirl-alt', 'schoolgirl-described', 'bonewalker']);
    for (const name of Object.keys(BALL_HEADS)) {
      expect(HUMANOIDS).toContain(name);
      expect(SECOND_PAINT_CHARACTERS.has(name)).toBe(false);
      expect(ballHeadFit(name)).toBe(BALL_HEADS[name]!.spec);
    }
    for (const name of ['zombie', 'soldier', 'juggernaut', 'clown', 'clown-alt', 'ogre', 'toString']) expect(ballHeadFit(name)).toBeNull();
  });

  it.each(Object.keys(BALL_HEADS))('%s: the fit measures what its entry says, under 6 mm of flesh, with the orbits where the entry puts them', character => {
    const entry = BALL_HEADS[character]!, m = measure(character);
    // What the entry records.
    expect(m.fill.wide).toBeCloseTo(entry.fill.wide, 1);
    expect(Math.abs(m.fill.wide - entry.fill.wide)).toBeLessThan(0.015);
    expect(Math.abs(m.fill.deep - entry.fill.deep)).toBeLessThan(0.015);
    expect(Math.abs(m.fill.cover - entry.fill.cover)).toBeLessThan(0.15);
    expect(Math.abs(m.fill.eyesOff - entry.fill.eyesOff)).toBeLessThan(1.5);
    expect(Math.abs(m.fill.moved - entry.fill.moved)).toBeLessThan(1);
    // PROPERLY FILLED: 0.8 of the head or more each way, unless the entry says why this head stops short.
    if (!entry.short) { expect(m.fill.wide).toBeGreaterThanOrEqual(0.8); expect(m.fill.deep).toBeGreaterThanOrEqual(0.8); }
    else expect(Math.min(m.fill.wide, m.fill.deep)).toBeLessThan(0.8);
    expect(Math.min(m.fill.wide, m.fill.deep)).toBeGreaterThanOrEqual(0.65);
    // No part outside the flesh, and at least the fit's margin of it over every vertex (3 mm is the least any
    // skull in the game keeps).
    expect(m.fill.cover).toBeGreaterThanOrEqual(SKULL_FITS[entry.spec.fit as 'snug'].margin * 1000 - 0.1);
    expect(m.fill.cover).toBeGreaterThanOrEqual(3);
    // The orbits level with the painted eyes (2 mm), unless the entry holds them higher and says why.
    if (!entry.raised) { expect(entry.spec.eyeHs).toBe(entry.paintedHs); expect(Math.abs(m.fill.eyesOff)).toBeLessThanOrEqual(2); }
    else { expect(entry.spec.eyeHs!).toBeGreaterThan(entry.paintedHs); expect(m.fill.eyesOff).toBeGreaterThan(2); }
    // The fit held: no shrink after its passes, nothing turned inside out, and the skull still has a skull's
    // proportions.
    expect(m.fit.result.shrunk).toBe(1);
    expect(m.fit.result.warp.detMin).toBeGreaterThan(0.2);
    const scale = m.fit.result.affine.scale;
    expect(Math.max(...scale) / Math.min(...scale)).toBeLessThanOrEqual(1.15 + 1e-9);
    // Two orbits, an eye seated in each and sized from them.
    expect(m.skull.orbits).toHaveLength(2);
    expect(m.skull.eyes).toHaveLength(2);
  });

  it('the painted eye lines are the characters\' own: a sheet\'s eye row through its projection, the cultists\' ember prims', () => {
    // The eyes' row in each face image, from the bottom of the image (measured on the pixels: the centroid of the
    // eyes' whites; the bride's eyes are blank, ringed by lashes; the three schoolgirls share one image).
    const EYE_ROW: Record<string, number> = { bride: 0.610, female: 0.4755, schoolgirl: 0.3774, 'schoolgirl-alt': 0.3774, 'schoolgirl-described': 0.3774, bonewalker: 0.6427 };
    for (const [character, v] of Object.entries(EYE_ROW)) {
      const hs = (v - sheetNumber(character, 'projCentreY')) / sheetNumber(character, 'projScaleY');
      expect(BALL_HEADS[character]!.paintedHs, character).toBeCloseTo(hs, 2);
    }
    for (const character of ['cultist', 'cultist-cowled']) {
      const { body } = cast(character), frame = headShape(body)!;
      const embers = body.prims.filter(p => p.limb === 'head' && (p.glow ?? 0) > 0);
      expect(embers).toHaveLength(2);
      for (const p of embers) expect(BALL_HEADS[character]!.paintedHs).toBeCloseTo(((p.a[1] + p.b[1]) / 2 - frame.centre[1]) / frame.axes[1], 2);
    }
  });

  it('the face sheet\'s frame the eye line is read in is the game\'s own (the fattest head prim), in the head segment\'s frame', () => {
    for (const character of HUMANOIDS) {
      const { body, head } = cast(character), game = headShape(body)!, sheet = head.flesh!.sheet!;
      const world = head.toWorld(sheet.centre);
      for (let k = 0; k < 3; k++) { expect(world[k]!).toBeCloseTo(game.centre[k]!, 9); expect(sheet.axes[k]!).toBeCloseTo(game.axes[k]!, 12); }
    }
  });
});
