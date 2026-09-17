// src/lab/sdf-zombie/webgpu/shutter-timeline.ts
//
// DETERMINISTIC, IDENTITY-PRESERVING SHUTTER TIMELINE (selective shutter blur,
// task 1).
//
// The plan's requirement is blunt: a shutter reference must be a valid oracle
// for the RECORDED simulation, so it cannot be built by re-stepping the live
// `BloodSim` while the alternatives render, and it cannot reuse `hist` (path
// samples with no timestamps). Instead the page records this timeline ONCE
// from a scratch sim at a fixed cadence, then answers `particlesAt(t)` for any
// sample time inside the shutter window.
//
// IDENTITY is the key: a droplet's object reference is its identity while it
// lives. A WeakMap assigns a stable integer id on first sight, so a slot
// reused by a NEW droplet (push() after shift(), or the same index after a
// splice) gets a NEW id and can never inherit the dead particle's history.
// `stream` is deliberately NOT identity: one emitter stream contains many
// droplets, which is exactly the confusion the plan warns about.
//
// The recorder never reads wall-clock time and never calls the RNG itself: the
// caller owns the deterministic `step(dt)` (emission + stepBlood) and primes
// the sim at t=0. Recording the same seed twice yields identical frames.
//
// LIMITS (documented, not hidden):
//  - A particle spawned and removed inside one record tick is never observed;
//    it contributes neither a birth nor a contact.
//  - `hist`, `clocks` and other material state outside the sampled fields are
//    not carried. The exposure resolve fills only droplet fields.
//  - Interpolation linear in position and velocity. A contact between ticks is
//    reported at the removal tick's time, not the exact sub-tick instant.

import type { BloodSim, Droplet } from '../blood-sim';

type MutVec3 = [number, number, number];

/** One particle's state in one timestamped snapshot. */
export interface ParticleState {
  id: number;
  kind: Droplet['kind'];
  pos: MutVec3;
  vel: MutVec3;
  size: number;
  age: number;
  life: number;
  /** Ribbon eligibility (material state, preserved for classification). */
  ribbon: boolean;
  /** Emitter stream id, or -1 when untagged. NOT particle identity. */
  stream: number;
  /** True when pos/vel were lerped between two snapshot frames. */
  interpolated: boolean;
}

export interface TimelineSnapshot {
  /** Seconds since the scenario's t=0. */
  t: number;
  particles: ParticleState[];
}

export type ParticleEventKind = 'birth' | 'floor' | 'expiry' | 'evicted';

export interface ParticleEvent {
  id: number;
  t: number;
  kind: ParticleEventKind;
  pos: MutVec3;
}

export interface ShutterTimeline {
  /** Fixed record cadence in seconds. Independent of presentation FPS. */
  dt: number;
  /** First recorded frame time (frames before this are stepped, not stored). */
  keepFrom: number;
  /** Last recorded frame time. */
  toT: number;
  frames: TimelineSnapshot[];
  /** Births and removals observed across the whole recording. */
  events: ParticleEvent[];
  /** Distinct particle identities observed. */
  particleCount: number;
}

export interface RecordTimelineOpts {
  /** Fixed record cadence in seconds; must be > 0. */
  dt: number;
  /** Total simulated seconds to record from t=0. */
  duration: number;
  /**
   * First snapshot time to STORE. Frames before this are still stepped and
   * their identities tracked, so a particle born before the window keeps its
   * id and is not misreported as a window birth.
   */
  keepFrom?: number;
  /** Scratch sim, already primed at t=0. Mutated in place; never the live sim. */
  sim: BloodSim;
  /** Advance one fixed dt (scenario emission + stepBlood). Deterministic. */
  step: (dt: number) => void;
  /** Floor height that classifies a removal as a floor contact. Default 0.02. */
  floorY?: number;
}

/** Float slack so a frame exactly at keepFrom is not dropped. */
const T_EPS = 1e-9;

function copyVec(v: readonly number[]): MutVec3 {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
}

function snapshotDroplet(d: Droplet, id: number, interpolated: boolean): ParticleState {
  return {
    id,
    kind: d.kind,
    pos: copyVec(d.pos),
    vel: copyVec(d.vel),
    size: d.size,
    age: d.age,
    life: d.life,
    ribbon: d.ribbon === true,
    stream: d.stream ?? -1,
    interpolated,
  };
}

/**
 * Record a timeline by stepping `opts.sim` at a fixed cadence. The caller owns
 * priming and the step function; this function owns identity, timestamps,
 * births, removals and contact classification.
 */
export function recordTimeline(opts: RecordTimelineOpts): ShutterTimeline {
  const dt = opts.dt;
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('recordTimeline: dt must be > 0');
  const duration = Number.isFinite(opts.duration) ? Math.max(0, opts.duration) : 0;
  const keepFrom = Number.isFinite(opts.keepFrom) ? Math.max(0, opts.keepFrom!) : 0;
  const floorY = opts.floorY ?? 0.02;

  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const frames: TimelineSnapshot[] = [];
  const events: ParticleEvent[] = [];

  // Identity across the whole recording, independent of what is stored.
  let prev = new Map<number, ParticleState>();

  const observe = (t: number): void => {
    const current = new Map<number, ParticleState>();
    const particles: ParticleState[] = [];
    for (const d of opts.sim.droplets) {
      let id = ids.get(d);
      if (id === undefined) {
        id = nextId++;
        ids.set(d, id);
        events.push({ id, t, kind: 'birth', pos: copyVec(d.pos) });
      }
      const state = snapshotDroplet(d, id, false);
      current.set(id, state);
      particles.push(state);
    }
    // Removals: present last tick, absent now. The last OBSERVED state is one
    // step behind the removal, so a removal is classified against where the
    // particle was heading, not only where it was: a fast fall from y=0.03 at
    // -5 m/s is removed at the floor by stepBlood, and its last snapshot still
    // reads 0.03. Same for expiry — the snapshot's age predates the final step.
    for (const [id, last] of prev) {
      if (current.has(id)) continue;
      const predictedY = last.pos[1] + last.vel[1] * dt;
      const predictedAge = last.age + dt;
      const kind: ParticleEventKind = last.kind === 'gut'
        ? 'evicted'
        : (last.pos[1] <= floorY + 1e-6 || predictedY <= floorY)
          ? 'floor'
          : (last.age + 1e-6 >= last.life || predictedAge + 1e-6 >= last.life)
            ? 'expiry'
            : 'evicted';
      events.push({ id, t, kind, pos: copyVec(last.pos) });
    }
    if (t + T_EPS >= keepFrom) frames.push({ t, particles });
    prev = current;
  };

  observe(0);
  const ticks = Math.max(0, Math.round(duration / dt));
  for (let i = 1; i <= ticks; i++) {
    opts.step(dt);
    observe(i * dt);
  }

  return { dt, keepFrom, toT: ticks * dt, frames, events, particleCount: nextId };
}

/** Index of the last frame whose t <= target, or -1. */
export function frameIndexAt(frames: readonly TimelineSnapshot[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  if (frames.length === 0 || t < frames[0]!.t - T_EPS) return -1;
  if (t >= frames[hi]!.t - T_EPS) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.t <= t + T_EPS) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/**
 * Reconstruct each living particle at an arbitrary time inside the recorded
 * span.
 *
 * A particle must be present in BOTH bracketing frames to appear. That is the
 * conservative choice the plan asks for: a particle that was born (or died)
 * between the two snapshots has no reliable position at `t`, and guessing one
 * is exactly how a new particle generates a long spurious vector. The cost is
 * a partial-tick undercount at births and deaths, documented.
 */
export function particlesAt(timeline: ShutterTimeline, t: number): ParticleState[] {
  const frames = timeline.frames;
  if (frames.length === 0) return [];
  const clamped = Math.max(frames[0]!.t, Math.min(frames[frames.length - 1]!.t, t));
  const i = frameIndexAt(frames, clamped);
  if (i < 0) return [];
  const a = frames[i]!;
  if (i >= frames.length - 1) return a.particles.map(p => ({ ...p, pos: copyVec(p.pos), vel: copyVec(p.vel) }));
  const b = frames[i + 1]!;
  const span = b.t - a.t;
  if (span <= T_EPS) return a.particles.map(p => ({ ...p, pos: copyVec(p.pos), vel: copyVec(p.vel) }));
  const f = Math.max(0, Math.min(1, (clamped - a.t) / span));
  const bById = new Map<number, ParticleState>();
  for (const p of b.particles) bById.set(p.id, p);
  const out: ParticleState[] = [];
  for (const pa of a.particles) {
    const pb = bById.get(pa.id);
    if (!pb) continue; // died between frames: no reliable pose at t
    out.push({
      id: pa.id,
      kind: pa.kind,
      pos: [lerp(pa.pos[0], pb.pos[0], f), lerp(pa.pos[1], pb.pos[1], f), lerp(pa.pos[2], pb.pos[2], f)],
      vel: [lerp(pa.vel[0], pb.vel[0], f), lerp(pa.vel[1], pb.vel[1], f), lerp(pa.vel[2], pb.vel[2], f)],
      size: lerp(pa.size, pb.size, f),
      age: lerp(pa.age, pb.age, f),
      life: pa.life,
      ribbon: pa.ribbon,
      stream: pa.stream,
      interpolated: true,
    });
  }
  return out;
}

export function eventsInRange(timeline: ShutterTimeline, from: number, to: number): ParticleEvent[] {
  return timeline.events.filter(e => e.t >= from - T_EPS && e.t <= to + T_EPS);
}
