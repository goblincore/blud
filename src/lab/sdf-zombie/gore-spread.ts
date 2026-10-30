// src/lab/sdf-zombie/gore-spread.ts
//
// GORE SPREAD: the queue that moves a gun hit's gore one tick past the hit frame, a few jobs a tick (gore spread
// pass, 2026-10-29). Pure: no renderer.
//
// A double-barrel volley that lands on a body did all of its gore in the frame it hit: every pellet's bleed
// registration and impact gout (game-bleed.ts registerBleed: ~14 droplets a pellet, 85 a slug), its torn flesh
// (throwGunFlesh), and so the first sim step, goo sync, shutter seed and draw of all those new droplets — on top of
// the hit maths (trace, wound probes, wound flush) the same frame already pays. This module is the queue that moves
// the gore half one frame on: the hit frame stamps the wounds (they show that frame) and queues the gore; the next
// tick spawns it, at most `budget` jobs a tick, so a big volley's gouts land over two or three frames instead of one.
// The job runs against the body as it is THEN (the per-frame wound emitters do the same every frame), so the blood
// leaves the wound where the wound is drawn.
//
// `?gorespread=0` restores the old paths (gore in the hit frame, no boot gore warm, one warmed tracer view).

let goreSpread = true;
/** `?gorespread=0` restores the old gore paths (see the header). */
export function goreSpreadOn(search: string): boolean {
  return new URLSearchParams(search).get('gorespread') !== '0';
}
export function setGoreSpread(on: boolean): void { goreSpread = on; }
export function goreSpreadEnabled(): boolean { return goreSpread; }

/** Gore jobs run a tick, at most. A double-barrel volley lands up to 20 pellets: two or three ticks. */
export const GORE_SPREAD_BUDGET = 8;

export interface GoreQueue<T> {
  /** Queue a job made on sim frame `frame`. */
  push(frame: number, job: T): void;
  /** Run, oldest first, up to `budget` jobs queued BEFORE `frame` (a job never runs in the tick that queued it).
   *  Returns how many ran. A job is taken off the queue before it runs, so one that throws is dropped (it never
   *  blocks the queue); the error propagates. */
  drain(frame: number, budget: number, run: (job: T) => void): number;
  /** Jobs waiting. */
  readonly size: number;
  /** Drop every waiting job (a level change, a respawn). */
  clear(): void;
}

export function createGoreQueue<T>(): GoreQueue<T> {
  const frames: number[] = [];
  const jobs: T[] = [];
  return {
    push(frame, job) { frames.push(frame); jobs.push(job); },
    drain(frame, budget, run) {
      let n = 0;
      while (n < budget && jobs.length > 0 && frames[0]! < frame) {
        frames.shift();
        const job = jobs.shift()!;
        n++;
        run(job);
      }
      return n;
    },
    get size() { return jobs.length; },
    clear() { frames.length = 0; jobs.length = 0; },
  };
}

/** A small deterministic stream for the boot gore warm (mulberry32): the warm must never draw from the shared
 *  rngStreams, which the gore and the captures depend on. */
export function warmRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
