// PRESENTATION PROFILES (shared light list spec §5). Pure. The owner's rule: presentation over
// realism: a flattering key, a fill, a rim, visible relief, never a flat black silhouette.
// One profile per light KIND, fixed in code; a level may scale a light's gain and tint
// (light-list.ts), never define profiles. GPU lanes: a (gain, viewBias, floor, backKey),
// b (backRim, spec, beamShoulder, specPow), c (rimTint.rgb, 0). edge/distFall/coverFloor/coverAt are CPU-only (pick).

import { LIGHT_PRESETS } from '../material';

export interface LightProfile {
  gain: number; viewBias: number;
  /** Shader wrap floor (GPU lane a.z). */
  floor: number; backKey: number;
  /** CPU-only (light-pick.ts): the spot coverage floor while in range, never pitch black.
   *  Separate from `floor` so the pick and the shader wrap can be tuned apart. Never packed. */
  coverFloor: number;
  backRim: number; rimTint: [number, number, number];
  edge: number; distFall: number;
  spec: number; specPow: number;
  /** GPU lane b.z: per unit of this light's delivered luminance, how far a body moves onto the
   *  march's beam shoulder (compose.wgsl.ts; clamped to 1). Flashlight 2 (full from 0.5), every
   *  other kind 0 (their bodies keep the exponential shoulder). */
  beamShoulder: number;
  /** CPU-only (light-pick.ts): where a spot's cone coverage is judged. 'feet' (the visible pool
   *  on the floor: ceiling tubes, lamps, beacons) or 'chest' (the pick body's centre: the
   *  flashlight, a hand-held beam that points AT the body, owner 2026-09-27). Never packed. */
  coverAt: 'feet' | 'chest';
}

export const PROFILE_ID = { tube: 0, lamp: 1, window: 2, flashlight: 3, muzzle: 4, fire: 5, beacon: 6 } as const;
export type ProfileName = keyof typeof PROFILE_ID;
export const PROFILE_VEC4S = 3;
export const MAX_PROFILES = 8;

// BODY-KEY CALIBRATION (plan 1, Task 10). The list's rgb stays PHYSICAL (colour x the three.js
// intensity x level gain: plan 2 feeds the same list to level materials), so each profile's GPU
// `gain` (lane a.x) is the conversion from that rgb to the SDF body key the old path produced,
// times the light's own per-light normaliser `bodyNorm` (light v3.z, light-list.ts) where
// intensity differs lamp to lamp. Baseline: list mode reproduces TODAY's body brightness; the
// owner tunes from here. The old path's numbers (mirrored below, pinned equal to their homes by
// game-light-list.test.ts):
//  - lightCfg.x, the preset key the old path scaled every key by: practical-hard-key's 2.4;
//  - lamps and tubes: keyI = lightCfg.x x kl, kl = presentingLamp's k x BODY_LAMP_GAIN 1.5,
//    k = room lamp LEVEL (0..1) x presence x PRESENT.gain 1.3 (game-dynamic-light.ts);
//  - the window: keyI = lightCfg.x x intensity x BODY_WINDOW_GAIN 0.035;
//  - the flashlight: keyI = beam x spotCfg2.x (beamTuning.gain 4), beam = cone² x dist² (0..1);
//  - muzzle and burning flashes: compose's flashDirect = warm x I x bodyFlashGain 0.06 x n.l / d².
/** lightCfg.x (practical-hard-key's keyIntensity, material.ts). */
export const OLD_KEY = LIGHT_PRESETS['practical-hard-key'].keyIntensity;
/** Mirrors of the old path's live constants, each pinned equal to its home by a test
 *  (game-light-list.test.ts): game-dynamic-light.ts BODY_LAMP_GAIN /
 *  BODY_WINDOW_GAIN; makeVfxState().beamTuning.gain (game-state-vfx.ts); makeLightingState()
 *  .bodyFlashGain (game-state-lighting.ts). They are the DEFAULTS: in list mode the live tuning
 *  seams (setBodyFlash, beamTuning) no longer move the list's bodies. */
export const OLD_BODY_LAMP_GAIN = 1.5;
export const OLD_BODY_WINDOW_GAIN = 0.035;
export const OLD_BEAM_GAIN = 4;
export const OLD_BODY_FLASH_GAIN = 0.06;
/** The warm-bulb lamp profile's presentation gain, from the plan's profile table (shared light
 *  list plan 1, Task 1: `lamp: { gain: 1.1, ... }`), standing where the tube has PRESENT.gain 1.3.
 *  The old presentingLamp applied 1.3 to every lamp, so a warm bulb keys a body ~15% under the
 *  old path at equal presence: a deliberate, UNMEASURED presentation choice (no warm-bulb A/B). */
export const LAMP_PRESENT_GAIN = 1.1;
/** Measured trims (gate section 7's A/B: a body in a third-class tube's pool, the tube between it
 *  and the camera, the train stopped so the tube hangs still). The old key was ONE lamp; the list
 *  adds up to three more lights, each light's backRim, the wrap floor and the highlight shoulder
 *  (which compresses, so the mean moves slowly with gain). Body-box mean vs today at that pose:
 *  tube trim 0.45 0.90x, 0.6 0.99x (std 4% under), 0.7 1.01-1.04x with std >= today's.
 *  (With the tube frozen mid-swing BEHIND the body, today's key goes dark, 0.16 vs 0.34: the
 *  list does not, which is the point of the list.) */
export const LAMP_LIST_TRIM = 0.7;
/** Measured trim for the flashlight, set BY LOOK, not against the old path (owner 2026-09-27).
 *  It was 2.8, which matched the old beam at 2.4 m (1.00x), but the old beam is itself 64-67%
 *  blown on the body at 2-2.5 m, and with coverage judged at the feet the list's torch only
 *  reached full strength at 4 m (weight 0.09 at 1.5 m, 0.59 at 4 m): white at 2-4 m. With the
 *  torch judged at the chest (coverAt, light-pick.ts) it counts fully at every distance, so the
 *  trim came down: body-pixel sweep at 1.5 / 2.5 / 4 / 6 m, Night Train third class torch-only
 *  (tubes killed), mean 0.64 / 0.63 / 0.57 / 0.44 at 0.43 (0.70-0.38 at 0.55 with distFall 0.03,
 *  0.79 at 1.2); ring level 0.46-0.26. Dev note 2026-09-27-shared-light-list, "Flashlight judged
 *  at the chest". Then 0.43 -> 0.65 with the beam tail's white clip (light-shade.ts
 *  BEAM_WHITE_CLIP): owner pick C of an A/B/C sheet, "a little white clipping is okay". */
export const FLASHLIGHT_LIST_TRIM = 0.65;

/** Measured trim for the window (the held-bolt A/B, the same body): the old bolt also added the
 *  lightning side rim and a cold front fill (compose, spotCfg2.w) that the list's window profile
 *  folds into its backRim. */
export const WINDOW_LIST_TRIM = 1.3;

const COLD_RIM: [number, number, number] = [0.55, 0.75, 1.3];
const WARM_RIM: [number, number, number] = [1.2, 0.8, 0.5];
const RED_RIM: [number, number, number] = [1.3, 0.2, 0.15];

/** The tube's calibrated profile (the beacon starts from it). */
const TUBE_PROFILE: LightProfile = { gain: OLD_KEY * OLD_BODY_LAMP_GAIN * 1.3 * LAMP_LIST_TRIM, viewBias: 0.3, floor: 0.18, coverFloor: 0.18, backKey: 0.35, backRim: 2.5, rimTint: COLD_RIM, edge: 1.25, distFall: 0.06, spec: 1.0, specPow: 24, beamShoulder: 0, coverAt: 'feet' };

// Keyed by name so table order can never drift from PROFILE_ID (review fix, Task 2):
// a missing or misspelt key is a TypeScript error, and LIGHT_PROFILES below is derived
// from this record by sorting the PROFILE_ID keys by their id values.
export const PROFILES_BY_NAME: Record<ProfileName, LightProfile> = {
  // tube: game-dynamic-light.ts PRESENT (tuned with the owner 2026-09-26).
  // gain = lightCfg.x 2.4 x BODY_LAMP_GAIN 1.5 x PRESENT.gain 1.3 = 4.68, on rgb normalised by the
  // tube's own base spot power (bodyNorm = 1 / (base x TUBE.spotGain)): what is left is the lamp's
  // LEVEL x level gain, exactly the old key's level term (flicker and blackouts still ride it);
  // then x LAMP_LIST_TRIM 0.7 (measured, see above) = 3.276.
  tube: TUBE_PROFILE,
  // lamp (warm bulbs): as the tube, normalised by its base power, keeping the lamp's own
  // LAMP_PRESENT_GAIN 1.1 (vs the tube's 1.3): 2.4 x 1.5 x 1.1 x LAMP_LIST_TRIM = 2.772 (the trim
  // is the tube's; no warm-bulb lamp was measured).
  lamp: { gain: OLD_KEY * OLD_BODY_LAMP_GAIN * LAMP_PRESENT_GAIN * LAMP_LIST_TRIM, viewBias: 0.3, floor: 0.18, coverFloor: 0.18, backKey: 0.4, backRim: 1.5, rimTint: WARM_RIM, edge: 1.25, distFall: 0.08, spec: 0.8, specPow: 20, beamShoulder: 0, coverAt: 'feet' },
  // window / lightning: hard, cold, side rim (compose.wgsl.ts's lightning rim).
  // gain = lightCfg.x 2.4 x BODY_WINDOW_GAIN 0.035 x WINDOW_LIST_TRIM 1.3 = 0.1092 on the raw
  // intensity (bodyNorm 1): the window's intensity IS the storm's signal (a bolt peaks near 27-32).
  // Held bolt at the A/B pose: trim 1.0 0.96x today's mean, 1.3 0.99x.
  window: { gain: OLD_KEY * OLD_BODY_WINDOW_GAIN * WINDOW_LIST_TRIM, viewBias: 0.15, floor: 0.1, coverFloor: 0.1, backKey: 0.5, backRim: 3.0, rimTint: COLD_RIM, edge: 1.0, distFall: 0, spec: 1.2, specPow: 32, beamShoulder: 0, coverAt: 'feet' },
  // flashlight: the beam is the key (flashlight.wgsl.ts), little bias, it is at the eye.
  // gain = the beam gain 4 x FLASHLIGHT_LIST_TRIM 0.65 = 2.6, on rgb normalised by the flashlight's
  // base intensity (bodyNorm = 1 / 90). Its cone is judged at the CHEST (coverAt): a hand-held
  // beam points at the body, and judged at the feet it scored 0.09 at 1.5 m and 0.59 at 4 m.
  // distFall 0.01 (was 0.04): the torch falls ~25% from 1.5 to 6 m, so a body stays pink and
  // modelled across the room; "a flashlight" comes from the beam against the ambient (3-8x the
  // same body with the torch off), not from the fall-off. The trim is measured by look (see
  // FLASHLIGHT_LIST_TRIM).
  // beamShoulder 2 (owner 2026-09-27): a body the torch delivers >= 0.5 to takes the march's
  // hue-preserving beam shoulder (compose.wgsl.ts), so it goes bright pink, not white.
  flashlight: { gain: OLD_BEAM_GAIN * FLASHLIGHT_LIST_TRIM, viewBias: 0.0, floor: 0.1, coverFloor: 0.1, backKey: 1.0, backRim: 0.0, rimTint: COLD_RIM, edge: 1.0, distFall: 0.01, spec: 1.0, specPow: 24, beamShoulder: 2, coverAt: 'chest' },
  // muzzle: compose.wgsl.ts flashDirect's warm colour lives in the light's rgb.
  // Old: I x 0.06 / d²; the list: I x gain / (1 + 0.2 d²) (the pick's distFall). Equal at a typical
  // 1.5 m (0.06 / 2.25 = gain / 1.45): gain = 0.06 x 1.45 / 2.25 = 0.039 (bodyNorm 1).
  // DERIVED ONLY, never measured: the curves cross at 1.5 m, so the list is ~3x brighter than the
  // old flash at 3 m and dimmer inside 1 m.
  muzzle: { gain: OLD_BODY_FLASH_GAIN * 1.45 / 2.25, viewBias: 0.0, floor: 0.0, coverFloor: 0.0, backKey: 1.0, backRim: 0.5, rimTint: WARM_RIM, edge: 1.0, distFall: 0.2, spec: 0.5, specPow: 16, beamShoulder: 0, coverAt: 'feet' },
  // fire: burning bodies fed the same bodyFlash slot as the muzzle, so the same conversion, with
  // the fire profile's distFall 0.1 (0.06 x 1.225 / 2.25 = 0.033), on the RAW intensity: every
  // fire light has bodyNorm 1 (burning-body flashes carry no reference, and collectLightSources
  // drops a fire-mood lamp's base power as its reference, Task 10 review). Derived only, never
  // measured. Fire-mood lamps did not key bodies in the old path (presentingLamp skips them); at
  // their ~1-4 intensity this keeps them a faint warm touch within 3 m.
  fire: { gain: OLD_BODY_FLASH_GAIN * 1.225 / 2.25, viewBias: 0.1, floor: 0.2, coverFloor: 0.2, backKey: 0.6, backRim: 1.2, rimTint: WARM_RIM, edge: 1.0, distFall: 0.1, spec: 0.4, specPow: 12, beamShoulder: 0, coverAt: 'feet' },
  // beacon (Boiler Room emergency beacons, spec 2026-09-27-boiler-room-beacons-design.md): the
  // tube's calibrated profile (a spot normalised by its base spot power, base x BEACON.spotGain),
  // with a hard red rim. Not measured on its own: the owner tunes from the contact sheet.
  beacon: { ...TUBE_PROFILE, backRim: 2.5, rimTint: RED_RIM },
};

// Frozen (review fix, Task 3): light-list.ts packs this table ONCE at module load, so a runtime
// write would silently desync the CPU pick from the GPU copy. Freezing makes such a write throw
// (strict mode) instead. The shared rim tints are frozen too, since profiles hold them by reference.
Object.freeze(COLD_RIM);
Object.freeze(WARM_RIM);
Object.freeze(RED_RIM);
for (const p of Object.values(PROFILES_BY_NAME)) { Object.freeze(p.rimTint); Object.freeze(p); }
Object.freeze(PROFILES_BY_NAME);

export const LIGHT_PROFILES: readonly LightProfile[] = Object.freeze((Object.keys(PROFILE_ID) as ProfileName[])
  .sort((a, b) => PROFILE_ID[a] - PROFILE_ID[b])
  .map(name => PROFILES_BY_NAME[name]));

export function packProfiles(profiles: readonly LightProfile[] = LIGHT_PROFILES): Float32Array {
  const f = new Float32Array(MAX_PROFILES * PROFILE_VEC4S * 4);
  profiles.slice(0, MAX_PROFILES).forEach((p, i) => {
    f.set([p.gain, p.viewBias, p.floor, p.backKey, p.backRim, p.spec, p.beamShoulder, p.specPow, ...p.rimTint, 0], i * 12);
  });
  return f;
}
