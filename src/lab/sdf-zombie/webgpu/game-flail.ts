// src/lab/sdf-zombie/webgpu/game-flail.ts
//
// WEAPON SLOT 1: THE SPIKE FLAIL (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md).
// The renderer-facing half ONLY: flail-swing.ts owns the swing and its poses,
// flail-strike.ts decides who a strike hits and where. Everything here is a
// child of the aim rig (haft, hand, chain, ball), posed from the swing's
// view-space keyframes; a strike becomes one 'blast' crater per hit through
// ZombieActor.blast(). Not a recorded DemoFrame verb (like the flare).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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
  FLAIL_IMPACT, cancelFlailSwing, flailPose, makeFlailSwing, stepFlailSwing, type FlailSide, type FlailSwing,
} from './flail-swing';
import { resolveStrike, viewToWorld, type StrikeActor } from './flail-strike';

const FLAIL_GLB = '/assets/lab/flail.glb';

/** Feel numbers (spec §6). */
export const FLAIL_FEEL = {
  craterR: 0.14,
  severMul: 1.3,
  meterCredit: 0.35,
  /** Reaction direction magnitude handed to blast() (it unit-normalises). */
  shove: 6,
  hitStopSec: 0.05,
  /** dt multiplier while a hit-stop runs: near-frozen, never 0. */
  hitStopScale: 0.08,
  kickRad: 0.02,
} as const;

/** The look: chain sag, rest sway, the hand. */
export const FLAIL_LOOK = {
  chainLen: 0.3,
  /** How far the drawn chain may stretch past chainLen before the drawn ball
   *  is clamped toward the eye bolt (see draw(): the swing's ball keys are
   *  authored for the strike logic, not for a 0.3 m chain). */
  chainStretch: 1.15,
  /** Ball centre → its ring, metres (the chain meets the ring, not the centre). */
  ringOffset: 0.07,
  linkPitch: 0.013,
  swayAmp: 0.012,
  swayHz: 0.9,
  handScale: 0.8,
  /** The arm's IK shoulder, view metres (the gun arms' SHOULDER_R_VIEW is 0.26, −0.30, 0.06). */
  handShoulder: new THREE.Vector3(0.35, -0.47, 0.08),
  /** Primitive haft tip (the GLB's ChainAnchor replaces it), haft-local. */
  primAnchorY: 0.3,
} as const;

export interface FlailDeps {
  eye(): Vec3;
  /** Blood for a crater (game-world-leaves3 registerBleed). */
  bleed(a: ZombieActor, wound: Wound, point: Vec3, incoming: Vec3): void;
}

export interface FlailDebug {
  phase: string;
  side: FlailSide;
  swingId: number;
  strikes: number;
  lastStrike: { side: FlailSide; hits: number[] } | null;
  /** This frame's eye-bolt → ball-centre distance (view metres): `keyed` is the
   *  swing's own ball pose, `drawn` the ball after the chain clamp. */
  ballBolt: { keyed: number; drawn: number };
  /** The drawn ball centre and eye bolt in NDC (gate photos), and the ball's
   *  on-screen radius in NDC-x units. */
  ndc: { ball: [number, number]; bolt: [number, number]; ballR: number };
}

export interface FlailWeapon {
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Once per tick, after the aim rig and holster are placed. */
  tick(dt: number): void;
  updateRig(): void;
  hitStopScale(dt: number): number;
  phase(): string;
  /** Seams. */
  click(): void;
  hold(on: boolean): void;
  setHitStop(on: boolean): void;
  debug(): FlailDebug;
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

  // PRIMITIVES FIRST, GLB OVER THEM (the flare's rule).
  const haftPrim = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.42, 12), wood);
  haftPrim.position.y = 0.09;
  haft.add(haftPrim);
  const ballPrim = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), iron);
  ball.add(ballPrim);

  const linkGeo = new THREE.TorusGeometry(0.007, 0.002, 5, 8);
  const chain = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(linkGeo, iron, MAX_LINKS);
  chain.name = 'flail-chain';
  chain.frustumCulled = false;
  chain.count = 0;
  rig.add(chain);
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
      ball.add(ballNode); ballPrim.visible = false;
      const found: THREE.Mesh[] = [];
      linkNode.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
      if (found[0]) { chain.geometry = found[0].geometry; chain.material = found[0].material; linkGeo.dispose(); }
    } catch (e) {
      console.warn('[sdf-game] flail.glb absent or unreadable — using the primitive flail', e);
    }
  })();

  let hand: THREE.Group | null = null;
  void loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 }).then((arms) => {
    hand = arms.right;
    hand.name = 'flail-hand';
    hand.scale.setScalar(FLAIL_LOOK.handScale);
    haft.add(hand);
  }).catch((e) => console.warn('[sdf-game] flail hand: goblin-arm.glb failed', e));
  const _sh = new THREE.Vector3(), _bend = new THREE.Vector3();
  function aimHand(): void {
    if (!hand) return;
    const view = ctx.weapon.viewModelAnchor;
    view.updateMatrixWorld(true);
    view.localToWorld(_sh.copy(FLAIL_LOOK.handShoulder));
    view.localToWorld(_bend.copy(FLAIL_LOOK.handShoulder).add(BEND_R_VIEW));
    haft.worldToLocal(_sh); haft.worldToLocal(_bend);
    _bend.sub(_sh).normalize();
    aimArm(hand, _sh, _bend);
  }

  let swing: FlailSwing = makeFlailSwing();
  let click = false, held = false;
  let hitStop = 0, hitStopOn = true;
  let strikes = 0, clock = 0;
  let lastStrike: FlailDebug['lastStrike'] = null;
  window.addEventListener('blur', () => { held = false; });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== ctx.boot.canvas) held = false;
  });

  function strike(side: FlailSide): void {
    strikes++;
    const p = ctx.player.player;
    const eye = deps.eye();
    const impact = viewToWorld(eye, p.yaw, p.pitch, FLAIL_IMPACT[side]);
    const actors: StrikeActor[] = [];
    for (const a of ctx.world.actors) {
      const posed = a.posed();
      const c = posed.clusters.find(cc => cc.limb === 'torso')?.center;
      if (c) actors.push({ id: a.id, centre: c, field: q => sdBody(q, posed) });
    }
    const hits = resolveStrike(eye, p.yaw, impact, actors);
    lastStrike = { side, hits: hits.map(h => h.actorId) };
    for (const h of hits) {
      const a = ctx.world.actors.find(x => x.id === h.actorId);
      if (!a) continue;
      const posed = a.posed();
      const w = worldHitToWound(posed.prims, h.point, FLAIL_FEEL.craterR, 'blast', a.pose().yaw, q => sdBody(q, posed));
      w.severRadius = FLAIL_FEEL.craterR * FLAIL_FEEL.severMul;
      clothifyWound(posed.prims, w, 'heavy');
      a.blast({
        wounds: [w],
        meterCredit: FLAIL_FEEL.meterCredit,
        impulse: { at: h.point, vel: [h.dir[0] * FLAIL_FEEL.shove, h.dir[1] * FLAIL_FEEL.shove, h.dir[2] * FLAIL_FEEL.shove] },
        reaction: 'blast',
      });
      deps.bleed(a, w, h.point, h.dir);
    }
    if (hits.length > 0) {
      if (hitStopOn) hitStop = FLAIL_FEEL.hitStopSec;
      ctx.weapon.recoilPitch += FLAIL_FEEL.kickRad;
      ctx.weapon.shotAlert = true;
    }
    ctx.telemetry.telemetry.event('flail-strike', { side, hits: hits.length });
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _roll = new THREE.Quaternion();
  const _p = new THREE.Vector3(), _tan = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const ballBolt = { keyed: 0, drawn: 0 };
  function draw(): void {
    const pose = flailPose(swing);
    haft.position.set(pose.grip[0], pose.grip[1], pose.grip[2]);
    haft.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    const sway = swing.phase === 'idle' ? FLAIL_LOOK.swayAmp : 0;
    const w = 2 * Math.PI * FLAIL_LOOK.swayHz * clock;
    ball.position.set(pose.ball[0] + sway * Math.sin(w), pose.ball[1], pose.ball[2] + sway * 0.7 * Math.sin(w * 1.3));
    haft.updateMatrix();
    _a.copy(anchorLocal).applyMatrix4(haft.matrix);          // the eye bolt, rig-local
    // CHAIN CLAMP (visual only — the strike reads FLAIL_IMPACT, never the drawn
    // ball). The swing's ball keys are authored for WHERE the strike lands, and
    // its follow-through key sits ~1.6 m out: drawn raw, the chain would stretch
    // a metre or the ball would float free of it. Keep the drawn ball within a
    // slightly stretched chain of the bolt, along the bolt → ball direction.
    _tan.copy(ball.position).sub(_a);
    const keyed = _tan.length();
    const maxCentre = FLAIL_LOOK.chainLen * FLAIL_LOOK.chainStretch + FLAIL_LOOK.ringOffset;
    if (keyed > maxCentre) ball.position.copy(_a).addScaledVector(_tan, maxCentre / keyed);
    ballBolt.keyed = keyed;
    ballBolt.drawn = _a.distanceTo(ball.position);
    // The ball's ring faces the bolt; the chain ends at the ring.
    if (ballBolt.drawn > 1e-6) _tan.copy(_a).sub(ball.position).normalize(); else _tan.copy(Y);
    ball.quaternion.setFromUnitVectors(Y, _tan);
    _b.copy(ball.position).addScaledVector(_tan, FLAIL_LOOK.ringOffset); // the ring, rig-local
    const span = _a.distanceTo(_b);
    const sag = Math.max(0, FLAIL_LOOK.chainLen - span) * 0.6;
    _c.copy(_a).add(_b).multiplyScalar(0.5); _c.y -= sag;
    const n = Math.min(MAX_LINKS, Math.max(2, Math.round(Math.max(span, FLAIL_LOOK.chainLen * 0.8) / FLAIL_LOOK.linkPitch)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, u = 1 - t;
      _p.set(u * u * _a.x + 2 * u * t * _c.x + t * t * _b.x, u * u * _a.y + 2 * u * t * _c.y + t * t * _b.y, u * u * _a.z + 2 * u * t * _c.z + t * t * _b.z);
      _tan.set(2 * u * (_c.x - _a.x) + 2 * t * (_b.x - _c.x), 2 * u * (_c.y - _a.y) + 2 * t * (_b.y - _c.y), 2 * u * (_c.z - _a.z) + 2 * t * (_b.z - _c.z));
      if (_tan.lengthSq() < 1e-12) _tan.copy(Y); else _tan.normalize();
      _q.setFromUnitVectors(Y, _tan);
      _roll.setFromAxisAngle(_tan, i % 2 === 0 ? 0 : Math.PI / 2);
      _q.premultiply(_roll);
      chain.setMatrixAt(i, _m.compose(_p, _q, _one));
    }
    chain.count = n;
    chain.instanceMatrix.needsUpdate = true;
    aimHand();
  }

  /** Gate readback only (never per frame): where the ball and bolt are on screen. */
  function ndcNow(): FlailDebug['ndc'] {
    const cam = ctx.boot.handle.camera;
    rig.updateMatrixWorld(true);
    const b = ball.getWorldPosition(new THREE.Vector3());
    const r = b.clone().add(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(0.06));
    const k = haft.localToWorld(anchorLocal.clone());
    b.project(cam); r.project(cam); k.project(cam);
    return { ball: [b.x, b.y], bolt: [k.x, k.y], ballR: Math.hypot(r.x - b.x, r.y - b.y) };
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'flail') return false;
      if (button === 0) { click = true; held = true; }
      return true;
    },
    onMouseUp(button) { if (button === 0) held = false; },
    tick(dt) {
      if (!rig.visible) { swing = cancelFlailSwing(swing); click = false; return; }
      clock += dt;
      const ready = ctx.weapon.slotState.live === 'flail' && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
      if (!ready) {
        swing = cancelFlailSwing(swing);
      } else {
        const r = stepFlailSwing(swing, { click, held }, dt);
        swing = r.state;
        for (const side of r.strikes) strike(side);
      }
      click = false;
      draw();
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'flail');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999 && ownsSlot(ctx, 'flail');
    },
    hitStopScale(dt) {
      if (hitStop <= 0) return 1;
      hitStop -= dt;
      return FLAIL_FEEL.hitStopScale;
    },
    phase: () => swing.phase,
    click() { click = true; },
    hold(on) { held = on; },
    setHitStop(on) { hitStopOn = on; if (!on) hitStop = 0; },
    debug: () => ({ phase: swing.phase, side: swing.side, swingId: swing.swingId, strikes, lastStrike, ballBolt: { ...ballBolt }, ndc: ndcNow() }),
  };
}
