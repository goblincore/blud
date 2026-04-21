export interface SchedulerOptions {
  stepSec: number;
  maxStepsPerTick: number;
}

export interface Scheduler {
  tick(realDtSec: number, step: (stepDtSec: number) => void): number;
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  let accumulator = 0;
  return {
    tick(realDtSec, step) {
      accumulator += realDtSec;
      let fired = 0;
      while (accumulator >= opts.stepSec && fired < opts.maxStepsPerTick) {
        step(opts.stepSec);
        accumulator -= opts.stepSec;
        fired++;
      }
      if (fired >= opts.maxStepsPerTick) {
        accumulator = 0;
      }
      return fired;
    },
  };
}
