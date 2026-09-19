// src/lab/sdf-zombie/webgpu/game-demo-leaves2.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type DemoFile } from './demo-recorder'
import { updateDemoHud } from './game-demo-leaves'


/** Stop and (optionally) save. Returns the file so a caller keeps it in
 *  memory; the POST is best-effort — a failed save must not lose the run. */
export async function demoRecordStop(ctx: GameContext, save = true): Promise<DemoFile | null> {
  if (!ctx.demo.recorder) return null;
  const file = ctx.demo.recorder.stop();
  ctx.demo.recorder = null;
  updateDemoHud(ctx);
  if (save) {
    try {
      await fetch('/__lab/save-demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(file),
        signal: AbortSignal.timeout(15000),
      });
    } catch { /* keep the file; the caller still has it */ }
  }
  return file;
}
