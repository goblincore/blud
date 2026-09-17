// src/lab/sdf-zombie/webgpu/demo-recorder.ts
//
// THE INPUT RECORDER/PLAYER (deterministic demo recordings stage 3, 2026-09-14).
// Plan: docs/superpowers/plans/2026-09-14-deterministic-demo-recorder.md
//
// WHY INPUTS AND NOT STATE. Quake's .dem format records the player's INPUT
// stream (held keys, mouse deltas, fire/reload events) and replays it against a
// deterministically-seeded sim. That is the only recording that stays small
// (~40 bytes/frame instead of megabytes of world state), stays comparable
// across legs (a per-body leg and a crowd leg replay the SAME fight), and keeps
// its meaning when the renderer changes. Stage 1 made the sim a pure function
// of (seed, inputs, fixed dt); this file is the log of the third argument.
//
// WHAT A FRAME HOLDS, and why `look` is redundant with `dx`/`dy`:
//   keys    the HELD key set for the frame about to tick (not edges — the
//           consumer derives edges by comparing to the previous frame, which is
//           how a recorded toggle like slug mode survives a round trip).
//   dx,dy   the accumulated mouse delta for the frame.
//   fire    0 = none, 1 = one barrel, 2 = both.
//   reload  whether a reload started on this frame.
//   look    the ABSOLUTE [yaw, pitch] pose AFTER applying dx/dy.
//
// The last one is the anti-drift device. A replay that integrates a thousand
// mouse deltas accumulates float error and, worse, any single-frame spike in
// the recorded delta becomes a permanent heading offset. Re-pinning the pose to
// the recorded absolute value each frame means a drift cannot compound: at
// worst one frame is a hair off, never the rest of the run. dx/dy are kept as
// well because free-aim mode moves a reticle rather than the camera, and that
// path has no absolute pose to pin.
//
// THIS MODULE IS PURE. No THREE, no DOM, no GPU — the recorder and any node-
// side consumer share exactly one implementation, and the round trip is
// testable in vitest without a browser.
/** Bump when the frame/file shape changes incompatibly. A stored `.dem` from a
 *  different version must be refused, not silently misread. */
export const DEMO_VERSION = 1;

/** One fixed-step frame of player input. See the file header for the fields. */
export interface DemoFrame {
  /** HELD keys for the frame about to tick (codes, e.g. 'KeyW'). */
  keys: string[];
  /** Accumulated mouse delta for the frame. */
  dx: number;
  dy: number;
  /** 0 = no shot, 1 = one barrel, 2 = both. */
  fire: 0 | 1 | 2;
  /** Whether a reload started on this frame. */
  reload: boolean;
  /** Absolute [yaw, pitch] AFTER dx/dy. Re-pinned each replay frame. */
  look: [number, number];
}

/** What the recorder was started with — everything a replay needs to rebuild
 *  the boot state, minus the frames themselves. */
export interface DemoHeader {
  /** The sim seed the recording boots with (`?seed=`, or the boot default). */
  seed: number;
  /** The boot query string (`location.search` without the leading `?`), so a
   *  replay can re-apply the flags that change the scene (crowd, scale). */
  query: string;
  /** The room the recording starts in; the replay teleports here before frame
   *  0 unless `meta.startPose` overrides it. */
  room: number;
  /** The fixed step, seconds. The format means 1/60 unless a future consumer
   *  says otherwise; recorded rather than assumed. */
  dt: number;
  /** ISO timestamp, set by the recorder when omitted. Part of the filename. */
  startedAt?: string;
  /** Free-form, but the replay reads `startPose` and `label` if present.
   *  `startPose` = { x, z, yaw, pitch } is the exact pose frame 0 starts from
   *  (the scripted scenario's computed standoff cannot be re-derived from the
   *  room id alone). */
  meta?: Record<string, unknown>;
}

/** A complete recording. This is the `.dem.json` payload. */
export interface DemoFile {
  version: number;
  seed: number;
  query: string;
  room: number;
  dt: number;
  startedAt: string;
  frames: DemoFrame[];
  meta: Record<string, unknown>;
}

export interface DemoRecorder {
  /** Append the frame the next tick will consume. Copies the frame. */
  push(frame: DemoFrame): void;
  /** Finish and return the file. Pushes after this throw. */
  stop(): DemoFile;
  /** Frames captured so far (the HUD's counter). */
  readonly frames: number;
}

/** Copy a frame so a caller mutating its arrays later cannot rewrite history. */
function copyFrame(f: DemoFrame): DemoFrame {
  return {
    keys: [...f.keys],
    dx: f.dx,
    dy: f.dy,
    fire: f.fire,
    reload: f.reload,
    look: [f.look[0], f.look[1]],
  };
}

/** Start a recording. The header is snapshotted at START, not at stop: the seed
 *  and query must be the ones the run BEGAN under, or a replay boots into a
 *  different world than the recording was captured in. */
export function createDemoRecorder(header: DemoHeader): DemoRecorder {
  const dt = header.dt;
  if (!(dt > 0) || !Number.isFinite(dt)) throw new Error(`demo-recorder: dt must be a positive number, got ${dt}`);
  if (!Number.isFinite(header.seed)) throw new Error(`demo-recorder: seed must be a number, got ${header.seed}`);
  const startedAt = header.startedAt ?? new Date().toISOString();
  const frames: DemoFrame[] = [];
  let stopped = false;
  return {
    push(frame) {
      if (stopped) throw new Error('demo-recorder: push() after stop()');
      frames.push(copyFrame(frame));
    },
    stop() {
      stopped = true;
      return {
        version: DEMO_VERSION,
        seed: header.seed >>> 0,
        query: header.query,
        room: header.room,
        dt,
        startedAt,
        frames: frames.map(copyFrame),
        meta: { ...(header.meta ?? {}) },
      };
    },
    get frames() { return frames.length; },
  };
}

export interface DemoPlayer {
  /** The next frame, or null once the recording is exhausted. Returns a copy:
   *  a consumer that mutates the frame must not corrupt the backing file. */
  next(): DemoFrame | null;
  /** True once every frame has been returned. */
  readonly done: boolean;
  /** Frames returned so far (0 before the first next()). */
  readonly frame: number;
}

/** Play a recording back. Pure cursor; the caller owns stepping the sim. */
export function createDemoPlayer(file: DemoFile): DemoPlayer {
  if (!file || !Array.isArray(file.frames)) {
    throw new Error('demo-player: not a demo file (missing frames[])');
  }
  if (file.version !== DEMO_VERSION) {
    throw new Error(`demo-player: version ${file.version} is not ${DEMO_VERSION} — refuse rather than misread`);
  }
  let i = 0;
  return {
    next() {
      if (i >= file.frames.length) return null;
      return copyFrame(file.frames[i++]!);
    },
    get done() { return i >= file.frames.length; },
    get frame() { return i; },
  };
}
