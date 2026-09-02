// src/lab/sdf-zombie/entrails.ts
import type { Vec3 } from './types';

/**
 * A hanging length of gut: a verlet chain anchored at a wound.
 *
 * `humanoid-verlet.ts` is NOT reusable here — it is bound to the baked-humanoid
 * manifest (`makeHumanoidVerlet(manifest)`), not a generic chain.
 *
 * Pure and allocation-light: no three.js, no rendering, no RNG. The renderer
 * reads `nodes[].pos` and contributes one goo droplet each (see blood-sim's
 * `kind: 'gut'`); the caller pins node 0 to the wound's emit point every frame.
 */
export const GUT_TUNING = {
  nodes: 10,
  /** Total hanging length, metres. */
  restLength: 0.55,
  gravity: 9.8,
  /** Velocity retained per step. Guts are heavy and wet, not springy. */
  damping: 0.90,
  iterations: 6,
  /** Below this total movement per step a detached chain is considered at
   *  rest and stops being stepped at all. */
  settleEps: 1e-4,
};

export interface GutNode { pos: Vec3; prev: Vec3 }
export interface GutChain {
  nodes: GutNode[];
  /** Segment rest length — restLength / (nodes - 1). */
  seg: number;
  attached: boolean;
  settled: boolean;
}

export function makeGutChain(anchor: Vec3): GutChain {
  const nodes: GutNode[] = [];
  for (let i = 0; i < GUT_TUNING.nodes; i++) {
    // pos: every node at the anchor (the wound is a point). prev: offset
    // upward by index, so the first step's velocity (pos - prev) unspools the
    // chain DOWNWARD. Without this, separating coincident nodes from a
    // degenerate start pushes apart along an arbitrary axis and the chain
    // locks into a permanent accordion fold (span ~1.4 seg). Seeding prev is
    // also the right look: a gut emerges from a wound already unspooling.
    nodes.push({
      pos: [...anchor] as Vec3,
      prev: [anchor[0], anchor[1] + i * GUT_TUNING.restLength / (GUT_TUNING.nodes - 1),
        anchor[2]] as Vec3,
    });
  }
  return {
    nodes,
    seg: GUT_TUNING.restLength / (GUT_TUNING.nodes - 1),
    attached: true,
    settled: false,
  };
}

/** Move node 0 to the wound's current emit point. Call every frame while
 *  attached — this is what makes the rope ride the gait. */
export function pinGutChain(c: GutChain, anchor: Vec3): GutChain {
  if (!c.attached) return c;
  const nodes = c.nodes.slice();
  nodes[0] = { pos: [...anchor] as Vec3, prev: [...nodes[0]!.prev] as Vec3 };
  return { ...c, nodes };
}

/** Release the anchor. Verlet stores velocity as (pos - prev), so simply
 *  clearing `attached` carries the swing through — the chain flies rather
 *  than dropping dead. */
export function detachGutChain(c: GutChain): GutChain {
  return { ...c, attached: false, settled: false };
}

export function stepGutChain(c: GutChain, dt: number): GutChain {
  if (c.settled) return c;
  const t = GUT_TUNING;
  const nodes = c.nodes.map(n => ({ pos: [...n.pos] as Vec3, prev: [...n.prev] as Vec3 }));

  const first = c.attached ? 1 : 0;
  for (let i = first; i < nodes.length; i++) {
    const n = nodes[i]!;
    const vx = (n.pos[0] - n.prev[0]) * t.damping;
    const vy = (n.pos[1] - n.prev[1]) * t.damping;
    const vz = (n.pos[2] - n.prev[2]) * t.damping;
    n.prev = [...n.pos] as Vec3;
    n.pos = [n.pos[0] + vx, n.pos[1] + vy - t.gravity * dt * dt, n.pos[2] + vz];
  }

  for (let k = 0; k < t.iterations; k++) {
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]!, b = nodes[i + 1]!;
      const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1], dz = b.pos[2] - a.pos[2];
      const d = Math.hypot(dx, dy, dz);
      const aFixed = c.attached && i === 0;
      const wa = aFixed ? 0 : 1, wb = 1;
      const sum = wa + wb;
      if (d < 1e-9) {
        // Coincident nodes have no separation direction: `|| 1e-9` on d alone
        // still moves them by dx * corr = 0 * huge = 0, so a chain spawned all
        // at one point (which makeGutChain does) would stay a point mass
        // forever. Unfold along a deterministic per-segment direction —
        // golden-angle scatter with a downward bias, so a clump opens into a
        // heap even lying on the floor, where pure -y is blocked. Pure: a
        // function of the segment index, no RNG.
        const ang = i * 2.399963;
        const ux = Math.sin(ang) * 0.906, uy = -0.423, uz = Math.cos(ang) * 0.906;
        if (!aFixed) {
          a.pos = [a.pos[0] - ux * c.seg * (wa / sum), a.pos[1] - uy * c.seg * (wa / sum),
            a.pos[2] - uz * c.seg * (wa / sum)];
        }
        b.pos = [b.pos[0] + ux * c.seg * (wb / sum), b.pos[1] + uy * c.seg * (wb / sum),
          b.pos[2] + uz * c.seg * (wb / sum)];
        continue;
      }
      const corr = (d - c.seg) / d * 0.5;
      if (!aFixed) {
        a.pos = [a.pos[0] + dx * corr * (wa / sum) * 2, a.pos[1] + dy * corr * (wa / sum) * 2,
          a.pos[2] + dz * corr * (wa / sum) * 2];
      }
      b.pos = [b.pos[0] - dx * corr * (wb / sum) * (aFixed ? 2 : 2),
        b.pos[1] - dy * corr * (wb / sum) * (aFixed ? 2 : 2),
        b.pos[2] - dz * corr * (wb / sum) * (aFixed ? 2 : 2)];
    }
    // Floor, inside the constraint loop so a resting chain does not jitter.
    for (const n of nodes) if (n.pos[1] < 0) n.pos = [n.pos[0], 0, n.pos[2]];
  }

  // Settle metric: the ACTUAL displacement this step produced, measured after
  // the constraint + floor passes against where the nodes entered the step.
  // The old metric summed the carried velocity (pos - prev) during
  // integration, which misses both gravity and the clamps — so a chain torn
  // from rest (zero carried velocity, the game's every death) read as moved
  // ~0 on its first free step and froze mid-air, while a chain at rest on the
  // floor could never read settled because gravity kept INTENDING motion the
  // clamp was cancelling. Actual displacement gets both right.
  let moved = 0;
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i]!.pos, q = c.nodes[i]!.pos;
    moved += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }
  const settled = !c.attached && moved < t.settleEps;
  return { ...c, nodes, settled };
}
