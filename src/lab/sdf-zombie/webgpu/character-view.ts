// src/lab/sdf-zombie/webgpu/character-view.ts
//
// THE BODY: how a character looks, how it animates, and (from task 4) what
// happens to it when it is hit. One module, two consumers — the lab previews
// one and puts sliders on it; the game spawns a roomful and shoots them.
//
// WHY IT EXISTS. The lab is meant to be a preview of things that then drop
// into the game, and it was not: kit overlays, held props, motion profiles and
// baked faces were all previewed in the lab, and getting the soldier into the
// game then cost three hand-porting tasks. This is that seam.
//
// WHAT IT DOES NOT OWN: behaviour, motion, wander, crowd separation, the melee
// ring. Those are game-actor's — the line is BODY versus FIGHTER. The lab
// needs a body it can shoot; it has never needed a fighter.
//
// Follows the factory-closure pattern the codebase already uses in
// createZombieActor, KitOverlay, GooLayer, HeldProp and WoundPanel. main() is
// the one place that never adopted it.
//
// TASK 3 SCOPE (of the shared-character-view plan). Presentation half only:
// build, GPU view, the `sheet` data (compile + the loud catch), kit, prop and
// the per-frame pose. Damage arrives in task 4. Face TEXTURES stay with the
// caller for now: the lab wears ONE sheet across the hero AND the crowd, and
// that fan-out is lab plumbing this pass leaves alone — the lab calls
// compileCharacterSheet() for the data and keeps the GL half.
import * as THREE from 'three/webgpu';
import { characterEntry, type CharacterEntry, type FaceSheet } from '../character-registry';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { BlobError } from '../blob-ast';
import { checkStance } from '../blob-checks';
import { buildBody, DEFAULT_BUILD_OPTS, type BodyOverride, type BuildResult } from '../build-body';
import { makeZombie } from '../body';
import { translateBody } from '../translate';
import { boneFrames } from '../rig-frames';
import { rotateYaw } from '../gait';
import type { BoundRig } from '../rig-bind';
import type { MotionFrame } from '../motion';
import { DEFAULT_FACE, type FaceParams } from '../face';
import type { FleshMaterial } from '../material';
import type { BodyDef, Vec3 } from '../types';
import type { VisualWound } from '../shared-wounds/torso';
import type { FaceSheetParams } from '../blob-face-sheet';
import { loadKit, type KitOverlay } from './kit-overlay';
import { loadHeldProp, type HeldProp } from './held-prop';
import { createArmorSparks, createMuzzleFlash } from './character-effects';
import { createEjectionCycle, createShotgunCasings } from './shotgun-casings';
import { createZombieGpuView, type ZombieGpuView } from './zombie-gpu';
import {
  MAX_WOUNDS, pushWound, WOUND_PROFILES, woundCarveNormal, woundWorldPos,
  type Wound, type WoundType,
} from '../damage';

// ---------------------------------------------------------------------------
// The build step
//
// Moved verbatim out of lab-main.ts, where it wired zombie.blob for the
// initial body, the crowd spawner and rebuildBody(). It now takes the
// registry entry instead of reading the URL, so every consumer renders the
// same document and none of them can silently drift back to the TS body.
//
// Logged once per failure kind so a spammy [ crowd-spawn doesn't flood the
// console with the same BlobError fifteen times.
// ---------------------------------------------------------------------------
let blobCompileWarned = false;

/**
 * Parses and compiles the character's .blob for the given face, or null if
 * the document is broken. Never throws: a bad .blob must not blank the lab.
 * The failure is reported to the caller through the returned parts so it can
 * surface on-screen instead of only in the console — a silent fallback would
 * hide exactly the typed BlobError this format exists to catch.
 *
 * `compileFace(doc)` is called explicitly rather than left to compileBlob's
 * default parameter. compileBlob's signature is
 * `(doc, face = compileFace(doc))` — a default that only fires when the
 * CALLER omits the argument. This function always supplies an explicit
 * `face` (DEFAULT_FACE merged with the panel's live overrides, computed by
 * the caller), so relying on that default here would mean compileFace(doc)
 * — and with it every bit of validation against the .blob's OWN `face`
 * block, including the unknown-key check this format exists to give — never
 * runs at all. The panel override still wins for the values actually
 * rendered (unchanged from before this format existed); this call exists
 * purely so a typo in a face section is caught instead of silently
 * compiling with the panel's values and no diagnostic.
 *
 * The character's own flesh material, if it declared a `palette` block, is
 * handed back through `out.palette` so the caller can dress the body in it
 * instead of its default preset — recorded on the way past rather than
 * re-parsed at the call site, because a second parse is a second place for
 * the two to disagree about which character is loaded. Null means "no
 * palette declared" — wear the caller's preset, which is what every
 * character did before palettes existed.
 */
function compileCharacter(
  entry: CharacterEntry,
  face: FaceParams,
  out: { palette: FleshMaterial | null },
): { compiled: BodyDef | null; stance: 'humanoid' | 'digitigrade' | null; error: string | null } {
  try {
    const doc = parseBlob(entry.src);
    const stance = doc.stance;
    compileFace(doc); // validates the .blob's face block; return value unused, see above
    out.palette = compilePalette(doc);
    const compiled = compileBlob(doc, face);
    return { compiled, stance, error: null };
  } catch (e) {
    const msg = e instanceof BlobError ? e.message : e instanceof Error ? e.message : String(e);
    // Clear the palette too: the fallback body is the TS zombie, and dressing
    // it in a half-parsed character's colours would make a compile error look
    // like a rendering bug instead of the missing character it is.
    out.palette = null;
    if (!blobCompileWarned) {
      blobCompileWarned = true;
      console.error('[blob] zombie.blob failed to compile, falling back to the TS zombie', e);
    }
    return { compiled: null, stance: null, error: msg };
  }
}

/**
 * Builds a character body from its registry entry at `start`, reporting
 * diagnostics into `errors` (and, unchanged from the lab's original wiring,
 * onto the result itself). Falls back to makeZombie(face) — the pinned TS
 * reference — if the document fails to compile; the entry's `face` block
 * seeds the face when the caller passes none. The single seam used by the
 * lab's initial body, its crowd spawner and its rebuild, and by the game
 * from task 5 — see the comment above compileCharacter().
 */
export function buildCharacterBody(
  entry: CharacterEntry,
  start: Vec3,
  errors: string[],
  face?: FaceParams,
  opts?: BodyOverride,
  out?: { palette: FleshMaterial | null },
  /** Bone-thickness ratio override, applied to the COMPILED body before
   *  buildBody — bone ratio changes which bone prims exist, so like faceParams
   *  it must act before the build, not after.
   *
   *  A GAME-ONLY KNOB TODAY, and the reason it is a separate parameter rather
   *  than a BodyOverride field: BodyOverride is buildBody's contract and this
   *  never reaches buildBody. game-main's wound panel drives it and rebuilds
   *  the whole cast through the same spawn path as boot, which is the
   *  invariant that keeps a tuned ratio from drifting between the two. The lab
   *  has no equivalent control; undefined leaves the .blob's own value. */
  boneRatio?: number,
): BuildResult {
  const paletteOut = out ?? { palette: null };
  let f = face;
  if (f === undefined) {
    // Seed the face from the character's OWN `face` block (compileFace parses
    // the .blob), so a .blob-authored head renders at the size its author
    // declared. Before that seeding existed, every character built from
    // DEFAULT_FACE alone and the .blob's headRadius/headWidth were silently
    // ignored at render time — the clown's 0.235 x 1.18 ball rendered as the
    // 0.118 x 0.76 DEFAULT_FACE skull.
    try {
      f = { ...DEFAULT_FACE, ...compileFace(parseBlob(entry.src)) };
    } catch {
      f = { ...DEFAULT_FACE };
    }
  }
  const { compiled, stance, error } = compileCharacter(entry, f, paletteOut);
  // The panel's ratio, once the owner has touched it, overrides whatever the
  // doc would have done (nothing today; an authored ratio from the bones
  // block, later). Applied to the COMPILED body only — the TS fallback zombie
  // has no bones block to override.
  if (compiled && boneRatio !== undefined) compiled.boneRatio = boneRatio;
  const result = buildBody(compiled ?? makeZombie(f), DEFAULT_BUILD_OPTS, opts ?? {});
  // Declared-vs-actual knee fold. Surfaced next to validateBody's own errors
  // because it is the same kind of finding — something the author almost
  // certainly did not mean — and because a backward knee is otherwise
  // invisible to every geometric check: it is perfectly closed, connected and
  // non-interpenetrating.
  if (compiled && stance)
    result.errors = [...checkStance(result.bones, stance), ...result.errors];
  if (error) {
    const msg = `zombie.blob failed to compile, rendering the fallback TS zombie: ${error}`;
    result.errors = [msg, ...result.errors];
    errors.push(msg);
  }
  return translateBody(result, start);
}

// ---------------------------------------------------------------------------
// The face step — the `sheet` block's data half
// ---------------------------------------------------------------------------

export interface CharacterSheet {
  /** The compiled `sheet` block parameters, or null when the .blob declares
   *  no block — or when the block exists but is BROKEN (see `error`). */
  sheet: FaceSheetParams | null;
  /** Why `sheet` is null when the .blob declares a block. Null otherwise. */
  error: string | null;
  /** The registry's declared face for this character — what to wear when
   *  `sheet` is null, which is the shared zombie flat for most of the cast. */
  face: FaceSheet;
}

/**
 * The one home of the `sheet` compile and its catch. The catch is LOUD on
 * purpose, and its comments are the record of why:
 *
 * A BROKEN SHEET BLOCK IS LOUD NOW. This used to swallow the error on the
 * grounds that "the body compile path reports it" -- it does not, because
 * the body compiles fine with a bad SHEET. What actually happened (and cost
 * an hour on 2026-09-04): one invalid key in the soldier's sheet block made
 * compileSheet throw, the whole block was discarded, the lab silently fell
 * back to the GENERATED procedural sheet, and the character rendered with
 * the zombie's face and head. Nothing anywhere said why. The keys are
 * validated against a fixed list, so a typo or a guessed-at parameter --
 * `eyeGlowCut`, which is panel-only -- lands here, and silence is the worst
 * possible response to it.
 *
 * The same lie used to live in a SECOND silent catch on the generated-face
 * path: the body compile path does NOT report this, because the body
 * compiles fine with a broken SHEET. Returning "no sheet" there sent the
 * caller to the zombie face texture -- so one bad key in a sheet block put
 * the ZOMBIE'S FACE on the character with nothing said anywhere. That is
 * exactly how the soldier lost his face on 2026-09-04. One catch now, in
 * one place, and it reports before it falls back.
 */
export function compileCharacterSheet(entry: CharacterEntry): CharacterSheet {
  try {
    return { sheet: compileSheet(parseBlob(entry.src)), error: null, face: entry.face };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    console.error(
      `[character-view] ${entry.name}: its \`sheet\` block FAILED TO COMPILE, so the `
      + `baked face is being ignored and this character is falling back to the generated `
      + `sheet / the ZOMBIE face texture (which reads as the zombie's face). `
      + `Fix the sheet block:\n  ` + msg);
    return { sheet: null, error: msg, face: entry.face };
  }
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// The wound ring (task 4b)
//
// WHAT MOVED, AND WHAT DID NOT. The owner's call was the SMALLEST boundary:
// character-view owns the wound DATA and the carve UPLOAD; the reaction to a
// hit stays with each caller. That is not a compromise, it is what the code
// allows — `impulseAt` mutates the rig, `mind.stagger()` is behaviour, and
// `flushHitTail` (runSeverChecks -> applyRig -> view.update -> setHeadRotation)
// is rig work from end to end. All of that is state the CALLER owns, so
// dragging it in here would mean dragging the rig in with it.
//
// CONSEQUENCE, STATED SO NOBODY IS SURPRISED: the lab converges onto the
// game's carve-normal upload (it had ZERO references to woundCarveNormal), but
// NOT onto the hit batching, because batching defers the rig re-solve rather
// than the wound upload. Closing that gap means moving the rig here too.
//
// A FACTORY, not fields on CharacterView, because game-actor's `character` is
// OPTIONAL — eight test call sites and hull-spike-main build actors from a
// bare body and view. Those get their own ring from this same factory, so
// there is ONE implementation of the ring regardless of who owns it. That is
// the whole point: the drift this module exists to kill came from two
// hand-written copies of the same sequence.
// ---------------------------------------------------------------------------

/** Wound-type ids the shader expects — the mapping lab-main and game-actor
 *  each declared as their own TYPE_ID const. */
const TYPE_ID: Record<WoundType, number> = { pellet: 0, blast: 1, burn: 2 };

/**
 * An extra rigid transform applied to a wound's world position (`dir=false`) or
 * carve normal (`dir=true`) at upload time, keyed by the wound's prim index.
 *
 * The rupture (gib-tear.ts) uses this to carry a crater with the region it is
 * stamped on while that region rotates during the breakup. It is applied to the
 * position `woundWorldPos` computes from the CLEAN prims — never by handing
 * `woundWorldPos` the rotated prims, which would reinterpret the stored
 * body-frame offset in a different frame.
 */
export type WoundPointTransform = (v: Vec3, primIdx: number, dir: boolean) => Vec3;

export interface WoundRing {
  /** The live ring, oldest evicted at MAX_WOUNDS. */
  all(): readonly Wound[];
  /**
   * Push a freshly stamped wound and record where it was placed.
   * `posed` and `bodyYaw` are the pose it was stamped against — the caller
   * owns those, so it passes them in.
   */
  stamp(wound: Wound, posed: BuildResult, bodyYaw: number): Wound;
  /** Push a bundle with no stamp-time record (resolveExplosion's blast
   *  wounds arrive already resolved against a posed body). */
  stampBundle(wounds: readonly Wound[]): void;
  /**
   * Where `wound` was placed AT STAMP TIME, before any recoil moved the body.
   *
   * `woundWorldPos` reconstructs from the CURRENT pose, which is right for
   * rendering — a crater must ride the flesh it is carved into — and wrong for
   * asking "did this land where the shot hit?", because a hit shoves the rig
   * by IMPULSE[type] METRES (0.18 for a slug). sdf-game-slug-gate.mjs made
   * exactly that mistake and read 18.3 cm of "placement error" that was
   * entirely recoil. DIAGNOSTIC ONLY — never render from this.
   */
  stampWorldOf(wound: Wound): Vec3 | null;
  /**
   * Upload the carve rows: the surface anchor (the shader's sphere centre)
   * plus the per-wound depth-slab cap, which clips the sphere so a crater on
   * thin flesh floors before it perforates.
   *
   * THE WOUND FRAME IS THE BODY FRAME (2026-09-02, the billboarding fix).
   * Wounds are stamped on applyRig output WITH the live bodyYaw and uploaded
   * from the posed prims WITH the live bodyYaw. damage.ts uses the yaw to pick
   * a canonical BODY-FRAME basis (de-yaw the prim axis, build, re-yaw), so
   * `local` comes out in the body frame and the frame turns with the flesh.
   * Without it every SPHERE prim — all four torso blobs, the shoulder balls —
   * has no axis to carry the turn and its crater stays viewer-fixed while the
   * body rotates under it (the owner's back-wound-rotates-to-the-front
   * report). Head wounds ride the orient quat and were fine; limb capsules
   * carry it in their axis.
   */
  refresh(
    gpu: ZombieGpuView, posed: BuildResult, bodyYaw: number,
    visual?: readonly VisualWound[], xf?: WoundPointTransform,
  ): void;
  /** Replace the ring wholesale — the sever path rebuilds it. */
  set(wounds: Wound[]): void;
}

export function createWoundRing(): WoundRing {
  let wounds: Wound[] = [];
  let nextEventId = 1;
  const stampWorld = new WeakMap<Wound, Vec3>();
  const identify = (w: Wound) => {
    if (w.eventId === undefined) w.eventId = nextEventId++;
    else nextEventId = Math.max(nextEventId, w.eventId + 1);
    return w;
  };
  return {
    all: () => wounds,
    stamp(wound, posed, bodyYaw) {
      identify(wound); wounds = pushWound(wounds, wound, MAX_WOUNDS);
      stampWorld.set(wound, woundWorldPos(posed.prims, wound, bodyYaw));
      return wound;
    },
    stampBundle(ws) {
      for (const w of ws) wounds = pushWound(wounds, identify(w), MAX_WOUNDS);
    },
    stampWorldOf: (w) => stampWorld.get(w) ?? null,
    set(next) { wounds = next.map(identify); },
    refresh(gpu, posed, bodyYaw, visual, xf) {
      const rows = visual ?? wounds;
      if ((!visual && wounds.length === 0) || typeof gpu.setWounds !== 'function') return;
      // The wound position is computed from the CLEAN prims (its stored offset
      // is in that frame), then the caller's rigid transform carries it with the
      // rotating region. The normal takes the same transform WITHOUT the
      // translation.
      const map = (v: Vec3, w: Wound, dir: boolean): Vec3 =>
        xf ? xf(v, w.primIdx, dir) : v;
      gpu.setWounds(
        rows.map(w => map(woundWorldPos(posed.prims, w, bodyYaw), w, false)),
        rows.map(w => w.radius),
        rows.map(w => 'presetCut' in w && w.presetCut ? -1 : TYPE_ID[w.type]),
        rows.map(w => w.ageSec),
        rows.map(w => WOUND_PROFILES[w.type].rimSplayScale * (w.rimScale ?? 1)),
        rows.map(w => WOUND_PROFILES[w.type].rimOffsetScale),
        rows.map(w => {
          const n = woundCarveNormal(posed.prims, w, bodyYaw);
          // The preview repacks slots as its second cutter appears. Clear
          // an uncapped slot explicitly so it cannot inherit an old cap.
          return n ? { n: map(n, w, true), depth: w.carveDepth ?? 0 } : visual ? { n: [0, 0, 0] as Vec3, depth: 0 } : null;
        }),
        rows.map(w => {
          // Severing retains wound history and primitive indices. A hidden
          // cluster still owns its wounds; null would turn them into global
          // cutters that can erase surviving head/torso flesh.
          const cluster = posed.clusters.findIndex(c =>
            w.primIdx >= c.start && w.primIdx < c.start + c.count);
          const c = posed.clusters[cluster];
          return c ? { cluster, start: c.start, count: c.count } : null;
        }),
      );
    },
  };
}

export interface CharacterView {
  readonly entry: CharacterEntry;
  /** This body's wounds and their carve upload. */
  readonly wounds: WoundRing;
  /** The built, translated body. Severing replaces it (task 4); the lab's
   *  rebuild swaps the body under a live view, so per-frame calls take the
   *  caller's current body rather than trusting this field. */
  readonly body: BuildResult;
  /** The GPU view. NAMED `gpu`, NOT `view`: callers hold this whole object in
   *  a field called `view` (ZombieActor.view), and `a.view.view` is the kind
   *  of name that produces a wrong-object bug at the first refactor. */
  readonly gpu: ZombieGpuView;
  /** The character's own `palette` block, if it declared one — else null and
   *  the caller dresses the body in its default preset. */
  readonly palette: FleshMaterial | null;
  /** The polygon kit once its glTF resolves; null until then, and forever
   *  for flesh-only characters. Callers toggle its visibility (reset, gib). */
  readonly kit: KitOverlay | null;
  /** The held prop once its glTF resolves; null until then. */
  readonly prop: HeldProp | null;
  /** Drive kit and prop from one rig solve. The BODY argument is the
   *  character's REST body — boneFrames reads its bones (rig-frames.ts
   *  header) — which is the caller's current body, not this view's birth
   *  body (see the note on `body`). `frame` is the caller's latest motion
   *  frame; null in statue mode, where the prop holds its last pose. The
   *  trailing params are the ones the moved block read at its old site in
   *  lab-main, each named for the line that needs it. */
  pose(
    body: BuildResult,
    bound: BoundRig,
    bodyYaw: number,
    sinceFire: number,
    frame: MotionFrame | null,
    dt: number,
    releaseSeed: number,
    damageBody?: BuildResult,
  ): void;
  /** World muzzle of the held prop, or null when this character carries
   *  nothing or the glTF has not loaded yet. The soldier's shot reads it. */
  muzzle(): Vec3 | null;
  /** Let the held prop go (collapse, gib). */
  releaseProp(vel: Vec3, seed: number): void;
  /** Restore equipment and clear detached armor when a fresh body replaces this one. */
  resetEquipment(): void;
  dispose(): void;
}

export interface CharacterViewOpts {
  name: string;
  start: Vec3;
  renderer: THREE.WebGPURenderer;
  /** Where async kit/prop objects attach. Scene in every existing caller;
   *  the deferred game passes a per-actor GROUP so one router registration
   *  propagates to the kit/prop whenever their glTF resolves (M2 task 5).
   *  Only .add() is used — Object3D is the honest type. */
  scene: THREE.Object3D;
  /** Transparent character effects, rendered after the SDF composite. */
  effectsScene?: THREE.Scene;
  /** Passed through to createZombieGpuView unchanged — the caller still owns
   *  the sdf layer, the flashlight and the lighting preset. Use the exact
   *  parameter type createZombieGpuView already declares; do not invent a
   *  new one. */
  gpu: Parameters<typeof createZombieGpuView>[1];
  /** Build errors are pushed here rather than thrown: one bad character must
   *  not take the page down, which is how the lab behaves today. */
  errors: string[];
  /** Panel/live overrides for the build. The lab passes its per-character
   *  saved override and its face-seeded params; the game passes neither and
   *  gets the .blob's own face with no overrides. */
  face?: FaceParams;
  override?: BodyOverride;
  /** Bone-thickness ratio override — see buildCharacterBody. Game-only today
   *  (the wound panel drives it); undefined leaves the .blob's own value. */
  boneRatio?: number;
}

/**
 * Builds the character named `opts.name` and returns everything needed to put
 * it on screen and keep it posed.
 *
 * SYNCHRONOUS, DELIBERATELY. There is no `await` anywhere in this function —
 * the kit and prop load fire-and-forget below — so the `async` this shipped
 * with bought nothing and cost something real: the GAME's spawn path is
 * synchronous (`spawnAll` at boot, and `rebuildCast` from a panel callback
 * that does hull work immediately after it), and an async factory would have
 * forced both of those async to satisfy a promise that never suspends.
 * Rippling `await` into a panel callback is exactly the kind of "small"
 * change that admits a frame between steps that assume none.
 *
 * lab-main's `await createCharacterView(...)` is unaffected: awaiting a
 * non-promise is legal, yields the value, and still costs one microtask — so
 * its setDrawFn/gooLayer ordering is bit-identical either way.
 */
export function createCharacterView(opts: CharacterViewOpts): CharacterView {
  const entry = characterEntry(opts.name);
  const out = { palette: null as FleshMaterial | null };
  const body = buildCharacterBody(
    entry, opts.start, opts.errors, opts.face, opts.override, out, opts.boneRatio,
  );
  const gpu = createZombieGpuView(body, opts.gpu);

  // The character's polygon kit and held prop, on the DEFAULT layer with the
  // floor and the reference cube — NOT SDF_LAYER. That is what puts them in
  // the polygonal pass whose depth the march already composites against
  // (sdf-layer.ts's header), so armour and gun occlude and are occluded by
  // flesh with nothing added here.
  //
  // Fire-and-forget: a kit or prop that fails to load must not take the lab
  // down with it, and there is nothing to fall back to — the character is
  // simply undressed/unarmed, which is exactly how it rendered before.
  let kit: KitOverlay | null = null;
  let heldProp: HeldProp | null = null;
  let disposed = false;
  const wounds = createWoundRing();
  const muzzleFlash = entry.profile.prop && opts.effectsScene ? createMuzzleFlash() : null;
  const armorSparks = entry.name === 'soldier' && opts.effectsScene ? createArmorSparks() : null;
  if (muzzleFlash) opts.effectsScene!.add(muzzleFlash.object);
  if (armorSparks) opts.effectsScene!.add(armorSparks.object);
  const casings = entry.name === 'soldier' ? createShotgunCasings() : null;
  const ejection = createEjectionCycle();
  const ejectOrigin = new THREE.Vector3(), ejectRight = new THREE.Vector3();
  if (casings) opts.scene.add(casings.object);
  const kitUrl = entry.kit;
  if (kitUrl) {
    loadKit(kitUrl, opts.renderer, [0, 0, 0], entry.name === 'soldier')
      .then(k => {
        if (disposed) { k.dispose(); return; }
        kit = k; opts.scene.add(k.object, k.debris);
      })
      .catch(e => console.error(`[kit] ${kitUrl} failed to load; rendering the body undressed`, e));
  }
  if (entry.profile.prop) {
    loadHeldProp(entry.profile.prop.url, opts.renderer)
      .then(p => {
        if (disposed) { p.dispose(); return; }
        heldProp = p; opts.scene.add(p.object);
      })
      .catch(e => console.error(`[prop] ${entry.profile.prop!.url} failed to load; rendering unarmed`, e));
  }

  return {
    entry,
    body,
    gpu,
    wounds,
    get palette() { return out.palette; },
    get kit() { return kit; },
    get prop() { return heldProp; },
    pose(body, bound, bodyYaw, sinceFire, frame, dt, releaseSeed, damageBody) {
      // Polygon halves ride the rig: the kit from per-bone frames, the gun from
      // the motion frame's gun pose (right forearm). Collapse and gib release
      // the gun; the kit simply keeps following the (fallen) rig.
      casings?.step(dt);
      if (!kit && !heldProp) {
        ejection.update(sinceFire, false);
        return;
      }
      const frames = boneFrames(body, bound, bodyYaw);
      const events=kit?.pose(frames, { body: damageBody ?? body, wounds: wounds.all(), bodyYaw, dt }) ?? [];
      for(const e of events) armorSparks?.burst(e.point,e.kind==='armor-shed'?10:5);
      armorSparks?.step(dt);
      if (heldProp) {
        if (frame?.gun && !heldProp.released) {
          heldProp.pose(frame.gun, sinceFire, rotateYaw([1, 0, 0], bodyYaw));
        }
        if (frame?.collapsed && !heldProp.released) heldProp.release([0, 0, 0], releaseSeed);
        heldProp.step(Math.min(dt, 1 / 30), 0);
        if (ejection.update(sinceFire, !!frame?.gun && !heldProp.released) && casings) {
          // Receiver's right-side port, using the rendered gun's recoil transform.
          heldProp.object.updateWorldMatrix(true, false);
          ejectOrigin.set(.038, .006, -.025).applyMatrix4(heldProp.object.matrixWorld);
          ejectRight.set(1, 0, 0).transformDirection(heldProp.object.matrixWorld);
          casings.eject(ejectOrigin.toArray() as Vec3, ejectRight.toArray() as Vec3);
        }
        // Gas begins just outside the bore, so the barrel doesn't punch a
        // black hole through the hot core when viewed from the side.
        muzzleFlash?.pose(!heldProp.released && frame?.gun ? heldProp.muzzle(0.018) : null, sinceFire);
      }
    },
    muzzle() {
      return heldProp ? heldProp.muzzle() : null;
    },
    releaseProp(vel, seed) {
      heldProp?.release(vel, seed);
      muzzleFlash?.pose(null, Infinity);
    },
    resetEquipment() {
      ejection.reset();
      kit?.resetDamage();
      armorSparks?.reset();
      heldProp?.reset();
      muzzleFlash?.pose(null, Infinity);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      kit?.object.removeFromParent();
      gpu.dispose();
      kit?.dispose();
      heldProp?.dispose();
      muzzleFlash?.dispose();
      armorSparks?.dispose();
      casings?.dispose();
    },
  };
}
