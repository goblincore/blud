// The mob of prelude-mob.js (22 zombies in a block from 0.9 m), with the SIX NEAREST bodies each shot 70 times from
// the eye: more wounds than the list holds (32), so with ?woundvol the overflow is baked into boxes and without it
// the overflow merges. Seeded, so every page load stages the same shots.
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
(() => {
  __sdfGame.setWoundTuning({ spillChance: 0 });
  const m = __sdfGameDebug.normalCaptureState().camera;
  const eye = [m[12], m[13], m[14]];
  const bodies = __sdfGame.zombies().map((z) => ({ id: z.id, pos: z.pos, d: Math.hypot(z.pos[0] - eye[0], z.pos[2] - eye[2]) }))
    .sort((a, b) => a.d - b.d).slice(0, 6);
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const landed = [];
  for (const z of bodies) {
    let n = 0;
    for (let k = 0; k < 70; k++) {
      const t = [z.pos[0] + (rnd() - 0.5) * 0.34, 0.7 + rnd() * 0.8, z.pos[2]];
      let d = [t[0] - eye[0], t[1] - eye[1], t[2] - eye[2]];
      const L = Math.hypot(d[0], d[1], d[2]);
      d = d.map((v) => v / L);
      if (__sdfGame.stampWoundAt(eye[0], eye[1], eye[2], d[0], d[1], d[2], 'pellet', z.id)) n++;
      // A blast's worth at a time, as the game would deliver them.
      if (k % 10 === 9) __sdfGame.step(1);
    }
    landed.push(n);
  }
  __sdfGame.step(30);
  if (Math.min(...landed) < 40) throw new Error('mob-heavy: too few shots landed: ' + landed.join(','));
  window.__mobWounds = { landed, listed: bodies.map((z) => __sdfGame.actorWounds(z.id).length) };
  console.log('mob-heavy wounds', JSON.stringify(window.__mobWounds));
})();
// ?tryscale=<s>: the march at that scale of the canvas (0.5 is shipped). With the neural upscaler on, any scale
// but 0.5 switches it off (upscale-scale-guard.ts), so the layer's own plain enlargement shows the march.
(() => {
  const s = new URLSearchParams(location.search).get('tryscale');
  if (!s) return;
  __sdfGame.setSdfScale(Number(s));
  // With the upscaler off the page falls back to its interlaced field style (half the rows a frame). Off, unless
  // ?tryfields=1 asks for it: the scale is the only thing this prelude means to change.
  if (new URLSearchParams(location.search).get('tryfields') !== '1') __sdfGame.setFieldStyle('off');
  __sdfGame.step(6);
  console.log('tryscale', s, JSON.stringify(__sdfGame.upscaleInfo()));
})();
// ?tryao=0 and ?tryscatter=0: the AO probe (lodCfg.x) and the scatter probe (surfCfg.w) off on every body, to size
// them. Each is one whole field call a hit pixel.
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get('tryao') === '0') __sdfGame.setUniformAll('lodCfg', 0, 0);
  if (q.get('tryscatter') === '0') __sdfGame.setUniformAll('surfCfg', 3, 0);
  // ?tryng=0: the analytic normal off on every body (every hit pixel takes the four taps).
  if (q.get('tryng') === '0') __sdfGame.setUniformAll('normalGradientCfg', 0, 0);
  __sdfGame.step(4);
})();

