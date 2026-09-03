/**
 * The geometry half of blob:relief, separated so it can be tested without a
 * GLB: reference vertices -> front-wall cells.
 *
 * A cell is (x, y) binned, holding the MAXIMUM z of the vertices in it — the
 * surface a camera on +z sees. Both axes are binned in the BODY's metres
 * after scaling, so a cell is the same physical size on any character.
 */
export interface ReliefCell { x: number; y: number; z: number; n: number }

/** Cell size in body metres. ~47 mm: fine enough to resolve a pec split
 *  (the minotaur's sternum dip spans ~0.10 m) and coarse enough that every
 *  populated trunk cell on that character holds 30-400 vertices. */
export const CELL = 0.047;

/** Cells thinner than this are edge-of-mesh, where the max-z pick is
 *  unreliable — a stray back-facing vertex becomes the reported front wall.
 *  A floor, not a tuned value: real trunk cells hold an order of magnitude
 *  more. */
export const MIN_VERTS = 6;

export interface ReliefOpts {
  /** Half-width of the x window, body metres. Defaults to 0.34, which on a
   *  T-POSED reference excludes the arms without needing a joint name — and
   *  joint names are exactly what cannot be trusted here, since the vertices
   *  this tool exists to see are the ones no single joint owns. */
  xLimit?: number;
  /** Height window, body metres. Defaults to the whole figure. */
  yMin?: number;
  yMax?: number;
}

/**
 * @param positions reference vertex positions in the MESH's own units
 * @param scale     mesh units -> body metres
 */
export function reliefCells(
  positions: ReadonlyArray<readonly [number, number, number] | Float32Array | number[]>,
  scale: number,
  opts: ReliefOpts = {},
): ReliefCell[] {
  const xLimit = opts.xLimit ?? 0.34;
  const yMin = opts.yMin ?? -Infinity;
  const yMax = opts.yMax ?? Infinity;
  const bins = new Map<string, ReliefCell>();
  for (const p of positions) {
    const x = (p[0] as number) * scale, y = (p[1] as number) * scale, z = (p[2] as number) * scale;
    if (Math.abs(x) > xLimit || y < yMin || y > yMax) continue;
    const ix = Math.round(x / CELL), iy = Math.round(y / CELL);
    const k = `${ix},${iy}`;
    const c = bins.get(k);
    if (c === undefined) bins.set(k, { x: ix * CELL, y: iy * CELL, z, n: 1 });
    else { c.n++; if (z > c.z) c.z = z; }
  }
  return [...bins.values()].filter((c) => c.n >= MIN_VERTS);
}
