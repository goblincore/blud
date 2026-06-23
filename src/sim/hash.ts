// src/sim/hash.ts
import type { SimState } from './state';

/**
 * Stable FNV-1a-style 32-bit hash of the serializable sim state. Field order is
 * fixed and array iteration is in index order, so the hash is deterministic
 * across runs/peers. This is the determinism harness's fingerprint; extend it
 * field-for-field as SimState grows in later plans.
 */
export function hashSimState(s: SimState): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
  };

  mix(s.tic);
  mix(s.rng.a);
  for (const b of s.bodies) {
    mix(b.x); mix(b.y); mix(b.z);
    mix(b.vx); mix(b.vy); mix(b.vz);
  }

  const p = s.player;
  mix(p.x); mix(p.y); mix(p.z); mix(p.vy);
  mix(p.yaw); mix(p.pitch); mix(p.grounded ? 1 : 0); mix(p.prevButtons);
  mix(p.hp);

  for (const pr of s.projectiles) {
    mix(pr.x); mix(pr.y); mix(pr.z); mix(pr.vx); mix(pr.vy); mix(pr.vz);
    mix(pr.radius); mix(pr.elastic); mix(pr.fuseMaxTics);
    mix(pr.fuseTics); mix(pr.impactMode ? 1 : 0);
  }

  for (const hd of s.heads) {
    mix(hd.x); mix(hd.y); mix(hd.z); mix(hd.vx); mix(hd.vy); mix(hd.vz);
    mix(hd.radius); mix(hd.elastic); mix(hd.resting ? 1 : 0);
    mix(hd.kickCooldownTics); mix(hd.spawnTic);
  }

  for (const du of s.dudes) {
    mix(du.x); mix(du.y); mix(du.z); mix(du.vx); mix(du.vz);
    mix(du.ang); mix(du.goalAng); mix(du.health); mix(du.ai); mix(du.stateTics);
    mix(du.hasTarget ? 1 : 0); mix(du.targetX); mix(du.targetZ);
    mix(du.dodgeDir); mix(du.fired ? 1 : 0);
  }

  for (const pl of s.pellets) {
    mix(pl.x); mix(pl.y); mix(pl.z); mix(pl.vx); mix(pl.vy); mix(pl.vz);
    mix(pl.damage); mix(pl.dieTic);
  }

  return h >>> 0;
}
