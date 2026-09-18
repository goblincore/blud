// src/lab/sdf-zombie/webgpu/game-seams-misc.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { impactSplashProfiles } from './impact-splash-profiles';
import { DATA_ROWS as CROWD_DATA_ROWS } from './march.wgsl';

export function createMiscSeams(ctx: GameContext) {
  return {
    /** The boot demo seed: `?seed=` when given, otherwise random. Reported so
     *  a recording/replay can pin it (stage 3 seam `demoInfo()`). */
    get demoSeed() { return ctx.demo.seed; },
    telemetry: ctx.telemetry.controls ? {
      start: () => ctx.telemetry.controls!.start(), stop: () => ctx.telemetry.controls!.stop(), mark: () => ctx.telemetry.controls!.mark(),
      get active() { return ctx.telemetry.telemetry.active; }, lastCapture: () => ctx.telemetry.controls!.lastCapture(),
    } : null,
    /** STAGE a-2: swap the crowd dispatch on every live type (and remember it
     *  for types created later). The instCfg.y stamp and the tile rebin land
     *  on the next sync(); a fresh page boot with ?crowddispatch= is the
     *  cheaper way to A/B. */
    setCrowdDispatch(mode: 'boxes' | 'quad') {
      ctx.crowd.dispatch = mode;
      for (const t of ctx.crowd.types.values()) t.setDispatch(mode);
    },
    /** Crowd stage a census: the flag, the dispatch, and per type
     *  attached/live slots plus tile-binding fallbacks (bench + hash
     *  diagnostics). */
    crowdInfo: () => ({
      on: ctx.crowd.on,
      // DEFAULT FLIP (task 8, 2026-09-14). `default` is the compiled-in
      // default; `flag` echoes the opt-out so a script can distinguish "on
      // because default" from "on because ?crowd=1". `fallbackReason` is set
      // only when a stage-3-incompatible pass forced this boot per-body.
      default: true,
      flag: ctx.crowd.param === '1' ? 'crowd=1' : ctx.crowd.param === '0' ? 'crowd=0' : null,
      fallbackReason: ctx.crowd.fallbackReason,
      // The crowd march requires its tile list (see the draw-fn sync block):
      // true whenever the crowd is live. Gated on `on` so a crowd-off boot
      // with stale type uniforms cannot read true.
      tilesOn: ctx.crowd.on && [...ctx.crowd.types.values()].some(t => t.info().tilesOn),
      dispatch: ctx.crowd.dispatch,
      // Fire/gib profiling (2026-09-14): aggregate counters over the live
      // types, computed from ONE info() pass (info() runs the diagnostic
      // tile binner on demand, so calling it repeatedly is not free).
      ...(() => {
        let atlasFlushes = 0, atlasRows = 0, recordsFlushes = 0, volumeRebinds = 0;
        const types = [...ctx.crowd.types].map(([n, t]) => {
          const i = t.info();
          atlasFlushes += i.atlasFlushes; atlasRows += i.atlasRows;
          recordsFlushes += i.recordsFlushes; volumeRebinds += i.volumeRebinds;
          return { name: n, ...i };
        });
        return { atlasFlushes, atlasRows, recordsFlushes, volumeRebinds, types };
      })(),
    }),
    get demoHold() { return ctx.demo.hold; },
    /** Freeze/unfreeze the wanderers (pose, rig and shader clock all pin). */
    freeze: (on: boolean) => { ctx.demo.wanderFrozen = on; },
    get frozen() { return ctx.demo.wanderFrozen; },
    /** TASK-6 RENDER LOCK: while on, tick() mutates nothing (see simLocked),
     *  so step(n) is n deterministic re-renders. Turn OFF around any state
     *  change; settle transients with step(~90); turn back on to observe. */
    setRenderLock: (on: boolean) => { ctx.demo.simLocked = on; },
    get renderLock() { return ctx.demo.simLocked; },
    /** Frames actually PRESENTED. Under a frame cap the rAF loop still wakes
     *  every vsync and skips most of them, so raw rAF gaps measure the display
     *  rather than the cadence -- count this instead. */
    presentCount: () => ctx.demo.frameCount,
    // ---------------------------------------------------------------
    // SELECTIVE SHUTTER BLUR (2026-09-17). The ordinary controls are on/off,
    // exposure ms and max trail length; seed scale and depth bias are the
    // documented debug seams. All read back the APPLIED value.
    // ---------------------------------------------------------------
    /** On/off. Returns the resulting state. Off restores the fused sharp goo. */
    setBloodBlur: (on: boolean) => {
      const next = ctx.panels.shutterGame?.setEnabled(on) ?? false;
      ctx.panels.shutterPanel?.refresh();
      return next;
    },
    get bloodBlurEnabled() { return ctx.panels.shutterGame?.enabled ?? false; },
    /** DEBUG: seed grid scale vs the goo density dims. Clamped [0.25, 2]. */
    setBloodBlurSeedScale: (v: number) => ctx.panels.shutterGame?.setSeedScale(v) ?? 0,
    /** DEBUG: destination depth bias in metres. Clamped [0, 50]. */
    setBloodBlurDepthBias: (m: number) => ctx.panels.shutterGame?.setDepthBiasM(m) ?? 0,
    /** Effective values, seed/layer dims, per-frame stats and any hard error. */
    get bloodBlur() {
      return ctx.panels.shutterGame
        ? ctx.panels.shutterGame.diagnostics()
        : { enabled: false, unavailable: true, route: 'capture-stage' as const };
    },
    /** Show/hide the focused shutter controls. */
    shutterPanel: (on?: boolean) => {
      if (on !== undefined) ctx.panels.shutterPanel?.setVisible(on);
      ctx.panels.shutterPanel?.refresh();
      return ctx.panels.shutterPanel?.visible ?? false;
    },
    /** Show/hide the live tuning panel independently of the layer. */
    gooPanel(on: boolean) {
      ctx.panels.gooPanel?.setVisible(on);
      return ctx.panels.gooPanel?.visible ?? false;
    },
    /** Show/hide the WOUND tuning panel (ships visible but collapsed; see
     *  woundPanel's declaration). Same shape as gooPanel so capture scripts
     *  can guard it the same typeof way. */
    woundPanel(on: boolean) {
      ctx.panels.woundPanel?.setVisible(on);
      return ctx.panels.woundPanel?.visible ?? false;
    },
    /** Expand or re-collapse the GOO panel. Panels ship COLLAPSED so they stop
     *  covering the frame; a capture script that actually wants to photograph
     *  the sliders opens it with this. */
    gooPanelCollapsed(on: boolean) {
      ctx.panels.gooPanel?.setCollapsed(on);
      return ctx.panels.gooPanel?.collapsed ?? true;
    },
    /** Show/hide the DYNAMITE / GIB tuning panel (dynamite-panel.ts). Same
     *  shape as the other three so a capture script can dismiss them all. */
    dynamitePanel(on: boolean) {
      ctx.panels.dynamitePanel?.setVisible(on);
      return ctx.panels.dynamitePanel?.visible ?? false;
    },
    /** Expand or re-collapse the DYNAMITE / GIB panel. */
    dynamitePanelCollapsed(on: boolean) {
      ctx.panels.dynamitePanel?.setCollapsed(on);
      return ctx.panels.dynamitePanel?.collapsed ?? true;
    },
    woundPanelCollapsed(on: boolean) {
      ctx.panels.woundPanel?.setCollapsed(on);
      return ctx.panels.woundPanel?.collapsed ?? true;
    },
    /** Show/hide the VHS tuning panel (vhs-panel.ts). Same shape as the two
     *  above, so a capture script can dismiss all three the same way. */
    vhsPanel(on: boolean) {
      ctx.panels.vhsPanel?.setVisible(on);
      return ctx.panels.vhsPanel?.visible ?? false;
    },
    vhsPanelCollapsed(on: boolean) {
      ctx.panels.vhsPanel?.setCollapsed(on);
      return ctx.panels.vhsPanel?.collapsed ?? true;
    },
    get impactSplash() {
      return {
        enabled: ctx.panels.impactSplashEnabled,
        available: ctx.panels.impactSplashLayer !== null,
        profiles: structuredClone(impactSplashProfiles),
        events: ctx.panels.impactSplashLayer?.eventCount ?? 0,
      };
    },
    /** Diagnostic: a band's row (4 floats per prim column) from a crowd type's atlas. */
    crowdBandRow(typeName: string, slot: number, row: number, cols = 8) {
      const t = ctx.crowd.types.get(typeName); if (!t) return null;
      const w = t.atlas.texture.image.width as number; const r0 = slot * CROWD_DATA_ROWS + row;
      return Array.from(t.atlas.texels.subarray(r0 * w * 4, r0 * w * 4 + cols * 4));
    },
    /** AUTOMATION: light the fuse / let it go, the two edges a mouse provides.
     *  Kept as edges rather than a cooked-to-order throw so a gate drives the
     *  SAME path a player does. */
    dynamitePress: () => { ctx.dynamite.press = true; return { ok: true }; },
    dynamiteRelease: () => { ctx.dynamite.release = true; return { ok: true }; },
    get frames() { return ctx.demo.frameCount; }
  };
}
