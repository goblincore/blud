// src/lab/sdf-zombie/webgpu/level-json.flat-early.test.ts
//
// The committed early stage of the Flat (`flat-early`): the same apartment as `flat`, built by the same
// Blender script with FLAT_STAGE=early, WITHOUT the Giger iMac (the machine's last stage); the iMac's
// lights are replaced by a lamp light and a CRT glow at the kotatsu, where the emergence scene builds
// its CRT, keyboard and lamp at runtime (spec docs/superpowers/specs/2026-10-16-emergence-in-the-flat-design.md).

// @ts-expect-error — node:fs available in vitest
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { MAX_DEFERRED_LIGHTS } from './deferred-lighting';
import { glbJson } from './level-art';
import { roomAtPoint } from './level-def';
import { parseLevelJson } from './level-json';

const lvl = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/flat-early.level.json', 'utf8')));
const flat = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/flat.level.json', 'utf8')));

describe('flat-early.level.json', () => {
  it('is flat-early: one art-shelled room with the same footprint as the flat (4.45 m by 5.6 m)', () => {
    expect(lvl.id).toBe('flat-early');
    expect(lvl.rooms).toHaveLength(1);
    const r = lvl.rooms[0]!;
    const f = flat.rooms[0]!;
    expect(r.shell).toBe('art');
    expect(+(r.maxX - r.minX).toFixed(2)).toBe(4.45);
    expect(+(r.maxZ - r.minZ).toFixed(2)).toBe(5.6);
    expect([r.minX, r.maxX, r.minZ, r.maxZ, r.height]).toEqual([f.minX, f.maxX, f.minZ, f.maxZ, f.height]);
    expect(lvl.art).toBe('flat-early.art.glb');
    expect(missingCapabilities(lvl, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('starts in the entry hall by the front door, facing the room (north, -z)', () => {
    expect(roomAtPoint(lvl, lvl.playerStart.x, lvl.playerStart.z)?.name).toBe('flat');
    expect(lvl.playerStart.z).toBeGreaterThan(1.2);      // the hall is game z 0 to 2
    expect(lvl.playerStart.z).toBeLessThan(1.9);
    expect(Math.abs(lvl.playerStart.yaw)).toBeLessThan(1e-3);
  });

  it('keeps the flat\'s collision (furniture and solids) and has no enemies, pickups or gates', () => {
    expect(lvl.solids.length).toBe(flat.solids.length);
    expect(lvl.furniture.length).toBe(flat.furniture.length);
    expect(lvl.spawns).toHaveLength(0);
    expect(lvl.pickups).toHaveLength(0);
    expect(lvl.gates).toHaveLength(0);
  });

  describe('lights: the iMac\'s three are gone, a lamp and a CRT glow at the kotatsu', () => {
    const accents = lvl.rooms[0]!.accents;
    const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) < 0.01;

    it('within the engine\'s cap, one fewer than the flat', () => {
      expect(accents.length).toBeLessThanOrEqual(MAX_DEFERRED_LIGHTS);
      expect(accents.length).toBe(flat.rooms[0]!.accents.length - 1);
      for (const a of accents) expect(a.fixture).toBe('none');
    });
    it('`lamp`: warm, at the scene\'s lamp bulb (game (-0.23, 0.71, -2.235))', () => {
      const lamp = accents.find(a => near(a.pos, [-0.23, 0.71, -2.235]));
      expect(lamp).toBeDefined();
      expect(lamp!.color[0]).toBeGreaterThan(lamp!.color[2]);
    });
    it('`crt`: cool and weaker than the lamp, in front of the CRT\'s glass (game (0.12, 0.76, -2.065))', () => {
      const crt = accents.find(a => near(a.pos, [0.12, 0.76, -2.065]));
      const lamp = accents.find(a => near(a.pos, [-0.23, 0.71, -2.235]));
      expect(crt).toBeDefined();
      expect(crt!.color[2]).toBeGreaterThan(crt!.color[0]);
      expect(crt!.power).toBeLessThan(lamp!.power);
    });
    it('none of the iMac\'s lights (amber, amber2, screen) remains', () => {
      for (const p of [[0.15, 0.615, -2.66], [0.08, 0.575, -2.44], [0.12, 0.725, -2.25]]) {
        expect(accents.some(a => near(a.pos, p))).toBe(false);
      }
    });
  });
});

type Accessor = { count: number; min?: number[]; max?: number[] };
type Primitive = { indices?: number; material?: number; attributes: Record<string, number> };
type Gltf = { accessors: Accessor[]; meshes: { primitives: Primitive[] }[]; materials?: { name?: string; alphaMode?: string }[] };

// The materials only the Giger iMac uses (the diff of flat.art.glb and flat-early.art.glb's material lists, 2026-10-16).
// Shared with the room, so present in both: lips and flesh (the hall's slippers), darkglass (the toilet's bowl),
// gunmetal and gasket (the Giger conduits, the boiler and their collars), bone.
const IMAC_ONLY = ['giger_shell', 'screen', 'cd', 'bezel', 'mucus', 'tongue'];

describe('flat-early.art.glb', () => {
  const bytes = new Uint8Array(readFileSync('public/assets/levels/flat-early.art.glb'));
  const glb = glbJson(bytes) as Gltf;
  const prims = glb.meshes.flatMap(m => m.primitives);
  const triangles = prims.reduce((n, p) => n + (p.indices === undefined ? 0 : glb.accessors[p.indices]!.count / 3), 0);
  const names = new Set((glb.materials ?? []).map(m => m.name));

  it('has none of the iMac\'s materials (the late flat has every one of them)', () => {
    const late = new Set((glbJson(new Uint8Array(readFileSync('public/assets/levels/flat.art.glb'))) as Gltf).materials!.map(m => m.name));
    for (const m of IMAC_ONLY) {
      expect(late.has(m), `flat has ${m}`).toBe(true);
      expect(names.has(m), m).toBe(false);
    }
  });
  it('still has the room: the kotatsu board, the quilt, the futon, the front door, the window\'s view', () => {
    for (const m of ['kotatsu_board', 'quilt', 'futon', 'door_oak', 'view', 'tatami']) expect(names.has(m), m).toBe(true);
  });
  it('the kotatsu board\'s top is at 0.44 m (the emergence placement stands the CRT on it)', () => {
    const k = (glb.materials ?? []).findIndex(m => m.name === 'kotatsu_board');
    const board = prims.filter(p => p.material === k);
    expect(board.length).toBeGreaterThan(0);
    const top = Math.max(...board.map(p => glb.accessors[p.attributes.POSITION!]!.max![1]!));
    expect(top).toBeCloseTo(0.44, 4);
  });
  it('at most 60 draw-call primitives and 500 000 triangles (the flat\'s caps)', () => {
    expect(prims.length).toBeLessThanOrEqual(60);
    expect(triangles).toBeLessThanOrEqual(500_000);
  });
  it('an art file under 40 MB', () => { expect(statSync('public/assets/levels/flat-early.art.glb').size).toBeLessThanOrEqual(40 * 1024 * 1024); });
});
