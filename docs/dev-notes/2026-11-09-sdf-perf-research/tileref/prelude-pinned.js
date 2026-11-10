__sdfGame.setHullExitBound(true);
(() => { const z = __sdfGame.zombies().find((q) => q.room === 1); const d = 0.6, eyeH = 1.62, aimY = 1.0; const ex = z.pos[0], ez = z.pos[2] + d; const dx = z.pos[0] - ex, dz = z.pos[2] - ez; __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(aimY - eyeH, Math.hypot(dx, dz)), 0); })();
__sdfGame.step(4);
window.__A = [[0, 0, 'slug'], [0.14, 0.06, 'slug'], [0.07, -0.08, 'pellet'], [-0.07, 0.1, 'pellet'], [-0.16, -0.04, 'pellet']];
window.__B = [[-0.22, -0.15], [-0.1, -0.16], [0.02, -0.18], [0.18, -0.14], [-0.2, 0.0], [-0.11, 0.02], [0.09, 0.01], [0.21, 0.03], [-0.18, 0.16], [-0.04, 0.18], [0.1, 0.17], [0.2, 0.14], [0.03, 0.09], [-0.13, -0.07], [0.15, -0.06]].map(([a, b]) => [a, b, 'pellet']);
window.__ladderStamp = (list, min) => {
  const b = __sdfGame.pose();
  let n = 0, id = -1;
  for (const [dy, dp, kind] of list) {
    __sdfGame.setPose(b.pos[0], b.pos[2], b.yaw + dy, b.pitch + dp, 0);
    const p = __sdfGame.predictSlugHit();
    if (p.actorId < 0 || !p.hit) continue;
    if (__sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2], p.dir[0], p.dir[1], p.dir[2], kind, p.actorId)) { n++; id = p.actorId; }
  }
  __sdfGame.setPose(b.pos[0], b.pos[2], b.yaw, b.pitch, 0);
  __sdfGame.step(5);
  const wounds = id >= 0 ? __sdfGame.zombie(id).woundList().length : 0;
  if (n < min || __sdfGame.chunkCount !== 0) throw new Error('ladder stamp: ' + n + ' stamped, ' + wounds + ' wounds, ' + __sdfGame.chunkCount + ' chunks');
  window.__ladderWounds = wounds;
  return wounds;
};
window.__ladderChop = (side, target) => {
  const z = __sdfGame.zombies().find((q) => q.room === 1);
  const r = __sdfGame.axeChop(z.id, side, target);
  if (!r) throw new Error('ladder chop: axeChop(' + side + ', ' + target + ') returned ' + r);
  __sdfGame.freeze(false);
  for (let i = 0; i < 14; i++) __sdfGame.step(1, 1 / 60);
  __sdfGame.freeze(true);
  for (let i = 0; i < 70; i++) __sdfGame.step(1, 1 / 60);
  window.__ladderLast = { chop: r, wounds: (__sdfGame.actorWounds(z.id) || []).length, split: __sdfGame.headSplit(z.id) };
  return r;
};
window.__ladderNeedSplit = () => { const z = __sdfGame.zombies().find((q) => q.room === 1); if (!__sdfGame.headSplit(z.id)) throw new Error('ladder: the head did not split'); return 1; };
1
