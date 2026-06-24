// src/sim/determinism.test.ts
// Harness covers player + projectile physics + detonation/event determinism. Deterministic explosion-vs-player damage lands with the player-as-target unification.
import { describe, it, expect } from 'vitest';
import { createSimState, type SimState } from './state';
import { stepSim } from './step';
import { hashSimState } from './hash';
import { cloneSimState } from './snapshot';
import { randomInt } from './rng';
import { BTN_JUMP, BTN_SPRINT, type InputCommand } from './types';
import { buildArenaGeometry } from './geometry';
import { spawnProjectile, throwVelocity } from './projectile';
import { spawnHead } from './head';
import { spawnDude } from './dude';
import { fpFromMeters } from './fp';
import { generateFloorplan, bakeSimGeometry, floorplanFingerprint } from './floorplan';

const GEO = buildArenaGeometry();

/** A deterministic recorded input stream exercising the player every tic. */
function recordedInputs(n: number): InputCommand[] {
  const out: InputCommand[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      moveForward: (i % 3) - 1,
      moveStrafe: (i % 5 < 2) ? 1 : -1,
      aimYaw: (i * 37) % 2048,
      aimPitch: ((i * 13) % 400) - 200,
      buttons: (i % 47 === 0 ? BTN_JUMP : 0) | (i % 3 === 0 ? BTN_SPRINT : 0),
    });
  }
  return out;
}

/** Seed a state with a few bodies + draw some rng so the hash is non-trivial. */
function seededState(seed: number): SimState {
  const s = createSimState(seed);
  for (let i = 0; i < 4; i++) {
    s.bodies.push({
      x: i * 100, y: 1000, z: -i * 50,
      vx: randomInt(s.rng, 7) - 3,
      vy: -randomInt(s.rng, 4),
      vz: randomInt(s.rng, 7) - 3,
    });
  }
  // Throw a dynamite projectile mid-air: exercises stepProjectiles, fuse countdown,
  // floor bounce, detonation, and explosion event emission through the recorded stream.
  spawnProjectile(s.projectiles, 0, 3_000_000, 0, throwVelocity(s.player.yaw, 0, 2_500_000), 90, true, 0);
  // a head dropped mid-air so it falls/bounces across the recorded run
  spawnHead(s.heads, 100_000, 2_000_000, -80_000, 30_000, 120_000, -20_000, 0);
  // a cultist near the player so the AI (targeting/chase/fire) runs through the
  // recorded stream — covers dude state in replay/snapshot/divergence.
  spawnDude(s.dudes, fpFromMeters(3), fpFromMeters(3), 0, 0);
  // Park the player within sight+hearing radius so the cultist acquires + chases.
  s.player.x = fpFromMeters(4);
  s.player.z = fpFromMeters(4);
  return s;
}

describe('determinism harness', () => {
  it('two independent states on the same seed + inputs hash-match every tic', () => {
    const inputs = recordedInputs(300);
    const a = seededState(2026);
    const b = seededState(2026);
    expect(hashSimState(a)).toBe(hashSimState(b)); // identical seeding
    for (let t = 0; t < inputs.length; t++) {
      stepSim(a, inputs[t]!, GEO);
      stepSim(b, inputs[t]!, GEO);
      expect(hashSimState(a)).toBe(hashSimState(b)); // identical EVERY tic
    }
  });

  it('recorded-input replay reproduces the exact final hash', () => {
    const inputs = recordedInputs(300);
    const run = (): number => {
      const s = seededState(2026);
      for (const cmd of inputs) stepSim(s, cmd, GEO);
      return hashSimState(s);
    };
    expect(run()).toBe(run());
  });

  it('mid-run snapshot + resume reproduces the same final hash', () => {
    const inputs = recordedInputs(200);
    const live = seededState(7);
    for (let t = 0; t < 100; t++) stepSim(live, inputs[t]!, GEO);
    const snap = cloneSimState(live);              // save at tic 100
    for (let t = 100; t < 200; t++) stepSim(live, inputs[t]!, GEO);
    const liveHash = hashSimState(live);
    for (let t = 100; t < 200; t++) stepSim(snap, inputs[t]!, GEO); // resume from snapshot
    expect(hashSimState(snap)).toBe(liveHash);
  });

  it('a different seed diverges (sanity: the hash actually depends on sim)', () => {
    const inputs = recordedInputs(50);
    const a = seededState(1);
    const b = seededState(2);
    for (const cmd of inputs) { stepSim(a, cmd, GEO); stepSim(b, cmd, GEO); }
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });
});

describe('determinism — generated map', () => {
  it('same seed → identical map fingerprint', () => {
    expect(floorplanFingerprint(generateFloorplan(2026)))
      .toBe(floorplanFingerprint(generateFloorplan(2026)));
  });

  it('stepping is deterministic on a generated map (two states hash-match every tic)', () => {
    const geo = bakeSimGeometry(generateFloorplan(2026));
    const inputs = recordedInputs(200);
    const a = seededState(2026);
    const b = seededState(2026);
    for (let t = 0; t < inputs.length; t++) {
      stepSim(a, inputs[t]!, geo);
      stepSim(b, inputs[t]!, geo);
      expect(hashSimState(a)).toBe(hashSimState(b));
    }
  });
});
