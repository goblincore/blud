// src/lab/sdf-zombie/webgpu/game-deferred-lights.ts
//
// THE SHARED GAME LIGHT LIST (hybrid deferred M2, spec
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m2-design.md). Converts
// the game's THREE lights into the deferred layer's packed DeferredLight[]
// each frame — DATA ONLY: nothing here mutates a light, a material, or the
// scene, so light motion is a light-texture upload (deferred-layer's
// setLights), never a shader or material rebuild.
//
// SELECTION. Deterministic, max 16 (MAX_DEFERRED_LIGHTS): the flashlight slot
// first, then one ACTIVE muzzle-flash slot, then practicals nearest-first
// with a lexicographic ID tiebreak. A muzzle flash becomes its own shared
// light and never borrows the flashlight's slot again (the legacy march's
// documented temporary borrow — the deferred bodies have independent light
// slots, and a test pins that moving only the muzzle leaves the flashlight
// entry untouched).
//
// CONVERSION CONSTANTS, EXPLICIT. three's punctual falloff is
// `intensity / d^decay * window²` with window = 1 - (d/cutoff)^4; the
// deferred light pass evaluates `intensity / d² * window²` — the SAME window,
// so decay-2 lights convert at the identity. decay ≠ 2 lights (the game's
// flashlight at 1.6, muzzle at 1.7) cannot be matched at every distance by
// any scalar, so the difference is a documented approximation calibrated
// through matched captures (tasks 6-7), tuned through the single
// DEFERRED_INTENSITY_SCALE knob — not hidden in per-light ad-hoc fudges.
//
// ENVIRONMENT IS SEPARATE: ambient and fog are the deferred layer's
// setEnvironment, never entries in this list (the dungeon rig's
// AmbientLight/HemisphereLight/DirectionalLight are not candidates).
//
// three comes from 'three/webgpu' — see dungeon-lighting.ts's header on not
// splitting the import.

import * as THREE from 'three/webgpu';
import { MAX_DEFERRED_LIGHTS, type DeferredLight } from './deferred-lighting';

export interface GameLightCandidate {
  id: string;
  role: 'flashlight' | 'muzzle' | 'practical';
  light: THREE.Light;
}

/** M2 task 5: the flashlight slot's MARCH-KEY response for flesh receivers
 *  (see DeferredLight.fleshKeyIntensity / .fleshShoulderKnee). `gain` is the
 *  legacy march's beam gain (game-main beamTuning.gain — passed through a
 *  live getter so setBeamTuning cannot desync the deferred path); `knee` is
 *  its highlight shoulder (1 - beamTuning.shoulder). */
export interface GameDeferredFlashKey {
  gain: number;
  knee: number;
}

export interface GameDeferredLightSet {
  lights: DeferredLight[];
  /** ids parallel to `lights` — the selection record. */
  ids: string[];
  /** ids considered but NOT in the set (over the cap, inactive, invisible,
   *  or an unsupported light type), so diagnostics can say where a light
   *  went. */
  dropped: string[];
  /** 0 when the flashlight made the list (it is always first), else -1. */
  flashlightIndex: number;
}

/**
 * three distance 0 means "no cutoff" — the deferred window needs a finite
 * range or every practical would light the whole level. Chosen around the
 * game room's scale (rooms span ~8 m); range per light comes from
 * three.distance whenever one is authored.
 */
export const DEFERRED_LIGHT_DEFAULT_RANGE = 12;

/** The one intensity calibration knob — see the header. Identity until the
 *  matched-capture calibration moves it. */
export const DEFERRED_INTENSITY_SCALE = 1;

const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();

function worldPositionOf(light: THREE.Light): THREE.Vector3 {
  // Ensure the WORLD matrix is current even for a light whose ancestors have
  // not been through updateMatrixWorld this frame (the muzzle rides the
  // first-person aim rig). Reads hierarchy state; mutates matrices only.
  light.updateWorldMatrix(true, false);
  return _pos.setFromMatrixPosition(light.matrixWorld);
}

function convertPointOrSpot(light: THREE.PointLight | THREE.SpotLight): DeferredLight {
  const pos = worldPositionOf(light);
  const position: [number, number, number] = [pos.x, pos.y, pos.z];
  const color: [number, number, number] = [light.color.r, light.color.g, light.color.b];
  const intensity = light.intensity * DEFERRED_INTENSITY_SCALE;
  const range = light.distance > 0 ? light.distance : DEFERRED_LIGHT_DEFAULT_RANGE;

  if ((light as THREE.PointLight).isPointLight) {
    return {
      kind: 'point', position, direction: [0, 0, 0],
      color, intensity, range, cosInner: 1, cosOuter: 0,
    };
  }

  // Spot: three's cone is (angle, penumbra) with the falloff smoothstep
  // between cos(angle) and cos(angle * (1 - penumbra)) — exactly the
  // deferred pass's cosOuter→cosInner smoothstep, so the cone maps exactly.
  const spot = light as THREE.SpotLight;
  const penumbra = Math.min(Math.max(spot.penumbra, 0), 1);
  const target = spot.target;
  target.updateWorldMatrix(true, false);
  _target.setFromMatrixPosition(target.matrixWorld);
  _dir.subVectors(_target, pos);
  const len = _dir.length();
  const direction: [number, number, number] = len > 1e-6
    ? [_dir.x / len, _dir.y / len, _dir.z / len]
    : [0, -1, 0]; // degenerate aim (light on its own target): straight down
  return {
    kind: 'spot',
    position,
    direction,
    color,
    intensity,
    range,
    cosInner: Math.cos(spot.angle * (1 - penumbra)),
    cosOuter: Math.cos(spot.angle),
  };
}

function isActive(light: THREE.Light): boolean {
  return light.visible && light.intensity > 0;
}

/**
 * Builds the frame's shared light list from the game's candidates.
 *
 * Throws on duplicate ids — the ID tiebreak and the ids/dropped records only
 * mean something if ids are unique. All other awkward inputs (inactive
 * muzzles, invisible lights, non point/spot practicals, overflow past 16)
 * are DROPPED and reported, never guessed into the packed buffer.
 */
export function buildGameDeferredLights(
  candidates: readonly GameLightCandidate[],
  cameraWorld: THREE.Vector3,
  /** M2 task 5 (game wiring): multiplies every converted light's intensity
   *  WITHOUT touching the source lights — the game adapter's one exposure
   *  knob. A bare number is the scale itself; `{ intensityScale }` is the
   *  named form. Default (no third argument) is 1 and keeps task-3
   *  behaviour byte-identical. Deliberate: three's decay-2 approximation is
   *  calibrated per capture in tasks 6-7 through this single scale, not
   *  through per-light fudges.
   *
   * `flashKey` stamps the FLASHLIGHT slot only with the march-key fields
   * (fleshKeyIntensity / fleshShoulderKnee — packed v3.z/v3.w). Absent: the
   * slot keeps pure packed-intensity behaviour (task-3 record, the fixture
   * shape). The intensity scale multiplies the stamped key gain too, so the
   * exposure knob moves both receiver models together. */
  scale: number | { intensityScale?: number; flashKey?: GameDeferredFlashKey } = 1,
): GameDeferredLightSet {
  const opts = typeof scale === 'object' ? scale : { intensityScale: scale };
  return buildGameDeferredLightsInner(candidates, cameraWorld,
    opts.intensityScale ?? 1, opts.flashKey);
}

function buildGameDeferredLightsInner(
  candidates: readonly GameLightCandidate[],
  cameraWorld: THREE.Vector3,
  intensityScale: number,
  flashKey: GameDeferredFlashKey | undefined,
): GameDeferredLightSet {
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) throw new RangeError(`duplicate game light candidate id '${c.id}'`);
    seen.add(c.id);
  }

  const lights: DeferredLight[] = [];
  const ids: string[] = [];
  const dropped: string[] = [];
  let flashlightIndex = -1;

  const take = (c: GameLightCandidate, key?: GameDeferredFlashKey) => {
    if (lights.length >= MAX_DEFERRED_LIGHTS) { dropped.push(c.id); return; }
    const converted = convertPointOrSpot(c.light as THREE.PointLight | THREE.SpotLight);
    // The scale rides the CONVERTED record — source lights are never mutated
    // (data-only conversion is this module's whole contract). The stamped
    // march-key gain scales with the same knob so the exposure moves both
    // receiver models together.
    if (key) {
      converted.fleshKeyIntensity = key.gain;
      converted.fleshShoulderKnee = key.knee;
    }
    if (intensityScale !== 1) {
      converted.intensity *= intensityScale;
      if (converted.fleshKeyIntensity !== undefined) converted.fleshKeyIntensity *= intensityScale;
    }
    lights.push(converted);
    ids.push(c.id);
  };

  // 1. The flashlight slot. First ACTIVE flashlight-role candidate wins;
  //    the rest (if a caller ever passes several) are dropped.
  let flashTaken = false;
  for (const c of candidates) {
    if (c.role !== 'flashlight') continue;
    if (!flashTaken && isActive(c.light)) {
      take(c, flashKey);
      flashTaken = true;
    } else {
      dropped.push(c.id);
    }
  }
  if (flashTaken) flashlightIndex = 0;

  // 2. The active muzzle-flash slot. An inactive muzzle (intensity 0 — the
  //    game allocates the light once and modulates it) is omitted.
  for (const c of candidates) {
    if (c.role !== 'muzzle') continue;
    if (isActive(c.light)) take(c);
    else dropped.push(c.id);
  }

  // 3. Practicals: nearest first, ID tiebreak, deterministic.
  const isConvertible = (l: THREE.Light): boolean =>
    (l as THREE.PointLight).isPointLight === true || (l as THREE.SpotLight).isSpotLight === true;
  const practicals = candidates.filter((c) => {
    if (c.role !== 'practical') return false;
    // Only point/spot convert; anything else (a DirectionalLight passed as a
    // practical) is reported as dropped rather than guessed into the buffer.
    if (!isConvertible(c.light)) { dropped.push(c.id); return false; }
    if (!isActive(c.light)) { dropped.push(c.id); return false; }
    return true;
  });
  const scored = practicals.map((c) => {
    const p = worldPositionOf(c.light);
    const dx = p.x - cameraWorld.x, dy = p.y - cameraWorld.y, dz = p.z - cameraWorld.z;
    return { c, d2: dx * dx + dy * dy + dz * dz };
  });
  scored.sort((a, b) => (a.d2 !== b.d2 ? a.d2 - b.d2 : (a.c.id < b.c.id ? -1 : 1)));
  for (const s of scored) take(s.c);

  // Every candidate that did not make the list lands in dropped, so the
  // record is complete: ids + dropped = every candidate id exactly once.
  for (const s of scored) {
    if (!ids.includes(s.c.id) && !dropped.includes(s.c.id)) dropped.push(s.c.id);
  }

  return { lights, ids, dropped, flashlightIndex };
}
