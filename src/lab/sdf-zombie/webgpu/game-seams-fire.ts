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
import { meltActor } from './game-melter';
import { zapActor, zapLookSeam, zaps } from './game-zap';
import { setZapFxArcs, zapBodyBox } from './game-zap-fx';
import { meltSlumpOn, setMeltSlump } from './game-actor';
import { type Vec3 } from '../types';
import type { SplitPresetId } from '../head-split';
import { SPLIT_ABL, SPLIT_ABLATE, SPLIT_BOUND, SPLIT_FILM_OFF, splitAblate } from './split-ablate';

export function createFireSeams(ctx: GameContext) {
  return {
    // FLARE TEST HARNESS (slot 5): the weapon verb plus the crowd helpers, so a
    // full room can be set alight without aiming at each body.
    fireFlare: () => ctx.weapon.flare?.fire() ?? false,
    // MELT (game-melter.ts): slot 8's verb; melt actor `id` (or every body when omitted), how many started;
    // each melting body's progress.
    fireMelter: () => ctx.weapon.melter?.fire() ?? false,
    // `hit` (world): where it was shot; the melt starts there.
    meltActor: (id?: number, hit?: Vec3) => ctx.world.actors.filter(a => id === undefined || a.id === id)
      .filter(a => meltActor(ctx, a, hit)).length,
    // ZAP (game-zap.ts): put the arc on actor `id` (or every body when omitted), how many started; drop it;
    // and the readout.
    zapActor: (id?: number) => ctx.world.actors.filter(a => id === undefined || a.id === id)
      .filter(a => zapActor(ctx, a)).length,
    unzapActor: (id?: number) => { for (const a of ctx.world.actors) if (id === undefined || a.id === id) a.setArc(false); },
    zaps: () => zaps(ctx),
    // The zap's look variant (zap-look.ts, look spike 2026-11-18): 'a' the baseline, 'b', 'c'. No argument: read it.
    zapLook: (id?: string) => zapLookSeam(id),
    // Capture seams of the look spike: the crawl arcs on or off; the box round actor `id`'s live parts.
    zapFxArcs: (on = true) => setZapFxArcs(on),
    zapBox: (id: number) => { const a = ctx.world.actors.find(x => x.id === id); return a ? zapBodyBox(a) : null; },
    // Slot 9's verb: hold (true) or release (false) the tesla's fire; and its state (fire held, the arc's body or -1).
    fireTesla: (on = true) => { ctx.weapon.tesla?.fire(on); },
    tesla: () => ctx.weapon.tesla?.debug() ?? null,
    melts: () => ctx.world.actors.filter(a => a.melting()).map(a => ({ id: a.id, t: a.meltProgress() })),
    /** A/B: whether a melting body slumps as a ragdoll part-way (default on). Returns the new state. */
    setMeltSlump: (on: boolean) => { setMeltSlump(on); return meltSlumpOn(); },
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
    /** Gate seam: drive actor `id`'s split wobble by hand, with world accelerations of its mass point taken one a tick
     *  in place of the pose's (game-head-split.ts script; null clears). */
    headSplitDrive: (id: number, accs: readonly Vec3[] | null) => ctx.weapon.headSplit?.script(id, accs) ?? false,
    /** THE OPEN HEAD'S COST, TAKEN APART (split-ablate.ts; scripts/open-head-cost.mjs): set the runtime shader mask
     *  (SPLIT_ABL bits; they act only on a page opened with `?splitablate`) and which bounds stay the closed head's
     *  (SPLIT_BOUND bits), then re-make every split actor's bounds and record. Cost only: every leg but 0 / 0 draws
     *  a wrong frame. No argument reads the state. */
    splitAblate: (set?: { mask?: number; boundsOff?: number }) => {
      if (set) {
        if (typeof set.mask === 'number') splitAblate.mask = set.mask | 0;
        if (typeof set.boundsOff === 'number') splitAblate.boundsOff = set.boundsOff | 0;
        ctx.weapon.headSplit?.refresh();
      }
      return { compiled: SPLIT_ABLATE, filmOff: SPLIT_FILM_OFF, mask: splitAblate.mask, boundsOff: splitAblate.boundsOff, bits: SPLIT_ABL, bounds: SPLIT_BOUND };
    },
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
        burnPhase: a.burnPhase(),
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
        ? { created: true, active: ctx.vfx.burning.activeCount(), live: c.liveCards, atlas: c.atlasMode, ...ctx.vfx.burning.cullStats() }
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
