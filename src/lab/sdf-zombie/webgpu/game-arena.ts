// src/lab/sdf-zombie/webgpu/game-arena.ts
//
// THE TEST ARENA (owner: "there isn't a proper way for me to see enemies in testing ... should just be a big room with
// one enemy that I can respawn"). `/sdf-game.html?level=arena&spawn=<character>` loads public/assets/levels/arena.level.json:
// one big lit room, one enemy, god mode on (game-loop.ts; `&god=0` lets it hurt), every weapon, infinite ammo. A level opts
// in with `"arena": true` (level-json.ts). In an arena:
//   `   (Backquote) respawns the enemy fresh (rebuildCast: wounds, gore and gibs cleared),
//   -/= steps to the previous / next character in the registry and spawns it,
// and a label at the top of the screen names the enemy and the keys. The keys are rising edges in applyInputEdges
// (game-player-input.ts), like every other key side effect, so a recorded run replays them.

import type { GameContext } from './game-context';
import { arenaCharacters, arenaStep } from './arena-cycle';
import { rebuildCast } from './game-spawn';

let label: HTMLDivElement | null = null;

function show(ctx: GameContext): void {
  if (!ctx.world.level.def?.arena) return;
  if (!label) {
    label = document.createElement('div');
    // Top centre, just under the row of tuning panels (the bottom of the screen has the HUD and the status line).
    label.setAttribute('style', 'position:fixed; left:50%; transform:translateX(-50%); top:64px; z-index:33; pointer-events:none;'
      + ' font:700 15px/1.4 ui-monospace,Menlo,monospace; color:#f2e6d0; text-shadow:0 2px 0 #000; letter-spacing:.04em; white-space:nowrap;');
    document.body.appendChild(label);
  }
  const name = ctx.boot.spawnOverride ?? 'zombie';
  label.textContent = `ARENA · ${name} · \` respawn · - / = enemy`;
}

/** Boot: the label, when the level is an arena. */
export function installArena(ctx: GameContext): void {
  show(ctx);
}

/** Respawn the arena's enemy, stepping `step` characters through the registry first (0 respawns the same one). */
export function arenaRespawn(ctx: GameContext, step: number): void {
  if (!ctx.world.level.def?.arena) return;
  if (step !== 0) ctx.boot.spawnOverride = arenaStep(arenaCharacters(), ctx.boot.spawnOverride ?? 'zombie', step);
  rebuildCast(ctx);
  show(ctx);
}
