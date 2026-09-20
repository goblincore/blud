// src/lab/sdf-zombie/webgpu/game-seams-demo-step.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { withCtx } from './game-context';
import { demoRecordStart } from './game-demo-leaves';
import { demoRecordStop } from './game-demo-leaves2';
import { updateHud } from './game-panels-leaves';
import { playerRoomId } from './game-player-leaves';
import { bodiesOnScreen } from './game-world-leaves';

export function createDemoStepSeams(ctx: GameContext) {
  return {
    /** STAGE-3 RECORDER SEAMS. `demoRecord('start')` begins logging the input
     *  frames the tick consumes; `'stop'` returns the DemoFile and saves it via
     *  POST /__lab/save-demo. F7 does the same toggle. */
    demoRecord: (action: 'start' | 'stop') => (action === 'start' ? demoRecordStart(ctx) : demoRecordStop(ctx, true)),
    /** What the recorder/player is doing right now. `frame` is frames recorded
     *  (live) or frames replayed (replay) — never a wall-clock measure. */
    demoInfo: () => ({
      recording: !!ctx.demo.recorder,
      replaying: ctx.demo.replayActive,
      frame: ctx.demo.replayActive ? ctx.demo.replayFrame : (ctx.demo.recorder?.frames ?? 0),
      seed: ctx.demo.seed,
      room: playerRoomId(ctx),
      demoHold: ctx.demo.hold,
    }),
    /** Hand-step N frames at dt seconds each; stops the rAF loop first. */
    step(n: number, dt = 1 / 60) {
      ctx.boot.handle.setLoopRunning(false);
      for (let i = 0; i < n; i++) {
        ctx.boot.handle.step(dt);
        if (ctx.demo.frameCount++ % 10 === 0) updateHud(ctx);
      }
    },
    bodiesOnScreen: withCtx(ctx, bodiesOnScreen)
  };
}
