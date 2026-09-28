// src/lab/sdf-zombie/webgpu/game-head-damage.ts
//
// THE MELEE HEAD DAMAGE LEAF (spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md; plan
// Task 6). The flail hands head-region hits here (game-flail.ts strike → deps.headHit). The pure modules
// decide everything; this leaf only turns their output into objects:
//   * head-damage.ts  the ladder (eye → cave → scalp → brain) → events;
//   * head-deform.ts  the wobble and the dents → the actor's setHeadDeform hook (applied at every re-pose);
//   * head-eye.ts     the socket ray, the stalk rope, its prims → one hand-posed piece (boot.attachPiece);
//   * head-crown.ts   the crown ray, the scalp craters, the brain and skull chips → onGoreDispatch.
// Wounds go through ZombieActor.blast (the kill is its forceCollapse). The per-actor state lives in this
// module (keyed by the actor object), never on main().
//
// LIFETIME OF THE DANGLING EYE. Its piece is a pooled chunk view drawn every frame until disposed, so it is
// disposed on every way out: the stalk snaps (hit 2), the zombie leaves 'standing' or loses its head
// (headDeath → the eye flies off as a gib), the actor is gone from ctx.world.actors (gibbed, retired, a
// cast rebuild — tick() notices on the next frame) and reset() (rebuildCast calls it first).
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { AttachedPiece } from './game-state-boot';
import type { Primitive, Vec3 } from '../types';
import type { BuildResult } from '../build-body';
import type { GorePiece } from '../head-pop';
import { clothifyWound, woundWorldPos, worldHitToWound, type Wound } from '../damage';
import { sdBody } from '../validate';
import { headQuatOf } from '../rig-bind';
import { headDeath, headHit, makeHeadDamage, type HeadDamageState, type HeadEvent } from '../head-damage';
import {
  addDent, deformHead, kickWobble, makeHeadDeform, rotate, stepWobble,
  type HeadDeformState, type HeadFrame, type Quat,
} from '../head-deform';
import { EYE_STALK, eyeRayStart, makeStalk, nearerEye, stalkPrims, stepStalk, type StalkState } from '../head-eye';
import { CROWN, brainPiece, crownRayStart, scalpCraterPoints, skullChips } from '../head-crown';
import { FLAIL_HEAD, snapToSurface, traceRaySurface } from './flail-strike';
import { rngStreams } from './rng';

/** The leaf's numbers (spec §5, §6). */
export const HEAD_LEAF = {
  /** The eye socket crater (spec §6). */
  socketR: 0.028,
  /** A CAVE / later hit's lasting dent depth (spec §5). */
  dentDepth: 0.018,
  /** The eye's spring-out speed along the reflected blow (spec §6). */
  popSpeed: 2.5,
  /** The dangling eye's iris: the face sheet's glow colour (faceGlowColor, march/body/face.wgsl.ts). */
  iris: [1.9, 0.012, 0.005] as Vec3,
  /** The snapped eye's extra kick: up, and along the blow (m/s). */
  snapUp: 1.5,
  snapAlong: 1.5,
} as const;

export interface HeadHitFeel { meterCredit: number; shove: number }

export interface HeadDamageDeps {
  /** game-main's headShape: the fattest additive head prim's midpoint and radius·scale axes — the frame
   *  the face sheet projects through. Takes a BODY (not the actor) so the deform hook can measure the
   *  un-deformed pose it is handed. */
  headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null;
  /** ctx.boot.onGoreDispatch. */
  gore(a: ZombieActor, pieces: GorePiece[]): void;
  /** The head-pop blood (burstVolume + spawnImpactGout, game-main onHeadPop). */
  burst(a: ZombieActor, at: Vec3, dir: Vec3): void;
  /** Blood for a crater (registerBleed). */
  bleed(a: ZombieActor, w: Wound, point: Vec3, dir: Vec3): void;
  /** ctx.boot.attachPiece (absent before the chunk spawner exists: the eye then pops invisibly). */
  attach?: (a: ZombieActor, prims: Primitive[], pos: Vec3, opts?: { clean?: boolean }) => AttachedPiece;
}

export interface HeadDamageDebug {
  hits: number;
  /** 1 EYE … 4 BRAIN (0 before any hit; the ladder's count, capped at 4). */
  stage: number;
  dead: boolean;
  eye: { side: 'L' | 'R'; state: 'dangling' | 'gone' } | null;
  squash: number;
  flat: number[];
  eyeball: Vec3 | null;
  socket: Vec3 | null;
}

export interface HeadDamageLeaf {
  /** One head-region hit at `point` (world, on the posed surface), blow direction `dir` (world, unit). */
  hit(a: ZombieActor, point: Vec3, dir: Vec3, feel: HeadHitFeel): void;
  tick(dt: number): void;
  /** Drop an actor's state: dispose its dangling eye, clear its deform hook. */
  forget(id: number): void;
  /** Drop every actor's state (a cast rebuild / level reset). */
  reset(): void;
  debug(id: number): HeadDamageDebug | null;
}

interface Dangling { side: 'L' | 'R'; socket: Wound; stalk: StalkState; piece: AttachedPiece | null }
interface ActorHead { ladder: HeadDamageState; deform: HeadDeformState; eye: Dangling | null }

const IDENTITY: Quat = [0, 0, 0, 1];
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The field's outward normal at `p` (central differences). */
function normalAt(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = 0.002;
  return unit([
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ]);
}

const headAlive = (b: BuildResult): boolean => b.clusters.some(c => c.limb === 'head' && c.alive);

export function createHeadDamage(ctx: GameContext, deps: HeadDamageDeps): HeadDamageLeaf {
  const heads = new Map<ZombieActor, ActorHead>();
  let traceMissWarned = false;

  /** The head frame of a body posed at `yaw` by `a`'s rig: headShape + the rigid head's rotation. */
  function frameOf(a: ZombieActor, b: BuildResult): HeadFrame | null {
    const s = deps.headShape(b);
    if (!s) return null;
    return { centre: s.centre, axes: s.axes, quat: (headQuatOf(a.boundRig(), a.pose().yaw) as Quat | null) ?? IDENTITY };
  }

  /** Trace from `from` toward the head centre onto the posed surface; a miss falls back to the nearest
   *  point on the head (snapToSurface) and warns once. */
  function surfaceToward(field: (p: Vec3) => number, from: Vec3, frame: HeadFrame): Vec3 {
    const d = sub(frame.centre, from);
    const l = Math.hypot(d[0], d[1], d[2]);
    const hit = l > 1e-6 ? traceRaySurface(field, from, [d[0] / l, d[1] / l, d[2] / l], l + 0.1) : null;
    if (hit) return hit;
    if (!traceMissWarned) {
      traceMissWarned = true;
      console.warn('[head-damage] a head trace missed the posed surface; snapping to the nearest point instead');
    }
    return snapToSurface(field, from);
  }

  const stalkWorldPrims = (s: StalkState) => stalkPrims(s, HEAD_LEAF.iris);

  /** The dangling eye flies off: the stalk's free half and the eyeball become one gib. */
  function snapEye(a: ZombieActor, h: ActorHead, dir: Vec3): void {
    const e = h.eye;
    if (!e) return;
    h.eye = null;
    e.piece?.dispose();
    const all = stalkWorldPrims(e.stalk);
    const caps = EYE_STALK.nodes - 1;
    // Capsules from the rope's middle on, then the eyeball (stalkPrims' order: caps, then the eye).
    const prims = [...all.slice(Math.floor(caps / 2), caps), ...all.slice(caps)];
    const n = e.stalk.p.length;
    const last = e.stalk.p[n - 1]!, prev = e.stalk.prev[n - 1]!;
    const hz = EYE_STALK.stepHz;
    const r = rngStreams.misc;
    const piece: GorePiece = {
      // 'torso', not 'head': a head chunk wears the face projection (boot.attachPiece's rule).
      limb: 'torso', origin: [last[0], last[1], last[2]], prims, kind: 'gob', tornAt: [], bones: [],
      vel: [
        (last[0] - prev[0]) * hz + dir[0] * HEAD_LEAF.snapAlong,
        (last[1] - prev[1]) * hz + HEAD_LEAF.snapUp + dir[1] * HEAD_LEAF.snapAlong,
        (last[2] - prev[2]) * hz + dir[2] * HEAD_LEAF.snapAlong,
      ],
      angVel: [(r() - 0.5) * 12, (r() - 0.5) * 12, (r() - 0.5) * 12],
    };
    deps.gore(a, [piece]);
  }

  function drop(a: ZombieActor, h: ActorHead): void {
    h.eye?.piece?.dispose();
    h.eye = null;
    a.setHeadDeform(null);
    heads.delete(a);
  }

  function hit(a: ZombieActor, point: Vec3, dir: Vec3, feel: HeadHitFeel): void {
    const posed = a.posed();
    const yaw = a.pose().yaw;
    const field = (q: Vec3) => sdBody(q, posed);
    const frame = headAlive(posed) ? frameOf(a, posed) : null;
    const tag = (w: Wound, slot: 'keep' | 'face'): Wound => {
      w.headSlot = slot; w.severRadius = 0;
      return clothifyWound(posed.prims, w, 'heavy');
    };
    const impulse = { at: point, vel: [dir[0] * feel.shove, dir[1] * feel.shove, dir[2] * feel.shove] as Vec3 };
    if (!frame) {
      // No head to damage (off, or no head prims): the flail's plain face crater.
      const w = worldHitToWound(posed.prims, point, FLAIL_HEAD.faceCraterR, 'blast', yaw, field);
      w.severRadius = 0;
      clothifyWound(posed.prims, w, 'heavy');
      a.blast({ wounds: [w], meterCredit: feel.meterCredit, impulse, reaction: 'blast' });
      deps.bleed(a, w, point, dir);
      return;
    }
    let h = heads.get(a);
    if (!h) {
      h = { ladder: makeHeadDamage(), deform: makeHeadDeform(), eye: null };
      heads.set(a, h);
      const st = h;
      // Measured on the pose it is handed (fresh from applyRig), so the frame is the un-deformed head's.
      a.setHeadDeform(p => {
        const f = frameOf(a, p);
        return f ? deformHead(p, st.deform, f) : p;
      });
    }
    const dirLocal = rotate(conj(frame.quat), dir);
    const r = headHit(h.ladder, { eyeSide: nearerEye(frame, point) });
    h.ladder = r.state;
    const wounds: Wound[] = [];
    let forceCollapse = false;
    let crown: Vec3 | null = null;
    const crownOf = (): Vec3 => (crown ??= surfaceToward(field, crownRayStart(frame), frame));
    for (const ev of r.events as HeadEvent[]) {
      switch (ev.kind) {
        case 'wobble':
          h.deform = kickWobble(h.deform, dirLocal);
          break;
        case 'eye-pop': {
          const socket = surfaceToward(field, eyeRayStart(frame, ev.side), frame);
          const sw = tag(worldHitToWound(posed.prims, socket, HEAD_LEAF.socketR, 'blast', yaw, field), 'keep');
          wounds.push(sw);
          const n = normalAt(field, socket);
          const k = dot(dir, n);
          const out = unit([dir[0] - 2 * k * n[0], dir[1] - 2 * k * n[1], dir[2] - 2 * k * n[2]]);
          // makeStalk lays the rope STRAIGHT at full length: the piece's bound is fixed from these prims.
          const stalk = makeStalk(socket, out, HEAD_LEAF.popSpeed);
          const piece = deps.attach ? deps.attach(a, stalkWorldPrims(stalk), socket, { clean: true }) : null;
          h.eye = { side: ev.side, socket: { ...sw }, stalk, piece };
          break;
        }
        case 'dent':
          h.deform = addDent(h.deform, dirLocal, HEAD_LEAF.dentDepth, frame.axes);
          break;
        case 'face-crater':
          wounds.push(tag(worldHitToWound(posed.prims, point, FLAIL_HEAD.faceCraterR, 'blast', yaw, field), 'face'));
          break;
        case 'eye-snap':
          snapEye(a, h, dir);
          break;
        case 'scalp':
          for (const p of scalpCraterPoints(crownOf(), frame)) {
            const s = surfaceToward(field, [p[0] + (p[0] - frame.centre[0]) * 0.5, p[1] + (p[1] - frame.centre[1]) * 0.5, p[2] + (p[2] - frame.centre[2]) * 0.5], frame);
            wounds.push(tag(worldHitToWound(posed.prims, s, CROWN.scalpR, 'blast', yaw, field), 'keep'));
          }
          break;
        case 'brain': {
          const c = crownOf();
          wounds.push(tag(worldHitToWound(posed.prims, c, CROWN.brainR, 'blast', yaw, field), 'keep'));
          const rand = rngStreams.misc;
          deps.gore(a, [brainPiece(c, dir, rand), ...skullChips(c, dir, rand)]);
          deps.burst(a, c, [0, 1, 0]);
          break;
        }
        case 'kill':
          forceCollapse = true;
          break;
      }
    }
    a.blast({ wounds, meterCredit: feel.meterCredit, impulse, reaction: 'blast', forceCollapse });
    if (wounds[0]) deps.bleed(a, wounds[0], point, dir);
  }

  function tick(dt: number): void {
    for (const [a, h] of heads) {
      if (!ctx.world.actors.includes(a)) { drop(a, h); continue; }
      const s0 = h.deform.s;
      h.deform = stepWobble(h.deform, dt);
      // A FROZEN actor (?frozen=1, the gates) never steps, and the step is where the deform is re-applied:
      // its posed/drawn head would keep the hit's re-pose — the wobble's PEAK squash (0.25 along the blow),
      // which pulls the face flesh ~2-3 cm back behind the undeformed skull and teeth — for good.
      if (ctx.demo.wanderFrozen && h.deform.s !== s0) a.reposeHead();
      if (!h.eye) continue;
      const posed = a.posed();
      const standing = a.debug().phase === 'standing';
      if (!standing || !headAlive(posed)) {
        const d = headDeath(h.ladder);
        h.ladder = d.state;
        if (d.events.some(e => e.kind === 'eye-snap')) snapEye(a, h, [0, 0, 0]);
        else { h.eye.piece?.dispose(); h.eye = null; }
        continue;
      }
      // The socket rides the posed (wobbling, dented) head.
      const socket = woundWorldPos(posed.prims, h.eye.socket, a.pose().yaw);
      h.eye.stalk = stepStalk(h.eye.stalk, socket, dt);
      const prims = stalkWorldPrims(h.eye.stalk);
      h.eye.piece?.update(socket, prims.map(p => ({ a: sub(p.a, socket), b: sub(p.b, socket) })));
    }
  }

  return {
    hit,
    tick,
    forget(id) {
      for (const [a, h] of heads) if (a.id === id) drop(a, h);
    },
    reset() {
      for (const [a, h] of heads) drop(a, h);
    },
    debug(id) {
      for (const [a, h] of heads) {
        if (a.id !== id) continue;
        const e = h.eye;
        return {
          hits: h.ladder.hits,
          stage: Math.min(4, h.ladder.hits),
          dead: h.ladder.dead,
          eye: h.ladder.eye ? { ...h.ladder.eye } : null,
          squash: h.deform.s,
          flat: [...h.deform.flat],
          eyeball: e ? [...e.stalk.p[e.stalk.p.length - 1]!] as Vec3 : null,
          socket: e ? [...e.stalk.p[0]!] as Vec3 : null,
        };
      }
      return null;
    },
  };
}
