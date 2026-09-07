/**
 * Task-6 driver NDC lattice builder — extracted from the inline tube scan so
 * the geometry has its own CPU-only regression. The inline version shipped
 * `for (let dx = -6; dx <= 6; dx--)`: the update decremented while the
 * condition tested dx <= 6, so the loop NEVER TERMINATED and hung a 90-minute
 * GPU gate before it could emit a single tube check. The builder here is the
 * single source of that arithmetic, with a hard sample maximum.
 *
 * Semantics (matching the intended scan): rows run top-to-bottom — dy from
 * `dyMax` DOWN to `dyMin` — and columns run left-to-right, dx from `dxMin`
 * UP to `dxMax`. `step` is NDC units. Points that leave `bounds` (|ndc| <=
 * bounds) or fall inside the optional exclusion disc (e.g. the FPV gun
 * landmark) are skipped and counted, never silently dropped.
 *
 * Pure and side-effect free: importable from node, vitest, or the driver.
 */

/**
 * @param {object} o
 * @param {number} o.cx lattice centre, NDC x
 * @param {number} o.cy lattice centre, NDC y
 * @param {[number, number]} o.dxRange inclusive [min, max] column offsets
 * @param {[number, number]} o.dyRange inclusive [min, max] row offsets
 *                 (rows still iterate max -> min)
 * @param {number} o.step NDC units between samples
 * @param {number} [o.bounds=0.95] keep |x|,|y| <= bounds
 * @param {{ x: number, y: number, radius: number }} [o.exclude] exclusion disc
 * @param {number} [o.max=512] hard maximum on emitted points (throws beyond)
 * @returns {{ points: {x: number, y: number}[], unfiltered: number,
 *             outOfBounds: number, excluded: number }}
 */
export function buildNdcLattice(o) {
  const { cx, cy, dxRange, dyRange, step, bounds = 0.95, exclude = null, max = 512 } = o;
  if (!(step > 0)) throw new RangeError(`step must be > 0, got ${step}`);
  if (!(max >= 1)) throw new RangeError(`max must be >= 1, got ${max}`);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const points = [];
  let unfiltered = 0, outOfBounds = 0, excluded = 0;
  for (let dy = dyRange[1]; dy >= dyRange[0]; dy--) {
    for (let dx = dxRange[0]; dx <= dxRange[1]; dx++) {
      unfiltered++;
      const nx = r4(cx + dx * step);
      const ny = r4(cy + dy * step);
      if (Math.abs(nx) > bounds || Math.abs(ny) > bounds) { outOfBounds++; continue; }
      if (exclude && Math.hypot(nx - exclude.x, ny - exclude.y) < exclude.radius) { excluded++; continue; }
      if (points.length >= max) {
        throw new RangeError(
          `lattice exceeded its hard maximum of ${max} points — refusing to emit an unbounded sample set`,
        );
      }
      points.push({ x: nx, y: ny });
    }
  }
  return { points, unfiltered, outOfBounds, excluded };
}
