// src/lab/sdf-zombie/characters/goblin-expressions.ts
//
// The goblin's expressions (expression pass, spec docs/superpowers/specs/2026-10-13-goblin-expressions-design.md): the tuning table
// that maps channels onto this face, and the clips. DATA ONLY, resolved by expression.ts. Every number is a first guess to be
// judged in the lab frames (docs/dev-notes/2026-10-13-goblin-expressions/); each change from the first values is commented with
// the frame that asked for it.
//
// The goblin's authored `sheet` block is the neutral: mouthCurve -0.50 is ALREADY a smile arc by the sheet's sign (the scowl read
// comes from the lips and brows), so `smile` pulls it further negative and `lipCurl` pushes it positive past zero into a frown.
import type { ExpressionClip, ExpressionTuning } from '../expression';

export const GOBLIN_EXPRESSION_TUNING: ExpressionTuning = {
  maxGape: 0.6,
  smileCurve: 0.9,
  smileWiden: 0.25,
  curlCurve: 1.0,
  curlNarrow: 0.25,
  browAngle: 10,
  browHeavy: 0.2,
  gapeMouthOpen: -0.02,
  smileMouthOpen: 0.01,
};

const key = (t: number, channels: ExpressionClip['keys'][number]['channels'], ease?: 'smooth') =>
  ({ t, channels, ...(ease ? { ease } : {}) });

/** The authored face. */
const NEUTRAL: ExpressionClip = { name: 'neutral', keys: [key(0, {})] };

/** The toothy evil grin: jaw parted just enough to show the teeth, the mouth pulled wide and up, the brows a little low. */
const GRIN: ExpressionClip = {
  name: 'grin',
  keys: [key(0, {}), key(0.4, { gape: 0.28, smile: 1, browDown: 0.35 }, 'smooth')],
};

/** Menace: brows down hard, the lip curled into a frown, the jaw just parted to bare the fangs. */
const SCOWL: ExpressionClip = {
  name: 'scowl',
  keys: [key(0, {}), key(0.3, { browDown: 1, lipCurl: 0.8, gape: 0.18 }, 'smooth')],
};

/** A shout: the jaw wide open, the brows pulled in. */
const SHOUT: ExpressionClip = {
  name: 'shout',
  keys: [key(0, {}), key(0.2, { gape: 1, browDown: 0.5 }, 'smooth')],
};

export const GOBLIN_EXPRESSIONS: Readonly<Record<string, ExpressionClip>> = {
  neutral: NEUTRAL, grin: GRIN, scowl: SCOWL, shout: SHOUT,
};
