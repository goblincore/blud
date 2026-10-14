// src/lab/sdf-zombie/characters/goblin-expressions.ts
//
// The goblin's expressions (expression pass, spec docs/superpowers/specs/2026-10-13-goblin-expressions-design.md): the tuning table
// that maps channels onto this face, and the clips. DATA ONLY, resolved by expression.ts. Every number is a first guess to be
// judged in the lab frames (docs/dev-notes/2026-10-13-goblin-expressions/); each change from the first values is commented with
// the frame that asked for it.
//
// The goblin's authored `sheet` block is the neutral: mouthCurve -0.15 (-0.50 before Task 3b put the painted mouth on the real
// seam, flatter) is ALREADY a slight smile arc by the sheet's sign (the scowl read
// comes from the lips and brows), so `smile` pulls it further negative and `lipCurl` pushes it positive past zero into a frown.
import type { ExpressionClip, ExpressionTuning } from '../expression';

export const GOBLIN_EXPRESSION_TUNING: ExpressionTuning = {
  maxGape: 0.6,
  // 0.9 -> 0.35 (Task 10, tuning/paint-locate.png): at 0.9 the grin's painted U bottomed out ~2.8 cm under the seam, ON the lower lip
  // (a dark band across it, a second mouth when it shows). At 0.35 the U's middle falls inside the opening and only its arms show.
  smileCurve: 0.35,
  // 0.25 -> 0.5 (Task 10, tuning/paint-locate.png): the arms only show OUTSIDE the opening (x +-4 cm); wider paint gives them room to
  // rise from the opening's lower corners to the seam (the only "corners up" the sheet can draw: its corners sit at mouthRise).
  smileWiden: 0.5,
  curlCurve: 1.0,
  curlNarrow: 0.25,
  // 10 -> 25 deg and 0.2 -> 0.3 (Task 10, tuning/brow-nokit.png): at 10 the scowl's brows were indistinguishable from the neutral's
  // even with the kit hidden (the brow ridge's own shadow swamps them); at 30 the slash over each eye reads. NOTE the kit's round
  // sunglasses cover the brows completely from the front (tuning/kit-hides-brows.png), so this only shows without the kit.
  browAngle: 25,
  browHeavy: 0.3,
  gapeMouthOpen: -0.02,
  // 0.01 -> 0.015 (Task 10, tuning/paint-locate.png): with the shallower U the arms are short; a touch thicker so they survive the grain.
  smileMouthOpen: 0.015,
};

const key = (t: number, channels: ExpressionClip['keys'][number]['channels'], ease?: 'smooth') =>
  ({ t, channels, ...(ease ? { ease } : {}) });

/** The authored face. */
const NEUTRAL: ExpressionClip = { name: 'neutral', keys: [key(0, {})] };

/** The toothy evil grin: jaw parted just enough to show the teeth, the mouth pulled wide and up, the brows down. */
const GRIN: ExpressionClip = {
  name: 'grin',
  // gape 0.28 -> 0.34 (0.168 -> 0.204 rad; Task 10, tuning/grin-gape-sweep.png): at 0.2 the teeth are a clenched stubby row (a
  // grimace), at 0.4 the fangs hang long but the corner gap opens into a dark notch at 45 degrees; 0.34 shows the fangs' length.
  // browDown 0.35 -> 1 (Task 10, tuning/brow-nokit.png): an evil grin needs the scowl's brows, not a friendly raised-neutral.
  keys: [key(0, {}), key(0.4, { gape: 0.34, smile: 1, browDown: 1 }, 'smooth')],
};

/** Menace: brows down hard, the lip curled into a frown, the jaw just parted to bare the fangs. */
const SCOWL: ExpressionClip = {
  name: 'scowl',
  // gape 0.18 -> 0.24 (0.108 -> 0.144 rad; Task 10, tuning/scowl-shout-gape.png): at 0.18 the slit showed tooth tips but the fangs
  // did not stand out from the small teeth; at 0.24 they do, still well short of the grin's 0.204 rad.
  keys: [key(0, {}), key(0.3, { browDown: 1, lipCurl: 0.8, gape: 0.24 }, 'smooth')],
};

/** A shout: the jaw wide open, the brows pulled in. */
const SHOUT: ExpressionClip = {
  name: 'shout',
  // gape 1 -> 0.8 (0.6 -> 0.48 rad; Task 10, tuning/scowl-shout-gape.png): at 0.6 rad the per-body hinge drops the lower jaw ~6 cm,
  // onto the collar, and at 45 degrees it reads as a nutcracker's; 0.48 is still a full shout with the lower row on show.
  keys: [key(0, {}), key(0.2, { gape: 0.8, browDown: 0.5 }, 'smooth')],
};

export const GOBLIN_EXPRESSIONS: Readonly<Record<string, ExpressionClip>> = {
  neutral: NEUTRAL, grin: GRIN, scowl: SCOWL, shout: SHOUT,
};
