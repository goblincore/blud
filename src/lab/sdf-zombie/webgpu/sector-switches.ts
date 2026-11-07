// src/lab/sdf-zombie/webgpu/sector-switches.ts
//
// GUN SWITCHES (2026-11-01): a wall line (the level file's `switches`, sector-def.ts SectorSwitchDef) that fires a level
// event the first time a player's shot hits it, anywhere along the line, as Doom's gun switches do. This module is the
// rules and the plate's mesh data: which line is whose, pressed once, and a small metal plate with a square status lamp
// at the middle of the line, on its front side (game-switches.ts draws it, red until pressed, then green).
//
// Pure: no three.js, no DOM.

import type { SectorMap, SectorSwitchDef } from './sector-def';

export interface SwitchField {
  readonly defs: readonly SectorSwitchDef[];
  /** Per switch, 1 once pressed. */
  readonly pressed: Uint8Array;
  /** Per map line, the switch on it, or -1. */
  readonly lineSwitch: Int32Array;
}

export function createSwitchField(defs: readonly SectorSwitchDef[], lineCount: number): SwitchField {
  const lineSwitch = new Int32Array(lineCount).fill(-1);
  defs.forEach((def, i) => { if (def.line >= 0 && def.line < lineCount) lineSwitch[def.line] = i; });
  return { defs, pressed: new Uint8Array(defs.length), lineSwitch };
}

/** A player's shot hit `line` (-1: not a line). Returns the switch it pressed just now, or -1. */
export function shootLine(field: SwitchField, line: number): number {
  const s = line >= 0 && line < field.lineSwitch.length ? field.lineSwitch[line]! : -1;
  if (s < 0 || field.pressed[s]) return -1;
  field.pressed[s] = 1;
  return s;
}

/** The plate's proportions (metres). */
export const PLATE = { width: 0.56, height: 0.78, proud: 0.05, lamp: 0.3, lampProud: 0.025, centreY: 1.5 };
const UV_TILE_M = 4;
/** The lamp's spill on the plate round it falls to 0 at the plate's edge. */
export interface PlateMeshData { position: number[]; normal: number[]; uv: number[]; mottleUv: number[]; lamp: number[]; spill: number[]; count: number; sector: number }

type V3 = [number, number, number];

/** The plate and lamp of switch `def`, on its line's front side, standing on that sector's floor + PLATE.centreY
 *  (kept under the ceiling). Its width never runs past the line's ends. */
export function switchPlateMesh(map: SectorMap, def: SectorSwitchDef): PlateMeshData {
  const line = map.lines[def.line]!;
  const sector = map.sectors[line.front]!;
  const p = map.vertices[line.v[0]]!, q = map.vertices[line.v[1]]!;
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const tx = (q[0] - p[0]) / len, tz = (q[1] - p[1]) / len;
  const nx = -tz, nz = tx;                                   // the front sector is on the left of v[0] -> v[1]
  const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
  const out: PlateMeshData = { position: [], normal: [], uv: [], mottleUv: [], lamp: [], spill: [], count: 0, sector: line.front };
  const at = (m: number, w: number, y: number): V3 => [mx + tx * m + nx * w, y, mz + tz * m + nz * w];
  const T: V3 = [tx, 0, tz], N: V3 = [nx, 0, nz], UP: V3 = [0, 1, 0];
  const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
  const quad = (c: V3[], n: V3, lamp: number, spill: number) => {
    const [a, b, d] = c as [V3, V3, V3];
    const cx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
    const cy = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
    const cz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const tris = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of tris) {
      const v = c[i]!;
      const u = Math.abs(n[1]) >= 0.5 || Math.abs(n[0]) <= Math.abs(n[2]) ? v[0] : v[2];
      const w = Math.abs(n[1]) >= 0.5 ? v[2] : v[1];
      out.position.push(...v); out.normal.push(...n);
      out.uv.push(u / UV_TILE_M, w / UV_TILE_M); out.mottleUv.push(u / UV_TILE_M, w / UV_TILE_M);
      out.lamp.push(lamp); out.spill.push(spill);
      out.count++;
    }
  };
  /** A box on the wall (no back face). */
  const box = (hw: number, y0: number, y1: number, w0: number, w1: number, lamp: number, spill: number) => {
    quad([at(-hw, w1, y0), at(hw, w1, y0), at(hw, w1, y1), at(-hw, w1, y1)], N, lamp, spill);
    quad([at(-hw, w0, y0), at(-hw, w1, y0), at(-hw, w1, y1), at(-hw, w0, y1)], neg(T), lamp, spill);
    quad([at(hw, w0, y0), at(hw, w1, y0), at(hw, w1, y1), at(hw, w0, y1)], T, lamp, spill);
    quad([at(-hw, w0, y1), at(hw, w0, y1), at(hw, w1, y1), at(-hw, w1, y1)], UP, lamp, spill);
    quad([at(-hw, w0, y0), at(hw, w0, y0), at(hw, w1, y0), at(-hw, w1, y0)], neg(UP), lamp, spill);
  };
  const hw = Math.min(PLATE.width / 2, len / 2 - 0.02);
  const top = Math.min(sector.floor + PLATE.centreY + PLATE.height / 2, sector.ceil - 0.02);
  const y0 = Math.max(sector.floor + 0.02, top - PLATE.height), yc = (y0 + top) / 2;
  box(hw, y0, top, 0, PLATE.proud, 0, 0.25);
  const lh = Math.min(PLATE.lamp, hw * 1.4) / 2;
  box(lh, yc - lh, yc + lh, PLATE.proud, PLATE.proud + PLATE.lampProud, 1, 0);
  return out;
}
