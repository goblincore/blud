// scripts/levels/level_surfaces.ts — dump a level's generated display geometry
// (spec §6.3, the game's own generator) as JSON, for Blender preview renders.
//
//   npx tsx scripts/levels/level_surfaces.ts public/assets/levels/the-wake.level.json > out.json

import { readFileSync } from 'node:fs';
import { layoutSurfaces } from '../../src/lab/sdf-zombie/webgpu/level-def';
import { parseLevelJson } from '../../src/lab/sdf-zombie/webgpu/level-json';

const file = process.argv[2];
if (!file) throw new Error('usage: level_surfaces.ts <level.json> [state]');
const def = parseLevelJson(JSON.parse(readFileSync(file, 'utf8')), { state: process.argv[3] });
const s = layoutSurfaces(def);
process.stdout.write(JSON.stringify({
  id: def.id,
  rooms: def.rooms.map(r => ({ id: r.id, name: r.name, min: [r.minX, r.minZ], max: [r.maxX, r.maxZ], height: r.height, sky: r.sky })),
  planes: s.planes, boxes: s.boxes, gates: s.gates, windows: s.windows,
}));
