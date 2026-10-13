// src/lab/sdf-zombie/webgpu/emergence-field.ts
//
// THE SCREEN EMERGENCE's field, CPU twin (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, section 4).
// Pure: the sac heightfield over the glass, the egg's place, the bezel lip's bow, the sheet's thickness, the tear's reach and the picture's
// inverse-stretch table. `screen-emergence.wgsl.ts` is built from the constants here and re-implements these functions in WGSL; tests pin the
// PROPERTIES (zero at rest, wraps the egg, monotone in the push), the look rounds tune the numbers.
//
// FRAME: the screen's: origin at the glass centre, +x right, +y up, +z out of the screen toward the room, metres.
import type { EmergenceParams } from './emergence-timeline';

export type Vec3 = [number, number, number];

/** The P225f's viewable glass, 0.406 x 0.305 m, as half extents. */
export const GLASS = { hw: 0.203, hh: 0.1525 } as const;
/** The sac's skin: the sheet stands this far in front of the egg's surface. */
export const SKIN = 0.006;
/** The stand-in egg (still taller than the glass, so the lip gives, just: 0.316 m against 0.305): look round 1 made it 80% of round one's
 *  0.175 x 0.225 x 0.175 ("the egg is too big"), the owner's second notes (2026-10-13) 88% of that ("maybe still a bit smaller"): 0.70 of
 *  round one. Semi-axes, and the centre's depth at rest and at full push. `z0` keeps the egg's front where round one's was at rest (7.5 cm
 *  behind the glass, so the glass's first bulge comes as before); `z1` keeps the sac's reach (SAC_MAX = z1 + rz + SKIN) at 0.646 m, the 80%
 *  egg's: the owner asked for a smaller egg, not a shorter push. */
export const EGG = { rx: 0.123, ry: 0.158, rz: 0.123, z0: -0.198, z1: 0.517 } as const;
/** The desk's top below the glass centre. The slumped egg rests ON THE KEYBOARD (the owner's second notes: the keyboard is not shoved out of
 *  the way, it is covered in egg goo): see EGG_REST. */
export const DESK_Y = -0.32;
/** THE SET'S DESK TOP: the CRT's face stands FRAME_FACE_Z proud of the glass; the keyboard (thickness `t`, depth `d`, width `w`, its key rows
 *  `keys` proud of it) lies `gap` in front of the face. The lab page builds them from these. */
export const FRAME_FACE_Z = 0.03;
/** The P225f's front frame (docs/dev-notes/2026-10-01-flat-emergence-lookdev/crt_p225f.py, the blockout's FW, FH, FD, CHIN): its width and
 *  height, the side band's depth, and the chin under the glass. The lab page builds the housing from these; the drips are kept in front
 *  of it (goo-strands' DRIP_FACE_Z). */
export const CRT_FRAME = { fw: 0.5, fh: 0.47, fd: 0.065, chin: 0.11 } as const;
/** The frame's bottom (the chin below the glass's lower edge) and top, in the screen frame. */
export const FRAME_BOTTOM = -(CRT_FRAME.chin + GLASS.hh);
export const FRAME_TOP = FRAME_BOTTOM + CRT_FRAME.fh;
export const KEYBOARD = { t: 0.03, d: 0.16, w: 0.46, gap: 0.06, keys: 0.008 } as const;
export const KEYBOARD_Z = FRAME_FACE_Z + KEYBOARD.gap + KEYBOARD.d / 2;
/** The keyboard's body top (between the key rows) and the key rows' top. */
export const KEYBOARD_BODY_TOP = DESK_Y + KEYBOARD.t;
export const KEYBOARD_TOP = KEYBOARD_BODY_TOP + KEYBOARD.keys;
/** The keyboard's footprint on the desk (x and z extents). It never moves (the owner: "i dont want the keyboard to move out the way"). */
export const KEYBOARD_RECT = { x0: -KEYBOARD.w / 2, x1: KEYBOARD.w / 2, z0: KEYBOARD_Z - KEYBOARD.d / 2, z1: KEYBOARD_Z + KEYBOARD.d / 2 } as const;
export const onKeyboard = (x: number, z: number) => x >= KEYBOARD_RECT.x0 && x <= KEYBOARD_RECT.x1 && z >= KEYBOARD_RECT.z0 && z <= KEYBOARD_RECT.z1;
/** Where the slumped egg rests: ON THE KEYBOARD, its bottom on the key rows (the contact 1.5 cm in front of the keyboard's middle), its back
 *  3.2 cm in front of the CRT's face at the chin (z 0.062), its front over the keyboard's front edge (z 0.308). z 0.185 as before. */
export const EGG_REST: Vec3 = [0, KEYBOARD_TOP + EGG.ry, 0.185];

/** The sac's apex at full push: the egg's front plus the skin (0.646 m, the 80% egg's; round one's bigger egg reached 0.73). */
export const SAC_MAX = EGG.z1 + EGG.rz + SKIN;
/** The sheet's half-thickness at rest (m), and the tear's largest radius (scaled with the egg: 0.70 of round one's 0.17). */
export const THICK0 = 0.004;
export const TEAR_R_MAX = 0.12;
/** The lip: how far it bows out in z and how much the opening widens (fractions of the glass) at full bow. `openY` gives only what the egg
 *  needs (its half height 1.02x the egg's ry at full bow, as round one's 0.5 gave the bigger egg): 0.2 for the 80% egg, 0.06 for this one
 *  (0.1617 against ry 0.158: the lip just gives). */
export const LIP = { bowZ: 0.1, openX: 0.3, openY: 0.06 } as const;
export const RIPPLE = { amp: 0.012, freq: 24, speed: 9 } as const;
/** The picture table's size (entries 0..N-1 cover normalised radius 0..1). */
export const PICTURE_TABLE_N = 33;

export const smooth = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Polynomial smooth maximum (iq), blend width k. */
export const smax = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
/** Polynomial smooth minimum (iq), the same form. */
export const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** THE SLUMP (Task 8): the sac recoils back toward the glass carrying the egg (`back`: its z reaches the rest place by this much of the slump),
 *  lets go of it (`release`: the egg is out of the sac solid by then), and the egg FALLS onto the keyboard: its drop starts at `fall0` and lands at
 *  `land`, ease-in (a fall), then a small settling bounce of `bounce` metres. The timeline's slump is linear; the easing lives here. */
export const SLUMP = { back: 0.8, release: 0.55, fall0: 0.25, land: 0.85, bounce: 0.008 } as const;

/** The egg's centre: pushing through the glass (x, y = 0), then carried back by the recoiling sac and falling onto the desk. */
export function eggCentre(p: EmergenceParams): Vec3 {
  const z = lerp(EGG.z0, EGG.z1, smooth(p.push));
  const s = Math.min(1, Math.max(0, p.slump));
  const zb = smooth(s / SLUMP.back);
  const u = Math.min(1, Math.max(0, (s - SLUMP.fall0) / (SLUMP.land - SLUMP.fall0)));
  const v = Math.min(1, Math.max(0, (s - SLUMP.land) / (1 - SLUMP.land)));
  const hop = SLUMP.bounce * Math.sin(Math.PI * v) * (1 - v);
  return [0, EGG_REST[1] * u * u + hop, lerp(z, EGG_REST[2], zb)];
}

/** The height a drip (or a let-go strand) lands at above (x, z): the keyboard's top where the keyboard is (it never moves), else the desk's. */
export function dripFloor(x: number, z: number): number {
  return onKeyboard(x, z) ? KEYBOARD_TOP : DESK_Y;
}

/** THE GOO COAT on the keyboard (the owner's second notes: "covered in egg goo when the egg comes out"): a heightfield of goo over the
 *  keyboard's body top, the sum of round bumps (a blob of radius r and peak h is h (1 - (d / r)^2)^2), saturating softly at `max`
 *  (max (1 - exp(-sum / max))) and cut at `thresh` so its edge is a rounded, blobby line where the sum crosses it; it stays `inset` inside
 *  the keyboard's edges. Where it is under KEYBOARD.keys thick the key rows stand out of it. Its blobs: the EGG's, at the egg's contact,
 *  growing over the slump from `egg.s0` (t 10.5 s, as the egg falls and sheds goo) to `egg.s1` (t 11.4 s, just after it lands), spreading
 *  by `creep` more with the heal; and one per DRIP that lands on the keys (goo-strands: radius and peak `drip.r`, `drip.h` at full feed,
 *  fed by the drip's growth past its room over `drip.fill` metres, its centre fixed where it formed). Each blob's radius is LOBED round its
 *  centre (`lobes`: amplitude, frequency in the angle, phase, the phase shifted by 1.7 per blob), so the coat's edge is goo's, not a circle. */
export const COAT = {
  thresh: 0.003, max: 0.02, inset: 0.002, creep: 0.2, lobes: [[0.16, 3, 0.7], [0.08, 7, 2.1]],
  egg: { r: 0.21, h: 0.045, s0: 0.6, s1: 0.95 },
  drip: { r: 0.06, h: 0.016, fill: 0.06 },
} as const;
/** A bump of the coat's heightfield: its centre on the keyboard (x, z), radius and peak (0: none). */
export interface CoatBlob { x: number; z: number; r: number; h: number }

/** The egg's blob: at its contact (EGG_REST's x, z), growing with the slump over COAT.egg.s0..s1, creeping with the heal. */
export function coatEggBlob(p: EmergenceParams): CoatBlob {
  const g = smooth((p.slump - COAT.egg.s0) / (COAT.egg.s1 - COAT.egg.s0));
  return { x: EGG_REST[0], z: EGG_REST[2], r: COAT.egg.r * g * (1 + COAT.creep * smooth(p.heal)), h: COAT.egg.h * g };
}

/** The coat's thickness above the keyboard's body top at (x, z): 0 off the keyboard and where no blob reaches. The shader's scrCoatH is its twin. */
export function coatThickness(blobs: readonly CoatBlob[], x: number, z: number): number {
  const R = KEYBOARD_RECT;
  const inside = Math.min(x - R.x0, R.x1 - x, z - R.z0, R.z1 - z);
  if (inside <= 0) return 0;
  let sum = 0;
  blobs.forEach((b, i) => {
    if (b.r <= 0 || b.h <= 0) return;
    const a = Math.atan2(z - b.z, x - b.x);
    let lobe = 1;
    for (const [amp, k, ph] of COAT.lobes) lobe += amp * Math.sin(k * a + ph + 1.7 * i);
    const r = b.r * lobe, u = Math.min(1, ((x - b.x) ** 2 + (z - b.z) ** 2) / (r * r));
    sum += b.h * (1 - u) * (1 - u);
  });
  const cap = COAT.max * (1 - Math.exp(-sum / COAT.max)) * smooth(inside / COAT.inset);
  return Math.max(0, cap - COAT.thresh);
}

/** THE GOO'S LOOK: one palette and one shading (the shader's scrGooShade) for every piece of goo: the strands, the beads, the drips, the
 *  runs off the keyboard, the slicks on the desk and the keyboard's coat (the owner's second notes: "i dont get why the drips are white, they
 *  should be the same color as the rest of the goo"). Round two's goo had a near-white albedo (0.82, 0.74, 0.7) and so took the colour of
 *  whatever lit it: the drips beside the landed egg, under the lamp AND the egg's light AND a subsurface floor of 0.8 of the egg's glow,
 *  clipped to cream-white; the strands in the tear's shade went the street fill's blue-grey; the slick was a different stuff altogether, a
 *  near-black mirror. Now: `base` the albedo (the milky off-white-pink, a little deeper so the lights do not clip it to white), `sss` the
 *  subsurface tint (light through the goo comes out warm), `lampSss` how much of the lamp comes through it (wrapped and from behind),
 *  `eggSss` how much of the egg's light comes through it near the egg (falling off over `eggNear` m from the shell), `eggOut` the egg's light
 *  on the goo once it is out of the sac (an eggshell then: SHELL_LIGHT.innerOut's logic, not as far), `ambient` the goo's own tint everywhere
 *  (so its shaded side stays goo-coloured), `coat` the clear coat's hard highlights (scrLight's), `sheen` a grazing sheen, `env` the wet
 *  surface's broad reflection of the glowing screen (colour `envCol`, lobe `envPow` round the direction to the glass's centre); the coat on
 *  the keyboard is `film` opaque where thin (the keys show through) to `filmThick` where thick; the slicks mirror the egg by `mirror` of
 *  the Fresnel. The base is pinker than the keyboard's beige so the coat reads on it. */
export const GOO_LOOK = {
  base: [0.7, 0.47, 0.44], sss: [1.0, 0.56, 0.42], lampSss: 0.3, eggSss: 0.55, eggNear: 0.08, eggOut: 0.2, ambient: 0.05,
  coat: 1.5, sheen: 0.12, env: 0.45, envCol: [1.0, 0.5, 0.3], envPow: 4, film: 0.8, filmThick: 0.97, mirror: 0.6,
} as const;

/** The share of the keyboard's top the coat covers (a 47 x 17 grid of its footprint): 0..1. */
export function coatCoverage(blobs: readonly CoatBlob[]): number {
  const R = KEYBOARD_RECT, NX = 47, NZ = 17;
  let n = 0;
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++)
    if (coatThickness(blobs, R.x0 + ((i + 0.5) / NX) * (R.x1 - R.x0), R.z0 + ((k + 0.5) / NZ) * (R.z1 - R.z0)) > 0) n++;
  return n / (NX * NZ);
}

/** How much the sac still holds the egg: 1 until the slump starts, 0 once the egg is out (SLUMP.release). The sac solid's egg term shrinks
 *  inward by (1 - held) * EGG_LEAVE (gone past the egg's smallest radius), so the membrane stops wrapping the egg and the egg is a free body. */
export const eggHeld = (p: EmergenceParams) => 1 - smooth(p.slump / SLUMP.release);
export const EGG_LEAVE = 0.2;

/** The egg's front surface depth at (x, y), or null outside its silhouette. `shrink` (m) takes that much off every semi-axis (the sac's
 *  egg term as the egg leaves it). */
export function eggFront(p: EmergenceParams, x: number, y: number, shrink = 0): number | null {
  const c = eggCentre(p);
  const rx = EGG.rx - shrink, ry = EGG.ry - shrink, rz = EGG.rz - shrink;
  if (rx <= 0 || rz <= 0) return null;
  const q = (x / rx) ** 2 + ((y - c[1]) / ry) ** 2;
  return q >= 1 ? null : c[2] + rz * Math.sqrt(1 - q);
}

/** The lip: the opening's half sizes widened by the bow, and the rim's height. */
export function lipOpening(p: EmergenceParams): { hw: number; hh: number; z: number } {
  const b = smooth(p.lipBow);
  return { hw: GLASS.hw * (1 + LIP.openX * b), hh: GLASS.hh * (1 + LIP.openY * b), z: LIP.bowZ * b };
}

/** The sac's apex height: grows with the push; when the egg leaves, the empty sac recoils back to SAC_EMPTY of its reach (BELOW the bowed
 *  lip's rim: the sheet dishes back into the screen behind the egg, so the strands cross a real gap); sucks back with the heal. */
export const SAC_EMPTY = 0.05;
export const sacExtent = (p: EmergenceParams) => SAC_MAX * smooth(p.push) * (1 - (1 - SAC_EMPTY) * smooth(p.slump)) * (1 - smooth(p.heal));

/** THE HEALED SHEET's wrinkle (Task 8): a high-frequency crumple on the sheet's z: radial creases drawn in toward the middle where it sucked
 *  back, crossed by a finer net. Amplitude (m) `amp` times wrinkleAmp's envelope; it fades within `edge` of the opening (so the sheet still
 *  meets the lip) and within `core` m of the axis (the creases' singularity). The shader's scrWrinkle is this twin. */
export const WRINKLE = { amp: 0.004, k: 13, warp: 2.5, warpF: 40, fx: 62, fy: 47, fine: 0.45, edge: 0.2, core: 0.05 } as const;
/** The wrinkle's envelope: peaks mid-heal (heal (1 - heal) 4, ramped in from heal 0.3 to 0.55) plus a faint residual 0.15 heal so the healed
 *  sheet stays crumpled. */
export const wrinkleAmp = (p: EmergenceParams) => {
  const h = Math.min(1, Math.max(0, p.heal));
  return WRINKLE.amp * (smooth((h - 0.3) / 0.25) * h * (1 - h) * 4 + 0.15 * h);
};
/** The wrinkle's pattern at (x, y) on a unit envelope (q is the normalised radius in the opening). */
export function wrinkle(x: number, y: number, q: number): number {
  const rho = Math.hypot(x, y), th = Math.atan2(y, x);
  const crease = Math.sin(WRINKLE.k * th + WRINKLE.warp * Math.sin(WRINKLE.warpF * rho)) * smooth(rho / WRINKLE.core);
  const net = Math.sin(WRINKLE.fx * x + 2 * Math.sin(WRINKLE.fy * y)) * Math.sin(WRINKLE.fy * y + 1.7);
  return (crease + WRINKLE.fine * net) * (1 - smooth((q - (1 - WRINKLE.edge)) / WRINKLE.edge));
}

/** The dome's profile exponent: below 1 the dome is fuller than the smoothstep, so behind the egg's equator the sac's wall stays near the
 *  egg's width and flares to the lip (0.75 in round one pinched it to a vase's neck under the tent blend). */
export const DOME_EXP = 0.5;
/** The dome's shape from the apex (q = 0) to the lip (q = 1). */
const profile = (q: number) => (q >= 1 ? 0 : Math.pow(smooth(1 - q), DOME_EXP));

/** The ripple's height at normalised radius q (0 at the apex axis, 1 at the lip). */
const rippleAt = (p: EmergenceParams, q: number, time: number) =>
  p.ripple * RIPPLE.amp * Math.sin(RIPPLE.freq * Math.min(q, 1) - RIPPLE.speed * time) * (1 - Math.min(q, 1));

/** THE DOME alone (the glass swelling, before the egg): the rim height at the opening, the sac's extent at the apex, plus the ripple. */
export function domeZ(p: EmergenceParams, x: number, y: number, time = 0): number {
  const lip = lipOpening(p);
  const q = Math.hypot(x / lip.hw, y / lip.hh);
  // The rise may go NEGATIVE once the egg has left: the empty sheet dishes back behind the bowed lip's rim (sucked back into the frame).
  const rise = sacExtent(p) - lip.z;
  const wr = p.heal > 0 && q < 1 ? wrinkleAmp(p) * wrinkle(x, y, q) : 0;
  return lip.z + (p.slump > 0 ? rise : Math.max(0, rise)) * profile(q) + rippleAt(p, q, time) + wr;
}

/** THE SHEET's height seen from the front (the top of `sacSolid`): the dome smooth-maxed with the egg's front plus the skin, plus the ripple.
 *  `time` only feeds the ripple. Inside the egg's silhouette it is the egg's front cap; outside it, the dome (the sac's tapering wall,
 *  which curves back under the egg's equator, is an overhang a heightfield cannot hold: `sacSolid` has it). */
export function sacZ(p: EmergenceParams, x: number, y: number, time = 0): number {
  const lip = lipOpening(p);
  const q = Math.hypot(x / lip.hw, y / lip.hh);
  const dome = domeZ({ ...p, ripple: 0 }, x, y);
  const f = eggFront(p, x, y, (1 - eggHeld(p)) * EGG_LEAVE);
  const wrapped = f === null ? dome : smax(dome, f + SKIN, SAC_BLEND.cap);
  return wrapped + rippleAt(p, q, time);
}

/** The sac solid's smooth-union blends. `cap` in front of the egg's equator (round the front cap); behind it the blend widens over `run`
 *  metres to the TENT blend, `rest` before the push and `tent` at full push: that wide fillet curves the wall from the egg's equator back
 *  to the dome and the lip, so the sac reads as a balloon on its neck, not as the egg's silhouette swept back to the glass (round one's
 *  rigid tube). Narrow at rest, so the glass does not bulge toward the egg waiting in the tube. */
export const SAC_BLEND = { cap: 0.04, rest: 0.02, tent: 0.12, run: 0.12 } as const;

/** The blend at depth z, the egg's centre at depth cz. */
export function sacBlend(push: number, z: number, cz: number): number {
  const tent = lerp(SAC_BLEND.rest, SAC_BLEND.tent, smooth(push));
  return lerp(SAC_BLEND.cap, tent, smooth((cz - z) / SAC_BLEND.run));
}

/** iq's approximate ellipsoid distance (centred at the origin, semi-axes r): the shader's scrEllipsoid. */
export function ellipsoidDist(q: Vec3, r: Vec3): number {
  const k0 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
  const k1 = Math.hypot(q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2]));
  return k1 < 1e-6 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
}

/** THE SAC SOLID's signed distance at v (negative inside): the dome's heightfield (first-order distance, z - h over sqrt(1 + |grad h|^2))
 *  smooth-unioned with the egg grown by the skin, blend `sacBlend`. The sheet is a thin shell round it. The shader's mapScr builds the same
 *  solid (and clips it to the bezel's opening and floors it a little behind the glass, which this twin leaves out). */
export function sacSolid(p: EmergenceParams, v: Vec3, time = 0): number {
  const [x, y, z] = v, e = 1e-4;
  const h = domeZ(p, x, y, time);
  const gx = (domeZ(p, x + e, y, time) - domeZ(p, x - e, y, time)) / (2 * e);
  const gy = (domeZ(p, x, y + e, time) - domeZ(p, x, y - e, time)) / (2 * e);
  const dome = (z - h) / Math.sqrt(1 + gx * gx + gy * gy);
  const c = eggCentre(p);
  const egg = ellipsoidDist([x - c[0], y - c[1], z - c[2]], [EGG.rx, EGG.ry, EGG.rz]) - SKIN + (1 - eggHeld(p)) * EGG_LEAVE;
  return smin(dome, egg, sacBlend(p.push, z, c[2]));
}

/** The sheet's half-thickness at (x, y): thinner with the stretch (the dome's height over the opening) and with `thin`; never gone. */
export function sheetThickness(p: EmergenceParams, x: number, y: number): number {
  const lip = lipOpening(p);
  const stretch = Math.min(1, sacZ({ ...p, ripple: 0 }, x, y) / SAC_MAX) * (1 - Math.min(1, Math.hypot(x / lip.hw, y / lip.hh)) * 0.5);
  return THICK0 * (1 - 0.8 * Math.max(stretch, smooth(p.thin) * 0.6)) + 0.0006;
}

/** The tear's raggedness: harmonics (amplitude, frequency in theta, phase). The shader's scrTear is built from this table. */
export const TEAR_RAG: readonly (readonly [number, number, number])[] = [[0.22, 5, 1.3], [0.12, 11, 0.4], [0.06, 23, 2.1]];

/** THE KNIT (Task 8): as the sheet heals the tear closes as a wound does, not as a shrinking circle: its edges draw together across
 *  `angle` (radians round the axis) first, so the hole narrows to a slit along that angle and then zips shut. `minor` is the slit's width
 *  (as a fraction of its length) at full knit; the knit runs with the heal over `over` of it. */
export const TEAR_KNIT = { angle: 0.35, minor: 0.12, over: 0.45 } as const;
/** The knit's polar radius factor at angle theta (an ellipse of axes 1 and b through the tip, b from 1 to TEAR_KNIT.minor). */
export function knitFactor(heal: number, theta: number): number {
  const b = 1 - (1 - TEAR_KNIT.minor) * smooth(heal / TEAR_KNIT.over);
  const c = Math.cos(theta - TEAR_KNIT.angle), s = Math.sin(theta - TEAR_KNIT.angle);
  return b / Math.sqrt(b * b * c * c + s * s);
}

/** The tear's radius around the tip (the sheet's apex axis) at angle `theta`: grows with `tear`, ragged by a deterministic harmonic sum,
 *  narrowed to a slit by the knit as it heals. */
export function tearRadius(p: EmergenceParams, theta: number): number {
  const t = smooth(p.tear);
  if (t === 0) return 0;
  let rag = 1;
  for (const [a, k, ph] of TEAR_RAG) rag += a * Math.sin(k * theta + ph);
  return TEAR_R_MAX * t * rag * knitFactor(p.heal, theta);
}

/** The tear's tip: the sheet's apex, on the apex axis (x, y) = (0, 0). The tear is a ragged SPHERE round it (radius tearRadius at the angle
 *  round the axis): on the front cap that is a near-circular opening, and it runs back down the sac's walls the way a tear in a membrane
 *  does, not as round one's straight cut along z (a cylinder grazes the walls in long slivers). The shader reads the tip's z from the page. */
export const tearTip = (p: EmergenceParams, time = 0): Vec3 => [0, 0, sacZ(p, 0, 0, time)];

/** The point of the tear's edge on the sheet at angle `theta` round the axis: on sacZ, where the distance from the tip crosses tearRadius
 *  (bisection along the ray from the axis; the distance grows outward). Where the sheet drops down the sac's wall at the egg's silhouette
 *  (sacZ jumps there) the crossing is AT the wall: the edge sits on the silhouette. The goo's strands leave the lip here. A closed tear gives
 *  the tip. */
export function tearEdge(p: EmergenceParams, theta: number, time = 0): Vec3 {
  const tip = tearTip(p, time), R = tearRadius(p, theta), cx = Math.cos(theta), cy = Math.sin(theta);
  if (R <= 0) return tip;
  const out = (r: number) => Math.hypot(r, sacZ(p, r * cx, r * cy, time) - tip[2]) > R;
  let lo = 0, hi = R;
  for (let i = 0; i < 10; i++) { const m = 0.5 * (lo + hi); if (out(m)) hi = m; else lo = m; }
  return [lo * cx, lo * cy, sacZ(p, lo * cx, lo * cy, time)];
}

/** THE PICTURE: the sheet stretches, so the picture is read through a radial table: entry i is the picture radius (0..1) at normalised sheet
 *  radius i / (N - 1), the cumulative arclength of the dome profile normalised to its total. At rest it is the identity. The shader reads this table. */
export function pictureTable(p: EmergenceParams): Float32Array {
  const n = PICTURE_TABLE_N, lip = lipOpening(p);
  const rise = Math.abs(sacExtent(p) - lip.z), span = 0.5 * (lip.hw + lip.hh);
  const out = new Float32Array(n);
  let acc = 0;
  const speed = (q: number) => { const e = 1e-4, d = (profile(Math.min(1, q + e)) - profile(Math.max(0, q - e))) / (Math.min(1, q + e) - Math.max(0, q - e)); return Math.hypot(1, (rise * d) / span); };
  const STEPS = 8;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < STEPS; k++) acc += speed(((i - 1) + (k + 0.5) / STEPS) / (n - 1)) / (STEPS * (n - 1));
    cum.push(acc);
  }
  for (let i = 0; i < n; i++) out[i] = cum[i]! / acc;
  return out;
}

/** The picture coordinate (each -1..1 across the glass) of the sheet point above (x, y). Identity at rest. */
export function pictureUV(p: EmergenceParams, x: number, y: number): [number, number] {
  const lip = lipOpening(p);
  const mx = x / lip.hw, my = y / lip.hh, q = Math.hypot(mx, my);
  if (q === 0) return [0, 0];
  const tab = pictureTable(p), f = Math.min(q, 1) * (PICTURE_TABLE_N - 1), i = Math.min(PICTURE_TABLE_N - 2, Math.floor(f));
  const g = lerp(tab[i]!, tab[i + 1]!, f - i);
  const s = (q <= 1 ? g : q) / q;
  return [(mx * s) * (lip.hw / GLASS.hw), (my * s) * (lip.hh / GLASS.hh)];
}

// ---------------------------------------------------------------------------
// THE EGG'S LOOK (look round 1, Task B): an EGGSHELL, not glass. The owner: "a less shiny glass appearance and a more speckled kind of egg
// appearance overall; in intense light underneath or against it you can see something moving, but otherwise it's less glass and more egg
// shell." The shader's scrShell, scrSpeckle and scrFigure are built from these tables.
// ---------------------------------------------------------------------------

/** The shell's surface: `base` the cream albedo, `speck` the speckles' brown; speckles sit one per `cell` (m) cube at most, present with
 *  probability `density`, rising by `fat` toward the egg's top (the blunt end, it stands on it); their radius runs `rMin`..`rMax` (3 to 9 mm
 *  across), weighted to the small; `pepper` a finer, fainter layer (cell, radius, density); `grain` the fine shell texture's albedo
 *  amplitude, `mottle` the broad tone variation; `wrap` the diffuse's wrap (a soft terminator, not the glass's hard one); the highlight is
 *  broad and dim (`specPow`, `spec`): no clear coat; `deskFill` the warm bounce off the lamp-lit desk on its underside (so away from the
 *  lamp it stays cream, not the street fill's grey). */
export const SHELL = {
  base: [0.93, 0.88, 0.76], speck: [0.4, 0.23, 0.12], cell: 0.011, density: 0.55, fat: 0.3, rMin: 0.0015, rMax: 0.0045,
  pepper: { cell: 0.005, r: 0.0012, density: 0.5, amt: 0.5 }, grain: 0.07, mottle: 0.06, wrap: 0.6, specPow: 10, spec: 0.07, deskFill: [0.07, 0.045, 0.028],
} as const;
/** The shell's TRANSMISSION: light from behind the egg (relative to the eye) comes through it warm (`col`). `back` the lamp's backlight
 *  gain, its lobe `backPow` and the normal's `distort` (the lobe widens toward the silhouette); `thick` the falloff per metre of the chord
 *  the eye's ray makes through the egg (the thin edge glows most); `centre` the glow through the middle when the lamp is straight behind
 *  the egg from the eye (the lobe `centrePow` of that alignment: candling); `leak` the shadow side's general translucency. The egg's OWN light (the
 *  timeline's glow, a light at its centre) shows through by `inner` while the sac holds it, falling to `innerOut` of that once it is out
 *  (on the desk it is an eggshell, the figure showing only in a strong light behind or under it); `below` the light from under it: the
 *  desk's bounce of the lamp (`bounce`) and the pool's warm soak, lighting it through its foot within `belowR` m. */
export const SHELL_LIGHT = {
  col: [1.0, 0.56, 0.26], back: 0.9, backPow: 6, distort: 0.35, thick: 9, centre: 0.8, centrePow: 12, leak: 0.08, inner: 0.75, innerOut: 0.04,
  below: 0.6, bounce: 0.35, belowR: 0.06,
} as const;

/** THE FIGURE inside the egg: Gaussian blobs (centre offset from the figure's origin, scales; metres), each darkening the light coming
 *  through the shell by `depth` times its line integral along the eye's ray (closed form, as the control room's egg's eggGauss): a body, a
 *  head and a limb that flexes. It only shows where the shell glows (it darkens the transmitted light, never the lit surface). Sized for the
 *  egg: 0.88 of the 80% egg's (the second notes' smaller egg), the drift kept. */
export const FIGURE_BLOBS = [
  { pos: [0, -0.016, 0], sc: [0.026, 0.037, 0.026] },
  { pos: [0.014, 0.026, 0.004], sc: [0.021, 0.021, 0.021] },
  { pos: [-0.026, -0.03, 0.009], sc: [0.01, 0.023, 0.01] },
] as const;
export const FIGURE_DEPTH = 44;
/** The figure's DRIFT round the egg's centre: a slow Lissajous per axis (amplitude m, frequency rad/s, phase), so in two frames a second
 *  apart it has visibly moved (2 to 4 cm) while staying well inside the shell; the head nods (`nod`: amplitude in m along x and z at its
 *  own frequency) and the limb flexes (`flex`: its offset scaled by 1 + amp sin(freq t)). */
export const FIGURE_DRIFT = {
  axes: [[0.03, 1.13, 0.4], [0.026, 0.87, 1.9], [0.022, 1.31, 2.7]],
  nod: [0.012, 1.7, 0.6], flex: [0.3, 2.3, 0.2],
} as const;

/** The figure's three blobs' centres at time t, offsets from the egg's centre (the shader's scrFigure, its twin, builds the same terms). */
export function figureAt(t: number): Vec3[] {
  const o = FIGURE_DRIFT.axes.map(([a, w, ph]) => a * Math.sin(w * t + ph)) as Vec3;
  const [na, nw, nph] = FIGURE_DRIFT.nod, [fa, fw, fph] = FIGURE_DRIFT.flex;
  const nod = na * Math.sin(nw * t + nph), flex = 1 + fa * Math.sin(fw * t + fph);
  const [b, h, l] = FIGURE_BLOBS;
  return [
    [o[0] + b.pos[0], o[1] + b.pos[1], o[2] + b.pos[2]],
    [o[0] + h.pos[0] + nod, o[1] + h.pos[1], o[2] + h.pos[2] + 0.6 * nod],
    [o[0] + l.pos[0] * flex, o[1] + l.pos[1] * flex, o[2] + l.pos[2] * flex],
  ];
}

/** THE MEMBRANE'S VEINS: a branching tree, not round one's long sine curves. `n` trunks round the axis from the lip, each forking three times
 *  at `forks` (fractions of the way from the lip to the apex, jittered by `jitter`), each fork opening over `open` of that way, the children
 *  spreading by `spread` (fractions of the trunk's sector) and narrowing by `taper`; a child of fork k ENDS with probability `ends[k]`
 *  somewhere within `reach` after its fork (so the fine branches are twigs, not all running on to the apex); widths in metres from `w0`,
 *  thinning toward the apex (`apexThin`) and with the sheet's thinning (`thinThin`); `wander` the branches' sideways meander (fraction of the
 *  sector; the shader keeps every branch inside its trunk's sector, so where the meanders add up a branch runs along the sector's edge). */
export const VEIN_TREE = {
  n: 7, w0: 0.007, forks: [0.16, 0.36, 0.56], jitter: 0.1, open: 0.07, spread: [0.2, 0.1, 0.05], ends: [0, 0.35, 0.6], reach: [0.1, 0.32],
  taper: 0.68, wander: 0.11, apexThin: 0.5, thinThin: 0.45,
} as const;
