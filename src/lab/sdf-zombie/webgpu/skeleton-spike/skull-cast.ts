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
  /** The skull's box as a share of the head it was fitted to, across and front to back (the head's skin as the
   *  fit measures it, through its deepest point: skull-fit.ts measureFlesh). */
  wide: number;
  deep: number;
  /** The least flesh over any vertex of the skull (the whole body's flesh). */
  cover: number;
  /** How far the orbits' centres stand above (+) or below (-) the painted eyes. */
  eyesOff: number;
  /** The furthest the fit's second stage moved a vertex to keep it under the flesh. */
  moved: number;
}

export interface BallHead {
  /** The fit. */
  spec: Readonly<SkullFitSpec>;
  /** The painted eyes' height on the face, in the face sheet's units (HeadFlesh.sheet), and where it was read. */
  paintedHs: number;
  eyes: string;
  /** What the fit measures (skull-cast.test.ts makes it again and holds these). */
  fill: Readonly<SkullFill>;
  /** Why a share under 0.8 is as far as this head goes, where one is. */
  short?: string;
  /** Why the orbits are held above the painted eyes, where they are. */
  raised?: string;
}

/** THE EIGHT that draw the anatomical skull by default, each with its fit.
 *
 *  Every one is `snug` (both stages of the fit to the flesh, 6 mm of flesh kept over every vertex), fitted to the
 *  head's SKIN (`skin`: its flesh without the painted prims, so a bob, a bun or a cap of hair modelled as ordinary
 *  prims is not head to the skull), with THE ORBITS HELD ON AN EYE LINE OF THE FACE (`eyeHs`), not on the one the
 *  named fit reads off the bone envelope: these heads' bones say nothing of where the face is (the female's reaches
 *  up into her bun, and her skull sat 47 mm high and dented her forehead; the cultists' ember eyes are 28 mm over
 *  their bone's line).
 *
 *  `paintedHs` is the painted eyes' height in the face sheet's own units: for a sheet, (the eyes' row in the image,
 *  from the bottom, - projCentreY) / projScaleY of the character's `sheet` block; for the cultists, whose eyes are
 *  prims, the ember prims' height. On five of the eight the orbits are held exactly there. THE THREE SCHOOLGIRLS'
 *  ARE NOT: theirs are a cartoon's faces, small and low on a tall head (the eyes 25 to 60 mm over the chin's
 *  bottom, under 200 mm of cranium), and a human skull has its orbits at mid height. Held on those eyes the skull is
 *  47 to 76 mm wide, a quarter to a half of the head; so each is held at the lowest line where it still fills 0.8
 *  of the skin head's width, and its orbits stand over the painted eyes by what `eyesOff` says. They still look
 *  wrong: teeth behind the painted eyes.
 *
 *  `tight` (3 mm kept) was not taken: it fills 3 to 6 points more and leaves the sculpted skulls' own thinnest cover
 *  over broad parts of these crania. */
export const BALL_HEADS: Readonly<Record<string, BallHead>> = {
  cultist: {
    spec: { fit: 'snug', skin: true, eyeHs: -0.139 }, paintedHs: -0.139,
    eyes: 'the ember prims in the hood (cultist.blob: at=0.50 on the skull bone)',
    fill: { wide: 0.85, deep: 0.81, cover: 6.1, eyesOff: -0.9, moved: 17.3 },
  },
  'cultist-cowled': {
    spec: { fit: 'snug', skin: true, eyeHs: -0.139 }, paintedHs: -0.139,
    eyes: 'the ember prims in the cowl (cultist-cowled.blob)',
    fill: { wide: 0.85, deep: 0.796, cover: 6.1, eyesOff: -0.8, moved: 16.8 },
    short: 'a hair under 0.8 front to back: the head is 236 mm deep under the cowl, and held on the eye line the skull is as deep as its 6 mm of cover at the brow and the back lets it be',
  },
  bride: {
    spec: { fit: 'snug', skin: true, eyeHs: -0.225 }, paintedHs: -0.225,
    eyes: 'bride-face.png: the blank eyes ringed by lashes, at v 0.610',
    fill: { wide: 0.90, deep: 0.90, cover: 6.5, eyesOff: -1.1, moved: 14.4 },
  },
  female: {
    spec: { fit: 'snug', skin: true, eyeHs: 0.111 }, paintedHs: 0.111,
    eyes: 'female-face.png: the eyes\' whites, at v 0.4755',
    fill: { wide: 0.82, deep: 0.83, cover: 6.1, eyesOff: -1.0, moved: 13.2 },
  },
  schoolgirl: {
    spec: { fit: 'snug', skin: true, eyeHs: -0.3 }, paintedHs: -0.959,
    eyes: 'schoolgirl-face.png: the eyes\' whites, at v 0.3774',
    fill: { wide: 0.85, deep: 0.83, cover: 6.3, eyesOff: 66.3, moved: 6.1 },
    raised: 'a cartoon face: the eyes are 25 mm over the chin\'s bottom; on them the skull is 47 mm wide',
  },
  'schoolgirl-alt': {
    spec: { fit: 'snug', skin: true, eyeHs: -0.3 }, paintedHs: -0.826,
    eyes: 'schoolgirl-alt-face.png (the schoolgirl\'s image): the eyes\' whites, at v 0.3774',
    fill: { wide: 0.83, deep: 0.82, cover: 6.1, eyesOff: 48.9, moved: 5.8 },
    raised: 'the schoolgirl\'s face on a head of her proportions',
  },
  'schoolgirl-described': {
    spec: { fit: 'snug', skin: true, eyeHs: -0.2 }, paintedHs: -0.438,
    eyes: 'schoolgirl-described-face.png (the schoolgirl\'s image): the eyes\' whites, at v 0.3774',
    fill: { wide: 0.81, deep: 0.75, cover: 6.3, eyesOff: 21.3, moved: 9.4 },
    raised: 'the schoolgirl\'s face, less low: on the eyes the skull is 76 mm wide, 0.56 of the head',
    short: 'held as low as 0.8 of the width allows, the skull is 0.75 of the head front to back',
  },
  bonewalker: {
    spec: { fit: 'snug', skin: true, eyeHs: 0.218 }, paintedHs: 0.218,
    eyes: 'bonewalker-face.png: the pale eyes, at v 0.6427',
    fill: { wide: 0.75, deep: 0.68, cover: 6.0, eyesOff: -0.9, moved: 13.6 },
    short: 'a narrow head with a muzzle, 122 mm wide and 198 mm deep, its eyes high under the horns: the skull is as wide as the temples let it be there, and a skull\'s proportions keep it from reaching down the muzzle',
  },
};

/** How `character`'s default skull is fitted; null for a character that draws its sculpted bone. */
export function ballHeadFit(character: string): Readonly<SkullFitSpec> | null {
  return Object.hasOwn(BALL_HEADS, character) ? BALL_HEADS[character]!.spec : null;
}
