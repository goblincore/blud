// PRESENTATION PROFILES (shared light list spec §5). Pure. The owner's rule: presentation over
// realism: a flattering key, a fill, a rim, visible relief, never a flat black silhouette.
// One profile per light KIND, fixed in code; a level may scale a light's gain and tint
// (light-list.ts), never define profiles. GPU lanes: a (gain, viewBias, floor, backKey),
// b (backRim, spec, 0 spare, specPow), c (rimTint.rgb, 0). edge/distFall are CPU-only (pick).

export interface LightProfile {
  gain: number; viewBias: number; floor: number; backKey: number;
  backRim: number; rimTint: [number, number, number];
  edge: number; distFall: number;
  spec: number; specPow: number;
}

export const PROFILE_ID = { tube: 0, lamp: 1, window: 2, flashlight: 3, muzzle: 4, fire: 5 } as const;
export type ProfileName = keyof typeof PROFILE_ID;
export const PROFILE_VEC4S = 3;
export const MAX_PROFILES = 8;

const COLD_RIM: [number, number, number] = [0.55, 0.75, 1.3];
const WARM_RIM: [number, number, number] = [1.2, 0.8, 0.5];

// Keyed by name so table order can never drift from PROFILE_ID (review fix, Task 2):
// a missing or misspelt key is a TypeScript error, and LIGHT_PROFILES below is derived
// from this record by sorting the PROFILE_ID keys by their id values.
export const PROFILES_BY_NAME: Record<ProfileName, LightProfile> = {
  // tube: game-dynamic-light-leaves.ts PRESENT (tuned with the owner 2026-09-26)
  tube: { gain: 1.3, viewBias: 0.3, floor: 0.18, backKey: 0.35, backRim: 2.5, rimTint: COLD_RIM, edge: 1.25, distFall: 0.06, spec: 1.0, specPow: 24 },
  // lamp (warm bulbs)
  lamp: { gain: 1.1, viewBias: 0.3, floor: 0.18, backKey: 0.4, backRim: 1.5, rimTint: WARM_RIM, edge: 1.25, distFall: 0.08, spec: 0.8, specPow: 20 },
  // window / lightning: hard, cold, side rim (compose.wgsl.ts's lightning rim)
  window: { gain: 1.0, viewBias: 0.15, floor: 0.1, backKey: 0.5, backRim: 3.0, rimTint: COLD_RIM, edge: 1.0, distFall: 0, spec: 1.2, specPow: 32 },
  // flashlight: the beam is the key (flashlight.wgsl.ts), little bias, it is at the eye
  flashlight: { gain: 1.0, viewBias: 0.0, floor: 0.1, backKey: 1.0, backRim: 0.0, rimTint: COLD_RIM, edge: 1.0, distFall: 0.04, spec: 1.0, specPow: 24 },
  // muzzle: compose.wgsl.ts flashDirect's warm colour lives in the light's rgb
  muzzle: { gain: 1.0, viewBias: 0.0, floor: 0.0, backKey: 1.0, backRim: 0.5, rimTint: WARM_RIM, edge: 1.0, distFall: 0.2, spec: 0.5, specPow: 16 },
  // fire
  fire: { gain: 1.0, viewBias: 0.1, floor: 0.2, backKey: 0.6, backRim: 1.2, rimTint: WARM_RIM, edge: 1.0, distFall: 0.1, spec: 0.4, specPow: 12 },
};

// Frozen (review fix, Task 3): light-list.ts packs this table ONCE at module load, so a runtime
// write would silently desync the CPU pick from the GPU copy. Freezing makes such a write throw
// (strict mode) instead. The shared rim tints are frozen too, since profiles hold them by reference.
Object.freeze(COLD_RIM);
Object.freeze(WARM_RIM);
for (const p of Object.values(PROFILES_BY_NAME)) { Object.freeze(p.rimTint); Object.freeze(p); }
Object.freeze(PROFILES_BY_NAME);

export const LIGHT_PROFILES: readonly LightProfile[] = Object.freeze((Object.keys(PROFILE_ID) as ProfileName[])
  .sort((a, b) => PROFILE_ID[a] - PROFILE_ID[b])
  .map(name => PROFILES_BY_NAME[name]));

export function packProfiles(profiles: readonly LightProfile[] = LIGHT_PROFILES): Float32Array {
  const f = new Float32Array(MAX_PROFILES * PROFILE_VEC4S * 4);
  profiles.slice(0, MAX_PROFILES).forEach((p, i) => {
    f.set([p.gain, p.viewBias, p.floor, p.backKey, p.backRim, p.spec, 0, p.specPow, ...p.rimTint, 0], i * 12);
  });
  return f;
}
