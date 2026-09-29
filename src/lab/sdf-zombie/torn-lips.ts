// src/lab/sdf-zombie/torn-lips.ts
//
// TORN, SPLAYED LIPS (flail v1.5b, spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §14.2;
// plan 2026-09-26-spike-flail.md Task 31). The owner: "flesh needs to feel thicker somehow, or have
// more splayed edges with red shiny matter". A wound with `Wound.tear` (0..1) uploads with
// ROW_WOUND_FLAGS.x bit 3 and renders as a torn tear instead of a dished bowl:
//   - SHAPE (march/fields/wounds.wgsl.ts APPLY_WOUNDS): the ragged outline gains a second, higher
//     octave; the everted rim's height and width ride the same lobe value — petals, not a torus.
//   - SHADING (SOLDIER_MEAT / WET blocks, via WOUND_MASK's gWoundTear): a wet red lip, glossy red
//     walls, a darker clotted floor, from the existing gooRed/deepColor family.
// Everything here is pure data; the shader constants are baked into the WGSL text.

/** CPU side: what `tear` does to the uploaded wound (character-view.ts). At tear t:
 *   ragged   = max(Wound.ragged, raggedMin + (raggedMax - raggedMin) * t)  (the shader caps at 0.45)
 *   splay   *= 1 + rimBoost * t      (a taller lip; rimScaleFor's flesh-behind-the-hit scale still applies)
 *   offset  *= 1 + offsetBoost * t   (the lip pushed outward) */
export const TEAR_LOOK = {
  raggedMin: 0.35,
  raggedMax: 0.45,
  rimBoost: 0.6,
  offsetBoost: 0.12,
} as const;

/** GPU side (APPLY_WOUNDS / WOUND_MASK). The lobe value is mix(n1, n2, OCTAVE_MIX) of the stock
 *  1.8-frequency lobes and a second octave at OCTAVE_FREQ; the rim's amplitude is multiplied by
 *  mix(PETAL_LO, PETAL_HI, lobe) and its width by mix(WIDTH_LO, WIDTH_HI, lobe). CARVE_K scales the
 *  torn carve term (the two-octave edge is steeper than the stock one's 0.75 covers). Sized so the
 *  widest petal stays inside the per-wound reach (radius x 3.56 at the shipped rim uniforms) and the
 *  rim's radial slope stays near the pellet lip's (~0.9). */
export const TORN = {
  OCTAVE_FREQ: 3.7,
  OCTAVE_MIX: 0.35,
  CARVE_K: 0.5,
  PETAL_LO: 0.25,
  PETAL_HI: 1.5,
  WIDTH_LO: 0.8,
  WIDTH_HI: 1.1,
  /** SHADING (SOLDIER_MEAT): how far a torn pixel's albedo goes to gooRed (the soldier stain is 0.72),
   *  and how far its floor (tissueDepth past the muscle line) darkens toward deepColor's clot. */
  RED: 0.85,
  /** Lip height (m above the pre-wound skin) at which the lip counts as fully torn flesh; the red on
   *  untouched skin under the footprint's fade (SKIN_SMEAR); the lip foot's darkening vs the crest. */
  LIP_LIFT: 0.006,
  SKIN_SMEAR: 0.3,
  LIP_FOOT: 0.6,
  FLOOR_CLOT: 0.35,
  /** SHADING (WET): torn wetness as multiples of the wound-wetness boost — lip/walls, floor. */
  WET_LIP: 1.25,
  WET_FLOOR: 0.7,
} as const;

/** The upload's derived values for a wound with tear `t` (0 or absent = untouched). */
export function tearUpload(t: number | undefined, ragged: number | undefined): { ragged: number; splayMul: number; offsetMul: number; torn: boolean } {
  const k = Math.max(0, Math.min(1, t ?? 0));
  if (k <= 0) return { ragged: ragged ?? 0, splayMul: 1, offsetMul: 1, torn: false };
  return {
    ragged: Math.max(ragged ?? 0, TEAR_LOOK.raggedMin + (TEAR_LOOK.raggedMax - TEAR_LOOK.raggedMin) * k),
    splayMul: 1 + TEAR_LOOK.rimBoost * k,
    offsetMul: 1 + TEAR_LOOK.offsetBoost * k,
    torn: true,
  };
}

/** The flail's tear intensity (plan Task 31): body craters by swing — the overhead H tears hardest —
 *  and every head-region crater at full. */
export const FLAIL_TEAR = { H: 1.0, R: 0.8, L: 0.8, head: 1.0 } as const;

/** The A/B switch (`__sdfGame.flail.setTear(false)`): off, the flail stamps stock (untorn) craters. Ships ON. */
let tearOn = true;
export function setFlailTear(on: boolean): void { tearOn = on; }
export function flailTearOn(): boolean { return tearOn; }
/** The flail's tear for a crater (0 with the switch off). */
export function flailTear(kind: keyof typeof FLAIL_TEAR): number { return tearOn ? FLAIL_TEAR[kind] : 0; }

// ---------------------------------------------------------------------------------------------------
// WET RED LIPS ON GUN WOUNDS (flail v1.5b, plan Task 35). Owner: "the gun wounds also need a little
// bit of work — mostly adding the red lips part… they are more craterlike but if it is possible to
// combine the crater look but with edges that have more of the wet red that would be ideal".
// A wound with `Wound.wetLip` (0..1) uploads with ROW_WOUND_FLAGS.x bit 4 (WOUND_FLAG.wetLip): the
// torn look's SHADING only — the wet red lip, glossy walls and clotted floor of the tornWound blocks —
// on the stock crater SHAPE (round bowl, smooth lip; no ragged edge, no petals, the analytic normal
// path untouched). Bit 3 (tear) is shape + shading; bit 4 is shading alone.

/** SHADING tweaks for wet-lip-only pixels (SOLDIER_MEAT; the weight is gWoundWetOnly / gWoundTear,
 *  0 on every torn or stock pixel so the flail's look is untouched). A crater's walls are small and
 *  steep beside a tear's, so the clot speckle and shattered glints that read as torn meat on the flail
 *  read as dirt at pellet size: the walls take WALL_SMOOTH of the smooth arterial ramp (the lip's),
 *  and the glint noise is calmed toward one wet highlight by GLINT_CALM. */
export const WET_LIP_LOOK = {
  WALL_SMOOTH: 0.7,
  GLINT_CALM: 0.6,
  /** The lip crest's brightness on the smooth arterial ramp (the torn lip's is 1.15): a crater's
   *  smooth rim is thin, so it needs a brighter crest to read as wet red rather than a dark ring. */
  LIP_CREST: 1.45,
} as const;

/** The gun's wet-lip intensity per round, stamped on the wound (game-actor.ts hit / hitSlug). */
export const GUN_WET_LIP = { pellet: 1.0, slug: 1.0 } as const;

/** The A/B switch (`__sdfGame.setWetLip(false)`): off, the upload drops bit 4 so the SAME craters
 *  render stock (the wounds keep their wetLip value). Ships ON. */
let wetLipOn = true;
export function setGunWetLip(on: boolean): void { wetLipOn = on; }
export function gunWetLipOn(): boolean { return wetLipOn; }

/** Whether a wound uploads with bit 4: a live wetLip value, the switch on, and a carved flesh wound —
 *  never a cloth decal, a cloth hole or tear, or a burn (those have no wet meat lip). */
export function wetLipUpload(w: { wetLip?: number; decal?: boolean; cloth?: string; type?: string }): boolean {
  return wetLipOn && (w.wetLip ?? 0) > 0 && !w.decal && !w.cloth && w.type !== 'burn';
}
