// src/sim/runner.ts
// Determinism firewall: MUST NOT import 'three', Rapier, or 'src/game/**'.
// Returns plain numbers (PlayerRender, ProjectileRender); main.ts applies them.
import { createSimState, type SimState } from './state';
import { stepSim } from './step';
import { cloneSimState } from './snapshot';
import { buildArenaGeometry } from './geometry';
import { renderPlayer, renderProjectiles, renderHeads,
         type PlayerRender, type ProjectileRender, type HeadRender } from './render';
import { EMPTY_INPUT, type InputCommand, type SimEvent } from './types';
import { fpFromMeters, metersPerSecToFp } from './fp';
import { TICS_PER_SEC } from './units';
import { spawnProjectile as simSpawnProjectile, throwVelocity } from './projectile';
import { spawnHead as simSpawnHead } from './head';

const SIM_DT = 1 / TICS_PER_SEC; // ~8.33 ms

export class SimRunner {
  private state: SimState;
  private prev: SimState;
  private geo = buildArenaGeometry();
  private accumulator = 0;
  private events: SimEvent[] = [];

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
    this.events = [];
  }

  /**
   * Advance by real elapsed seconds, stepping the sim in fixed 120 Hz ticks.
   * `nextInput()` is called once per tic to get that tic's command.
   * Explosion events from each tic are accumulated; drain with drainEvents().
   */
  advance(realDt: number, nextInput: () => InputCommand): void {
    this.accumulator += realDt;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 5) {
      this.prev = cloneSimState(this.state);
      this.events.push(...stepSim(this.state, nextInput(), this.geo));
      this.accumulator -= SIM_DT;
      steps++;
    }
    // Spiral-of-death guard: if we fell more than 5 tics behind, drop the lag.
    if (steps >= 5) this.accumulator = 0;
  }

  /**
   * Spawn a dynamite projectile into the sim. Converts meters→fp at the boundary.
   * Called from main.ts (via the dynamite throw hook) — never from sim internals.
   */
  spawnProjectile(
    xM: number, yM: number, zM: number,
    yaw: number, pitch: number,
    speedMps: number, fuseTics: number, impact: boolean,
  ): void {
    simSpawnProjectile(
      this.state.projectiles,
      fpFromMeters(xM), fpFromMeters(yM), fpFromMeters(zM),
      throwVelocity(yaw, pitch, metersPerSecToFp(speedMps)),
      fuseTics, impact, this.state.tic,
    );
  }

  /** Interpolated projectile transforms for billboard rendering (alpha from accumulator). */
  projectileRenders(): ProjectileRender[] {
    const alpha = this.accumulator / SIM_DT;
    return renderProjectiles(this.prev.projectiles, this.state.projectiles, alpha);
  }

  /** Spawn a kickable head into the sim. Converts meters→fp and m/s→fp/tic at the
   *  boundary. Called from main.ts (via the head-pop hook) — never from sim internals. */
  spawnHead(
    xM: number, yM: number, zM: number,
    vxMps: number, vyMps: number, vzMps: number,
  ): void {
    simSpawnHead(
      this.state.heads,
      fpFromMeters(xM), fpFromMeters(yM), fpFromMeters(zM),
      metersPerSecToFp(vxMps), metersPerSecToFp(vyMps), metersPerSecToFp(vzMps),
      this.state.tic,
    );
  }

  /** Interpolated head transforms for billboard rendering (alpha from the accumulator). */
  headRenders(): HeadRender[] {
    const alpha = this.accumulator / SIM_DT;
    return renderHeads(this.prev.heads, this.state.heads, alpha);
  }

  /** Drain and return all sim events accumulated since the last call. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Interpolated player transform for the camera (alpha from the accumulator). */
  playerRender(): PlayerRender {
    const alpha = this.accumulator / SIM_DT;
    return renderPlayer(this.prev.player, this.state.player, alpha);
  }
}
