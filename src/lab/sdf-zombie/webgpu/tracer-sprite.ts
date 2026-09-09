// src/lab/sdf-zombie/webgpu/tracer-sprite.ts
//
// The in-flight look of a shot: a blurry LIGHT STREAK, not a ball.
//
// The first pass drew every pellet as a shaded MeshBasicMaterial sphere at the
// collision calibre (10 cm across). At room range that is a small yellow dot;
// at the muzzle — where a pellet spends its first frames, 20 cm from the eye —
// it is a screen-filling yellow blob (the owner's report). Neither reads as
// gunfire. What reads as gunfire is a tracer: a hot head smeared into a soft
// tail along the direction of travel, glowing rather than lit.
//
// The three parts of that, and where each lives:
//
//   SHAPE   — this file's `tracerPixels`: one additive sprite carrying a
//             white-hot head, a tapering amber tail and a wide soft halo, so a
//             SINGLE quad looks blurry-bright without a second glow card and
//             without a blur pass. Generated, not baked, for the reasons
//             flash-sprite.ts already gives: deterministic, pixel-testable,
//             live-tunable, no load path.
//   AIM     — `tracerBasis`: the quad is a CYLINDRICAL billboard. Its long
//             axis is pinned to the velocity (that is the streak) and it spins
//             about that axis to face the eye, so a tracer is never seen
//             edge-on and never stops pointing where it is going.
//   FADE    — `tracerNearFade`: alpha ramps in over the first metre of flight
//             distance from the eye. This is what actually kills the blob: a
//             streak is a far-field read, and at arm's length the honest
//             amount of it to draw is none. The muzzle flash already owns that
//             instant of the frame.
//   HEAD-ON — `emberPixels` + `tracerHeadOn` + `faceEyeBasis`: the part a
//             pure streak cannot do. A shot fired down your own view axis is
//             foreshortened to a sliver — measured in the game, not assumed:
//             a 1.4 m streak two metres out reads as a faint vertical scratch,
//             because you are looking along it. So a projectile also carries a
//             view-facing ember whose weight rises exactly as the streak
//             collapses. Broadside (someone else's shot crossing your view)
//             you see the streak; head-on or tail-on you see a soft hot mote.
//             Neither view ever shows a hard yellow ball again.
//
// Everything here is pure: no THREE, no DOM. game-main.ts owns the mesh pool.

/** Tunables shared by the sprite and the per-frame billboard sizing. */
export const TRACER = {
  /** Streak length = speed * this, i.e. how much flight time the smear
   *  represents (seconds). 0.040 puts a 35 m/s pellet at ~1.4 m. Long, because
   *  a shot fired down the view axis is foreshortened to almost nothing — the
   *  0.026 first pass vanished at the reticle. Still well short of a laser: at
   *  35 m/s it is 40 ms of travel, about two frames' worth. */
  lengthSec: 0.040,
  /** Floor on that length, m, so a slowed/arcing pellet keeps a streak. */
  minLength: 0.45,
  /** Quad width = projectile radius * this. The sprite's halo occupies the
   *  outer half, so the BRIGHT core reads at roughly the real calibre while
   *  the glow spills past it. Kept narrow on purpose: a streak flying AWAY
   *  from the eye shows the viewer its width and nothing else, so this number
   *  is what decides whether a close pellet is a glow or a blob. */
  widthScale: 3.0,
  /** Below this distance from the eye, m, a tracer is fully invisible.
   *  Generous compared with the ball this replaced: a 20 cm streak seen
   *  end-on is nothing like a 10 cm sphere at the same range, so the fade only
   *  has to cover the frames where the muzzle flash owns the screen anyway. */
  fadeInStart: 0.30,
  /** At/above this distance, m, it is at full brightness. */
  fadeInEnd: 0.95,
  /** Ember quad diameter = projectile radius * this. */
  emberScale: 3.4,
  /** |cos| between travel and view below which the streak reads on its own and
   *  the ember is off entirely. */
  emberFrom: 0.55,
  /** |cos| at/above which the streak has collapsed and the ember carries the
   *  whole read. */
  emberTo: 0.95,
} as const;

/**
 * The streak sprite, RGBA `width` x `height`, for ADDITIVE blending.
 *
 * Layout is head-right: the +X end of the image is the leading tip and maps to
 * the direction of travel; -X is the tail. Across the short axis the profile
 * is a gaussian (hence "blurry" — there is no hard edge anywhere in it).
 *
 * `width` should be several times `height`; the caller stretches the quad, not
 * the texture, so the aspect here only sets how much resolution the long fade
 * gets.
 */
export function tracerPixels(width: number, height: number): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    // v in [-1, 1] across the streak, ENDPOINT-INCLUSIVE: the outermost texel
    // rows land exactly on |v| = 1, where the edge window below is exactly 0.
    // Texel-centred sampling would leave them a percent short of the border
    // and paint the quad's own long edges as two faint straight lines.
    const v = height < 2 ? 0 : y / (height - 1) * 2 - 1;
    for (let x = 0; x < width; x++) {
      // u in [0, 1] along the streak; 1 is the leading tip.
      const u = (x + 0.5) / width;

      // Longitudinal energy: a power-law ramp toward the head (the smear) plus
      // a tight bump AT the head (the burning tip itself). The exponent is
      // deliberately shallow — the first pass used 2.6 and the streak read as
      // a faint scratch against a lit wall, because everything behind the tip
      // was under a quarter alpha.
      const tail = Math.pow(u, 1.7);
      const head = Math.exp(-Math.pow((1 - u) / 0.17, 2));
      // Round the tip off so the quad's leading edge is never a straight cut.
      const capT = Math.max(0, (u - 0.90) / 0.10);
      const cap = Math.sqrt(Math.max(0, 1 - capT * capT));

      // Cross-section: narrow at the tail, full at the head. Two gaussians —
      // a tight core and a wide halo — are what make one quad read as a
      // glowing object instead of a painted stripe.
      const w = 0.22 + 0.78 * Math.pow(u, 0.7);
      const core = Math.exp(-Math.pow(v / (w * 0.50), 2) * 1.5);
      const halo = Math.exp(-Math.pow(v / w, 2) * 1.0);

      // The halo is a gaussian, so it is still ~15% alive at |v| = 1. Left
      // there it draws the quad's own long edges as two faint straight lines.
      // Wind it to zero over the outer eighth — the same "never show your own
      // bounding box" clamp smokePixels ends on.
      const eg = Math.min(1, Math.max(0, (1 - Math.abs(v)) / 0.14));
      const edge = eg * eg * (3 - 2 * eg);

      const bright = Math.min(1, (tail * 1.05 + head * 1.30) * core * cap);
      const glow = Math.min(1, (tail * 0.70 + head * 1.00) * halo * cap);
      const a = Math.min(1, bright + glow * 0.70) * edge;

      // Colour grades with the CORE, not with total alpha: the halo stays
      // amber while only the middle of the streak goes white-hot, which is
      // what stops an additive sprite from washing out to a white worm.
      const hot = Math.min(1, bright * 1.15);
      const i = (y * width + x) * 4;
      px[i]     = Math.round(255 * Math.min(1, 0.62 + hot * 0.38));
      px[i + 1] = Math.round(255 * Math.min(1, 0.34 + hot * 0.60));
      px[i + 2] = Math.round(255 * Math.min(1, 0.10 + hot * 0.70));
      px[i + 3] = Math.round(255 * a);
    }
  }
  return px;
}

/**
 * The head-on ember, RGBA `size` x `size`, for ADDITIVE blending: a round
 * white-hot centre graded out through amber to nothing at the rim. This is
 * what a projectile coming at you (or going away) actually looks like — a
 * glowing mote, not a lit sphere — and it is deliberately soft all the way
 * through so it never regains an edge.
 */
export function emberPixels(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Endpoint-inclusive, so the rim lands exactly on r = 1 where alpha is 0.
    const ny = size < 2 ? 0 : y / (size - 1) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = size < 2 ? 0 : x / (size - 1) * 2 - 1;
      const r = Math.hypot(nx, ny);
      // A tight core plus a wide halo, wound to zero at the rim — the same
      // two-gaussian recipe the streak's cross-section uses, so the ember and
      // the streak look like the same hot material seen from two angles.
      const core = Math.exp(-Math.pow(r / 0.30, 2) * 1.4);
      const halo = Math.exp(-Math.pow(r / 0.78, 2) * 1.1);
      const eg = Math.min(1, Math.max(0, (1 - r) / 0.22));
      const edge = eg * eg * (3 - 2 * eg);
      const bright = Math.min(1, core * 1.35);
      const a = Math.min(1, bright + halo * 0.60) * edge;
      const hot = Math.min(1, bright * 1.15);
      const i = (y * size + x) * 4;
      px[i]     = Math.round(255 * Math.min(1, 0.62 + hot * 0.38));
      px[i + 1] = Math.round(255 * Math.min(1, 0.34 + hot * 0.60));
      px[i + 2] = Math.round(255 * Math.min(1, 0.10 + hot * 0.70));
      px[i + 3] = Math.round(255 * a);
    }
  }
  return px;
}

export type Vec3Tuple = readonly [number, number, number];

/** An orthonormal right-handed frame for one tracer quad. */
export interface TracerBasis {
  /** Long axis — the direction of travel. The sprite's +X. */
  x: Vec3Tuple;
  /** Short axis — across the streak, perpendicular to the view. The sprite's +Y. */
  y: Vec3Tuple;
  /** Quad normal, pointing at the eye. */
  z: Vec3Tuple;
}

function cross(a: Vec3Tuple, b: Vec3Tuple): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(v: Vec3Tuple): [number, number, number] | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-9)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * CYLINDRICAL BILLBOARD. `dir` is the projectile velocity (need not be unit);
 * `toEye` points from the projectile to the camera. Returns a frame whose X is
 * the travel direction and whose Z faces the eye as closely as the pinned X
 * allows — i.e. the quad rolls about the streak, exactly like a real tracer
 * card, rather than turning to face the camera outright (which would swing the
 * streak off the trajectory).
 *
 * Returns null only when `dir` has no length. When `dir` and `toEye` are
 * PARALLEL — a shot fired straight at or away from the eye — the roll is
 * genuinely undefined, so an arbitrary perpendicular is chosen; the quad is
 * near enough edge-on there that the choice is invisible.
 */
export function tracerBasis(dir: Vec3Tuple, toEye: Vec3Tuple): TracerBasis | null {
  const x = norm(dir);
  if (!x) return null;
  let y = norm(cross(toEye, x));
  if (!y) {
    // Degenerate: pick any axis not parallel to x and orthogonalise.
    const helper: Vec3Tuple = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    y = norm(cross(helper, x));
    if (!y) return null;
  }
  // x × y is the component of `toEye` perpendicular to x (BAC-CAB), so it
  // faces the eye by construction and the frame is right-handed.
  const z = cross(x, y);
  return { x, y, z };
}

/**
 * A frame whose Z points straight at the eye — a full camera-facing billboard
 * for the round ember, where roll is meaningless so any perpendicular pair
 * will do. Returns null when `toEye` has no length (the eye is exactly on the
 * projectile).
 */
export function faceEyeBasis(toEye: Vec3Tuple): TracerBasis | null {
  const z = norm(toEye);
  if (!z) return null;
  const helper: Vec3Tuple = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x = norm(cross(helper, z));
  if (!x) return null;
  return { x, y: cross(z, x), z };
}

/**
 * How much of the read the ember should carry, 0..1, from the angle between
 * travel and view. 0 broadside (the streak shows its full length and an ember
 * on top would just be a blob riding it); 1 head-on or tail-on, where the
 * streak has foreshortened to a sliver and the ember IS the projectile.
 * Symmetric in sign — a shot coming at you and a shot going away from you are
 * both collapsed.
 */
export function tracerHeadOn(dir: Vec3Tuple, toEye: Vec3Tuple): number {
  const d = norm(dir), e = norm(toEye);
  if (!d || !e) return 1;
  const c = Math.abs(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]);
  const t = (c - TRACER.emberFrom) / (TRACER.emberTo - TRACER.emberFrom);
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/** Streak length in metres for a projectile travelling at `speed` m/s. */
export function tracerLength(speed: number): number {
  return Math.max(TRACER.minLength, speed * TRACER.lengthSec);
}

/**
 * Brightness multiplier for a tracer whose HEAD is `dist` metres from the eye.
 * 0 inside `fadeInStart`, 1 beyond `fadeInEnd`, smoothstep between — a linear
 * ramp pops at both ends of a fade this short.
 */
export function tracerNearFade(dist: number): number {
  const t = (dist - TRACER.fadeInStart) / (TRACER.fadeInEnd - TRACER.fadeInStart);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
