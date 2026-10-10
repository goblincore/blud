// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-tables.test.ts
//
// WHICH SKULL EACH CHARACTER DRAWS is spread over tables kept in step by hand: the humanoids the plates can be
// fitted to (skull-cast.ts HUMANOIDS, anatomical-skull.ts HUMANOID_SKULLS), the eight that draw them by default
// (BALL_HEADS), the characters the second paint is fitted to (sculpt-variant.ts SECOND_PAINT_CHARACTERS), the
// characters a sculpt carves (mesh-skull.ts meshBoneSource) and the envelope fit's per-character fractions
// (skullFitMatrix). This file reads the REAL sets and the real registry, and fails on any disagreement between what
// the resolver says a character draws and what the kit built from its answer will draw.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { characterNames } from '../../character-registry';
import { AnatomicalSkullKit, HUMANOID_SKULLS, skullFitMatrix } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import type { BoneFieldSource } from './contract';
import { meshBoneSource } from './mesh-skull';
import { BALL_HEADS, HUMANOIDS, ballHeadFit } from './skull-cast';
import { SECOND_PAINT_CHARACTERS, anatomicalFitOf, resolveSkull, sculptPaintOf } from './sculpt-variant';

const REGISTERED = [...characterNames()];
const QUERIES = ['', '?skull=sculpt', '?sculpt=classic', '?sculpt=full', '?skull=anatomical', '?skull=anatomical&skullfit=snug', '?skullfit=tight', '?skull=nonsense'];
/** A head source of `character`, as far as the tables read one: its name, its segment and a bone box. */
const headOf = (character: string): BoneFieldSource => ({
  character, segment: 'head', kind: 'bone', revision: `${character}:head:test`, rigidity: 'rigid',
  bounds: { min: [-0.08, -0.1, -0.09], max: [0.08, 0.1, 0.09] }, distance: () => 1, isLive: () => true,
} as unknown as BoneFieldSource);
/** The characters a sculpt carves: meshBoneSource hands back another source for their head. */
const carvedBy = (shape: 1 | 2) => REGISTERED.filter((c) => { const head = headOf(c); return meshBoneSource(head, shape) !== head; });

describe('the skull tables agree with each other and with the registry', () => {
  it('every name in every table is a registered character', () => {
    for (const name of [...HUMANOIDS, ...HUMANOID_SKULLS, ...Object.keys(BALL_HEADS), ...SECOND_PAINT_CHARACTERS]) expect(REGISTERED, name).toContain(name);
    expect([...HUMANOID_SKULLS].sort()).toEqual([...HUMANOIDS].sort());
  });

  it('THE DEFAULT PAGE PARTITIONS THE HUMANOIDS: each draws the plates under its own fit, or a carved sculpt, or its plain bone under the second paint, and exactly one of them', () => {
    const plates = Object.keys(BALL_HEADS), carved = carvedBy(2), painted = [...SECOND_PAINT_CHARACTERS].filter(c => !carved.includes(c));
    // The sets as they are, read from the code (the first sculpt carves the same characters as the second).
    expect(carved.sort()).toEqual(carvedBy(1).sort());
    expect(carved.sort()).toEqual(['juggernaut', 'soldier', 'zombie']);   // the juggernaut wears the soldier's head (isSoldierHead)
    for (const c of carved) expect(SECOND_PAINT_CHARACTERS.has(c), c).toBe(true);
    // No name in two parts, none left over, none from outside.
    const all = [...plates, ...carved, ...painted];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...HUMANOIDS].sort());
    // A character the plates are drawn on is not one the second paint was fitted to (its bone is not what shows).
    for (const c of plates) expect(SECOND_PAINT_CHARACTERS.has(c), c).toBe(false);
    // And the resolver's default answer is that partition's first part, each under the table's own spec.
    const choice = resolveSkull('');
    expect(Object.keys(choice.anatomical).sort()).toEqual([...plates].sort());
    for (const c of plates) { expect(choice.anatomical[c], c).toBe(BALL_HEADS[c]!.spec); expect(ballHeadFit(c), c).toBe(BALL_HEADS[c]!.spec); }
    for (const c of REGISTERED) expect(sculptPaintOf(choice.recipe, c), c).toBe(SECOND_PAINT_CHARACTERS.has(c) ? 2 : 1);
  });

  it.each(QUERIES)('%j: for EVERY registered character, what the resolver reports is what the kit built from it draws', (search) => {
    const choice = resolveSkull(search);
    const kit = new AnatomicalSkullKit(anatomicalSkullSource(), new THREE.Texture(), new THREE.Vector2(1, 1), character => anatomicalFitOf(choice, character));
    for (const character of REGISTERED) {
      const reported = Object.hasOwn(choice.anatomical, character) ? choice.anatomical[character]! : null;
      // The resolver's own lookup, the kit's plan, and whether the kit takes the character's head.
      expect(anatomicalFitOf(choice, character), character).toBe(reported);
      expect(kit.fitOf(character), `${character}: the resolver reports ${reported ? `the plates (${reported.fit})` : 'the sculpted bone'}`).toBe(reported);
      expect(kit.supports(headOf(character)), character).toBe(reported !== null);
      // Only a head is ever the plates'.
      expect(kit.supports({ ...headOf(character), segment: 'torso' } as BoneFieldSource), character).toBe(false);
    }
    // Nobody is reported who is not a humanoid the plates can be fitted to: the kit would refuse them.
    for (const character of Object.keys(choice.anatomical)) expect(HUMANOID_SKULLS.has(character), character).toBe(true);
    kit.dispose();
  });

  it('a name added to the eight and not to the humanoids would be reported as plates and drawn as sculpt: the kit refuses it, and this file\'s comparison is what catches it', () => {
    const kit = new AnatomicalSkullKit(anatomicalSkullSource(), new THREE.Texture(), new THREE.Vector2(1, 1), character => (character === 'ogre' ? { fit: 'snug' } : ballHeadFit(character)));
    expect(HUMANOID_SKULLS.has('ogre')).toBe(false);
    expect(kit.fitOf('ogre')).toBeNull();
    expect(kit.supports(headOf('ogre'))).toBe(false);
    kit.dispose();
  });

  it('the envelope fit\'s own fractions are for characters it can be fitted to', () => {
    const raw = new THREE.Box3(new THREE.Vector3(-0.07, -0.1, -0.09), new THREE.Vector3(0.07, 0.1, 0.09));
    const bounds = headOf('x').bounds, plain = skullFitMatrix(bounds, raw, 'cultist').elements.join();
    // Which registered characters the envelope fit sizes or places differently from the rest.
    const special = REGISTERED.filter(c => skullFitMatrix(bounds, raw, c).elements.join() !== plain);
    expect(special.sort()).toEqual(['female', 'zombie']);
    for (const c of special) expect(HUMANOID_SKULLS.has(c), c).toBe(true);
  });
});
