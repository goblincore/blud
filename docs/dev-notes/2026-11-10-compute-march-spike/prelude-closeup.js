__sdfGame.setHullExitBound(true);
(() => { const z = __sdfGame.zombies().find((q) => q.room === 1); const d = 0.6, eyeH = 1.62, aimY = 1.0; const ex = z.pos[0], ez = z.pos[2] + d; const dx = z.pos[0] - ex, dz = z.pos[2] - ez; __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(aimY - eyeH, Math.hypot(dx, dz)), 0); })();
__sdfGame.step(4);
