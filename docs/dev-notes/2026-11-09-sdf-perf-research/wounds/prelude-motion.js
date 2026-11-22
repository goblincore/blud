// SPIKE_PRELUDE for the one-call prototype: frames captured IN MOTION, so the pass's history texture (last frame's
// depth) is one camera move behind the frame being drawn. __ladderMotion(strafe metres a frame, yaw radians a frame)
// moves the camera before every hand-step; __ladderHome() puts it back on the staged pose.
__sdfGame.setHullExitBound(true); __sdfGame.step(2);
window.__ladderHomePose = __sdfGame.pose();
window.__ladderStep0 = __sdfGame.step;
window.__ladderHome = () => { const h = window.__ladderHomePose; __sdfGame.setPose(h.pos[0], h.pos[2], h.yaw, h.pitch, 0); return 1; };
window.__ladderMotion = (strafe, dyaw) => {
  const s0 = window.__ladderStep0;
  __sdfGame.step = function (n = 1, dt) {
    for (let i = 0; i < n; i++) {
      if (strafe || dyaw) {
        const p = __sdfGame.pose();
        __sdfGame.setPose(p.pos[0] + Math.cos(p.yaw) * strafe, p.pos[2] + Math.sin(p.yaw) * strafe, p.yaw + dyaw, p.pitch, 0);
      }
      if (dt === undefined) s0.call(__sdfGame, 1); else s0.call(__sdfGame, 1, dt);
    }
  };
  if (__sdfGame.step === s0) throw new Error('ladder motion: __sdfGame.step is not assignable');
  return 1;
};
1
