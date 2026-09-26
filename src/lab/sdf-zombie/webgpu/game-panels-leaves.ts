// src/lab/sdf-zombie/webgpu/game-panels-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { MAGAZINE_CAPACITY } from './game-viewmodel';
import { bodiesOnScreen } from './game-world-leaves';
import { WOUND_STEP_MUL } from './march.wgsl';


export function updateHud(ctx: GameContext) {
  if (!ctx.boot.hudEl) return;
  const where = ctx.world.level.keyAt(ctx.player.player.pos[0], ctx.player.player.pos[2]);
  const S = ctx.weapon.slotState;
  const slot = S.phase !== 'up'
    ? `switching ${S.target}`
    : S.live === 'censer'
      ? `1 CENSER ${ctx.weapon.censer?.debug().phase ?? ''}`.trimEnd()
      : S.live === 'dynamite'
        ? `3 DYNAMITE ${ctx.vfx.cook.phase === 'cooking'
          ? `${(ctx.dynamite.charge * 100).toFixed(0)}% LIT`
          : `${ctx.bake.liveBundles.length} out`}`
        : S.live === 'flare'
          ? '4 FLARE'
          : '2 GRAPESHOT';
  ctx.boot.hudEl.textContent =
    `${ctx.boot.frameEma.toFixed(1)} ms · bodies ${bodiesOnScreen(ctx)}/${ctx.world.actors.length}` +
    ` · ${where} · probe ${ctx.probes.weight.toFixed(2)}` +
    ` · [${slot}]` +
    (ctx.vfx.burning.registry.size > 0 ? ` · burning ${ctx.vfx.burning.activeCount()}` : '') +
    (ctx.weapon.slotState.live === 'shotgun'
      ? ctx.weapon.infiniteAmmo ? ' · shells ∞' : ` · shells ${ctx.weapon.shells}/${MAGAZINE_CAPACITY}`
      : '') +
    (ctx.weapon.slugMode ? ' · ● SLUG (E to switch back)' : ' · PELLETS (E = slug)') +
    (ctx.render.sdfLayer.halfRate
      ? ` · HALF30 ${ctx.render.sdfLayer.halfRateMode === 1 ? 'reproj' : 'hold'}`
      : '') +
    (ctx.player.freeAimOn ? ' · FREE-AIM (G)' : ' · mouselook (G)') +
    // The wound-zone step multiplier, so a setWoundStep() flip is visible
    // (owner: "hard to tell"). 0 = the shipped constant.
    ` · wstep ${(() => { const z = ctx.world.actors[0]?.view.uniforms.perfCfg.value.z ?? 0; return z > 0 ? z.toFixed(2) : `${WOUND_STEP_MUL} (ship)`; })()}` +
    (ctx.render.adaptiveEnabled ? ` · ADAPTIVE r${ctx.render.adaptiveState.rung}` : '') +
    (ctx.render.sdfLayer.temporalStart.on ? ' · TSTART' : '') +
    (ctx.weapon.reloadSpeed !== 1 ? ` · RELOAD x${ctx.weapon.reloadSpeed} (T)` : '') +
    (ctx.boot.hud.lockHint ? ' · click to lock' : '') +
    (ctx.demo.wanderFrozen ? ' · FROZEN' : '');
}
