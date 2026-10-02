// scripts/lib/earlyz-scenes.mjs — staging shared by earlyz-smoke, earlyz-parity and the bench's
// BENCH_SCENE=doorway (plan 2026-10-01). Each prelude is an in-page JS string; evaluate() runs it.
import { stageCloseUp } from './sdf-closeup-stage.mjs';

/** Player in room 1, 2.5 m back from the mouth of the first tunnel that touches room 1,
 *  1.2 m off its centre line, looking at the mouth; `n` zombies in the far room. Part of
 *  the far room is behind the wall beside the opening: that is the level-occlusion case. */
export function doorwayPrelude(n, spacing = 0.9) {
  return `(() => {
    const t = __sdfGame.tunnelDefs.find(x => x.a === 1 || x.b === 1);
    if (!t) throw new Error('doorway: no tunnel touches room 1');
    const farId = t.a === 1 ? t.b : t.a;
    const r1 = __sdfGame.rooms.find(x => x.id === 1).bounds;
    const rf = __sdfGame.rooms.find(x => x.id === farId).bounds;
    const c1 = [(r1.minX + r1.maxX) / 2, (r1.minZ + r1.maxZ) / 2];
    const cf = [(rf.minX + rf.maxX) / 2, (rf.minZ + rf.maxZ) / 2];
    const tc = [(t.minX + t.maxX) / 2, (t.minZ + t.maxZ) / 2];
    let px, pz;
    if (t.axis === 'x') { const s = Math.sign(cf[0] - c1[0]); px = (s > 0 ? r1.maxX : r1.minX) - s * 2.5; pz = tc[1] + 1.2; }
    else { const s = Math.sign(cf[1] - c1[1]); pz = (s > 0 ? r1.maxZ : r1.minZ) - s * 2.5; px = tc[0] + 1.2; }
    const yaw = Math.atan2(tc[0] - px, -(tc[1] - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const region = { minX: rf.minX + 0.5, maxX: rf.maxX - 0.5, minZ: rf.minZ + 0.5, maxZ: rf.maxZ - 0.5 };
    const r = __sdfGame.spawnCrowd('zombie', ${n}, { spacing: ${spacing}, region });
    return { tunnel: t.name, farId, player: [px, pz], spawned: r.ok };
  })()`;
}

/** Room-1 near corner looking down the diagonal (the bench's distance scene). */
export function cornerPrelude(n, region) {
  return `(() => {
    const b = __sdfGame.rooms.find(x => x.id === 1).bounds;
    const px = b.minX + 0.6, pz = b.minZ + 0.6;
    const yaw = Math.atan2(b.maxX - px, -(b.maxZ - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const R = ${region};
    const r = __sdfGame.spawnCrowd('zombie', ${n}, { spacing: 0.7, region: R(b) });
    return { spawned: r.ok };
  })()`;
}

/** Run a prelude and bring its result back as plain data whatever evaluate()'s return mode is. */
const json = async (ev, prelude) => JSON.parse(await ev(`JSON.stringify(${prelude})`));

export const STAGES = {
  /** 6 bodies packed 0.7 m apart, ~3 m ahead: body-behind-body. */
  pack: { query: '', stage: (ev) => json(ev, cornerPrelude(6, '(b) => ({ minX: b.minX + 2.2, maxX: b.minX + 3.6, minZ: b.minZ + 2.2, maxZ: b.minZ + 3.6 })')) },
  /** 16 bodies in the far half: the distance crowd. */
  far: { query: '', stage: (ev) => json(ev, cornerPrelude(16, '(b) => ({ minX: (b.minX + b.maxX) / 2, maxX: b.maxX - 0.5, minZ: b.minZ + 0.5, maxZ: b.maxZ - 0.5 })')) },
  /** Ring testbed doorway: body-behind-wall. */
  doorway: { query: '', stage: (ev) => json(ev, doorwayPrelude(12)) },
  /** Night Train guards-van -> third-class door. */
  'train-doorway': { query: 'level=night-train', stage: (ev) => json(ev, doorwayPrelude(12)) },
  /** Melee range: the camera inside the proxy box (back batch). */
  melee: { query: '', stage: (ev) => stageCloseUp(ev, { room: 1, ladder: [0.4], settleTries: 2400 }) },
};
