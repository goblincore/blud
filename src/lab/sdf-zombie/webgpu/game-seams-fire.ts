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

export function createFireSeams(ctx: GameContext) {
  return {
    // FLARE TEST HARNESS (slot 4): the weapon verb plus the crowd helpers, so a
    // full room can be set alight without aiming at each body.
    fireFlare: () => ctx.weapon.flare?.fire() ?? false,
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
