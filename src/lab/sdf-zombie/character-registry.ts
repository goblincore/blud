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
import type { BodyNormalSpec } from './webgpu/body-normal-load';
import zombieBlobSrc from './characters/zombie.blob?raw';
import goblinBlobSrc from './characters/goblin.blob?raw';
import goblinHomeBlobSrc from './characters/goblin-home.blob?raw';
import goblinCinematicBlobSrc from './characters/goblin-cinematic.blob?raw';
import goblinCinematicHomeBlobSrc from './characters/goblin-cinematic-home.blob?raw';
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
import thinFixtureBlobSrc from './characters/thin-fixture.blob?raw';
// The blob:draft first pass and the round-1 hand-authored scaffold it is
// judged against (dispatch/blobforge-task-10 A/B; minotaur-r1 is untracked
// and may come and go with the comparison).
import minotaurBlobSrc from './characters/minotaur.blob?raw';
import soldierBlobSrc from './characters/soldier.blob?raw';
import juggernautBlobSrc from './characters/juggernaut.blob?raw';
import warbullBlobSrc from './characters/warbull.blob?raw';
import femaleBlobSrc from './characters/female.blob?raw';
import gargoyleBlobSrc from './characters/gargoyle.blob?raw';
import cyberdemonBlobSrc from './characters/cyberdemon.blob?raw';
import twinheadBlobSrc from './characters/twinhead.blob?raw';
import butcherBlobSrc from './characters/butcher.blob?raw';
import flayerBlobSrc from './characters/flayer.blob?raw';
import deadeyeBlobSrc from './characters/deadeye.blob?raw';
import gorehoundBlobSrc from './characters/gorehound.blob?raw';
import gutcrawlerBlobSrc from './characters/gutcrawler.blob?raw';
import gibbetBlobSrc from './characters/gibbet.blob?raw';
import chairBlobSrc from './characters/chair.blob?raw';
import gamerBlobSrc from './characters/gamer.blob?raw';
import bloatmawBlobSrc from './characters/bloatmaw.blob?raw';
import teratomaBlobSrc from './characters/teratoma.blob?raw';
import gnasherBlobSrc from './characters/gnasher.blob?raw';
import ogreBlobSrc from './characters/ogre.blob?raw';
import broodmotherBlobSrc from './characters/broodmother.blob?raw';
import cultistBlobSrc from './characters/cultist.blob?raw';
import cultistCowledBlobSrc from './characters/cultist-cowled.blob?raw';
import brideBlobSrc from './characters/bride.blob?raw';
import venusBlobSrc from './characters/venus.blob?raw';
import {
  ZOMBIE_PROFILE, SOLDIER_PROFILE, JUGGERNAUT_PROFILE, WARBULL_PROFILE, TWINHEAD_PROFILE, BUTCHER_PROFILE, FLAYER_PROFILE, DEADEYE_PROFILE, GOREHOUND_PROFILE, GUTCRAWLER_PROFILE, GIBBET_PROFILE, CHAIR_PROFILE, GAMER_PROFILE, motionProfileFor, type MotionProfile,
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
  /** A kit BORROWED for one part: only these materials of `kit` are loaded (kit-overlay.ts KitLoadOpts.only). Absent: all of it. */
  kitOnly?: readonly string[];
  /** The body is this many times the size `kit` was built for (kit-overlay.ts KitLoadOpts.scale). Absent: 1. */
  kitScale?: number;
  /** The kit's `plate` pieces are ARMOUR: hits on them spark, and enough hits
   *  shed the piece (webgpu/kit-damage.ts). Was hard-coded to the soldier. */
  armoured?: boolean;
  /** The face sheet the character wears when its own `sheet` block does not
   *  produce one — its baked PNG where it has one (the sheet block's `image`
   *  line names the same file), else the shared zombie flat. Multiplier-vs-
   *  decal mode is the sheet block's `decal` line, decided at runtime; this
   *  is only pixels, a crop and a declared mean. The face step measures the
   *  real mean off the decoded pixels, so `mean` here is the declared value,
   *  never the render value. */
  face: FaceSheet;
  /** A baked BODY NORMAL MAP (scripts/bake-body-normal.ts; webgpu/body-normal-load.ts): the torso relief the
   *  march does not carry as prims. Absent = none, and the body shades exactly as it did before maps existed. */
  bodyNormal?: BodyNormalSpec;
  /** The motion profile this character moves with. Profiles live in
   *  motion-profile.ts; this records WHICH one. Characters without a bespoke
   *  profile get motionProfileFor(name) — the zombie default. */
  profile: MotionProfile;
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
  // The goblin at home (the screen emergence lab): goblin.blob plus a vest and shorts of SDF `shell` cloth and bare feet, in one
  // marked block (characters/goblin-home.test.ts guards the copy). No kit: the armour stays off at home, and so do the bony
  // kit hands: the at-home poses rest ORB hands on the keys and the floor, so the block carries the orb back (owner,
  // 2026-10-24). The goblin's own motion profile; the lab drives him with the pose layer, which overwrites every target.
  'goblin-home': {
    name: 'goblin-home', src: goblinHomeBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('goblin'),
  },
  // The goblin with the FACE RIG (jaw, teeth, smile morphs, expression clips) and bare eyes, for the cinematic shots
  // (goblin expressions Task 13). The base goblin above keeps its pre-expression head and cost. Same gait, held gun and
  // poses as the goblin (motion-profile.ts and pose-library.ts list it under its own name).
  'goblin-cinematic': {
    name: 'goblin-cinematic', src: goblinCinematicBlobSrc,
    kit: '/assets/lab/goblin-cinematic-kit.gltf',
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('goblin-cinematic'),
  },
  // The cinematic goblin AT HOME (emergence in the Flat, plan Task 4): goblin-cinematic.blob (the face rig) plus goblin-home's cloth
  // block and bare feet, at the goblin's 1.70 m (characters/goblin-cinematic-home.test.ts guards the copy). The armour stays off at
  // home, but the cinematic's mesh TEETH live in its 1.30 m kit (one skinned glTF, the `tooth` primitive beside the armour's), so he
  // borrows that kit's teeth alone (not its bony `goblinskin` hands: at home the orbs stay), scaled by the .blob's own `scale` about each bone (plan Task 4b; characters/
  // goblin-cinematic-home-teeth.test.ts pins them in his mouth). The cinematic's gait, poses and expressions (motion-profile.ts,
  // pose-library.ts, expression-library.ts list it under its own name).
  'goblin-cinematic-home': {
    name: 'goblin-cinematic-home', src: goblinCinematicHomeBlobSrc,
    kit: '/assets/lab/goblin-cinematic-kit.gltf',
    kitOnly: ['tooth'],
    kitScale: 1.3077,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('goblin-cinematic-home'),
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
  'thin-fixture': {
    name: 'thin-fixture', src: thinFixtureBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('thin-fixture'),
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
    armoured: true,
    // Measured from the original PNG, excluding alpha < 8, exactly like
    // the lab's applyMeanOf. The fallback 1 halved its level in the game.
    face: { ...bakedFace('soldier-face.png'), mean: 0.5035671273079847 },
    profile: SOLDIER_PROFILE,
  },
  // The soldier's power-armoured chaingunner variant: soldier.blob scaled
  // (see juggernaut.blob's header) under his own WAM kit. Until
  // scripts/build-wam-kit.sh juggernaut has been run, the kit 404s and
  // character-view renders him undressed (it logs, it does not throw).
  juggernaut: {
    name: 'juggernaut', src: juggernautBlobSrc,
    kit: '/assets/lab/juggernaut-kit.gltf',
    armoured: true,
    // The soldier's baked face and its measured mean: same PNG, same crop.
    face: { ...bakedFace('soldier-face.png'), mean: 0.5035671273079847 },
    profile: JUGGERNAUT_PROFILE,
  },
  // The cyber-minotaur, authored from the owner's reference plate
  // (warbull.blob's header; docs/dev-notes/refs/warbull-reference.png). The
  // hard parts are characters/warbull-kit.wam. Until
  // scripts/build-wam-kit.sh warbull has been run, the kit 404s and he
  // renders as the flesh alone (logged).
  warbull: {
    name: 'warbull', src: warbullBlobSrc,
    kit: '/assets/lab/warbull-kit.gltf',
    // Cropped from the reference plate's head (warbull.blob, sheet block).
    // mean measured off the PNG's opaque texels, lab-main's applyMeanOf rule.
    face: { ...bakedFace('warbull-face.png'), mean: 0.14481547752506288 },
    profile: WARBULL_PROFILE,
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
  // The two-headed strogg conversion (twinhead.blob's header): flesh torso,
  // arms and heads in the .blob, metal pelvis and legs as painted boxes the
  // kit dresses. The face sheet is a blank placeholder: both faces are prims.
  twinhead: {
    name: 'twinhead', src: twinheadBlobSrc,
    // The machinery: Blender parts (assets-source/twinhead-kit/) skinned to the
    // .blob's bones by scripts/blender-kit.ts.
    kit: '/assets/lab/twinhead-kit.gltf',
    // The torso's muscle and surface detail (characters/twinhead.detail, baked; never marched).
    bodyNormal: { url: '/assets/lab/twinhead-body-n.png', meta: '/assets/lab/twinhead-body-n.json', strength: 1 },
    face: bakedFace('twinhead-face.png'),
    profile: TWINHEAD_PROFILE,
  },
  // The zombie conversion (butcher.blob's header): the zombie's flesh, pumped,
  // on digitigrade machine legs with an axe grafted on for a right hand.
  butcher: {
    name: 'butcher', src: butcherBlobSrc,
    // The machinery: Blender parts (assets-source/butcher-kit/) skinned to the
    // .blob's bones by scripts/blender-kit.ts.
    kit: '/assets/lab/butcher-kit.gltf',
    // Muscle and varicose veins on the torso and arms (characters/butcher.detail, baked; never marched).
    bodyNormal: { url: '/assets/lab/butcher-body-n.png', meta: '/assets/lab/butcher-body-n.json', strength: 1 },
    face: bakedFace('butcher-face.png'),
    profile: BUTCHER_PROFILE,
  },
  // The second zombie conversion (flayer.blob's header): the butcher's skeleton
  // and legs, gaunt and flayed, a saw-sickle for a left hand, a visored helmet.
  flayer: {
    name: 'flayer', src: flayerBlobSrc,
    kit: '/assets/lab/flayer-kit.gltf',
    // Ribs, spine and veins on the gaunt torso and arms (characters/flayer.detail, baked; never marched).
    bodyNormal: { url: '/assets/lab/flayer-body-n.png', meta: '/assets/lab/flayer-body-n.json', strength: 1 },
    face: bakedFace('flayer-face.png'),
    profile: FLAYER_PROFILE,
  },
  // The third zombie conversion (deadeye.blob's header): a gunslinger on the
  // butcher's skeleton and legs, a pistol prop, an optic over one eye.
  deadeye: {
    name: 'deadeye', src: deadeyeBlobSrc,
    kit: '/assets/lab/deadeye-kit.gltf',
    // Muscle and veins (characters/deadeye.detail from butcher-detail-gen.ts deadeye; baked, never marched).
    bodyNormal: { url: '/assets/lab/deadeye-body-n.png', meta: '/assets/lab/deadeye-body-n.json', strength: 1 },
    face: bakedFace('deadeye-face.png'),
    profile: DEADEYE_PROFILE,
  },
  // The biomech hound (gorehound.blob's header): a four-legged dog-frog on the
  // biped rig, arms as front legs. Flesh in the .blob; the machine legs, spine
  // ridge, brow plate and teeth are kit (assets-source/gorehound-kit/, built
  // headless by its build.py), skinned to the .blob by scripts/blender-kit.ts.
  gorehound: {
    name: 'gorehound', src: gorehoundBlobSrc,
    kit: '/assets/lab/gorehound-kit.gltf',
    // Folds, ribs, muscle and varicose veins (characters/gorehound.detail, baked round a LENGTHWISE torso axis:
    // scripts/gorehound-detail-gen.ts has the bake command; never marched).
    bodyNormal: { url: '/assets/lab/gorehound-body-n.png', meta: '/assets/lab/gorehound-body-n.json', strength: 1 },
    face: ZOMBIE_FLAT,
    profile: GOREHOUND_PROFILE,
  },
  // The gorehound's variant (gutcrawler.blob's header): legless, dragging
  // itself on two arms, a tail on the `hem` pendulum. Kit: assets-source/gutcrawler-kit/.
  gutcrawler: {
    name: 'gutcrawler', src: gutcrawlerBlobSrc,
    face: ZOMBIE_FLAT,
    profile: GUTCRAWLER_PROFILE,
  },
  // The walking cage (gibbet.blob's header): a bone-metal frame on four long
  // legs, a sac of meat swinging inside on the `hem` pendulum, a head dangling
  // at the front. Kit: assets-source/gibbet-kit/.
  gibbet: {
    name: 'gibbet', src: gibbetBlobSrc,
    kit: '/assets/lab/gibbet-kit.gltf',
    // The sac's folds, striae and varicose veins and the head's (characters/gibbet.detail, baked DOWN the hem
    // pendulum: scripts/gibbet-detail-gen.ts has the bake command; never marched).
    bodyNormal: { url: '/assets/lab/gibbet-body-n.png', meta: '/assets/lab/gibbet-body-n.json', strength: 1 },
    face: ZOMBIE_FLAT,
    profile: GIBBET_PROFILE,
  },
  // The walking throne (chair.blob's header): a man fused seated into a
  // chair of bone and bone-metal, his thighs the seat, his forearms the
  // armrests, his shins the front legs. Kit: assets-source/chair-kit/.
  chair: {
    name: 'chair', src: chairBlobSrc,
    kit: '/assets/lab/chair-kit.gltf',
    // Baked scars, ribs and varicose veins (chair.detail, scripts/seated-detail-gen.ts).
    bodyNormal: { url: '/assets/lab/chair-body-n.png', meta: '/assets/lab/chair-body-n.json', strength: 1 },
    face: ZOMBIE_FLAT,
    profile: CHAIR_PROFILE,
  },
  // The chair's BOSS variant (gamer.blob's header): a swollen man fused into
  // a gaming chair, a VR headset over his eyes, tubes and cables into him,
  // both hands on a joystick of flesh out of his navel. Kit:
  // assets-source/gamer-kit/.
  gamer: {
    name: 'gamer', src: gamerBlobSrc,
    kit: '/assets/lab/gamer-kit.gltf',
    // Baked varicose veins and stretch marks (gamer.detail, scripts/seated-detail-gen.ts).
    // Strength 1.5: the owner wants the veins on his neck, face and the stick "pronounced".
    bodyNormal: { url: '/assets/lab/gamer-body-n.png', meta: '/assets/lab/gamer-body-n.json', strength: 1.5 },
    face: ZOMBIE_FLAT,
    profile: GAMER_PROFILE,
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
  // The cacodemon-style floater (teratoma.blob's header): a flesh ball in the
  // .blob, its folds and veins in the baked body normal map, and the hard parts
  // (horns, teeth, talons, the eye, shackles and chains) Blender kit
  // (assets-source/teratoma-kit/). No face sheet: the eye is kit, the mouth is
  // geometry.
  teratoma: {
    name: 'teratoma', src: teratomaBlobSrc,
    kit: '/assets/lab/teratoma-kit.gltf',
    // The ball's roped folds, veins and nodules (characters/teratoma.detail, baked; never marched).
    bodyNormal: { url: '/assets/lab/teratoma-body-n.png', meta: '/assets/lab/teratoma-body-n.json', strength: 1 },
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('teratoma'),
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
  ogre: {
    name: 'ogre', src: ogreBlobSrc,
    // Belt, hide kilt, breeches, boots and bracers: characters/ogre-kit.wam,
    // compiled by scripts/build-wam-kit.sh ogre; committed as the glTF.
    kit: '/assets/lab/ogre-kit.gltf',
    // The .blob's sheet block declares ogre-face.png — a GENERATED mouth-only
    // decal at MULTIPLY (no reference mesh to bake; scripts/make-ogre-face.py
    // draws it). mean is the declared value; the face step re-measures off
    // the decoded pixels.
    face: { url: '/assets/lab/faces/ogre-face.png', rect: [0, 0, 512, 512, 512, 512], mean: 1 },
    profile: motionProfileFor('ogre'),
  },
  broodmother: {
    name: 'broodmother', src: broodmotherBlobSrc,
    // Flesh only, no kit. The face is GEOMETRY (lips, nose, glowing eyes and
    // spider eyes are prims) on a nubbed face block, so `face` is the flat
    // sheet and no `image` is declared.
    face: ZOMBIE_FLAT,
    // The zombie default. Her eight spider legs map to no gait joint
    // (gait.ts jointNamesForBody), so she has no walk yet — a spider gait
    // is the open follow-up (docs/dev-notes/2026-09-22-broodmother/).
    profile: motionProfileFor('broodmother'),
  },
  cultist: {
    name: 'cultist', src: cultistBlobSrc,
    // Flesh + SHELL CLOTH, no kit: the robe, capelet, hood and bell cuffs are
    // shells in the .blob (the SDF-cloth viability spike — see its header and
    // docs/dev-notes/2026-09-23-cultist/). The face is the gaunt face block
    // with the sheet off; the eyes are glow prims.
    face: ZOMBIE_FLAT,
    // GLIDE on the zombie skeleton (motion-profile.ts CULTIST_PROFILE): the
    // shamble's upper body with short low steps that stay inside the robe.
    profile: motionProfileFor('cultist'),
  },
  // The cultist's face-pass-2 head kept as a variant (owner, 2026-09-23):
  // high cowl + back-tipped hood hide the lower face; no jaw/teeth pass.
  'cultist-cowled': {
    name: 'cultist-cowled', src: cultistCowledBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('cultist'),
  },
  // The bride — Blud's death knight: a pale, lace-dressed swordswoman.
  // docs/superpowers/specs/2026-09-24-bride-sword-enemy-design.md. Flesh,
  // shell cloth and the corpse-makeup face sheet in the .blob (Tasks 1-3);
  // plate arms, pauldron, thigh boots, chains and crosses in the kit
  // (characters/bride-kit.wam, compiled by scripts/build-wam-kit.sh bride;
  // committed as the glTF). ARMOURED like the soldier: her plate sparks and
  // sheds, baring the raw fused seams under it. BRIDE_PROFILE (Task 8):
  // the STALK gait, the sword prop and its guard/trail carries; the sword
  // mind that swings it comes later. The face is GENERATED
  // (scripts/make-bride-face.py) and worn at rgb multiply. mean is MEASURED off the PNG (the painter prints it): the lab
  // re-measures off the decoded pixels, but the game uses this value as is,
  // and bakedFace's fallback of 1 would darken her whole face ~28% there.
  bride: {
    name: 'bride', src: brideBlobSrc,
    kit: '/assets/lab/bride-kit.gltf',
    armoured: true,
    face: { ...bakedFace('bride-face.png'), mean: 0.712472 },
    profile: motionProfileFor('bride'),
  },

  // The heavy biomech woman (venus.blob's header): the cyberbride's head on a
  // full-figured flesh body, with sculpted Blender kit grafts
  // (assets-source/venus-kit/). The face is the cyberbride's: the flat zombie
  // mask, with the fangs, maw and glow eyes as prims.
  venus: {
    name: 'venus', src: venusBlobSrc,
    // Corset cage, exo-spine, collar, talon gauntlets and knee braces: Blender
    // parts (assets-source/venus-kit/) skinned to the .blob's bones by
    // scripts/blender-kit.ts.
    kit: '/assets/lab/venus-kit.gltf',
    // Fat rolls, cellulite, stretch marks and varicose veins (characters/venus.detail, baked; never marched).
    bodyNormal: { url: '/assets/lab/venus-body-n.png', meta: '/assets/lab/venus-body-n.json', strength: 1 },
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('venus'),
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
