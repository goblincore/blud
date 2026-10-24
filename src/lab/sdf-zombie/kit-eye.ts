// src/lab/sdf-zombie/kit-eye.ts
//
// A KIT EYE THAT POPS (owner, 2026-10-24, on the teratoma: "we would need to figure out some damage effects to the eye,
// like the eyeball popping out"). The teratoma's one great eye is kit mesh (assets-source/teratoma-kit, material
// `cacoeye`), not prims, so the zombie head damage's eye path (head-eye.ts: the face-sheet eyes, the orbit ray) does
// not reach it. This is the same three beats, for an eye the profile declares (MotionProfile.eye):
//
//   intact    the kit eyeball in its socket;
//   dangling  a shot through the eye POPS it: the kit eyeball is hidden, and a MESH eyeball hangs out of the socket on
//             a thick optic stalk (head-eye.ts's verlet rope, drawn SCALED to this eye's size), still looking forward;
//             the hit's own crater is the empty socket. Mesh, not SDF: an SDF piece riding the actor
//             (boot.attachPiece) drew nothing for this eye in the arena;
//   gone      the next hit anywhere, or death, SNAPS it: the eyeball flies off as an eye gib, the stalk goes with it.
//
// Pure: where the eye is, whether a shot goes through it, and the dangling eye's shape. The game leaf is
// webgpu/game-kit-eye.ts.
import { EYE_STALK, type StalkState } from './head-eye';
import { qRotate } from './vec';
import type { Primitive, Vec3 } from './types';

export interface KitEyeSpec {
  /** The eye's centre, body-local metres from the torso's CORE prim's centre (the ball's centre on the teratoma). */
  offset: Vec3;
  /** The eyeball's radius (m). */
  radius: number;
  /** The kit material the eyeball is drawn in: hidden once it pops. */
  material: string;
  /** The popped eyeball's iris colour (linear) and its drawn radius (a touch smaller than in the socket: it reads). */
  iris: Vec3;
  popRadius: number;
  /** The stalk is head-eye.ts's rope (EYE_STALK, sized for a zombie's 3 cm eye) drawn this many times longer and
   *  thicker, so a 0.1 m eyeball hangs on a nerve that fits it. The physics stays the rope's. */
  stalkScale: number;
}

/** The torso's core prim (its `core` flag) in a posed body: the frame the eye rides. */
function corePrim(prims: readonly Primitive[]): Primitive | undefined {
  return prims.find(p => p.limb === 'torso' && p.core && p.op !== 'sub') ?? prims.find(p => p.limb === 'torso');
}

/** The eye's world centre in a POSED body: the core prim's centre plus the offset turned by its orientation (a
 *  `rigid` core carries its bone's rotation as `orient`) or, without one, by the body yaw. */
export function kitEyeCentre(posedPrims: readonly Primitive[], spec: KitEyeSpec, bodyYaw: number): Vec3 | null {
  const core = corePrim(posedPrims);
  if (!core) return null;
  const c: Vec3 = [(core.a[0] + core.b[0]) / 2, (core.a[1] + core.b[1]) / 2, (core.a[2] + core.b[2]) / 2];
  const q = core.orient ?? [0, Math.sin(bodyYaw / 2), 0, Math.cos(bodyYaw / 2)];
  const o = qRotate(q, spec.offset);
  return [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
}

/** The eye's forward (world): the body's +z turned the same way. */
export function kitEyeForward(posedPrims: readonly Primitive[], bodyYaw: number): Vec3 {
  const core = corePrim(posedPrims);
  return qRotate(core?.orient ?? [0, Math.sin(bodyYaw / 2), 0, Math.cos(bodyYaw / 2)], [0, 0, 1]);
}

/** The SOCKET the popped eye hangs from: the eye's front, just past the lids. Hung from the eye's centre (inside the
 *  ball) the eyeball swung down inside the flesh and never showed (first arena look, 2026-10-24). */
export function kitEyeSocket(centre: Vec3, forward: Vec3, spec: KitEyeSpec): Vec3 {
  const k = spec.radius + 0.06;
  return [centre[0] + forward[0] * k, centre[1] + forward[1] * k, centre[2] + forward[2] * k];
}

/** Did a shot that hit the flesh at `point`, travelling `dir` (unit), go through the eye? The round is traced against
 *  the FLESH only (the kit eyeball is not solid), so a shot at the eye stops on the lids in front of it or the flesh
 *  behind; the honest test is the shot's LINE: within the eyeball's radius of its centre, and the eye no more than
 *  0.3 m along the line from where it hit. A test on the hit point alone missed a dead-centre shot that stopped on the
 *  lower lid 0.2 m from the centre (arena, 2026-10-24). */
export function hitsKitEye(point: Vec3, dir: Vec3, centre: Vec3, spec: KitEyeSpec): boolean {
  const d: Vec3 = [centre[0] - point[0], centre[1] - point[1], centre[2] - point[2]];
  const along = d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
  if (Math.abs(along) > 0.3) return false;
  const px = d[0] - dir[0] * along, py = d[1] - dir[1] * along, pz = d[2] - dir[2] * along;
  return Math.hypot(px, py, pz) <= spec.radius;
}

/** The dangling eye's shape, world space: the rope's nodes drawn `stalkScale` x about its socket (node 0), the
 *  eyeball's centre (the last node) and where it looks (mostly out of the face, a little along the rope). */
export function danglingKitEye(stalk: StalkState, spec: KitEyeSpec, forward: Vec3): { nodes: Vec3[]; eye: Vec3; look: Vec3 } {
  const s0 = stalk.p[0]!;
  const k = spec.stalkScale;
  const nodes = stalk.p.map(q => [s0[0] + (q[0] - s0[0]) * k, s0[1] + (q[1] - s0[1]) * k, s0[2] + (q[2] - s0[2]) * k] as Vec3);
  const n = nodes.length, last = nodes[n - 1]!, before = nodes[n - 2]!;
  const al = Math.hypot(last[0] - before[0], last[1] - before[1], last[2] - before[2]) || 1;
  const lk = [0.75 * forward[0] + 0.25 * (last[0] - before[0]) / al, 0.75 * forward[1] + 0.25 * (last[1] - before[1]) / al,
    0.75 * forward[2] + 0.25 * (last[2] - before[2]) / al];
  const ll = Math.hypot(lk[0]!, lk[1]!, lk[2]!) || 1;
  return { nodes, eye: last, look: [lk[0]! / ll, lk[1]! / ll, lk[2]! / ll] };
}

/** The stalk's radius at the socket and at the eye (m): EYE_STALK's, scaled with the rope. */
export function kitEyeStalkRadii(spec: KitEyeSpec): [number, number] {
  return [EYE_STALK.r0 * spec.stalkScale * 2.2, EYE_STALK.r1 * spec.stalkScale * 2.2];
}

/** The stalk's drawn length (m): where the popped eyeball hangs from the socket. */
export function kitEyeStalkLength(spec: KitEyeSpec): number {
  return EYE_STALK.len * spec.stalkScale;
}

