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
/** The stand-in egg (bigger than the glass, owner): semi-axes, and the centre's depth behind the glass at rest and at full push. */
export const EGG = { rx: 0.175, ry: 0.225, rz: 0.175, z0: -0.25, z1: 0.55 } as const;
/** The desk's top below the glass centre, and where the slumped egg rests: ON the desk, in front of the glass, overhanging the keyboard
 *  (z 0.09 to 0.25 in the lab's set). 0.4 hung it over the goblin's knees (z about 0.38) and past the desk's front edge; the lab's desk top
 *  reaches the egg's front (EGG_REST z + EGG.rz, 0.355) so it lies on wood. */
export const DESK_Y = -0.32;
export const EGG_REST: Vec3 = [0, DESK_Y + EGG.ry, 0.18];
/** The sac's apex at full push: the egg's front plus the skin (about 0.73 m, "most of a metre"). */
export const SAC_MAX = EGG.z1 + EGG.rz + SKIN;
/** The sheet's half-thickness at rest (m), and the tear's largest radius. */
export const THICK0 = 0.004;
export const TEAR_R_MAX = 0.17;
/** The lip: how far it bows out in z and how much the opening widens (fractions of the glass) at full bow. */
export const LIP = { bowZ: 0.1, openX: 0.3, openY: 0.5 } as const;
export const RIPPLE = { amp: 0.012, freq: 24, speed: 9 } as const;
/** The picture table's size (entries 0..N-1 cover normalised radius 0..1). */
export const PICTURE_TABLE_N = 33;

export const smooth = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Polynomial smooth maximum (iq), blend width k. */
export const smax = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
/** Polynomial smooth minimum (iq), the same form. */
export const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** The egg's centre: pushing through the glass (x, y = 0), then slumping to the desk. */
export function eggCentre(p: EmergenceParams): Vec3 {
  const z = lerp(EGG.z0, EGG.z1, smooth(p.push));
  const s = smooth(p.slump);
  return [0, lerp(0, EGG_REST[1], s), lerp(z, EGG_REST[2], s)];
}

/** The egg's front surface depth at (x, y), or null outside its silhouette. */
export function eggFront(p: EmergenceParams, x: number, y: number): number | null {
  const c = eggCentre(p);
  const q = (x / EGG.rx) ** 2 + ((y - c[1]) / EGG.ry) ** 2;
  return q >= 1 ? null : c[2] + EGG.rz * Math.sqrt(1 - q);
}

/** The lip: the opening's half sizes widened by the bow, and the rim's height. */
export function lipOpening(p: EmergenceParams): { hw: number; hh: number; z: number } {
  const b = smooth(p.lipBow);
  return { hw: GLASS.hw * (1 + LIP.openX * b), hh: GLASS.hh * (1 + LIP.openY * b), z: LIP.bowZ * b };
}

/** The sac's apex height: grows with the push, sags to half when the egg leaves, sucks back with the heal. */
export const sacExtent = (p: EmergenceParams) => SAC_MAX * smooth(p.push) * (1 - 0.5 * smooth(p.slump)) * (1 - smooth(p.heal));

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
  return lip.z + Math.max(0, sacExtent(p) - lip.z) * profile(q) + rippleAt(p, q, time);
}

/** THE SHEET's height seen from the front (the top of `sacSolid`): the dome smooth-maxed with the egg's front plus the skin, plus the ripple.
 *  `time` only feeds the ripple. Inside the egg's silhouette it is the egg's front cap; outside it, the dome (the sac's tapering wall,
 *  which curves back under the egg's equator, is an overhang a heightfield cannot hold: `sacSolid` has it). */
export function sacZ(p: EmergenceParams, x: number, y: number, time = 0): number {
  const lip = lipOpening(p);
  const q = Math.hypot(x / lip.hw, y / lip.hh);
  const dome = domeZ({ ...p, ripple: 0 }, x, y);
  const f = eggFront(p, x, y);
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
  const egg = ellipsoidDist([x - c[0], y - c[1], z - c[2]], [EGG.rx, EGG.ry, EGG.rz]) - SKIN;
  return smin(dome, egg, sacBlend(p.push, z, c[2]));
}

/** The sheet's half-thickness at (x, y): thinner with the stretch (the dome's height over the opening) and with `thin`; never gone. */
export function sheetThickness(p: EmergenceParams, x: number, y: number): number {
  const lip = lipOpening(p);
  const stretch = Math.min(1, sacZ({ ...p, ripple: 0 }, x, y) / SAC_MAX) * (1 - Math.min(1, Math.hypot(x / lip.hw, y / lip.hh)) * 0.5);
  return THICK0 * (1 - 0.8 * Math.max(stretch, smooth(p.thin) * 0.6)) + 0.0006;
}

/** The tear's radius around the tip (the sheet's apex axis) at angle `theta`: grows with `tear`, ragged by a deterministic harmonic sum. */
export function tearRadius(p: EmergenceParams, theta: number): number {
  const t = smooth(p.tear);
  if (t === 0) return 0;
  const rag = 1 + 0.22 * Math.sin(5 * theta + 1.3) + 0.12 * Math.sin(11 * theta + 0.4) + 0.06 * Math.sin(23 * theta + 2.1);
  return TEAR_R_MAX * t * rag;
}

/** THE PICTURE: the sheet stretches, so the picture is read through a radial table: entry i is the picture radius (0..1) at normalised sheet
 *  radius i / (N - 1), the cumulative arclength of the dome profile normalised to its total. At rest it is the identity. The shader reads this table. */
export function pictureTable(p: EmergenceParams): Float32Array {
  const n = PICTURE_TABLE_N, lip = lipOpening(p);
  const rise = Math.max(0, sacExtent(p) - lip.z), span = 0.5 * (lip.hw + lip.hh);
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
