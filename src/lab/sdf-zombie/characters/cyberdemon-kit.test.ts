// src/lab/sdf-zombie/characters/cyberdemon-kit.test.ts
//
// Does the machinery fit the flesh, and is the asymmetry real?
//
// This is the check a mesh pipeline cannot cheaply have and an SDF one gets
// almost free: "is this point inside the body" is `sdBody(p) < 0`. The kit and
// the body are authored in two different languages with NO enforced
// relationship — cyberdemon-kit.wam transcribes cyberdemon.blob's skeleton by
// hand, into height fractions with every `down` bone's pitch negated, and
// every ring was sized against flesh that lives in the other file. Nothing
// else notices when the .blob moves.
//
// THIS READS THE COMPILED MESH, not the .wam text: vertices have nowhere to
// hide, and the first build proved it — a `bones=a..b` chain loft silently
// IGNORES `offset=` (mesh.py applies it only on the bone= branch), which put
// the power unit 15 cm inside the chest while the .wam said it was on the
// back. No text-level check would have caught that.
import { describe, it, expect } from 'vitest';
import blobSrc from './cyberdemon.blob?raw';
import kitJson from '../../../../public/assets/lab/cyberdemon-kit.gltf?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';

interface Gltf {
  buffers: { uri: string; byteLength: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string }[];
}

const gltf = JSON.parse(kitJson) as Gltf;
const bytes = Uint8Array.from(
  atob(gltf.buffers[0]!.uri.split(',', 2)[1]!), c => c.charCodeAt(0));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const offsetOf = (i: number) => {
  const a = gltf.accessors[i]!;
  const bv = gltf.bufferViews[a.bufferView]!;
  return (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
};

const readVec3 = (i: number): Vec3[] => {
  const a = gltf.accessors[i]!, base = offsetOf(i), out: Vec3[] = [];
  for (let k = 0; k < a.count; k++)
    out.push([
      view.getFloat32(base + k * 12, true),
      view.getFloat32(base + k * 12 + 4, true),
      view.getFloat32(base + k * 12 + 8, true)]);
  return out;
};

const readIndices = (i: number): number[] => {
  const a = gltf.accessors[i]!, base = offsetOf(i), out: number[] = [];
  const size = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
  for (let k = 0; k < a.count; k++)
    out.push(size === 1 ? view.getUint8(base + k)
      : size === 2 ? view.getUint16(base + k * 2, true)
        : view.getUint32(base + k * 4, true));
  return out;
};

function verticesByMaterial(): Map<string, Vec3[]> {
  const out = new Map<string, Vec3[]>();
  for (const prim of gltf.meshes[0]!.primitives) {
    const pos = readVec3(prim.attributes['POSITION']!);
    const name = gltf.materials[prim.material]!.name;
    const seen = new Set(readIndices(prim.indices));
    out.set(name, [...seen].map(i => pos[i]!));
  }
  return out;
}

describe('cyberdemon-kit.gltf fits cyberdemon.blob', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc), compileFace(parseBlob(blobSrc))));
  const groups = verticesByMaterial();
  const all = [...groups.values()].flat();

  it('decodes the compiled kit', () => {
    // Named explicitly so a material vanishing from the .wam is a failure
    // rather than a silently smaller test.
    expect([...groups.keys()].sort()).toEqual(['brass', 'gun', 'steel']);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThanOrEqual(8);
  });

  // THE ASYMMETRY IS THE CHARACTER, and the kit is where it lives: the entire
  // machine is on the LEFT (+x is the character's left, WAM SPEC.md), and the
  // only hard part on the right is the small cable port the loom passes
  // through. If a mirror block ever creeps in, this fails immediately.
  it('is a left-side machine with one small fitting on the right', () => {
    const xs = all.map(v => v[0]);
    expect(Math.max(...xs)).toBeGreaterThan(0.45);   // the ram/cowl reach
    // The right extent is the port's own half-width, nothing more.
    expect(Math.min(...xs)).toBeGreaterThan(-0.20);
  });

  // NO PLATE MAY PASS CLEAN THROUGH THE BODY. The tolerance is not slack, it
  // is the shape of the problem: the shoulder cowl's inner rim is FORCED into
  // the chest. The deltoid is 0.23 m across centred 0.25 m from the body
  // axis, so any shell that encloses it reaches past the chest wall — the
  // goblin's pauldron tuck, deeper because this character is broader. Every
  // value this bound rejected in practice was geometry in the wrong place
  // (the power unit, 0.158 m in), never a tuck.
  const TUCK_MAX = 0.060;

  it.each([...groups.keys()])('no %s vertex passes through the body', name => {
    const vs = groups.get(name)!;
    let worst = Infinity, at: Vec3 = vs[0]!;
    for (const v of vs) {
      const d = sdBody(v, body);
      if (d < worst) { worst = d; at = v; }
    }
    expect(worst, `${name} deepest vertex at (${at.map(n => n.toFixed(3)).join(', ')})`)
      .toBeGreaterThan(-TUCK_MAX);
  });

  // COVERAGE, which containment cannot see: the cowl must CROWN the deltoid
  // rather than let flesh punch through it (the owner-reported goblin bug,
  // where nothing was inside anything and the orb simply stuck out the top).
  it('crowns the left deltoid instead of letting it punch through', () => {
    const arm = body.clusters.find(c => c.limb === 'armL')!;
    const orb = body.prims.slice(arm.start, arm.start + arm.count)
      .reduce((best, p) => (p.radius > best.radius ? p : best));
    const crown = orb.a[1] + orb.radius * Math.min(...orb.scale);
    const kitTop = Math.max(...all.map(v => v[1]));
    expect(kitTop).toBeGreaterThan(crown);
  });

  // The boot is the ground contact on the sheathed side: its sole must sit on
  // y=0, not float and not sink. A kit whose lowest geometry is above the
  // floor leaves the character standing on air when the flesh foot is inside
  // the shell.
  it('stands the boot sole on the ground', () => {
    const lowest = Math.min(...all.map(v => v[1]));
    expect(lowest).toBeGreaterThan(-0.02);
    expect(lowest).toBeLessThan(0.02);
  });

  // The ram is a REPLACEMENT limb, so it has to reach past where the flesh
  // hand would have been — otherwise the "arm" reads as a sleeve with a stub.
  it('runs the ram past the hand bone it rides', () => {
    const hand = body.bones.get('hand.l')!.tail;
    const ram = groups.get('gun')!;
    const lowest = Math.min(...ram.map(v => v[1]));
    expect(lowest).toBeLessThan(hand[1] - 0.15);
  });
});
