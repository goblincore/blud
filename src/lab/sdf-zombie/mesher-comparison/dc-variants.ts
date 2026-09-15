// src/lab/sdf-zombie/mesher-comparison/dc-variants.ts
//
// Named dual-contouring variants for the 2026-09-15 chamfer follow-up.
//
// The DEFAULT variant is the shipped port exactly as the original comparison
// ran it (Hermite normal step = cell * 0.5, post-solve component clamp on), so
// the baseline stays reproducible and the original evidence is untouched.
// Every other variant exists only to isolate one hypothesis at a time; none of
// them is a production default and none changes the CLI's method set.
//
// Hypothesis isolation (all settled by the follow-up measurements):
//   * `eps-*`   — is the `cell * 0.5` gradient step too coarse for a ~10-20 mm
//                 feature? Upstream ALICE-SDF uses a fixed 0.001 m. YES: a 5x
//                 finer, bounded step cuts the groove-pit coverage error ~3x at
//                 10 mm and leaves the sharp box and sphere untouched.
//   * `noclamp` — is the component clamp pinching the vertex? NO: the clamp is
//                 protective; removing it makes the pit worse, so a constrained
//                 solver is not called for by the evidence.
//   * `candidate` — the selected fix: `clamp(0.1 * cell, 0.1 mm, 2 mm)`, i.e.
//                 the port's resolution scaling made 5x finer and bounded so it
//                 is 1 mm at the focus 10 mm cell and never exceeds 2 mm.

import type { GridSpec, MethodOptions } from './types';

export interface DcVariant {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  /** Resolve the Hermite normal step in metres; null keeps the port default. */
  normalEpsilon(cell: number): number | null;
  /** Whether the QEF vertex is clamped into its cell AABB. */
  clampToCell: boolean;
}

/** Baseline: the exact options the original comparison passed. */
export const DC_BASELINE: DcVariant = {
  id: 'dc-baseline', label: 'DC baseline (cell*0.5 normals, clamp)',
  note: 'Exact port default. Reproduces the original comparison result.',
  normalEpsilon: () => null, clampToCell: true,
};

/** The selected experimental candidate. */
export const DC_CANDIDATE: DcVariant = {
  id: 'dc-eps-candidate', label: 'DC candidate (clamp(0.1*cell, 0.1mm, 2mm))',
  note: '5x finer than the port step; 1 mm at the 10 mm focus cell, bounded to [0.1 mm, 2 mm]. Keeps the cell-relative scaling.',
  normalEpsilon: (cell) => Math.min(Math.max(cell * 0.1, 1e-4), 2e-3),
  clampToCell: true,
};

export const DC_VARIANTS: readonly DcVariant[] = [
  DC_BASELINE,
  {
    id: 'dc-eps-002cell', label: 'DC eps 0.02*cell',
    note: 'Sweep: very fine cell-relative Hermite step (0.2 mm at 10 mm).',
    normalEpsilon: (cell) => cell * 0.02, clampToCell: true,
  },
  {
    id: 'dc-eps-1mm', label: 'DC eps 1 mm (upstream-like)',
    note: 'Sweep: upstream ALICE-SDF fixed 1 mm step.',
    normalEpsilon: () => 0.001, clampToCell: true,
  },
  DC_CANDIDATE,
  {
    id: 'dc-baseline-noclamp', label: 'DC baseline, no clamp',
    note: 'Diagnostic: post-solve component clamp disabled at the port step.',
    normalEpsilon: () => null, clampToCell: false,
  },
  {
    id: 'dc-candidate-noclamp', label: 'DC candidate, no clamp',
    note: 'Diagnostic: is the clamp still load-bearing once the step is finer?',
    normalEpsilon: (cell) => Math.min(Math.max(cell * 0.1, 1e-4), 2e-3), clampToCell: false,
  },
];

export function dcVariantById(id: string): DcVariant {
  const v = DC_VARIANTS.find(x => x.id === id);
  if (!v) throw new Error(`unknown DC variant '${id}'; known: ${DC_VARIANTS.map(x => x.id).join(', ')}`);
  return v;
}

/** Method options for a DC variant at a given cell/grid. */
export function dcOptionsFor(variant: DcVariant, cell: number, grid: GridSpec): MethodOptions {
  const eps = variant.normalEpsilon(cell);
  return {
    cell, grid, bisectionIterations: 6, clampToCell: variant.clampToCell,
    ...(eps === null ? {} : { normalEpsilon: eps }),
  };
}
