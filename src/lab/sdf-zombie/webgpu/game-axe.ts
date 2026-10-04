// src/lab/sdf-zombie/webgpu/game-axe.ts
//
// WEAPON SLOT 7: THE AXE (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §3-§4). The renderer
// half: a primitive axe (wooden haft, steel wedge head) on the goblin arm, on the aim rig, posed from axe-swing.ts.
// A click runs the H -> R -> L chop combo; at each strike frame flail-strike.ts resolveStrike decides who is hit and
// where, and each hit gets the chop's cut (axe-strike.ts axeCutSeg -> cut-wound.ts stampCut). A body chop blasts with
// the chop's collapse credit and shove; a head chop counts (axe-head.ts) -- the chopsToKill-th kills (blast
// forceCollapse) -- and cuts what axe-head.ts headChopCut says: the split's faces when it opens the head, its own
// head-tagged cut, or nothing. The axe NEVER routes into the slug head burst (game-head-damage.ts):
// it has no head-damage dependency. Not a recorded demo verb (like the flail, the flare and the rod). No hit-stop or
// camera kick yet (the flail's flail-impact.ts feel is owned by the flail; an axe feel pass is a follow-up).
//
// THE HEAD SPLIT (spec §4 "Part B behaviour"; deps.split, game-head-split.ts). The first head chop OPENS the head: the
// preset comes from the chop's blade plane and the impact, and the split's cut faces are that chop's cut. Every later
// head chop WIDENS it (axe-head.ts chopOpenFrac), the kill chop to fully open. A chop on an open head stamps its own
// cut only when it lands on the outer skin; on a cut face, or through the gap, the widening is the effect and the
// faces bleed again. A head the split refuses (not the plain zombie, or one head damage already holds) keeps the cuts
// and the count alone.
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { worldHitToWound, type Wound } from '../damage';
import { stampCut, unwarpCutSeg } from '../cut-wound';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { loopBlocksInput } from './game-loop-leaves';
import { BEND_R_VIEW } from './game-weapon-leaves';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms } from './game-arms';
import { axePose, cancelAxeSwing, makeAxeSwing, stepAxeSwing, type AxeSide, type AxeSwing } from './axe-swing';
import { AXE_CALIBRE, AXE_CUT, AXE_HIT, axeCutSeg } from './axe-strike';
import { chopHead, chopOpenFrac, headChopCut, makeAxeHead, type AxeHeadState } from './axe-head';
import { headNeck, isHeadRegion, resolveStrike, strikeActorsFrom } from './flail-strike';
import { createViewmodelLights } from './viewmodel-lights';
import type { HeadSplitLeaf } from './game-head-split';
import { cross, normalize, sub } from '../vec';

export const AXE_LOOK = {
  haftLen: 0.62, haftR: 0.017,
  /** The wedge head: bit width (along the haft), depth (blade to poll), thickness. */
  head: { w: 0.15, d: 0.12, t: 0.024 },
  handScale: 1.3,
  /** The arm's IK shoulder, view metres (the flail's FLAIL_LOOK.handShoulder). */
  handShoulder: new THREE.Vector3(0.35, -0.47, 0.08),
  /** Where the fist holds the haft, haft-local +Y from its bottom end. */
  gripY: 0.08,
  /** The torch FILL's share of the torch's intensity on the axe and its hand (viewmodel-lights.ts; the flail's
   *  FLAIL_LOOK.flashFill). Under the torch itself the haft clipped white: 92% of its samples at rest (NOTES.md). */
  flashFill: 0.018,
} as const;

export interface AxeDeps {
  eye(): Vec3;
  /** The aim ray's direction (world, unit): through the free-aim reticle when free aim is on (game-weapon-leaves aimDir). */
  aimDir(): Vec3;
  /** Blood for a cut (game-world-leaves3 registerBleed). */
  bleed(a: ZombieActor, wound: Wound, point: Vec3, incoming: Vec3): void;
  /** The head split (game-head-split.ts): head chops open and widen it. Absent: cuts and the count only. */
  split?: Pick<HeadSplitLeaf, 'open' | 'widen' | 'isOpen'>;
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
  /** The torch FILL follows this frame's torch (game-main, right after flashlight.update(camera)). */
  syncFill(): void;
  /** Re-list the axe's own lights (game-main, when the muzzle flash is added with the gun). */
  refreshLights(): void;
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
  // OWN LIGHT LIST (viewmodel-lights.ts, the flail's): the torch swapped for a dim fill, on the axe and (below) its hand.
  // Forward route only; none without a renderer (the stub ctx).
  const vlights = renderer ? createViewmodelLights(ctx, { name: 'axe-flash-fill', fillScale: AXE_LOOK.flashFill }) : null;
  vlights?.relist();
  vlights?.ownLights(rig);

  let hand: THREE.Object3D | null = null;
  if (env) {
    void loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 }).then((arms) => {
      hand = arms.right; hand.name = 'axe-hand';
      hand.scale.setScalar(AXE_LOOK.handScale);
      vlights?.ownLights(hand);
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
  /** The axe may act: it is the live slot, settled (not lowering / raising), the loop is not blocking input, and no
   *  scripted sequence has started (the rig is hidden then: an ended sequence before the level is done must not chop
   *  unseen; the flail's `!rig.visible` guard). */
  const armed = () => ctx.weapon.slotState.live === 'axe' && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx)
    && !ctx.world.sequence?.started;
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
    const aimYaw = Math.atan2(aim[0], -aim[2]), aimPitch = Math.asin(Math.max(-1, Math.min(1, aim[1])));
    // The cut is stamped in the un-warped head (cut-wound.ts unwarpCutSeg): a chop into an opened half lands on the
    // closed head's prims, where the GPU reads it. The shove and the blood below keep the world point.
    const seg = axeCutSeg(deps.eye(), aimYaw, aimPitch, side, point, dir);
    const cut = unwarpCutSeg(posed, seg);
    const stamp = (): Wound => stampCut(posed.prims, cut.seg, AXE_CALIBRE, yaw, cut.field);
    // The head region: the magnet's hit is on the head by construction; else the flail's test on the struck prim (the
    // probe only finds that prim, so it is skipped for a magnet hit), at the un-warped hit: the prims and the head
    // centre are the closed head's.
    const headRegion = (): boolean => isHeadRegion(
      posed.prims[worldHitToWound(posed.prims, cut.hit, 0.05, 'blast', yaw, cut.field).primIdx]?.limb,
      cut.hit, posed.clusters.find(c => c.limb === 'head' && c.alive)?.center ?? null, headNeck(posed.prims)?.root ?? null);
    const region = magnet || headRegion();
    const f = AXE_HIT[side];
    const impulse = { at: point, vel: [dir[0] * f.shove, dir[1] * f.shove, dir[2] * f.shove] as Vec3 };
    if (!region) {
      const w = stamp();
      a.blast({ wounds: [w], meterCredit: f.meterCredit, impulse, reaction: 'blast' });
      deps.bleed(a, w, point, dir);
      return 0;
    }
    const r = chopHead(heads.get(a.id) ?? makeAxeHead());
    heads.set(a.id, r.state);
    // THE HEAD SPLIT: a closed head opens along the preset nearest the chop's blade plane (the plane through the blade
    // line and the line of sight); an open one widens. `faces` are the split's cut faces, null when there is no split.
    const frac = chopOpenFrac(r.chop);
    const wasOpen = deps.split?.isOpen(a) ?? false;
    const faces = wasOpen
      ? deps.split!.widen(a, frac)
      : deps.split?.open(a, normalize(cross(sub(seg.b, seg.a), dir)), point, frac) ?? null;
    // What the chop cuts (axe-head.ts headChopCut): the faces when it opened the head (they go into the ring with this
    // blast), its own cut, or nothing. The closed head's field at the un-warped hit says whether a chop on an open head
    // met its outer skin.
    const kind = headChopCut(!wasOpen && faces !== null, posed.split ? cut.field(cut.hit) : null);
    let wounds: readonly Wound[] = [];
    if (kind === 'faces') wounds = faces!;
    else if (kind === 'own') {
      const w = stamp();
      // headRegion only, never headSlot: the cut is an ordinary ring member under the MAX_WOUNDS cap, not one of
      // the head's protected MAX_HEAD_WOUNDS slots, and (head-tagged, and a cut) it never merges. pushWound replaces
      // a same-region wound in place, so the region is unique per chop: no chop's cut replaces another's.
      w.headRegion = `axe-${r.chop}`;
      wounds = [w];
    }
    a.blast({ wounds, meterCredit: 0, impulse, reaction: 'flinch', forceCollapse: r.action === 'kill' });
    // The chop's cut bleeds; with none stamped, the faces bleed again (one emitter per wound: bleed-registry.ts).
    for (const w of wounds.length > 0 ? wounds : faces ?? []) deps.bleed(a, w, point, dir);
    return 1;
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
      if (rig.visible) aimHand();   // a hidden axe skips the arm IK
    },
    syncFill() { vlights?.syncFill(); },
    refreshLights() { vlights?.relist(); },
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
