// src/lab/sdf-zombie/characters/warbull-kit.test.ts
//
// Is the reference plate's machinery bolted INTO the warbull (the cable
// belt, the braces, the shod hoof)? The .wam transcribes the .blob's
// skeleton by hand (with its pitch/tilt pairs re-solved, see the .wam) and
// sizes every part against flesh in the other file, so the COMPILED mesh is
// checked against sdBody here, no GPU (juggernaut-kit.test.ts's argument).
//
// SKIPS UNTIL THE KIT IS BUILT. WAM lives outside the repo; the glTF comes
// from `scripts/build-wam-kit.sh warbull`. It is looked up through
// import.meta.glob (an empty match when missing) rather than a `?raw` import,
// which would fail the whole suite's transform before the kit exists.
import { describe, it, expect } from 'vitest';
import blobSrc from './warbull.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { boneFrames } from '../rig-frames';
import { bindRig } from '../rig-bind';
import type { Vec3 } from '../types';

const KIT = Object.values(import.meta.glob('../../../../public/assets/lab/warbull-kit.gltf', {
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

describe('warbull-kit.gltf fits juggernaut.blob', () => {
  // A skipped describe's body still RUNS at collection, so the decode below
  // would throw on the missing glTF; register one visible skip instead.
  if (!KIT) {
    it.skip('needs `scripts/build-wam-kit.sh warbull` first', () => {});
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
  const MATERIALS = ['chrome', 'iron', 'led', 'wire'];

  it('decodes the compiled kit: every material the .wam declares', () => {
    expect([...groups.keys()].sort()).toEqual(MATERIALS);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThanOrEqual(8);
  });

  // EMBEDDED means parts bite into the flesh, so vertices a little below
  // the surface are expected (the belt's bands, the cables' ends, the shoe
  // round the hoof: ~1 cm in the pre-flight). What this catches is geometry
  // that went through the body rather than into it.
  const SINK_MAX = 0.03;
  it.each(MATERIALS)('no %s vertex passes through the body', name => {
    const vs = groups.get(name)!;
    let worst = Infinity, at: Vec3 = vs[0]!;
    for (const v of vs) { const d = sdBody(v, body); if (d < worst) { worst = d; at = v; } }
    expect(worst, `${name} deepest vertex at (${at.map(n => n.toFixed(3)).join(', ')})`).toBeGreaterThan(-SINK_MAX);
  });

  // BOLTED IN, NOT FLOATING: the belt's iron bands bite the waist and the red
  // cables touch the flesh they run on.
  it.each(['iron', 'wire'])('the %s touches the flesh (a band or a cable, not a prop)', name => {
    const nearest = Math.min(...groups.get(name)!.map(v => Math.abs(sdBody(v, body))));
    expect(nearest).toBeLessThan(0.005);
  });

  // THE CABLE WRAP: red strands all the way round his waist, between the
  // plate's 1.35 and 1.56.
  it('wraps his waist in red cables, front, back and both sides', () => {
    const belt = groups.get('wire')!.filter(v => v[1] > 1.33 && v[1] < 1.58);
    expect(belt.length).toBeGreaterThan(100);
    for (const q of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(belt.some(v => v[0] * q[0]! + v[2] * q[1]! > 0.2), `quadrant ${q}`).toBe(true);
    }
  });

  it('shoes ONE hoof in chrome (his left), the plate\'s asymmetry, mirrored', () => {
    const low = groups.get('chrome')!.filter(v => v[1] < 0.05);
    expect(low.length).toBeGreaterThan(0);
    for (const v of low) expect(v[0], 'shoe x').toBeGreaterThan(0);
  });

  it('stands on the shod hoof: sole on the ground, out at a foot', () => {
    const vs = all();
    const lowest = vs.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(lowest[1]).toBeLessThan(0.012);
    expect(lowest[1]).toBeGreaterThan(-0.008);
    expect(Math.abs(lowest[0])).toBeGreaterThan(0.15);
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
