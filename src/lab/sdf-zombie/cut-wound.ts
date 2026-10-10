// src/lab/sdf-zombie/cut-wound.ts
//
// CUT WOUNDS (spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §3-4). Pure. A cut is a wound SHAPE beside the
// crater: a blade SLOT along a segment, deepest and widest at its middle (a squared lens, cutTaper, closing into needle
// tips), its walls closing into a V, jagged (and pinched toward the tips) and lipped on the GPU. It rides one prim
// exactly like a crater: `local` is its midpoint, `radius` its HALF-LENGTH (the shader's reach and the threat box are
// supersets of the slot; plain `radius` consumers are NOT: the occluder-hull exclusions at game-main.ts and
// game-seams-render.ts treat it as a sphere about `local`, which misses the slot's sag, lip and width; mostly
// absorbed by WOUND_CLEARANCE 0.05), `carveN`/`carveDepth` its inward direction and depth, `cutDir` its along-segment
// unit, `kerf` its half-width at the skin. `cutCarve` is the CPU mirror of the WGSL slot (applyWounds' cut branch) for tests
// and docs; keep the two identical apart from the GPU's noise.
// The sweep grouping fixes single-sample jitter only: two-sample jitter or a lone end sample can still split a run (acceptable
// for v1).
//
// A cut is tagged type 'pellet' for profile purposes (the rim / upload paths treat it as a pellet-sized wound) and is always
// wetLip: both are deliberate for now, not an oversight.
import { fleshBehind, unwarpHit, worldDirToWoundLocal, woundDirToWorld, woundWorldPos, worldHitToWound, type Wound } from './damage';
import { hash13, noise3, sdPrimitive, type Body } from './validate';
import { add, cross, dot, normalize, scale, sub } from './vec';
import type { Primitive, Vec3 } from './types';

export const CUT = {
  minLen: 0.03,
  /** 0.35 -> 0.45 (2026-10-04 look pass, "too short"): a long sweep may leave a longer gash. */
  maxLen: 0.45,
  maxPerSlash: 3,
  /** map-body.wgsl.ts gLimbSlack (0.2 m) assumes no carve deeper than 0.16 m. */
  maxDepth: 0.15,
  /** A cut may reach this share of the flesh measured behind its midpoint. */
  thickFrac: 0.8,
  /** Half-width at the skin (m) when a cut wound carries no kerf of its own. */
  defaultKerf: 0.01,
  /** cutsFromSweep stretches each run's segment by this about its midpoint (before the maxLen clamp): the slot's tails
   *  taper to nothing (cutTaper), so its full-width core is shorter than the slot; the stretch keeps that core about
   *  as long as the swept chord and lets the ragged tails run past where the blade left the skin. */
  tailGain: 1.4,
} as const;

/** The WGSL slot's look constants (interpolated into fields/wounds.wgsl.ts like torn-lips.ts's TORN). */
export const CUT_SHADE = {
  /** Fine jag on the walls (GPU noise3 in the slot frame): `jagCycles` noise cycles per kerf, so the jag's slope
   *  relative to the kerf is the same at every width (the old fixed 90 / m was 1.35 cycles per kerf at 0.015 and grew
   *  steeper as the kerf grew), and how much it widens or narrows the local kerf. 0.35 -> 0.5 (look pass: rougher). */
  jagCycles: 1.2,
  jagAmp: 0.5,
  /** Coarse PINCH along the slot (GPU 1-D value noise in a / halfLen): `pinchCycles` per half-length, amplitude
   *  `pinchAmp` mid-slot rising by `pinchTip` x tN^2 toward the tips, where fine + pinch can pass -1 and close the slot,
   *  so the tails break up into ragged islands instead of stopping clean. Both noises enter the CPU mirror as `jag`. */
  pinchCycles: 3.5,
  pinchAmp: 0.25,
  pinchTip: 0.6,
  /** Field scale for the slot (the zero set is unchanged). MEASURED, not argued: cutCarve's max |grad| over a dense
   *  grid, WGSL-shaped call included, is pinned <= 2.2 by cut-wound.test.ts (the numbers live there and in
   *  docs/dev-notes/2026-10-04-cut-excess/NOTES.md). */
  carveK: 0.7,
  /** A slot's depth never exceeds this x its half-length: the floor term's slope is depth x cutTaper' (max 1.54 / halfLen
   *  for the squared lens, was 2 / halfLen for the plain one), so a deep, very short slot would be a wall the march
   *  steps through. 1.4 bounds the floor term at 0.7 x sqrt(1 + 2.16^2) ~ 1.67 (was ~2.08). */
  maxDepthPerHalfLen: 1.4,
  /** A slot's kerf never exceeds this x its half-length (stampCut clamps it). Every along-slot slope (the kerf's and the
   *  lip's taper) is kerf / halfLen x a constant, so this is what makes a wider kerf Lipschitz-safe: the 0.022 axe kerf
   *  failed (2.63) at a 0.015 half-length, where kerf / halfLen was 1.5; it is now at most 0.3. */
  kerfPerHalfLen: 0.3,
  /** Lip: centre offset from the slot axis, width and height, all x kerf; height also x META.z (rim splay scale). Look
   *  pass: 1.5 / 1.2 / 0.9 -> 1.7 / 1.5 / 1.3 (bigger, broader, more everted ridges; with rimSpan the ridge stands
   *  ~2-3x taller at the same kerf). 1.4 measured 2.13 (the jagged wall cutting into the lip's inner flank, lip scale
   *  1.1). */
  lipOffset: 1.7,
  lipWidth: 1.5,
  lipHeight: 1.3,
  /** The lip's rim gate band (cutLip `rimB`) is this x max(peak lip height, lip width). The gate's slope across the
   *  skin is 1.5 x amp / rimB on top of the body's own 1, and it is also what cuts the ridge short: at the old 1 the gate
   *  was already closed where the ridge's top would be (the raise was ~0.4 of the peak height). 2 halves the slope and
   *  lets the ridge stand taller. */
  rimSpan: 2,
  /** The cut lip's scale (META.z = pellet rimSplayScale 0.8 x calibre lip) is clamped to this, and the whole-field
   *  Lipschitz test runs at it as well as at the rod's 0.8. */
  maxLipScale: 1.1,
  /** The shading mask's soft edge, x kerf (2.2 -> 3: a wider wet band). */
  maskWidth: 3,
  /** The mask runs this x halfLen along the slot, narrowing to nothing (sqrt of its own lens): a wet scratch past the
   *  carve's tips, so the gash does not stop on a clean line. */
  maskEnd: 1.3,
  /** GPU noise on the mask band's width (a ragged, blotchy wet edge), `maskCycles` noise cycles per kerf (coarser than
   *  the wall jag: blotches about 1.7 kerfs across); the CPU mirror takes it as `jag`, bounded by maskJag. Shading only,
   *  so no slope limit applies. */
  maskCycles: 0.6,
  maskJag: 0.6,
  /** The slot's smax fillet (applyWounds: woundCfg.y x clamp(kerf / 0.05, 0.1, 1)) reads its kerf capped at this x dEff
   *  (cutBlendK). The fillet raises the field within 4 x its width of the slot's floor, and on a thin limb's silhouette
   *  slash the floor sits only 0.2 x thick above the back skin (stampCut's thickFrac): at kerf 0.02 the 6 mm fillet
   *  raised that back skin 1.2 mm (an opening). Capped at half the depth it is the kerf-0.015 fillet there (0.3 mm), and
   *  unchanged on any slot at least 2 kerfs deep. */
  blendDepthFrac: 0.5,
  /** The mask's skin band beyond the slot (past (1 + jagAmp) kerfs, the fine-jagged walls' reach mid-slot, fading over
   *  the next 0.3 of that) is kept on skin that faces out of the cut's mouth: it fades from dot(nrm, inward) =
   *  maskFace[0] to maskFace[1]. On a thin limb the wide band otherwise wrapped round to the sides and back (the walls and
   *  floor, inside the slot, keep the plain back-facing gate). The reach leaves out the pinch's +0.25 on purpose: with it
   *  the inner zone (2.3 kerfs) reached the back-facing side of a 0.05 m arm (0.137 there at kerf 0.02); without it the
   *  arm's skin inside the zone faces back past 0.6 and the back gate zeroes it. A wall the noise pushes past 1.5 kerfs
   *  loses the band at its very top. */
  maskFace: [-0.45, -0.15],
  /** The lid's slack above the anchor's tangent plane, x halfLen (on top of one kerf): room for a concave crease's skin
   *  to rise above that plane without the lid closing the slot (cutCarve). */
  lidSlack: 0.25,
} as const;

/** The most the GPU's jag (fine + pinch, at a tip) can widen a slot, as a fraction of its local kerf: the threat box's
 *  side allowance (wound-threat.ts cutThreatWound) and the Lipschitz tests' noise sweep use it. */
export const CUT_JAG_MAX = CUT_SHADE.jagAmp + CUT_SHADE.pinchAmp + CUT_SHADE.pinchTip;

/** The slot's length profile at normalised position tN in [-1, 1]: the lens squared, (1 - tN^2)^2. Both the depth and the
 *  kerf follow it, so the walls close gradually into a needle at each tip (the old slot kept 35% of its kerf and one kerf
 *  of depth to its tips and then stopped on a hard end: "a neat tidy line"). Its slope is 0 at the tip and peaks at
 *  1.54 / halfLen at tN = 1/sqrt(3), lower than the plain lens's 2 / halfLen at the tip. With the kerf and the depth both
 *  proportional to it, the wall term kerfT (1 - s / depthT) is kerf (1 + jag) (taper - s / dEff): no 1/taper blow-up at
 *  the tips, so the old one-kerf depth floor is gone. */
export function cutTaper(tN: number): number {
  const prof = 1 - tN * tN;
  return prof * prof;
}

/** The slot's smax fillet width, as applyWounds computes it: woundK (the game's woundCfg.y, 0.015) x clamp(min(kerf,
 *  blendDepthFrac x dEff) / 0.05, 0.1, 1). */
export function cutBlendK(kerf: number, depth: number, halfLen: number, woundK = 0.015): number {
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  return woundK * clamp(Math.min(kerf, CUT_SHADE.blendDepthFrac * dEff) / 0.05, 0.1, 1);
}

/** The GPU's jag at a slot-frame point (`a` along, `u` side, `plane` = dot(rel, inward), all from the midpoint):
 *  applyWounds' fine wall jag plus its pinch, term for term, through validate.ts's CPU twins of hash13 / noise3 (f64
 *  against the GPU's f32: the last bits differ, the slope statistics do not). The Lipschitz tests feed it to cutCarve's
 *  `jag` at every sample, so the bound they pin includes the noise; nothing at runtime calls it. */
export function cutJag(a: number, u: number, plane: number, halfLen: number, kerf: number): number {
  const h = Math.max(halfLen, 1e-4);
  const jq = CUT_SHADE.jagCycles / Math.max(kerf, 1e-4);
  const fine = noise3([a * jq + halfLen * 311, u * jq + kerf * 977, plane * jq + 17]) * CUT_SHADE.jagAmp;
  const tN = clamp(a / h, -1, 1);
  const px = (a / h) * CUT_SHADE.pinchCycles + kerf * 1531;
  const pi = Math.floor(px), pf = px - pi;
  const h0 = hash13([pi, halfLen * 311, 5]), h1 = hash13([pi + 1, halfLen * 311, 5]);
  const pn = (h0 + (h1 - h0) * (pf * pf * (3 - 2 * pf))) * 2 - 1;
  return fine + pn * (CUT_SHADE.pinchAmp + CUT_SHADE.pinchTip * tN * tN);
}

/** A cut's near zone is SOFT. applyWounds reports `near` = 1 inside a crater's zone and this value inside a cut's column
 *  (every consumer that asks "near a wound?" tests > 0.5, so both read as near). mapBody's inside-flesh fold (organs,
 *  packed bones) asks more of a soft zone: it runs there only where some wound's carve RAISED the field at the sample.
 *  Those rows are contained in the flesh (validate.ts checkBoneContainment), so they can win the hard min only where
 *  the field stands above the pre-wound flesh, and a cut's column is mostly lip and open air above the slot: skipping
 *  the fold there is the same exact identity the near gate itself rests on. */
export const CUT_NEAR = 0.75;

/** Slack on the jag's ceiling (cutJagTop), in units of the jag: the GPU's noise is f32, and a trilinear mix of hashes in
 *  [0, 1) can pass 1 by an ulp (~1e-7), so the ceiling the shader tests against stands this far above the exact one. */
export const CUT_JAG_SLACK = 1e-3;

/** The most the GPU's jag can read at normalised slot position tN (the fine jag's amplitude plus the pinch's at that
 *  tN), plus CUT_JAG_SLACK: cutJag(a, u, plane, ...) <= cutJagTop(a / halfLen) everywhere. applyWounds' idle-carve test
 *  reads the carve at this ceiling (cutCarveTop) instead of reading the noise. */
export function cutJagTop(tN: number): number {
  return CUT_SHADE.jagAmp + CUT_SHADE.pinchAmp + CUT_JAG_SLACK + CUT_SHADE.pinchTip * tN * tN;
}

/** cutCarve with the jag at its ceiling: an upper bound of the carve at `p` whatever the noise reads there (the jag
 *  enters only the wall term, which grows with it). The CPU mirror of applyWounds' `carveTop`. */
export function cutCarveTop(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, dIn: number, sag: number): number {
  const tN = clamp(dot(sub(p, mid), along) / Math.max(halfLen, 1e-4), -1, 1);
  return cutCarve(p, mid, halfLen, along, inward, depth, kerf, dIn, sag, cutJagTop(tN));
}

/** THE IDLE CARVE: true where the cut's row cannot raise the running field `d` at a point whose carve ceiling is
 *  `carveTop` (cutCarveTop) and whose fillet is `blendK` (cutBlendK). The shader's quadratic smax(d, carve, k) is
 *  max(d, carve) + h^2 k with h = max(4 k - |d - carve|, 0) / (4 k): once d stands 4 k above the carve, h is exactly 0
 *  and the result is d to the bit. carve <= carveTop, so d - carveTop >= 4 k is enough, and applyWounds then skips the
 *  noise (a noise3 and two hash13) for that row at that sample. */
export function cutCarveIdle(d: number, carveTop: number, blendK: number): boolean {
  return !(d - carveTop < 4 * blendK);
}

/** THE IDLE LIP: true where one of cutLip's gates is exactly 0 at `p` (the rim gate past its band above the skin, the
 *  kerf gate inside the smooth kerf, the near-skin gate past its depth band), so cutLip is 0 there and applyWounds skips
 *  the bump. The CPU mirror of the lip block's guard; false only says the bump is computed. */
export function cutLipIdle(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, dIn: number, sag: number, lipScale: number): boolean {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), u = Math.abs(dot(rel, side));
  const s = Math.max(-dIn, dot(rel, inward) - sag);
  const taper = cutTaper(clamp(a / Math.max(halfLen, 1e-4), -1, 1));
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  const lipW = Math.max(kerf * CUT_SHADE.lipWidth, 1e-4);
  const amp0 = kerf * CUT_SHADE.lipHeight * Math.min(lipScale, CUT_SHADE.maxLipScale);
  const rimB = CUT_SHADE.rimSpan * Math.max(amp0, lipW);
  const rim = 1 - smoothstep(-0.3 * rimB, 0.7 * rimB, dIn);
  return !(rim > 0 && u > kerf * taper && s < Math.max(Math.min(2 * lipW, dEff), 1e-4));
}

/** THE IDLE BAND: true where cutMask is 0 at `p` whatever its noise reads (|jag| <= maskJag): the gates' product is 0,
 *  or the point lies past the band's outer edge at the noise's ceiling (maskJag + CUT_JAG_SLACK). woundMask skips its
 *  noise3 there. The CPU mirror of the mask block's guard. */
export function cutMaskIdle(p: Vec3, nrm: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, sag: number): boolean {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = Math.abs(dot(rel, along)), u = Math.abs(dot(rel, side));
  const plane = dot(rel, inward) - sag;
  const k = Math.max(kerf, 1e-4);
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  const mEnd = CUT_SHADE.maskEnd * Math.max(halfLen, 1e-4);
  const lens = Math.sqrt(clamp(1 - (a / mEnd) * (a / mEnd), 0, 1));
  const ends = 1 - smoothstep(0.9 * mEnd, mEnd, a);
  const far = 1 - smoothstep(dEff + k, dEff + 2 * k, plane);
  const ni = dot(nrm, inward);
  const back = 1 - smoothstep(0.25, 0.6, ni);
  const wallReach = k * (1 + CUT_SHADE.jagAmp);
  const inner = 1 - smoothstep(wallReach, 1.3 * wallReach, u);
  const face = 1 - smoothstep(CUT_SHADE.maskFace[0], CUT_SHADE.maskFace[1], ni);
  return !(ends * far * Math.min(back, Math.max(inner, face)) > 0 && u < k * CUT_SHADE.maskWidth * (lens * (1 + CUT_SHADE.maskJag + CUT_JAG_SLACK)) + 1e-4);
}

export interface CutCalibre { depth: number; kerf: number; lip: number }
/** The rod stand-in's blade (tunable). Kerf 0.01 -> 0.015 (2026-10-04, owner playtest: the 2 cm slit read as a thin line
 *  at 0.6 m in shadow) -> 0.02 (look pass, "everything more excessive"; kerfPerHalfLen made it Lipschitz-safe). */
export const ROD_CALIBRE: CutCalibre = { depth: 0.06, kerf: 0.02, lip: 1 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const unit = (v: Vec3, fb: Vec3 = [0, 1, 0]): Vec3 => (Math.hypot(v[0], v[1], v[2]) > 1e-9 ? normalize(v) : fb);

/** The slot's inside-positive carve term at `p` (no noise): the CPU mirror of applyWounds' cut branch, one path only.
 *  `mid` is the wound's anchor on the skin; `dIn` is the PRE-WOUND body field at `p` (after carves, before ANY wound: the
 *  WGSL passes applyWounds' `dIn`, never the running `d`); `sag` is the wound's stored chord sag. The slot's depth
 *  coordinate is `s = max(-dIn, along-inward distance - sag)`: the depth below the real skin where that is the deeper
 *  reading (it follows curved skin) but never shallower than the slot's own plane, so a cut can not open the far skin of a
 *  thin limb (`-dIn` alone is depth below the NEAREST skin, which is the far side behind the middle of an arm). The lip
 *  is `cutLip` below (subtracted after the carve's smax). */
export function cutCarve(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, dIn: number, sag: number, jag = 0, lid = true): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), u = dot(rel, side);
  const s = Math.max(-dIn, dot(rel, inward) - sag);
  const tN = clamp(a / Math.max(halfLen, 1e-4), -1, 1);
  const taper = cutTaper(tN);
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  // Kerf and depth both follow the taper, so the tips close to a needle without the wall's slope blowing up (cutTaper).
  // `jag` is the GPU's fine + pinch noise at p; past -1 it closes the slot there (the max keeps kerfT >= 0).
  const depthT = Math.max(dEff * taper, 1e-4);
  const kerfT = kerf * Math.max(1 + jag, 0) * taper;
  const vWall = kerfT * (1 - clamp(s, 0, depthT) / depthT) - Math.abs(u);
  // The LID (plane + kerf + lidSlack x halfLen): the slot is closed that far outward of the anchor's tangent plane (the
  // RAW plane, not the skin-relative `s`). It stops the carve slicing a FOREIGN limb lying across the channel above the
  // cut: inside that limb dIn < 0, so `s` (>= -dIn) reads the depth below the FOREIGN skin and no `s`-based term closes
  // the slot there. On convex skin the owner's flesh under the slot lies inward of the anchor's tangent plane, so
  // `plane + kerf` alone changes no owner surface; in a concave crease (an armpit) the skin rises above that plane, and
  // the slack keeps the lid above it (measured, cut-wound.test.ts: 0 owner sign flips on every convex fixture with no
  // slack; the three crease fixtures flipped ~70k of 4.4M near-surface samples with none, and 1863 with 0.25 h, all
  // on the oblique armpit cut). A flip can only REMOVE carve (the lid lowers the carve): the cut stops short of a wall that rises
  // steeply above the anchor, it never opens flesh. The term's gradient is 1 x carveK, like the others.
  // `lid = false` is a test seam only (the zero-set test compares the two); the WGSL always has the lid.
  return Math.min(vWall, depthT - s, halfLen - Math.abs(a), lid ? dot(rel, inward) + kerf + CUT_SHADE.lidSlack * halfLen : Infinity) * CUT_SHADE.carveK;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** How much the cut's LIPS lower the field at `p` (>= 0; subtract it from the carved field): the CPU mirror of the lip in
 *  applyWounds' cut branch, term for term. Two everted ridges along the slot's edges, as high as the slot is deep
 *  (`cutTaper`) and scaled by `lipScale` (META.z). Three gates keep it where a lip belongs:
 *  - `rim`: only near the PRE-WOUND skin (`dIn`), as the crater's rim is. Its band is the WOUND's scale, `rimB` = max(peak
 *    lip height, lip width), constant along the slot: the crater's form (a band of the local height, amp) has a slope x
 *    height of 1.5 whatever the scale, which added 1.5 to the body's own |grad| 1 (measured 2.51 on a 0.015 half-length
 *    cut) and, as amp shrinks toward the tips, a steep along-slot term too. With rimB the rim's contribution is at most
 *    1.5 x amp / rimB (measured whole-field max: the Lipschitz test);
 *  - `offKerf`: zero inside the slot's smooth (tapered, un-jagged) kerf, so the lip does not refill the slot it borders;
 *  - `nearSkin`: zero once the slot's depth coordinate `s` (cutCarve's) is min(2 lip widths, dEff) deep, so the lip lives
 *    at the near skin only and never bulges the far skin behind the cut (where `dIn` is again ~0). The dEff cap is the
 *    thin-limb guard: stampCut limits sag + dEff to thickFrac of the flesh, so a band no deeper than dEff ends above a
 *    thin limb's back skin whatever the kerf (2 lip widths alone reached the back of a 0.05 m arm's silhouette slash
 *    at any kerf over 0.015, which capped the kerf there). `depth` is the stored carve depth, as cutCarve's. */
export function cutLip(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, dIn: number, sag: number, lipScale: number): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), u = Math.abs(dot(rel, side));
  const s = Math.max(-dIn, dot(rel, inward) - sag);
  const tN = clamp(a / Math.max(halfLen, 1e-4), -1, 1);
  const taper = cutTaper(tN);
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  // The SMOOTH kerf (no jag): offKerf on the jagged kerf put the jag's slope into the lip as well (amp / lipW x the kerf's
  // noise slope: measured whole-field 2.7-3.1 on thin limbs); where the jag widens the slot the lip may round its top edge.
  const kerfS = kerf * taper;
  const lipW = Math.max(kerf * CUT_SHADE.lipWidth, 1e-4);
  // The lip scale is clamped (maxLipScale): the measured slope bound holds up to it, not for any calibre's lip.
  const amp0 = kerf * CUT_SHADE.lipHeight * Math.min(lipScale, CUT_SHADE.maxLipScale);
  const amp = amp0 * taper;
  const lx = (u - kerf * CUT_SHADE.lipOffset) / lipW;
  const rimB = CUT_SHADE.rimSpan * Math.max(amp0, lipW);
  const rim = 1 - smoothstep(-0.3 * rimB, 0.7 * rimB, dIn);
  const offKerf = smoothstep(kerfS, kerfS + lipW, u);
  const nearSkin = 1 - smoothstep(0, Math.max(Math.min(2 * lipW, dEff), 1e-4), s);
  return amp * Math.exp(-lx * lx) * rim * offKerf * nearSkin;
}

/** The cut's surface-shading footprint at `p` with outward surface normal `nrm`, 0..1: the CPU mirror of woundMask's cut
 *  branch, term for term. A band either side of the slot (kerf to maskWidth x kerf) that narrows along its length to
 *  nothing at maskEnd x halfLen (past the carve's tips: a wet scratch, not a clean stop), gated off surfaces that face
 *  along the slot's inward axis (`back`: the far skin of the cut limb, dot(nrm, inward) ~ +1; the slot's walls (~0),
 *  floor and lips (~-1) keep the band), and, as a second guard, fading out beyond the slot's floor measured from its own
 *  chord plane (`far`). `far` alone left a stripe on thin limbs: the floor sits only 0.2 x thick above the back skin,
 *  inside the 2-kerf fade whenever 0.2 thick < 2 kerf (a 0.03 m arm: 0.76 rod, 1.0 kerf 0.015). Beyond the jagged walls'
 *  reach the band also needs skin facing out of the cut's mouth (`face`), so a wide band ends at a limb's side instead
 *  of wrapping round it. No `dIn`: the mask runs on shaded surface points. `jag` is the GPU's band noise (|jag| <=
 *  maskJag: a ragged edge); the widest band is jag = maskJag. */
export function cutMask(p: Vec3, nrm: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, sag: number, jag = 0): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = Math.abs(dot(rel, along)), u = Math.abs(dot(rel, side));
  const plane = dot(rel, inward) - sag;
  const k = Math.max(kerf, 1e-4);   // WGSL leaves smoothstep(e, e, x) undefined: a zero kerf must not reach it
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  const mEnd = CUT_SHADE.maskEnd * Math.max(halfLen, 1e-4);
  const mw = Math.sqrt(clamp(1 - (a / mEnd) * (a / mEnd), 0, 1)) * Math.max(1 + jag, 0);
  const band = 1 - smoothstep(k * mw, k * CUT_SHADE.maskWidth * mw + 1e-4, u);
  const ends = 1 - smoothstep(0.9 * mEnd, mEnd, a);
  const far = 1 - smoothstep(dEff + k, dEff + 2 * k, plane);
  const ni = dot(nrm, inward);
  const back = 1 - smoothstep(0.25, 0.6, ni);
  // Inside the jagged walls' reach the plain back gate (walls ~0, floor ~-1); beyond it, skin facing out of the mouth only.
  const wallReach = k * (1 + CUT_SHADE.jagAmp);
  const inner = 1 - smoothstep(wallReach, 1.3 * wallReach, u);
  const face = 1 - smoothstep(CUT_SHADE.maskFace[0], CUT_SHADE.maskFace[1], ni);
  return band * ends * far * Math.min(back, Math.max(inner, face));
}

export interface SweepSample { point: Vec3; view: Vec3 }
/** `view` is the averaged view direction of the run's samples (camera to scene). The slot's thin axis is along × inward,
 *  normal to the skin, by design, so no separate cut normal is kept. */
export interface CutSeg { a: Vec3; b: Vec3; view: Vec3 }

function nearestCluster(prims: readonly Primitive[], p: Vec3): number {
  let best = -1, bd = Infinity;
  for (const q of prims) {
    if (q.dead || q.op === 'sub' || q.op === 'groove' || q.op === 'bone' || q.op === 'organ') continue;
    const d = sdPrimitive(p, q);
    if (d < bd) { bd = d; best = q.cluster ?? 0; }
  }
  return best;
}

/** A blade's sweep (surface hits in order, with the view direction of each) → at most CUT.maxPerSlash segments, one per
 *  run of consecutive samples on the same cluster, stretched by CUT.tailGain and clamped to CUT.maxLen about its midpoint;
 *  a run shorter than minLen (before the stretch) is dropped.
 *  A lone sample whose two neighbours share a cluster is relabelled to it (jitter at a seam must not split a cut), and
 *  when more than maxPerSlash candidates exist the LONGEST are kept (returned in sweep order). */
export function cutsFromSweep(prims: readonly Primitive[], samples: readonly SweepSample[]): CutSeg[] {
  const raw = samples.map(s => nearestCluster(prims, s.point));
  const labels = raw.slice();
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i] !== raw[i - 1] && raw[i] !== raw[i + 1] && raw[i - 1] === raw[i + 1]) labels[i] = raw[i - 1]!;
  }
  const runs: SweepSample[][] = [];
  for (let i = 0; i < samples.length; i++) {
    if (i === 0 || labels[i] !== labels[i - 1]) runs.push([]);
    runs[runs.length - 1]!.push(samples[i]!);
  }
  const cands: { seg: CutSeg; len: number; order: number }[] = [];
  runs.forEach((run, order) => {
    if (run.length < 2) return;
    let a = run[0]!.point, b = run[run.length - 1]!.point;
    const d = sub(b, a), l = Math.hypot(d[0], d[1], d[2]);
    if (l < CUT.minLen) return;
    // The tail stretch about the midpoint (CUT.tailGain), then the maxLen clamp: the same chord direction and midpoint.
    const len = Math.min(l * CUT.tailGain, CUT.maxLen);
    const m = scale(add(a, b), 0.5), h = scale(d, len / (2 * l));
    a = sub(m, h); b = add(m, h);
    const view = unit(run.reduce((acc, s) => add(acc, s.view), [0, 0, 0] as Vec3), [0, 0, -1]);
    cands.push({ seg: { a, b, view }, len, order });
  });
  return cands
    .sort((x, y) => y.len - x.len)
    .slice(0, CUT.maxPerSlash)
    .sort((x, y) => x.order - y.order)
    .map(c => c.seg);
}

function grad(field: (p: Vec3) => number, p: Vec3, fb: Vec3 = [0, 1, 0]): Vec3 {
  const e = 1e-3;
  return unit([
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ], fb);
}

/** Find the skin the viewer sees at the chord midpoint `mid`: march along -view (toward the viewer) from inside the body, or
 *  along +view from outside it, until the field changes sign, bisect to the zero set, then refine with a few gradient steps.
 *  The total walk from `mid` is capped at `maxWalk`. A silhouette-to-silhouette chord has its midpoint on the limb's axis,
 *  where the gradient is meaningless; the view march is what finds the skin there. A zero gradient falls back to -view. */
function toSurface(field: (p: Vec3) => number, mid: Vec3, view: Vec3, maxWalk: number): Vec3 {
  const f0 = field(mid);
  if (Math.abs(f0) < 2e-4) return mid;
  const inside = f0 <= 0;
  const dir = inside ? scale(view, -1) : view;
  const STEP = 0.005;
  let q = mid;
  let lo = 0, hi = -1;
  for (let t = STEP; t <= maxWalk + 1e-9; t += STEP) {
    if ((field(add(mid, scale(dir, t))) <= 0) !== inside) { hi = t; break; }
    lo = t;
  }
  if (hi > 0) {
    for (let i = 0; i < 24; i++) {
      const m = 0.5 * (lo + hi);
      if ((field(add(mid, scale(dir, m))) <= 0) === inside) lo = m; else hi = m;
    }
    q = add(mid, scale(dir, 0.5 * (lo + hi)));
  }
  const out = scale(view, -1);   // the outward direction when the gradient is degenerate
  for (let i = 0; i < 4; i++) {
    const d = field(q);
    if (Math.abs(d) < 2e-4) break;
    const next = sub(q, scale(grad(field, q, out), d));
    const off = sub(next, mid), n = Math.hypot(off[0], off[1], off[2]);
    q = n > maxWalk ? add(mid, scale(off, maxWalk / n)) : next;
  }
  return q;
}

/** Any unit vector perpendicular to `n`. */
function perp(n: Vec3): Vec3 {
  const axis: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, axis));
}

/** A cut segment on a body whose head may be split, taken to the UN-WARPED body, where stampCut works (damage.ts
 *  unwarpHit: wounds live there). ONE rigid motion for the whole segment, that of the piece its midpoint is on, so the
 *  segment keeps its length and its ends never land on different pieces. `field` is the closed body's, for the stamp;
 *  `hit` is the un-warped midpoint and `piece` the piece it is on (unwarpHit's).
 *  With no split, or a midpoint on the unmoved rest, the segment is returned as it is. */
export function unwarpCutSeg(body: Body, seg: CutSeg): { seg: CutSeg; field: (p: Vec3) => number; hit: Vec3; piece: 0 | 1 | 2 } {
  const u = unwarpHit(body, scale(add(seg.a, seg.b), 0.5));
  if (u.piece === 0) return { seg, field: u.field, hit: u.hit, piece: 0 };
  const half = u.dir(scale(sub(seg.b, seg.a), 0.5));
  return { seg: { a: sub(u.hit, half), b: add(u.hit, half), view: u.dir(seg.view) }, field: u.field, hit: u.hit, piece: u.piece };
}

/** One cut wound from a segment on the body (world space at `bodyYaw`). On a split head: the un-warped segment and the
 *  closed body's field (unwarpCutSeg). */
export function stampCut(prims: Primitive[], seg: CutSeg, calibre: CutCalibre, bodyYaw: number, field: (p: Vec3) => number): Wound {
  const d = sub(seg.b, seg.a);
  const half = Math.min(CUT.maxLen, Math.hypot(d[0], d[1], d[2])) / 2;
  const view = unit(seg.view, [0, 0, -1]);
  const anchor = toSurface(field, scale(add(seg.a, seg.b), 0.5), view, half + 0.05);
  // No field: the cut sizes its own depth and rim below (a crater's probe caps are the wrong ones for it).
  const w = worldHitToWound(prims, anchor, half, 'pellet', bodyYaw);
  const wantDepth = Math.min(calibre.depth, CUT.maxDepth);
  // The inward direction first (a short probe is enough to find it), then the sag, then the flesh: the slot's floor sits
  // at sag + depth below the anchor along `inward`, so the flesh that bounds the depth is measured to that point.
  const dir = fleshBehind(field, anchor, prims[w.primIdx]!, 0);
  const inward = dir.inward ?? unit(scale(grad(field, anchor, scale(view, -1)), -1));
  // Only the drop along the inward direction is skin fall-off; the straight-line distance would also count the anchor's
  // sideways shift under an oblique view and reopen the far skin.
  const sag = Math.max(0, dot(sub(scale(add(seg.a, seg.b), 0.5), anchor), inward));
  const flesh = fleshBehind(field, anchor, prims[w.primIdx]!, (sag + wantDepth) / CUT.thickFrac);
  // On the prim's axis (no inward from the probe): assume enough flesh.
  const thick = flesh.inward ? flesh.thick : (sag + wantDepth) / CUT.thickFrac;
  const t = sub(d, scale(inward, dot(d, inward)));
  const c = cross(inward, view);
  const alongW = Math.hypot(t[0], t[1], t[2]) > 1e-9 ? unit(t) : Math.hypot(c[0], c[1], c[2]) > 1e-9 ? unit(c) : perp(inward);
  // The kerf is clamped to kerfPerHalfLen x the half-length (CUT_SHADE): the slot's along-length slopes are all kerf /
  // halfLen x a constant, so this is what keeps a wide blade's short cut inside the Lipschitz bound.
  const kerf = Math.min(calibre.kerf, CUT_SHADE.kerfPerHalfLen * half);
  w.shape = 'cut';
  w.carveN = worldDirToWoundLocal(prims, w, inward, bodyYaw);
  // A slash across a thin limb's silhouette has its chord on the limb's axis (sag = the radius): the depth left is what
  // fits between the chord and thickFrac of the flesh, floored at one kerf (it keeps the wall's s-slope kerf / dEff <= 1).
  w.carveDepth = Math.max(kerf, Math.min(wantDepth, CUT.thickFrac * thick - sag, CUT_SHADE.maxDepthPerHalfLen * half));
  w.cutDir = worldDirToWoundLocal(prims, w, alongW, bodyYaw);
  w.kerf = kerf;
  w.sag = sag;
  w.rimScale = calibre.lip;
  w.severRadius = 0;
  w.wetLip = 1;
  return w;
}

/** The sphere list the bone-exposure consumers read (they know only craters): a crater is itself; a cut is a chain of
 *  stations along its slot, one per `max(depth, 2 kerf)`, covering the flesh cutCarve removes there. At station t the slot
 *  is `r = dEff x cutTaper(t)` deep (floored at one kerf for the sphere's size) BELOW THE SKIN: cutCarve's depth coordinate is
 *  `s = max(-dIn, plane - sag)`, so the carve never goes more than depthT below the nearest skin, and also stops at the
 *  plane `sag + depthT`. The skin itself lies `skin(x)` below the anchor's tangent plane: the circle through the anchor and
 *  the chord's ends (the chord sits `sag` below the anchor), R = (h^2 + sag^2) / (2 sag), skin(x) = R - sqrt(R^2 - x^2),
 *  which is 0 on a straight limb (sag 0) and `sag` at the chord's ends. A station is a sphere of radius max(2 kerf,
 *  r/2 + kerf) centred `skin + r/2` along the inward axis: it spans skin to floor and stays tight sideways. At sag 0 this
 *  is the original lens; a thin limb's silhouette cut (sag ~ the limb's radius) curves the chain down to the chord. */
export function cutExposureSpheres(prims: Primitive[], w: Wound, bodyYaw: number): { pos: Vec3; radius: number }[] {
  const c = woundWorldPos(prims, w, bodyYaw);
  if (w.shape !== 'cut' || !w.cutDir) return [{ pos: c, radius: w.radius }];
  const along = unit(woundDirToWorld(prims, w, w.cutDir, bodyYaw));
  const inward = w.carveN ? unit(woundDirToWorld(prims, w, w.carveN, bodyYaw)) : null;
  const depth = w.carveDepth ?? 0.03, kerf = w.kerf ?? CUT.defaultKerf;
  const h = w.radius, sag = Math.max(0, w.sag ?? 0);
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * h);
  const R = sag > 1e-6 ? (h * h + sag * sag) / (2 * sag) : Infinity;
  const n = Math.max(2, Math.ceil((2 * h) / Math.max(depth, 2 * kerf)));
  const out: { pos: Vec3; radius: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const r = Math.max(dEff * cutTaper(t), kerf);
    const x = t * h;
    const skin = Number.isFinite(R) ? R - Math.sqrt(Math.max(R * R - x * x, 0)) : 0;
    const radius = Math.max(2 * kerf, r / 2 + kerf);
    let pos = add(c, scale(along, x));
    if (inward) pos = add(pos, scale(inward, skin + r / 2));
    out.push({ pos, radius });
  }
  return out;
}

/** The bone-exposure sphere list for one actor (game-main's bone instancer and segment meshes): every visual wound but cloth
 *  decals (they carve nothing), as cutExposureSpheres, ON THE FRAME THE GPU ROWS USE. The ring uploads from the posed prims
 *  WITH THE LIVE BODY YAW (character-view.ts refresh; game-actor.ts "THE WOUND FRAME IS THE BODY FRAME"), and every stamp
 *  (pellet, slug, blast, the rod's stampCut) resolves with that same yaw, in the default and the bounded-wounds preview
 *  alike. The exposure must too: at yaw 0 damage.ts frame() keeps the world basis instead of re-yawing the body-frame one,
 *  so on a turned body the spheres slid off the carve (a yaw-pi torso cut exposed bone on the BACK). */
export function boneExposureOf(a: {
  posed(): { prims: Primitive[] };
  pose(): { yaw: number };
  visualWounds(): readonly Wound[];
}): { pos: Vec3; radius: number }[] {
  const prims = a.posed().prims, yaw = a.pose().yaw;
  const out: { pos: Vec3; radius: number }[] = [];
  for (const w of a.visualWounds()) if (!w.decal) out.push(...cutExposureSpheres(prims, w, yaw));
  return out;
}
