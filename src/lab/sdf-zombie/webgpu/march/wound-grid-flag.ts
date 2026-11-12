// src/lab/sdf-zombie/webgpu/march/wound-grid-flag.ts
//
// COMPILE-TIME switch for THE CRATER GRID (2026-11-11, a spike;
// docs/superpowers/specs/2026-11-11-wound-crater-grid-design.md, stage 1).
//
// applyWounds reads every wound row of a body at every march step. With the switch on it loads the sample's cell
// of a grid the CPU builds over the body's wounds (../../wound-grid.ts) and walks only the wounds listed there
// (fields/wound-grid.wgsl.ts). The wounds and their formula are the list's own.
//
// LOOSE, not exact: a wound is listed where a sample at or above the surface can feel it, plus a slack. A sample
// deeper in the flesh than that sees fewer wounds than the list gives it (the scatter and thickness probes).
//
//   (no parameter), ?woundgrid=0   off: the shader text of before the switch, byte for byte
//   ?woundgrid, ?woundgrid=1       on, 3 cm of slack
//   ?woundgrid=<cm>                on, that many centimetres of slack (0 to 30)
export function woundGridSlack(search: string): number {
  const v = new URLSearchParams(search).get('woundgrid');
  if (v === null || v === '0') return -1;
  const cm = Number(v);
  return v === '' || v === '1' || !Number.isFinite(cm) ? 0.03 : Math.min(30, Math.max(0, cm)) / 100;
}

/** Metres of slack on a wound's listed reach; negative = the switch is off. */
export const WOUND_GRID_SLACK: number = (() => {
  try {
    return woundGridSlack((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return -1;
  }
})();
export const WOUND_GRID: boolean = WOUND_GRID_SLACK >= 0;
