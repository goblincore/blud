// src/lab/sdf-zombie/webgpu/game-seams-fire.ts
//
// Fire/burn seams: the flare test harness plus every burn/fire-technique
// tuning readback. Members moved VERBATIM out of game-seams-leftover.ts
// (leaves wave 1's ctx-only bucket, 2026-09-20 split; see the
// 2026-09-20-seams-leftover-split notes).
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import { setBurnBehaviourEnabled } from '../burn-behaviour';
import type { GameContext } from './game-context';
import { type Vec3 } from '../types';
import type { SplitPresetId } from '../head-split';

export function createFireSeams(ctx: GameContext) {
  return {
    // FLARE TEST HARNESS (slot 5): the weapon verb plus the crowd helpers, so a
    // full room can be set alight without aiming at each body.
    fireFlare: () => ctx.weapon.flare?.fire() ?? false,
    /** CUT WOUNDS (game-rod.ts): cut actor `id` along a→b (world) as seen along `view`; optional calibre overrides. */
    cut: (id: number, a: Vec3, b: Vec3, view: Vec3, calibre?: { depth?: number; kerf?: number; lip?: number }) => ctx.weapon.rod?.cut(id, a, b, view, calibre) ?? 0,
    rod: () => ctx.weapon.rod?.debug() ?? null,
    /** Rod press / release without pointer lock (the canvas mousedown handler needs it): headless gates. */
    rodPress: () => { ctx.weapon.rod?.onMouseDown(0); return ctx.weapon.rod?.debug().held ?? false; },
    rodRelease: () => ctx.weapon.rod?.onMouseUp(0),
    /** THE AXE (game-axe.ts): debug state; a click on the next tick (the canvas mousedown needs pointer lock); a direct
     *  chop of actor `id` with `side`, aimed at its torso or head centre (gates). */
    axe: () => ctx.weapon.axe?.debug() ?? null,
    axeSwing: () => ctx.weapon.axe?.click(),
    axeChop: (id: number, side: 'H' | 'R' | 'L', target?: 'torso' | 'head') => ctx.weapon.axe?.chop(id, side, target) ?? 0,
    /** THE HEAD SPLIT (game-head-split.ts): actor `id`'s split state (preset, side, plane offset, the spring's angle,
     *  rate and target), null while it has none; and the tuning / gate seam: set it by hand, at `angleFrac` of the
     *  preset's max at once (`offset` in head-local metres along the plane normal; `angleFrac` 0 closes it). */
    headSplit: (id: number) => ctx.weapon.headSplit?.state(id) ?? null,
    forceSplit: (id: number, preset: SplitPresetId, sides: -1 | 0 | 1, offset: number, angleFrac: number) =>
      ctx.weapon.headSplit?.force(id, preset, sides, offset, angleFrac) ?? false,
    fireLauncher: () => ctx.weapon.launcher?.fire() ?? false,
    reloadLauncher: () => ctx.weapon.launcher?.reload() ?? false,
    launcher: () => ctx.weapon.launcher?.debug() ?? null,
    /** Set EVERY live actor alight. Returns how many bodies are tracked. */
    igniteAll: () => ctx.vfx.burning.igniteAll(),
    /** Fire-cost study: false = burn visually, behave unburnt (no panic/flail). Ship true. */
    setBurnBehaviour: (on: boolean) => { setBurnBehaviourEnabled(on); },
    /** Ignite exactly one actor by id (neighbour diagnosis, behaviour trace).
     *  Returns false for an unknown id. */
    igniteActor: (id: number) => {
      const a = ctx.world.actors.find((x) => x.id === id);
      if (!a) return false;
      ctx.vfx.burning.igniteActor(a);
      return true;
    },
    /** Per-actor burn-behaviour trace (scripts/burn-behaviour-trace.mjs):
     *  ground position, motion speed, whether a shot left the muzzle THIS
     *  frame (motion resets sinceFire to 0 on a firing step), the active
     *  stagger kind, and whether it is currently alight. */
    actorTrace: () => ctx.world.actors.map((a) => {
      const d = a.debug();
      const md = a.mind().debug();
      return {
        id: a.id, kind: a.kind,
        pos: [...a.pose().pos] as Vec3,
        speed: d.speed,
        firing: a.sinceFire() <= 1e-6,
        staggerKind: d.staggerKind,
        stumbles: a.burnStumbles(),
        burning: (ctx.vfx.burning.registry.get(a)?.burn ?? 0) > 0.02,
        alerted: md.alert,
        mindState: md.state,
        holdSecs: md.holdSecs,
        target: d.target ? [...d.target] as Vec3 : null,
      };
    }),
    /** Put every tracked body out (char stays). */
    extinguishAll: () => { ctx.vfx.burning.extinguishAll(); },
    /** Fire VOLUME tuning (fire-volume-tuning.ts), patched live — steps, resolutionScale,
     *  ... (flame-march cost study 2026-09-22). Returns the resolved tuning. */
    setFireVolume: (patch: Record<string, number>) => ctx.vfx.burning.setVolume(patch),
    get fireVolume() { return ctx.vfx.burning.volume(); },
    /** Read-only burn telemetry, one entry per tracked actor. */
    burning: () => ctx.vfx.burning.registry.keys().map((a) => {
      const s = ctx.vfx.burning.registry.get(a)!;
      return { id: a.id, kind: a.kind, burn: s.burn, char: s.char, alight: s.alight, dying: s.dying };
    }),
    flameCards: () => {
      const c = ctx.vfx.burning.flameCards();
      return c
        ? { created: true, active: ctx.vfx.burning.activeCount(), live: c.liveCards, atlas: c.atlasMode }
        : { created: false, active: 0, live: 0, atlas: false };
    },
    /** Live burn tuning, clamped through resolveBurnTuning. The fire-light
     *  capture drops `lightGatherPeak`/`lightMeshPeak` to 0 for the paired
     *  with/without-room-light frames; `burnTuning()` reads the live record. */
    setBurnTuning: (patch: Partial<import('./burn-profiles').BurnTuning>) => ctx.vfx.burning.setTuning(patch),
    burnTuning: () => ({ ...ctx.vfx.burning.tuning }),
    // The flame panel's "copy" line pastes straight into the game: technique,
    // tongue (card) tuning and the volumetric-fire tuning.
    setTechnique: (name: import('./game-burning').GameFireTechnique) => ctx.vfx.burning.setTechnique(name),
    technique: () => ctx.vfx.burning.technique(),
    setVolume: (patch: Partial<import('./fire-volume-tuning').FireVolumeTuning>) => ctx.vfx.burning.setVolume(patch),
    volume: () => ctx.vfx.burning.volume(),
    setTongueTuning: (patch: Partial<import('./tongue-tuning').TongueTuning>) => ctx.vfx.burning.setTongueTuning(patch),
    tongue: () => ctx.vfx.burning.tongue(),
    /** Last pushGatherLights census (sources seen / in room / slots pushed). */
    burnGatherDebug: () => ctx.vfx.burning.gatherDebug(),
  };
}
