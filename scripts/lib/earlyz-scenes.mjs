// scripts/lib/earlyz-scenes.mjs — staging shared by earlyz-smoke, earlyz-parity and the bench's
// BENCH_SCENE=doorway (plan 2026-10-01). Each prelude is an in-page JS string; evaluate() runs it.
// A prelude THROWS in-page when its scene did not come out as described (wrong room, short
// spawn), so evaluate() rejects instead of a caller measuring some other scene.
import { stageCloseUp } from './sdf-closeup-stage.mjs';

/** Player in room 1, 2.5 m back from the mouth of the first tunnel that touches room 1,
 *  1.2 m off its centre line, looking at the mouth; `n` zombies in the far room. Part of
 *  the far room is behind the wall beside the opening: that is the level-occlusion case.
 *  The mouth is the point where the tunnel's centre line crosses room 1's wall plane.
 *  spawnCrowd files bodies under the PLAYER's room, so the far-room crowd is crowd type
 *  `zombie@1`, not `zombie@<farId>`. */
export function doorwayPrelude(n, spacing = 0.9) {
  return `(() => {
    const t = __sdfGame.tunnelDefs.find(x => x.a === 1 || x.b === 1);
    if (!t) throw new Error('doorway: no tunnel touches room 1');
    const farId = t.a === 1 ? t.b : t.a;
    const room1 = __sdfGame.rooms.find(x => x.id === 1);
    const roomF = __sdfGame.rooms.find(x => x.id === farId);
    if (!room1 || !roomF) throw new Error('doorway: room 1 or room ' + farId + ' missing');
    const r1 = room1.bounds, rf = roomF.bounds;
    const c1 = [(r1.minX + r1.maxX) / 2, (r1.minZ + r1.maxZ) / 2];
    const cf = [(rf.minX + rf.maxX) / 2, (rf.minZ + rf.maxZ) / 2];
    const tc = [(t.minX + t.maxX) / 2, (t.minZ + t.maxZ) / 2];
    let px, pz, mx, mz;
    if (t.axis === 'x') { const s = Math.sign(cf[0] - c1[0]); mx = s > 0 ? r1.maxX : r1.minX; mz = tc[1]; px = mx - s * 2.5; pz = mz + 1.2; }
    else { const s = Math.sign(cf[1] - c1[1]); mz = s > 0 ? r1.maxZ : r1.minZ; mx = tc[0]; pz = mz - s * 2.5; px = mx + 1.2; }
    const yaw = Math.atan2(mx - px, -(mz - pz));
    __sdfGame.teleport(1);
    const key = __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    if (key !== room1.name) throw new Error('doorway: player landed in ' + key + ', not ' + room1.name);
    __sdfGame.freeze(true);
    const region = { minX: rf.minX + 0.5, maxX: rf.maxX - 0.5, minZ: rf.minZ + 0.5, maxZ: rf.maxZ - 0.5 };
    const r = __sdfGame.spawnCrowd('zombie', ${n}, { spacing: ${spacing}, region });
    if (r.ok !== ${n}) throw new Error('doorway: spawned ' + r.ok + ' of ${n}');
    return { tunnel: t.name, farId, player: [px, pz], mouth: [mx, mz], spawned: r.ok };
  })()`;
}

/** Room-1 near corner looking down the diagonal (the bench's distance scene).
 *  RING TESTBED ONLY: the corner and the regions assume the ring's 8 x 8 m room 1, so the
 *  prelude refuses any other level. */
export function cornerPrelude(n, region) {
  return `(() => {
    const lv = __sdfGame.level().id;
    if (lv !== 'ring') throw new Error('corner scenes are ring-testbed only; level is ' + lv);
    const b = __sdfGame.rooms.find(x => x.id === 1).bounds;
    const px = b.minX + 0.6, pz = b.minZ + 0.6;
    const yaw = Math.atan2(b.maxX - px, -(b.maxZ - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const R = ${region};
    const r = __sdfGame.spawnCrowd('zombie', ${n}, { spacing: 0.7, region: R(b) });
    if (r.ok !== ${n}) throw new Error('corner: spawned ' + r.ok + ' of ${n}');
    return { spawned: r.ok };
  })()`;
}

/** Run a prelude and bring its result back as plain data whatever evaluate()'s return mode is. */
const json = async (ev, prelude) => JSON.parse(await ev(`JSON.stringify(${prelude})`));

/** The default `fail` for a stage: throw, never exit, so the caller keeps its own failure path. */
const throwFail = (msg) => { throw new Error(msg); };

/** Every stage is `stage(evaluate)` and resolves to its staging record. The prelude stages fail by
 *  throwing in-page, so evaluate() rejects. Only `melee` also takes `fail` (stageCloseUp reports
 *  through it); its default throws, never exits. */
export const STAGES = {
  /** 6 bodies packed 0.7 m apart, ~3 m ahead: body-behind-body. Ring testbed only. */
  pack: { query: '', stage: (ev) => json(ev, cornerPrelude(6, '(b) => ({ minX: b.minX + 2.2, maxX: b.minX + 3.6, minZ: b.minZ + 2.2, maxZ: b.minZ + 3.6 })')) },
  /** 16 bodies in the far half: the distance crowd. Ring testbed only. */
  far: { query: '', stage: (ev) => json(ev, cornerPrelude(16, '(b) => ({ minX: (b.minX + b.maxX) / 2, maxX: b.maxX - 0.5, minZ: b.minZ + 0.5, maxZ: b.maxZ - 0.5 })')) },
  /** Ring testbed doorway: body-behind-wall. */
  doorway: { query: '', stage: (ev) => json(ev, doorwayPrelude(12)) },
  /** Night Train guards-van -> third-class door. */
  'train-doorway': { query: 'level=night-train', stage: (ev) => json(ev, doorwayPrelude(12)) },
  /** Melee range: the camera 0.4 m from room 1's first body, inside its proxy box (the
   *  camera-inside back batch). Resolves to stageCloseUp's { d, cov, body }. Unrelated to
   *  scripts/lib/sdf-melee-stage.mjs (that is the eight-body melee perf scene). */
  melee: { query: '', stage: (ev, fail = throwFail) => stageCloseUp(ev, { room: 1, ladder: [0.4], settleTries: 2400 }, fail) },
};
