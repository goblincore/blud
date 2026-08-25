// src/lab/sdf-zombie/webgpu/tile-cull.ts
//
// CPU tile binning for the per-tile primitive lists (raymarcher perf plan,
// task 5). Screen tiles of 16x16 px at SDF-pass resolution; each body's bound
// group sphere is projected to a CONSERVATIVE screen-space AABB once per frame
// and the group's global prim range appended to every tile it touches.
//
// WHY BIN ONCE PER FRAME, NOT PER STEP: this is the flat-list lesson from the
// spec inverted. A flat GROUP list read per march step cost more in bound
// texel reads than the culled prims saved (zombie 2.6 -> 4.8 ms) because the
// reads sit inside the hottest loop in the shader. The tile list is read ONCE
// per pixel at the march entry — before any stepping — so its cost amortises
// over the ~6-8 steps and dozens of prim folds that follow.
//
// THE CULL IS CONSERVATIVE IN THE ONLY DIRECTION THAT MATTERS: a tile may list
// a group whose prims are nowhere near its pixels (wasted fold work guarded by
// the per-step group-sphere cull, which REMAINS inside the fold); a tile must
// never omit a group whose surface touches it. Hence: screen extent computed at
// the sphere's NEAREST depth (the largest projection), behind-camera spheres
// binned into every tile, and whole-tile clamping outward via floor/ceil.
//
// SOUNDNESS NOTE (spec "cull soundness rule"): the DISTORTION factor rides
// every entry because the shader's group-sphere test compares a Euclidean
// distance against the field's running d, which sdPrimitive under-reports by
// up to maxScale/minScale on anisotropic prims. The factor travels with the
// group exactly as pack.ts stored it; binning never recomputes or drops it.

import * as THREE from 'three/webgpu';

/** Tile edge in pixels at SDF-pass resolution. */
export const TILE_SIZE_PX = 16;

/** Hard cap on entries per tile. Clamped, flagged — never silent truncation. */
export const TILE_MAX_ENTRIES = 64;

/**
 * Texels per packed entry in the stream: bound sphere, then the
 * ROW_GROUP_RANGE-shaped pack (start, count, distort, flags), then meta
 * (bodyIndex in x). The middle texel is byte-for-byte the layout
 * ROW_GROUP_RANGE already uses, so the shader's foldGroup consumes both
 * sources identically. THREE texels, not the two a minimal packing could
 * live with, because the per-step group-sphere cull must keep its sphere
 * AND its distortion factor AND the oriented/shaped flag bits — dropping
 * any of them either regresses the cull or tears thin geometry.
 */
export const TILE_STRIDE = 3;

/**
 * Packed texture geometry. The header texture is one texel per TILE
 * (tilesX x tilesY): x = first entry index in the stream, y = entry count,
 * zw spare. The entry stream is a fixed-width texture of
 * (bodyIndex, groupStart, groupCount, distort) texels addressed LINEARLY —
 * col = idx % ENTRY_ROW_TEXELS, row = floor(idx / ENTRY_ROW_TEXELS) — which
 * is what keeps an append-only stream addressable from WGSL with two integer
 * ops.
 */
export const ENTRY_ROW_TEXELS = 1024;
/** Entry-stream capacity in texels (rows grow by doubling up to this). */
export const ENTRY_MAX_TEXELS = 1 << 22;

/** One bound-group sphere as the binner consumes it. All fields come straight
 *  from pack.ts's packed arrays (groupBounds / groupRange), posed per frame. */
export interface TileGroupInput {
  /** Which body band this group's prim range indexes (merged pass). Hero-only
   *  binning passes 0 and the shader ignores it against a single-body band. */
  bodyIndex: number;
  /** Global prim range, exactly as ROW_GROUP_RANGE packs it. */
  start: number;
  count: number;
  /** Bound sphere, world space, posed. */
  center: [number, number, number];
  radius: number;
  /** The group's distortion factor (groupRange.z). */
  distort: number;
  /** ROW_GROUP_RANGE.w bitfield verbatim: 1 = oriented prims, 2 = some prim
   *  tapered/chamfered/bent. Dropped here, the tile path would fold a turned
   *  head world-axis and skip every shape row — silent wrong geometry. */
  flags: number;
}

export interface TileBinResult {
  tilesX: number;
  tilesY: number;
  /** Header texels, tilesX*tilesY*4 floats: (entryBase, count, 0, 0). */
  headers: Float32Array;
  /** Entry-stream texels: (bodyIndex, start, count, distort) each. Only the
   *  first `usedTexels` are meaningful; upload that much (rounded up to rows). */
  entries: Float32Array;
  usedTexels: number;
  /** Tiles that hit the cap during the last bin() — the clamp counter the
   *  once-per-frame warning keys off. */
  clampedTiles: number;
  totalEntries: number;
  countAt(tx: number, ty: number): number;
  entryAt(tx: number, ty: number, i: number): TileGroupInput | undefined;
}

export class TileBinner {
  readonly tilesX: number;
  readonly tilesY: number;
  readonly widthPx: number;
  readonly heightPx: number;

  private headers: Float32Array;
  private entries: Float32Array;
  /** Per-tile write cursors for pass B (base + cursor -> stream index). */
  private cursors: Float32Array;
  private used = 0;
  private clampedTiles = 0;
  private totalEntries = 0;
  private warnedThisFrame = false;

  constructor(widthPx: number, heightPx: number) {
    this.widthPx = Math.max(1, Math.round(widthPx));
    this.heightPx = Math.max(1, Math.round(heightPx));
    this.tilesX = Math.ceil(this.widthPx / TILE_SIZE_PX);
    this.tilesY = Math.ceil(this.heightPx / TILE_SIZE_PX);
    this.headers = new Float32Array(this.tilesX * this.tilesY * 4);
    this.cursors = new Float32Array(this.tilesX * this.tilesY);
    this.entries = new Float32Array(ENTRY_ROW_TEXELS * 4);
  }

  private ensureCapacity(texels: number) {
    if (texels <= this.entries.length / 4) return;
    let rows = Math.ceil(this.entries.length / 4 / ENTRY_ROW_TEXELS);
    while (rows * ENTRY_ROW_TEXELS < texels) rows *= 2;
    if (rows * ENTRY_ROW_TEXELS > ENTRY_MAX_TEXELS) {
      throw new Error(`tile entry stream overflow: ${texels} texels > ${ENTRY_MAX_TEXELS}`);
    }
    const next = new Float32Array(rows * ENTRY_ROW_TEXELS * 4);
    next.set(this.entries);
    this.entries = next;
  }

  /**
   * Bins every group for one frame. Reuses the internal buffers; the returned
   * view aliases them until the next call.
   *
   * `camera` must have matrixWorldInverse and projectionMatrix current.
   */
  bin(groups: TileGroupInput[], camera: THREE.PerspectiveCamera): TileBinResult {
    this.headers.fill(0);
    this.cursors.fill(0);
    this.used = 0;
    this.clampedTiles = 0;
    this.totalEntries = 0;
    this.warnedThisFrame = false;

    const view = camera.matrixWorldInverse;
    const proj = camera.projectionMatrix;
    const pe = proj.elements;
    const focalY = pe[5]; // 1/tan(fovY/2)
    const W = this.widthPx;
    const H = this.heightPx;
    const v = new THREE.Vector3();

    // TWO PASSES, because a tile's entries must be CONTIGUOUS in the stream
    // for the shader's single base+offset read to work, and an append-only
    // walk interleaves tiles. Pass A projects every sphere, records its tile
    // range and bumps per-tile counts; a prefix sum then hands out each
    // tile's stream base; pass B re-walks and fills the slots.
    let nRanges = 0;
    if (this.ranges.length < groups.length * 4) {
      this.ranges = new Int32Array(Math.max(1024, groups.length * 4));
    }
    const rr = this.ranges;

    const project = (g: TileGroupInput): void => {
      v.set(g.center[0], g.center[1], g.center[2]).applyMatrix4(view);

      let tx0: number, tx1: number, ty0: number, ty1: number;
      // Nearest point of the sphere along the view axis. View space looks
      // down -z, so the nearest depth is -(v.z) - r; if that is <= 0 the
      // sphere crosses or sits behind the camera plane — project nothing,
      // cover EVERY tile. Same for a centre behind the eye plane (clip.w<=0).
      const nearDist = -v.z - g.radius;
      const clipW =
        pe[3]! * v.x + pe[7]! * v.y + pe[11]! * v.z + pe[15]!;
      if (nearDist <= 0 || clipW <= 0) {
        tx0 = 0; tx1 = this.tilesX - 1; ty0 = 0; ty1 = this.tilesY - 1;
      } else {
        const clipX = pe[0]! * v.x + pe[4]! * v.y + pe[8]! * v.z;
        const clipY = pe[1]! * v.x + pe[5]! * v.y + pe[9]! * v.z;
        const ndcX = clipX / clipW;
        const ndcY = clipY / clipW;
        const cx = (ndcX * 0.5 + 0.5) * W;
        // Y IS FLIPPED HERE ON PURPOSE. NDC +Y is UP, but the shader indexes
        // the tile grid by three's `screenUV`, which is
        // `screenCoordinate / screenSize` where screenCoordinate is WGSL's
        // @builtin(position) — origin TOP-left, y increasing DOWNWARD. Without
        // this flip, screen-top bins into row tilesY-1 on the CPU and reads
        // from row 0 in the shader: the lists are mirrored vertically, almost
        // every ray finds an empty tile, and the body vanishes entirely.
        const cy = (0.5 - ndcY * 0.5) * H;
        // Screen extent AT NEAREST DEPTH — the largest projection the sphere
        // can produce, so the AABB cannot undershoot the silhouette.
        const rpix = (g.radius / nearDist) * focalY * (H / 2);
        // REJECT, don't clamp in: a sphere fully off-screen bins into zero
        // tiles. Clamping negative/overflowing coordinates into range would
        // pin far-off geometry onto the edge columns.
        if (cx + rpix <= 0 || cx - rpix >= W || cy + rpix <= 0 || cy - rpix >= H) {
          tx0 = 0; tx1 = -1; ty0 = 0; ty1 = -1;
        } else {
          tx0 = Math.max(0, Math.floor((cx - rpix) / TILE_SIZE_PX));
          tx1 = Math.min(this.tilesX - 1, Math.floor((cx + rpix - 1e-6) / TILE_SIZE_PX));
          ty0 = Math.max(0, Math.floor((cy - rpix) / TILE_SIZE_PX));
          ty1 = Math.min(this.tilesY - 1, Math.floor((cy + rpix - 1e-6) / TILE_SIZE_PX));
        }
      }
      const o = nRanges * 4;
      rr[o] = tx0; rr[o + 1] = tx1; rr[o + 2] = ty0; rr[o + 3] = ty1;
      nRanges++;
    };

    for (const g of groups) project(g);

    // Pass A bookkeeping: counts per tile (capped) and the clamped-tile tally.
    for (let gi = 0; gi < nRanges; gi++) {
      const go = gi * 4;
      for (let ty = rr[go + 2]!; ty <= rr[go + 3]!; ty++) {
        for (let tx = rr[go]!; tx <= rr[go + 1]!; tx++) {
          const t = ty * this.tilesX + tx;
          const n = this.cursors[t]!;
          if (n >= TILE_MAX_ENTRIES) { this.clampedTiles++; continue; }
          this.cursors[t] = n + 1;
        }
      }
    }
    // Prefix sum -> header (base, count); reset cursors to run as offsets.
    let running = 0;
    for (let t = 0; t < this.tilesX * this.tilesY; t++) {
      const n = this.cursors[t]!;
      this.headers[t * 4] = running;
      this.headers[t * 4 + 1] = n;
      this.cursors[t] = 0;
      running += n;
    }
    this.ensureCapacity(running * TILE_STRIDE);
    this.used = running * TILE_STRIDE;

    // Pass B: fill slots.
    for (let gi = 0; gi < nRanges; gi++) {
      const g = groups[gi]!;
      const go = gi * 4;
      for (let ty = rr[go + 2]!; ty <= rr[go + 3]!; ty++) {
        for (let tx = rr[go]!; tx <= rr[go + 1]!; tx++) {
          const t = ty * this.tilesX + tx;
          const n = this.cursors[t]!;
          if (n >= TILE_MAX_ENTRIES) continue;
          const slot = this.headers[t * 4]! + n;
          this.cursors[t] = n + 1;
          const e = slot * TILE_STRIDE * 4;
          // Texel A: the group's bound sphere for the per-step cull.
          this.entries[e] = g.center[0];
          this.entries[e + 1] = g.center[1];
          this.entries[e + 2] = g.center[2];
          this.entries[e + 3] = g.radius;
          // Texel B: exactly the ROW_GROUP_RANGE layout (start, count,
          // distort, flag bitfield) — the shader folds it like any group.
          this.entries[e + 4] = g.start;
          this.entries[e + 5] = g.count;
          this.entries[e + 6] = g.distort;
          this.entries[e + 7] = g.flags;
          // Texel C: meta, bodyIndex in x (merged pass row band).
          this.entries[e + 8] = g.bodyIndex;
        }
      }
    }
    this.totalEntries = running;

    if (this.clampedTiles > 0 && !this.warnedThisFrame) {
      this.warnedThisFrame = true;
      console.warn(
        `[tile-cull] ${this.clampedTiles} tile(s) hit the ${TILE_MAX_ENTRIES}-entry cap this frame; entries were clamped, not wrapped`,
      );
    }

    return {
      tilesX: this.tilesX,
      tilesY: this.tilesY,
      headers: this.headers,
      entries: this.entries,
      usedTexels: this.used,
      clampedTiles: this.clampedTiles,
      totalEntries: this.totalEntries,
      countAt: (tx, ty) => {
        this.checkTile(tx, ty);
        return this.headers[(ty * this.tilesX + tx) * 4 + 1]!;
      },
      entryAt: (tx, ty, i) => {
        this.checkTile(tx, ty);
        const h = (ty * this.tilesX + tx) * 4;
        const base = this.headers[h]!;
        const n = this.headers[h + 1]!;
        if (i < 0 || i >= n) throw new Error(`entry ${i} out of range (tile has ${n})`);
        const o = (base + i) * TILE_STRIDE * 4;
        return {
          bodyIndex: this.entries[o + 8]!,
          start: this.entries[o + 4]!,
          count: this.entries[o + 5]!,
          distort: this.entries[o + 6]!,
          flags: this.entries[o + 7]!,
          center: [this.entries[o]!, this.entries[o + 1]!, this.entries[o + 2]!],
          radius: this.entries[o + 3]!,
        };
      },
    };
  }

  private checkTile(tx: number, ty: number) {
    if (tx < 0 || tx >= this.tilesX || ty < 0 || ty >= this.tilesY) {
      throw new Error(`tile (${tx},${ty}) outside ${this.tilesX}x${this.tilesY}`);
    }
  }

  /** Scratch tile-range store for the last bin() pass, grown on demand. */
  private ranges: Int32Array = new Int32Array(1024);
}

/**
 * Allocates the GPU pair the tile path binds: the small header texture
 * (one texel per tile) and the linear entry-stream texture. Same idiom as
 * createDataTexture — RGBA32F, nearest, no mips; these are DATA.
 *
 * Both are sized for the CURRENT tile grid and entry capacity; resize()
 * reallocates after the layer resizes, and upload() refreshes contents.
 */
export function createTileTextures(tilesX: number, tilesY: number) {
  const headerTexels = new Float32Array(tilesX * tilesY * 4);
  const header = new THREE.DataTexture(
    headerTexels, tilesX, tilesY, THREE.RGBAFormat, THREE.FloatType,
  );
  header.magFilter = THREE.NearestFilter;
  header.minFilter = THREE.NearestFilter;
  header.generateMipmaps = false;

  // SIZED FOR THE WORST CASE, ON PURPOSE — this texture must never need to
  // grow. A three DataTexture cannot be resized in place: swapping image.data
  // and image.height does NOT reallocate the GPU texture, which was created at
  // the original dimensions, so a "grown" buffer silently mismatches and the
  // upload is worse than the truncation it was meant to fix (measured: -70% of
  // the body at 0.6 m versus -20% when it merely truncated).
  //
  // The true bound is every tile holding a full entry list: tiles x
  // TILE_MAX_ENTRIES x TILE_STRIDE. That is what a close camera actually
  // approaches, because each bound-group sphere then covers most of the screen
  // and lands in nearly every tile. At 672x378 that is 42x24x64x3 = 193,536
  // texels, ~3 MB of RGBA-float — cheap next to being unable to walk up to a
  // character.
  const worstCaseTexels = Math.min(
    tilesX * tilesY * TILE_MAX_ENTRIES * TILE_STRIDE, ENTRY_MAX_TEXELS,
  );
  const entryRows = Math.max(8, Math.ceil(worstCaseTexels / ENTRY_ROW_TEXELS));
  const entryTexels = new Float32Array(entryRows * ENTRY_ROW_TEXELS * 4);
  const entries = new THREE.DataTexture(
    entryTexels, ENTRY_ROW_TEXELS, entryRows, THREE.RGBAFormat, THREE.FloatType,
  );
  entries.magFilter = THREE.NearestFilter;
  entries.minFilter = THREE.NearestFilter;
  entries.generateMipmaps = false;
  header.needsUpdate = true;
  entries.needsUpdate = true;

  // Mutable views: `resize`/`growEntries` REPLACE these arrays, and callers
  // hold the store, not the array. Returning them as plain values captured the
  // originals, so after a resize the uploader wrote into a detached buffer
  // while the texture read the new one.
  let headerView = headerTexels;
  let entryView = entryTexels;
  let entryRowsNow = entryRows;

  function resize(nextTilesX: number, nextTilesY: number) {
    headerView = new Float32Array(nextTilesX * nextTilesY * 4);
    header.image.data = headerView;
    header.image.width = nextTilesX;
    header.image.height = nextTilesY;
    header.needsUpdate = true;
  }

  /**
   * Grow the entry texture to hold `texels` entries.
   *
   * WHY THIS EXISTS. `entryRows` was fixed at 8 (8192 texels) and the uploader
   * TRUNCATED anything past it with a console.warn. Up close that is not an
   * edge case: every bound-group sphere covers most of the screen, so all of a
   * body's groups get appended to nearly every tile — measured 21,834 texels
   * needed against the 8192 cap at 0.4 m, i.e. 62% of the stream discarded.
   * The tiles whose entries fell off the end read empty lists and their pixels
   * vanish, which is the interleaved banding the owner reported when the
   * camera approaches the model. Growing is the fix; truncation never was.
   */
  /**
   * Assert the stream fits. It cannot grow — see the allocation note above —
   * so this exists to make an overflow LOUD rather than a silent band of
   * missing pixels. If it ever fires, raise the allocation, do not truncate.
   */
  function growEntries(texels: number) {
    if (texels <= entryRowsNow * ENTRY_ROW_TEXELS) return;
    console.error(
      `[tile-cull] entry stream needs ${texels} texels but the texture holds `
      + `${entryRowsNow * ENTRY_ROW_TEXELS}. Tiles past the cap will render as `
      + `HOLES. Raise the allocation in createTileTextures.`,
    );
  }

  return {
    header, entries,
    get headerTexels() { return headerView; },
    get entryTexels() { return entryView; },
    get entryCapacityTexels() { return entryView.length / 4; },
    resize,
    growEntries,
    dispose() { header.dispose(); entries.dispose(); },
  };
}
