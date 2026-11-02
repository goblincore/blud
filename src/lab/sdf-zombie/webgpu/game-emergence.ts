// src/lab/sdf-zombie/webgpu/game-emergence.ts
//
// THE EGG EMERGES IN THE FLAT (plan docs/superpowers/plans/2026-10-16-emergence-in-the-flat.md Task 7; spec
// docs/superpowers/specs/2026-10-16-emergence-in-the-flat-design.md sections 3 and 4): the screen emergence lab's scene played in the real
// level, on ctx.world.emergence. On `?emergence=1` or the level `flat-early` (`?emergence=0` turns it off):
//  - THE SET on the Flat's kotatsu, where emergence-placement.ts puts the screen frame (the glass centre at game (0.12, 0.76, -2.315),
//    facing south): screen-set.ts's CRT, keyboard and banker's lamp (its PointLight dropped: the level has a `lamp` light at the bulb and a
//    `crt` glow light), and a placeholder glass with the picture while nothing plays. Their meshes are flattened into the level group
//    BEFORE the per-room light lists are assigned, so the room's lights light them like the walls (game-main's light-list pass only
//    converts the group's direct children). The zabuton too, in the goblin's frame, sliding with his scoot.
//  - THE SCREEN PASS (screen-pass.ts) on a proxy placed as the screen, in the SDF layer's late scene (adoptEmergenceFx, the adoptEggFx
//    pattern), shown while the sequence plays and after it (held at t = DURATION: the egg stays on the keyboard in its goo).
//  - THE GOBLIN PUPPET (goblin-puppet.ts), built in adoptEmergenceFx from the SDF layer's dependencies as game-spawn.ts passes them to a
//    body (legacy: cone, occluder, shell, prev, lastFrame, depthPre, refine; deferred: the surface output and the router's registrations),
//    under an identity-transform group in the scene; the seat measured off his typing pose as the lab page does (measureSeat,
//    floorLayout) and his frame placed from it; lit with the key toward the banker's lamp, a flat fill and NO rim (GAME_RIM, GAME_FILL:
//    the old key path, not the level's light list). Hidden except while the sequence plays (the boot warm flips hidden objects visible
//    to compile them, so his pipeline is built behind the loader).
//  - THE SEQUENCE (emergence-camera.ts sequenceFor, registered with ending-sequence.ts registerSequence) on the game's sequence system:
//    the camera override, the gun and HUD hidden, input blocked, its clock on the sim step. `?emergence=1` starts it 2 s (sim time)
//    after the level is ready (emergenceLevelReady, from the warm gate). While it plays the viewmodel's orb hands are hidden (the sequence
//    runtime hides only the gun) and the flashlight is held off (its hot spot, riding the player's camera, blew the close shots out) and left off at the hand-off.
//  - THE HAND-OFF at its end: the puppet hidden, the player stood on his spot looking at the egg (emergence-camera.ts handoffFor), the
//    sequence runtime cleared (its overlay, the HUD back, the fov restored, the hands back; the flashlight stays off) so input returns
//    and it can run again, and for RISE_S the view rises from his seated eye to the player's own (applyEmergenceCamera, after
//    applySequenceCamera).
// Seams: `__sdfGame.emergence()`, `startEmergence()`, `skipEmergence()`, `emergenceSetT(t, hold = true)`.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { FLAT_KOTATSU, placementFor, toWorld, type Placement } from './emergence-placement';
import { DESK_Y, GLASS, KOTATSU, TABLE_FRONT_Z, eggCentre } from './emergence-field';
import { DURATION, paramsAt } from './emergence-timeline';
import { createScreenPass, updateScreenPass, type ScreenPass } from './screen-pass';
import { LAMP_BULB, buildCrt, buildKeyboard, buildLamp, buildZabuton } from './screen-set';
import { createGoblinPuppet, type GoblinPuppet } from './goblin-puppet';
import { GOBLIN_CUES, GOBLIN_FPS, floorLayout, measureSeat, type FloorLayout } from './screen-lab-goblin';
import { expressionChannelsAt, expressionCues, type ExpressionCue } from './emergence-expressions';
import {
  EMERGENCE_SEQUENCE_ID, RISE_S, handoffFor, presetAt, riseAt, sequenceFor, type Handoff,
} from './emergence-camera';
import { registerSequence, totalDuration, type Sequence } from './ending-sequence';
import { startSequence, type SequenceRuntime } from './game-sequence';
import type { GpuViewOpts } from './zombie-gpu';
import type { SdfLayer } from './sdf-layer';
import { applyRoomFill, applySelfShadow, applyWindowKey } from './game-dynamic-light';
import { rotateYaw } from '../gait';
import type { Vec3 } from '../types';

/** The autostart's delay after the level is ready (sim seconds). */
export const AUTOSTART_S = 2;
/** The picture on the CRT (sRGB). */
const PICTURE_URL = '/assets/lab/screen-source.png';
/** The lab's typing pose time, held to measure the seat (screen-lab-main.ts: `floor-type`, before any scoot). */
const MEASURE_T = 1.0;
/** His glass-to-hips layout as the lab measures it (screen-lab-goblin.test.ts pins it): a measure further off than this is reported. */
const NOMINAL_GLASS = { y: 0.705, z: 0.865 } as const;

export type EmergencePhase = 'idle' | 'playing' | 'done';

export interface EmergenceRuntime {
  placement: Placement;
  /** `?emergence=1`: start AUTOSTART_S after the level is ready. */
  autostart: boolean;
  autostarted: boolean;
  ready: boolean;
  sinceReady: number;
  phase: EmergencePhase;
  /** The sequence clock last applied (s). */
  t: number;
  /** A held clock (the check's emergenceSetT): re-applied every step while playing; null runs free. */
  hold: number | null;
  seq: Sequence;
  handoff: Handoff;
  /** Seconds since the hand-off while the view rises; null when not rising. */
  rise: number | null;
  /** The flattened set meshes (in the level group), the placeholder glass among them. */
  setMeshes: THREE.Mesh[];
  glass: THREE.Mesh;
  pass: ScreenPass;
  /** Built in adoptEmergenceFx (it needs the SDF layer); null before, or when it failed (errors). */
  puppet: GoblinPuppet | null;
  puppetParent: THREE.Group;
  layout: FloorLayout | null;
  goblinOrigin: Vec3;
  goblinYaw: number;
  zabuton: { mesh: THREE.Mesh; base: THREE.Vector3 }[];
  faceCues: ExpressionCue[];
  deferredRegistered: boolean;
  /** The last step's CPU cost (ms): the puppet's pose and upload, the pass's update (the goo replay among it). */
  cpuMs: { puppet: number; pass: number };
  errors: string[];
}

/** Move every mesh under `src` into `dst` keeping its world placement (the level group's light-list pass converts only its direct mesh
 *  children). */
function flattenInto(src: THREE.Object3D, dst: THREE.Object3D): THREE.Mesh[] {
  src.updateMatrixWorld(true);
  dst.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  src.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const inv = new THREE.Matrix4().copy(dst.matrixWorld).invert();
  for (const m of meshes) {
    const local = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    local.decompose(m.position, m.quaternion, m.scale);
    dst.add(m);
  }
  return meshes;
}

/** Build the set and the pass (after the level art exists, before the per-room light lists). Null unless `?emergence=1` or the level is
 *  `flat-early`. */
export function createEmergence(ctx: GameContext): EmergenceRuntime | null {
  const q = new URLSearchParams(location.search);
  const param = q.get('emergence');
  if (param === '0' || (param !== '1' && ctx.world.level.id !== 'flat-early')) return null;
  const placement = placementFor(FLAT_KOTATSU, [0, DESK_Y, TABLE_FRONT_Z - KOTATSU.d / 2], DESK_Y);
  const origin = placement.origin;

  // The set, in the screen frame, flattened into the level group.
  const screen = new THREE.Group();
  screen.position.set(origin[0], origin[1], origin[2]);
  screen.rotation.y = placement.yaw;
  buildCrt(screen);
  buildKeyboard(screen);
  const lampLight = buildLamp(screen);
  lampLight.removeFromParent();   // the level's own `lamp` light sits at the bulb
  lampLight.dispose();
  const picture = new THREE.TextureLoader().load(PICTURE_URL, undefined, undefined,
    () => console.error(`[emergence] picture ${PICTURE_URL} failed to load`));
  picture.colorSpace = THREE.SRGBColorSpace;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(GLASS.hw * 2, GLASS.hh * 2), new THREE.MeshBasicMaterial({ map: picture }));
  glass.name = 'emergence.placeholder-glass';
  glass.userData.skipLevelLights = true;
  screen.add(glass);
  const setMeshes = flattenInto(screen, ctx.world.levelGroup);
  for (const m of setMeshes) {
    if (m !== glass) m.name = m.name || 'emergence.set';
    m.castShadow = false;
    m.receiveShadow = m !== glass;
  }

  // The pass: placed as the screen (unscaled), moved to the late scene by adoptEmergenceFx; hidden until the sequence runs.
  const pass = createScreenPass(picture, { lampBulb: LAMP_BULB });
  pass.proxy.position.set(origin[0], origin[1], origin[2]);
  pass.proxy.rotation.y = placement.yaw;
  pass.proxy.visible = false;
  pass.proxy.userData.skipLevelLights = true;
  ctx.boot.handle.scene.add(pass.proxy);

  const puppetParent = new THREE.Group();
  puppetParent.name = 'emergence.puppet';
  ctx.boot.handle.scene.add(puppetParent);   // identity: the teeth's bones are posed in world space

  const seq = sequenceFor(placement);
  registerSequence(seq);
  const rt: EmergenceRuntime = {
    placement, autostart: param === '1', autostarted: false, ready: false, sinceReady: 0,
    phase: 'idle', t: 0, hold: null, seq, handoff: handoffFor(placement), rise: null,
    setMeshes, glass, pass, puppet: null, puppetParent, layout: null,
    goblinOrigin: toWorld(placement, [0, -NOMINAL_GLASS.y, NOMINAL_GLASS.z]), goblinYaw: placement.yaw + Math.PI,
    zabuton: [], faceCues: expressionCues(GOBLIN_CUES), deferredRegistered: false, cpuMs: { puppet: 0, pass: 0 }, errors: [],
  };
  ctx.world.emergence = rt;
  return rt;
}

/** The slice of the SDF layer the puppet's view binds. */
export type PuppetLayerDeps = Pick<SdfLayer, 'cone' | 'occluder' | 'prev' | 'lastFrame' | 'depthPre' | 'refineSource'>;

/** The SDF layer's dependencies for the puppet's view, as game-spawn.ts hands them to a body, less the game's per-actor extras (the
 *  tile playtest binding, the shared light list, the dynamic probes and the level shadow, which the per-actor loop feeds every frame and
 *  the puppet, lit the lab's way, does not use) and LESS THE OUTER-HULL SHELL. The shell (shell-hull-outer.ts, on by default) is built
 *  every tick from `ctx.world.actors` only (game-tick.ts); the puppet is not an actor, so no hull instance ever covered him, his march
 *  read shellOut 0 at every pixel of his proxy and discarded them all (hull-bounds.wgsl.ts `shellOut <= 0`): the goblin was never drawn
 *  in the game (measured: 0 march-target hits with the shell on, 4022 with it off, at t 5.5). Without a shell source the march takes
 *  the fetch identities (shellIn 0, shellOut 1e9), as on the lab page. `lab: true` (`?emergencegpu=lab`) binds only what the lab page
 *  hands its puppet (the cone and the occluder), for an A/B against the game's set. */
export function puppetGpuOpts(layer: PuppetLayerDeps, mode: { deferred: boolean; lab: boolean }): GpuViewOpts {
  if (mode.deferred) return { output: 'surface', shadowReceiver: 'level-only' };
  if (mode.lab) return { cone: layer.cone, occluder: layer.occluder };
  return {
    cone: layer.cone,
    occluder: layer.occluder,
    prev: layer.prev,
    lastFrame: layer.lastFrame,
    depthPre: layer.depthPre,
    refine: layer.refineSource ?? undefined,
  };
}

/** His lighting in the room (owner look 2026-10-18: "a weird white fuzzy cobweb material around him"). The puppet's cold rim (GOBLIN_RIM 1.5,
 *  compose.wgsl.ts spotCfg2.w: pow(1 - n.v, 4) x the key side, rimC up to 1.3, not clamped) is tuned in the lab at 640 x 480; on the
 *  unstable normals of a silhouette at the game's 320 x 240 it throws white HDR sparks onto the air round him and across his chest and
 *  arms (A/B in one boot: gone at rim 0, worse with the footprint accept off). No rim, and a fill of 0.30 (was 0.10) so his back reads
 *  against the room's warm lamp. The lab page keeps GOBLIN_RIM / GOBLIN_FILL. */
const GAME_RIM = 0;
const GAME_FILL = 0.30;
/** His key follows the room's lamps as a zombie's does (owner 2026-10-20: "light the goblin properly from the room's lamps"): each step
 *  the game's own path for a body that is not on the shared light list (the default): applyWindowKey (the key toward the lamp that
 *  presents him, its colour and live level, flicker included), applyRoomFill (the fill follows the room's lamps) and applySelfShadow,
 *  from his place in the room. `?emergencekey=0` keeps the fixed key aimed at the banker's lamp (the lab's), for an A/B. */
const ROOM_KEY = typeof location === 'undefined' || new URLSearchParams(location.search).get('emergencekey') !== '0';
/** spotCfg2's x, y, z as the puppet was built (applyWindowKey ADDS the lamp's key to z each call: it is re-based every step, as the
 *  game's actor loop re-writes spotCfg2 before it). */
const keyBase = new WeakMap<GoblinPuppet, { spot: [number, number, number]; color: THREE.Color }>();
/** How much of the lamp's COLOUR his key takes (0 = the preset's own colour, 1 = the lamp's, as a zombie's). The Flat's lamps are a deep
 *  orange: at 1 it turned his green skin to brown (look 2026-10-20), so he takes the lamp's direction, strength and flicker and only a
 *  little of its colour. `?emergencetint=` overrides it. */
const KEY_TINT = 0.25;

/** The game's key, fill and self-shadow for the puppet, by his place in the room. The rim stays GAME_RIM (applyWindowKey writes a lamp rim). */
function litFromRoom(ctx: GameContext, rt: EmergenceRuntime, puppet: GoblinPuppet): void {
  const u = puppet.gpu.uniforms;
  let base = keyBase.get(puppet);
  if (!base) { base = { spot: [u.spotCfg2.value.x, u.spotCfg2.value.y, u.spotCfg2.value.z], color: u.keyColor.value.clone() }; keyBase.set(puppet, base); }
  u.spotCfg2.value.set(base.spot[0], base.spot[1], base.spot[2], GAME_RIM);
  const o = rt.goblinOrigin;
  applyWindowKey(ctx, u as never, [o[0], o[1], o[2]]);
  // The lamp's direction, strength and flicker, a little of its colour.
  const tint = new URLSearchParams(location.search).get('emergencetint');
  u.keyColor.value.copy(base.color).lerp(u.keyColor.value.clone(), tint !== null && Number.isFinite(Number(tint)) ? Number(tint) : KEY_TINT);
  applyRoomFill(ctx, u as never, o[0], o[2]);
  applySelfShadow(u as never);
  u.spotCfg2.value.w = GAME_RIM;
}

/** Once the SDF layer exists (before the per-room light lists): the pass into its late scene, the puppet built from its dependencies,
 *  the seat measured, the zabuton. */
export function adoptEmergenceFx(ctx: GameContext): void {
  const rt = ctx.world.emergence;
  const late = ctx.render.sdfLayer?.lateScene;
  if (!rt || !late) return;
  late.add(rt.pass.proxy);
  let puppet: GoblinPuppet;
  try {
    const gpu = puppetGpuOpts(ctx.render.sdfLayer, {
      deferred: ctx.boot.deferredMode, lab: new URLSearchParams(location.search).get('emergencegpu') === 'lab',
    });
    puppet = createGoblinPuppet({ renderer: ctx.boot.handle.renderer, gpu, parent: rt.puppetParent, errors: rt.errors });
  } catch (e) {
    rt.errors.push(`puppet: ${e instanceof Error ? e.message : String(e)}`);
    console.error('[emergence] the goblin puppet failed to build', e);
    return;
  }
  for (const e of rt.errors) console.error(`[emergence] goblin: ${e}`);
  // The seat, measured off the typing pose in his own frame (the placement at the origin), as the lab page builds its set.
  let layout: FloorLayout | null = null;
  try {
    for (let i = 0; i < 2; i++) puppet.step(MEASURE_T, 1 / 60, { fps: GOBLIN_FPS });
    layout = floorLayout(measureSeat(puppet.step(MEASURE_T, 1 / 60, { fps: GOBLIN_FPS }).prims));
  } catch (e) {
    rt.errors.push(`seat: ${e instanceof Error ? e.message : String(e)}`);
    console.error('[emergence] measuring the seat failed; the nominal layout stands', e);
  }
  rt.layout = layout;
  const glassY = layout?.glassY ?? NOMINAL_GLASS.y, glassZ = layout?.glassZ ?? NOMINAL_GLASS.z;
  if (Math.abs(glassY - NOMINAL_GLASS.y) > 0.01 || Math.abs(glassZ - NOMINAL_GLASS.z) > 0.01) {
    console.warn(`[emergence] measured glass ${glassY.toFixed(3)} m over his floor, ${glassZ.toFixed(3)} m in front of him (the lab's ${NOMINAL_GLASS.y}, ${NOMINAL_GLASS.z})`);
  }
  // His frame: the hips glassY under and glassZ in front of the glass, facing it (his +z = world -z).
  rt.goblinOrigin = toWorld(rt.placement, [0, -glassY, glassZ]);
  puppet.setPlacement(rt.goblinOrigin, rt.goblinYaw);
  {
    // The key toward the banker's lamp from his chest, the cold rim and the flat fill (the lab's by-eye values; ?emergencerim= and
    // ?emergencefill= override them for tuning in the room).
    const q = new URLSearchParams(location.search);
    const num = (k: string) => { const v = q.get(k); return v !== null && Number.isFinite(Number(v)) ? Number(v) : null; };
    const lamp = toWorld(rt.placement, [LAMP_BULB[0], LAMP_BULB[1], LAMP_BULB[2]]);
    const c = rotateYaw([0, 0.95, 0.15], rt.goblinYaw);
    const chest: Vec3 = [rt.goblinOrigin[0] + c[0], rt.goblinOrigin[1] + c[1], rt.goblinOrigin[2] + c[2]];
    const d = new THREE.Vector3(lamp[0] - chest[0], lamp[1] - chest[1], lamp[2] - chest[2]).normalize();
    puppet.setLighting({ dir: [d.x, d.y, d.z], rim: num('emergencerim') ?? GAME_RIM, fill: num('emergencefill') ?? GAME_FILL });
  }
  // The zabuton in his frame (its top at the measured seat), flattened into the level group like the set; slid with his scoot.
  {
    const frame = new THREE.Group();
    frame.position.set(rt.goblinOrigin[0], rt.goblinOrigin[1], rt.goblinOrigin[2]);
    frame.rotation.y = rt.goblinYaw;
    buildZabuton(frame, layout?.seatTopY ?? 0.12);
    for (const m of flattenInto(frame, ctx.world.levelGroup)) {
      m.name = 'emergence.zabuton';
      m.receiveShadow = true;
      rt.zabuton.push({ mesh: m, base: m.position.clone() });
    }
  }
  // The first pose (t = 0, typing) uploaded, then hidden until the sequence plays.
  stepPuppet(ctx, rt, puppet, 0);
  puppet.setVisible(false);
  rt.puppet = puppet;
  console.info(`[emergence] set at the kotatsu (glass ${toWorld(rt.placement, [0, 0, 0]).map(v => v.toFixed(3)).join(', ')}); the goblin at ${rt.goblinOrigin.map(v => v.toFixed(3)).join(', ')}${layout ? `, seat ${layout.seatTopY.toFixed(3)} m` : ''}`);
}

function stepPuppet(ctx: GameContext, rt: EmergenceRuntime, puppet: GoblinPuppet, t: number): void {
  puppet.step(t, 1 / 60, {
    fps: GOBLIN_FPS,
    channelsAt: (tt: number) => expressionChannelsAt(tt, rt.faceCues),
    pixelConeK: ctx.render.sdfLayer?.pixelConeK,
  });
  if (ROOM_KEY) litFromRoom(ctx, rt, puppet);
  // The zabuton rides his scoot (along his +z, turned by his yaw).
  const o = rotateYaw([0, 0, puppet.rootDz], rt.goblinYaw);
  for (const z of rt.zabuton) z.mesh.position.set(z.base.x + o[0], z.base.y + o[1], z.base.z + o[2]);
}

/** The level is ready (the warm gate settled): the autostart's clock starts. */
export function emergenceLevelReady(ctx: GameContext): void {
  if (ctx.world.emergence) ctx.world.emergence.ready = true;
}

/** Start the emergence (again, after a hand-off). False without the runtime or the puppet, or while another sequence runs. */
export function startEmergence(ctx: GameContext): boolean {
  const rt = ctx.world.emergence;
  if (!rt?.puppet || rt.phase === 'playing') return false;
  if (!startSequence(ctx, EMERGENCE_SEQUENCE_ID)) return false;
  rt.phase = 'playing';
  rt.t = 0;
  rt.hold = null;
  rt.rise = null;
  rt.autostarted = true;
  ctx.telemetry.telemetry.event('emergence-start', {});
  return true;
}

const mineOf = (ctx: GameContext): SequenceRuntime | null => {
  const s = ctx.world.sequence;
  return s && s.seq.id === EMERGENCE_SEQUENCE_ID ? s : null;
};

/** The hand-off: the puppet away, the player on his spot looking at the egg, the sequence runtime cleared (overlay, HUD, fov). */
function handOff(ctx: GameContext, rt: EmergenceRuntime, mine: SequenceRuntime | null): void {
  rt.phase = 'done';
  rt.t = DURATION;
  rt.hold = null;
  rt.puppet?.setVisible(false);
  setViewmodelHands(ctx, true);
  // The flashlight stays OFF after the hand-off (owner 2026-10-19): the Flat is lit by its own lamps; the player can switch it back on.
  const h = rt.handoff, p = ctx.player.player;
  p.pos[0] = h.feet[0]; p.pos[1] = h.feet[1]; p.pos[2] = h.feet[2];
  p.vel[0] = 0; p.vel[1] = 0; p.vel[2] = 0;
  p.yaw = h.yaw;
  p.pitch = h.pitch;
  p.grounded = true;
  p.stepLag = 0;
  if (mine) {
    const cam = ctx.boot.handle.camera;
    if (mine.fovBase > 0 && Math.abs(cam.fov - mine.fovBase) > 1e-4) {
      cam.fov = mine.fovBase;
      cam.updateProjectionMatrix();
      ctx.render.postAa.setLens(cam.fov, ctx.player.centerFovDeg);
    }
    mine.el.remove();
    const loop = ctx.world.loop;
    if (loop) { loop.el.status.style.display = ''; loop.el.hurt.style.display = ''; }
    ctx.world.sequence = null;
  }
  rt.rise = 0;
  ctx.telemetry.telemetry.event('emergence-handoff', { feet: h.feet, yaw: h.yaw, pitch: h.pitch });
}

/** Per sim step, after stepSequence: the autostart, the sequence's clock onto the pass and the puppet, the hand-off at its end. */
export function stepEmergence(ctx: GameContext, dt: number): void {
  const rt = ctx.world.emergence;
  if (!rt) return;
  // DEFERRED MODE: the router exists only after the SDF layer (game-main creates it later in boot): register once it does, as
  // game-spawn registers a body (the proxy is the SDF producer, the twins excluded, the teeth level-only tissue).
  if (!rt.deferredRegistered && rt.puppet && ctx.boot.deferredApi) {
    const r = ctx.boot.deferredApi.router, g = rt.puppet.gpu;
    r.register(rt.puppetParent, 'mesh', 'level-only');
    r.register(g.object, 'sdf');
    r.register(g.coneObject, 'exclude');
    if (g.depthPreObject) r.register(g.depthPreObject, 'exclude');
    if (g.refineObject) r.register(g.refineObject, 'exclude');
    rt.deferredRegistered = true;
  }
  if (rt.autostart && !rt.autostarted && rt.ready && rt.phase === 'idle') {
    rt.sinceReady += dt;
    if (rt.sinceReady >= AUTOSTART_S) { rt.autostarted = true; startEmergence(ctx); }
  }
  if (rt.phase === 'playing') {
    const mine = mineOf(ctx);
    if (mine && rt.hold !== null) mine.t = rt.hold;
    if (!mine || mine.finished) handOff(ctx, rt, mine);
    else {
      rt.t = Math.min(DURATION, mine.t);
      // The view is the sequence's: no hands in it (the sequence runtime hides the gun only), no flashlight.
      setViewmodelHands(ctx, false);
      const torch = ctx.world.light?.flashlight;
      if (torch) { torch.level = 0; torch.target = 0; }
      const c0 = performance.now();
      if (rt.puppet) { rt.puppet.setVisible(true); stepPuppet(ctx, rt, rt.puppet, rt.t); }
      const c1 = performance.now();
      showPass(ctx, rt, rt.t);
      rt.cpuMs.puppet = c1 - c0;
      rt.cpuMs.pass = performance.now() - c1;
      return;
    }
  }
  if (rt.phase === 'done') {
    showPass(ctx, rt, DURATION);
    if (rt.rise !== null) { rt.rise += dt; if (rt.rise >= RISE_S) rt.rise = null; }
  }
}

/** The viewmodel's orb hands (the arms, outside the gun group the sequence runtime hides). Meshes only: no light changes visibility, so
 *  nothing re-keys the light lists. */
function setViewmodelHands(ctx: GameContext, on: boolean): void {
  for (const g of [ctx.weapon.gripHandGroup, ctx.weapon.foreHandGroup]) if (g) g.visible = on;
}

function showPass(ctx: GameContext, rt: EmergenceRuntime, t: number): void {
  rt.pass.proxy.visible = true;
  rt.glass.visible = false;
  updateScreenPass(rt.pass, t, { camera: ctx.boot.handle.camera, heightPx: ctx.boot.handle.renderer.domElement.height });
}

/** After the sequence camera: for RISE_S after the hand-off the view rises from his seated eye to the player's own, looking from the egg
 *  to wherever the player looks. */
export function applyEmergenceCamera(ctx: GameContext, camera: THREE.PerspectiveCamera): void {
  const rt = ctx.world.emergence;
  if (!rt || rt.rise === null) return;
  const k = riseAt(rt.rise / RISE_S);
  const h = rt.handoff;
  const live = camera.position.clone();
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const dist = Math.hypot(h.look[0] - live.x, h.look[1] - live.y, h.look[2] - live.z);
  const liveLook = live.clone().addScaledVector(fwd, dist);
  camera.position.set(
    h.seatedEye[0] + (live.x - h.seatedEye[0]) * k, h.seatedEye[1] + (live.y - h.seatedEye[1]) * k, h.seatedEye[2] + (live.z - h.seatedEye[2]) * k);
  camera.lookAt(h.look[0] + (liveLook.x - h.look[0]) * k, h.look[1] + (liveLook.y - h.look[1]) * k, h.look[2] + (liveLook.z - h.look[2]) * k);
}

/** Seams: `__sdfGame.emergence()`, `startEmergence()`, `skipEmergence()` (jump the clock to the end: the next step hands off) and
 *  `emergenceSetT(t, hold = true)` (set the clock while playing; held, every step re-applies it, so a capture lands exactly on t). */
export function createEmergenceSeams(ctx: GameContext) {
  const r3 = (v: readonly number[]) => v.map(x => +x.toFixed(3));
  return {
    emergence: () => {
      const rt = ctx.world.emergence;
      if (!rt) return null;
      const posed = rt.puppet?.posed;
      const skull = posed?.prims.filter(p => p.bone === 'skull' || p.bone === 'head') ?? [];
      const head = skull.length
        ? r3([0, 1, 2].map(i => skull.reduce((s, p) => s + (p.a[i]! + p.b[i]!) / 2, 0) / skull.length))
        : null;
      const p = ctx.player.player;
      return {
        phase: rt.phase, t: +rt.t.toFixed(3), hold: rt.hold, total: totalDuration(rt.seq),
        shot: rt.phase === 'playing' ? presetAt(rt.t).id : null,
        sequenceActive: !!mineOf(ctx)?.active,
        puppetBuilt: !!rt.puppet, puppetVisible: !!rt.puppet?.gpu.object.visible, clip: rt.puppet?.clipName ?? null,
        rootDz: rt.puppet ? +rt.puppet.rootDz.toFixed(3) : null, head,
        // The march's proxy box (world): where the layer draws him, and whether his teeth kit has arrived.
        puppetProxy: rt.puppet ? {
          pos: r3(rt.puppet.gpu.object.position.toArray()), scale: r3(rt.puppet.gpu.object.scale.toArray()),
          layers: rt.puppet.gpu.object.layers.mask, inScene: rt.puppet.gpu.object.parent === rt.puppetParent, kit: !!rt.puppet.view.kit,
        } : null,
        proxyVisible: rt.pass.proxy.visible, proxyInLateScene: rt.pass.proxy.parent?.name === 'sdf.late-fx', glassVisible: rt.glass.visible,
        eggCentre: r3(toWorld(rt.placement, eggCentre(paramsAt(rt.phase === 'idle' ? 0 : rt.t)))),
        glassCentre: r3(rt.placement.origin), goblinOrigin: r3(rt.goblinOrigin),
        layout: rt.layout ? { glassY: +rt.layout.glassY.toFixed(3), glassZ: +rt.layout.glassZ.toFixed(3), seatTopY: +rt.layout.seatTopY.toFixed(3), tableTopY: +rt.layout.tableTopY.toFixed(3) } : null,
        handoff: { feet: r3(rt.handoff.feet), seatedEye: r3(rt.handoff.seatedEye), yaw: +rt.handoff.yaw.toFixed(4), pitch: +rt.handoff.pitch.toFixed(4) },
        rising: rt.rise !== null,
        player: { pos: r3(p.pos), yaw: +p.yaw.toFixed(4), pitch: +p.pitch.toFixed(4) },
        cpuMs: { puppet: +rt.cpuMs.puppet.toFixed(2), pass: +rt.cpuMs.pass.toFixed(2) },
        autostart: rt.autostart, ready: rt.ready, errors: [...rt.errors],
      };
    },
    /** The goblin puppet itself (null before it is built): for tuning his uniforms from the console (`.gpu.uniforms`, `setLighting`). */
    emergencePuppet: () => ctx.world.emergence?.puppet ?? null,
    startEmergence: () => startEmergence(ctx),
    skipEmergence: () => {
      const rt = ctx.world.emergence, mine = mineOf(ctx);
      if (!rt || rt.phase !== 'playing' || !mine?.active) return false;
      rt.hold = null;
      mine.t = totalDuration(mine.seq);
      return true;
    },
    emergenceSetT: (t: number, hold = true) => {
      const rt = ctx.world.emergence, mine = mineOf(ctx);
      if (!rt || rt.phase !== 'playing' || !mine?.active) return false;
      // A held clock stays a step short of the end (stepSequence adds the step before this re-applies it: past the total it would finish).
      const v = Math.min(DURATION - (hold ? 0.3 : 1e-3), Math.max(0, t));
      mine.t = v;
      rt.hold = hold ? v : null;
      return true;
    },
  };
}
