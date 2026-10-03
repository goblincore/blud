// src/lab/sdf-zombie/webgpu/game-sequence-leaves.ts
//
// SCRIPTED SEQUENCES in the game (spec 2026-09-30-night-train-egg-ending-design.md §3). The timeline is
// pure (ending-sequence.ts); this leaf holds the runtime on ctx.world.sequence: it starts a sequence on
// the `sequence` level command, advances its clock on the sim step, paints a full-screen DOM overlay
// (flash, black, title text), overrides the camera after the game has placed it, hides the gun and the
// HUD, and when the last shot ends queues the sequence's end event (the level's completeOn turns it into
// completion). While a sequence is active input and damage are blocked (loopBlocksInput, damagePlayer).
//
// This file must not import game-loop-leaves.ts (which imports it): the end event is queued straight onto
// ctx.world.loop.pending.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { EGG } from './egg-look';
import { SEQUENCES, cameraAt, overlayAt, shotAt, totalDuration, type CameraPose, type CameraStart, type Sequence, type Vec3 } from './ending-sequence';

export interface SequenceRuntime {
  seq: Sequence;
  /** Sequence time (s), advanced on the sim step. */
  t: number;
  started: boolean;
  /** Running; false once the end event is queued. */
  active: boolean;
  finished: boolean;
  shotIndex: number;
  /** The player's view when the sequence began (captured by the first camera pass). */
  start: CameraStart | null;
  /** The last pose a shot gave (a hold shot keeps it). */
  last: CameraPose | null;
  anchors: Record<string, Vec3>;
  fovBase: number;
  fovApplied: number;
  el: HTMLDivElement;
  text: HTMLDivElement;
}

function anchorsOf(ctx: GameContext): Record<string, Vec3> {
  const egg = ctx.world.egg;
  if (!egg) return {};
  const c = egg.centre;
  return { egg: [c[0], c[1], c[2]], 'inner-egg': [c[0], c[1] + EGG.innerDy, c[2]] };
}

const css = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);

function paint(rt: SequenceRuntime): void {
  const o = overlayAt(rt.seq, rt.t);
  rt.el.style.background = `rgb(${css(o.rgb[0])}, ${css(o.rgb[1])}, ${css(o.rgb[2])})`;
  rt.el.style.opacity = String(o.alpha);
  rt.text.textContent = o.text ?? '';
}

/** Start sequence `id` (the `sequence.<id>` level command). False when unknown or one already ran. */
export function startSequence(ctx: GameContext, id: string): boolean {
  const seq = SEQUENCES[id];
  if (!seq || ctx.world.sequence?.started) return false;
  const el = document.createElement('div');
  el.setAttribute('style', 'position:fixed; inset:0; z-index:44; pointer-events:none; opacity:0; background:#000;'
    + ' display:grid; place-items:center;');
  const text = document.createElement('div');
  text.setAttribute('style', 'font:700 28px/1.2 ui-monospace,Menlo,monospace; color:#f2e6d0; letter-spacing:.3em;');
  el.appendChild(text);
  document.body.appendChild(el);
  const loop = ctx.world.loop;
  if (loop) { loop.el.status.style.display = 'none'; loop.el.hurt.style.display = 'none'; }
  ctx.world.sequence = {
    seq, t: 0, started: true, active: true, finished: false, shotIndex: -1, start: null, last: null,
    anchors: anchorsOf(ctx), fovBase: 0, fovApplied: 0, el, text,
  };
  ctx.telemetry.telemetry.event('sequence-start', { id });
  return true;
}

/** Per sim step, after stepLoop: the clock, the overlay, and the end. */
export function stepSequence(ctx: GameContext, dt: number): void {
  const rt = ctx.world.sequence;
  if (!rt?.started) return;
  if (ctx.weapon.gunGroup) ctx.weapon.gunGroup.visible = false;   // stepLoop shows it each step; this runs after
  if (!rt.active) return;
  rt.t += dt;
  const at = shotAt(rt.seq, rt.t);
  if (at.index !== rt.shotIndex) {
    rt.shotIndex = at.index;
    ctx.telemetry.telemetry.event('sequence-shot', { id: rt.seq.id, shot: at.shot.id });
  }
  paint(rt);
  if (at.finished) {
    rt.active = false;
    rt.finished = true;
    ctx.world.loop?.pending.push(rt.seq.endEvent);
  }
}

/** After the game placed the camera (and the train's roll and the death camera): the current shot's pose. */
export function applySequenceCamera(ctx: GameContext, camera: THREE.PerspectiveCamera): void {
  const rt = ctx.world.sequence;
  if (!rt?.started) return;
  if (!rt.start) {
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    const p = camera.position;
    rt.start = { eye: [p.x, p.y, p.z], look: [p.x + d.x, p.y + d.y, p.z + d.z] };
    rt.fovBase = camera.fov;
    rt.fovApplied = camera.fov;
  }
  const at = shotAt(rt.seq, rt.t);
  const pose = cameraAt(at.shot.camera, at.u, rt.start, rt.anchors) ?? rt.last;
  if (!pose) return;
  rt.last = pose;
  camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
  camera.lookAt(pose.look[0], pose.look[1], pose.look[2]);
  const want = rt.fovBase + pose.fovDelta;
  if (Math.abs(want - rt.fovApplied) > 1e-4) {
    camera.fov = want;
    camera.updateProjectionMatrix();
    // The lens co-invariant: the render FOV and postAa's lens move together.
    ctx.render.postAa.setLens(camera.fov, ctx.player.centerFovDeg + pose.fovDelta);
    rt.fovApplied = want;
  }
}

/** Seams: `__sdfGame.sequence()`, `startSequence(id)`, `skipSequence()` (jump to the end; the next step finishes it). */
export function createSequenceSeams(ctx: GameContext) {
  const r3 = (v: readonly number[]) => v.map(x => +x.toFixed(3));
  return {
    sequence: () => {
      const rt = ctx.world.sequence;
      if (!rt) return null;
      const at = shotAt(rt.seq, rt.t);
      return {
        id: rt.seq.id, active: rt.active, finished: rt.finished, t: +rt.t.toFixed(3), total: totalDuration(rt.seq),
        shot: at.shot.id, shotIndex: at.index, u: +at.u.toFixed(3), overlay: overlayAt(rt.seq, rt.t),
        camera: rt.last ? { eye: r3(rt.last.eye), look: r3(rt.last.look), fovDelta: +rt.last.fovDelta.toFixed(3) } : null,
      };
    },
    startSequence: (id: string) => startSequence(ctx, id),
    skipSequence: () => {
      const rt = ctx.world.sequence;
      if (!rt?.active) return false;
      rt.t = totalDuration(rt.seq);
      return true;
    },
  };
}
