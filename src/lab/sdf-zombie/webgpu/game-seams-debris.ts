// src/lab/sdf-zombie/webgpu/game-seams-debris.ts
//
// Debris seams (plan docs/superpowers/plans/2026-10-25-sector-levels-3b-debris-and-barrels.md Task 9): where every
// loose piece a fight leaves behind rests — gib chunks, mesh gibs, sprite pieces, blood splats, gut ropes, dropped
// guns, casings and kit pieces, bundles in flight, pickups — plus the three drivers the debris gate uses (collapse an
// actor, a blood burst at a point, a bundle with no prop). Plain data only, so the gate compares each y with
// `__sdfGame.ground(x, z).floor`.
import type { GameContext } from './game-context';
import type { BakeState } from './game-state-bake';
import { chunkSettled, chunkSupportOffset } from '../gib-chunks';
import { spritePieceStates } from './gib-sprite-pieces';
import { burst } from '../blood-sim';
import { makeFlight } from '../dynamite-flight';
import { rngStreams } from './rng';

type LiveBundle = BakeState['liveBundles'][number];

export function createDebrisSeams(ctx: GameContext) {
  return {
    /** Every loose piece and where it rests (plan 3b gate): compare each y with __sdfGame.ground(x, z).floor. */
    debris: () => ({
      chunks: ctx.bake.liveChunks.map(c => ({
        id: c.id, tag: c.tag ?? null, pos: [...c.state.pos], settled: chunkSettled(c.state),
        support: chunkSupportOffset(c.state), floorY: c.state.floorY ?? 0,
      })),
      meshGibs: ctx.gibs.meshGibs.map(g => ({
        id: g.id ?? -1, tag: g.tag, pos: [...g.state.pos], settled: chunkSettled(g.state),
        support: chunkSupportOffset(g.state), floorY: g.state.floorY ?? 0,
      })),
      sprites: spritePieceStates(ctx.vfx.spritePieces).map(p => ({
        id: p.id, limb: p.limb, kind: p.kind, rest: p.rest, settled: p.settled, pos: [...p.pos], floorY: p.floorY,
      })),
      splats: ctx.vfx.bloodSim.splats.map(s => [...s.pos]),
      droplets: ctx.vfx.bloodSim.droplets.filter(d => d.kind !== 'gut').length,
      guts: [...ctx.vfx.gutRopes.entries()].map(([id, e]) => ({
        actor: id, settled: e.chain.settled, nodes: e.chain.nodes.map(n => [...n.pos]),
      })),
      equipment: ctx.world.actors.map(a => ({
        actor: a.id, ...(a.character?.debris() ?? { casings: [], prop: null, kit: [] }),
      })),
      bundles: ctx.bake.liveBundles.map(b => ({
        pos: [...b.state.pos], vel: [...b.state.vel], floorY: b.state.floorY ?? 0,
      })),
      pickups: ctx.world.loop
        ? [...ctx.world.loop.meshes.entries()].map(([id, m]) => ({ id, pos: [m.position.x, m.position.y, m.position.z] }))
        : [],
    }),
    /** Collapse an actor where it stands (a corpse: its gun drops, its kit falls with it). */
    collapseActor: (id: number) => {
      const a = ctx.world.actors.find(q => q.id === id);
      if (!a) return false;
      a.blast({ wounds: [], meterCredit: 0, impulse: null, forceCollapse: true });
      return true;
    },
    /** A blood burst at a point (the gib burst's droplets, rngStreams.bleed). */
    bloodBurstAt: (x: number, y: number, z: number) => {
      burst(ctx.vfx.bloodSim, [x, y, z], rngStreams.bleed);
      return ctx.vfx.bloodSim.droplets.length;
    },
    /** A dynamite bundle in flight with no prop (fuse in seconds; impact detonation off). */
    throwTestBundle: (x: number, y: number, z: number, vx: number, vy: number, vz: number, fuseSec = 6) => {
      const b: LiveBundle = { state: makeFlight([x, y, z], [vx, vy, vz], { impactMode: false, fuseSec }), prop: null };
      ctx.bake.liveBundles.push(b);
      return ctx.bake.liveBundles.length;
    },
  };
}
