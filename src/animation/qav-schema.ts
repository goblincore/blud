/** Per-tile metadata loaded from tiles-meta.json. */
export interface TileMeta {
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export type TileMetaMap = Record<string, TileMeta>;

export interface QavLayer {
  tile: number;
  ox: number;
  oy: number;
  scale: number;
  flipX?: boolean;
}

export interface QavFrame {
  durMs: number;
  layers: QavLayer[];
  events?: string[]; // reserved; runtime ignores for now
}

export interface QavManifest {
  name: string;
  kind: 'qav';
  loop: boolean;
  nFrames: number;
  frames: QavFrame[];
}

export interface SeqFrame {
  tileOffset: number;
  durMs: number;
  events?: string[];
}

export interface SeqManifest {
  name: string;
  kind: 'seq';
  loop: boolean;
  baseTile: number;
  angleStride: number;
  frames: SeqFrame[];
}

export type AnimationManifest = QavManifest | SeqManifest;

export class ManifestError extends Error {
  constructor(public manifestName: string, public field: string, msg: string) {
    super(`manifest "${manifestName}" (${field}): ${msg}`);
    this.name = 'ManifestError';
  }
}

export function validateManifest(
  raw: unknown,
  tileMeta: TileMetaMap,
): AnimationManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestError('<unknown>', '(root)', 'not an object');
  }
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name : undefined;
  if (!name) throw new ManifestError('<unknown>', 'name', 'missing or not a string');

  const require = (field: string, cond: boolean, msg: string): void => {
    if (!cond) throw new ManifestError(name, field, msg);
  };

  if (r.kind === 'qav') {
    require('loop', typeof r.loop === 'boolean', 'must be boolean');
    require('frames', Array.isArray(r.frames) && (r.frames as unknown[]).length > 0, 'must be non-empty array');
    const frames = r.frames as unknown[];
    frames.forEach((f, i) => {
      if (typeof f !== 'object' || f === null) {
        throw new ManifestError(name, `frames[${i}]`, 'not an object');
      }
      const fr = f as Record<string, unknown>;
      require(`frames[${i}].durMs`, typeof fr.durMs === 'number' && fr.durMs > 0, 'must be positive number');
      require(`frames[${i}].layers`, Array.isArray(fr.layers), 'must be array');
      const layers = fr.layers as unknown[];
      layers.forEach((l, j) => {
        if (typeof l !== 'object' || l === null) {
          throw new ManifestError(name, `frames[${i}].layers[${j}]`, 'not an object');
        }
        const lyr = l as Record<string, unknown>;
        require(`frames[${i}].layers[${j}].tile`, typeof lyr.tile === 'number', 'must be number');
        const tile = lyr.tile as number;
        if (!(String(tile) in tileMeta)) {
          throw new ManifestError(name, `frames[${i}].layers[${j}].tile`, `tile ${tile} not in tiles-meta.json`);
        }
        require(`frames[${i}].layers[${j}].ox`, typeof lyr.ox === 'number', 'must be number');
        require(`frames[${i}].layers[${j}].oy`, typeof lyr.oy === 'number', 'must be number');
        require(`frames[${i}].layers[${j}].scale`, typeof lyr.scale === 'number', 'must be number');
      });
    });
    return raw as QavManifest;
  }

  if (r.kind === 'seq') {
    require('loop', typeof r.loop === 'boolean', 'must be boolean');
    require('baseTile', typeof r.baseTile === 'number', 'must be number');
    if (!(String(r.baseTile) in tileMeta)) {
      throw new ManifestError(name, 'baseTile', `tile ${r.baseTile} not in tiles-meta.json`);
    }
    require('angleStride', typeof r.angleStride === 'number' && (r.angleStride as number) >= 1, 'must be >= 1');
    require('frames', Array.isArray(r.frames) && (r.frames as unknown[]).length > 0, 'must be non-empty array');
    const frames = r.frames as unknown[];
    frames.forEach((f, i) => {
      if (typeof f !== 'object' || f === null) throw new ManifestError(name, `frames[${i}]`, 'not an object');
      const fr = f as Record<string, unknown>;
      require(`frames[${i}].tileOffset`, typeof fr.tileOffset === 'number', 'must be number');
      require(`frames[${i}].durMs`, typeof fr.durMs === 'number' && fr.durMs > 0, 'must be positive');
    });
    return raw as SeqManifest;
  }

  throw new ManifestError(name, 'kind', `unknown kind "${String(r.kind)}"; expected "qav" or "seq"`);
}
