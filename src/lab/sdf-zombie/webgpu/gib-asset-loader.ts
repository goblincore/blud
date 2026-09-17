// src/lab/sdf-zombie/webgpu/gib-asset-loader.ts
//
// THE RUNTIME LOADER FOR THE OFFLINE GIB ASSETS (2026-09-16 offline-gib-assets
// task 2).
//
// Task 1's generator writes a small `manifest.json` plus, per archetype, a
// `<archetype>.gib.json` document and a `<archetype>.gib.bin` payload. This
// module reads exactly that: manifest → entry → decode → validate → a set of
// per-piece decoded channels. It NEVER builds the carve library and never
// extracts a mesh — the whole point of the offline set is that boot pays a
// fetch + a few typed-array views, not surface nets.
//
// FAILURE IS A VALUE, NOT AN EXCEPTION AT THE CALL SITE. Missing, stale,
// malformed and schema-mismatched assets are all reported as a typed
// `GibAssetLoadError` with a machine-readable `reason`, so the renderer can
// fall back to the marched pieces and COUNT why. A body must never be left
// with no gore because an optional asset was absent.
//
// NO THREE, NO DOM. The fetch function is injected, so node tests can read the
// committed files from disk and the browser passes `window.fetch`.
import {
  decodeGibAssetPiece, validateGibAssetManifest, validateGibAssetPiece,
  GIB_ASSET_KIND, GIB_ASSET_SCHEMA_VERSION,
  type DecodedGibPiece, type GibAssetArchetype, type GibAssetManifest,
  type GibAssetPiece,
} from './gib-asset';

/** Where the committed files live, relative to the served root (Vite serves
 *  `public/` at `/`, so this is `/assets/lab/gibs` at runtime). */
export const GIB_ASSET_BASE_URL = 'assets/lab/gibs';

/** The minimal fetch shape this module needs; `window.fetch` satisfies it and a
 *  node test passes a `readFile`-backed fake. */
export interface GibAssetFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type GibAssetFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<GibAssetFetchResponse>;

/** Why a set could not be used — the fallback counter's key. */
export type GibAssetFallbackReason =
  | 'no-manifest'
  | 'no-entry'
  | 'schema'
  | 'stale'
  | 'malformed'
  | 'aborted'
  | 'fetch-failed';

export class GibAssetLoadError extends Error {
  readonly reason: GibAssetFallbackReason;
  readonly archetype: string;
  constructor(reason: GibAssetFallbackReason, archetype: string, message: string) {
    super(message);
    this.name = 'GibAssetLoadError';
    this.reason = reason;
    this.archetype = archetype;
  }
}

export interface GibAssetLoadedPiece {
  doc: GibAssetPiece;
  decoded: DecodedGibPiece;
}

export interface GibAssetLoadedSet {
  archetype: string;
  fingerprint: string;
  doc: GibAssetArchetype;
  bin: Uint8Array;
  pieces: GibAssetLoadedPiece[];
  byPart: Map<string, GibAssetLoadedPiece>;
  bytes: { json: number; bin: number };
  /** ISO build time from the manifest — diagnostics only. */
  builtAt: string;
}

export interface LoadGibAssetOptions {
  baseUrl?: string;
  fetchImpl?: GibAssetFetch;
  signal?: AbortSignal;
}

function base(opts: LoadGibAssetOptions): string {
  const b = opts.baseUrl ?? GIB_ASSET_BASE_URL;
  return b.endsWith('/') ? b.slice(0, -1) : b;
}

function fetchImpl(opts: LoadGibAssetOptions): GibAssetFetch {
  const f = opts.fetchImpl ?? (globalThis as { fetch?: GibAssetFetch }).fetch;
  if (!f) {
    throw new GibAssetLoadError('fetch-failed', '*', 'no fetch implementation available');
  }
  return f;
}

function abortError(archetype: string): GibAssetLoadError {
  return new GibAssetLoadError('aborted', archetype, 'asset load aborted');
}

function throwIfAborted(signal: AbortSignal | undefined, archetype: string): void {
  if (signal?.aborted) throw abortError(archetype);
}

// ---------------------------------------------------------------------------
// Manifest cache
// ---------------------------------------------------------------------------

let manifestCache: GibAssetManifest | null = null;
let manifestCacheKey = '';
let manifestPromise: Promise<GibAssetManifest> | null = null;
let loadGeneration = 0;

/** Drop every cached manifest and increment the generation so an in-flight load
 *  cannot install its result after a reset/dispose. */
export function resetGibAssetCache(): void {
  loadGeneration++;
  manifestCache = null;
  manifestCacheKey = '';
  manifestPromise = null;
}

export function gibAssetCacheKey(opts: LoadGibAssetOptions = {}): string {
  return base(opts);
}

export async function loadGibAssetManifest(opts: LoadGibAssetOptions = {}): Promise<GibAssetManifest> {
  const key = gibAssetCacheKey(opts);
  if (manifestCache && manifestCacheKey === key) return manifestCache;
  if (manifestPromise && manifestCacheKey === key) return manifestPromise;
  const url = `${base(opts)}/manifest.json`;
  manifestCacheKey = key;
  const p = (async () => {
    const gen = loadGeneration;
    let res: GibAssetFetchResponse;
    try {
      res = await fetchImpl(opts)(url, { signal: opts.signal });
    } catch (err) {
      if (opts.signal?.aborted) throw abortError('*');
      throw new GibAssetLoadError('fetch-failed', '*', `manifest fetch failed: ${String(err)}`);
    }
    if (!res.ok) {
      throw new GibAssetLoadError(res.status === 404 ? 'no-manifest' : 'fetch-failed', '*',
        `manifest ${url} -> HTTP ${res.status}`);
    }
    let json: unknown;
    try { json = await res.json(); } catch (err) {
      throw new GibAssetLoadError('malformed', '*', `manifest json unreadable: ${String(err)}`);
    }
    const manifest = json as GibAssetManifest;
    const shape = validateGibAssetManifest(manifest);
    if (!shape.ok) {
      throw new GibAssetLoadError('schema', '*', `manifest invalid: ${shape.errors.join('; ')}`);
    }
    if (gen !== loadGeneration) throw abortError('*');
    manifestCache = manifest;
    return manifest;
  })();
  manifestPromise = p;
  try {
    return await p;
  } finally {
    if (manifestPromise === p) manifestPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Archetype loader
// ---------------------------------------------------------------------------

/**
 * Load and validate one archetype. Throws `GibAssetLoadError` on any failure;
 * callers convert that into a fallback, never into a missing body.
 */
export async function loadGibAssetSet(
  archetype: string, opts: LoadGibAssetOptions = {},
): Promise<GibAssetLoadedSet> {
  throwIfAborted(opts.signal, archetype);
  const gen = loadGeneration;
  const assertCurrent = (): void => {
    if (gen !== loadGeneration) throw abortError(archetype);
  };
  const manifest = await loadGibAssetManifest(opts);
  assertCurrent();
  throwIfAborted(opts.signal, archetype);
  const entry = manifest.assets.find(a => a.archetype === archetype);
  if (!entry) {
    throw new GibAssetLoadError('no-entry', archetype, `'${archetype}' is not in the manifest`);
  }
  const dir = base(opts);
  let doc: GibAssetArchetype;
  let bin: Uint8Array;
  try {
    const [jsonRes, binRes] = await Promise.all([
      fetchImpl(opts)(`${dir}/${entry.json}`, { signal: opts.signal }),
      fetchImpl(opts)(`${dir}/${entry.bin}`, { signal: opts.signal }),
    ]);
    if (!jsonRes.ok || !binRes.ok) {
      throw new GibAssetLoadError('fetch-failed', archetype,
        `asset files -> HTTP ${jsonRes.status}/${binRes.status}`);
    }
    doc = (await jsonRes.json()) as GibAssetArchetype;
    bin = new Uint8Array(await binRes.arrayBuffer());
  } catch (err) {
    if (err instanceof GibAssetLoadError) throw err;
    if (opts.signal?.aborted) throw abortError(archetype);
    throw new GibAssetLoadError('fetch-failed', archetype, `asset fetch failed: ${String(err)}`);
  }
  assertCurrent();
  throwIfAborted(opts.signal, archetype);

  // ---- staleness / provenance checks -------------------------------------
  if (doc.kind !== GIB_ASSET_KIND) {
    throw new GibAssetLoadError('schema', archetype, `doc kind '${doc.kind}' is not '${GIB_ASSET_KIND}'`);
  }
  if (doc.schemaVersion !== GIB_ASSET_SCHEMA_VERSION || manifest.schemaVersion !== GIB_ASSET_SCHEMA_VERSION) {
    throw new GibAssetLoadError('schema', archetype,
      `schema ${doc.schemaVersion}/${manifest.schemaVersion} ≠ ${GIB_ASSET_SCHEMA_VERSION}`);
  }
  if (doc.archetype !== archetype) {
    throw new GibAssetLoadError('schema', archetype, `doc archetype '${doc.archetype}' ≠ '${archetype}'`);
  }
  // A manifest/doc fingerprint disagreement means the two files were written by
  // different generator runs — the same class of staleness as a changed source.
  if (doc.fingerprint !== entry.fingerprint) {
    throw new GibAssetLoadError('stale', archetype,
      `doc fingerprint ${doc.fingerprint} ≠ manifest ${entry.fingerprint}`);
  }
  if (bin.byteLength !== entry.bytes.bin || doc.totals.binBytes !== bin.byteLength) {
    throw new GibAssetLoadError('stale', archetype,
      `bin size ${bin.byteLength} ≠ manifest ${entry.bytes.bin}/doc ${doc.totals.binBytes}`);
  }
  if (doc.pieces.length !== entry.totals.pieces || doc.pieces.length === 0) {
    throw new GibAssetLoadError('malformed', archetype,
      `piece count ${doc.pieces.length} ≠ manifest ${entry.totals.pieces}`);
  }

  // ---- decode + numeric validation, every piece ---------------------------
  const pieces: GibAssetLoadedPiece[] = [];
  const byPart = new Map<string, GibAssetLoadedPiece>();
  let verts = 0, tris = 0;
  for (const piece of doc.pieces) {
    let decoded: DecodedGibPiece;
    try {
      decoded = decodeGibAssetPiece(piece, bin);
    } catch (err) {
      throw new GibAssetLoadError('malformed', archetype, `${piece.part}: ${String(err)}`);
    }
    const v = validateGibAssetPiece(piece, decoded, bin.byteLength);
    if (!v.ok) {
      throw new GibAssetLoadError('malformed', archetype, v.errors.join('; '));
    }
    verts += piece.verts;
    tris += piece.tris;
    const loaded: GibAssetLoadedPiece = { doc: piece, decoded };
    pieces.push(loaded);
    byPart.set(piece.part, loaded);
  }
  if (verts !== doc.totals.verts || tris !== doc.totals.tris) {
    throw new GibAssetLoadError('stale', archetype,
      `decoded verts/tris ${verts}/${tris} ≠ doc ${doc.totals.verts}/${doc.totals.tris}`);
  }

  return {
    archetype, fingerprint: doc.fingerprint, doc, bin, pieces, byPart,
    bytes: { json: entry.bytes.json, bin: entry.bytes.bin },
    builtAt: manifest.builtAt,
  };
}
