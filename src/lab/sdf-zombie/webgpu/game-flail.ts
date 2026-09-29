// src/lab/sdf-zombie/webgpu/game-flail.ts
//
// WEAPON SLOT 1: THE SPIKE FLAIL (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md).
// The renderer-facing half ONLY: flail-swing.ts owns the swing and its poses,
// flail-strike.ts decides who a strike hits and where. Everything here is a
// child of the aim rig (haft, hand, chain, ball), posed from the swing's
// view-space keyframes; flail-chain.ts simulates the chain and ball between
// the eye bolt and the swing's ball key (spec §10.1). A strike becomes one
// 'blast' crater per hit through ZombieActor.blast(); the flail never
// decapitates (flail-strike.ts flailWound, spec §12.3). Not a recorded
// DemoFrame verb (like the flare).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { lights } from 'three/tsl';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import type { ZombieActor } from './game-actor';
import { clothifyWound, worldHitToWound, type Wound } from '../damage';
import { sdBody } from '../validate';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { loopBlocksInput, ownsSlot } from './game-loop-leaves';
import { BEND_R_VIEW } from './game-weapon-leaves';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms } from './game-arms';
import {
  FLAIL_IMPACT, FLAIL_TIMING, cancelFlailSwing, comboSide, flailBallVel, flailPose, makeFlailSwing, stepFlailSwing,
  type FlailSide, type FlailSwing,
} from './flail-swing';
import { FLAIL_ARC_DEG, flailWound, headNeck, isHeadRegion, resolveStrike, type StrikeActor } from './flail-strike';
import {
  FLAIL_CHAIN_SIM, chainTeleported, drawChain, guideWeight, linkRest, makeChain, stepChainInPlace, type ChainState, type ChainStepOpts,
} from './flail-chain';
import { reticleNdc } from './fisheye';
import { FLAIL_FILL_LAYER, GIB_BLUR_LAYER } from './gib-motion-blur';
import type { GibBlurSubject } from './gib-shutter-layer';
import {
  FLAIL_BLUR, FLAIL_BLUR_IDS, ballMotionState, chainSegmentStates, flailBlurActive, makeMotionState,
} from './flail-blur';
import {
  FLAIL_IMPACT_FEEL, chainRelax, clearTime, clearView, contact, impactKick, impactOutputs, makeImpactState,
  stepImpact, timeScale,
} from './flail-impact';

const FLAIL_GLB = '/assets/lab/flail.glb';

/** Feel numbers (spec §6, §11, §12.2). The hit-stop, slow tail, camera kick and the rest of the impact
 *  feel moved to flail-impact.ts FLAIL_IMPACT_FEEL (spec §14.1, v1.5a). */
export const FLAIL_FEEL = {
  craterR: 0.09,
  severMul: 1.3,
  /** Per swing: collapse credit (threshold 0.8 → ~12 body hits, spec §13.2; a head hit credits 0.3 of it,
   *  game-head-damage.ts HEAD_LEAF.meterScale — the head model kills), shove (blast() unit-normalises it:
   *  its SIZE reaches the zombie as FLAIL_IMPACT_FEEL.zombie.reactionGain, spec §14.1 item 5). */
  swing: {
    R: { meterCredit: 0.065, shove: 6 },
    L: { meterCredit: 0.065, shove: 6 },
    H: { meterCredit: 0.09, shove: 9 },
  },
} as const;

/** The look: link spacing, rest sway, the hand. (The chain's own numbers —
 *  length, ring offset, the sim — live in flail-swing.ts FLAIL_CHAIN and
 *  flail-chain.ts FLAIL_CHAIN_SIM.) */
export const FLAIL_LOOK = {
  /** Drawn link spacing along the simulated chain, metres. */
  linkPitch: 0.013,
  /** The idle ball target's sway (the sim's light rest hold follows it). */
  swayAmp: 0.012,
  swayHz: 0.9,
  handScale: 1.3,
  /** The arm's IK shoulder, view metres (the gun arms' SHOULDER_R_VIEW is 0.26, −0.30, 0.06). */
  handShoulder: new THREE.Vector3(0.35, -0.47, 0.08),
  /** Primitive haft tip (the GLB's ChainAnchor replaces it), haft-local. */
  primAnchorY: 0.3,
  /** The flail's share of the FLASHLIGHT (the censer's look-pass fix, ported).
   *  The torch hangs ~1 m above the eye with a 1.6 decay: the flail, ~0.5–0.9 m
   *  from it, took several times the light of a zombie two metres out and the
   *  brown haft rendered white (Task 6 look pass, NOTES.md). The flail's own
   *  light list (OWN LIGHT LIST) swaps the torch for a FILL — the same pose, cone
   *  and colour, no distance falloff — at this fraction of the torch's live
   *  intensity, so it still dims and flickers with it. */
  flashFill: 0.018,
} as const;

export interface FlailDeps {
  eye(): Vec3;
  /** The aim ray's direction (world, unit): through the free-aim reticle when free aim is on, else the
   *  view forward — the shotgun's own (game-weapon-leaves.ts aimDir). */
  aimDir(): Vec3;
  /** Blood for a crater (game-world-leaves3 registerBleed). */
  bleed(a: ZombieActor, wound: Wound, point: Vec3, incoming: Vec3): void;
  /** The head damage model (game-head-damage.ts): a head-region hit goes here INSTEAD of the face crater
   *  and blast below — it stamps its own ladder wounds, blasts with this swing's feel and bleeds. */
  headHit?(a: ZombieActor, point: Vec3, dir: Vec3, feel: { meterCredit: number; shove: number; side: FlailSide; gain?: number }): void;
}

export interface FlailDebug {
  phase: string;
  side: FlailSide;
  swingId: number;
  strikes: number;
  /** The last strike: its side, the actors hit, and the eye and a point on the
   *  strike ray (world, the crosshair's forward, spec §12.4) its eye → aim ray
   *  was cast through. */
  lastStrike: {
    side: FlailSide; hits: number[]; eye: Vec3; impact: Vec3;
    /** Head-region hits so far per struck actor id, AFTER this strike (flail-strike.ts flailWound). */
    headHits: Record<number, number>;
    /** resolveStrike's own snapped surface hit point per struck actor id, copied straight out of
     *  StrikeHit.point at strike time — BEFORE it goes through worldHitToWound/woundWorldPos's
     *  prim-local round trip. A gate reading the wound's position back a few frames later (via
     *  actorWounds) is measuring crosshair accuracy AFTER that round trip, which can drift when
     *  the struck prim's orientation frame at read time differs from the frame at stamp time
     *  (game-flail-gate investigation, 2026-09-28: a first hit on a fresh head can land the
     *  wound several cm off this point, though this point itself sits on the crosshair ray).
     *  `points` is the ray's own answer to "where did the strike land" — spec §12.4/§12.5. */
    points: Record<number, Vec3>;
    /** Per struck actor id: the head magnet moved the hit onto the head (flail-strike.ts, spec §13.1). */
    magnet: Record<number, boolean>;
    /** Per actor id in the arc with a live head: its head centre at strike time (the magnet's centre). */
    heads: Record<number, Vec3>;
    /** The drawn ball centre on the strike frame (rig-local) and its distance
     *  from the rig-space FLAIL_IMPACT, metres (set by that frame's draw). */
    ballDrawn: Vec3 | null;
    ballErr: number | null;
  } | null;
  /** The side the next swing takes. */
  nextSide: FlailSide;
  /** This frame's eye-bolt → ball-centre distance (view metres): `keyed` is the
   *  swing's own ball pose, `drawn` the simulated ball. */
  ballBolt: { keyed: number; drawn: number };
  /** The drawn (simulated) ball centre, rig-local. */
  ballDrawn: Vec3;
  /** The swing's keyed ball this frame, rig-local (flailPose; no rest sway). */
  ballKeyed: Vec3;
  /** The worst link-length error of the drawn chain this frame, as a fraction of rest. */
  linkErr: number;
  /** The drawn ball centre, eye bolt and grip (the haft's foot) in SCREEN NDC —
   *  through the fisheye lens, so they land on the photo's pixels — and the
   *  ball's on-screen radius in NDC-x units. */
  ndc: { ball: [number, number]; bolt: [number, number]; grip: [number, number]; ballR: number };
  /** THE SWING BLUR (flail-blur.ts): `on` is the setBlur seam; `warm` the layer pipelines' warm
   *  ('pending' | 'running' | 'done' — nothing is offered before 'done'); `offered` the subjects the last
   *  blurSubjects() call offered the gib shutter layer (0 at rest); `ballSpeed` the drawn ball's
   *  rig-local speed over the unscaled step (the gate, m/s); `radius` the ball's probe radius. */
  blur: { on: boolean; ballGain: number; chainGain: number; ballSpin: boolean; warm: string; offered: number; ballSpeed: number; radius: number };
}

export interface FlailWeapon {
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Once per tick, after the aim rig and holster are placed. */
  tick(dt: number): void;
  updateRig(): void;
  /** The game's dt multiplier this tick (flail-impact.ts timeScale: the hit-stop, then the slow tail), given
   *  the UNSCALED dt; it also steps the impact feel's view channels on that dt and publishes them to
   *  ctx.weapon.impact. Called once, at the top of game-main's tick. */
  timeScale(dt: number): number;
  phase(): string;
  /** Seams. */
  click(): void;
  hold(on: boolean): void;
  /** Off: no hit-stop AND no slow tail (deterministic gate frame counts). */
  setHitStop(on: boolean): void;
  /** Off: no camera pitch kick, judder, roll, FOV punch, rig kick, chain relax or head snap (pixel gates). */
  setImpactFx(on: boolean): void;
  /** Gate readback: the impact feel's live channels. */
  impactDebug(): FlailImpactDebug;
  debug(): FlailDebug;
  /** Where the player SEES a world point: screen NDC through the fisheye lens (gate crops). */
  toScreen(x: number, y: number, z: number): [number, number] | null;
  /** Re-list the flail's own lights (OWN LIGHT LIST) after a light is added. */
  refreshLights(): void;
  /** Copy the torch's pose/intensity onto the FILL. Called right after
   *  flashlight.update(camera), so the fill matches THIS frame's torch. */
  syncFill(): void;
  /**
   * THE SWING BLUR (spec §14.1 item 6): the ball and the chain's segments as gib-shutter subjects while a
   * swing is live and the ball moves faster than FLAIL_BLUR.minBallSpeedMps; [] at rest, hidden, or before
   * the layer's pipelines are warm. Called once per tick, AFTER the camera is final and BEFORE the shutter's
   * select(). Records this frame's pose as the next frame's prior either way.
   */
  blurSubjects(): GibBlurSubject[];
  /** Seam: the swing blur on/off (on by default), and optionally its look: the ball's and the chain's
   *  motion gains (FLAIL_BLUR.ballGain / chainGain) and whether the ball's spin is carried. */
  setBlur(on: boolean, look?: { ball?: number; chain?: number; spin?: boolean }): void;
}

export interface FlailImpactDebug {
  /** The last timeScale() result and the time channel's state. */
  timeScale: number; stopLeft: number; slowOn: boolean; slowT: number;
  /** The camera's pitch kick (rad), the judder [x m, y m, roll rad], the FOV punch (deg) and the FOV the
   *  camera draws with right now, and the rig kick composed in updateRig. */
  pitch: number; shake: [number, number, number]; fovDeg: number; cameraFov: number;
  rig: { pos: Vec3; rot: Vec3 };
  recoilPitch: number;
  hitStopOn: boolean; fxOn: boolean;
  /** Contacts so far (strikes with a hit). */
  contacts: number;
}

const MAX_LINKS = 40;

export function createFlail(ctx: GameContext, deps: FlailDeps): FlailWeapon {
  const rig = new THREE.Group();
  rig.name = 'flail-rig';
  ctx.weapon.aimRig!.add(rig);
  const haft = new THREE.Group();
  haft.name = 'flail-haft';
  rig.add(haft);
  const ball = new THREE.Group();
  ball.name = 'flail-ball';
  rig.add(ball);
  const anchorLocal = new THREE.Vector3(0, FLAIL_LOOK.primAnchorY, 0);

  const pmrem = new THREE.PMREMGenerator(ctx.boot.handle.renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.dispose();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, metalness: 0.85, roughness: 0.5, envMap: env, envMapIntensity: 0.8 });

  // ---- OWN LIGHT LIST (ported from the censer, commit 8c24de2a) -------------
  // `material.lightsNode` REPLACES the scene's light list for that material
  // (the level does this per room, game-main "LEVEL SURFACES"). The flail's
  // list mirrors the default one — every light the camera sees whose whole
  // ancestor chain is visible — EXCEPT the torch, which is swapped for the FILL
  // (FLAIL_LOOK.flashFill). Re-listed on events, not polled: here (the level's
  // lights and the flashlight exist before the flail) and via refreshLights()
  // when game-main adds the muzzle flash with the gun. Forward route only
  // (deferred has its own lighting).
  const lightList = lights([]);
  let listed: THREE.Light[] = [];
  // THE FILL: on a layer no camera renders (so three's default per-camera lists
  // skip it) and with `onlyRooms` empty (so the level's per-room lists skip it
  // too — game-lighting-leaves levelSceneLights). Parented to the scene root,
  // never hidden; its pose and intensity follow the torch every tick (syncFill).
  const fill = new THREE.SpotLight(0xffffff, 0, 16, Math.PI * 0.12, 0.45, 0);
  fill.name = 'flail-flash-fill';
  fill.castShadow = false;
  fill.layers.set(FLAIL_FILL_LAYER);
  fill.userData.onlyRooms = new Set<number>();
  fill.target.layers.set(FLAIL_FILL_LAYER);
  const _fp = new THREE.Vector3();
  function syncFill(): void {
    if (ctx.boot.deferredMode) return;
    const spot = ctx.lighting.flashlight?.spot;
    if (!spot || !spot.visible) { fill.intensity = 0; return; }   // the torch is off in this rig (outdoor)
    spot.updateMatrixWorld();
    spot.target.updateMatrixWorld();
    fill.position.copy(spot.getWorldPosition(_fp));
    fill.target.position.copy(spot.target.getWorldPosition(_fp));
    fill.color.copy(spot.color);
    fill.angle = spot.angle;
    fill.penumbra = spot.penumbra;
    fill.distance = spot.distance;
    fill.intensity = spot.intensity * FLAIL_LOOK.flashFill;
    fill.updateMatrixWorld();
    fill.target.updateMatrixWorld();
  }
  if (!ctx.boot.deferredMode) ctx.boot.handle.scene.add(fill, fill.target);
  const litMaterials = new Set<THREE.Material>();
  const shownInTree = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  /** Re-list; true when the list changed. */
  function relist(): boolean {
    if (ctx.boot.deferredMode) return false;
    const next: THREE.Light[] = [];
    const torch = ctx.lighting.flashlight;
    const camera = ctx.boot.handle.camera;
    ctx.boot.handle.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (!l.isLight || l === torch?.spot || l === torch?.levelShadow) return;
      if (l.layers.test(camera.layers) && shownInTree(l)) next.push(l);
    });
    if (fill.parent) next.push(fill);
    if (next.length === listed.length && next.every((l, i) => l === listed[i])) return false;
    listed = next;
    lightList.setLights(next);
    // setLights() does not bump the node's version, so the materials' cache keys
    // would never change and three would never rebuild them with the new list:
    // bump the node, then the materials (the censer's verified fix).
    lightList.needsUpdate = true;
    for (const m of litMaterials) m.needsUpdate = true;
    return true;
  }
  const library = ctx.boot.handle.renderer.library as unknown as { fromMaterial(m: THREE.Material): THREE.NodeMaterial | null };
  const lit = new Map<THREE.Material, THREE.Material>();
  /** Point every mesh under `root` at the flail's own light list. */
  function ownLights(root: THREE.Object3D): void {
    if (ctx.boot.deferredMode) return;
    const conv = (m: THREE.Material): THREE.Material => {
      let nm = lit.get(m);
      if (!nm) {
        // A material that is ALREADY a node material (the goblin skin) may be
        // shared with other meshes: give the flail its own copy rather than
        // re-point someone else's lights.
        const node = (m as THREE.NodeMaterial).isNodeMaterial
          ? (m as THREE.NodeMaterial).clone() as THREE.NodeMaterial
          : library.fromMaterial(m);
        if (!node) return m;
        node.lightsNode = lightList;
        lit.set(m, node);
        lit.set(node, node);
        litMaterials.add(node);
        nm = node;
      }
      return nm;
    };
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    });
  }

  // PRIMITIVES FIRST, GLB OVER THEM (the flare's rule).
  const haftPrim = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.42, 12), wood);
  haftPrim.position.y = 0.09;
  haft.add(haftPrim);
  const ballPrim = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), iron);
  ball.add(ballPrim);

  /** The ball's blur probe radius (the primitive's; the GLB's bounds replace it). */
  let ballRadius = 0.06;
  /** The GLB has loaded or failed: the blur warm waits for the final meshes and materials. */
  let glbSettled = false;
  const linkGeo = new THREE.TorusGeometry(0.007, 0.002, 5, 8);
  const chain = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(linkGeo, iron, MAX_LINKS);
  chain.name = 'flail-chain';
  chain.frustumCulled = false;
  chain.count = 0;
  rig.add(chain);
  relist();
  ownLights(rig);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  void (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(FLAIL_GLB);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const need = (n: string): THREE.Object3D => {
        const o = root.getObjectByName(n);
        if (!o) throw new Error(`flail.glb is missing the ${n} node`);
        return o;
      };
      const haftNode = need('Haft'), anchorNode = need('ChainAnchor'), ballNode = need('Ball'), linkNode = need('ChainLink');
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial && std.metalness > 0.5) { std.envMap = env; std.envMapIntensity = 0.8; std.needsUpdate = true; }
        }
      });
      haftNode.removeFromParent(); haftNode.position.set(0, 0, 0); haftNode.quaternion.identity();
      haft.add(haftNode); haftPrim.visible = false;
      haft.updateMatrixWorld(true);
      anchorLocal.copy(haft.worldToLocal(anchorNode.getWorldPosition(new THREE.Vector3())));
      ballNode.removeFromParent(); ballNode.position.set(0, 0, 0); ballNode.quaternion.identity();
      ballNode.updateMatrixWorld(true);
      {
        // The blur's probe radius: the ball's largest half-extent, spikes included.
        const size = new THREE.Box3().setFromObject(ballNode).getSize(new THREE.Vector3());
        const r = Math.max(size.x, size.y, size.z) / 2;
        if (Number.isFinite(r) && r > 0.01) ballRadius = r;
      }
      ball.add(ballNode); ballPrim.visible = false;
      const found: THREE.Mesh[] = [];
      linkNode.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
      if (found[0]) { chain.geometry = found[0].geometry; chain.material = found[0].material; linkGeo.dispose(); }
      ownLights(haft); ownLights(ball); ownLights(chain);
    } catch (e) {
      console.warn('[sdf-game] flail.glb absent or unreadable — using the primitive flail', e);
    } finally {
      glbSettled = true;
    }
  })();

  let hand: THREE.Group | null = null;
  void loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 }).then((arms) => {
    hand = arms.right;
    hand.name = 'flail-hand';
    hand.scale.setScalar(FLAIL_LOOK.handScale);
    ownLights(hand);
    haft.add(hand);
  }).catch((e) => console.warn('[sdf-game] flail hand: goblin-arm.glb failed', e));
  const _sh = new THREE.Vector3(), _bend = new THREE.Vector3();
  function aimHand(): void {
    if (!hand) return;
    const view = ctx.weapon.viewModelAnchor;
    // The view anchor is an ancestor of the haft: refreshing the haft's
    // ancestor chain refreshes it too, without re-walking the whole subtree.
    haft.updateWorldMatrix(true, false);
    view.localToWorld(_sh.copy(FLAIL_LOOK.handShoulder));
    view.localToWorld(_bend.copy(FLAIL_LOOK.handShoulder).add(BEND_R_VIEW));
    haft.worldToLocal(_sh); haft.worldToLocal(_bend);
    _bend.sub(_sh).normalize();
    // aimArm solves with the arm's UNSCALED bone lengths (FORE_LEN_M/UPPER_LEN_M)
    // in the haft's space, but the arm is drawn at handScale: solve against the
    // shoulder's offset from the hand divided by handScale, so the drawn (scaled)
    // upper arm ends AT the shoulder instead of ~20% short of it.
    _sh.sub(hand.position).divideScalar(FLAIL_LOOK.handScale).add(hand.position);
    aimArm(hand, _sh, _bend);
  }

  let swing: FlailSwing = makeFlailSwing();
  let click = false, held = false;
  let hitStopOn = true, impactFxOn = true;
  /** THE IMPACT FEEL (flail-impact.ts): the time channel and the view springs, stepped on UNSCALED dt. */
  const impact = makeImpactState();
  let lastScale = 1, contacts = 0;
  /** The UNSCALED step timeScale() was given this tick: the blur's velocities are the drawn motion over the
   *  time the viewer saw pass, so the hit-stop's near-frozen frames read as near-still (no smear). */
  let rawDt = 0;
  function publishImpact(): void {
    const o = impactOutputs(impact), w = ctx.weapon.impact;
    w.pitch = o.cameraPitch;
    w.shake[0] = o.shake[0]; w.shake[1] = o.shake[1]; w.shake[2] = o.shake[2];
    w.fovDeg = o.fovDeg;
  }
  let strikes = 0, clock = 0;
  let lastStrike: FlailDebug['lastStrike'] = null;
  /** Head-region hits per actor id (spec §12.3): the face always craters, never severs; the counter is
   *  kept for the head damage model (its own spec, §12.6). */
  const headHits = new Map<number, number>();
  /** The side of a strike that fired THIS tick (draw pins the ball on its impact), else null. */
  let strikeNow: FlailSide | null = null;
  window.addEventListener('blur', () => { held = false; });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== ctx.boot.canvas) held = false;
  });

  function strike(side: FlailSide): void {
    strikes++;
    const eye = deps.eye();
    // THE CROSSHAIR RAY (spec §12.4): a point 1 m down the AIM ray — through
    // the free-aim reticle, like the shotgun's shot, not the screen centre
    // (owner, v1.3 playtest: the reticle on the head hit the torso). Not the
    // drawn ball's position: FLAIL_IMPACT still drives the ball itself
    // (draw(), below), landing about a ball-width under the view centre on
    // the strike frame. The arc is centred on the aim's bearing too.
    const d = deps.aimDir();
    const aim: Vec3 = [eye[0] + d[0], eye[1] + d[1], eye[2] + d[2]];
    const aimYaw = Math.atan2(d[0], -d[2]);
    const actors: StrikeActor[] = [];
    const heads: Record<number, Vec3> = {};
    for (const a of ctx.world.actors) {
      const posed = a.posed();
      const c = posed.clusters.find(cc => cc.limb === 'torso')?.center;
      if (!c) continue;
      // THE HEAD MAGNET (spec §13.1): the live head cluster's centre NOW (the zombie lunges between click and
      // strike) and the head's own field — sdBody over the head cluster(s) alone, so the same smooth unions and
      // carves as the body, without the arms in front of the face.
      const headClusters = posed.clusters.filter(cc => cc.limb === 'head' && cc.alive);
      const head = headClusters.length > 0
        ? { centre: [...headClusters[0]!.center] as Vec3, field: (q: Vec3) => sdBody(q, { prims: posed.prims, clusters: headClusters }) }
        : undefined;
      if (head) heads[a.id] = head.centre;
      actors.push({ id: a.id, centre: c, field: q => sdBody(q, posed), head });
    }
    const hits = resolveStrike(eye, aimYaw, aim, actors, FLAIL_ARC_DEG[side]);
    const struckHeads: Record<number, number> = {};
    const struckPoints: Record<number, Vec3> = {};
    const magnet: Record<number, boolean> = {};
    for (const h of hits) { struckPoints[h.actorId] = [...h.point] as Vec3; magnet[h.actorId] = !!h.magnet; }
    lastStrike = {
      side, hits: hits.map(h => h.actorId), eye: [...eye] as Vec3, impact: [...aim] as Vec3,
      headHits: struckHeads, points: struckPoints, magnet, heads, ballDrawn: null, ballErr: null,
    };
    const f = FLAIL_FEEL.swing[side];
    const gain = FLAIL_IMPACT_FEEL.zombie.reactionGain;
    let anyHead = false;
    for (const h of hits) {
      const a = ctx.world.actors.find(x => x.id === h.actorId);
      if (!a) continue;
      const posed = a.posed();
      const yaw = a.pose().yaw;
      const field = (q: Vec3) => sdBody(q, posed);
      // THE FLAIL NEVER DECAPITATES (flail-strike.ts flailWound, spec §12.3): a
      // head-region hit is always a small face crater with no sever. The probe
      // finds the prim the hit lands on; it is the wound itself unless the
      // radius changes. With deps.headHit (the head damage model, game-head-damage.ts)
      // a head-region hit goes there instead and climbs its ladder (eye, cave, scalp,
      // brain) — still never a sever. headHits stays the flail's own counter.
      const probe = worldHitToWound(posed.prims, h.point, FLAIL_FEEL.craterR, 'blast', yaw, field);
      const headC = posed.clusters.find(c => c.limb === 'head' && c.alive)?.center ?? null;
      const neck = headNeck(posed.prims);
      // A magnet hit is on the head by construction (its point is on the head's own surface).
      const region = !!h.magnet || isHeadRegion(posed.prims[probe.primIdx]?.limb, h.point, headC, neck?.root ?? null);
      const spec = flailWound(region, FLAIL_FEEL.craterR, FLAIL_FEEL.severMul);
      if (region) headHits.set(a.id, (headHits.get(a.id) ?? 0) + 1);
      struckHeads[a.id] = headHits.get(a.id) ?? 0;
      if (region) anyHead = true;
      // THE HEAD SNAP (spec §14.1 item 5): a head hit also kicks the rig point nearest the hit — on the
      // head — along the blow, so the head snaps back and springs home. A view effect (setImpactFx): on a
      // frozen gate actor the displacement would hold until it steps.
      const snap = (): void => {
        if (!region || !impactFxOn) return;
        const m = FLAIL_IMPACT_FEEL.zombie.headSnapM * FLAIL_IMPACT_FEEL.sideScale[side];
        a.rigImpulse(h.point, [h.dir[0] * m, h.dir[1] * m, h.dir[2] * m]);
      };
      // The head damage model takes every head-region hit (its ladder counts the same hits as headHits).
      if (region && deps.headHit) {
        deps.headHit(a, h.point, h.dir, { meterCredit: f.meterCredit, shove: f.shove, side, gain });
        snap();
        continue;
      }
      const w = spec.radius === FLAIL_FEEL.craterR ? probe : worldHitToWound(posed.prims, h.point, spec.radius, 'blast', yaw, field);
      w.severRadius = spec.severRadius;
      clothifyWound(posed.prims, w, 'heavy');
      a.blast({
        wounds: [w],
        meterCredit: f.meterCredit,
        impulse: { at: h.point, vel: [h.dir[0] * f.shove, h.dir[1] * f.shove, h.dir[2] * f.shove] },
        reaction: 'blast',
        gain,
      });
      snap();
      deps.bleed(a, w, h.point, h.dir);
    }
    if (hits.length > 0) {
      // THE IMPACT (flail-impact.ts): the hit-stop and slow tail (setHitStop), the camera kick, judder, FOV
      // punch, rig kick and chain relax (setImpactFx). Replaces the old 0.02 rad recoilPitch kick.
      contact(impact, impactKick(side, anyHead), { time: hitStopOn, view: impactFxOn });
      contacts++;
      ctx.weapon.shotAlert = true;
    }
    ctx.telemetry.telemetry.event('flail-strike', { side, hits: hits.length });
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _roll = new THREE.Quaternion();
  const _p = new THREE.Vector3(), _tan = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  const _a = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const _rigQ = new THREE.Quaternion(), _down = new THREE.Vector3();
  const ballBolt = { keyed: 0, drawn: 0 };
  let ballDrawn: Vec3 = [0, 0, 0];
  let ballKeyed: Vec3 = [0, 0, 0];
  let linkErr = 0;
  /** The simulated chain, RIG-LOCAL (the keys' space). Null while the rig is hidden,
   *  after a live swing is cancelled (a weapon switch snaps the bolt up to 0.87 m)
   *  and after a non-finite step: re-made from a straight line bolt → ball on the
   *  next drawn frame. Stepped in place (no per-frame allocation). */
  let sim: ChainState | null = null;
  /** The chain AS DRAWN this frame (flail-chain.ts drawChain): the sim
   *  extrapolated over its carried time, rooted on the true bolt. */
  const drawn: [number, number, number][] = Array.from({ length: FLAIL_CHAIN_SIM.nodes }, () => [0, 0, 0]);
  const bolt: [number, number, number] = [0, 0, 0];
  const target: [number, number, number] = [0, 0, 0];
  const down: [number, number, number] = [0, -1, 0];
  const stepOpts: ChainStepOpts & { targetVel: [number, number, number] } = { pin: false, targetVel: [0, 0, 0] };
  /** Arc length along the drawn polyline (nodes 0 … n−2), per node. */
  const arc: number[] = [];

  /** Catmull-Rom through the ring-side polyline (nodes 0 … last), segment k at u
   *  (end points doubled): position into `out`, derivative into `d`. */
  function spline(pts: Vec3[], last: number, k: number, u: number, out: THREE.Vector3, d: THREE.Vector3): void {
    const P0 = pts[Math.max(0, k - 1)]!, P1 = pts[k]!, P2 = pts[k + 1]!, P3 = pts[Math.min(last, k + 2)]!;
    const u2 = u * u, u3 = u2 * u;
    for (let c = 0; c < 3; c++) {
      const p0 = P0[c]!, p1 = P1[c]!, p2 = P2[c]!, p3 = P3[c]!;
      out.setComponent(c, 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3));
      d.setComponent(c, 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (3 * p1 - p0 - 3 * p2 + p3) * u2));
    }
  }

  function draw(dt: number): void {
    const pose = flailPose(swing);
    haft.position.set(pose.grip[0], pose.grip[1], pose.grip[2]);
    haft.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    haft.updateMatrix();
    _a.copy(anchorLocal).applyMatrix4(haft.matrix);          // the eye bolt, rig-local
    bolt[0] = _a.x; bolt[1] = _a.y; bolt[2] = _a.z;
    ballKeyed = pose.ball;
    // THE BALL'S TARGET: the swing's ball key (plus the rest sway at idle), with
    // the key's own velocity (the guide is PD: the ball arrives MOVING with the
    // key). On the frame a strike fires it is that side's FLAIL_IMPACT itself,
    // pinned on the call's last substep with the strike key's velocity: the
    // drawn ball sits exactly where the crater lands, whatever the frame's t
    // overran strikeT by (at 60 Hz the key is ~5 cm past it), and flies on.
    let guide: number, vel: Vec3;
    if (strikeNow) {
      const t = FLAIL_IMPACT[strikeNow];
      target[0] = t[0]; target[1] = t[1]; target[2] = t[2];
      guide = 1;
      vel = flailBallVel({ ...swing, phase: 'swing', side: strikeNow, t: FLAIL_TIMING[strikeNow].strikeT });
    } else {
      const sway = swing.phase === 'idle' ? FLAIL_LOOK.swayAmp : 0;
      const w = 2 * Math.PI * FLAIL_LOOK.swayHz * clock;
      target[0] = pose.ball[0] + sway * Math.sin(w); target[1] = pose.ball[1]; target[2] = pose.ball[2] + sway * 0.7 * Math.sin(w * 1.3);
      // After a contact the guide lets go for a moment of SIM time (flail-impact.ts chainRelax): the ball
      // flies on its own momentum, the chain snaps taut and whips, then the guide takes it back.
      guide = guideWeight(swing) * chainRelax(impact, dt);
      vel = flailBallVel(swing);
    }
    stepOpts.pin = strikeNow !== null;
    stepOpts.targetVel[0] = vel[0]; stepOpts.targetVel[1] = vel[1]; stepOpts.targetVel[2] = vel[2];
    // Gravity pulls toward the FLOOR: world down in rig-local space (rig-local
    // −Y tilts with the aim pitch and the holster).
    rig.getWorldQuaternion(_rigQ);
    _down.set(0, -1, 0).applyQuaternion(_rigQ.invert()).normalize();
    down[0] = _down.x; down[1] = _down.y; down[2] = _down.z;
    // A bolt faster than FLAIL_CHAIN_SIM.teleportMps is a teleport (backstop: the
    // known one, a cancelled swing snapping to rest, is handled in tick()). Over
    // dt + the chain's carried time, which is what the jump spans.
    if (sim && chainTeleported(sim, bolt, dt)) sim = null;
    sim = stepChainInPlace(sim ?? makeChain(bolt, target), bolt, target, guide, down, dt, stepOpts);
    const end = sim.p[sim.p.length - 1]!;
    if (!Number.isFinite(end[0]) || !Number.isFinite(end[1]) || !Number.isFinite(end[2])) sim = makeChain(bolt, target);
    drawChain(sim, bolt, drawn);
    const pts = drawn;
    const n = pts.length, ring = n - 2;
    const b = pts[n - 1]!;
    ball.position.set(b[0], b[1], b[2]);
    ballDrawn = [b[0], b[1], b[2]];
    ballBolt.keyed = Math.hypot(pose.ball[0] - bolt[0], pose.ball[1] - bolt[1], pose.ball[2] - bolt[2]);
    ballBolt.drawn = _a.distanceTo(ball.position);
    // The ball's ring faces node n−2 (where the chain meets it).
    const r = pts[ring]!;
    _tan.set(r[0] - b[0], r[1] - b[1], r[2] - b[2]);
    if (_tan.lengthSq() > 1e-12) ball.quaternion.setFromUnitVectors(Y, _tan.normalize());
    if (strikeNow && lastStrike) {
      lastStrike.ballDrawn = [b[0], b[1], b[2]];
      const t = FLAIL_IMPACT[strikeNow];
      lastStrike.ballErr = Math.hypot(b[0] - t[0], b[1] - t[1], b[2] - t[2]);
    }
    // THE LINKS: evenly spaced by arc length along a spline through nodes
    // 0 … n−2, each along the local tangent, alternating the roll.
    arc.length = 0; arc.push(0);
    linkErr = 0;
    for (let k = 0; k < n - 1; k++) {
      const q0 = pts[k]!, q1 = pts[k + 1]!;
      const d = Math.hypot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]);
      linkErr = Math.max(linkErr, Math.abs(d - linkRest(k)) / linkRest(k));
      if (k < ring) arc.push(arc[k]! + d);
    }
    const total = arc[ring]!;
    const count = Math.min(MAX_LINKS, Math.max(2, Math.round(total / FLAIL_LOOK.linkPitch)));
    let k = 0;
    for (let i = 0; i < count; i++) {
      const s = ((i + 0.5) / count) * total;
      while (k < ring - 1 && s > arc[k + 1]!) k++;
      const seg = arc[k + 1]! - arc[k]!;
      spline(pts, ring, k, seg > 1e-9 ? (s - arc[k]!) / seg : 0, _p, _tan);
      if (_tan.lengthSq() < 1e-12) _tan.copy(Y); else _tan.normalize();
      _q.setFromUnitVectors(Y, _tan);
      _roll.setFromAxisAngle(_tan, i % 2 === 0 ? 0 : Math.PI / 2);
      _q.premultiply(_roll);
      chain.setMatrixAt(i, _m.compose(_p, _q, _one));
    }
    chain.count = count;
    chain.instanceMatrix.needsUpdate = true;
    aimHand();
  }

  /** A world point → screen NDC through the fisheye lens (gate readback only). */
  function screenNdc(w: THREE.Vector3): [number, number] {
    const cam = ctx.boot.handle.camera;
    cam.updateMatrixWorld();
    const v = w.clone().project(cam);
    const lens = ctx.render.postAa?.lens;
    const p = lens ? reticleNdc({ x: v.x, y: v.y }, lens) : { x: v.x, y: v.y };
    return [p.x, p.y];
  }
  /** Gate readback only (never per frame): where the ball, bolt and grip are on screen. */
  function ndcNow(): FlailDebug['ndc'] {
    const cam = ctx.boot.handle.camera;
    rig.updateMatrixWorld(true);
    const b = ball.getWorldPosition(new THREE.Vector3());
    const r = b.clone().add(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(0.06));
    const k = haft.localToWorld(anchorLocal.clone());
    const g = haft.getWorldPosition(new THREE.Vector3());
    const bn = screenNdc(b), rn = screenNdc(r);
    return { ball: bn, bolt: screenNdc(k), grip: screenNdc(g), ballR: Math.hypot(rn[0] - bn[0], rn[1] - bn[1]) };
  }

  // ---- THE SWING BLUR (Task 28, spec §14.1 item 6): drawn chain → gib-shutter subjects ----------------
  // The ball and the chain ride the gib shutter layer (gib-shutter-layer.ts) exactly as the scrapped
  // censer's head and chain did: while a swing is live and the ball is fast, their meshes are lifted onto
  // GIB_BLUR_LAYER (off the clean base pass) and smeared along per-subject motion (flail-blur.ts). The
  // flail's own light list is a material lightsNode, so the layer draw (camera on GIB_BLUR_LAYER, no scene
  // lights) lights them exactly as the base pass does.
  //
  // PRIORS ARE CAMERA-RELATIVE: last frame's drawn nodes are kept in camera space and re-placed through
  // THIS frame's camera, so turning the view does not streak a weapon held in it; the rig kick and the
  // aim lean (rig → camera) are real on-screen motion and are carried. The GATE is the ball's RIG-LOCAL
  // speed (the chain sim's own motion) over the UNSCALED step: in the hit-stop freeze the sim barely
  // moves, so the gate closes and nothing smears; in the slow tail the motion is slowed as seen.
  let blurOn = true;
  let ballGain: number = FLAIL_BLUR.ballGain, chainGain: number = FLAIL_BLUR.chainGain, ballSpin: boolean = FLAIL_BLUR.ballSpin;
  let blurHavePrev = false;
  /** Seconds the blur has been continuously active: the subjects' ageSeconds, so the first blurred frame
   *  exposes one frame of motion, never a streak back into the pose before it. */
  let blurAge = 0;
  let lastOffered = 0, lastBallSpeed = 0;
  const NODES = FLAIL_CHAIN_SIM.nodes, SEGMENTS = NODES - 2;   // nodes 0 … n−2 are the chain; n−1 the ball
  type M3 = [number, number, number];
  const prevCam: M3[] = Array.from({ length: NODES }, (): M3 => [0, 0, 0]);
  const prevW: M3[] = Array.from({ length: NODES }, (): M3 => [0, 0, 0]);
  const curW: M3[] = Array.from({ length: NODES }, (): M3 => [0, 0, 0]);
  const prevBallRig: M3 = [0, 0, 0];
  const ballState = makeMotionState();
  const chainPool = Array.from({ length: SEGMENTS }, () => makeMotionState());
  const subjectPool: GibBlurSubject[] = [];
  const offered: GibBlurSubject[] = [];
  const ballMeshes: THREE.Mesh[] = [];
  const _camInv = new THREE.Matrix4(), _rigToCam = new THREE.Matrix4(), _v = new THREE.Vector3();
  const axPrev: M3 = [0, 0, 0], axCur: M3 = [0, 0, 0];
  function offer(id: number, state: GibBlurSubject['state'], mesh: THREE.Mesh, age: number): void {
    const i = offered.length;
    const rec = subjectPool[i] ?? (subjectPool[i] = { id, state, mesh, baseLayer: 0, ageSeconds: age });
    rec.id = id; rec.state = state; rec.mesh = mesh; rec.baseLayer = 0; rec.ageSeconds = age;
    offered.push(rec);
  }

  // ---- The layer's pipelines, warmed on CLONES (the censer's fix, review I2) ---------------------------
  // A cold first blurred swing builds the ball's and chain's layer-pass render objects mid-swing (the
  // censer measured ~100 + 66 ms: the layer target is rgba16float and sees no scene lights, a different
  // program from the base pass). compileAsync compiles under the DEFAULT pass id, so warming the LIVE
  // meshes would make a default-map render object the base pass flips and disposes. So: CLONES (same
  // geometry + materials), every node on GIB_BLUR_LAYER, never added to the scene and never drawn,
  // compiled in the layer context and KEPT, so the warmed node-builder state and pipelines stay cached for
  // the live meshes' own GIB_SHUTTER_PASS_ID render objects. Started as soon as the GLB (the final meshes
  // and materials) has settled and the gib draw is warm; nothing is offered until it is done. A changed
  // light list re-keys the materials, so refreshLights() re-arms it.
  let warm: 'pending' | 'running' | 'done' = 'pending';
  let warmGen = 0;
  let warmClones: THREE.Object3D[] = [];
  function startWarm(): void {
    if (warm !== 'pending') return;
    const shutter = ctx.gibs.shutter;
    if (ctx.boot.deferredMode || (shutter && !shutter.diagnostics().supported)) { warm = 'done'; return; }
    if (!shutter || !glbSettled) return;
    if (ctx.boot.warmBackground.gibDraw() !== 'draw') return;
    const cap = ctx.render.postAa?.captureTarget;
    if (!cap) return;
    warm = 'running';
    const gen = warmGen;
    const scene = ctx.boot.handle.scene;
    const camera = ctx.boot.handle.camera as THREE.PerspectiveCamera;
    const clones = [ball, chain].map((root) => {
      const c = root.clone(true);
      c.traverse((o) => {
        o.layers.set(GIB_BLUR_LAYER);
        // compileAsync frustum-culls like a draw: a parentless clone near the world origin would be
        // outside the camera and silently skipped.
        o.frustumCulled = false;
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) {
          im.count = Math.max(1, im.count);
          // three keys an INSTANCED mesh's material cache by object.uuid (RenderObject.getMaterialCacheKey),
          // so a clone with its own uuid would warm a program the live chain never looks up. Render objects
          // are looked up by object IDENTITY; the uuid only enters this string key.
          im.uuid = chain.uuid;
          // …but the node-builder state that key finds is SHARED, and its instance node binds the buffer
          // it was built with: warmed on the clone's own copy of the matrices, the live chain's layer draw
          // read the clone's frozen matrices and the chain VANISHED whenever it was lifted (measured:
          // chain-only blur, gain 0.04 and 1 alike). Share the live attribute, so the state binds it.
          im.instanceMatrix = chain.instanceMatrix;
          im.instanceColor = chain.instanceColor;
        }
      });
      c.updateMatrixWorld(true);
      return c;
    });
    void (async () => {
      let ok = true;
      for (const c of clones) ok = (await shutter.precompileSubjectInBackground(c, cap, scene, camera, 20_000)) && ok;
      if (!ok) console.warn('[sdf-game] flail blur warm did not fully compile — the first swing may hitch');
      if (gen !== warmGen) { warm = 'pending'; return; }   // re-armed meanwhile: go again
      warmClones = clones;
      warm = 'done';
    })();
  }
  void warmClones;

  function blurSubjects(): GibBlurSubject[] {
    offered.length = 0;
    startWarm();
    if (!rig.visible || !sim) {
      blurHavePrev = false; blurAge = 0; lastOffered = 0; lastBallSpeed = 0;
      return offered;
    }
    const dt = rawDt;
    const n = NODES, bi = n - 1, ring = n - 2;
    const b = drawn[bi]!;
    lastBallSpeed = blurHavePrev && dt > 0
      ? Math.hypot(b[0] - prevBallRig[0], b[1] - prevBallRig[1], b[2] - prevBallRig[2]) / dt : 0;
    const cam = ctx.boot.handle.camera;
    cam.updateMatrixWorld();
    rig.updateWorldMatrix(true, false);
    _camInv.copy(cam.matrixWorld).invert();
    _rigToCam.multiplyMatrices(_camInv, rig.matrixWorld);
    const active = blurOn && blurHavePrev && warm === 'done'
      && ctx.boot.warmBackground.gibDraw() === 'draw'
      && flailBlurActive(swing.phase, lastBallSpeed);
    if (active) {
      blurAge += dt;
      const age = blurAge;
      for (let k = 0; k < n; k++) {
        const p = drawn[k]!;
        _v.set(p[0], p[1], p[2]).applyMatrix4(rig.matrixWorld);
        const c = curW[k]!; c[0] = _v.x; c[1] = _v.y; c[2] = _v.z;
        const q = prevCam[k]!;
        _v.set(q[0], q[1], q[2]).applyMatrix4(cam.matrixWorld);
        const w = prevW[k]!; w[0] = _v.x; w[1] = _v.y; w[2] = _v.z;
      }
      // BALL: every visible mesh under the group shares ONE state, id and age.
      const bp = prevW[bi]!, bc = curW[bi]!, rp = prevW[ring]!, rc = curW[ring]!;
      axPrev[0] = rp[0] - bp[0]; axPrev[1] = rp[1] - bp[1]; axPrev[2] = rp[2] - bp[2];
      axCur[0] = rc[0] - bc[0]; axCur[1] = rc[1] - bc[1]; axCur[2] = rc[2] - bc[2];
      if (!ballSpin) { axPrev[0] = axCur[0]; axPrev[1] = axCur[1]; axPrev[2] = axCur[2]; }
      ballMotionState(ballState, bp, bc, axPrev, axCur, dt, ballRadius, ballGain);
      ballMeshes.length = 0;
      ball.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) ballMeshes.push(o as THREE.Mesh); });
      for (const mesh of ballMeshes) offer(FLAIL_BLUR_IDS.ball, ballState, mesh, age);
      // CHAIN: ONE InstancedMesh offered once per sim segment (nodes 0 … ring), each with its own motion.
      if (chain.count > 0) {
        const segs = chainSegmentStates(prevW, curW, SEGMENTS, dt, chainGain, chainPool);
        for (let i = 0; i < segs.length; i++) offer(FLAIL_BLUR_IDS.chain + i, segs[i]!, chain, age);
      }
    } else {
      blurAge = 0;
    }
    // Remember this frame: camera space for the stamps, rig-local for the gate.
    for (let k = 0; k < n; k++) {
      const p = drawn[k]!;
      _v.set(p[0], p[1], p[2]).applyMatrix4(_rigToCam);
      const q = prevCam[k]!; q[0] = _v.x; q[1] = _v.y; q[2] = _v.z;
    }
    prevBallRig[0] = b[0]; prevBallRig[1] = b[1]; prevBallRig[2] = b[2];
    blurHavePrev = true;
    lastOffered = offered.length;
    return offered;
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'flail') return false;
      if (button === 0) { click = true; held = true; }
      return true;
    },
    onMouseUp(button) { if (button === 0) held = false; },
    tick(dt) {
      if (!rig.visible) { swing = cancelFlailSwing(swing); click = false; sim = null; return; }
      clock += dt;
      const ready = ctx.weapon.slotState.live === 'flail' && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
      strikeNow = null;
      if (!ready) {
        if (swing.phase === 'swing') sim = null;   // cancelled mid-swing: the bolt is about to snap
        swing = cancelFlailSwing(swing);
      } else {
        const r = stepFlailSwing(swing, { click, held }, dt);
        swing = r.state;
        for (const side of r.strikes) { strike(side); strikeNow = side; }
      }
      click = false;
      draw(dt);
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'flail');
      // The holster travel, plus the impact's rig kick (flail-impact.ts: back, up, pitched up, rolled —
      // all 0 at rest and with setImpactFx(false)).
      const k = impactOutputs(impact).rig;
      rig.position.set(k.pos[0], -0.42 * lower + k.pos[1], 0.06 * lower + k.pos[2]);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower + k.rot[0], k.rot[1], k.rot[2]);
      rig.visible = lower < 0.999 && ownsSlot(ctx, 'flail');
    },
    timeScale(dt) {
      rawDt = dt;
      lastScale = timeScale(impact, dt);
      stepImpact(impact, dt);
      publishImpact();
      return lastScale;
    },
    phase: () => swing.phase,
    click() { click = true; },
    hold(on) { held = on; },
    setHitStop(on) { hitStopOn = on; if (!on) { clearTime(impact); lastScale = 1; } },
    setImpactFx(on) { impactFxOn = on; if (!on) { clearView(impact); publishImpact(); } },
    impactDebug() {
      const o = impactOutputs(impact);
      return {
        timeScale: lastScale, stopLeft: impact.stopLeft, slowOn: impact.slowOn, slowT: impact.slowT,
        pitch: o.cameraPitch, shake: o.shake, fovDeg: o.fovDeg, cameraFov: ctx.boot.handle.camera.fov,
        rig: o.rig, recoilPitch: ctx.weapon.recoilPitch, hitStopOn, fxOn: impactFxOn, contacts,
      };
    },
    toScreen(x, y, z) {
      const cam = ctx.boot.handle.camera;
      cam.updateMatrixWorld();
      const v = new THREE.Vector3(x, y, z).project(cam);
      if (v.z > 1) return null;
      return screenNdc(new THREE.Vector3(x, y, z));
    },
    refreshLights() {
      if (relist() && warm !== 'pending') { warmGen++; if (warm === 'done') warm = 'pending'; }
    },
    syncFill,
    blurSubjects,
    setBlur(on, look) {
      blurOn = on;
      if (look?.ball !== undefined && Number.isFinite(look.ball)) ballGain = Math.max(0, look.ball);
      if (look?.chain !== undefined && Number.isFinite(look.chain)) chainGain = Math.max(0, look.chain);
      if (look?.spin !== undefined) ballSpin = look.spin;
    },
    debug: () => ({ phase: swing.phase, side: swing.side, swingId: swing.swingId, strikes, lastStrike, nextSide: comboSide(swing), ballBolt: { ...ballBolt }, ballDrawn: [...ballDrawn] as Vec3, ballKeyed: [...ballKeyed] as Vec3, linkErr, ndc: ndcNow(),
      blur: { on: blurOn, ballGain, chainGain, ballSpin, warm, offered: lastOffered, ballSpeed: lastBallSpeed, radius: ballRadius } }),
  };
}
