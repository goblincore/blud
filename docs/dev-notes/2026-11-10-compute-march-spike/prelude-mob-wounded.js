(() => {
  const b = __sdfGame.rooms.find((x) => x.id === 1).bounds;
  const cx = (b.minX + b.maxX) / 2, pz = b.minZ + 0.6;
  __sdfGame.teleport(1);
  __sdfGame.placePlayer({ x: cx, z: pz, yaw: Math.PI, pitch: -0.12 });
  __sdfGame.freeze(true);
  const region = { minX: cx - 1.7, maxX: cx + 1.7, minZ: pz + 0.9, maxZ: pz + 3.4 };
  window.__mob = __sdfGame.spawnCrowd('zombie', 22, { spacing: 0.6, region });
  if (window.__mob.ok < 22) throw new Error('mob: only ' + window.__mob.ok + ' bodies landed');
})();
__sdfGame.setHullExitBound(true);
__sdfGame.step(4);
// Wound the mob: a grid of shots from the eye across the view, each stamped on the nearest body it hits.
(() => {
  __sdfGame.setWoundTuning({ spillChance: 0 });
  const m = __sdfGameDebug.normalCaptureState().camera;
  const eye = [m[12], m[13], m[14]];
  const bodies = __sdfGame.zombies().map((z) => ({ id: z.id, d: Math.hypot(z.pos[0] - eye[0], z.pos[2] - eye[2]) })).sort((a, b) => a.d - b.d);
  let n = 0;
  const ids = new Set();
  for (let ia = -4; ia <= 4; ia++) for (let ib = -2; ib <= 2; ib++) {
    let d = [0, 1, 2].map((i) => -m[8 + i] + ia * 0.13 * m[i] + ib * 0.11 * m[4 + i]);
    const L = Math.hypot(d[0], d[1], d[2]);
    d = d.map((v) => v / L);
    for (const z of bodies) {
      if (!__sdfGame.stampWoundAt(eye[0], eye[1], eye[2], d[0], d[1], d[2], (ia + ib) % 2 ? 'pellet' : 'slug', z.id)) continue;
      n++; ids.add(z.id);
      break;
    }
  }
  __sdfGame.step(30);
  if (n < 12 || ids.size < 5) throw new Error('mob wounds: ' + n + ' stamped on ' + ids.size + ' bodies');
  window.__mobWounds = { stamped: n, bodies: ids.size, chunks: __sdfGame.chunkCount };
  console.log('mob wounds', JSON.stringify(window.__mobWounds));
})();
