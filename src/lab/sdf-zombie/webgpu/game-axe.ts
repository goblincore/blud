// src/lab/sdf-zombie/webgpu/game-axe.ts
//
// WEAPON SLOT 7: THE AXE (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §3-§4). The renderer
// half: a primitive axe (wooden haft, steel wedge head) on the goblin arm, on the aim rig, posed from axe-swing.ts.
// A click runs the H -> R -> L chop combo; at each strike frame flail-strike.ts resolveStrike decides who is hit and
// where, and each hit gets the chop's cut (axe-strike.ts axeCutSeg -> cut-wound.ts stampCut). A body chop blasts with
// the chop's collapse credit and shove; a head chop stamps a head-tagged cut and counts (axe-head.ts) -- the
// chopsToKill-th kills (blast forceCollapse). The axe NEVER routes into the slug head burst (game-head-damage.ts):
// it has no head-damage dependency. Not a recorded demo verb (like the flail, the flare and the rod). No hit-stop or
// camera kick yet (the flail's flail-impact.ts feel is owned by the flail; an axe feel pass is a follow-up).
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { worldHitToWound, type Wound } from '../damage';
import { sdBody } from '../validate';
import { stampCut } from '../cut-wound';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { loopBlocksInput } from './game-loop-leaves';
import { BEND_R_VIEW } from './game-weapon-leaves';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms } from './game-arms';
import { axePose, cancelAxeSwing, makeAxeSwing, stepAxeSwing, type AxeSide, type AxeSwing } from './axe-swing';
import { AXE_CALIBRE, AXE_CUT, AXE_HIT, axeCutSeg } from './axe-strike';
import { chopHead, makeAxeHead, type AxeHeadState } from './axe-head';
import { headNeck, isHeadRegion, resolveStrike, strikeActorsFrom } from './flail-strike';

export const AXE_LOOK = {
  haftLen: 0.62, haftR: 0.017,
  /** The wedge head: bit width (along the haft), depth (blade to poll), thickness. */
  head: { w: 0.15, d: 0.12, t: 0.024 },
  handScale: 1.3,
  /** The arm's IK shoulder, view metres (the flail's FLAIL_LOOK.handShoulder). */
  handShoulder: new THREE.Vector3(0.35, -0.47, 0.08),
  /** Where the fist holds the haft, haft-local +Y from its bottom end. */
  gripY: 0.08,
} as const;

export interface AxeDeps {
  eye(): Vec3;
  /** The aim ray's direction (world, unit): through the free-aim reticle when free aim is on (game-weapon-leaves aimDir). */
  aimDir(): Vec3;
  /** Blood for a cut (game-world-leaves3 registerBleed). */
  bleed(a: ZombieActor, wound: Wound, point: Vec3, incoming: Vec3): void;
}

export interface AxeDebug {
  phase: 'idle' | 'swing'; side: AxeSide; swingId: number; strikes: number;
  /** The last strike: its side, the ids it hit, which of those were head chops, and each hit's world point. */
  last: { side: AxeSide; hits: number[]; heads: number[]; points: Vec3[] } | null;
  /** Head chops per actor id. */
  heads: Record<number, number>;
  /** Where the drawn axe is (world, gate readback only): the fist's grip point on the haft, the haft's top end, the
   *  head's centre, the hand's origin (null until the goblin arm loads), and whether the rig is shown. */
  rig: { grip: Vec3; top: Vec3; head: Vec3; hand: Vec3 | null; visible: boolean };
}

export interface AxeHarness {
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  tick(dt: number): void;
  updateRig(): void;
  /** Seam (gates): a click, as the mouse would give, on the next tick. */
  click(): void;
  /** Seam (gates): strike actor `id` now with chop `side`, aimed at its torso or head centre. The strike arc is
   *  ignored, but resolveStrike still enforces FLAIL_STRIKE.reach (1.8 m, horizontal, eye to torso centre): a farther
   *  actor is not hit. Returns the hits, which is the wounds stamped (one cut per hit). */
  chop(id: number, side: AxeSide, target?: 'torso' | 'head'): number;
  debug(): AxeDebug;
  /** Remove the window / document listeners (tests; a teardown). */
  dispose(): void;
}

export function createAxeHarness(ctx: GameContext, deps: AxeDeps): AxeHarness {
  // --- the primitive axe on the aim rig (the rod's rig pattern; the flail's arm and env).
  const rig = new THREE.Group(); rig.name = 'axe-rig';
  ctx.weapon.aimRig!.add(rig);
  const haft = new THREE.Group(); haft.name = 'axe-haft';
  rig.add(haft);
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.8, metalness: 0 });
  // Metal reads near black in forward mode without an env (game-rod.ts's note): the flail's PMREM room env, built once.
  // The stub ctx (tests) has no renderer: no env, and so no goblin arm (below).
  let env: THREE.Texture | null = null;
  const renderer = ctx.boot.handle?.renderer;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    env = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    room.dispose();
  }
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.35, metalness: 0.85, envMap: env, envMapIntensity: 1.1 });
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(AXE_LOOK.haftR, AXE_LOOK.haftR * 1.15, AXE_LOOK.haftLen, 10), wood);
  stick.position.y = AXE_LOOK.haftLen / 2 - AXE_LOOK.gripY;
  haft.add(stick);
  const bit = new THREE.Mesh(new THREE.BoxGeometry(AXE_LOOK.head.d, AXE_LOOK.head.w, AXE_LOOK.head.t), steel);
  // The head at the haft's top, the blade edge toward haft-local -Z (forward at the strike pose, rot.x ~ -1.25).
  bit.position.set(0, AXE_LOOK.haftLen - AXE_LOOK.gripY - AXE_LOOK.head.w / 2, -AXE_LOOK.head.d / 2 + AXE_LOOK.haftR);
  bit.rotation.y = Math.PI / 2;
  haft.add(bit);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  let hand: THREE.Object3D | null = null;
  if (env) {
    void loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 }).then((arms) => {
      hand = arms.right; hand.name = 'axe-hand';
      hand.scale.setScalar(AXE_LOOK.handScale);
      haft.add(hand);
    }).catch((e) => console.warn('[sdf-game] axe hand: goblin-arm.glb failed', e));
  }
  const _sh = new THREE.Vector3(), _bend = new THREE.Vector3();
  function aimHand(): void {
    if (!hand) return;
    const view = ctx.weapon.viewModelAnchor;
    haft.updateWorldMatrix(true, false);
    view.localToWorld(_sh.copy(AXE_LOOK.handShoulder));
    view.localToWorld(_bend.copy(AXE_LOOK.handShoulder).add(BEND_R_VIEW));
    haft.worldToLocal(_sh); haft.worldToLocal(_bend);
    _bend.sub(_sh).normalize();
    // aimArm solves with the arm's unscaled bone lengths: solve against the shoulder offset / handScale (game-flail.ts).
    _sh.sub(hand.position).divideScalar(AXE_LOOK.handScale).add(hand.position);
    aimArm(hand, _sh, _bend);
  }

  // --- the swing and the input (the rod's armed gate).
  let swing: AxeSwing = makeAxeSwing();
  let click = false, held = false, strikes = 0;
  let last: AxeDebug['last'] = null;
  const heads = new Map<number, AxeHeadState>();
  /** The axe may act: it is the live slot, settled (not lowering / raising) and the loop is not blocking input. */
  const armed = () => ctx.weapon.slotState.live === 'axe' && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
  const release = () => { held = false; click = false; };
  // A button released outside the window or with the lock lost never reaches us: do not stay held (the rod's resets).
  const onBlur = () => release();
  const onLock = () => { if (document.pointerLockElement !== ctx.boot.canvas) release(); };
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLock);

  /** One hit's cut and blast. `aim` is the strike's aim direction (the chop's blade line is drawn in its view). Returns
   *  1 for a head chop, 0 for a body chop. */
  function hitActor(a: ZombieActor, side: AxeSide, aim: Vec3, point: Vec3, dir: Vec3, magnet: boolean): number {
    const posed = a.posed();
    const yaw = a.pose().yaw;
    const field = (q: Vec3) => sdBody(q, posed);
    const aimYaw = Math.atan2(aim[0], -aim[2]), aimPitch = Math.asin(Math.max(-1, Math.min(1, aim[1])));
    const w = stampCut(posed.prims, axeCutSeg(deps.eye(), aimYaw, aimPitch, side, point, dir), AXE_CALIBRE, yaw, field);
    // The head region: the magnet's hit is on the head by construction; else the flail's test on the struck prim (the
    // probe only finds that prim, so it is skipped for a magnet hit).
    const region = magnet || isHeadRegion(
      posed.prims[worldHitToWound(posed.prims, point, 0.05, 'blast', yaw, field).primIdx]?.limb,
      point, posed.clusters.find(c => c.limb === 'head' && c.alive)?.center ?? null, headNeck(posed.prims)?.root ?? null);
    const f = AXE_HIT[side];
    const impulse = { at: point, vel: [dir[0] * f.shove, dir[1] * f.shove, dir[2] * f.shove] as Vec3 };
    if (region) {
      const r = chopHead(heads.get(a.id) ?? makeAxeHead());
      heads.set(a.id, r.state);
      // headRegion only, never headSlot: the cut is an ordinary ring member under the MAX_WOUNDS cap, not one of
      // head-damage's protected MAX_HEAD_WOUNDS slots, and (head-tagged, and a cut) it never merges. pushWound replaces
      // a same-region wound in place, so the region is unique per chop: no chop's cut replaces another's.
      w.headRegion = `axe-${r.chop}`;
      a.blast({ wounds: [w], meterCredit: 0, impulse, reaction: 'flinch', forceCollapse: r.action === 'kill' });
    } else {
      a.blast({ wounds: [w], meterCredit: f.meterCredit, impulse, reaction: 'blast' });
    }
    deps.bleed(a, w, point, dir);
    return region ? 1 : 0;
  }

  function strike(side: AxeSide, only?: { id: number; target: 'torso' | 'head' }): number {
    const eye = deps.eye();
    let d = deps.aimDir();
    let list = strikeActorsFrom(ctx.world.actors);
    let arc: number = AXE_CUT.arcDeg;
    if (only) {
      list = list.filter(s => s.id === only.id);
      const s = list[0];
      const tgt = s && (only.target === 'head' ? s.head?.centre : s.centre);
      if (!s || !tgt) return 0;
      const v: Vec3 = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      d = [v[0] / l, v[1] / l, v[2] / l];
      arc = 180;
    }
    strikes++;
    const aim: Vec3 = [eye[0] + d[0], eye[1] + d[1], eye[2] + d[2]];
    const hits = resolveStrike(eye, Math.atan2(d[0], -d[2]), aim, list, arc);
    const headIds: number[] = [];
    for (const h of hits) {
      const a = ctx.world.actors.find(x => x.id === h.actorId);
      if (a && hitActor(a, side, d, h.point, h.dir, !!h.magnet)) headIds.push(a.id);
    }
    last = { side, hits: hits.map(h => h.actorId), heads: headIds, points: hits.map(h => [h.point[0], h.point[1], h.point[2]] as Vec3) };
    ctx.telemetry.telemetry.event('axe-strike', { side, hits: hits.length, heads: headIds.length });
    return hits.length;
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'axe') return false;
      if (button === 0 && armed()) { click = true; held = true; }
      return true;
    },
    onMouseUp(button) { if (button === 0) held = false; },
    tick(dt) {
      // Switching away (lowering counts: `live` flips only when it ends), the loop blocking input: the swing is gone,
      // and so is the held button (a press is only taken while armed, as the rod's is).
      if (!armed()) { if (swing.phase !== 'idle') swing = cancelAxeSwing(swing); release(); return; }
      const r = stepAxeSwing(swing, { click, held }, dt);
      click = false;
      swing = r.state;
      for (const side of r.strikes) strike(side);
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'axe');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      // Hidden for a scripted sequence, as the flail is (game-sequence-leaves.ts).
      rig.visible = lower < 0.999 && !ctx.world.sequence?.started;
      const p = axePose(swing);
      haft.position.set(p.grip[0], p.grip[1], p.grip[2]);
      haft.rotation.set(p.rot[0], p.rot[1], p.rot[2], 'XYZ');
      aimHand();
    },
    click() { if (armed()) click = true; },
    chop(id, side, target = 'torso') { return strike(side, { id, target }); },
    debug: () => {
      rig.updateMatrixWorld(true);
      const w = (o: THREE.Object3D, local?: THREE.Vector3): Vec3 =>
        (local ? o.localToWorld(local) : o.getWorldPosition(new THREE.Vector3())).toArray() as Vec3;
      return {
        phase: swing.phase, side: swing.side, swingId: swing.swingId, strikes, last,
        heads: Object.fromEntries([...heads].map(([k, v]) => [k, v.chops])),
        rig: {
          grip: w(haft), top: w(haft, new THREE.Vector3(0, AXE_LOOK.haftLen - AXE_LOOK.gripY, 0)), head: w(bit),
          hand: hand ? w(hand) : null, visible: rig.visible,
        },
      };
    },
    dispose() { window.removeEventListener('blur', onBlur); document.removeEventListener('pointerlockchange', onLock); },
  };
}
