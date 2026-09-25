// src/lab/sdf-zombie/webgpu/level-json.art-shell.test.ts
//
// The mesh key fixture: an art shell and three instanced, linked seats.

// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJson } from './level-art';
import { parseLevelJson } from './level-json';

const lvl = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/art-shell.level.json', 'utf8')));
type Node = { name?: string; mesh?: number; children?: number[]; extras?: Record<string, unknown>; extensions?: Record<string, unknown> };
const glb = glbJson(new Uint8Array(readFileSync('public/assets/levels/fixtures/art-shell.art.glb'))) as { nodes: Node[] };

describe('art-shell fixture', () => {
  it('one art-shelled carriage with its art file', () => {
    expect(lvl.art).toBe('art-shell.art.glb');
    expect(lvl.rooms.map(r => r.shell)).toEqual(['art']);
    expect(lvl.furniture).toHaveLength(3);
  });
  it('the shell is one joined mesh tagged with its room', () => {
    const shell = glb.nodes.filter(n => n.name?.startsWith('art:1:fixture.panel'));
    expect(shell).toHaveLength(1);
    expect(shell[0]!.extras?.room).toBe(1);
  });
  it('the three linked seats are one GPU-instanced node, tagged with its room', () => {
    // Blender's exporter puts EXT_mesh_gpu_instancing on the per-room parent itself.
    const inst = glb.nodes.filter(n => n.extensions?.EXT_mesh_gpu_instancing);
    expect(inst).toHaveLength(1);
    expect(inst[0]!.name).toBe('kit:1:seat');
    expect(inst[0]!.extras?.room).toBe(1);
  });
});
