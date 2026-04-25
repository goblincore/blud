import type { Vec3, TrailHandle, ParticlePool } from '../game/gibs/particles';

/** Particle kind discriminator for smoke — lets the renderer/updater specialise. */
export type ParticleKind = 'smoke';

// ——— Pure-math helpers (TDD targets) ———————————————

/**
 * Per-frame rise velocity for a single smoke particle.
 * Y-axis rises at constant baseSpeed; lateral X/Z jitter from a caller-supplied
 * random function so tests can lock the random sequence.
 */
export function smokeRiseVelocity(
  _elapsedSec: number,
  baseSpeed: number,
  jitterAmplitude: number,
  randomFn: () => number,
): Vec3 {
  const lateralX = (randomFn() * 2 - 1) * jitterAmplitude;
  const lateralZ = (randomFn() * 2 - 1) * jitterAmplitude;
  return { x: lateralX, y: baseSpeed, z: lateralZ };
}

/**
 * Alpha curve for a smoke particle: 1.0 at t=0, 0.0 at t=totalLifetimeSec.
 * Linear fade.
 */
export function smokeAlphaCurve(elapsedSec: number, totalLifetimeSec: number): number {
  if (elapsedSec <= 0) return 1;
  if (elapsedSec >= totalLifetimeSec) return 0;
  return 1 - (elapsedSec / totalLifetimeSec);
}

// ——— Smoke config ——————————————————————————————————

const SMOKE = {
  riseSpeed: 0.3,         // m/s upward
  jitterAmplitude: 0.1,   // m/s lateral
  particleLifetime: 1.5,  // seconds
  spawnRate: 12,          // particles/sec for column
  gravity: 0,             // smoke ignores gravity
  airdrag: 0.2,           // light drag
  size: 0.12,             // world-space meters
  tile: -1,               // sentinel — caller sets tile or renderer handles
} as const;

// ——— Internal smoke-column state —————————————————

interface SmokeColumnState {
  source: () => Vec3;
  timeSinceEmit: number;
  stopped: boolean;
}

/** Global registry of active smoke columns — ticked each frame. */
const activeColumns: SmokeColumnState[] = [];

/**
 * Start a steady column of smoke rising from the given source position function.
 * The source function is called on every emission tick so the column follows
 * a moving parent (e.g. a stuck flare attached to an enemy).
 *
 * Returns a TrailHandle whose `stop()` halts emission.
 */
export function startSmokeColumn(
  _pool: ParticlePool,
  source: () => Vec3,
): TrailHandle {
  const state: SmokeColumnState = { source, timeSinceEmit: 0, stopped: false };
  activeColumns.push(state);
  return {
    stop: () => { state.stopped = true; },
  };
}

/**
 * Advance all active smoke columns, emitting particles via the pool.
 * Call once per frame, before pool.update().
 */
export function updateSmokeColumns(pool: ParticlePool, dt: number): void {
  const interval = 1 / SMOKE.spawnRate;
  for (let i = activeColumns.length - 1; i >= 0; i--) {
    const col = activeColumns[i]!;
    if (col.stopped) {
      activeColumns.splice(i, 1);
      continue;
    }
    col.timeSinceEmit += dt;
    while (col.timeSinceEmit >= interval) {
      col.timeSinceEmit -= interval;
      const pos = col.source();
      const p = pool.allocate();
      p.pos = { ...pos };
      // Small random offset so particles don't start at the exact same point
      p.pos.x += (Math.random() * 2 - 1) * 0.02;
      p.pos.z += (Math.random() * 2 - 1) * 0.02;
      // Rise velocity with jitter
      p.vel = {
        x: (Math.random() * 2 - 1) * SMOKE.jitterAmplitude,
        y: SMOKE.riseSpeed,
        z: (Math.random() * 2 - 1) * SMOKE.jitterAmplitude,
      };
      p.gravity = SMOKE.gravity;
      p.airdrag = SMOKE.airdrag;
      p.lifetimeSec = SMOKE.particleLifetime * (0.9 + Math.random() * 0.2); // 1.35–1.65s
      p.size = SMOKE.size * (0.8 + Math.random() * 0.6); // 0.096–0.168 m
      p.tile = SMOKE.tile;
    }
  }
}

/**
 * Remove all smoke columns (e.g. on arena reset).
 */
export function resetSmokeColumns(): void {
  activeColumns.length = 0;
}

/**
 * Spawn a single burst of smoke particles immediately at the given position.
 */
export function emitSmokeBurst(
  pool: ParticlePool,
  pos: Vec3,
  count: number = 8,
): void {
  for (let i = 0; i < count; i++) {
    const p = pool.allocate();
    p.pos = { ...pos };
    // Burst particles get a randomized outward velocity + rise
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 1.0; // 0.5–1.5 m/s outward
    p.vel = {
      x: Math.cos(angle) * speed,
      y: SMOKE.riseSpeed * (0.5 + Math.random()), // 0.15–0.45 m/s upward
      z: Math.sin(angle) * speed,
    };
    p.gravity = SMOKE.gravity;
    p.airdrag = SMOKE.airdrag;
    p.lifetimeSec = SMOKE.particleLifetime * (0.8 + Math.random() * 0.4); // 1.2–1.8s
    p.size = SMOKE.size * (0.8 + Math.random() * 0.6); // 0.096–0.168 m
    p.tile = SMOKE.tile;
  }
}
