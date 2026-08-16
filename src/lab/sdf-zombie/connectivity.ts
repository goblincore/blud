// src/lab/sdf-zombie/connectivity.ts
//
// Wound-driven limb detachment: "visually cut => actually cut". After each
// wound lands, every live non-torso limb checks whether any blast/pellet
// wound's carve sphere fully engulfs its attachment neck's cross-section.
// Pure sphere math against the wound list — no field evaluation, deterministic,
// conservative (a nick can never fire).
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import { woundWorldPos, type Wound } from './damage';
import { add, len, normalize, scale, sub } from './vec';

/** Samples along the attachment neck. */
const NECK_SAMPLES = 4;
/** How far past the limb root, toward the torso, the neck extends (m). */
const NECK_LEN = 0.1;

/** Girth at the limb root: radius of the nearest add-prim endpoint. */
function rootGirth(prims: Primitive[], root: Vec3): number {
  let best = Infinity; let girth = 0.05;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const g = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]);
    for (const e of [p.a, p.b]) {
      const d = len(sub(e, root));
      if (d < best) { best = d; girth = g; }
    }
  }
  return girth;
}

/**
 * Limbs whose attachment neck is fully carved through by the wounds.
 * The neck runs from the limb's closest endpoint to the torso centre,
 * NECK_LEN toward the torso. A sample is cut when a single blast/pellet
 * wound sphere covers the whole local cross-section:
 * dist(sample, wound) + girth < wound.radius (the shader's carve depth).
 */
export function cutLimbs(
  body: BuildResult, wounds: Wound[], torsoCentre: Vec3,
): LimbId[] {
  const carves = wounds.filter(w => w.type !== 'burn');
  if (carves.length === 0) return [];
  const out: LimbId[] = [];

  for (const c of body.clusters) {
    if (!c.alive || c.limb === 'torso') continue;
    const prims = body.prims.slice(c.start, c.start + c.count);

    let root: Vec3 | null = null; let bd = Infinity;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      for (const e of [p.a, p.b]) {
        const d = len(sub(e, torsoCentre));
        if (d < bd) { bd = d; root = e; }
      }
    }
    if (!root) continue;

    const girth = rootGirth(prims, root);
    const dir = normalize(sub(torsoCentre, root));

    let cut = false;
    for (let k = 0; k < NECK_SAMPLES && !cut; k++) {
      const sample = add(root, scale(dir, (k / (NECK_SAMPLES - 1)) * NECK_LEN));
      for (const w of carves) {
        const centre = woundWorldPos(body.prims, w);
        if (len(sub(sample, centre)) + girth < w.radius) { cut = true; break; }
      }
    }
    if (cut) out.push(c.limb);
  }
  return out;
}
