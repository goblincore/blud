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
