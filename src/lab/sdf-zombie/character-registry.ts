// src/lab/sdf-zombie/character-registry.ts
//
// THE list of characters: blob source, polygon kit, face sheet, motion
// profile. Pure data — no THREE, no side effects, no I/O beyond the ?raw
// imports — so it is directly testable.
//
// WHY DATA IS SPLIT FROM RUNTIME. Every recorded bug in this area is a LOOKUP
// MISS, not a rendering fault: lab-main renders the zombie for any character
// not hand-listed in it; bench-main duplicates the face table; the soldier
// shoot-back plan was about to hand-write a fourth copy in game-main. Four
// registries, keyed by the same strings, maintained in three files. This is
// one list, and characterEntry() THROWS on a miss so the next one is loud.
//
// The URL-param guard is a different thing and stays: ?character=garbage must
// fall back gracefully, which is what hasCharacter() is for. The bug this
// fixes is a character that EXISTS as a .blob and was never registered.
import zombieBlobSrc from './characters/zombie.blob?raw';
import goblinBlobSrc from './characters/goblin.blob?raw';
import clownBlobSrc from './characters/clown.blob?raw';
import clownAltBlobSrc from './characters/clown-alt.blob?raw';
import mouseBlobSrc from './characters/mouse.blob?raw';
import cyclopsBlobSrc from './characters/cyclops.blob?raw';
import schoolgirlBlobSrc from './characters/schoolgirl.blob?raw';
import schoolgirlAltBlobSrc from './characters/schoolgirl-alt.blob?raw';
import schoolgirlDescribedBlobSrc from './characters/schoolgirl-described.blob?raw';
import strandFixtureBlobSrc from './characters/strand-fixture.blob?raw';
import bonewalkerBlobSrc from './characters/bonewalker.blob?raw';
import dragonBlobSrc from './characters/dragon.blob?raw';
import boxFixtureBlobSrc from './characters/box-fixture.blob?raw';
// The blob:draft first pass and the round-1 hand-authored scaffold it is
// judged against (dispatch/blobforge-task-10 A/B; minotaur-r1 is untracked
// and may come and go with the comparison).
import minotaurBlobSrc from './characters/minotaur.blob?raw';
import soldierBlobSrc from './characters/soldier.blob?raw';
import femaleBlobSrc from './characters/female.blob?raw';
import gargoyleBlobSrc from './characters/gargoyle.blob?raw';
import cyberdemonBlobSrc from './characters/cyberdemon.blob?raw';
import bloatmawBlobSrc from './characters/bloatmaw.blob?raw';
import gnasherBlobSrc from './characters/gnasher.blob?raw';
import cyberbrideBlobSrc from './characters/cyberbride.blob?raw';
import {
  ZOMBIE_PROFILE, SOLDIER_PROFILE, motionProfileFor, type MotionProfile,
} from './motion-profile';

/** A face sheet's texture and its crop. `mean` is the level the shader
 *  divides out (`tex.rgb / faceCfg2.y`), so a wrong one shifts the whole
 *  head's brightness — it must be MEASURED off the file, never guessed. */
export interface FaceSheet {
  url: string;
  /** TOP-LEFT pixel coords: [x, y, w, h, sheetW, sheetH]. */
  rect: [number, number, number, number, number, number];
  mean: number;
}

export interface CharacterEntry {
  name: string;
  /** The .blob source text. */
  src: string;
  /** Compiled polygon kit (armour, clothing, hard props), if any. Absent
   *  means flesh only. A kit RIDES THE RIG — see character-view's pose():
   *  every frame the hero loop re-poses it from rig-frames.ts's per-bone
   *  transforms (see the `kit?.pose(frames)` call). */
  kit?: string;
  /** The face sheet the character wears when its own `sheet` block does not
   *  produce one — its baked PNG where it has one (the sheet block's `image`
   *  line names the same file), else the shared zombie flat. Multiplier-vs-
   *  decal mode is the sheet block's `decal` line, decided at runtime; this
   *  is only pixels, a crop and a declared mean. The face step measures the
   *  real mean off the decoded pixels, so `mean` here is the declared value,
   *  never the render value. */
  face: FaceSheet;
  /** The motion profile this character moves with. Profiles live in
   *  motion-profile.ts; this records WHICH one. Characters without a bespoke
   *  profile get motionProfileFor(name) — the zombie default. */
  profile: MotionProfile;
  /**
   * Flesh opacity for the forward SDF layer's ghost pass, 0..1. Absent = 1 =
   * exactly the historical opaque composite. Below 1, the character's body
   * marches into the ghost target and composites with src-alpha blending, so
   * polygonal content BEHIND the flesh surface (her kit, a wall she backs
   * onto) shows through it — the cyberbride's chrome endoskeleton seen
   * through skin. Pure data, like everything else here; sdf-layer.ts owns
   * the rendering. Only the forward path honours it (the deferred renderer
   * does not, yet).
   */
  fleshAlpha?: number;
}

// ---------------------------------------------------------------------------
// Face texture sheets. Same three sources as the WebGL lab, same crop rects.
//
// - `zombie-flat` is ORIGINAL art and the shipping candidate: a luminance MASK
//   on neutral mid-grey rather than a picture, so mid-grey divided by the mean
//   comes out at 1.0 and only the features act.
// - `smiley` is a DIAGNOSTIC — flat yellow, a red border on the projected
//   rect, a blue mark top-left. No baked lighting, no alpha, no crop ambiguity,
//   so a misregistration shows you exactly HOW it is wrong.
// - `blood-zombie` is extracted Blood art. DEV PLACEHOLDER, never ships.
//
// `rect` is in TOP-LEFT pixel coordinates: [x, y, w, h, sheetW, sheetH].
// `mean` is MEASURED off the file — it sets the level the multiplier divides
// out, so a stale value shifts the whole head's brightness.
// ---------------------------------------------------------------------------
export type FaceTexName = 'zombie-flat' | 'smiley' | 'blood-zombie';

export const FACE_TEXTURES: Record<FaceTexName, FaceSheet> = {
  'zombie-flat': { url: '/assets/lab/zombie-face.png', rect: [0, 0, 64, 64, 64, 64], mean: 0.406 },
  smiley: { url: '/assets/lab/smiley.png', rect: [0, 0, 64, 64, 64, 64], mean: 0.66 },
  'blood-zombie': {
    url: '/assets/blood-tiles/1200.png',
    rect: [32, 0, 18, 16, 77, 116],
    mean: 0.33,
  },
};

/** The zombie's shared flat sheet — the fallback for any character whose
 *  .blob declares no `sheet` block, which is most of them. */
const ZOMBIE_FLAT: FaceSheet = FACE_TEXTURES['zombie-flat'];

/** A character's baked face PNG, whole-image (every bake ships 512×512), the
 *  same file the character's `sheet image` line names under
 *  /assets/lab/faces/. mean 1 is the documented pre-measurement fallback —
 *  MEASURE THIS off the PNG before trusting it; the face step re-measures off
 *  the decoded pixels, which is how lab-main and bench-main both behave. */
function bakedFace(file: string): FaceSheet {
  return { url: `/assets/lab/faces/${file}`, rect: [0, 0, 512, 512, 512, 512], mean: 1 };
}

/**
 * Every authored .blob character, by the name you pass as `?character=`.
 *
 * The lab hardcoded zombie.blob until the first port (goblin) had nowhere to be
 * looked at — and a character you cannot see is one you cannot judge, which is
 * the whole reason the turntable exists.
 */
export const CHARACTERS: Readonly<Record<string, CharacterEntry>> = {
  zombie: {
    name: 'zombie', src: zombieBlobSrc, face: ZOMBIE_FLAT,
    profile: ZOMBIE_PROFILE,
  },
  goblin: {
    name: 'goblin', src: goblinBlobSrc,
    kit: '/assets/lab/goblin-kit.gltf',
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('goblin'),
  },
  clown: {
    name: 'clown', src: clownBlobSrc,
    kit: '/assets/lab/clown-kit.gltf',
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('clown'),
  },
  'clown-alt': {
    name: 'clown-alt', src: clownAltBlobSrc,
    kit: '/assets/lab/clown-alt-kit.gltf',
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('clown-alt'),
  },
  // No mouse: its whole outfit is painted SDF geometry (color= on prims).
  mouse: {
    name: 'mouse', src: mouseBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('mouse'),
  },
  cyclops: {
    name: 'cyclops', src: cyclopsBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('cyclops'),
  },
  schoolgirl: {
    name: 'schoolgirl', src: schoolgirlBlobSrc,
    face: bakedFace('schoolgirl-face.png'),
    profile: motionProfileFor('schoolgirl'),
  },
  'schoolgirl-alt': {
    name: 'schoolgirl-alt', src: schoolgirlAltBlobSrc,
    face: bakedFace('schoolgirl-alt-face.png'),
    profile: motionProfileFor('schoolgirl-alt'),
  },
  'schoolgirl-described': {
    name: 'schoolgirl-described', src: schoolgirlDescribedBlobSrc,
    face: bakedFace('schoolgirl-described-face.png'),
    profile: motionProfileFor('schoolgirl-described'),
  },
  // Not a character — the strand primitive's acceptance case. See its header.
  'strand-fixture': {
    name: 'strand-fixture', src: strandFixtureBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('strand-fixture'),
  },
  bonewalker: {
    name: 'bonewalker', src: bonewalkerBlobSrc,
    face: bakedFace('bonewalker-face.png'),
    profile: motionProfileFor('bonewalker'),
  },
  dragon: {
    name: 'dragon', src: dragonBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('dragon'),
  },
  'box-fixture': {
    name: 'box-fixture', src: boxFixtureBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('box-fixture'),
  },
  minotaur: {
    name: 'minotaur', src: minotaurBlobSrc,
    // minotaur.blob's sheet block declares `image minotaur-face.png`, but no
    // such file exists under public/assets/lab/faces/ — the lab has been
    // 404ing it silently. Registered as declared: the data must not lie about
    // what the blob asks for. Baking the PNG is its own task (2026-09-06).
    face: bakedFace('minotaur-face.png'),
    profile: motionProfileFor('minotaur'),
  },
  soldier: {
    name: 'soldier', src: soldierBlobSrc,
    kit: '/assets/lab/soldier-kit.gltf',
    // Measured from the original PNG, excluding alpha < 8, exactly like
    // the lab's applyMeanOf. The fallback 1 halved its level in the game.
    face: { ...bakedFace('soldier-face.png'), mean: 0.5035671273079847 },
    profile: SOLDIER_PROFILE,
  },
  female: {
    name: 'female', src: femaleBlobSrc,
    face: bakedFace('female-face.png'),
    profile: motionProfileFor('female'),
  },
  gargoyle: {
    name: 'gargoyle', src: gargoyleBlobSrc,
    // The .blob's sheet block declares gargoyle-face.png — a hand-authored
    // grin decal at MULTIPLY (the reference mesh's UVs repeat, so a face
    // BAKE would sample garbage; see the .blob header). mean is the
    // declared value; the face step re-measures off the decoded pixels.
    face: { url: '/assets/lab/faces/gargoyle-face.png', rect: [0, 0, 512, 512, 512, 512], mean: 1 },
    profile: motionProfileFor('gargoyle'),
  },
  cyberdemon: {
    name: 'cyberdemon', src: cyberdemonBlobSrc,
    // The hard half: the shoulder cowl, the hydraulic ram arm, the back power
    // unit and the left greave/boot. Compiled from characters/cyberdemon-kit.wam
    // by scripts/build-wam-kit.sh; committed as the glTF.
    kit: '/assets/lab/cyberdemon-kit.gltf',
    // The .blob's sheet block declares cyberdemon-face.png — a GENERATED,
    // mouth-only decal at MULTIPLY (there is no reference mesh, so
    // blob:face-bake cannot run; scripts/make-cyberdemon-face.py draws it).
    // mean is the declared value; the face step re-measures off the decoded
    // pixels.
    face: { url: '/assets/lab/faces/cyberdemon-face.png', rect: [0, 0, 512, 512, 512, 512], mean: 1 },
    // The zombie shamble, deliberately: it is the cast's HEAVY walk (long
    // stance duty, low bob, reaching arms), and the brief's "built to close
    // distance" is exactly a heavy body leaning at you. A bespoke march/run
    // profile is a rig/gameplay change, not part of this character's
    // authoring task.
    profile: motionProfileFor('cyberdemon'),
  },
  bloatmaw: {
    name: 'bloatmaw', src: bloatmawBlobSrc,
    // The chains and shackles live in characters/bloatmaw-kit.wam, compiled by
    // scripts/build-wam-kit.sh into public/assets/lab/bloatmaw-kit.gltf.
    kit: '/assets/lab/bloatmaw-kit.gltf',
    // No sheet block and no decal: the maw, teeth, eyes and throat core are
    // geometry, and there is no reference mesh to bake. ZOMBIE_FLAT, per the
    // "never declare an image for a file that does not exist" rule.
    face: ZOMBIE_FLAT,
    // The zombie shamble, deliberately — motionProfileFor falls back to it.
    // This is the first LEGLESS character in the roster, so the walk cycle is
    // asked to drive thigh/shin/foot bones that do not exist; gait.ts's leg()
    // returns zero offsets for a missing chain, so it degrades quietly to the
    // root sway/bob and the arm reach. See the .blob header and the report.
    profile: motionProfileFor('bloatmaw'),
  },
  gnasher: {
    name: 'gnasher', src: gnasherBlobSrc,
    // Flesh in the .blob; the horns and forearm tusks are the kit, compiled
    // from gnasher-kit.wam into a committed glTF (build-wam-kit.sh gnasher).
    // The face stays GEOMETRY (no decal): the maw, teeth and eyes are prims,
    // so `face` is the flat nub and no `image` is declared.
    kit: '/assets/lab/gnasher-kit.gltf',
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('gnasher'),
  },
  cyberbride: {
    name: 'cyberbride', src: cyberbrideBlobSrc,
    // THE CHROME HALF: skull, jaw, ribcage, spine, pelvis and limb bones —
    // a full endoskeleton, compiled from characters/cyberbride-kit.wam by
    // scripts/build-wam-kit.sh into the committed glTF. It renders in the
    // polygonal pass UNDERNEATH the flesh; see fleshAlpha for how it stays
    // visible.
    kit: '/assets/lab/cyberbride-kit.gltf',
    // No sheet block and no decal: the face is the flat zombie MASK (a
    // luminance feature map, not a picture — there is no reference mesh to
    // bake), with two red glow prims in the sockets and a fang row over a
    // dark maw. See the .blob header.
    face: ZOMBIE_FLAT,
    // THE SEE-THROUGH HALF: her flesh composites at this alpha instead of 1,
    // so the chrome endoskeleton ghosts through the skin (the terminator
    // brief). Tuned by eye against the turntable; 1 would hide the kit
    // entirely, much lower and she stops reading as a body at all.
    fleshAlpha: 0.78,
    // The zombie shamble, deliberately — motionProfileFor falls back to it.
    // The machine wears her like a dress and walks her the way the cast
    // walks; a bespoke gait is a rig/gameplay change, not part of this
    // character's authoring task (the cyberdemon precedent).
    profile: motionProfileFor('cyberbride'),
  },
};

export function characterNames(): readonly string[] {
  return Object.keys(CHARACTERS);
}

/** True when `name` is registered. The guard for UNTRUSTED input (URL
 *  params); never throws. */
export function hasCharacter(name: string): boolean {
  return Object.hasOwn(CHARACTERS, name);
}

/** The entry for `name`. THROWS on a miss, deliberately — see the header. */
export function characterEntry(name: string): CharacterEntry {
  const e = CHARACTERS[name];
  if (!e) {
    throw new Error(
      `unknown character '${name}'. Registered: ${characterNames().join(', ')}. `
      + `A .blob that exists but is not registered here renders as the ZOMBIE, `
      + `which is the bug this throw exists to prevent.`,
    );
  }
  return e;
}
