// src/lab/sdf-zombie/webgpu/game-demo-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { woundWorldPos, type Wound } from '../damage'
import { type DemoFile, type DemoFrame } from './demo-recorder'
import { type ZombieActor } from './game-actor'
import { ROOMS } from './game-level'


/** Snapshot the listeners' accumulated input as the frame the next tick will
 *  consume. Zeroes the accumulators: a delta belongs to exactly one frame. */
export function readInputFrame(ctx: GameContext): DemoFrame {
  const frame: DemoFrame = {
    keys: [...ctx.player.keys],
    dx: ctx.player.pendingDx,
    dy: ctx.player.pendingDy,
    fire: ctx.weapon.pendingFire,
    reload: ctx.weapon.pendingReload,
    look: [ctx.player.player.yaw, ctx.player.player.pitch],
  };
  ctx.player.pendingDx = 0;
  ctx.player.pendingDy = 0;
  ctx.weapon.pendingFire = 0;
  ctx.weapon.pendingReload = false;
  return frame;
}

export function describeRecordedWound(ctx: GameContext, a: ZombieActor, w: Wound) {
  const prims = a.posed().prims;
  const prim = prims[w.primIdx];
  return { ...w, world: prim ? woundWorldPos(prims, w, a.pose().yaw) : null,
    bone: prim?.bone ?? null, sourceLine: prim?.src ?? null,
    region: prim ? a.posed().clusters[prim.cluster]?.limb ?? null : null };
}

/** Put the player where the recording's frame 0 starts. meta.startPose wins:
 *  the scripted standoff is computed from where the bodies happen to be and
 *  cannot be re-derived from a room id. Room centre is the fallback. */
export function placeFromDemo(ctx: GameContext, file: DemoFile): void {
  const sp = file.meta?.startPose as { x?: number; z?: number; yaw?: number; pitch?: number } | undefined;
  if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.z)) {
    ctx.player.player.pos = [sp.x as number, 0, sp.z as number];
    ctx.player.player.vel = [0, 0, 0];
    ctx.player.player.yaw = Number.isFinite(sp.yaw) ? (sp.yaw as number) : 0;
    ctx.player.player.pitch = Number.isFinite(sp.pitch) ? (sp.pitch as number) : 0;
    ctx.player.player.grounded = true;
    return;
  }
  const r = ROOMS.find(x => x.id === file.room);
  if (r) {
    ctx.player.player.pos = [(r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2];
    ctx.player.player.vel = [0, 0, 0];
    ctx.player.player.yaw = 0;
    ctx.player.player.pitch = 0;
    ctx.player.player.grounded = true;
  }
}

/** A neutral frame for the tick after a recorded one is consumed: it keeps
 *  the last look (so a repeat step cannot snap the camera) but drops every
 *  event, so a warmup step cannot re-fire a shot. */
export function neutralInput(ctx: GameContext, prev: DemoFrame): DemoFrame {
  return { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [prev.look[0], prev.look[1]] };
}

export function updateDemoHud(ctx: GameContext): void {
  if (!ctx.demo.recorder) {
    if (ctx.demo.hudEl) ctx.demo.hudEl.hidden = true;
    return;
  }
  if (!ctx.demo.hudEl) {
    ctx.demo.hudEl = document.createElement('div');
    ctx.demo.hudEl.id = 'demo-rec-status';
    ctx.demo.hudEl.setAttribute('style',
      'position:fixed;bottom:52px;left:12px;z-index:10001;padding:4px 8px;'
      + 'background:#2a0d0dee;color:#ffb4b4;font:12px monospace;border:1px solid #a04a4a;'
      + 'border-radius:5px;pointer-events:none');
    document.body.appendChild(ctx.demo.hudEl);
  }
  ctx.demo.hudEl.hidden = false;
  ctx.demo.hudEl.textContent = `REC \u25cf  frames: ${ctx.demo.recorder.frames}`;
}
