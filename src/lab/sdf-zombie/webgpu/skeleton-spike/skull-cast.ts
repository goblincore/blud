// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-cast.ts
//
// The cast's skulls: which humanoids draw the anatomical skull in place of their sculpted head bone, and how it is fitted to each.
//
// THE THIRTEEN HUMANOIDS can each draw the anatomical skull (HUMANOIDS). By default eight of them do (BALL_HEADS):
// the ones whose head bone was authored as a ball over a jaw ball, or a column of beads, 48 to 112 mm wide, for the
// SDF bone tubes and not as a skull. With the face shot away their sculpted "skull" is those balls. The other five
// have a skull-sized head bone and draw it, sculpted (sculpt-variant.ts): the zombie and the soldier carved, the
// juggernaut and the two clowns under the second paint.
//
// "PROPERLY FILLED" is judged per character, by numbers and by looking (docs/dev-notes/2026-10-07-sculpt-skull-2/
// NOTES.md has the photographs and what still looks wrong). Each entry is the fit that was chosen and what it
// measures on the shipped asset and that character's flesh; skull-cast.test.ts makes the fit again and holds the
// numbers.
//
// Pure: names and numbers. The fit itself is skull-fit.ts; the kit that runs it is anatomical-skull.ts.
import type { SkullFitSpec } from './skull-fit';

/** The humanoids the anatomical skull can be fitted to. */
export const HUMANOIDS = [
  'zombie', 'soldier', 'cultist', 'cultist-cowled', 'bride', 'female', 'schoolgirl', 'schoolgirl-alt', 'schoolgirl-described',
  'clown', 'clown-alt', 'juggernaut', 'bonewalker',
] as const;

/** What a chosen fit measures on its character, at rest. Lengths in millimetres. */
export interface SkullFill {
  /** The skull's box as a share of the flesh head, across and front to back (the flesh as the fit measures it,
   *  through the head's deepest point: skull-fit.ts measureFlesh). */
  wide: number;
  deep: number;
  /** The least flesh over any vertex of the skull (the whole body's flesh). */
  cover: number;
  /** How far the orbits' centres stand above (+) or below (-) the painted eyes. */
  eyesOff: number;
}

export interface BallHead {
  /** The fit. */
  spec: Readonly<SkullFitSpec>;
  /** Where `spec.eyeHs` was read: the painted eyes' place on the face. */
  eyes: string;
  /** What the fit measures (skull-cast.test.ts). */
  fill: Readonly<SkullFill>;
  /** Why a share under 0.8 is as far as this head goes, where one is. */
  short?: string;
}

/** THE EIGHT that draw the anatomical skull by default, each with its fit.
 *
 *  Every one is `snug` (both stages of the fit to the flesh, 6 mm of flesh kept over every vertex) with THE ORBITS
 *  HELD ON THE PAINTED EYES: the named fit reads the eye line off the head's bone envelope, and these heads' bones
 *  say nothing of where the face is (the female's reaches up into her bun: her skull sat 47 mm high and dented her
 *  forehead; the cultists' ember eyes are 28 mm over their bone's line). `eyeHs` is the painted eyes' height in the
 *  face sheet's own units (HeadFlesh.sheet): for a sheet, (the eyes' row in the image, from the bottom, - projCentreY)
 *  / projScaleY of the character's `sheet` block; for the cultists, whose eyes are prims, the ember prims' height.
 *  `tight` (3 mm kept) was not taken: it fills 3 to 8 points more and leaves the sculpted skulls' own thinnest
 *  cover over broad parts of these crania, and `snug` already reaches 0.8 where the head's shape allows. */
export const BALL_HEADS: Readonly<Record<string, BallHead>> = {
  cultist: {
    spec: { fit: 'snug', eyeHs: -0.139 },
    eyes: 'the ember prims in the hood (cultist.blob: at=0.50 on the skull bone)',
    fill: { wide: 0.85, deep: 0.83, cover: 6.0, eyesOff: -2 },
  },
  'cultist-cowled': {
    spec: { fit: 'snug', eyeHs: -0.139 },
    eyes: 'the ember prims in the cowl (cultist-cowled.blob)',
    fill: { wide: 0.86, deep: 0.80, cover: 6.1, eyesOff: -1 },
  },
  bride: {
    spec: { fit: 'snug', eyeHs: -0.225 },
    eyes: 'bride-face.png: the lash-ringed eyes at v 0.610',
    fill: { wide: 0.90, deep: 0.92, cover: 6.2, eyesOff: -1 },
  },
  female: {
    spec: { fit: 'snug', eyeHs: 0.111 },
    eyes: 'female-face.png: the eyes\' whites at v 0.4755',
    fill: { wide: 0.90, deep: 0.90, cover: 6.0, eyesOff: -1 },
  },
};

/** How `character`'s default skull is fitted; null for a character that draws its sculpted bone. */
export function ballHeadFit(character: string): Readonly<SkullFitSpec> | null {
  return Object.hasOwn(BALL_HEADS, character) ? BALL_HEADS[character]!.spec : null;
}
