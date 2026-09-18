// src/lab/sdf-zombie/webgpu/game-dynamite-tuning.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { GIB_BONES, GIB_MODES, defaultsFrom as dynamiteDefaults, type DynamiteTuningKey, type DynamiteTuningValues } from './dynamite-panel'


/**
 * THE CHUNK-VIEW CEILING — what the shared record pool must be sized for.
 *
 * `MAX_CHUNKS` above is the PRE-DYNAMITE constant (12). The view recycler
 * deliberately does not use it: `?maxchunks` is a live knob because a full-body
 * gib is 19-20 pieces, and the comment on `maxChunks` records what a 12-view
 * pool looked like — pieces 13-20 stealing the views of pieces 1-8 inside one
 * call, which the owner read as "a weird distortion of the SDF bodies like
 * jumping into positions".
 *
 * Main's crowd march (stage a, task 7c) then gave every chunk a SLOT in one
 * shared record buffer, and `createSharedChunkGpuMaterial` sizes that buffer
 * from what the page passes: "the page passes its own view cap (MAX_CHUNKS) so
 * the pool can never under-allocate". On this branch that call site was passing
 * the stale 12 while the recycler allowed 64, so the 13th piece of any real gib
 * hit `shared chunk material is full (12 slots)` — THROWN, inside `gibActor`,
 * inside the tick. The throw landed after the body had already been spliced out
 * of `pendingGibs`, so the gib vanished silently: `gibbed` incremented,
 * `gibPieces` stayed 0, the actor was never retired, and nothing reached the
 * console because the animation loop swallowed it.
 *
 * So the pool is sized from the knob's CEILING, not its current value: the
 * material is built once at boot and `?maxchunks` / the tuning panel can raise
 * the budget at any time afterwards. 96 records is 16 vec4s each — 24 KB.
 */
export const MAX_CHUNK_BUDGET = 96;
/**
 * WHY A SETTLED PIECE NEEDS MORE MICRO-DETAIL THAN THE BODY IT CAME OFF.
 *
 * The creature's authored `surfaceNoiseAmp` is 0.06, and on a MARCHED body
 * that is enough: the march perturbs a per-pixel analytic normal taken from
 * the SDF gradient, and it has silhouette noise on top. A baked chunk has
 * neither — its normal is an interpolated vertex normal across a 1 cm mesh,
 * already smooth — so the identical amplitude reads as nothing at all.
 *
 * Measured on a FROZEN scene, one settled piece, same camera, same pixels:
 * at 0 and at 0.06 the piece is a clean even gradient; at 0.9 it is visibly
 * grainy; 0.35 is textured without reading as noise. 6x takes the authored
 * 0.06 to 0.36, which lands in that band and keeps the value TRACKING the
 * creature rather than replacing it — move the wound panel's slider and a
 * settled piece still follows.
 */
export const CHUNK_DETAIL_GAIN = 6;

/**
 * THE PANEL'S SETTER — one entry point for every knob it owns, and the
 * read-back source for its sliders. A knob that the panel can move but this
 * function ignores is the "tuning that looked applied and was not" bug both
 * the beam and goo panels shipped; `dynamite-panel.test.ts` pins the key
 * union against this switch's cases.
 */
export function applyDynamiteTuning(ctx: GameContext, patch: Partial<DynamiteTuningValues>): void {
  for (const [k, raw] of Object.entries(patch)) {
    if (raw === undefined || !Number.isFinite(raw)) continue;
    switch (k as DynamiteTuningKey) {
      case 'blastdistort':
        ctx.render.postAa.setBlastDistort(raw >= 0.5);
        break;
      case 'bdstrength':
        ctx.vfx.blastDistortStrength = Math.max(0, Math.min(4, raw));
        ctx.render.postAa.setBlastDistortStrength(ctx.vfx.blastDistortStrength);
        break;
      case 'maxchunks':
        ctx.bake.maxChunks = Math.max(1, Math.min(MAX_CHUNK_BUDGET, Math.round(raw)));
        break;
      case 'mode':
        ctx.gibs.mode = GIB_MODES[Math.max(0, Math.min(2, Math.round(raw)))]!;
        break;
      case 'bones':
        ctx.gibs.bones = GIB_BONES[Math.max(0, Math.min(2, Math.round(raw)))]!;
        break;
      case 'stagger':
        ctx.gibs.staggerFrames = Math.max(1, Math.min(8, Math.round(raw)));
        break;
      case 'tearSec':
        ctx.gibs.tearSec = Math.max(0, Math.min(0.4, raw));
        break;
      case 'tearAmp':
        ctx.vfx.tearShape.amplitudeM = Math.max(0, Math.min(0.12, raw));
        break;
      case 'tearJiggle':
        ctx.vfx.tearShape.jiggleAmp = Math.max(0, Math.min(1, raw));
        break;
      case 'gibvel':
        ctx.gibs.velScale = Math.max(0, Math.min(2, raw));
        break;
      // SETTLED-PIECE DETAIL. `chunkdetail` sets the OVERRIDE, so once the
      // slider is touched the piece stops following the creature's own
      // surfaceNoiseAmp — which is the point of a look lever. The per-frame
      // push reads all three, so a settled piece already on the floor changes
      // on the next frame; there is no rebake.
      case 'chunkdetail':
        ctx.bake.detailOverride = Math.max(0, Math.min(1, raw));
        break;
      case 'chunkdetailfreq':
        ctx.bake.detailFreq = Math.max(0.5, Math.min(64, raw));
        break;
      case 'chunkdetailalbedo':
        ctx.bake.detailAlbedo = Math.max(0, Math.min(1.5, raw));
        break;
      // FUTURE settles only — already-baked pieces stay baked until shot or
      // recycled. The panel row says so too.
      case 'chunkbake':
        ctx.bake.enabled = Math.round(raw) === 1;
        break;
      case 'aoesize':
        ctx.vfx.aoeRadiusScale = Math.max(0.3, Math.min(1.5, raw));
        break;
      case 'edgekick':
        ctx.vfx.aoeLaunchFloor = Math.max(0, Math.min(1, raw));
        break;
      case 'fxlight':
        ctx.lighting.fxLightScale = Math.max(0, Math.min(4, raw));
        break;
      case 'fxspread':
        ctx.vfx.spread = Math.max(0, Math.min(3, raw));
        break;
      case 'fxsize':
        ctx.vfx.size = Math.max(0.1, Math.min(2, raw));
        break;
      // Everything below is the burst module's own tuning record.
      default: {
        const fxKey: Record<string, string> = {
          fxsmoke: 'smokeOpacity', fxlife: 'lifeSec', fxgain: 'gain', plume: 'plumeMix',
          capflat: 'capFlatten', neck: 'plumeNeckH', cap: 'plumeCapH',
          ringreach: 'ringReachH', ringopacity: 'ringOpacity', emberspeed: 'emberSpeedPerH',
        };
        const target = fxKey[k];
        if (!target) break;
        ctx.vfx.explosionVfx?.setTuning({
          [target]: raw,
          // The FLATTEN has a second field for the FIRE cap; keep them equal
          // so one slider cannot leave the two halves of the cap disagreeing.
          ...(k === 'capflat' ? { capFireFlatten: Math.min(1, 0.5 + raw * 0.25) } : {}),
          // ...and the plume A/B is four settings in the page's own wiring
          // (see the boot block), so the slider mirrors it here too.
          ...(k === 'plume'
            ? { fireCapShare: raw, capFlatten: 1 - (1 - 0.55) * raw,
                capFireFlatten: 1 - (1 - 0.5) * raw }
            : {}),
        } as never);
        break;
      }
    }
  }
  // The tear is per-ACTOR state, so a change has to be pushed to every body —
  // and to any body that starts tearing later (`scheduleGib` re-applies it).
  for (const a of ctx.world.actors) a.setTearTuning({ sec: ctx.gibs.tearSec, ...ctx.vfx.tearShape });
  ctx.panels.dynamitePanel?.refresh();
}

/** What the panel reads back. The BURST half is asked of the module rather
 *  than mirrored here: a second copy of those numbers would be the drift this
 *  panel exists to avoid. */
export function dynamiteTuningValues(ctx: GameContext): DynamiteTuningValues {
  const t = ctx.vfx.explosionVfx?.tuning;
  return {
    ...dynamiteDefaults(),
    blastdistort: ctx.render.postAa.blastDistort ? 1 : 0,
    bdstrength: ctx.render.postAa.blastDistortStrength,
    maxchunks: ctx.bake.maxChunks,
    mode: Math.max(0, GIB_MODES.indexOf(ctx.gibs.mode as typeof GIB_MODES[number])),
    bones: Math.max(0, GIB_BONES.indexOf(ctx.gibs.bones as typeof GIB_BONES[number])),
    stagger: ctx.gibs.staggerFrames,
    tearSec: ctx.gibs.tearSec,
    tearAmp: ctx.vfx.tearShape.amplitudeM,
    tearJiggle: ctx.vfx.tearShape.jiggleAmp,
    gibvel: ctx.gibs.velScale,
    // The settled piece's detail. `chunkdetail` reports the EFFECTIVE
    // amplitude — the override if one is set, otherwise the creature's own
    // surfaceNoiseAmp through the gain — because that is what the slider
    // should show on open, and what the shader is actually using.
    chunkdetail: ctx.bake.detailOverride
      ?? Math.min(1, (ctx.world.actors[0]?.view.uniforms.surfCfg2.value.y ?? 0) * CHUNK_DETAIL_GAIN),
    chunkdetailfreq: ctx.bake.detailFreq,
    chunkdetailalbedo: ctx.bake.detailAlbedo,
    chunkbake: ctx.bake.enabled ? 1 : 0,
    aoesize: ctx.vfx.aoeRadiusScale,
    edgekick: ctx.vfx.aoeLaunchFloor,
    fxsize: ctx.vfx.size,
    fxlight: ctx.lighting.fxLightScale,
    fxspread: ctx.vfx.spread,
    ...(t ? {
      fxsmoke: t.smokeOpacity, fxlife: t.lifeSec, fxgain: t.gain, plume: t.plumeMix,
      capflat: t.capFlatten, neck: t.plumeNeckH, cap: t.plumeCapH,
      ringreach: t.ringReachH, ringopacity: t.ringOpacity, emberspeed: t.emberSpeedPerH,
    } : {}),
  };
}
