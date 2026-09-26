// src/lab/sdf-zombie/webgpu/game-censer.ts
//
// WEAPON SLOT 1: THE CENSER FLAIL (spec docs/superpowers/specs/2026-09-26-censer-flail-design.md),
// lifted beside game-main.ts like game-flare.ts. The renderer-facing half ONLY:
//   censer-swing.ts  the verbs, the timing and the handle's pose
//   censer-head.ts   the rope pendulum the handle swings
//   censer-hit.ts    head motion → wound spheres
// This file puts the haft on the aim rig, the head and the chain in the WORLD
// (they swing through it, not with the camera), and hands hit events to the
// actors through ZombieActor.blast() as 'blast'-type sphere wounds.
//
// Not a recorded DemoFrame verb (like the flare): a replay does not swing it.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import type { ZombieActor } from './game-actor';
import { worldHitToWound, type Wound } from '../damage';
import { reticleNdc } from './fisheye';
import { sdBody } from '../validate';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { loopBlocksInput, ownsSlot } from './game-loop-leaves';
import { BEND_R_VIEW, SHOULDER_R_VIEW } from './game-weapon-leaves';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms } from './game-arms';
import {
  cancelCenserSwing, deadzoneOffset, handlePose, hitWindow, makeCenserSwing, ropeLength, stepCenserSwing,
  type CenserSwing,
} from './censer-swing';
import { CENSER_HEAD, makeCenserHead, stepCenserHead, type CenserHead, type HeadWorld } from './censer-head';
import { makeStrokeHits, sweepHead, type ActorProbe, type HitEvent, type StrokeHits } from './censer-hit';

const CENSER_GLB = '/assets/lab/censer.glb';
/** The grip's rest, aim-rig (view) space: low right, the haft tipped well
 *  forward so the knot sits out in front and the reeled-in head (reelRest)
 *  dangles in the lower right of the frame. Measured headless on Night Train
 *  (2026-09-26, 60 settle frames): head screen NDC ≈ (0.38, −0.77), knot ≈
 *  (0.40, −0.25) — debug().headNdc / knotNdc. */
export const CENSER_REST = { pos: new THREE.Vector3(0.22, -0.16, -0.46), haftTiltDeg: -65 } as const;
/** The knot's height up the primitive haft; the GLB's ChainAnchor replaces it. */
const PRIM_ANCHOR_Y = 0.26;
/** The chain: one instanced mesh, as many links as the paid-out rope needs
 *  (reeled in ~25, full ~55). Each link is normalised to LINK_LEN long. */
const LINK_LEN = 0.015;
const LINK_PITCH = 0.011;
const MAX_LINKS = 64;
/** Feel numbers (spec §3.3), lerped from a tap to a full charge. */
export const CENSER_FEEL = {
  hitStopTapSec: 0.03,
  hitStopHeavySec: 0.07,
  /** dt multiplier while a hit-stop runs: near-frozen, never 0. */
  hitStopScale: 0.08,
  kickTapRad: 0.012,
  kickHeavyRad: 0.035,
  /** Reaction direction magnitude handed to blast() (it unit-normalises; 0 = no direction). */
  shoveTap: 1.5,
  shoveHeavy: 6,
  /** Charge above which a strike staggers rather than flinches. */
  staggerCharge: 0.5,
} as const;

export interface CenserDeps {
  camera: THREE.Camera;
  /** Blood for a crater (game-world-leaves3 registerBleed). */
  bleed(a: ZombieActor, wound: Wound, point: Vec3, incoming: Vec3): void;
}

export interface CenserDebug {
  phase: string;
  charge: number;
  heavy: boolean;
  strokeId: number;
  head: Vec3;
  headSpeed: number;
  hits: number;
  lastHit: { actor: number; spheres: number; speedIn: number } | null;
  /** The rope's current length (reeled in at rest), metres. */
  rope: number;
  /** Where the player SEES the head and the knot: screen NDC (−1..1, y up),
   *  through the fisheye lens — not the wider render camera's NDC. */
  headNdc: [number, number];
  knotNdc: [number, number];
}

export interface CenserWeapon {
  /** A mousedown while the censer is live. True = consumed. */
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Once per tick, AFTER the aim rig is placed and stepWeaponSlots has run. */
  tick(dt: number): void;
  /** Holster travel from the shared slot state (stepWeaponSlots calls it). */
  updateRig(): void;
  /** This tick's dt multiplier while a hit-stop runs (1 otherwise); counts down on the unscaled dt. */
  hitStopScale(dt: number): number;
  press(): void;
  release(): void;
  setHitStop(on: boolean): void;
  debug(): CenserDebug;
}

const lerp = THREE.MathUtils.lerp;

/** Centre a link's geometry, turn its longest axis onto +Y (the chain tangent)
 *  and scale it to LINK_LEN — the GLB's link arrives in its own units and pose. */
function normaliseLink(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  g.center();
  if (size.x > size.y && size.x >= size.z) { g.rotateZ(Math.PI / 2); size.set(size.y, size.x, size.z); }
  else if (size.z > size.y && size.z > size.x) { g.rotateX(Math.PI / 2); size.set(size.x, size.z, size.y); }
  const k = LINK_LEN / (size.y || 1);
  g.scale(k, k, k);
  return g;
}

export function createCenser(ctx: GameContext, deps: CenserDeps): CenserWeapon {
  // ---- The rig: holster travel → handle (swing pose) → haft (tilt) --------
  const rig = new THREE.Group();
  rig.name = 'censer-rig';
  ctx.weapon.aimRig!.add(rig);
  const handle = new THREE.Group();
  handle.name = 'censer-handle';
  handle.position.copy(CENSER_REST.pos);
  rig.add(handle);
  const haft = new THREE.Group();
  haft.name = 'censer-haft';
  haft.rotation.x = THREE.MathUtils.degToRad(CENSER_REST.haftTiltDeg);
  handle.add(haft);
  const anchorLocal = new THREE.Vector3(0, PRIM_ANCHOR_Y, 0);

  // Metal is black without something to reflect (the flare's note).
  const pmrem = new THREE.PMREMGenerator(ctx.boot.handle.renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const brass = new THREE.MeshStandardMaterial({ color: 0x9c7a34, metalness: 1, roughness: 0.38, envMap: env, envMapIntensity: 1.1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, metalness: 0.9, roughness: 0.55, envMap: env, envMapIntensity: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff6a1c, emissiveIntensity: 3 });

  // PRIMITIVES FIRST, GLB OVER THEM (the flare's rule): the game never waits on the model.
  const haftPrim = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.3, 12), brass);
  haftPrim.position.y = 0.15;
  haft.add(haftPrim);

  const head = new THREE.Group();
  head.name = 'censer-head';
  const headPrim = new THREE.Group();
  const coalCap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 6), glow);
  coalCap.position.y = CENSER_HEAD.radius * 0.8;
  headPrim.add(new THREE.Mesh(new THREE.SphereGeometry(CENSER_HEAD.radius, 20, 14), brass), coalCap);
  head.add(headPrim);

  const chain = new THREE.Group();
  chain.name = 'censer-chain';
  // An oval ring in the XY plane, long axis +Y (the chain's tangent).
  const primLink = normaliseLink(new THREE.TorusGeometry(0.01, 0.0028, 6, 10).scale(0.7, 1, 1));
  const links = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(primLink, iron, MAX_LINKS);
  links.name = 'censer-links';
  links.count = 0;
  links.frustumCulled = false;   // the instances move every frame; the bound never would
  chain.add(links);
  ctx.boot.handle.scene.add(head, chain);
  if (ctx.boot.deferredApi) {
    for (const o of [rig, head, chain]) ctx.boot.deferredApi.router.register(o, 'mesh', 'level-only');
  }

  void (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(CENSER_GLB);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const need = (n: string): THREE.Object3D => {
        const o = root.getObjectByName(n);
        if (!o) throw new Error(`censer.glb is missing the ${n} node`);
        return o;
      };
      const haftNode = need('Haft'), anchorNode = need('ChainAnchor'), headNode = need('Head'), linkNode = need('ChainLink');
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial && std.metalness > 0.5) {
            std.envMap = env; std.envMapIntensity = 1.1; std.needsUpdate = true;
          }
        }
      });
      // The knot in the haft's own frame — read BEFORE the haft is re-parented.
      anchorLocal.copy(haftNode.worldToLocal(anchorNode.getWorldPosition(new THREE.Vector3())));
      haftNode.removeFromParent();
      haftNode.position.set(0, 0, 0);
      haftNode.quaternion.identity();
      haft.add(haftNode);
      haftPrim.visible = false;
      headNode.removeFromParent();
      headNode.position.set(0, 0, 0);
      headNode.quaternion.identity();
      head.add(headNode);
      headPrim.visible = false;
      const found: THREE.Mesh[] = [];
      linkNode.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
      const lm = found[0];
      if (lm) { links.geometry = normaliseLink(lm.geometry.clone()); links.material = lm.material; }
    } catch (e) {
      console.warn('[sdf-game] censer.glb absent or unreadable — using the primitive censer', e);
    }
  })();

  // ---- The hand: a second goblin right arm, fist on the haft -----------------
  let hand: THREE.Group | null = null;
  void loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 }).then((arms) => {
    hand = arms.right;
    hand.name = 'censer-hand';
    hand.position.set(0, 0.03, 0);
    haft.add(hand);
  }).catch((e) => console.warn('[sdf-game] censer hand: goblin-arm.glb failed', e));
  const _sh = new THREE.Vector3(), _bend = new THREE.Vector3();
  function aimHand(): void {
    if (!hand) return;
    const view = ctx.weapon.viewModelAnchor;
    view.localToWorld(_sh.copy(SHOULDER_R_VIEW));
    view.localToWorld(_bend.copy(SHOULDER_R_VIEW).add(BEND_R_VIEW));
    haft.worldToLocal(_sh);
    haft.worldToLocal(_bend);
    _bend.sub(_sh).normalize();
    aimArm(hand, _sh, _bend);
  }

  // ---- State ---------------------------------------------------------------
  let swing: CenserSwing = makeCenserSwing();
  let headSim: CenserHead | null = null;
  let hits: StrokeHits | null = null;
  let held = false;
  let hitStop = 0;
  let hitStopOn = true;
  let hitCount = 0;
  let lastHit: CenserDebug['lastHit'] = null;
  const anchorW = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const _up = new THREE.Vector3(), _p = new THREE.Vector3(), _tan = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion(), _roll = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);

  const _ndc = new THREE.Vector3();
  function screenNdc(w: THREE.Vector3): [number, number] {
    deps.camera.updateMatrixWorld();
    _ndc.copy(w).project(deps.camera);
    const p = reticleNdc({ x: _ndc.x, y: _ndc.y }, ctx.render.postAa.lens);
    return [p.x, p.y];
  }

  function anchorWorld(): Vec3 {
    const hp = handlePose(swing);
    handle.position.set(CENSER_REST.pos.x + hp[0], CENSER_REST.pos.y + hp[1], CENSER_REST.pos.z + hp[2]);
    rig.updateWorldMatrix(true, true);
    haft.localToWorld(anchorW.copy(anchorLocal));
    return [anchorW.x, anchorW.y, anchorW.z];
  }

  function probes(): ActorProbe[] {
    const out: ActorProbe[] = [];
    for (const a of ctx.world.actors) {
      const posed = a.posed();
      const c = posed.clusters.find(cc => cc.limb === 'torso')?.center;
      if (c) out.push({ id: a.id, centre: c, field: q => sdBody(q, posed) });
    }
    return out;
  }

  /** One blast() per struck actor per tick: craters raise the reaction, gouge-only batches do not. */
  function applyHits(events: readonly HitEvent[]): void {
    const charge = swing.heavy ? swing.charge : 0;
    const byActor = new Map<number, HitEvent[]>();
    for (const e of events) byActor.set(e.actorId, [...(byActor.get(e.actorId) ?? []), e]);
    for (const [id, list] of byActor) {
      const a = ctx.world.actors.find(x => x.id === id);
      if (!a) continue;
      const posed = a.posed();
      const yaw = a.pose().yaw;
      const field = (p: Vec3) => sdBody(p, posed);
      const wounds: Wound[] = [];
      let credit = 0;
      let crater: { at: Vec3; wound: Wound } | null = null;
      for (const e of list) for (const s of e.spheres) {
        const w = worldHitToWound(posed.prims, s.at, s.radius, 'blast', yaw, field);
        w.severRadius = s.severRadius;
        wounds.push(w);
        credit += s.meterCredit;
        if (s.kind === 'crater' && !crater) crater = { at: s.at, wound: w };
      }
      const dir = list[0]!.dir;
      const shove = crater ? lerp(CENSER_FEEL.shoveTap, CENSER_FEEL.shoveHeavy, charge) : 0;
      a.blast({
        wounds,
        meterCredit: credit,
        impulse: { at: crater?.at ?? list[0]!.spheres[0]!.at, vel: [dir[0] * shove, dir[1] * shove, dir[2] * shove] },
        reaction: !crater ? 'none' : charge > CENSER_FEEL.staggerCharge ? 'blast' : 'flinch',
      });
      if (!crater) continue;
      hitCount++;
      lastHit = { actor: id, spheres: wounds.length, speedIn: list[0]!.speedIn };
      deps.bleed(a, crater.wound, crater.at, dir);
      if (hitStopOn) hitStop = lerp(CENSER_FEEL.hitStopTapSec, CENSER_FEEL.hitStopHeavySec, charge);
      ctx.weapon.recoilPitch += lerp(CENSER_FEEL.kickTapRad, CENSER_FEEL.kickHeavyRad, charge);
      ctx.weapon.shotAlert = true;   // a landed blow is a noise
      ctx.telemetry.telemetry.event('censer-hit', { actor: id, charge, spheres: wounds.length });
    }
  }

  function drawHead(anchor: Vec3, rope: number): void {
    const h = headSim!.pos;
    head.position.set(h[0], h[1], h[2]);
    _up.set(anchor[0] - h[0], anchor[1] - h[1], anchor[2] - h[2]);
    const span = _up.length();
    if (span > 1e-6) { _up.divideScalar(span); head.quaternion.setFromUnitVectors(Y, _up); } else _up.copy(Y);
    // The chain: links along a quadratic curve from the knot to the ring,
    // sagging by the rope's slack (straight when taut).
    const rr = CENSER_HEAD.radius * 1.3;
    const ring: Vec3 = [h[0] + _up.x * rr, h[1] + _up.y * rr, h[2] + _up.z * rr];
    const sag = Math.max(0, rope - span) * 0.6;
    const c: Vec3 = [(anchor[0] + ring[0]) / 2, (anchor[1] + ring[1]) / 2 - sag, (anchor[2] + ring[2]) / 2];
    // The links the paid-out chain needs: knot to ring, at the link pitch.
    const n = Math.min(MAX_LINKS, Math.max(2, Math.round(Math.max(0, rope - rr) / LINK_PITCH)));
    links.count = n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, u = 1 - t;
      _p.set(
        u * u * anchor[0] + 2 * u * t * c[0] + t * t * ring[0],
        u * u * anchor[1] + 2 * u * t * c[1] + t * t * ring[1],
        u * u * anchor[2] + 2 * u * t * c[2] + t * t * ring[2],
      );
      _tan.set(
        2 * u * (c[0] - anchor[0]) + 2 * t * (ring[0] - c[0]),
        2 * u * (c[1] - anchor[1]) + 2 * t * (ring[1] - c[1]),
        2 * u * (c[2] - anchor[2]) + 2 * t * (ring[2] - c[2]),
      );
      if (_tan.lengthSq() < 1e-12) _tan.copy(Y); else _tan.normalize();
      _q.setFromUnitVectors(Y, _tan);
      _roll.setFromAxisAngle(_tan, i % 2 === 0 ? 0 : Math.PI / 2);   // alternate links cross
      _q.premultiply(_roll);
      links.setMatrixAt(i, _m.compose(_p, _q, _one));
    }
    links.instanceMatrix.needsUpdate = true;
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'censer') return false;
      if (button === 0) held = true;
      return true;
    },
    onMouseUp(button) {
      if (button === 0) held = false;
    },
    tick(dt) {
      const live = ctx.weapon.slotState.live === 'censer';
      const ready = live && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
      if (!live) held = false;
      if (!ready) {
        // Not steppable (holstered, mid-switch, dead): back to idle, but keep
        // tracking the button so one held through the raise is not a fresh
        // press the instant the censer is ready (censer-swing.ts `wasDown`).
        swing = { ...cancelCenserSwing(swing), wasDown: held };
      } else {
        swing = stepCenserSwing(swing, { down: held, offset: deadzoneOffset(ctx.weapon.aim) }, dt);
      }
      const anchor = anchorWorld();
      // REELED IN at rest, paid out for the wind-up and strokes (censer-swing.ts ropeLength).
      const rope = ropeLength(swing, CENSER_HEAD.ropeLen);
      // The head re-hangs whenever it was out of frame, so a raise never
      // starts with a swing carried over from wherever it was put away.
      if (!headSim || !rig.visible) headSim = makeCenserHead(anchor, rope);
      if (hitWindow(swing)) {
        if (!hits || hits.strokeId !== swing.strokeId) hits = makeStrokeHits(swing.strokeId, swing.heavy ? swing.charge : 0);
      } else {
        hits = null;
      }
      const ledger = hits;
      const ps = ledger ? probes() : [];
      const events: HitEvent[] = [];
      const world: HeadWorld = { floorY: ctx.player.player.pos[1], boxes: ctx.world.colliders };
      headSim = stepCenserHead(headSim, anchor, dt, world, ledger
        ? (from, to, vel) => {
          const r = sweepHead(ledger, from, to, vel, CENSER_HEAD.radius, ps);
          for (const e of r.events) events.push(e);
          return r.velScale;
        }
        : undefined, rope);
      if (events.length > 0) applyHits(events);
      drawHead(anchor, rope);
      aimHand();
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'censer');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      const shown = lower < 0.999 && ownsSlot(ctx, 'censer');
      rig.visible = shown;
      head.visible = shown;
      chain.visible = shown;
    },
    hitStopScale(dt) {
      if (hitStop <= 0) return 1;
      hitStop -= dt;
      return CENSER_FEEL.hitStopScale;
    },
    press() { held = true; },
    release() { held = false; },
    setHitStop(on) { hitStopOn = on; if (!on) hitStop = 0; },
    debug() {
      const h = headSim;
      return {
        phase: swing.phase,
        charge: swing.charge,
        heavy: swing.heavy,
        strokeId: swing.strokeId,
        head: h ? [h.pos[0], h.pos[1], h.pos[2]] : [0, 0, 0],
        headSpeed: h ? Math.hypot(h.vel[0], h.vel[1], h.vel[2]) : 0,
        hits: hitCount,
        lastHit,
        rope: ropeLength(swing, CENSER_HEAD.ropeLen),
        headNdc: screenNdc(head.position),
        knotNdc: screenNdc(anchorW),
      };
    },
  };
}
