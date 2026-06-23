// src/sim/runner.ts
// Determinism firewall: MUST NOT import 'three', Rapier, or 'src/game/**'.
// Returns plain numbers (PlayerRender, ProjectileRender); main.ts applies them.
import { createSimState, type SimState } from './state';
import { stepSim } from './step';
import { cloneSimState } from './snapshot';
import { buildArenaGeometry } from './geometry';
import { renderPlayer, renderProjectiles, renderHeads, renderDudes,
         type PlayerRender, type ProjectileRender, type HeadRender, type DudeRender } from './render';
import { EMPTY_INPUT, type InputCommand, type SimEvent } from './types';
import { fpFromMeters, metersPerSecToFp } from './fp';
import { TICS_PER_SEC } from './units';
import { spawnProjectile as simSpawnProjectile, throwVelocity } from './projectile';
import { spawnHead as simSpawnHead } from './head';
import { spawnDude as simSpawnDude, recoilDude as simRecoilDude } from './dude';

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

  /** Spawn a shotgun cultist into the sim at (xM,zM) on the floor, facing
   *  `angBlood` (Blood-angle units). Converts meters→fp at the boundary.
   *  Called from main.ts (the cultist spawn hook) — never from sim internals.
   *  Returns the new dude's index so the cosmetic layer can keep it alongside
   *  its `ShotgunCultist` (dudes are append-only + skipped-when-dead, so the
   *  index stays stable for match-by-index `dudeRenders()` rendering). */
  spawnDude(xM: number, zM: number, angBlood: number): number {
    const idx = this.state.dudes.length;
    simSpawnDude(this.state.dudes, fpFromMeters(xM), fpFromMeters(zM), 0, angBlood);
    return idx;
  }

  /** Clear all sim dudes (e.g. on a wave/restart reset that despawns the
   *  cosmetic cultists). Dead dudes are inert (skipped by stepDudes) but kept
   *  index-stable; this drops them entirely so a fresh wave starts clean. */
  clearDudes(): void {
    this.state.dudes.length = 0;
    this.prev.dudes.length = 0;
  }

  /** Interpolated cultist transforms for billboard rendering (alpha from the
   *  accumulator). Match-by-index — a cultist's cosmetic billboard keeps the
   *  index it got at `spawnDude` time. */
  dudeRenders(): DudeRender[] {
    const alpha = this.accumulator / SIM_DT;
    return renderDudes(this.prev.dudes, this.state.dudes, alpha);
  }

  /** Kill a cultist by index — sets its health to 0 so `stepDudes` skips it
   *  (dead dudes don't think/move/fire) and the cosmetic layer plays death via
   *  `DudeRender.health <= 0`. Health-0 (rather than splicing) keeps the index
   *  mapping stable for surviving cultists (match-by-index rendering).
   *  Called from main.ts when a player weapon kills the cosmetic cultist. */
  killDude(index: number): void {
    const d = this.state.dudes[index];
    if (d) d.health = 0;
  }

  /** Force a cultist into the Recoil reaction (→ Dodge next step) — bridges a
   *  non-lethal player-weapon hit on the cosmetic cultist to the sim AI so it
   *  reacts. No-op on a dead/out-of-range dude (delegates to dude.recoilDude). */
  recoilDude(index: number): void {
    const d = this.state.dudes[index];
    if (d) simRecoilDude(d);
  }

  /** The sim-authoritative player hit-point count, for the HUD health display. */
  playerHp(): number {
    return this.state.player.hp;
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
