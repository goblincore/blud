// src/lab/sdf-zombie/webgpu/gib-sprite-pieces.ts
//
// A BLAST'S WORTH OF BILLBOARDS — the runtime half of the sprite gibs. The
// bench (`makeGibSprite` + `laySpriteBench`) answers "does a cut-out of our own
// rendered zombie read as gore in this room"; this module is what makes a
// DETONATION spawn them.
//
// THE WHOLE POINT IS WHAT IS *NOT* HERE. A sprite piece is the SAME `Chunk`
// state the marched pieces use, plus a quad — so `stepChunk` supplies gravity,
// air drag, the floor, the WALLS and CEILINGS, the friction/skid decomposition
// and the settle test, unchanged and untested-again. What is NOT reused is the
// expensive half of the marched path: there is no proxy box to march, no
// volume-texture upload, no per-view uniform pack, and above all NO BAKE. A
// settled quad is already the cheapest thing it can be, so the
// `?maxchunks` view pool, the `GIB_TIER_FLOOR` reservation and the whole
// degrade-the-shape ladder that pool forced on a crowded blast (which is what
// produced the owner's "tubes and orbs" report in the first place) have no
// meaning for sprites: the shape never has to degrade, because a quad cannot
// cost what a marched piece costs.
//
// THE ONE THING THAT IS *NOT* THE MARCHED CONTRACT: a settled piece. The marched
// path RETIRES a settled chunk from the sim and replaces its view with a baked
// static mesh, because a marched piece that keeps marching forever is the
// budget. A quad needs none of that — a settled sprite is parked in `rest`,
// stops being stepped (nothing left to integrate) and goes on billboarding, so
// the gore pile accumulates exactly as it does today without a bake queue, a
// worker round trip, or a swap stall.
import * as THREE from 'three/webgpu';
import { chunkSettled, stepChunk, type Chunk, type ChunkColliders } from '../gib-chunks';
import { makeGibSprite, type GibSpriteFrame } from './gib-sprites';

/**
 * CAPS: the sprite path's own bound, and the replacement for the marched pool.
 *
 * Sized to the shape a blast actually makes rather than to a cost budget: the
 * arena's worst case is a point-blank bundle into a crowd, and a full split set
 * is 24 pieces per body, so 128 live covers five bodies with room to spare —
 * deliberately ABOVE what the marched pool can afford (`?maxchunks` defaults to
 * 64) because that is the trade this mode makes: no shape degradation, a hard
 * count instead. Over the cap the OLDEST live piece is dropped, which is the
 * marched pool's own rule (oldest-live-first once nothing is baked).
 *
 * `rest` is capped separately and much lower on purpose: a pile of settled gore
 * is the thing a player walks past for minutes, so it must be bounded by what
 * reads well on the floor, not by what the blast needed for one second.
 */
export const GIB_SPRITE_TUNING = {
  liveCap: 128,
  restCap: 64,
  /** The quad's HEIGHT as a multiple of the piece's own diameter. The cutter
   *  keeps a margin around the gore inside its rect (manifest `coverage` runs
   *  0.45-1.00), so a quad sized at exactly 2*radius draws the visible meat a
   *  little smaller than the chunk that collides — this compensates. */
  sizeScale: 1.15,
} as const;

export interface SpritePiece {
  id: number;
  /** THE SAME STATE THE MARCHED STEpper INTEGRATES — see the header. */
  state: Chunk;
  /** The billboard. Geometry and material are SHARED per frame (see
   *  `spriteAssets`), so dropping a piece frees nothing and leaks nothing. */
  mesh: THREE.Mesh;
  /** The sheet frame — ABSENT on a carved mesh piece, which has real geometry. */
  frame: GibSpriteFrame | null;
  sizeM: number;
  /** Settled: no longer stepped, still drawn. */
  resting: boolean;
  /**
   * HOW THIS PIECE IS DRAWN, and therefore how it is POSED.
   *
   *  'billboard' — a cut-out from the rendered-SDF sheet, faced at the camera
   *                with an in-plane roll (`applySpritePose`).
   *  'mesh'      — a real carved body part from the per-archetype library. It
   *                does NOT face the camera: its orientation is its own `quat`,
   *                so it tumbles as a chunk of anatomy (`applyMeshPose`).
   *
   * The LIFETIME IS SHARED — same `Chunk` state, same stepper, same settle-and-
   * park, same caps — because that is the part the two renderers must not be
   * allowed to disagree about. Only the pose differs.
   */
  render: 'billboard' | 'mesh';
  /** Drains to go before the launch velocity lands. The marched path's
   *  `pendingGibImpulses` counts DRAINS, NOT FRAMES and this mirrors it exactly
   *  (see `stepSpritePieces`): the drain that could have fired it in the spawn
   *  tick has already run, so a delay of 1 still buys one whole frame drawn at
   *  rest — the body's own silhouette in place, which is what the staged
   *  release exists to show. */
  impulseDelay: number;
  impulseVel: Chunk['vel'] | null;
  /**
   * CALLED WHEN THIS PIECE LEAVES THE SET (evicted over a cap, or cleared).
   *
   * Absent for a billboard/carved piece, whose geometry is shared and has
   * nothing to give back. The OFFLINE ASSET path sets it so a dropped piece
   * returns its per-instance deformed geometry to the per-part pool — that is
   * what makes the pool bounded across a firefight rather than growing with
   * every blast. See `detach` below: this is the ONE place a piece is retired,
   * so registering the buffer return here cannot be forgotten at a call site.
   */
  onDetach?: () => void;
  /**
   * CALLED AFTER EVERY RE-POSE (live step and resting re-pose), with this
   * piece. The OFFLINE ASSET head uses it to re-project its face frame from the
   * chunk's current transform: the face layer's `headCentre`/`headQuat`/
   * `headAxes` are world-space, so they must ride the piece through flight,
   * squash and settle exactly as `applyMeshPose` moves the geometry. Absent on
   * every piece that does not carry a face frame.
   */
  onPose?: (p: SpritePiece) => void;
}

export interface SpritePieceSet {
  live: SpritePiece[];
  rest: SpritePiece[];
  nextId: number;
  /** Follows the chunk path's own rule: a piece spawned while the differential
   *  has pieces hidden must stay hidden. */
  hidden: boolean;
  /** The scene node every piece is parented to. */
  group: THREE.Group;
  /** Shared per-frame assets, so N pieces of one frame cost ONE geometry and
   *  ONE material rather than N — and so `makeGibSprite`'s per-call
   *  `texture.clone()` (which shares the sheet's `Source`, three r185
   *  `Texture.copy`) happens once per frame instead of once per piece.
   *
   *  THE GEOMETRY IS A SINGLE UNIT PLANE, and the piece's size is a mesh SCALE.
   *  That is not a micro-optimisation: a geometry keyed by size would be keyed by
   *  a CONTINUOUS number (every piece's radius is its own `chunkExtent`), so the
   *  cache would miss almost every time and its entries would grow with every
   *  piece ever spawned — a leak wearing a cache's clothes. MEASURED before the
   *  change: six blasts left 232 geometries for 147 live pieces. One unit plane
   *  plus `scale` is bounded at exactly 1, forever, and it is also what lets two
   *  frames of the same aspect share rather than duplicate. */
  assets: {
    unitPlane: THREE.PlaneGeometry | null;
    material: Map<number, THREE.MeshBasicNodeMaterial>;
  };
}

export function makeSpritePieceSet(group?: THREE.Group): SpritePieceSet {
  const g = group ?? new THREE.Group();
  if (!group) g.name = 'gib-sprite-pieces';
  return {
    live: [], rest: [], nextId: 1, hidden: false, group: g,
    assets: { unitPlane: null, material: new Map() },
  };
}

// Scratch. Module scope because this runs per piece per frame and the counts are
// in the hundreds; a fresh Vector3 per call is the kind of thing that shows up
// in a frame budget, and nothing here re-enters.
const _long = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _viewNormal = new THREE.Vector3(0, 0, 1);

/**
 * IN-PLANE ROLL, radians, from the piece's OWN pose — the two lines that make a
 * thrown gib tumble instead of sliding to the floor bolt upright.
 *
 * A billboard that only copies the camera's quaternion is a decal: it always
 * shows the sprite's own upright orientation however the chunk underneath is
 * spinning, and a limb that flies across the room without turning reads as
 * pasted on. So the piece's `longAxis` — a real `Chunk` field, tumbled by the
 * piece's real `quat`, and the same axis `stepChunk` topples flat on landing —
 * is rotated into world space and projected into the camera's screen plane. The
 * ANGLE OF THAT PROJECTION *IS* the roll, which is why this needs no
 * accumulator and no extra state: the sprite's orientation is a pure function of
 * the physics, so it is right after a pause, after a resume, and in a static
 * capture.
 *
 * DEGENERATE CASE: a piece whose long axis points straight at (or away from) the
 * camera projects to a point, and `atan2(0, 0)` is 0 — the sprite would snap
 * upright exactly as it flies toward the player, which is the one moment the
 * player is looking at it. There the piece's `angVel` (world axes, rad/s) still
 * has an in-plane direction, so the roll comes from the spin instead. Both
 * branches are needed; neither is a fallback anyone should read as dead.
 */
export function spriteRollRad(state: Chunk, cameraQuat: THREE.Quaternion): number {
  _q.set(state.quat[0], state.quat[1], state.quat[2], state.quat[3]);
  _long.set(state.longAxis[0], state.longAxis[1], state.longAxis[2]).applyQuaternion(_q);
  _right.set(1, 0, 0).applyQuaternion(cameraQuat);
  _up.set(0, 1, 0).applyQuaternion(cameraQuat);
  const sx = _long.dot(_right), sy = _long.dot(_up);
  if (Math.hypot(sx, sy) > 1e-3) return Math.atan2(sy, sx);
  const [ax, ay, az] = state.angVel;
  const vx = ax * _right.x + ay * _right.y + az * _right.z;
  const vy = ax * _up.x + ay * _up.y + az * _up.z;
  return Math.hypot(vx, vy) > 1e-4 ? Math.atan2(vy, vx) : 0;
}

/** The two transform slots a billboard writes. Structural, so a test needs no
 *  renderer and no scene — `THREE.Object3D` satisfies it. */
export interface BillboardTarget {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Place + face + roll one piece. Camera-space because the roll depends on
 *  where the camera is looking, which a billboard node in the material could
 *  not know. */
export function applySpritePose(
  target: BillboardTarget, state: Chunk, cameraQuat: THREE.Quaternion,
): void {
  target.position.set(state.pos[0], state.pos[1], state.pos[2]);
  // Camera first, then a roll about the quad's OWN normal (local +Z), so the
  // roll is in the screen plane whatever direction the camera faces.
  target.quaternion.copy(cameraQuat);
  _roll.setFromAxisAngle(_viewNormal, spriteRollRad(state, cameraQuat));
  target.quaternion.multiply(_roll);
}

/**
 * Place + ORIENT a real mesh piece — no camera involvement at all.
 *
 * A carved piece is a genuine 3D body part, so it must NOT billboard: its
 * orientation IS the chunk's own `quat`, the same quaternion `stepChunk`
 * integrates and topples flat on landing. That is the whole difference between
 * this and `applySpritePose`, and it is why a carved piece keeps reading as a
 * chunk of anatomy while a billboard always faces the viewer.
 *
 * SQUASH is carried as a scale, the same non-uniform deformation the marched
 * chunk path applies (its `squashFactors`), so the impact-wetness cue survives
 * the renderer change rather than becoming a mesh-only regression.
 */
export function applyMeshPose(target: BillboardTarget, state: Chunk): void {
  target.position.set(state.pos[0], state.pos[1], state.pos[2]);
  target.quaternion.set(state.quat[0], state.quat[1], state.quat[2], state.quat[3]);
  const s = Math.min(1, Math.max(0, state.squash));
  const sc = (target as { scale?: THREE.Vector3 }).scale;
  // Structural target: a test may pass an object without a scale, and a piece
  // without one simply does not squash.
  if (sc) sc.set(1 + s * 0.35, 1 - s * 0.5, 1 + s * 0.35);
}

/** The shared unit plane, plus this frame's shared material. See
 *  `SpritePieceSet.assets` for why the geometry is a unit plane and the size is
 *  a mesh scale rather than a second cache key. */
function spriteAssets(set: SpritePieceSet, frame: GibSpriteFrame): {
  geometry: THREE.PlaneGeometry; material: THREE.MeshBasicNodeMaterial;
} {
  let geometry = set.assets.unitPlane;
  if (!geometry) {
    geometry = new THREE.PlaneGeometry(1, 1);
    set.assets.unitPlane = geometry;
  }
  let material = set.assets.material.get(frame.picnum);
  if (!material) {
    // The mesh `makeGibSprite` would have built, decomposed: same texture clone,
    // same cut-out settings, but shared rather than per-piece. Built at any size
    // (the quad is scaled anyway) and its own geometry thrown away.
    const mesh = makeGibSprite(frame, 1);
    material = mesh.material as THREE.MeshBasicNodeMaterial;
    mesh.geometry.dispose();
    set.assets.material.set(frame.picnum, material);
  }
  return { geometry, material };
}

/**
 * Spawn one billboarded piece. Mirrors `spawnChunkPiece`'s inputs (origin,
 * extent, long axis, kind, seed) because the CALLER has already decided the
 * piece set and the launch velocity; nothing here re-derives the gib.
 */
export function spawnSpritePiece(
  set: SpritePieceSet,
  opts: {
    state: Chunk;
    /** Absent for `render: 'mesh'`, which brings its own geometry. */
    frame?: GibSpriteFrame | null;
    /** Overrides the diameter-derived quad height — used by the bench. */
    sizeM?: number;
    impulseDelay?: number;
    impulseVel?: Chunk['vel'] | null;
    sizeScale?: number;
    /** Defaults to 'billboard' — the sprite path's original shape. */
    render?: 'billboard' | 'mesh';
    /** A MESH piece already has its own geometry; `frame` is then unused. */
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material;
  },
): SpritePiece {
  const sizeM = opts.sizeM
    ?? Math.max(0.02, 2 * opts.state.radius * (opts.sizeScale ?? GIB_SPRITE_TUNING.sizeScale));
  const render = opts.render ?? 'billboard';
  if (render === 'mesh' && (!opts.geometry || !opts.material)) {
    // A mesh piece without its own geometry is a programming error, not a
    // runtime condition to paper over: falling back to a billboard here would
    // silently draw the sprite sheet and look like the carve mode "not working".
    throw new Error('spawnSpritePiece: render=mesh needs geometry and material');
  }
  const geometry = render === 'mesh' ? opts.geometry! : spriteAssets(set, opts.frame!).geometry;
  const material = render === 'mesh' ? opts.material! : spriteAssets(set, opts.frame!).material;
  const mesh = new THREE.Mesh(geometry, material);
  // The sprite's OWN aspect, so a long leg gib stays a long thin rectangle and a
  // skull stays square — forcing both into one quad throws away the silhouette
  // that distinguishes them. Carried on the SCALE, not the geometry (see
  // `SpritePieceSet.assets`).
  // A MESH piece carries its own real dimensions and must NOT be scaled by the
  // sprite sizing rule; its scale is the squash deformation (set per frame).
  if (render === 'billboard') {
    const aspect = (opts.frame?.h ?? 0) > 0 ? opts.frame!.w / opts.frame!.h : 1;
    mesh.scale.set(sizeM * aspect, sizeM, 1);
  }
  // Named by what it IS: a carved piece is not a sprite frame and must not claim
  // to be one in the scene graph, where rigs and captures read these names.
  mesh.name = render === 'mesh'
    ? `gib-carved-${opts.state.limb as unknown as string}`
    : `gib-sprite-piece-${opts.frame!.picnum}`;
  mesh.visible = !set.hidden;
  const piece: SpritePiece = {
    id: set.nextId++, state: opts.state, mesh, frame: opts.frame ?? null, sizeM,
    resting: false, render,
    impulseDelay: opts.impulseDelay ?? 0,
    impulseVel: opts.impulseVel ? [opts.impulseVel[0], opts.impulseVel[1], opts.impulseVel[2]] : null,
  };
  set.group.add(mesh);
  set.live.push(piece);
  return piece;
}

/** Unparent a piece. Geometry and material are SHARED (`spriteAssets`), so there
 *  is deliberately nothing to dispose here — and disposing the material's
 *  texture would be actively wrong: three r185's `Texture.copy` shares the
 *  sheet's `Source`, so one piece's clone dying would blank every sibling. */
function detach(set: SpritePieceSet, p: SpritePiece): void {
  set.group.remove(p.mesh);
  // The ONE retirement point (eviction over a cap, clear, or reset). An asset
  // piece returns its per-instance geometry to the pool here.
  p.onDetach?.();
}

export interface SpriteStepOptions {
  dt: number;
  cameraQuat: THREE.Quaternion;
  /** Walls/ceilings/floor, exactly as `stepChunk` takes them. */
  collidersAt?: (pos: Chunk['pos']) => ChunkColliders | undefined;
  liveCap?: number;
  restCap?: number;
}

/**
 * Step every live piece, re-pose every piece, and retire what has settled.
 *
 * SETTLE AND RETIRE: the marched path hands a settled chunk to the bake worker
 * and drops it from the sim. Here a settled piece just stops integrating — the
 * quad is already static geometry, so the "bake" would be a copy of itself.
 * That is also why this is the ONE place the sprite path does less than the
 * marched one, and it is where the owner's "tubes and orbs" degradation is
 * retired: nothing here ever needs the pool to make room.
 */
export function stepSpritePieces(set: SpritePieceSet, o: SpriteStepOptions): {
  dropped: number; rested: number; stepping: number;
} {
  const liveCap = o.liveCap ?? GIB_SPRITE_TUNING.liveCap;
  const restCap = o.restCap ?? GIB_SPRITE_TUNING.restCap;
  let rested = 0;
  // Reverse: retiring splices out of `live`.
  for (let i = set.live.length - 1; i >= 0; i--) {
    const p = set.live[i]!;
    // The staged release. See SpritePiece.impulseDelay for why the delay is
    // decremented BEFORE the velocity is applied, and why a delay of 1 still
    // draws a frame at rest.
    if (p.impulseDelay > 0) {
      p.impulseDelay--;
    } else if (p.impulseVel) {
      p.state.vel = [p.impulseVel[0], p.impulseVel[1], p.impulseVel[2]];
      p.impulseVel = null;
    }
    // THE SAME PHYSICS THE MARCHED PIECES GET. Not a reimplementation, not a
    // simplified version: the same call, so walls, ceilings, the friction skid
    // and the settle rule cannot disagree between the two render modes.
    p.state = stepChunk(p.state, o.dt, o.collidersAt?.(p.state.pos));
    if (p.render === 'mesh') applyMeshPose(p.mesh, p.state);
    else applySpritePose(p.mesh, p.state, o.cameraQuat);
    p.onPose?.(p);
    if (chunkSettled(p.state)) {
      p.resting = true;
      set.live.splice(i, 1);
      set.rest.push(p);
      rested++;
    }
  }
  // Resting pieces are never stepped again, but they DO keep facing the camera:
  // a billboard left at its last flight orientation is a flat card on the floor
  // the moment the player walks around it.
  for (const p of set.rest) {
    if (p.render === 'mesh') applyMeshPose(p.mesh, p.state);
    else applySpritePose(p.mesh, p.state, o.cameraQuat);
    p.onPose?.(p);
  }

  let dropped = 0;
  while (set.live.length > liveCap) {
    const oldest = set.live.shift();
    if (!oldest) break;
    detach(set, oldest);
    dropped++;
  }
  // Oldest-first on the pile too: the newest gore is the gore the player just
  // made, so the oldest is the one nobody is looking at.
  while (set.rest.length > restCap) {
    const oldest = set.rest.shift();
    if (!oldest) break;
    detach(set, oldest);
    dropped++;
  }
  return { dropped, rested, stepping: set.live.length };
}

/** Hide/show every piece, live AND resting, without destroying them — the same
 *  A/B the benches expose, so a capture can prove a blast's sprites are DRAWN
 *  rather than merely in the scene graph. New spawns inherit the flag. */
export function setSpritePiecesVisible(set: SpritePieceSet, on: boolean): boolean {
  set.hidden = !on;
  for (const p of set.live) p.mesh.visible = !set.hidden;
  for (const p of set.rest) p.mesh.visible = !set.hidden;
  return !set.hidden;
}

/** Drop every piece and give back the shared assets. The ATLAS's textures are
 *  not touched — the atlas owns them (and shares one `Source` across frames). */
export function clearSpritePieces(set: SpritePieceSet): number {
  const n = set.live.length + set.rest.length;
  for (const p of set.live) detach(set, p);
  for (const p of set.rest) detach(set, p);
  set.live.length = 0;
  set.rest.length = 0;
  set.assets.unitPlane?.dispose();
  set.assets.unitPlane = null;
  for (const m of set.assets.material.values()) m.dispose();
  set.assets.material.clear();
  return n;
}

/** WHERE EVERY SPRITE PIECE IS — the sprite twin of `chunkStates()`, so a rig
 *  that watches a gib fly does not care which render mode made it. */
export function spritePieceStates(set: SpritePieceSet): {
  id: number; limb: string; kind: string; rest: boolean;
  pos: Chunk['pos']; vel: Chunk['vel']; quat: Chunk['quat']; radius: number; settled: boolean;
}[] {
  return [...set.live, ...set.rest].map(p => ({
    id: p.id, limb: p.state.limb as unknown as string, kind: p.state.kind,
    rest: p.resting, pos: p.state.pos, vel: p.state.vel, quat: p.state.quat, radius: p.state.radius,
    settled: chunkSettled(p.state),
  }));
}
