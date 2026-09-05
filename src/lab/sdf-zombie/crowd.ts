// src/lab/sdf-zombie/crowd.ts
//
// Ground-plane crowd separation: the reason zombies stop standing inside one
// another. Every body is a circle on the floor (they are upright and the floor
// is flat, so the vertical axis carries no information here), and overlapping
// pairs are relaxed apart a fraction at a time.
//
// SOFT ON PURPOSE. One call removes `stiffness` of each pair's overlap per
// iteration, not all of it — after CROWD_TUNING's two iterations a quarter of
// the overlap survives the frame. A hard non-overlap constraint makes a pack
// pressed into a corner shudder and deadlock; running a soft one every frame
// converges within a few frames and jostles instead. Shallow, brief overlap
// during a shove is the accepted cost (spec, 2026-09-04).
//
// Pure: no RNG, no clock, no THREE. The caller owns the positions; this only
// says how far each agent should move.

/** One body on the floor. `mobile: false` = an anchor (the player): it takes
 *  none of its share of a correction, so its partner takes all of it. */
export interface CrowdAgent {
  x: number;
  z: number;
  r: number;
  mobile: boolean;
}

export const CROWD_TUNING = {
  /** Relaxation passes per call. */
  iterations: 2,
  /** Fraction of a pair's CURRENT overlap removed per pass. */
  stiffness: 0.5,
  /** Largest total correction one agent may take from one call (m) — a
   *  pathological pile unwinds over several frames instead of teleporting. */
  maxPush: 0.25,
} as const;

export type CrowdTuning = typeof CROWD_TUNING;

/**
 * Per-agent ground-plane correction, in the same order as `agents`.
 * O(n²) — over the game's ten bodies that is 45 pairs per pass, so a spatial
 * hash would cost more to maintain than it saves.
 */
export function separate(
  agents: readonly CrowdAgent[],
  tuning: CrowdTuning = CROWD_TUNING,
): [number, number][] {
  const n = agents.length;
  const out: [number, number][] = Array.from({ length: n }, () => [0, 0] as [number, number]);
  if (n < 2) return out;

  // Working positions, so pass k+1 sees pass k's corrections (Gauss-Seidel).
  const px = agents.map(a => a.x);
  const pz = agents.map(a => a.z);

  for (let pass = 0; pass < tuning.iterations; pass++) {
    for (let i = 0; i < n; i++) {
      const ai = agents[i]!;
      for (let j = i + 1; j < n; j++) {
        const aj = agents[j]!;
        if (!ai.mobile && !aj.mobile) continue;
        const want = ai.r + aj.r;
        let dx = px[j]! - px[i]!;
        let dz = pz[j]! - pz[i]!;
        let d = Math.hypot(dx, dz);
        if (d >= want) continue;
        let nx: number;
        let nz: number;
        if (d < 1e-6) {
          // Coincident bodies (a stacked spawn, a pile). The escape direction
          // comes from the index pair, NOT an RNG: separation has to be
          // reproducible frame to frame or the pair jitters in place. d is
          // forced to 0, not 1 — the overlap here is the FULL `want`, and
          // normalising against a fake unit distance would hand `want - d` a
          // negative number and pull the pair further together.
          const ang = ((i * 7 + j * 13) % 16) * (Math.PI / 8);
          nx = Math.sin(ang);
          nz = Math.cos(ang);
          d = 0;
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        const move = (want - d) * tuning.stiffness;
        // Both mobile: split the correction. One anchored: the mover takes it all.
        const share = ai.mobile && aj.mobile ? 0.5 : 1;
        if (ai.mobile) {
          px[i] = px[i]! - nx * move * share;
          pz[i] = pz[i]! - nz * move * share;
        }
        if (aj.mobile) {
          px[j] = px[j]! + nx * move * share;
          pz[j] = pz[j]! + nz * move * share;
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    let dx = px[i]! - agents[i]!.x;
    let dz = pz[i]! - agents[i]!.z;
    const d = Math.hypot(dx, dz);
    if (d > tuning.maxPush) {
      dx = (dx / d) * tuning.maxPush;
      dz = (dz / d) * tuning.maxPush;
    }
    out[i] = [dx, dz];
  }
  return out;
}

/** Smallest centre-to-centre distance in the set (Infinity below two agents).
 *  The verification gate's oracle — "did they stop overlapping" is a number,
 *  not an opinion. */
export function minPairDistance(agents: readonly CrowdAgent[]): number {
  let best = Infinity;
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const d = Math.hypot(agents[i]!.x - agents[j]!.x, agents[i]!.z - agents[j]!.z);
      if (d < best) best = d;
    }
  }
  return best;
}
