// src/lab/sdf-zombie/webgpu/level-json.flat.test.ts
//
// The committed Flat: one art-shelled stone room, the last stage of the 2026-10-01 look-dev
// (docs/superpowers/specs/2026-10-11-flat-room-design.md).

// @ts-expect-error — node:fs available in vitest
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { glbJson } from './level-art';
import { roomAtPoint } from './level-def';
import { parseLevelJson } from './level-json';

const lvl = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/flat.level.json', 'utf8')));

describe('flat.level.json', () => {
  it('one art-shelled room, 2.7 m by 3.6 m, under a vault about 2.56 m at the crown', () => {
    expect(lvl.id).toBe('flat');
    expect(lvl.rooms).toHaveLength(1);
    const r = lvl.rooms[0]!;
    expect(r.shell).toBe('art');
    expect(+(r.maxX - r.minX).toFixed(2)).toBe(2.7);
    expect(+(r.maxZ - r.minZ).toFixed(2)).toBe(3.6);
    expect(r.height).toBeGreaterThan(2.5);
    expect(r.height).toBeLessThan(2.62);
    expect(lvl.art).toBe('flat.art.glb');
    expect(missingCapabilities(lvl, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('starts at the south end, inside the room, facing the window (north, -z)', () => {
    expect(roomAtPoint(lvl, lvl.playerStart.x, lvl.playerStart.z)?.name).toBe('flat');
    expect(lvl.playerStart.z).toBeLessThan(-0.3);
    expect(lvl.playerStart.z).toBeGreaterThan(-1.0);
    expect(Math.abs(lvl.playerStart.yaw)).toBeLessThan(1e-3);
  });

  it('has no enemies, pickups or gates', () => {
    expect(lvl.spawns).toHaveLength(0);
    expect(lvl.pickups).toHaveLength(0);
    expect(lvl.gates).toHaveLength(0);
  });
});

type Accessor = { count: number };
type Primitive = { indices?: number; material?: number };
type Gltf = { accessors: Accessor[]; meshes: { primitives: Primitive[] }[]; materials?: { name?: string; alphaMode?: string }[] };

describe('flat.art.glb budget (spec section 8)', () => {
  const bytes = new Uint8Array(readFileSync('public/assets/levels/flat.art.glb'));
  const glb = glbJson(bytes) as Gltf;
  const prims = glb.meshes.flatMap(m => m.primitives);
  const triangles = prims.reduce((n, p) => n + (p.indices === undefined ? 0 : glb.accessors[p.indices]!.count / 3), 0);

  // Raised from 40: the iMac adds about nine materials (owner, 2026-10-11: look first, optimise later).
  it('at most 60 draw-call primitives', () => { expect(prims.length).toBeLessThanOrEqual(60); });
  // Raised from 250 000 (owner, 2026-10-11): the look comes first; an optimisation pass follows.
  it('at most 400 000 triangles', () => { expect(triangles).toBeLessThanOrEqual(400_000); });
  it('the front door is built (an oak leaf in the south wall)', () => {
    expect(glb.materials?.some(m => m.name === 'door_oak')).toBe(true);
  });
  it('the iMac shell is a blended material', () => {
    const shell = glb.materials?.find(m => m.name === 'giger_shell');
    expect(shell?.alphaMode).toBe('BLEND');
  });
  // File size is not a constraint (owner, 2026-10-11): this only catches an accidental huge texture.
  it('an art file under 20 MB', () => { expect(statSync('public/assets/levels/flat.art.glb').size).toBeLessThanOrEqual(20 * 1024 * 1024); });
});
