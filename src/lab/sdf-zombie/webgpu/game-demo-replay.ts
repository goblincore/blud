// src/lab/sdf-zombie/webgpu/game-demo-replay.ts
//
// Demo replay: applying a recording's boot flags, the replay driver that owns the sim clock, and demo synthesis.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { hashFrame } from './demo-hash';
import { DEMO_VERSION, createDemoPlayer, createDemoRecorder, type DemoFile, type DemoFrame, type DemoRecorder } from './demo-recorder';
import { actionsAt, buildFirefight, validateScenario } from './game-bench-scenario';
import { awaitBakes } from './game-chunk-bake';
import { neutralInput, placeFromDemo } from './game-demo-record';
import { applySdfScale } from './game-render-controls';
import { rebuildCast } from './game-spawn';
import { sceneCensus } from './game-telemetry-scene';
import { aimAtNearestSurface, fire, performBenchAction } from './game-weapon-rig';
import { setRngSeed } from './rng';
import { resetSimClock } from './sim-clock';

export type DemoReplayOpts = { hold?: boolean; hash?: boolean; every?: number; hashFrom?: number; label?: string;
  speed?: number; stopAt?: number; resume?: boolean };


/** Apply the DEMO-BOOT flags a replay cares about — the ones that change the
 *  SCENE, not the dev levers the caller pins. Only crowd and sdf scale today;
 *  add a flag here the moment a recording depends on it, or a replay of a
 *  crowd run would silently measure the per-body path. */
export function applyDemoQuery(ctx: GameContext, query: string): void {
  const q = new URLSearchParams(query);
  if (q.has('crowd')) {
    const on = q.get('crowd') === '1';
    if (on !== ctx.crowd.on) { ctx.crowd.on = on; rebuildCast(ctx); }
  }
  if (q.has('scale')) {
    const v = Number(q.get('scale'));
    if (Number.isFinite(v) && v > 0) applySdfScale(ctx, v);
  }
}

/** THE REPLAY DRIVER. Owns the sim: stops the loop, resets the sim clock and
 *  reseeds the streams, applies the scene flags and the start pose, then
 *  steps one fixed frame per recorded frame through applyInputFrame. The
 *  render lock is OFF (a replay mutates) and `demoHold` pins the render-side
 *  clocks, exactly as `demoScenario` does for a recording.
 *
 *  `hash: true` additionally digests the march target and gather layers every
 *  `every` frames — the surface scripts/sdf-demo-hash.mjs drives for
 *  DEMO_HASH_DEM. */
export async function runDemoReplay(ctx: GameContext, file: DemoFile, opts: DemoReplayOpts = {}) {
  if (!file || file.version !== DEMO_VERSION) throw new Error(`demoReplay: version ${file?.version} is not ${DEMO_VERSION}`);
  if (!Array.isArray(file.frames) || file.frames.length === 0) throw new Error('demoReplay: recording has no frames');
  if (opts.hold !== false) ctx.demo.hold = true;
  ctx.boot.handle.setLoopRunning(false);
  const hadAdaptive = ctx.render.adaptiveEnabled; ctx.render.adaptiveEnabled = false;
  const hadReplay = ctx.demo.replayActive; ctx.demo.replayActive = true;
  const hadLock = ctx.demo.simLocked;
  // Render-side cadences reset + settled BEFORE the sim runs, exactly as the
  // bench does under ?simidle. inert for a non-hash caller and REQUIRED for a
  // hash: without it the frame parity and instance pack at frame 0 depend on
  // how long the page happened to boot.
  ctx.demo.hold = true;
  ctx.demo.seedBase = ctx.probes.frame;
  ctx.render.postAa.setTimeFrozen(true);
  ctx.render.sdfLayer.resetFieldPhase();
  ctx.probes.gatherTick = 0;
  // AND the pack waiting to be dispatched. Without this the first replay draw
  // dispatches a pack left over from boot, so the gather gets one extra
  // dispatch in one run and not the other (measured: 301 vs 300), which moves
  // the blended dynamic layer and makes the frame hash flap.
  ctx.probes.pendingGather = null;
  ctx.probes.gather?.reset();
  ctx.demo.simLocked = false;
  const hadHoldPlayer = ctx.player.holdPlayerPose; ctx.player.holdPlayerPose = false;
  // Free-aim vs mouselook is a SIM input mode: it decides whether `look` is
  // pinned or dx/dy drives the reticle. The recording says which one it was
  // captured in; an old file without the flag leaves the page as booted.
  const hadFreeAim = ctx.player.freeAimOn;
  if (typeof file.meta?.freeAim === 'boolean') ctx.player.freeAimOn = file.meta.freeAim;
  const iter = createDemoPlayer(file);
  const hashes: import('./frame-hash').FrameHash[] = [];
  const parity: number[] = [];
  const every = Math.max(1, Math.floor(opts.every ?? 4));
  const hashFrom = Math.max(0, Math.floor(opts.hashFrom ?? 0));
  const started = performance.now();
  let frames = 0;
  let simMs = 0;
  ctx.demo.replayFrame = 0;
  try {
    // The replay starts from the SAME origin the synth/recorder did: sim
    // clock zeroed and the named streams reseeded, so a recorded draw index
    // means the same thing here as it did when captured.
    resetSimClock();
    setRngSeed(file.seed);
    applyDemoQuery(ctx, file.query);
    placeFromDemo(ctx, file);
    ctx.demo.simLocked = false;
    ctx.player.prevInputKeys = new Set<string>();
    ctx.player.currentInputFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [ctx.player.player.yaw, ctx.player.player.pitch] };
    // SETTLE BEFORE FRAME 0. Two replays of one recording differed at the
    // FIRST sampled frame only (frame 0 or 92 alike) — whatever the boot left
    // queued (worker replies, uploads, the first GPU fence) landed on the
    // same yield that took the first hash. Drain it here, before any sim
    // frame, so frame 0 starts from a page that has nothing in flight.
    await awaitBakes(ctx);
    await ctx.boot.handle.resolveGpu();
    for (let f = 0; ; f++) {
      if (opts.stopAt !== undefined && f >= opts.stopAt) break;
      const frame = iter.next();
      if (!frame) break;
      if (opts.speed && opts.speed > 0) {
        const due = started + (simMs / opts.speed);
        const wait = due - performance.now();
        await new Promise(r => (wait > 1 ? setTimeout(r, wait) : requestAnimationFrame(() => r(null))));
      }
      ctx.player.currentInputFrame = frame;
      await awaitBakes(ctx);
      // Per-frame dt when the recording has it (live play is variable-rate).
      const stepDt = frame.dt ?? file.dt;
      simMs += stepDt * 1000;
      ctx.boot.handle.step(stepDt);
      frames++;
      // `hashFrom` skips the RENDER warm-up frames: the scripted recorder
      // settles `warmup` frames before its first hash, and a replay gets the
      // same treatment by not sampling its own first `hashFrom` frames. The
      // SIM still advances through every frame — only the samples are skipped.
      // The final frame is sampled only when it sits on the same interlace
      // field as the regular samples: a recording with an even frame count
      // would otherwise mix parities and the ab gate refuses the run.
      if (opts.hash && f >= hashFrom && (f % every === 0 || (f === file.frames.length - 1 && (f & 1) === (hashFrom & 1)))) {
        await ctx.boot.handle.resolveGpu();
        hashes.push(await hashFrame(ctx.boot.frameHashDeps, f));
        parity.push(f % 2);
      }
    }
  } finally {
    ctx.demo.replayActive = hadReplay;
    ctx.demo.simLocked = hadLock;
    ctx.render.adaptiveEnabled = hadAdaptive;
    ctx.player.holdPlayerPose = hadHoldPlayer;
    ctx.player.freeAimOn = hadFreeAim;
    ctx.player.currentInputFrame = neutralInput(ctx, ctx.player.currentInputFrame);
    if (opts.resume && opts.stopAt === undefined) ctx.boot.handle.setLoopRunning(true);
  }
  return {
    frames,
    census: sceneCensus(ctx),
    hashes,
    parity,
    every,
    ms: Math.round(performance.now() - started),
    dispatches: ctx.probes.frame - ctx.demo.seedBase,
    label: opts.label ?? file.startedAt,
    // Bake outcomes, so a diverging replay can be blamed on a swap without a
    // second run: which soldiers baked, the last gib swap frame, bake count.
    bakes: { corpse: ctx.world.soldierCorpses?.stats() ?? null, chunkSwapFrame: ctx.bake.lastSwapFrame, chunkBakes: ctx.bake.totalBakes, chunkError: ctx.bake.jobs.error },
  };
}

/** Build a SYNTHETIC recording by driving the scripted firefight through the
 *  SAME input seam a live run uses. The executor cannot play by hand, so this
 *  is the honest stand-in: it does not fabricate a fight, it records one the
 *  scenario actually fights, as an input log. The slug shot is expressed the
 *  way a player would — a KeyE press before, a second press after — so the
 *  recording is self-contained and re-toggles cleanly on replay. */
export async function demoSynthesize(ctx: GameContext, o: { room?: number; walkFrames?: number; fireFrames?: number; gibFrames?: number; label?: string } = {}): Promise<DemoFile> {
  const room = o.room ?? 2;
  const scenario = buildFirefight({ room, walkFrames: o.walkFrames, fireFrames: o.fireFrames, gibFrames: o.gibFrames });
  const problems = validateScenario(scenario);
  if (problems.length) throw new Error(`demoSynthesize: bad scenario: ${problems.join('; ')}`);
  ctx.boot.handle.setLoopRunning(false);
  const hadLock = ctx.demo.simLocked; ctx.demo.simLocked = false;
  const hadAdaptive = ctx.render.adaptiveEnabled; ctx.render.adaptiveEnabled = false;
  const hadReplay = ctx.demo.replayActive; ctx.demo.replayActive = true;
  const hadHold = ctx.demo.hold; ctx.demo.hold = true;
  const slugWas = ctx.weapon.slugMode;
  // The scripted aim sets player.yaw/pitch directly, so the synthetic
  // recording is captured in MOUSELOOK mode (freeAim=false) and records that
  // as a precondition. Otherwise a replay would run the reticle path and
  // ignore the recorded look.
  const aimWas = ctx.player.freeAimOn;
  ctx.player.freeAimOn = false;
  let rec: DemoRecorder | null = null;
  try {
    // The scenario's frame-0 teleport is a PRECONDITION, not an input: its
    // computed standoff is recorded as the start pose so a replay can put the
    // player there without re-deriving it from a room id.
    const tele = scenario.steps.find(s => s.at === 0 && s.action.kind === 'teleport');
    if (tele) performBenchAction(ctx, tele.action);
    resetSimClock();
    setRngSeed(ctx.demo.seed);
    ctx.weapon.slugMode = false;
    ctx.player.currentInputFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [ctx.player.player.yaw, ctx.player.player.pitch] };
    rec = createDemoRecorder({
      seed: ctx.demo.seed,
      query: location.search.replace(/^\?/, ''),
      room,
      dt: 1 / 60,
      meta: {
        label: o.label ?? `synthetic-firefight-room${room}`,
        script: 'firefight',
        synthetic: true,
        freeAim: false,
        startPose: { x: ctx.player.player.pos[0], z: ctx.player.player.pos[2], yaw: ctx.player.player.yaw, pitch: ctx.player.player.pitch },
      },
    });
    ctx.player.prevInputKeys = new Set<string>();
    for (let f = 0; f < scenario.frames; f++) {
      let fire: 0 | 1 | 2 = 0;
      let toggleSlug = false;
      for (const a of actionsAt(scenario, f)) {
        if (a.kind === 'aimSurface') aimAtNearestSurface(ctx);
        else if (a.kind === 'fire') fire = a.barrels;
        else if (a.kind === 'fireSlug') { toggleSlug = true; fire = 1; }
      }
      const frame: DemoFrame = {
        keys: toggleSlug ? ['KeyE'] : [], dx: 0, dy: 0, fire, reload: false,
        look: [ctx.player.player.yaw, ctx.player.player.pitch],
      };
      // Stage, do NOT apply: `tick` consumes currentInputFrame through
      // applyInputFrame, exactly as the bench's `input` action does. Applying
      // it here too would fire every shot twice.
      ctx.player.currentInputFrame = frame;
      rec.push(frame);
      await awaitBakes(ctx);
      ctx.boot.handle.step(1 / 60);
      if (toggleSlug) {
        const off: DemoFrame = {
          keys: ['KeyE'], dx: 0, dy: 0, fire: 0, reload: false,
          look: [ctx.player.player.yaw, ctx.player.player.pitch],
        };
        ctx.player.currentInputFrame = off;
        rec.push(off);
        await awaitBakes(ctx);
        ctx.boot.handle.step(1 / 60);
      }
    }
  } finally {
    ctx.weapon.slugMode = slugWas;
    ctx.player.freeAimOn = aimWas;
    ctx.demo.replayActive = hadReplay;
    ctx.demo.simLocked = hadLock;
    ctx.render.adaptiveEnabled = hadAdaptive;
    ctx.demo.hold = hadHold;
    ctx.player.currentInputFrame = neutralInput(ctx, ctx.player.currentInputFrame);
  }
  if (!rec) throw new Error('demoSynthesize: recorder was never created');
  return rec.stop();
}
