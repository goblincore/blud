// src/lab/sdf-zombie/characters/goblin-expressions.ts
//
// The goblin's expressions (expression pass, spec docs/superpowers/specs/2026-10-13-goblin-expressions-design.md): the tuning table
// that maps channels onto this face, and the clips. DATA ONLY, resolved by expression.ts. Every number is a first guess to be
// judged in the lab frames (docs/dev-notes/2026-10-13-goblin-expressions/); each change from the first values is commented with
// the frame that asked for it.
//
// CINEMATIC GOBLIN ONLY (Task 13, owner 2026-10-15): expression-library.ts keys these `goblin-cinematic`, whose .blob carries the
// jaw, teeth and morphs; the base goblin has none of them. That variant has BARE EYES, so the notes below about the kit's
// sunglasses hiding the brows describe the base goblin's kit, under which this tuning was first judged.
//
// The goblin's authored `sheet` block is the neutral: mouthCurve -0.15 (-0.50 before Task 3b put the painted mouth on the real
// seam, flatter) is ALREADY a slight smile arc by the sheet's sign (the scowl read
// comes from the lips and brows), so `smile` pulls it further negative and `lipCurl` pushes it positive past zero into a frown.
import type { ExpressionClip, ExpressionTuning } from '../expression';

export const GOBLIN_EXPRESSION_TUNING: ExpressionTuning = {
  maxGape: 0.6,
  // 0.9 -> 0.35 (Task 10, tuning/paint-locate.png): at 0.9 the grin's painted U bottomed out ~2.8 cm under the seam, ON the lower lip
  // (a dark band across it, a second mouth when it shows). At 0.35 the U's middle falls inside the opening and only its arms show.
  // 0.35 -> 0.6, smileWiden 0.5 -> 0.7, smileMouthOpen 0.015 -> 0.03 (Task 18, the cartoon grin): the lower lip now sags far below
  // the seam, so a deeper, wider, thicker painted U lies inside the dark opening and its arms darken the crescent's upturned ends.
  // 0.6 -> 0.04, smileWiden 0.7 -> 0.3, smileMouthOpen 0.03 -> 0 (Task 20, two rows of teeth): the opening is filled with teeth now
  // and the lower lip sits lower, so the painted U only ever landed on the lip, a dark line under the lower row. Kept a hair above 0
  // so a smile still curves the painted seam the right way (the mouth's own paint at rest is untouched).
  smileCurve: 0.04,
  // 0.25 -> 0.5 (Task 10, tuning/paint-locate.png): the arms only show OUTSIDE the opening (x +-4 cm); wider paint gives them room to
  // rise from the opening's lower corners to the seam (the only "corners up" the sheet can draw: its corners sit at mouthRise).
  smileWiden: 0.3,
  curlCurve: 1.0,
  curlNarrow: 0.25,
  // 10 -> 25 deg and 0.2 -> 0.3 (Task 10, tuning/brow-nokit.png): at 10 the scowl's brows were indistinguishable from the neutral's
  // even with the kit hidden (the brow ridge's own shadow swamps them); at 30 the slash over each eye reads. NOTE the kit's round
  // sunglasses cover the brows completely from the front (tuning/kit-hides-brows.png), so this only shows without the kit.
  browAngle: 25,
  browHeavy: 0.3,
  gapeMouthOpen: -0.02,
  // 0.01 -> 0.015 (Task 10, tuning/paint-locate.png): with the shallower U the arms are short; a touch thicker so they survive the grain.
  smileMouthOpen: 0,
  // THE EYES (Task 15, owner on the grin clip: "smiling involves also movement of the eye area where the eyes would have to get
  // smaller with the cheeks and eyelids closing more ... it actually reads more like surprise"). The eye is ~6x5 texels of a 64x64
  // sheet, so every number here was judged on frames (docs/dev-notes/2026-10-13-goblin-expressions/smile/):
  //  - squint does NOT squash the eye (squintLid 0: a squashed eye read as a dash, "asleep"); it raises an ARCHED lower lid
  //    (squintCheek: the smiling eye's dome "^ ^") and levels the slanted eye (squintTilt -14: the authored 16 deg slant made the
  //    dome lopsided) while the eye grows 10% (squintEyeSize -0.1) so the dome keeps a readable rim.
  //  - the EVIL part is browDown: it lowers a heavy upper lid that slants down toward the nose (browLidTop), so the grin's eye is a
  //    tapering slit under V brows while the friendly smile (brows not down) keeps the dome.
  //  - browShift slides the painted brow with browDown (down for the grin and scowl, up for surprise); a raised brow opens the eye
  //    (browRaiseEye: surprise's eyes are 42% bigger on the sheet than neutral's).
  squintLid: 0,
  squintCheek: 0.58,
  squintEyeSize: -0.1,
  squintBrow: 0.015,
  squintTilt: -14,
  browShift: 0.02,
  browRaiseEye: 0.15,
  browLidTop: 0.35,
  // THE FURROW (Task 19, the evil grin): the painted creases between the brows (the `furrow` morphs on the .blob's brow ridge and
  // inner-brow bulges are the geometry; this is the paint that sharpens the crease between them). 1 -> 0.55 (Task 20; owner: the
  // one-texel lines read graphic): half-strength creases, the geometry (pushed further) carries the furrow.
  furrowSheet: 0.55,
  // Task 20 (push the evil grin further): a knitted brow also presses the upper lid down (more than ~0.05 cuts the 6x5-texel eye
  // to a dot). With the evil grin's squint at 0.9 that made its eyes 12 lit texels against the grin's 19, which the owner found
  // "definitely too small"; Task 21 kept this and lowered the clip's squint instead (23 texels; see EVIL_GRIN).
  furrowLidTop: 0.03,
};

const key = (t: number, channels: ExpressionClip['keys'][number]['channels'], ease?: 'smooth') =>
  ({ t, channels, ...(ease ? { ease } : {}) });

/** The authored face. */
const NEUTRAL: ExpressionClip = { name: 'neutral', keys: [key(0, {})] };

/** The evil grin (Task 15 rework): a SMILE, not an open mouth. The jaw barely parts (0.2 x 0.6 = 0.12 rad: the teeth show by the
 *  lower lip's sag and the corners' pull, morphs), the mouth goes wide, the cheeks rise into the eyes (squint) and the brows come
 *  down and in (the evil part: a heavy, inward-slanted upper lid). The mouth leads and the eyes follow, so the squint lands as the
 *  grin spreads. */
const GRIN: ExpressionClip = {
  name: 'grin',
  // Before Task 15: one key at 0.4, gape 0.34 (0.204 rad), smile 1, browDown 1 and nothing at the eyes: the owner read the clip as
  // SURPRISE (a dropping jaw is most of what moved).
  keys: [
    key(0, {}),
    // Task 18 (owner: "when he grins it should be a bit cartoonish and exaggerated"): the head squashes (wider, shorter) as the grin
    // spreads, and the jaw opens to 0.18 rad (was 0.12): the crescent's height. It still reads as a grin, not surprise: the
    // corners ride 3 cm up into the cheek rolls, the eyes are slits under a V brow (docs/dev-notes/.../cartoon/).
    // Task 20 (owner: "this dark gap ... something a little too chipmunky"): gape 0.25 -> 0.12 (0.072 rad) and squash 1 -> 0.5. The
    // grin opens with the LIPS now (the .blob's smile morphs lift the upper lip and pull the lower one down off the lower row), so
    // the two rows of teeth fill the opening and the dark is a thin band between them; half the squash is half the jowls
    // (docs/dev-notes/.../teeth-rows/). The kit's teeth are laid out for this pose (goblin_teeth.py GRIN_*).
    key(0.3, { gape: 0.06, smile: 0.7, browDown: 0.4, squint: 0.3, squash: 0.25 }, 'smooth'),
    key(0.6, { gape: 0.12, smile: 1, browDown: 0.8, squint: 0.8, squash: 0.5 }, 'smooth'),
  ],
};

/** The EVIL grin (Task 19; owner on PR #48: "a variant like an 'evil grin' where the brows angle more inward to produce a furrow"):
 *  the grin's mouth on the grin's timing, key for key, with the brows driven all the way down (browDown 1, the grin's 0.8), a
 *  FURROW between them (furrow 1: the brow ridge's V pulled deeper and the inner-brow bulges with a crease between them, painted
 *  creases on the sheet) and the eyes narrower (squint 0.9, the grin's 0.8). Task 20 (owner: "can you push the evil grin further"):
 *  a SNEER on top of the grin's mouth (the upper lip curled off the fangs, lopsided, the corners hiked), the furrow's geometry pushed
 *  further, its paint softer, and the knitted brow pressing the lid down (furrowLidTop). Task 21 (owner: "make the evil grin's eyes
 *  a bit bigger - they are like definitely too small"): squint 0.9 -> 0.5 (mid key 0.4 -> 0.3), BELOW the grin's 0.8. The squint
 *  is the smiling cheek pushing the lower lid up into a dome; with less of it the heavy upper lid (browDown 1 + furrowLidTop) sits
 *  over a flatter lower lid: a glare, not a happy "^". Sheet: 23 lit texels for both eyes (grin 19, neutral 57; was 12); on the GPU
 *  (red pixels, eye close-up) about the grin's front-on, 0.75x at 45 degrees (the knitted brow ridge hides the outer end). 0.65
 *  (21 texels) was tried first: 0.6x the grin's on the GPU, the low sheet number lying about what the brow ridge leaves showing. */
const EVIL_GRIN: ExpressionClip = {
  name: 'evil-grin',
  keys: [
    key(0, {}),
    key(0.3, { gape: 0.06, smile: 0.7, browDown: 0.5, squint: 0.3, squash: 0.25, furrow: 0.5, sneer: 0.4 }, 'smooth'),
    key(0.6, { gape: 0.12, smile: 1, browDown: 1, squint: 0.5, squash: 0.5, furrow: 1, sneer: 1 }, 'smooth'),
  ],
};

/** A friendly smile (Task 15, for comparison with the grin): the same smile and squint with the jaw nearly shut and the brows NOT
 *  down (a touch raised). */
const SMILE: ExpressionClip = {
  name: 'smile',
  keys: [
    key(0, {}),
    // Task 18: half the grin's squash (a happy cartoon squash too).
    key(0.3, { gape: 0.04, smile: 0.7, squint: 0.3, browDown: -0.1, squash: 0.25 }, 'smooth'),
    key(0.6, { gape: 0.08, smile: 1, squint: 1, browDown: -0.2, squash: 0.5 }, 'smooth'),
  ],
};

/** Surprise (Task 15): the control the grin must NOT look like. The jaw drops, the brows go up, the eyes open; no smile, no squint. */
const SURPRISE: ExpressionClip = {
  name: 'surprise',
  // Task 18: the head STRETCHES (squash -0.6: narrower, taller), the opposite of the grin's squash, and the jaw drops further
  // (gape 0.5 -> 0.65, 0.39 rad) so it stays more than twice the grin's new 0.18.
  keys: [key(0, {}), key(0.35, { gape: 0.65, browDown: -1, squash: -0.6 }, 'smooth')],
};

/** Menace: brows down hard, the lip curled into a frown, the jaw just parted to bare the fangs. */
const SCOWL: ExpressionClip = {
  name: 'scowl',
  // gape 0.18 -> 0.24 (0.108 -> 0.144 rad; Task 10, tuning/scowl-shout-gape.png): at 0.18 the slit showed tooth tips but the fangs
  // did not stand out from the small teeth; at 0.24 they do, still well short of the grin's 0.204 rad.
  // furrow 0.8 (Task 19): the scowl knits its brows too (the evil grin's furrow, a little less).
  keys: [key(0, {}), key(0.3, { browDown: 1, lipCurl: 0.8, gape: 0.24, furrow: 0.8 }, 'smooth')],
};

/** A shout: the jaw wide open, the brows pulled in. */
const SHOUT: ExpressionClip = {
  name: 'shout',
  // gape 1 -> 0.8 (0.6 -> 0.48 rad; Task 10, tuning/scowl-shout-gape.png): at 0.6 rad the per-body hinge drops the lower jaw ~6 cm,
  // onto the collar, and at 45 degrees it reads as a nutcracker's; 0.48 is still a full shout with the lower row on show.
  keys: [key(0, {}), key(0.2, { gape: 0.8, browDown: 0.5 }, 'smooth')],
};

export const GOBLIN_EXPRESSIONS: Readonly<Record<string, ExpressionClip>> = {
  neutral: NEUTRAL, grin: GRIN, 'evil-grin': EVIL_GRIN, smile: SMILE, scowl: SCOWL, shout: SHOUT, surprise: SURPRISE,
};
