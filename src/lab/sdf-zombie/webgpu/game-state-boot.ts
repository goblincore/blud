// src/lab/sdf-zombie/webgpu/game-state-boot.ts
//
// BOOT slice of the GameContext decomposition. The handles and flags the boot
// block hands to everything after it: the lab renderer and its canvas, the
// pass-timing wrapper, the loop-intent controller, the URL seams read once at
// startup (?res / ?seed / ?loader / ?renderer / ?shadowmap / ?vhs / ?graphics /
// ?sscs / ?spotshadow / ?fields / ?room / ?warm / ?tiles-playtest), the zombie
// blob document, the sever-dispatch indirection, the tile-playtest controller,
// the HUD root and the frame-hash dependency set.
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js/WebGPU dependency. Fields are
// plain and mutable — no getters, setters, `readonly` or `Object.freeze` —
// because the codemod moves the original assignments onto these fields and an
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (URL reads, `await createLabRenderer`,
// `installPassTiming`, `parseBlob`, ...) get a type-correct placeholder in the
// factory; the codemod supplies the real value at the binding's original line.

import type { BlobDoc } from '../blob-ast';
import type { Wound } from '../damage';
import type { Primitive, Vec3 } from '../types';
import type { DemoHashDeps } from './demo-hash';
import type { ZombieActor } from './game-actor';
import type { GameBootMode, GameDeferredRenderer } from './game-deferred-renderer';
import type { RoomDef } from './game-level';
import type { PassTiming } from './gpu-pass-timing';
import type { LabRendererHandle } from './lab-renderer';
import type { LoopController, WarmOutcome } from './warm-gate';

/** `game-main.ts`'s local `RES_RUNGS` keys (`?res=`); not exported there. */
type ResRung = '960' | '800' | '640';

/** `game-main.ts`'s local `GraphicsLevel` (`?graphics=high`); not exported. */
type GraphicsLevel = 'default' | 'high';

/** One startup phase mark: a name and a `performance.now()` instant. */
interface BootMark {
  n: string;
  t: number;
}

/** The sever-dispatch indirection the grapeshot wiring assigns once the chunk
 *  spawner exists. */
type SeverDispatch = (
  actor: ZombieActor,
  piece: { limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[]; bones: Primitive[] },
  stumpWound: Wound | null,
) => void;

/** Type of the object `createGameTilePlaytest()` returns (no exported name). */
type GameTilePlaytest = ReturnType<typeof import('./game-tile-playtest').createGameTilePlaytest>;

/**
 * Placeholder for a binding whose real value is a live handle built at that
 * binding's original line. The field is non-null in game-main.ts, so the
 * placeholder must satisfy the declared type even though no code reads it
 * before the original assignment runs.
 */
function unbuilt<T>(): T {
  return null as unknown as T;
}

export interface BootState {
  /** Startup phase marks; read as `__sdfGame.bootMarks()`. */
  marks: BootMark[];
  /** The `#app` mount point; the renderer refuses to boot without it. */
  mount: HTMLElement | null;
  /** Selected resolution rung (`?res=`, default 800x600). */
  resKey: ResRung;
  /** The lab renderer handle — canvas, scene, camera and loop control. */
  handle: LabRendererHandle;
  /** Per-pass GPU timestamp wrapper; collect via `__sdfGame.passTimings()`. */
  passTiming: PassTiming;
  /** The renderer's real `setLoopRunning`, captured before the wrap. */
  rawSetLoopRunning: (on: boolean) => void;
  /** Separates loop INTENT from the warm's temporary suspension. */
  loopControl: LoopController;
  /** `?seed=` search params — the one seed every rng stream derives from. */
  seedSearch: URLSearchParams;
  /** The `#loader` overlay element, or null when the page has none. */
  loaderEl: HTMLElement | null;
  /** `?loader=0` removes the loading overlay (bench/screenshot determinism). */
  loaderDisabled: boolean;
  /** Resolved render mode (`?renderer=`) plus its fatal/warning text. */
  mode: GameBootMode;
  /** True when the resolved mode is `deferred`. */
  deferredMode: boolean;
  /** `?shadowmap=` size override; 0 uses the shipped SHADOW_MAP_SIZE. */
  shadowMapParam: number;
  /** Raw `?vhs` value; null keeps the shipped 'blud' default. */
  vhsParam: string | null;
  /** Shared boot search params for the probe-gather seams. */
  search: URLSearchParams;
  /** `?graphics=high` opts into the run-5b refine head. */
  graphics: GraphicsLevel;
  /** True when 'high' also keeps the upscaled present (not `?upscale=0`). */
  graphicsHighUpscale: boolean;
  /** True when the march must carry normal attachments for refine/upscale. */
  marchNormalsWanted: boolean;
  /** Raw `?sscs` value; `'on'` opts into contact shadows. */
  sscsParam: string | null;
  /** Contact shadows are opt-in and legacy-only. */
  sscsEnabled: boolean;
  /** Raw `?spotshadow` value; `'0'` ablates shadow-map generation. */
  spotShadowParam: string | null;
  /** The deferred coordinator, or null on the legacy path. */
  deferredApi: GameDeferredRenderer | null;
  /** No frame draws until boot has built everything the draw callback reads. */
  drawReady: boolean;
  /** `?fields=` override for the interleave divisor, or null for the default. */
  fieldsBoot: number | null;
  /** The parsed zombie blob document every compiled body derives from. */
  doc: BlobDoc;
  /** Sever-dispatch indirection; assigned once the chunk spawner exists. */
  onSeverDispatch: SeverDispatch | null;
  /** DEV-only `?tiles-playtest` gate for the compute tile controller. */
  tilesPlaytest: boolean;
  /** The tile-culling playtest controller; inert when not allowed. */
  gameTiles: GameTilePlaytest;
  /** The F6 tile-culling button, or null outside the playtest. */
  tilesButton: HTMLButtonElement | null;
  /** Accumulated `console.error` text for the diagnostics overlay. */
  errors: string[];
  /** Monotonic id allocator (debug/probe labels). */
  nextId: number;
  /** Raw `?room` value, or null for the shipped PLAYER_START. */
  roomParam: string | null;
  /** The room `?room` selected, or null. */
  room: RoomDef | null;
  /** The renderer's canvas, cached for the pointer-lock listeners. */
  canvas: HTMLCanvasElement;
  /** `?warm=0` skips the pipeline warm-up (bench determinism). */
  warmRequested: boolean;
  /** The warm-up outcome promise, or an already-resolved 'ok'. */
  warmPromise: Promise<WarmOutcome>;
  /** Monotonic wound/trail emitter-stream id allocator. */
  nextEmitterStream: number;
  /** The `#hud` root element, or null when the page has none. */
  hudEl: HTMLElement | null;
  /** HUD toggles; `lockHint` shows the click-to-lock hint. */
  hud: { lockHint: boolean };
  /** Smoothed frame-time EMA, in milliseconds. */
  frameEma: number;
  /** `performance.now()` at the end of the boot block. */
  time: number;
  /** THE one frame-hash dependency set (never inline literals again). */
  frameHashDeps: DemoHashDeps;
}

/** Every call returns a fresh object, nested arrays and objects included. */
export function makeBootState(): BootState {
  return {
    marks: [],
    mount: null,
    resKey: '800',
    handle: unbuilt<LabRendererHandle>(),
    passTiming: unbuilt<PassTiming>(),
    rawSetLoopRunning: () => {},
    loopControl: unbuilt<LoopController>(),
    seedSearch: new URLSearchParams(),
    loaderEl: null,
    loaderDisabled: false,
    mode: { mode: 'legacy', fatal: null, warning: null },
    deferredMode: false,
    shadowMapParam: 0,
    vhsParam: null,
    search: new URLSearchParams(),
    graphics: 'default',
    graphicsHighUpscale: false,
    marchNormalsWanted: false,
    sscsParam: null,
    sscsEnabled: false,
    spotShadowParam: null,
    deferredApi: null,
    drawReady: false,
    fieldsBoot: null,
    doc: unbuilt<BlobDoc>(),
    onSeverDispatch: null,
    tilesPlaytest: false,
    gameTiles: unbuilt<GameTilePlaytest>(),
    tilesButton: null,
    errors: [],
    nextId: 1,
    roomParam: null,
    room: null,
    canvas: unbuilt<HTMLCanvasElement>(),
    warmRequested: false,
    warmPromise: Promise.resolve<WarmOutcome>('ok'),
    nextEmitterStream: 1,
    hudEl: null,
    hud: { lockHint: true },
    frameEma: 0,
    time: 0,
    frameHashDeps: unbuilt<DemoHashDeps>(),
  };
}

/** Old `game-main.ts` binding name → path on the `boot` slice. */
export const BOOT_BINDINGS = {
  bootMarks: 'boot.marks',
  mount: 'boot.mount',
  resKey: 'boot.resKey',
  handle: 'boot.handle',
  passTiming: 'boot.passTiming',
  rawSetLoopRunning: 'boot.rawSetLoopRunning',
  loopControl: 'boot.loopControl',
  seedSearch: 'boot.seedSearch',
  loaderEl: 'boot.loaderEl',
  loaderDisabled: 'boot.loaderDisabled',
  bootMode: 'boot.mode',
  deferredMode: 'boot.deferredMode',
  shadowMapParam: 'boot.shadowMapParam',
  vhsParam: 'boot.vhsParam',
  bootSearch: 'boot.search',
  graphics: 'boot.graphics',
  graphicsHighUpscale: 'boot.graphicsHighUpscale',
  marchNormalsWanted: 'boot.marchNormalsWanted',
  sscsParam: 'boot.sscsParam',
  sscsEnabled: 'boot.sscsEnabled',
  spotShadowParam: 'boot.spotShadowParam',
  deferredApi: 'boot.deferredApi',
  drawReady: 'boot.drawReady',
  fieldsBoot: 'boot.fieldsBoot',
  doc: 'boot.doc',
  onSeverDispatch: 'boot.onSeverDispatch',
  tilesPlaytest: 'boot.tilesPlaytest',
  gameTiles: 'boot.gameTiles',
  tilesButton: 'boot.tilesButton',
  errors: 'boot.errors',
  nextId: 'boot.nextId',
  bootRoomParam: 'boot.roomParam',
  bootRoom: 'boot.room',
  canvas: 'boot.canvas',
  warmRequested: 'boot.warmRequested',
  warmPromise: 'boot.warmPromise',
  nextEmitterStream: 'boot.nextEmitterStream',
  hudEl: 'boot.hudEl',
  hud: 'boot.hud',
  frameEma: 'boot.frameEma',
  bootTime: 'boot.time',
  frameHashDeps: 'boot.frameHashDeps',
} as const;
