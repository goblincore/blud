// Type declarations for scripts/lib/task6-grid.mjs (imported by vitest tests
// under src/; the driver imports it directly as plain ESM).
export interface Task6LatticePoint { x: number; y: number }
export interface Task6Lattice {
  points: Task6LatticePoint[];
  unfiltered: number;
  outOfBounds: number;
  excluded: number;
}
export interface Task6LatticeOptions {
  cx: number;
  cy: number;
  dxRange: [number, number];
  dyRange: [number, number];
  step: number;
  bounds?: number;
  exclude?: { x: number; y: number; radius: number };
  max?: number;
}
export function buildNdcLattice(o: Task6LatticeOptions): Task6Lattice;
