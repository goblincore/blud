// src/lab/sdf-zombie/webgpu/egg-look.ts
//
// THE CONTROL ROOM'S EGG (spec 2026-09-30-night-train-egg-ending-design.md §1-§2), as pure maths.
// A red-veined transparent outer egg around a milky, spotted inner egg that holds a soft dark
// figure against a warm core glow. TypeScript twin of egg.wgsl.ts: the WGSL draws, this tests; the
// tuning table and the figure table below are the single source for both (the WGSL is built from
// them). Veins and the surface lighting are WGSL-only. Pure: no three.js, no DOM.
//
// Frame: game axes, x east, y up, -z north; the door (the player) is on the +z side, so the figure
// faces +z. All sizes in metres.

export type Vec3 = [number, number, number];

export const EGG = {
  /** Outer egg semi-axes: a across (x and z), b high. The kit's egg-placeholder. */
  a: 0.95, b: 1.3,
  /** Inner egg: scale of the outer, and its centre's drop below the outer's (m). */
  innerScale: 0.6, innerDy: -0.12,
  /** The warm core glow behind the figure: centre offset from the inner centre, Gaussian scale (x, y, z), gain. */
  coreOffset: [0, 0, -0.2] as Vec3, coreScale: [0.3, 0.5, 0.18] as Vec3, coreGain: 5.0,
  /** The figure's centre offset from the inner centre, and the strength of its absorption (the optical depth through its
   *  middle comes out near 1 at resolve 0.5: a Gaussian blob's peak is strength / blur x sqrt(pi) x its depth scale). */
  figureOffset: [0, -0.02, -0.08] as Vec3, figureStrength: 3.2,
  /** Milk: extinction per metre inside the inner egg, the inner front surface's alpha, the outer shell's alpha. */
  milkSigma: 1.4, milkFront: 0.18, shellAlpha: 0.3,
  /** Figure blur at resolve 0 (far) and 1 (sharpest): a multiplier on the blobs' widths. */
  blurFar: 1.7, blurNear: 1.0,
  /** The default `egg.resolve` setting (0 = always a smudge, 1 = sharpens fully when you are close). */
  resolveDefault: 0.5,
  /** Resolve ramps from 0 at resolveFar to the setting at resolveNear (m from the egg's centre). */
  resolveNear: 1.8, resolveFar: 5.0,
  /** Proximity (pulse speed-up) ramps from 0 at proxFar to 1 at proxNear. */
  proxNear: 1.8, proxFar: 6.0,
  /** Beats per second: the base, and what is added at proximity 1. */
  pulseRate: 1.0, pulseRateNear: 1.6,
  /** Surface spots on the inner egg. */
  spots: 24,
} as const;

/** The figure: soft Gaussian blobs, offsets from the figure centre and Gaussian scales (x, y, z), at innerScale 0.6. */
export const FIGURE: ReadonlyArray<{ pos: Vec3; sc: Vec3 }> = [
  { pos: [0.01, -0.10, 0], sc: [0.20, 0.32, 0.14] },   // body
  { pos: [-0.07, 0.25, 0], sc: [0.12, 0.13, 0.10] },   // head
  { pos: [0.17, -0.18, 0], sc: [0.08, 0.20, 0.07] },   // limb
  { pos: [-0.16, -0.26, 0], sc: [0.07, 0.18, 0.06] },  // limb
  { pos: [0.13, 0.15, 0], sc: [0.10, 0.13, 0.08] },    // hump
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Ray vs an axis-aligned ellipsoid (centre c, semi-axes r). [t0, t1] along the unit ray, or null when it misses or lies behind. */
export function rayEllipsoid(o: Vec3, d: Vec3, c: Vec3, r: Vec3): [number, number] | null {
  const oq: Vec3 = [(o[0] - c[0]) / r[0], (o[1] - c[1]) / r[1], (o[2] - c[2]) / r[2]];
  const dq: Vec3 = [d[0] / r[0], d[1] / r[1], d[2] / r[2]];
  const a = dot(dq, dq), b = dot(oq, dq), cc = dot(oq, oq) - 1;
  const disc = b * b - a * cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b + s) / a;
  if (t1 < 0) return null;
  return [(-b - s) / a, t1];
}

/** Line integral of exp(-|(p - c) / s|^2) along the unit ray o + t d, in closed form, and the t of closest approach. */
export function gaussLine(o: Vec3, d: Vec3, c: Vec3, s: Vec3): { value: number; t: number } {
  const oq: Vec3 = [(o[0] - c[0]) / s[0], (o[1] - c[1]) / s[1], (o[2] - c[2]) / s[2]];
  const dq: Vec3 = [d[0] / s[0], d[1] / s[1], d[2] / s[2]];
  const dd = dot(dq, dq);
  const t = -dot(oq, dq) / dd;
  const h: Vec3 = [oq[0] + dq[0] * t, oq[1] + dq[1] * t, oq[2] + dq[2] * t];
  return { value: (Math.sqrt(Math.PI) / Math.sqrt(dd)) * Math.exp(-dot(h, h)), t };
}

/** The inner egg's centre for an egg centred at `c`. */
export function innerCentre(c: Vec3): Vec3 {
  return [c[0], c[1] + EGG.innerDy, c[2]];
}

/** The figure's blur multiplier at a resolve value 0..1. */
export function blurFor(resolve: number): number {
  return EGG.blurFar + (EGG.blurNear - EGG.blurFar) * clamp01(resolve);
}

/** Optical depth of the figure along a ray. Only blobs whose closest approach comes before `tCore`
 *  (in front of the glow, from this side) count: default Infinity = all of them. */
export function figureTau(o: Vec3, d: Vec3, egg: Vec3, resolve: number, tCore: number = Infinity): number {
  const blur = blurFor(resolve), k = EGG.innerScale / 0.6, ci = innerCentre(egg);
  let tau = 0;
  for (const b of FIGURE) {
    const pos: Vec3 = [
      ci[0] + (EGG.figureOffset[0] + b.pos[0]) * k, ci[1] + (EGG.figureOffset[1] + b.pos[1]) * k, ci[2] + (EGG.figureOffset[2] + b.pos[2]) * k,
    ];
    const g = gaussLine(o, d, pos, [b.sc[0] * k * blur, b.sc[1] * k * blur, b.sc[2] * k * blur]);
    // Dividing by the blur keeps a blob's peak absorption constant while it spreads.
    if (g.t < tCore) tau += (EGG.figureStrength / blur) * g.value;
  }
  return tau;
}

/** The core glow's line integral (x gain) along a ray, and its t of closest approach. */
export function coreEmission(o: Vec3, d: Vec3, egg: Vec3): { value: number; t: number } {
  const k = EGG.innerScale / 0.6, ci = innerCentre(egg);
  const g = gaussLine(o, d,
    [ci[0] + EGG.coreOffset[0] * k, ci[1] + EGG.coreOffset[1] * k, ci[2] + EGG.coreOffset[2] * k],
    [EGG.coreScale[0] * k, EGG.coreScale[1] * k, EGG.coreScale[2] * k]);
  return { value: g.value * EGG.coreGain, t: g.t };
}

/** Transmittance of the milk over a chord of `len` metres inside the inner egg. */
export function innerTransmit(len: number): number {
  return Math.exp(-EGG.milkSigma * len);
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Spot i of n: a unit direction on the inner egg (a golden spiral). */
export function spotDirection(i: number, n: number = EGG.spots): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * GOLDEN;
  return [Math.cos(phi) * r, y, Math.sin(phi) * r];
}

/** Spot i's angular radius (rad): 0.10 to 0.31. */
export function spotRadius(i: number): number {
  return 0.1 + 0.035 * ((i * 5) % 7);
}

/** A heartbeat: a strong thump at phase 0, a softer one at 0.28; 0..1. */
export function eggBeat(phase: number): number {
  const p = phase - Math.floor(phase);
  const g = (x: number, w: number) => Math.exp(-((x / w) ** 2));
  return Math.min(1, g(p, 0.07) + 0.6 * g(p - 0.28, 0.09) + g(p - 1, 0.07));
}

/** The pulse the glow follows: never fully dark. */
export function eggPulse(phase: number): number {
  return 0.55 + 0.45 * eggBeat(phase);
}

/** 0 beyond proxFar, 1 within proxNear. */
export function eggProximity(dist: number): number {
  return 1 - smoothstep(EGG.proxNear, EGG.proxFar, dist);
}

/** The beat phase after dt seconds; the rate rises with proximity. Result in 0..1. */
export function advancePhase(phase: number, dt: number, prox: number): number {
  const p = phase + dt * (EGG.pulseRate + EGG.pulseRateNear * prox);
  return p - Math.floor(p);
}

/** How well the figure resolves: 0 at range, `setting` at point blank. */
export function eggResolve(dist: number, setting: number): number {
  return clamp01(setting) * (1 - smoothstep(EGG.resolveNear, EGG.resolveFar, dist));
}
