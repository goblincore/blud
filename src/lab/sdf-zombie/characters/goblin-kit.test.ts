// src/lab/sdf-zombie/characters/goblin-kit.test.ts
//
// Does the armour fit the goblin?
//
// This is the check a mesh pipeline cannot cheaply have and an SDF one gets
// almost free. WAM spends ~955 lines of triangle raycasting on `noclip`
// because a mesh has no interior and containment has to be built by
// parity-counting ray crossings. Here "where is the flesh" is one march of
// `sdBody`, so a kit authored in one language can be checked against a body
// authored in another, in a unit test, with no renderer and no GPU.
//
// It matters because the two files have NO enforced relationship. goblin-kit.wam
// transcribes goblin.blob's skeleton by hand — into height fractions instead of
// metres, with the pitch sign flipped on every `down` bone — and the plate's
// ring widths were measured against flesh that lives entirely in the other
// file. Nothing else notices when the .blob moves. The arm-clearance work
// already narrowed every torso ring once; had the kit existed then, the belt
// would have ended up floating a centimetre off a body that had shrunk away
// from underneath it, and the only symptom would have been a render nobody
// happened to look at from the right angle.
//
// WHAT IT DOES NOT CHECK: the mesh itself. This compares AUTHORED ring
// dimensions in the .wam text against measured flesh at the same place, which
// is where fit is decided, but the compiled glTF's vertices are not read. A
// cap, a `follow=` hem, or an `on=`-snapped attachment can still land somewhere
// this does not look. The kilt is skipped outright — it hangs off a free ray
// rather than a bone chain, so there is no flesh cross-section to compare with.
import { describe, it, expect } from 'vitest';
import blobSrc from './goblin.blob?raw';
import wamSrc from './goblin-kit.wam?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';

/**
 * WAM bone name → the .blob bone it transcribes, plus which limb cluster owns
 * that flesh. `hips` is the one rename: WAM's root is a bare POINT while
 * .blob's `root pelvis` is a bone WITH a length, so the kit has to reinstate
 * that segment as an ordinary bone under a different name (see the .wam
 * header). Everything else is the same name on both sides.
 */
const BONES: Record<string, { blob: string; limb: string }> = {
  hips: { blob: 'pelvis', limb: 'torso' },
  upperarm: { blob: 'upperarm.l', limb: 'armL' },
  forearm: { blob: 'forearm.l', limb: 'armL' },
  shin: { blob: 'shin.l', limb: 'legL' },
};

interface Ring { part: string; bone: string; t: number; w: number; d: number }

/** Pulls `loft <name> bones=<a>..<a>` blocks and their rings out of the .wam. */
function ringsOf(src: string): Ring[] {
  const out: Ring[] = [];
  let part = '', bone = '';
  for (const raw of src.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const loft = /^loft\s+(\S+)\s+bones=(\S+)\.\.\S+/.exec(line);
    if (loft) { part = loft[1]!; bone = loft[2]!; continue; }
    // A `loft ... bone=` (free ray) or any other part ends the current block:
    // its rings are not measurable against a bone cross-section.
    if (/^(loft|sweep|web|attach|group)\b/.test(line)) { part = ''; bone = ''; continue; }
    const ring = /^ring\s+([\d.]+)\s+w=([\d.]+)(?:\s+d=([\d.]+))?/.exec(line);
    if (ring && bone) {
      const w = Number(ring[2]);
      out.push({ part, bone, t: Number(ring[1]), w, d: ring[3] === undefined ? w : Number(ring[3]) });
    }
  }
  return out;
}

describe('goblin-kit.wam fits goblin.blob', () => {
  const doc = parseBlob(blobSrc);
  const H = doc.height!;
  const body = buildBody(compileBlob(doc));

  /** March outward from `o` along `dir` until the field turns positive. */
  const surface = (o: Vec3, dir: Vec3, field: unknown): number => {
    let t = 0;
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
      const d = sdBody(p, field as never);
      if (d < 1e-4) { t += 0.001; continue; }
      if (d > 5e-4 && i > 0) return t;
      t += Math.max(d, 8e-4);
    }
    return t;
  };

  /**
   * Flesh half-extents at `t` along a bone, in HEIGHT FRACTIONS and as FULL
   * width/depth, to match how WAM states a ring.
   *
   * Restricted to the limb's own cluster. Marching the whole body measures
   * whatever the ray reaches next, which is not the limb: an upper-arm ray
   * outward struck the torso behind it and read d=0.141 for a limb 0.049
   * across, and a thigh ray reached the far leg.
   */
  const fleshAt = (boneName: string, limb: string, t: number) => {
    const c = body.clusters.find(x => x.limb === limb)!;
    const prims = body.prims.slice(c.start, c.start + c.count);
    const field = { prims, clusters: [{ ...c, start: 0, count: prims.length }] };
    const bone = body.bones.get(boneName)!;
    const ax: Vec3 = [
      bone.tail[0] - bone.head[0], bone.tail[1] - bone.head[1], bone.tail[2] - bone.head[2]];
    const L = Math.hypot(...ax);
    const u: Vec3 = [ax[0] / L, ax[1] / L, ax[2] / L];
    // Side axis = up × along, falling back to world +X when the bone is close
    // to vertical and that cross product is unstable.
    const cx: Vec3 = [u[2], 0, -u[0]];
    const cl = Math.hypot(...cx);
    const side: Vec3 = cl > 0.2 ? [cx[0] / cl, cx[1] / cl, cx[2] / cl] : [1, 0, 0];
    const dep: Vec3 = [
      u[1] * side[2] - u[2] * side[1],
      u[2] * side[0] - u[0] * side[2],
      u[0] * side[1] - u[1] * side[0]];
    const o: Vec3 = [bone.head[0] + ax[0] * t, bone.head[1] + ax[1] * t, bone.head[2] + ax[2] * t];
    const span = (v: Vec3) =>
      (surface(o, v, field) + surface(o, [-v[0], -v[1], -v[2]], field)) / H;
    return { w: span(side), d: span(dep) };
  };

  const rings = ringsOf(wamSrc);

  // Guards the regex. A pattern that silently matches nothing turns every
  // it.each below into zero tests, which reports as a pass.
  it('finds the kit\'s bone-chain rings', () => {
    expect(rings.length).toBeGreaterThan(5);
    expect(new Set(rings.map(r => r.part))).toEqual(
      new Set(['pauldron', 'bracer', 'greave', 'belt']));
  });

  it('names only bones that exist in goblin.blob', () => {
    for (const r of rings) {
      expect(BONES[r.bone], `kit bone "${r.bone}" is unmapped`).toBeDefined();
      expect(body.bones.has(BONES[r.bone]!.blob)).toBe(true);
    }
  });

  // THE ACTUAL CHECK. Plate inside flesh is the failure that renders hide —
  // it looks fine from every angle where the flesh happens to be behind it.
  it.each(rings.map(r => [`${r.part} ring ${r.t}`, r] as const))(
    '%s stands proud of the flesh under it', (_label, r) => {
      const m = BONES[r.bone]!;
      const flesh = fleshAt(m.blob, m.limb, r.t);
      // 0.002 of model height is 2.6 mm on this goblin — enough that a ring
      // cannot be merely coincident, and loose enough not to fail on the
      // marcher's own step size.
      expect(r.w, `${r.part} w`).toBeGreaterThan(flesh.w + 0.002);
      expect(r.d, `${r.part} d`).toBeGreaterThan(flesh.d + 0.002);
    });
});
