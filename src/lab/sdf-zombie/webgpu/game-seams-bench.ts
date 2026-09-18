// src/lab/sdf-zombie/webgpu/game-seams-bench.ts
//
// Seam module: the `bench` and `demoScenario` members lifted verbatim out of
// the `__sdfGame` object literal in game-main.ts. Bodies are unchanged apart
// from `d.<dep>` for the four closures that still live in main(); the later
// integration step spreads `createBenchSeams(ctx, d)` into that literal.
import type { GameContext } from './game-context';
import {
  buildFirefight, buildCloseup, validateScenario, actionsAt,
  type BenchAction, type Scenario,
} from './game-bench-scenario';
import { runBench, type BenchDeps as GameBenchDeps, type BenchMode } from './game-bench';
import type { DemoFile } from './demo-recorder';
import { hashFrame, DEFAULT_TILES_X, DEFAULT_TILES_Y } from './demo-hash';
import { beginPassFrame } from './gpu-pass-timing';
import { initialAdaptiveState } from '../adaptive-scale';
import { setRngSeed } from './rng';
import { resetSimClock } from './sim-clock';
import type { Vec3 } from '../types';

/** Closures this group still needs from main(). */
export interface BenchDeps {
  awaitBakes: () => Promise<void>;
  bodiesOnScreen: () => number;
  demoScenarioOf: (file: DemoFile) => Scenario;
  performBenchAction: (a: BenchAction) => void;
}

export function createBenchSeams(ctx: GameContext, d: BenchDeps) {
  // The lifted `bench` member annotates its inner `deps` object with
  // `BenchDeps`, and that name belongs to ./game-bench, not to the seam deps
  // interface above. Shadow it so the lifted body stays byte-identical.
  type BenchDeps = GameBenchDeps;
  return {
    /**
     * Run one bench leg.
     *
     * Parks the result on window.__gameBench as well as returning it: a
     * console call that returns a value can itself hide the page, and a
     * hidden page has no swapchain texture, so its passes do nothing and the
     * fence resolves to ~0.065 ms of nothing. That reads as a 70x speedup.
     * The harness counts hidden frames and invalidates the run, but reading
     * the value back afterwards avoids provoking it in the first place.
     */
    async bench(o: {
      room?: number; mode?: BenchMode;
      /** 'closeup' — the static frozen-frame scenario (buildCloseup): no
       *  teleport, no shots; the DRIVER stages camera + wounds before
       *  calling. Default 'firefight' — the scripted walk/fire/gib. */
      kind?: 'firefight' | 'closeup';
      closeupFrames?: number;
      walkFrames?: number; fireFrames?: number; gibFrames?: number;
      chunkFrames?: number; warmup?: number; label?: string;
      /** Hold the player's placed pose (distance-crowd scene, 2026-09-14):
       *  strips the scenario's frame-0 teleport and looks, zeroes the walk
       *  input, and re-pins pos/vel after every step so a wandering body's
       *  collision cannot shove the camera and move the measured distance.
       *  The caller is responsible for having placed the player first
       *  (`placePlayer`) — this only FREEZES the pose, it does not set it. */
      holdPlayer?: boolean;
      /** Drop every fire/fireSlug step (the frame-guard PROBE only). The
       *  probe runs the whole scenario before the measured run, so its
       *  shots kill a large crowd and the real run then measures a decimated
       *  scene — observed at n=20, where the walk segment started with 2 of
       *  21 bodies. The probe only needs the walk scene's frame cost, so it
       *  runs unarmed. */
      noShots?: boolean;
      /** REPLAY A RECORDING instead of the scripted scenario (stage 3). Every
       *  leg then plays the SAME inputs, so a census difference between two
       *  legs is a sim leak rather than two different fights. Segments become
       *  equal thirds (t0/t1/t2); the timers and census machinery are
       *  unchanged. The caller passes `warmup: 0` so the replay starts at the
       *  recording's frame 0. */
      demo?: DemoFile;
    } = {}) {
      const scenario = o.demo
        ? d.demoScenarioOf(o.demo)
        : o.kind === 'closeup'
          ? buildCloseup({ frames: o.closeupFrames })
          : buildFirefight({
            room: o.room ?? 4,
            walkFrames: o.walkFrames,
            fireFrames: o.fireFrames,
            gibFrames: o.gibFrames,
          });
      // HOLD THE PLAYER. Drop every action that writes the player's pose
      // (the firefight's teleport/look) and the frame-0 `freeze: false` (the
      // distance scene pre-froze the cast for a stable distance; letting the
      // scenario unfreeze would walk the crowd onto the camera again).
      // aimSurface/fire/fireSlug stay, so the segments still run the scripted
      // shots at the placed pose and frozen bodies.
      if (o.holdPlayer) {
        scenario.steps = scenario.steps.filter(
          s => s.action.kind !== 'teleport'
            && s.action.kind !== 'look'
            && s.action.kind !== 'freeze',
        );
      }
      if (o.noShots) {
        scenario.steps = scenario.steps.filter(
          s => s.action.kind !== 'fire' && s.action.kind !== 'fireSlug',
        );
      }
      const problems = validateScenario(scenario);
      if (problems.length) throw new Error(`bad scenario: ${problems.join('; ')}`);

      // Captured AFTER the caller's placePlayer(): the pose every step is
      // restored to. pos/vel are copies, not aliases.
      const held = o.holdPlayer
        ? { pos: [...ctx.player.player.pos] as Vec3, yaw: ctx.player.player.yaw, pitch: ctx.player.player.pitch }
        : null;
      const restoreHeldPose = () => {
        if (!held) return;
        ctx.player.player.pos = [held.pos[0], held.pos[1], held.pos[2]];
        ctx.player.player.vel = [0, 0, 0];
        ctx.player.player.yaw = held.yaw;
        ctx.player.player.pitch = held.pitch;
      };
      const hadHoldPlayer = ctx.player.holdPlayerPose;
      ctx.player.holdPlayerPose = o.holdPlayer === true;

      ctx.boot.handle.setLoopRunning(false);
      // Clear the `?simidle=1` boot lock (see simLocked): the scenario this runs
      // must start from the deterministic spawn state, not from a set of frames
      // the boot loop happened to take. RESTORED in the finally — otherwise the
      // rAF loop it restarts would tick the sim freely between the probe and the
      // measured run, which is the same wall-clock divergence one layer up.
      const hadSimLock = ctx.demo.simLocked;
      ctx.demo.simLocked = false;
      // Pin the RENDER-side clocks the frame hash reads, for the same reason: a
      // repeated run must render the same frame. `demoHold` fixes the gather's
      // per-dispatch `frameSeed` and drives `view.setTime` from the SIM clock;
      // without it the hash drifts with the dispatch count even when the sim is
      // identical. Left ON (not restored): inter-run render frames must also see
      // it, or the gather re-rotates its rays between the probe and the run.
      // Sim-idle boots only — normal play and other bench callers are untouched.
      const hasSimIdle = new URLSearchParams(location.search).has('simidle');
      if (o.demo || hasSimIdle) {
        ctx.demo.hold = true;
        ctx.demo.seedBase = ctx.probes.frame;
        ctx.render.postAa.setTimeFrozen(true);
        // The interlaced field is a two-state function of an absolute render
        // counter, so a single end-of-run hash only compares at a fixed phase.
        ctx.render.sdfLayer.resetFieldPhase();
        // And the gather is dispatched only every `probeGatherRate` ticks, so
        // WHICH frame the packed instances/dynamic layer were last built on is
        // a function of the absolute tick counter. Reset the cadence phase too,
        // or the end-of-run `instances`/`probeDyn` hashes differ between a
        // first page load and a warm one. Diagnostic only: `probeFrame`
        // (dispatch count) and the demo seed are left alone.
        ctx.probes.gatherTick = 0;
        // The dynamic layer blends each dispatch into the previous values, so it
        // is a function of the dispatch count too. Start every run from zero, or
        // the first page load and a warm one hash differently (measured).
        // pendingGather too: a pack left over from boot would be dispatched on
        // the first measured draw, giving one run an extra gather dispatch.
        ctx.probes.pendingGather = null;
        ctx.probes.gather?.reset();
      }
      // A DEMO bench run IS a replay: the recording's frames are staged as
      // `input` actions and consumed by tick through applyInputFrame, and the
      // sim streams + clock reset to the recording's own origin so every leg
      // and every repeat starts from the same draw index. Inert off the demo
      // path, so normal play and every other bench call are untouched.
      const hadReplay = ctx.demo.replayActive;
      const hadFreeAim = ctx.player.freeAimOn;
      if (o.demo) {
        ctx.demo.replayActive = true;
        ctx.demo.replayFrame = 0;
        resetSimClock();
        setRngSeed(o.demo.seed);
        if (typeof o.demo.meta?.freeAim === 'boolean') ctx.player.freeAimOn = o.demo.meta.freeAim;
        ctx.player.prevInputKeys = new Set<string>();
      }
      const hadAdaptive = ctx.render.adaptiveEnabled;
      ctx.render.adaptiveEnabled = false;
      const hadTelemetry = ctx.telemetry.telemetry.active;
      if (o.mode === 'passes') ctx.telemetry.telemetry.active = true;
      try {
        const deps: BenchDeps = {
          step: (dt) => { beginPassFrame(); ctx.boot.handle.step(dt); restoreHeldPose(); },
          beforeStep: d.awaitBakes,
          // 'passes' mode: CPU tick/draw plus the telemetry phases the tick
          // already brackets (blood sim, goo sync, body step, ...). Telemetry
          // is switched active for the run so begin()/end() record; no frame
          // observer runs while the loop is off, so nothing else is captured.
          stepTimed: (dt) => {
            beginPassFrame();
            ctx.telemetry.telemetry.drainPhases();
            const t = ctx.boot.handle.stepTimed(dt);
            restoreHeldPose();
            const out: Record<string, number> = { 'cpu:tick': t.tickMs, 'cpu:draw': t.drawMs };
            for (const [k, v] of Object.entries(ctx.telemetry.telemetry.drainPhases())) out[`cpu:phase:${k}`] = v;
            return out;
          },
          resolveGpu: () => ctx.boot.handle.resolveGpu(),
          passTimings: () => ctx.boot.passTiming.collect(),
          // THE FRAME HASH, once per leg and AFTER every timing sample (see
          // BenchDeps.endHash). The census below counts what the page CONTAINS;
          // this digests what it RENDERS — the half of the workload the census
          // is blind to, and the half that shipped two playtest-caught bugs on
          // 2026-09-10 (the zeroed dynamic probe layer, and tracer light slots
          // defaulting to 0).
          endHash: () => hashFrame(ctx.boot.frameHashDeps, ctx.demo.frameCount),
          now: () => performance.now(),
          hidden: () => document.hidden,
          census: () => ({
            bodies: d.bodiesOnScreen(),
            wounds: ctx.world.actors.reduce((n, a) => n + a.wounds().length, 0),
            chunks: ctx.bake.liveChunks.length,
            droplets: ctx.vfx.bloodSim.droplets.length,
            splats: ctx.vfx.bloodSim.splats.length,
            gooQuads: ctx.goo.layer?.liveCount ?? 0,
          }),
          perform: d.performBenchAction,
        };
        const result = await runBench(deps, scenario, {
          mode: o.mode ?? 'throughput',
          chunkFrames: o.chunkFrames,
          warmup: o.warmup,
          label: o.label,
        });
        (window as unknown as { __gameBench: unknown }).__gameBench = result;
        return result;
      } finally {
        ctx.player.holdPlayerPose = hadHoldPlayer;
        ctx.demo.replayActive = hadReplay;
        ctx.player.freeAimOn = hadFreeAim;
        restoreHeldPose();
        // Re-lock under `?simidle` so the frames the restarted loop renders
        // between runs cannot mutate the sim (see the capture at the top).
        ctx.demo.simLocked = hadSimLock;
        ctx.render.adaptiveEnabled = hadAdaptive;
        ctx.telemetry.telemetry.active = hadTelemetry;
        ctx.render.adaptiveState = initialAdaptiveState(performance.now(), ctx.render.adaptiveState.rung);
        ctx.boot.handle.setLoopRunning(true);
      }
    },
    /** Record (or replay) a scenario as a stream of frame hashes. The driver:
     *
     *    __sdfGame.setDemoHold(true);
     *    __sdfGame.setLightClockFrozen(true);
     *    __sdfGame.step(90);                       // settle transients
     *    const rec = await __sdfGame.demoScenario({ kind: 'firefight', room: 4, frames: 120, every: 4 });
     *
     *  Preconditions are the CALLER's, deliberately: settling and freezing are
     *  the same recipe every capture script in this repo already uses, and
     *  hiding it here would make a recording that looks reproducible while its
     *  pre-roll differed. See scripts/sdf-demo-hash.mjs.
     *
     *  The scenario is DATA (game-bench-scenario.ts) and actions are applied
     *  through the SAME handler the perf bench drives, so a replay runs the
     *  scenario the bench measured rather than a lookalike. Frames are stepped
     *  one at a time and the render lock is OFF, because scenario actions
     *  mutate and a locked tick would silently swallow them.
     *
     *  Returns per-frame hashes with the scenario's own metadata, so a stored
     *  recording says which scenario, which room and how many frames produced
     *  it — a hash without those is not evidence of anything. */
    demoScenario: async (o: {
      kind?: 'firefight' | 'closeup';
      room?: number;
      /** Total frames to drive. Defaults to the scenario's own length. */
      frames?: number;
      /** Hash every Nth frame. 1 hashes all of them (slow: each hash is a
       *  ~1M-float readback). Default 4. */
      every?: number;
      /** Closeup frames, when kind === 'closeup'. */
      closeupFrames?: number;
      walkFrames?: number; fireFrames?: number; gibFrames?: number;
      /** Freeze the gather + animation clocks for the run. Default true:
       *  a recording whose frameSeed drifts cannot replay. */
      hold?: boolean;
      /** Hash the final frame position this many EXTRA times (each after its
       *  own step) to measure per-frame randomness with the boot state fixed.
       *  Default 0. See the `repeated` field of the result. */
      repeat?: number;
      /** Re-hash the SAME frame position this many times with NO step in
       *  between. The decisive control: if these differ, the nondeterminism is
       *  in the READBACK or in unwritten texels of the target — not in anything
       *  the scene did between frames. Default 0. */
      resample?: number;
      /** Run with the SIMULATION LIVE (scenario actions really apply) instead
       *  of the RENDER LOCK. Default FALSE, and that default is the point:
       *
       *  Locked (default) records pure re-renders of one settled instant, which
       *  tests what this tool exists to test — that the renderer is a
       *  deterministic function of its inputs — with no dependence on sim
       *  determinism at all. That is the mode the black-silhouette bug and a
       *  mistranscribed gather kernel both show up in.
       *
       *  `sim: true` steps a live simulation, which additionally requires every
       *  sim input to be reproducible. It is NOT yet: two runs of one spec
       *  diverge at frame 0 on this branch (measured 2026-09-10, the first
       *  honest run of this seam — the march target's extents and the dynamic
       *  layer's per-probe values differ while their activity counts match, i.e.
       *  the SAME game in a slightly different state). Use it to hunt that bug,
       *  not to gate a change. */
      sim?: boolean;
    } = {}) => {
      const scenario: Scenario = o.kind === 'closeup'
        ? buildCloseup({ frames: o.closeupFrames })
        : buildFirefight({
          room: o.room ?? 4,
          walkFrames: o.walkFrames,
          fireFrames: o.fireFrames,
          gibFrames: o.gibFrames,
        });
      const problems = validateScenario(scenario);
      if (problems.length) throw new Error(`bad scenario: ${problems.join('; ')}`);
      const total = o.frames ?? scenario.frames;
      const every = Math.max(1, Math.floor(o.every ?? 4));
      if (o.hold !== false) ctx.demo.hold = true;

      // GATHER CADENCE PHASE — the root cause of a long-standing gate failure.
      //
      // `sdf-demo-hash ab` reported two identical runs diverging at frame 0
      // (instances 240 vs 35, probeDyn tiles 8-11). The gather packs capsules
      // only every `probeGatherRate` ticks, and `lastCapsules` /
      // `capsuleArrays` are ONLY written on a due tick — so what the first
      // recorded frame hashes is a function of the ABSOLUTE tick counter, which
      // boot and warm-up leave at an arbitrary phase. One run packed the live
      // cast, the next read a stale warm-up leftover. `bench` above already
      // resets this; demoScenario never did.
      //
      // ONLY the phase. `bench` also does `pendingGather = null` and
      // `gather?.reset()`, and doing the same here was MEASURED to be wrong:
      // it made the two runs agree by zeroing the dynamic probe layer
      // (probeDyn nonZero 6316 -> 0) and it never rebuilt — which is precisely
      // the black-silhouette regression frame-hash.ts exists to catch. A gate
      // that passes by destroying the thing it measures is worse than a gate
      // that fails. Resetting the phase alone gives identical runs with the
      // layer still live, so that is all this does.
      ctx.probes.gatherTick = 0;

      // Frames must be driven by hand: the rAF loop would race the recorder
      // and a hidden/visible page would change which frames exist at all.
      ctx.boot.handle.setLoopRunning(false);
      const hadAdaptive = ctx.render.adaptiveEnabled;
      ctx.render.adaptiveEnabled = false;

      // Named `hashes`, NOT `hashFrame`: the latter is the imported digester,
      // and shadowing it inside this scope is a real failure mode.
      // PARITY IS PART OF THE SIGNATURE. The shipped 'bodies' style marches
      // alternate scanlines, so consecutive frames are DIFFERENT BY DESIGN —
      // measured 2026-09-10: the march digest alternates between exactly two
      // values on a locked, unchanging scene. A recording must therefore sample
      // the same field parity every time, or every comparison between two
      // correct frames reports a divergence. `parityOf` is the running field
      // phase, and the recorder asserts the sampled parities agree.
      let stepsTaken = 0;
      const parityOf = (): number => stepsTaken % 2;
      const hashes: import('./frame-hash').FrameHash[] = [];
      const parity: number[] = [];
      const repeated: import('./frame-hash').FrameHash[] = [];
      const repeatedParity: number[] = [];
      const resampled: import('./frame-hash').FrameHash[] = [];
      const started = performance.now();
      const liveSim = o.sim === true;
      const hadLock = ctx.demo.simLocked;
      // LOCK for the recording. tick() then mutates nothing, so each stepped
      // frame is a pure re-render of one settled instant (the same discipline
      // the close-up gates use) and the hash compares RENDERER state rather
      // than sim state.
      if (!liveSim) ctx.demo.simLocked = true;
      try {
        for (let frame = 0; frame < total; frame++) {
          for (const a of actionsAt(scenario, frame)) d.performBenchAction(a);
          // 1/60 is the bench's fixed step and the only dt this format means.
          await d.awaitBakes();
          ctx.boot.handle.step(1 / 60);
          stepsTaken++;
          // The final frame is sampled only when the regular cadence would MISS
          // it: `frame % every === 0 || frame === total - 1` could sample one
          // frame twice with an odd gap between, which flips the field parity
          // mid-recording and makes the whole run incomparable.
          //
          // FIXED 2026-09-18: that final-frame branch was ITSELF introducing the
          // odd gap it warns about. With the shipped spec (frames 96, every 4)
          // the regular samples land on frames 0,4,…,92 — stepsTaken f+1, all
          // odd, parity 1 — and the extra sample at frame 95 lands on stepsTaken
          // 96, parity 0. The gap 92→95 is 3. Every `ab` run therefore died with
          // "the recording sampled BOTH field parities" before comparing
          // anything, so this gate had been reporting nothing at all.
          //
          // Take the final frame only when it agrees with the parity the regular
          // cadence established. Dropping a trailing sample costs one frame of
          // coverage; mixing parities costs the entire recording.
          const wouldMissFinal = frame === total - 1 && (total - 1) % every !== 0;
          const finalKeepsParity = parity.length === 0 || (stepsTaken % 2) === parity[0];
          if (frame % every === 0 || (wouldMissFinal && finalKeepsParity)) {
            await ctx.boot.handle.resolveGpu();
            hashes.push(await hashFrame(ctx.boot.frameHashDeps, frame));
            parity.push(parityOf());
          }
        }
        // READBACK CONTROL: the SAME position, no step, nothing between the
        // hashes. Separates "the frame changed" from "the readback is not a
        // function of the frame".
        for (let i = 0; i < Math.max(0, Math.floor(o.resample ?? 0)); i++) {
          resampled.push(await hashFrame(ctx.boot.frameHashDeps, total));
        }
        // SAME-SESSION CONTROL: hash the SAME frame position again, after a
        // further step. Locked, that step mutates nothing, so this measures
        // per-frame randomness alone, with the boot state held fixed.
        for (let i = 0; i < Math.max(0, Math.floor(o.repeat ?? 0)); i++) {
          // TWO steps, not one: one step returns the SAME frame at the OTHER
          // field parity, which is a different frame by design. Stepping a pair
          // keeps parity fixed, so this control measures frame determinism
          // instead of measuring the interlace.
          await d.awaitBakes();
          ctx.boot.handle.step(2 / 60);
          stepsTaken += 2;
          await ctx.boot.handle.resolveGpu();
          repeated.push(await hashFrame(ctx.boot.frameHashDeps, total));
          repeatedParity.push(parityOf());
        }
      } finally {
        ctx.render.adaptiveEnabled = hadAdaptive;
        ctx.demo.simLocked = hadLock;
        // The loop stays OFF on purpose: a caller that wants live play back
        // says so explicitly, and one that forgets gets a still page rather
        // than a recording that quietly continued while it was being read.
      }
      return {
        scenario: o.kind === 'closeup' ? 'closeup' : `firefight-room${o.room ?? 4}`,
        room: o.room ?? 4,
        frames: total,
        every,
        tilesX: DEFAULT_TILES_X,
        tilesY: DEFAULT_TILES_Y,
        sim: liveSim,
        /** The SAME final frame hashed `repeat` times, each after its own step.
         *  The control that separates "this renderer is nondeterministic" from
         *  "these two boots did not start from the same state": if these agree
         *  within one session, a cross-boot mismatch is a BOOT-STATE difference,
         *  not per-frame randomness. */
        repeated: repeated.map((r) => r.layers),
        resampled: resampled.map((r) => r.layers),
        /** Field parity of each sampled hash. MUST be constant across a
         *  recording: the interlaced field makes alternate frames differ by
         *  design, so a set of mixed parities cannot be compared to anything. */
        parity,
        repeatedParity,
        dispatches: ctx.probes.frame - ctx.demo.seedBase,
        ms: Math.round(performance.now() - started),
        hashes,
      };
    },
  };
}
