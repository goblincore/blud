// src/lab/sdf-zombie/webgpu/game-seams-head.ts
//
// Head damage automation seams (melee head damage, game-head-damage.ts): read an actor's head state and
// drive a head hit directly, without swinging (the gates' stage driver). A seam hit is not a flail strike,
// so the flail's own lastStrike.headHits does not count it.
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import { FLAIL_FEEL } from './game-flail';
import { sdBody, sdPrimitive } from '../validate';
import { headQuatOf } from '../rig-bind';
import { burstTuning, setBurstTuning } from '../head-burst';
import type { BuildResult } from '../build-body';

/** game-main's headShape (the fattest additive head prim's midpoint and radius·scale axes — the frame the face
 *  sheet and the head damage leaf use), mirrored here so the seam need not import game-main. */
function headShapeOf(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = b.clusters.find(c => c.limb === 'head');
  if (!head) return null;
  let best: { centre: Vec3; axes: Vec3 } | null = null;
  let bestR = -Infinity;
  for (const p of b.prims.slice(head.start, head.start + head.count)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = {
        centre: [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2],
        axes: [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]],
      };
    }
  }
  return best;
}

export function createHeadSeams(ctx: GameContext) {
  return {
    head: {
      /** The leaf's debug for actor `id` (null before its first head hit). */
      state: (id: number) => ctx.weapon.headDamage?.debug(id) ?? null,
      /** Slug head burst tuning (head-burst.ts burstTuning): set any of { on, centreFrac, swell, shardScale, flapCount }.
       *  Returns the live values. `on: false` sends every slug down the ordinary path. */
      burstTune: (p: Partial<typeof burstTuning>) => setBurstTuning(p),
      burstTuning: () => ({ ...burstTuning }),
      /** Actor `id`'s UN-deformed head frame { centre, quat, axes } (world; hs = conj(quat)·(p − centre) ÷ axes):
       *  the leaf's own once it has one, else measured now the way the leaf does (headShape + the rigid head's
       *  rotation) — valid before the first head hit, while the head is undeformed. The gates aim the crosshair at
       *  a region's world point (HEAD_REGIONS) with it. Null: no such actor, or no head. */
      frame: (id: number): { centre: Vec3; quat: number[]; axes: Vec3 } | null => {
        const leafFrame = ctx.weapon.headDamage?.debug(id)?.frame;
        if (leafFrame) return leafFrame;
        const a = ctx.world.actors.find(q => q.id === id);
        const s = a ? headShapeOf(a.posed()) : null;
        if (!a || !s) return null;
        const q = headQuatOf(a.boundRig(), a.pose().yaw);
        return { centre: s.centre, axes: s.axes, quat: q ? [...q] : [0, 0, 0, 1] };
      },
      /** sdBody of actor `id`'s posed body (head deform included; the GPU wound carves are NOT) at world (x, y, z): the
       *  gate's dent and face-change probes. Null when there is no such actor. */
      surfaceAt: (id: number, x: number, y: number, z: number): number | null => {
        const a = ctx.world.actors.find(q => q.id === id);
        return a ? sdBody([x, y, z], a.posed()) : null;
      },
      /** The head's BONE field (the posed head bone prims — the skull the mesh skeleton is extracted from, head
       *  deform included) at world (x, y, z): negative inside the skull. Null: no actor, or no head bone. */
      boneAt: (id: number, x: number, y: number, z: number): number | null => {
        const a = ctx.world.actors.find(q => q.id === id);
        if (!a) return null;
        let d = Infinity;
        for (const p of a.posed().bonePrims ?? []) if (p.op === 'bone' && p.limb === 'head' && !p.dead) d = Math.min(d, sdPrimitive([x, y, z], p));
        return Number.isFinite(d) ? d : null;
      },
      /** WHAT IS DRAWN NEAR A POINT: everything this frame draws whose position lies within `r` m of world (x, y, z),
       *  by the list it is drawn from. A gate asks it at a head's old place after the head has left: only what flew
       *  off with a velocity belongs there, and nothing after a moment.
       *    bones     the bone-mesh renderer's instances (their owner's id, an eye or a bone, an organ, the split piece);
       *    attached  the pieces riding an actor (the head damage's eyes, plugs and flaps): chunk views off the lists;
       *    chunks    the flying SDF gib pieces (id, tag, kind, speed);
       *    baked     the settled ones;
       *    meshGibs  the mesh gibs (the brain, skull fragments: tag, speed);
       *    flesh     live flesh prims of any actor's head cluster there (the actor's id and the prim's index). */
      drawnNear: (x: number, y: number, z: number, r: number) => {
        const near = (p: ArrayLike<number>) => Math.hypot(p[0]! - x, p[1]! - y, p[2]! - z) <= r;
        const at = (p: ArrayLike<number>) => [p[0]!, p[1]!, p[2]!].map(v => Math.round(v * 1000) / 1000);
        const speed = (v: ArrayLike<number>) => Math.round(Math.hypot(v[0]!, v[1]!, v[2]!) * 100) / 100;
        const mesh = ctx.render.segMeshRenderer;
        return {
          bones: (mesh ? mesh.drawn : []).map(d => ({ d, p: [d.matrix.elements[12]!, d.matrix.elements[13]!, d.matrix.elements[14]!] }))
            .filter(e => near(e.p))
            .map(e => ({ owner: (e.d.owner as { id?: number } | null)?.id ?? -1, eye: e.d.eye, organ: e.d.organ, piece: e.d.piece, pos: at(e.p) })),
          attached: ctx.bake.attachedViews.filter(v => v.object.visible && near(v.object.position.toArray()))
            .map(v => ({ pos: at(v.object.position.toArray()) })),
          chunks: ctx.bake.liveChunks.filter(c => c.view.object.visible && near(c.state.pos))
            .map(c => ({ id: c.id, tag: c.tag ?? null, kind: c.kind, pos: at(c.state.pos), speed: speed(c.state.vel) })),
          baked: ctx.bake.chunks.filter(b => near(b.centre)).map(b => ({ id: b.id, pos: at(b.centre) })),
          meshGibs: ctx.gibs.meshGibs.filter(g => near(g.state.pos)).map(g => ({ tag: g.tag, pos: at(g.state.pos), speed: speed(g.state.vel) })),
          flesh: ctx.world.actors.flatMap(a => a.posed().prims
            .map((q, i) => ({ q, i }))
            .filter(e => e.q.limb === 'head' && !e.q.dead && near([(e.q.a[0] + e.q.b[0]) / 2, (e.q.a[1] + e.q.b[1]) / 2, (e.q.a[2] + e.q.b[2]) / 2]))
            .map(e => ({ actor: a.id, prim: e.i, op: e.q.op ?? 'add', radius: e.q.radius }))),
        };
      },
      /** The live brain MESH gibs' positions (world; game-mesh-gibs.ts, tag 'brain'), oldest first. */
      brains: (): number[][] => ctx.gibs.meshGibs.filter(g => g.tag === 'brain').map(g => [...g.state.pos]),
      /** The live snapped-EYE gibs (spawnChunkPiece tag 'eye'; head-eye EYE_FLY), oldest first: chunk id, world
       *  position and velocity — the gate samples the comic flight's arc and bounces every frame. */
      eyeGibs: (): { id: number; pos: number[]; vel: number[] }[] =>
        ctx.bake.liveChunks.filter(c => c.tag === 'eye').map(c => ({ id: c.id, pos: [...c.state.pos], vel: [...c.state.vel] })),
      /** Switch actor `id`'s painted eye glow per eye (the face shader's per-eye mask, zombie-gpu setEyeGlow).
       *  'L' = the face sheet's image-left eye (hs.x < 0): the zombie's own RIGHT eye. False when no such actor. */
      eyeGlow: (id: number, side: 'L' | 'R', on: boolean): boolean => {
        const a = ctx.world.actors.find(q => q.id === id);
        if (!a) return false;
        a.view.setEyeGlow(side, on);
        return true;
      },
      /** One head hit at world point (x, y, z), blow direction (dx, dy, dz) (normalised here), with swing
       *  `side`'s feel (default R; H strips 0.35, R/L 0.25). False when there is no such actor or no leaf, or the
       *  leaf declined the hit (the head is split open). */
      hit: (id: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, side: 'R' | 'L' | 'H' = 'R'): boolean => {
        const a = ctx.world.actors.find(q => q.id === id);
        const leaf = ctx.weapon.headDamage;
        if (!a || !leaf) return false;
        const l = Math.hypot(dx, dy, dz) || 1;
        const dir: Vec3 = [dx / l, dy / l, dz / l];
        const f = FLAIL_FEEL.swing[side];
        return leaf.hit(a, [x, y, z], dir, { meterCredit: f.meterCredit, shove: f.shove, side });
      },
    },
  };
}
