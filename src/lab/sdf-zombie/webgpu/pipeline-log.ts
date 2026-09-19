// src/lab/sdf-zombie/webgpu/pipeline-log.ts
//
// PIPELINE-CREATION LOG (startup-hitch attribution, 2026-09-14; corrected
// 2026-09-16 after reviewer review of the first attribution pass).
//
// The boot warm-up (`warmPipelines` in game-main.ts) compiles the render
// pipelines it can see, but the owner still hits 2+ s frames at startup and on
// room entries / blasts. Attributing one needs to know WHICH pipelines were
// created (and when) — three creates them wherever the first draw or dispatch
// happens, mid-frame if that is where the draw is.
//
// HOW IT WORKS. WebGPUDevice.createRenderPipeline / createComputePipeline
// (+ their Async variants) are THE choke point: every path — three's sync
// mid-frame compile, compileAsync's async compile, compute dispatches — ends
// in one of these four. The descriptor's `label` names the pipeline. We wrap
// the four device methods as soon as the device exists and record
// {kind, name, ms, frame} per creation; the lab-renderer loop reports each
// presented frame's wall ms (noteFrameEnd) and any frame over LONG_FRAME_MS
// keeps the creations that overlapped it.
//
// ---------------------------------------------------------------------------
// WHY "BYTE-IDENTICAL DESCRIPTORS" WAS AN OVERCLAIM (do not repeat it)
// ---------------------------------------------------------------------------
// The first pass compared creations with a `descriptorSignature` that named
// only topology/cull/frontFace, a few depth/stencil scalars, multisample
// count, colour-target FORMATS and the entry points. It deliberately (and
// wrongly) omitted:
//
//   * the shader modules themselves (source code / module identity);
//   * the pipeline-layout descriptor (bind-group layouts);
//   * vertex buffer layouts (arrayStride/stepMode/attribute formats);
//   * blend state and colour write masks (whole `targets[].blend`);
//   * stencil ops, depth-bias/clamp, alphaToCoverage, unclippedDepth.
//
// Two creations can therefore have matched that signature while being
// genuinely DIFFERENT GPU pipelines, so "the same 8 pipelines rebuilt 12×"
// was not established. The detector is now full-fidelity:
//
//   1. `descriptorSignature()` covers the complete descriptor, substituting
//      a content hash for each shader module (wrapped `createShaderModule`)
//      and for the pipeline layout (child bind-group-layout content hashes,
//      from wrapped `createBindGroupLayout` → `createPipelineLayout`).
//   2. The AUTHORITATIVE identity is three's own render cache key
//      (`stageVertex.id,stageFragment.id,backend.getRenderCacheKey`), captured
//      by wrapping `backend.createRenderPipeline(renderObject)` and reading
//      `renderObject.pipeline.cacheKey`. Same label + same three key created
//      more than once IS the same pipeline built twice.
//   3. Cache EVICTION is recorded, not inferred: `Pipelines.delete()` and
//      `_releasePipeline()` are wrapped, so a rebuild can be tied to the
//      preceding release (and to the object whose teardown released it).
//
// Frame numbers are this module's own counter of COMPLETED presented frames —
// during the boot warm-up the loop is paused, so warm-time creations all carry
// the frame in flight when it paused (the probe distinguishes them by the
// `__warmDone` boundary, not by frame number).
//
// COST. The wraps are installed ALWAYS for the scalar counters, but the
// per-creation arrays, shader-module hashing and the descriptor signature are
// only computed while enabled (`?pipelinelog=1` / `__sdfGame.setPipelineLog`).
// Disabled, the cost is a closure hop per pipeline creation (a first-use-only
// event) plus an integer add per frame and per renderer.compute() call.

import type * as THREE from 'three/webgpu';

/** Frames at or above this wall ms are recorded with their pipelines. */
export const LONG_FRAME_MS = 100;

// ---------------------------------------------------------------------------
// Content hashing (bounded, dependency-free). Two independent 32-bit mixes
// plus the input length — enough to separate shader sources / layout
// descriptors confidently while staying allocation-light.
// ---------------------------------------------------------------------------

/** Stable content hash: `<fnv1a32><mix32>:<length>`, e.g. `1a2b3c4d5e6f7080:1234`. */
export function hashText(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
    b ^= b >>> 13;
  }
  return ((a >>> 0).toString(16).padStart(8, '0'))
    + ((b >>> 0).toString(16).padStart(8, '0'))
    + ':' + s.length;
}

// ---------------------------------------------------------------------------
// WGSL fingerprint (pure; exported for tests).
//
// COMPILE CENSUS (2026-09-19). Two march variants can share every descriptor
// field the signature covers (same targets, blend, depth state, vertex
// buffers) and still be different, very large Metal compiles. The byte length
// alone says "big"; it does not say WHAT the variant is. The fingerprint pulls
// three cheap, structural facts out of the generated WGSL at shader-module
// creation — before the GPU ever sees it — so the census can say "this module
// carries marchBody + the whole trace include list, 243 KB" instead of only
// "243 KB":
//
//   * `fns`      the `fn <name>` declarations, i.e. effectively the wgslFn
//                INCLUDE LIST a variant was built with. Which march entry
//                (marchBody / refineBody / sdfSurfaceMarch / coneMarch /
//                depthPrepassMarch) is how the Node-side analysis classifies a
//                variant as march-family, and diffing two fns sets is the
//                include-list diff.
//   * `structs`  the `struct <Name>` declarations (G-buffer / surface structs).
//   * `bindings` / `locations`  counts of `@binding(` / `@location(` — the
//                uniform/binding surface and the varyings, which is what the
//                TSL node graph changes between two otherwise-identical
//                marchers.
//
// BOUNDED: names are sorted, deduped and capped at `maxNames` each; the counts
// stay exact. Pure string work — no three, no device — so it is directly
// portable to the Rust + wgpu port's census.
// ---------------------------------------------------------------------------

/** Structural fingerprint of one WGSL shader module source. */
export interface WgslFingerprint {
  /** code.length — UTF-16 units, same as the WGSL byte count for ASCII WGSL. */
  bytes: number;
  /** Sorted, deduped `fn` names (capped at the caller's maxNames). */
  fns: string[];
  /** Exact `fn` declaration count, even when `fns` is capped. */
  fnCount: number;
  /** Sorted, deduped `struct` names (capped). */
  structs: string[];
  /** Exact `struct` declaration count. */
  structCount: number;
  /** `@binding(` occurrences. */
  bindings: number;
  /** `@location(` occurrences. */
  locations: number;
}

const FN_DECL = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const STRUCT_DECL = /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
const BINDING_DECL = /@binding\s*\(/g;
const LOCATION_DECL = /@location\s*\(/g;

function collectNames(re: RegExp, code: string): { names: string[]; count: number } {
  const set = new Set<string>();
  let count = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    count++;
    if (m[1]) set.add(m[1]);
  }
  return { names: [...set].sort(), count };
}

function countMatches(re: RegExp, code: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(code) !== null) n++;
  return n;
}

/** Structural fingerprint of one WGSL module source. `maxNames` bounds each
 *  name list (the counts stay exact). Pure and deterministic. */
export function wgslFingerprint(code: string, maxNames = 240): WgslFingerprint {
  const fn = collectNames(FN_DECL, code);
  const st = collectNames(STRUCT_DECL, code);
  return {
    bytes: code.length,
    fns: fn.names.slice(0, maxNames),
    fnCount: fn.count,
    structs: st.names.slice(0, maxNames),
    structCount: st.count,
    bindings: countMatches(BINDING_DECL, code),
    locations: countMatches(LOCATION_DECL, code),
  };
}

// ---------------------------------------------------------------------------
// Full-fidelity descriptor signature (pure; exported for tests).
// ---------------------------------------------------------------------------

/** `GPUShaderModule` object → content hash, filled by the createShaderModule
 *  wrap. A WeakMap so nothing is retained that the device would otherwise
 *  collect. */
export type ShaderModuleHashes = WeakMap<object, string>;
/** `GPUBindGroupLayout` object → content hash. */
export type LayoutHashes = WeakMap<object, string>;
/** `GPUPipelineLayout` object → joined child-layout hash. */
export type PipelineLayoutHashes = WeakMap<object, string>;

function hashOf(map: WeakMap<object, string> | undefined, obj: unknown): string {
  if (!map || obj === null || typeof obj !== 'object') return '-';
  return map.get(obj as object) ?? '?';
}

/** `GPUVertexBufferLayout[]` → compact structural signature. */
export function vertexBuffersSignature(buffers: unknown): string {
  if (!Array.isArray(buffers) || buffers.length === 0) return 'none';
  return buffers.map((b) => {
    const l = b as { arrayStride?: number; stepMode?: string; attributes?: unknown[] };
    const attrs = (l.attributes ?? []).map((a) => {
      const t = a as { shaderLocation?: number; offset?: number; format?: string };
      return `${t.shaderLocation ?? '?'}/${t.offset ?? 0}/${t.format ?? '?'}`;
    }).join('+');
    return `${l.arrayStride ?? '?'}${l.stepMode === 'instance' ? 'i' : 'v'}[${attrs}]`;
  }).join(';');
}

/** Fragment targets (format + full blend state + write mask) → signature. */
export function targetsSignature(targets: unknown): string {
  if (!Array.isArray(targets)) return 'none';
  return targets.map((t) => {
    const tg = t as {
      format?: string;
      writeMask?: number;
      blend?: {
        color?: { srcFactor?: string; dstFactor?: string; operation?: string };
        alpha?: { srcFactor?: string; dstFactor?: string; operation?: string };
      } | null;
    };
    const b = tg.blend;
    const bs = b
      ? `c:${b.color?.operation ?? '?'},${b.color?.srcFactor ?? '?'},${b.color?.dstFactor ?? '?'}`
        + `|a:${b.alpha?.operation ?? '?'},${b.alpha?.srcFactor ?? '?'},${b.alpha?.dstFactor ?? '?'}`
      : 'noblend';
    return `${tg.format ?? '?'}/${bs}/w${tg.writeMask ?? 0}`;
  }).join(';');
}

/** Primitive state → signature. */
export function primitiveSignature(p: unknown): string {
  const s = (p ?? {}) as {
    topology?: string; stripIndexFormat?: string; cullMode?: string;
    frontFace?: string; unclippedDepth?: boolean;
  };
  return [s.topology, s.stripIndexFormat, s.cullMode, s.frontFace, s.unclippedDepth].join('/');
}

/** Depth/stencil state → signature (stencil ops included — the old signature
 *  omitted them entirely). */
export function depthStencilSignature(ds: unknown): string {
  if (!ds) return 'none';
  const d = ds as {
    format?: string; depthWriteEnabled?: boolean; depthCompare?: string;
    depthBias?: number; depthBiasSlopeScale?: number; depthBiasClamp?: number;
    stencilFront?: Record<string, unknown>; stencilBack?: Record<string, unknown>;
    stencilReadMask?: number; stencilWriteMask?: number;
  };
  const face = (f: Record<string, unknown> | undefined) => f
    ? `${f.compare ?? '?'}/${f.failOp ?? '?'}/${f.depthFailOp ?? '?'}/${f.passOp ?? '?'}`
    : '-';
  return [
    d.format, d.depthWriteEnabled, d.depthCompare,
    d.depthBias ?? 0, d.depthBiasSlopeScale ?? 0, d.depthBiasClamp ?? 0,
    `F${face(d.stencilFront)}`, `B${face(d.stencilBack)}`,
    d.stencilReadMask ?? 0, d.stencilWriteMask ?? 0,
  ].join('/');
}

/** Multisample state → signature. */
export function multisampleSignature(ms: unknown): string {
  const m = (ms ?? {}) as { count?: number; alphaToCoverageEnabled?: boolean };
  return `${m.count ?? 1}${m.alphaToCoverageEnabled ? 'a' : ''}`;
}

/**
 * Full structural signature of a `GPURenderPipelineDescriptor` /
 * `GPUComputePipelineDescriptor`. Unlike the pre-2026-09-16 version this
 * includes the SHADER MODULE CONTENT (hash), the pipeline layout (child
 * layout content hashes), vertex buffers, the complete blend/write-mask
 * targets, stencil ops, depth bias and alpha-to-coverage. Two creations with
 * the same signature are the same GPU pipeline; a legitimate light-count /
 * shadow / render-target variant changes a shader-module hash, a target
 * format or the sample count and is therefore NOT misclassified.
 */
export function pipelineDescriptorSignature(
  desc: unknown,
  moduleHashes?: ShaderModuleHashes,
  layoutHashes?: PipelineLayoutHashes,
): string {
  const d = desc as {
    label?: string;
    primitive?: unknown;
    depthStencil?: unknown;
    multisample?: unknown;
    layout?: unknown;
    vertex?: { entryPoint?: string; module?: unknown; buffers?: unknown };
    fragment?: { entryPoint?: string; module?: unknown; targets?: unknown } | null;
    compute?: { entryPoint?: string; module?: unknown; constants?: Record<string, number> };
  } | undefined;
  if (!d) return 'none';
  const vHash = hashOf(moduleHashes, d.vertex?.module);
  const fHash = hashOf(moduleHashes, d.fragment?.module);
  const cHash = hashOf(moduleHashes, d.compute?.module);
  const layout = hashOf(layoutHashes, d.layout);
  const constants = d.compute?.constants
    ? Object.keys(d.compute.constants).sort().map((k) => `${k}=${d.compute!.constants![k]}`).join(',')
    : '';
  return [
    `V:${d.vertex?.entryPoint}@${vHash}`,
    `F:${d.fragment?.entryPoint}@${fHash}`,
    `C:${d.compute?.entryPoint}@${cHash}${constants ? `(${constants})` : ''}`,
    `L:${layout}`,
    `VB:${vertexBuffersSignature(d.vertex?.buffers)}`,
    `T:${targetsSignature(d.fragment?.targets)}`,
    `P:${primitiveSignature(d.primitive)}`,
    `M:${multisampleSignature(d.multisample)}`,
    `D:${depthStencilSignature(d.depthStencil)}`,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface PipelineCreationRecord {
  kind: 'render' | 'compute';
  /** three's descriptor label, e.g. `renderPipeline_MarchNodeMaterial_42`. */
  name: string;
  /** Wall ms from call to (async:) settle. */
  ms: number;
  /** The frame in flight when creation STARTED (see module comment). */
  frame: number;
  /** performance.now() at creation START — what noteFrameEnd partitions on. */
  t: number;
  /** performance.now() when the creation settled (ready). `ms === endT - t`
   *  modulo the two clock reads. With this, overlapping async compiles can be
   *  turned into real wall coverage instead of a naive ms sum. */
  endT: number;
  /** True when created through the Async entry (compileAsync path). */
  async: boolean;
  /** For async creations: the renderer.compileAsync() session that was open
   *  when the creation was dispatched, as `compile#<n>@f<frame>`. */
  via: string;
  /** FULL descriptor signature — see pipelineDescriptorSignature(). */
  sig: string;
  /** three.js's own render-pipeline cache key
   *  (`stageVertex.id,stageFragment.id,backend.getRenderCacheKey(renderObject)`),
   *  captured from the wrapper around `backend.createRenderPipeline`. Empty
   *  for compute / when the backend hook is unavailable. This is the
   *  authoritative "same pipeline" identity. */
  threeKey: string;
  /** Identity of the render object the creation was for (from the backend
   *  hook). Empty for compute. */
  material: string;
  objectType: string;
  objectName: string;
  geometryKey: string;
  /** Content hashes of the two shader modules, when enabled. */
  vertexShaderHash: string;
  fragmentShaderHash: string;
  /** WGSL byte length of each module (compile-census, 2026-09-19). 0 when the
   *  module was created before the log was enabled. */
  vertexShaderBytes: number;
  fragmentShaderBytes: number;
  computeShaderBytes: number;
}

export interface CacheEvictionRecord {
  /** three cache key of the pipeline that was released. */
  key: string;
  name: string;
  frame: number;
  t: number;
  /** Why/who: `delete` carries the teardown's object identity. */
  via: 'delete' | 'release';
  objectType: string;
  objectName: string;
  material: string;
}

export interface LongFrameRecord {
  frame: number;
  /** Wall ms of the presented frame (tick callback + draw). */
  ms: number;
  t0: number;
  t1: number;
  /** Pipeline creations that STARTED during this frame. */
  pipelines: PipelineCreationRecord[];
}

export interface ShaderModuleStat {
  hash: string;
  count: number;
  /** Label of the ProgrammableStage when the module was created. */
  label: string;
  /** Structural WGSL fingerprint (bytes, include list, bindings). */
  fingerprint: WgslFingerprint;
}

export interface PipelineLogSummary {
  installed: boolean;
  enabled: boolean;
  frames: LongFrameRecord[];
  totalPipelines: number;
  totalCompileMs: number;
  slowest: PipelineCreationRecord[];
  compute: {
    total: number;
    maxPerFrame: number;
    byFrame: { frame: number; calls: number }[];
  };
  /** AUTHORITATIVE thrash detector: the same three.js render-cache key created
   *  more than once. `releases` lists the evictions of that key that happened
   *  before the last rebuild — the causal path, not a coincidence. */
  rebuilds: {
    key: string;
    name: string;
    count: number;
    firstFrame: number;
    lastFrame: number;
    /** Distinct (material, objectType) pairs seen for this key. */
    objects: string[];
    releases: CacheEvictionRecord[];
  }[];
  /** Descriptor-identical creations (full signature) regardless of whether
   *  three's own key moved. Catches descriptor-identical rebuilds whose key
   *  changed because a geometry/context component moved. `distinctThreeKeys`
   *  > 1 means three considered them different pipelines. */
  descriptorGroups: {
    sig: string;
    name: string;
    count: number;
    distinctThreeKeys: number;
    firstFrame: number;
    lastFrame: number;
  }[];
  /** Shader-module creation census: a repeated hash means the same source was
   *  compiled into a fresh module again. */
  shaderModules: {
    created: number;
    totalBytes: number;
    distinct: number;
    repeated: ShaderModuleStat[];
  };
  /** Cache evictions (three releasing a pipeline) with the object that caused
   *  it where known. */
  evictions: {
    total: number;
    byObject: { object: string; count: number }[];
    events: CacheEvictionRecord[];
  };
}

/**
 * The `__sdfGame.pipelineCensus()` payload (compile census, 2026-09-19).
 *
 * Deliberately SEPARATE from `pipelineLog()`: that one is a long-frame hitch
 * detector and only keeps the slowest 16 creations plus aggregates, which is
 * the wrong shape for "where did 80 s of boot compile go". This carries EVERY
 * creation with its start/end timestamps, module byte lengths and three key,
 * plus the shader-module fingerprint census. Plain data, JSON-serialisable;
 * only populated while `?pipelinelog=1` is on.
 */
export interface PipelineCensus {
  installed: boolean;
  enabled: boolean;
  /** Creations recorded (bounded — see MAX_CENSUS). */
  count: number;
  /** Naive sum of every creation's ms. Async creations overlap, so this is an
   *  upper bound on wall time; use `entries[].t/endT` for real coverage. */
  totalMs: number;
  /** Every creation, in completion order. */
  entries: PipelineCreationRecord[];
  /** Distinct shader modules created, with their WGSL fingerprints. */
  modules: ShaderModuleStat[];
  /** Shader modules created BEFORE the log was enabled (fingerprint absent). */
  modulesCreatedWhileDisabled: number;
  /** Distinct module sources retained for WGSL diffing (bounded by bytes). */
  sourcesRetained: number;
  /** Sources dropped because the byte cap was reached. */
  sourcesDropped: number;
}

/** Shorten labels but keep the material/stage name readable. */
function cleanLabel(label: unknown): string {
  const s = typeof label === 'string' && label.length > 0 ? label : '<unlabeled>';
  return s.length > 160 ? s.slice(0, 157) + '...' : s;
}

/** Describe a render object for the eviction/creation records. */
function objectLabel(obj: unknown): { type: string; name: string } {
  const o = obj as { type?: string; name?: string } | null | undefined;
  return { type: o?.type ?? '', name: (o?.name ?? '').slice(0, 60) };
}

// ---------------------------------------------------------------------------
// Module state (one renderer per page; the lab is single-renderer)
// ---------------------------------------------------------------------------
let installed = false;
let enabled = false;
let frameNo = 0; // COMPLETED frames; the frame in flight is frameNo + 1
let totalPipelines = 0;
let totalCompileMs = 0;
let inFlight: PipelineCreationRecord[] = [];
const longFrames: LongFrameRecord[] = [];
const MAX_LONG_FRAMES = 500;
const slowest: PipelineCreationRecord[] = [];
const SLOWEST_KEEP = 16;
let computeCallsThisFrame = 0;
let computeTotal = 0;
let computeMaxPerFrame = 0;
const computeByFrame: { frame: number; calls: number }[] = [];
const MAX_COMPUTE_FRAMES = 4000;
let activeCompile: string | null = null;
let compileSession = 0;

// Shader-module + layout content hashes (WeakMaps: no retention).
const shaderModuleHashes: ShaderModuleHashes = new WeakMap();
const bindGroupLayoutHashes: LayoutHashes = new WeakMap();
const pipelineLayoutHashes: PipelineLayoutHashes = new WeakMap();
// Shader-module WGSL byte length, keyed on the returned module (compile census).
const shaderModuleByteMap: WeakMap<object, number> = new WeakMap();
// Shader-module source, keyed on its content hash (compile census). Bounded by
// total bytes — the march fragment modules alone are ~7.5 MB across ~31 near-
// identical variants, and the census needs to be able to DIFF them to say what
// makes a variant a variant. Only filled while enabled.
const shaderModuleSourceByHash = new Map<string, string>();
let shaderModuleSourceBytes = 0;
let shaderModuleSourcesDropped = 0;
const MAX_SOURCE_BYTES = 48 * 1024 * 1024;
// Shader-module census (bounded).
const shaderModuleCensus = new Map<string, ShaderModuleStat>();
let shaderModulesCreated = 0;
let shaderModuleBytes = 0;
let shaderModulesDisabled = 0;
const MAX_SHADER_CENSUS = 3000;

// Per-creation census for the compile-time probe (bounded; enabled only).
const censusEntries: PipelineCreationRecord[] = [];
const MAX_CENSUS = 4000;

// three's render-cache-key census: the authoritative rebuild detector.
const rebuildCensus = new Map<string, {
  name: string; count: number; firstFrame: number; lastFrame: number; objects: Set<string>;
}>();
const MAX_REBUILD_CENSUS = 4000;
// Full-descriptor census: catches descriptor-identical rebuilds whose three
// key moved. Bounded separately (signatures are long).
const descriptorCensus = new Map<string, {
  sig: string; name: string; count: number; keys: Set<string>; firstFrame: number; lastFrame: number;
}>();
const MAX_DESCRIPTOR_CENSUS = 2000;

// Evictions (bounded ring) + per-object census.
const evictionEvents: CacheEvictionRecord[] = [];
const MAX_EVICTION_EVENTS = 600;
let evictionTotal = 0;
const evictionByObject = new Map<string, number>();
const MAX_EVICTION_OBJECTS = 500;

// The render object currently being compiled, set by the backend hook around
// the synchronous device call.
let currentRender: {
  threeKey: string; material: string; objectType: string; objectName: string; geometryKey: string;
} | null = null;
// True while Pipelines.delete() runs, so the _releasePipeline hook it calls
// does not record the same eviction twice.
let inDelete = false;

/** Enable/disable per-creation recording, shader hashing and signatures.
 *  Counters and the eviction ring run regardless. */
export function setPipelineLogEnabled(on: boolean): void {
  enabled = on;
}

export function pipelineLogEnabled(): boolean {
  return enabled;
}

function recordEviction(key: string, via: 'delete' | 'release', obj?: unknown, material?: string): void {
  evictionTotal++;
  const o = objectLabel(obj);
  const label = o.type + (o.name ? `:${o.name}` : '');
  evictionByObject.set(label, (evictionByObject.get(label) ?? 0) + 1);
  if (evictionByObject.size > MAX_EVICTION_OBJECTS) {
    const first = evictionByObject.keys().next().value;
    if (first !== undefined) evictionByObject.delete(first);
  }
  if (!enabled) return;
  evictionEvents.push({
    key, name: key, frame: frameNo + 1, t: Math.round(performance.now() * 10) / 10,
    via, objectType: o.type, objectName: o.name, material: material ?? '',
  });
  if (evictionEvents.length > MAX_EVICTION_EVENTS) evictionEvents.shift();
}

/**
 * Wrap the backend device's pipeline-creation methods, the shader-module and
 * layout creators, and three's pipeline cache release paths. Call once, right
 * after createLabRenderer resolves (the device exists only after init).
 * Idempotent; returns installed.
 */
export function installPipelineLog(renderer: THREE.WebGPURenderer): boolean {
  if (installed) return true;
  const r = renderer as unknown as {
    backend?: { device?: Record<string, unknown>; createRenderPipeline?: (...a: unknown[]) => unknown };
    _pipelines?: {
      delete?: (o: unknown) => unknown;
      _releasePipeline?: (p: unknown) => unknown;
    };
  };
  const backend = r.backend;
  const device = backend?.device;
  if (!device) return false;

  // --- shader modules: content hash keyed on the returned module ----------
  const origCreateShaderModule = device.createShaderModule;
  if (typeof origCreateShaderModule === 'function') {
    device.createShaderModule = function (this: unknown, ...args: unknown[]) {
      const result = (origCreateShaderModule as (...a: unknown[]) => unknown).apply(this, args);
      const desc = args[0] as { label?: string; code?: string } | undefined;
      const code = typeof desc?.code === 'string' ? desc.code : '';
      if (result && typeof result === 'object') shaderModuleByteMap.set(result as object, code.length);
      if (enabled) {
        const hash = hashText(code);
        if (result && typeof result === 'object') shaderModuleHashes.set(result as object, hash);
        shaderModulesCreated++;
        shaderModuleBytes += code.length;
        const label = cleanLabel(desc?.label);
        const entry = shaderModuleCensus.get(hash);
        if (entry) entry.count++;
        else if (shaderModuleCensus.size < MAX_SHADER_CENSUS) {
          shaderModuleCensus.set(hash, { hash, count: 1, label, fingerprint: wgslFingerprint(code) });
        }
        if (!shaderModuleSourceByHash.has(hash)) {
          if (shaderModuleSourceBytes + code.length <= MAX_SOURCE_BYTES) {
            shaderModuleSourceByHash.set(hash, code);
            shaderModuleSourceBytes += code.length;
          } else {
            shaderModuleSourcesDropped++;
          }
        }
      } else {
        shaderModulesDisabled++;
      }
      return result;
    };
  }

  // --- bind-group layouts: content hash keyed on the returned layout -------
  const origCreateBindGroupLayout = device.createBindGroupLayout;
  if (typeof origCreateBindGroupLayout === 'function') {
    device.createBindGroupLayout = function (this: unknown, ...args: unknown[]) {
      const result = (origCreateBindGroupLayout as (...a: unknown[]) => unknown).apply(this, args);
      if (enabled && result && typeof result === 'object') {
        const desc = args[0] as { entries?: unknown } | undefined;
        bindGroupLayoutHashes.set(result as object, hashText(JSON.stringify(desc?.entries ?? null)));
      }
      return result;
    };
  }

  // --- pipeline layouts: join the child layout content hashes -------------
  const origCreatePipelineLayout = device.createPipelineLayout;
  if (typeof origCreatePipelineLayout === 'function') {
    device.createPipelineLayout = function (this: unknown, ...args: unknown[]) {
      const result = (origCreatePipelineLayout as (...a: unknown[]) => unknown).apply(this, args);
      if (enabled && result && typeof result === 'object') {
        const desc = args[0] as { bindGroupLayouts?: unknown[] } | undefined;
        const parts = (desc?.bindGroupLayouts ?? []).map((l) => hashOf(bindGroupLayoutHashes, l));
        pipelineLayoutHashes.set(result as object, hashText(parts.join(',')));
      }
      return result;
    };
  }

  // --- device pipeline creation: cost + full descriptor signature ---------
  const wrap = (key: string, kind: 'render' | 'compute', isAsync: boolean) => {
    const orig = device[key];
    if (typeof orig !== 'function') return;
    device[key] = function (this: unknown, ...args: unknown[]) {
      const t0 = performance.now();
      const frame = frameNo + 1;
      const desc = args[0] as { label?: string } | undefined;
      const result = (orig as (...a: unknown[]) => unknown).apply(this, args);
      const ctx = currentRender;
      const sig = enabled ? pipelineDescriptorSignature(desc, shaderModuleHashes, pipelineLayoutHashes) : '';
      const vHash = enabled && kind === 'render'
        ? hashOf(shaderModuleHashes, (desc as { vertex?: { module?: unknown } } | undefined)?.vertex?.module) : '';
      const fHash = enabled && kind === 'render'
        ? hashOf(shaderModuleHashes, (desc as { fragment?: { module?: unknown } } | undefined)?.fragment?.module) : '';
      const byteOf = (mod: unknown): number =>
        enabled && mod !== null && typeof mod === 'object'
          ? (shaderModuleByteMap.get(mod as object) ?? 0) : 0;
      const record: PipelineCreationRecord = {
        kind, name: cleanLabel(desc?.label), ms: 0, frame, t: t0, endT: t0, async: isAsync,
        via: isAsync ? (activeCompile ?? '<none>') : '', sig,
        threeKey: ctx?.threeKey ?? '',
        material: ctx?.material ?? '', objectType: ctx?.objectType ?? '',
        objectName: ctx?.objectName ?? '', geometryKey: ctx?.geometryKey ?? '',
        vertexShaderHash: vHash, fragmentShaderHash: fHash,
        vertexShaderBytes: byteOf((desc as { vertex?: { module?: unknown } } | undefined)?.vertex?.module),
        fragmentShaderBytes: byteOf((desc as { fragment?: { module?: unknown } } | undefined)?.fragment?.module),
        computeShaderBytes: byteOf((desc as { compute?: { module?: unknown } } | undefined)?.compute?.module),
      };
      const finish = () => {
        const t1 = performance.now();
        record.ms = t1 - t0;
        record.endT = t1;
        totalPipelines++;
        totalCompileMs += record.ms;
        // Authoritative census: three's own cache key.
        if (enabled && record.threeKey && kind === 'render') {
          const entry = rebuildCensus.get(record.threeKey);
          const objLabel = record.objectType + (record.objectName ? `:${record.objectName}` : '');
          if (entry) {
            entry.count++; entry.lastFrame = frame; entry.objects.add(objLabel);
          } else if (rebuildCensus.size < MAX_REBUILD_CENSUS) {
            rebuildCensus.set(record.threeKey, {
              name: record.name, count: 1, firstFrame: frame, lastFrame: frame, objects: new Set([objLabel]),
            });
          }
        }
        // Descriptor census (full signature).
        if (enabled && record.sig) {
          const dkey = record.name + '#' + hashText(record.sig);
          const entry = descriptorCensus.get(dkey);
          if (entry) {
            entry.count++; entry.lastFrame = frame; entry.keys.add(record.threeKey);
          } else if (descriptorCensus.size < MAX_DESCRIPTOR_CENSUS) {
            descriptorCensus.set(dkey, {
              sig: record.sig, name: record.name, count: 1, keys: new Set([record.threeKey]),
              firstFrame: frame, lastFrame: frame,
            });
          }
        }
        let i = 0;
        while (i < slowest.length && slowest[i]!.ms >= record.ms) i++;
        if (i < SLOWEST_KEEP) {
          slowest.splice(i, 0, record);
          if (slowest.length > SLOWEST_KEEP) slowest.pop();
        }
        if (enabled) inFlight.push(record);
        if (enabled) {
          censusEntries.push(record);
          if (censusEntries.length > MAX_CENSUS) censusEntries.shift();
        }
      };
      if (isAsync && result instanceof Promise) result.then(finish, finish);
      else finish();
      return result;
    };
  };
  wrap('createRenderPipeline', 'render', false);
  wrap('createRenderPipelineAsync', 'render', true);
  wrap('createComputePipeline', 'compute', false);
  wrap('createComputePipelineAsync', 'compute', true);

  // --- backend.createRenderPipeline: capture three's actual cache key -----
  // This is the outermost renderer-visible creation path; it is called with
  // the RenderObject whose `pipeline.cacheKey` three just computed. Setting
  // `currentRender` around it lets the device wrap above attach the key and
  // the object identity to the record.
  if (backend && typeof backend.createRenderPipeline === 'function') {
    const origBackendCreate = backend.createRenderPipeline;
    backend.createRenderPipeline = function (this: unknown, ...args: unknown[]) {
      const ro = args[0] as {
        pipeline?: { cacheKey?: string };
        material?: { name?: string; type?: string };
        object?: unknown;
        geometry?: unknown;
      } | undefined;
      const prev = currentRender;
      if (enabled && ro) {
        const o = objectLabel(ro.object);
        currentRender = {
          threeKey: ro.pipeline?.cacheKey ?? '',
          material: ro.material?.name || ro.material?.type || '',
          objectType: o.type,
          objectName: o.name,
          geometryKey: typeof (ro as { getGeometryCacheKey?: () => string }).getGeometryCacheKey === 'function'
            ? (ro as { getGeometryCacheKey: () => string }).getGeometryCacheKey().slice(0, 120)
            : '',
        };
      }
      try {
        return (origBackendCreate as (...a: unknown[]) => unknown).apply(this, args);
      } finally {
        currentRender = prev;
      }
    };
  }

  // --- three's pipeline cache release paths: record the evictions ---------
  // `renderer._pipelines` is private but stable in three r185; the hooks are
  // diagnostic and skip silently if the shape ever changes.
  const pipelines = r._pipelines;
  if (pipelines) {
    if (typeof pipelines.delete === 'function') {
      const origDelete = pipelines.delete;
      pipelines.delete = function (this: unknown, ...args: unknown[]) {
        const before = (this as { get?: (o: unknown) => { pipeline?: { cacheKey?: string; usedTimes?: number } } })
          .get?.(args[0]);
        const pipeline = before?.pipeline;
        inDelete = true;
        let result: unknown;
        try {
          result = (origDelete as (...a: unknown[]) => unknown).apply(this, args);
        } finally {
          inDelete = false;
        }
        if (pipeline && pipeline.usedTimes === 0) {
          const ro = args[0] as { material?: { name?: string; type?: string } } | undefined;
          recordEviction(pipeline.cacheKey ?? '', 'delete', (ro as { object?: unknown })?.object, ro?.material?.name || ro?.material?.type);
        }
        return result;
      };
    }
    if (typeof pipelines._releasePipeline === 'function') {
      const origRelease = pipelines._releasePipeline;
      pipelines._releasePipeline = function (this: unknown, ...args: unknown[]) {
        const p = args[0] as { cacheKey?: string } | undefined;
        if (p?.cacheKey && !inDelete) recordEviction(p.cacheKey, 'release');
        return (origRelease as (...a: unknown[]) => unknown).apply(this, args);
      };
    }
  }

  // --- compileAsync session naming ---------------------------------------
  const anyRenderer2 = renderer as unknown as Record<string, unknown>;
  const origCompileAsync = anyRenderer2.compileAsync;
  if (typeof origCompileAsync === 'function') {
    anyRenderer2.compileAsync = function (this: unknown, ...args: unknown[]) {
      const prev = activeCompile;
      compileSession++;
      activeCompile = `compile#${compileSession}@f${frameNo + 1}`;
      try {
        const ret = (origCompileAsync as (...a: unknown[]) => unknown).apply(this, args);
        if (ret instanceof Promise) return ret.finally(() => { activeCompile = prev; });
        activeCompile = prev;
        return ret;
      } catch (err) {
        activeCompile = prev;
        throw err;
      }
    };
  }

  // --- renderer.compute() census -----------------------------------------
  const anyRenderer = renderer as unknown as Record<string, unknown>;
  for (const key of ['compute', 'computeAsync'] as const) {
    const orig = anyRenderer[key];
    if (typeof orig !== 'function') continue;
    anyRenderer[key] = function (this: unknown, ...args: unknown[]) {
      computeCallsThisFrame++;
      computeTotal++;
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  installed = true;
  return true;
}

/**
 * The lab-renderer loop calls this once per PRESENTED frame with the frame's
 * wall ms and its start timestamp. Only creations that STARTED within the
 * frame are kept in its record.
 */
export function noteFrameEnd(wallMs: number, startT: number): void {
  frameNo++;
  if (computeCallsThisFrame > 0) {
    computeByFrame.push({ frame: frameNo, calls: computeCallsThisFrame });
    if (computeByFrame.length > MAX_COMPUTE_FRAMES) computeByFrame.shift();
    if (computeCallsThisFrame > computeMaxPerFrame) computeMaxPerFrame = computeCallsThisFrame;
    computeCallsThisFrame = 0;
  }
  if (enabled && wallMs >= LONG_FRAME_MS) {
    longFrames.push({
      frame: frameNo,
      ms: Math.round(wallMs * 10) / 10,
      t0: Math.round(startT),
      t1: Math.round(startT + wallMs),
      pipelines: inFlight.filter((c) => c.t >= startT),
    });
    if (longFrames.length > MAX_LONG_FRAMES) longFrames.shift();
  }
  inFlight = [];
}

/** The `__sdfGame.pipelineLog()` payload. */
export function getPipelineLog(): PipelineLogSummary {
  const rebuilds = [...rebuildCensus.entries()]
    .filter(([, e]) => e.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 24)
    .map(([key, e]) => ({
      key,
      name: e.name,
      count: e.count,
      firstFrame: e.firstFrame,
      lastFrame: e.lastFrame,
      objects: [...e.objects].slice(0, 8),
      releases: evictionEvents.filter((r) => r.key === key).slice(-8),
    }));
  const descriptorGroups = [...descriptorCensus.values()]
    .filter((e) => e.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 24)
    .map((e) => ({
      sig: e.sig, name: e.name, count: e.count, distinctThreeKeys: e.keys.size,
      firstFrame: e.firstFrame, lastFrame: e.lastFrame,
    }));
  const repeatedShaders = [...shaderModuleCensus.values()]
    .filter((e) => e.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 16);
  const byObject = [...evictionByObject.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([object, count]) => ({ object, count }));
  return {
    installed,
    enabled,
    frames: longFrames,
    totalPipelines,
    totalCompileMs: Math.round(totalCompileMs),
    slowest: slowest.map((s) => ({ ...s })),
    compute: { total: computeTotal, maxPerFrame: computeMaxPerFrame, byFrame: computeByFrame },
    rebuilds,
    descriptorGroups,
    shaderModules: {
      created: shaderModulesCreated,
      totalBytes: shaderModuleBytes,
      distinct: shaderModuleCensus.size,
      repeated: repeatedShaders,
    },
    evictions: { total: evictionTotal, byObject, events: evictionEvents },
  };
}

/** Test/reset seam: clears the module state (used by unit tests only). */
export function resetPipelineLogForTest(): void {
  installed = false;
  enabled = false;
  frameNo = 0;
  totalPipelines = 0;
  totalCompileMs = 0;
  inFlight = [];
  longFrames.length = 0;
  slowest.length = 0;
  computeCallsThisFrame = 0;
  computeTotal = 0;
  computeMaxPerFrame = 0;
  computeByFrame.length = 0;
  activeCompile = null;
  compileSession = 0;
  shaderModuleCensus.clear();
  shaderModulesCreated = 0;
  shaderModuleBytes = 0;
  shaderModulesDisabled = 0;
  shaderModuleSourceByHash.clear();
  shaderModuleSourceBytes = 0;
  shaderModuleSourcesDropped = 0;
  censusEntries.length = 0;
  rebuildCensus.clear();
  descriptorCensus.clear();
  evictionEvents.length = 0;
  evictionTotal = 0;
  evictionByObject.clear();
  currentRender = null;
}

/**
 * The `__sdfGame.pipelineCensus()` payload (compile census, 2026-09-19).
 * Every pipeline creation recorded while the log is enabled, with the fields
 * the compile-time analysis needs: label, sync/async, start/end (so overlapping
 * async compiles become wall coverage rather than a meaningless ms sum), WGSL
 * byte lengths, three's render-cache key, and the descriptor signature. Plus
 * the shader-module fingerprint census (include list, bindings, bytes).
 *
 * Plain data, JSON-serialisable, no device objects. Off unless enabled.
 */
export function getPipelineCensus(): PipelineCensus {
  let total = 0;
  for (const e of censusEntries) total += e.ms;
  return {
    installed,
    enabled,
    count: censusEntries.length,
    totalMs: Math.round(total * 100) / 100,
    entries: censusEntries.map((e) => ({ ...e })),
    modules: [...shaderModuleCensus.values()].map((m) => ({
      ...m,
      fingerprint: { ...m.fingerprint, fns: [...m.fingerprint.fns], structs: [...m.fingerprint.structs] },
    })),
    modulesCreatedWhileDisabled: shaderModulesDisabled,
    sourcesRetained: shaderModuleSourceByHash.size,
    sourcesDropped: shaderModuleSourcesDropped,
  };
}

/**
 * The WGSL source for one module hash, or undefined (never enabled / dropped /
 * unknown). The compile census uses this to diff two large march variants
 * offline instead of pushing megabytes through the summary payload. Plain
 * string, no device object.
 */
export function getPipelineShaderSource(hash: string): string | undefined {
  return shaderModuleSourceByHash.get(hash);
}
