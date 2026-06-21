// src/sim/runner.ts
// Determinism firewall: MUST NOT import 'three', Rapier, or 'src/game/**'.
// Returns plain numbers (PlayerRender); main.ts applies them to the camera.
import { createSimState, type SimState } from './state';
import { stepSim } from './step';
import { cloneSimState } from './snapshot';
import { buildArenaGeometry } from './geometry';
import { renderPlayer, type PlayerRender } from './render';
import { EMPTY_INPUT, type InputCommand } from './types';
import { fpFromMeters } from './fp';
import { TICS_PER_SEC } from './units';

const SIM_DT = 1 / TICS_PER_SEC; // ~8.33 ms

export class SimRunner {
  private state: SimState;
  private prev: SimState;
  private geo = buildArenaGeometry();
  private accumulator = 0;

  constructor(seed: number, spawnXMeters: number, spawnZMeters: number) {
    this.state = createSimState(seed);
    this.state.player.x = fpFromMeters(spawnXMeters);
    this.state.player.z = fpFromMeters(spawnZMeters);
    this.prev = cloneSimState(this.state);
  }

  /** Reset the runner — teleports the player to a new spawn and clears state. */
  reset(spawnXMeters: number, spawnZMeters: number): void {
    this.state = createSimState(0xb1d);
    this.state.player.x = fpFromMeters(spawnXMeters);
    this.state.player.z = fpFromMeters(spawnZMeters);
    this.prev = cloneSimState(this.state);
    this.accumulator = 0;
  }

  /**
   * Advance by real elapsed seconds, stepping the sim in fixed 120 Hz ticks.
   * `nextInput()` is called once per tic to get that tic's command.
   */
  advance(realDt: number, nextInput: () => InputCommand): void {
    this.accumulator += realDt;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 5) {
      this.prev = cloneSimState(this.state);
      stepSim(this.state, nextInput(), this.geo);
      this.accumulator -= SIM_DT;
      steps++;
    }
    // Spiral-of-death guard: if we fell more than 5 tics behind, drop the lag.
    if (steps >= 5) this.accumulator = 0;
  }

  /** Interpolated player transform for the camera (alpha from the accumulator). */
  playerRender(): PlayerRender {
    const alpha = this.accumulator / SIM_DT;
    return renderPlayer(this.prev.player, this.state.player, alpha);
  }
}
