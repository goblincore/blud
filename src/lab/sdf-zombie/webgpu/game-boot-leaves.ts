// src/lab/sdf-zombie/webgpu/game-boot-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';



export function setLoader(ctx: GameContext, text: string, ready = false): void {
  if (ctx.boot.loaderDisabled) return;
  const status = document.getElementById('loader-status');
  if (status) status.textContent = text;
  if (ready) ctx.boot.loaderEl?.classList.add('loader-ready');
}
