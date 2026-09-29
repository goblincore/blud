// src/lab/sdf-zombie/characters/juggernaut-kit.test.ts
//
// Does the power armour fit the juggernaut? soldier-kit.test.ts's argument
// verbatim: the .wam transcribes the .blob's skeleton by hand and sizes every
// ring against flesh in the other file, so the COMPILED mesh is checked
// against sdBody here, no GPU.
//
// SKIPS UNTIL THE KIT IS BUILT. WAM lives outside the repo; the glTF comes
// from `scripts/build-wam-kit.sh juggernaut`. It is looked up through
// import.meta.glob (an empty match when missing) rather than a `?raw` import,
// which would fail the whole suite's transform before the kit exists.
import { describe, it, expect } from 'vitest';
import blobSrc from './juggernaut.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { boneFrames } from '../rig-frames';
import { bindRig } from '../rig-bind';
import type { Vec3 } from '../types';

const KIT = Object.values(import.meta.glob('../../../../public/assets/lab/juggernaut-kit.gltf', {
  query: '?raw', import: 'default', eager: true,
}))[0] as string | undefined;

interface Gltf {
  buffers: { uri: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string }[];
  nodes: { name?: string; translation?: number[]; children?: number[] }[];
}

describe('juggernaut-kit.gltf fits juggernaut.blob', () => {
  // A skipped describe's body still RUNS at collection, so the decode below
  // would throw on the missing glTF; register one visible skip instead.
  if (!KIT) {
    it.skip('needs `scripts/build-wam-kit.sh juggernaut` first', () => {});
    return;
  }
  const gltf = JSON.parse(KIT) as Gltf;
  const body = buildBody(compileBlob(parseBlob(blobSrc), compileFace(parseBlob(blobSrc))));

  const groups = (() => {
    const bytes = Uint8Array.from(atob(gltf.buffers[0]!.uri.split(',', 2)[1]!), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const off = (i: number) => {
      const a = gltf.accessors[i]!;
      return (gltf.bufferViews[a.bufferView]!.byteOffset ?? 0) + (a.byteOffset ?? 0);
    };
    const out = new Map<string, Vec3[]>();
    for (const prim of gltf.meshes[0]!.primitives) {
      const pa = gltf.accessors[prim.attributes['POSITION']!]!, pb = off(prim.attributes['POSITION']!);
      const pos: Vec3[] = [];
      for (let k = 0; k < pa.count; k++)
        pos.push([view.getFloat32(pb + k * 12, true), view.getFloat32(pb + k * 12 + 4, true), view.getFloat32(pb + k * 12 + 8, true)]);
      const ia = gltf.accessors[prim.indices]!, ib = off(prim.indices);
      const size = ia.componentType === 5121 ? 1 : ia.componentType === 5123 ? 2 : 4;
      const seen = new Set<number>();
      for (let k = 0; k < ia.count; k++)
        seen.add(size === 1 ? view.getUint8(ib + k) : size === 2 ? view.getUint16(ib + k * 2, true) : view.getUint32(ib + k * 4, true));
      out.set(gltf.materials[prim.material]!.name, [...seen].map(i => pos[i]!));
    }
    return out;
  })();
  const all = () => [...groups.values()].flat();

  it('decodes the compiled kit: plate, iron, brass and lens', () => {
    expect([...groups.keys()].sort()).toEqual(['brass', 'iron', 'lens', 'plate']);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThanOrEqual(8);
  });

  // The soldier's bound is 0.080, from his pauldron's forced inner-rim tuck.
  // The juggernaut's domes are bigger and their inner rims sit at x ~0.047 m
  // over the gorget, just below the top of the torso flesh, so the forced
  // tuck is deeper. Re-derived, not raised: a rim ring of half-width 0.100 u
  // round a centre 0.12 u out cannot enclose the deltoid without it. What
  // this still catches is geometry that is not a tuck at all.
  const TUCK_MAX = 0.10;
  it.each(['plate', 'iron', 'brass', 'lens'])('no %s vertex passes through the body', name => {
    const vs = groups.get(name)!;
    let worst = Infinity, at: Vec3 = vs[0]!;
    for (const v of vs) { const d = sdBody(v, body); if (d < worst) { worst = d; at = v; } }
    expect(worst, `${name} deepest vertex at (${at.map(n => n.toFixed(3)).join(', ')})`).toBeGreaterThan(-TUCK_MAX);
  });

  // THE HELMET ENCLOSES THE HEAD. Everything above the neck top and near the
  // axis is helmet, snout or lens, and none of it may touch the face.
  it('seals the head: helmet geometry clears the face and crowns the skull', () => {
    const neckTop = body.bones.get('skull')!.head[1];
    const helm = all().filter(v => v[1] > neckTop + 0.03 && Math.abs(v[0]) < 0.16);
    expect(helm.length).toBeGreaterThan(20);
    for (const v of helm) expect(sdBody(v, body), `helmet at ${v.map(n => n.toFixed(3)).join(', ')}`).toBeGreaterThan(0.008);
    // The head's flesh tops out ~2.19 m; the dome must be above it.
    expect(Math.max(...helm.map(v => v[1]))).toBeGreaterThan(2.20);
  });

  it('crowns the deltoid orb with the pauldron dome', () => {
    const arm = body.clusters.find(c => c.limb === 'armL')!;
    const orb = body.prims.slice(arm.start, arm.start + arm.count)
      .filter(p => p.a[1] === p.b[1] && p.a[0] === p.b[0])
      .reduce((best, p) => (p.radius > best.radius ? p : best));
    const crown = orb.a[1] + orb.radius * orb.scale[1]!;
    const over = groups.get('plate')!.filter(v => Math.abs(v[0] - orb.a[0]) < 0.03 && v[1] > crown);
    expect(over.length, `nothing above the deltoid crown ${crown.toFixed(3)}`).toBeGreaterThan(0);
  });

  it('stands on his boots, sole on the ground, out at a foot', () => {
    const vs = all();
    const lowest = vs.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(lowest[1]).toBeLessThan(0.012);
    expect(lowest[1]).toBeGreaterThan(-0.008);
    expect(Math.abs(lowest[0])).toBeGreaterThan(0.05);
  });

  it('every named kit bone sits at its blob bone head, within 1 mm', () => {
    const frames = boneFrames(body, bindRig(body), 0);
    const parent = new Map<number, number>();
    gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
    let checked = 0;
    gltf.nodes.forEach((n, i) => {
      const f = n.name ? frames.get(n.name) : undefined;
      if (!f) return;
      const w: number[] = [0, 0, 0];
      for (let k: number | undefined = i; k !== undefined; k = parent.get(k)) {
        const t = gltf.nodes[k]!.translation ?? [0, 0, 0];
        for (let j = 0; j < 3; j++) w[j] = w[j]! + t[j]!;
      }
      for (let j = 0; j < 3; j++) expect(Math.abs(w[j]! - f.pos[j]!), `${n.name}[${j}]`).toBeLessThan(1e-3);
      checked++;
    });
    expect(checked).toBe(body.bones.size);
  });
});
