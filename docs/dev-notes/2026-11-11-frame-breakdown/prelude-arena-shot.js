// The arena's one enemy (boot with level=arena&spawn=<character>), seen from 1.7 m, with a wide spread of pellets
// across its upper body: ?shots=<n> (default 24), seeded. For looking at how a few scattered wounds read on a body.
(() => {
  const z = __sdfGame.zombies()[0];
  if (!z) throw new Error('arena-shot: no enemy');
  __sdfGame.placePlayer({ x: z.pos[0], z: z.pos[2] + 1.7, yaw: 0, pitch: 0.05 });
  __sdfGame.freeze(true);
  __sdfGame.step(4);
  __sdfGame.setWoundTuning({ spillChance: 0 });
  const m = __sdfGameDebug.normalCaptureState().camera;
  const eye = [m[12], m[13], m[14]];
  const n = Number(new URLSearchParams(location.search).get('shots') ?? 24);
  let seed = 4242, landed = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < n; k++) {
    const t = [z.pos[0] + (rnd() - 0.5) * 0.7, z.pos[1] + 0.9 + rnd() * 0.9, z.pos[2]];
    let d = [t[0] - eye[0], t[1] - eye[1], t[2] - eye[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    d = d.map((v) => v / L);
    if (__sdfGame.stampWoundAt(eye[0], eye[1], eye[2], d[0], d[1], d[2], 'pellet', z.id)) landed++;
    if (k % 8 === 7) __sdfGame.step(1);
  }
  __sdfGame.step(30);
  window.__arenaShot = { landed, listed: __sdfGame.actorWounds(z.id).length };
  console.log('arena-shot', JSON.stringify(window.__arenaShot));
})();
