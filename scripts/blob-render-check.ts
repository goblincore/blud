// Is the renderer lying? One front-on frame of the lab, compared against a CPU
// march of the SAME body through the SAME camera.
//
//   npm run blob:render-check -- mouse
//   BLOB_DIST=2.0 npm run blob:render-check -- goblin
//
// WHY THIS EXISTS. docs/dev-notes/2026-08-22-painted-sdf-outfit.md records a
// day lost to a perfectly round see-through hole in the mouse's snout. The CPU
// field (`sdBody`) was solid there. The GPU showed a hole. So the `.blob` was
// edited, for hours, to fix geometry that was never wrong: the bug was in
// src/lab/sdf-zombie/webgpu/occluder-hull.ts, which sized a tapered
// primitive's far sphere from its FAT end, so the occluder hull ended short of
// the snout tip and the marcher never even ran there. This command makes
// "does the GPU agree with the field?" a single check, so the next agent stops
// editing the `.blob` the moment the renderer is the one at fault.
//
// WHAT IT ASSERTS. For every 4th pixel: march `sdBody` from the lab's own
// camera. Where the CPU field is INSIDE with three samples of margin (an
// eroded mask — silhouette edges are never compared, because a half-pixel of
// disagreement there is normal antialiasing, not a hole) but the GPU frame
// shows the empty scene, that pixel is a hole the geometry does not have.
//
// "THE EMPTY SCENE" IS NOT JUST THE BACKGROUND. The lab scene has a dark floor
// and a grey cube in it, so "this pixel is not body-coloured" proves nothing —
// but INSIDE the body mask the only things that can legitimately appear are
// body pixels, and the only things that can appear THROUGH a hole are the
// background (0x1a1116, see goo-layer.ts:497) or the floor behind the body. So
// a pixel counts as a hole only if it is within TOL per channel of the
// background colour OR of the floor colour — and the floor colour is not
// hard-coded, it is sampled empirically from this very screenshot just below
// the feet. Both colours are printed on every run so a wrong sample is visible
// rather than silent. The cube is off to the side and never lands inside the
// mask; if a future scene change puts something else behind the body, this
// check goes quiet (false negative) rather than crying wolf.
//
// TOL IS 3, WHICH IS NOT A TYPO — see the constant. Blud's cast is dark and
// the scene is darker, so at any generous tolerance the mouse's black shades,
// the zombie's shadowed flesh and the clown's painted face are all "within
// 24/255 of the background" and the check fails on healthy characters. A real
// hole IS the backdrop, to about one count per channel; nothing else is.
//
// IT ALSO TURNS OFF SILHOUETTE NOISE. `setSilhouetteNoise(0)` and
// `setShellDisplace(false)` before the shot: both deliberately push the GPU
// surface off the authored field, and on the zombie the mottle alone is enough
// to open a real gap between two thighs the CPU field still has welded. That is
// a feature, not a hole, and comparing without freezing it reported six.
//
// IT MARCHES THE POSED BODY, NOT THE .blob AT REST. The lab renders
// `applyRig(current, bound, yaw)` every frame (lab-main.ts ~2230:
// `const posed = applyRig(...); view.update(posed, current)`), and even with
// motion and wander frozen the verlet rig has settled the limbs away from the
// authored rest pose. Marching the `.blob` build would therefore report the
// pose difference as dozens of holes. So the primitives come out of the page —
// `__sdfLab.heroPosed()` — and go straight into `sdBody`, which takes a plain
// `{prims, clusters}`: same code path, same numbers, no pose gap. Those prims
// still carry `.src`/`.bone`/`.limb` through the rig, which is what lets a
// cluster name the `.blob` line that owns it.
//
// EXIT CODES. 0 the renderer agrees with the field. 1 at least one hole
// cluster is >= 12 px across (the orb hole's size — smaller specks are
// sampling noise, not a bug worth a build failure). 2 it could not run: no
// server, the lab never booted, the body has validation errors, or the
// background sample is not the background (which means the frame is not what
// this check assumes and every conclusion from it would be garbage).
//
// If this passes and you still see a hole, the hole is in your .blob. If it
// fails, STOP editing the .blob: the fix is in src/lab/sdf-zombie/webgpu/ —
// see the triage table in the authoring skill.
//
// ENVIRONMENT. `npm run blob:render-check -- <character>` needs nothing else:
// the wrapper (scripts/blob-render-check.sh) starts a vite and a headless
// WebGPU Chrome if they are not already listening and stops whatever it
// started. Set LAB_VITE_PORT / LAB_CDP_PORT to run two captures at once.
//
// Running this .ts directly is fine too, but then the servers are YOUR problem
// and it exits 2 without them. Note that `blob:shot` is not a way to provide
// them — it stops its servers when it exits, which is what the wrapper exists
// to fix.
//
// NO UNIT TEST. There isn't one and there shouldn't be a fake one: every
// assertion this makes is about a real WebGPU frame, so a test without a
// browser would only be testing the flood fill. It was verified the only way
// that means anything — by reintroducing the real bug and watching it fail.
//
// COVERAGE, stated honestly. The mask is eroded by 3 samples = 12 px, so
// anything thinner than ~28 px on screen is never compared at all: on the
// mouse at the default framing, 1040 body samples erode to 364 — the thin
// limbs and the shoes lose most of their coverage. A hole in a thin limb needs
// a closer shot
// (BLOB_DIST=1.2) to be seen. This check is a net with a known mesh size, not
// a proof of absence.
//
// WORKED EXAMPLE (recorded 2026-08-22, both runs on `mouse`, verbatim).
//
// FAILING RUN — occluder-hull.ts line 158 reverted to the bug
// (`const rB = p.radius * minScale * shrink - shellAmp;`):
//
//   shooting http://localhost:5233/sdf-lab-webgpu.html?character=mouse
//   proxy volume: [-0.50,-0.14,-0.36] .. [0.50,1.29,0.51], field centre [0.00,0.54,0.10]
//   background sample: rgb(26,17,22) (expected 26,17,22)
//   camera: fov 75 aspect 1.683 pos [0.00,0.72,2.40]
//   marched 345x205 samples (70725 rays) in 0.6s — 1040 inside, 364 after erosion
//   floor sample:      rgb(36,25,23) at px (690,600)
//   HOLE: 41 samples (656 px^2), 28 x 28 px, centre px (688,396), shows rgb(26,17,22)
//         owner: line 313 skull (head)  — blob head on skull at=0.00 r=0.085 r2=0.030 ...
//   1 cluster(s), worst 28 px across (threshold 12)
//   FAIL: the GPU shows a hole the field does not have. STOP editing the .blob ...
//
// Line 313 is the snout cone — the tapered primitive whose far end the buggy
// hull under-sized. The hole it names is the hole from the dev note, and the
// pixels it found are rgb(26,17,22): the background, exactly.
//
// PASSING RUN — occluder-hull.ts restored (`p.radiusB ?? p.radius`):
//
//   background sample: rgb(26,17,22) (expected 26,17,22)
//   camera: fov 75 aspect 1.683 pos [0.00,0.72,2.40]
//   marched 345x205 samples (70725 rays) in 0.5s — 1040 inside, 364 after erosion
//   floor sample:      rgb(36,25,23) at px (690,600)
//   0 hole cluster(s), worst 0 px across (threshold 12)
//   OK: renderer agrees with the field. If you still see a hole, it is in your .blob.
//
// zombie, clown and goblin also report 0 clusters on the restored build.
//
// A run takes ~10 s against an already-warm server (~7 s of that is waiting for
// the rig to settle; the CPU march itself is under a second). Set BLOB_RC_DUMP
// to a path to keep the frame it judged — the first thing to look at when a
// result surprises you.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { sdBody, nearestPrim } from '../src/lab/sdf-zombie/validate';
import { decodePng } from '../src/lab/sdf-zombie/png-decode';
import type { ClusterInfo, Primitive, Vec3 } from '../src/lab/sdf-zombie/types';

// Ports come from scripts/lab-servers.sh, which is what starts the servers
// these talk to; the defaults match its defaults so running the .ts directly
// against a hand-started pair still works.
const CDP = Number(process.env.LAB_CDP_PORT ?? 9223);
const VITE = Number(process.env.LAB_VITE_PORT ?? 5233);
const DIST = Number(process.env.BLOB_DIST ?? 2.4);
/** Every 4th pixel in each axis. One sample therefore covers 16 px^2. */
const STEP = 4;
/** Erosion radius, in samples, applied to the CPU-inside mask. */
const ERODE = 3;
/**
 * Per-channel tolerance when calling a pixel "background" or "floor".
 *
 * MEASURED, and much tighter than it looks like it should be. Blud's cast is
 * DARK and the scene is DARKER: the mouse's shades are authored color=101012,
 * the zombie's shadowed flesh reads rgb(30,17,17), and the clown's painted
 * face reads rgb(23,21,20) — all of them within 24/255, and even within 4/255,
 * of the background rgb(26,17,22). At any loose tolerance this check failed
 * every healthy character it was pointed at, which is worse than not existing.
 *
 * A REAL hole is not "nearly" the backdrop, it IS the backdrop, because it is
 * literally the backdrop showing through: with the occluder-hull bug
 * reintroduced, the mouse's snout hole came out rgb(27,18,21) against a
 * background of rgb(26,17,22) — ONE count per channel. The nearest false
 * positive across the four characters was 4 counts (the clown's face paint).
 * 3 is the largest number that keeps every healthy character clean, and it
 * still leaves the real hole a factor of three inside the line.
 *
 * The residual risk is the other direction: a hole whose pixels are tinted by
 * bloom or fog from the flesh around them could fall outside 3 and be missed.
 * That is the right way for this check to fail — it silently under-reports
 * instead of sending an agent to rewrite a renderer that is fine.
 */
const TOL = 3;
/** A cluster this many px across (3 samples * STEP) is the orb hole's size. */
const FAIL_PX = 12;
const BG: readonly [number, number, number] = [0x1a, 0x11, 0x16];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Print the reason and exit 2 — "did not run", never "the renderer is fine". */
function bail(msg: string): never {
  console.error(`CANNOT RUN: ${msg}`);
  process.exit(2);
}

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

// --- CDP -------------------------------------------------------------------
// Same no-deps pattern as scripts/blob-turntable.mjs: Node 22 native fetch +
// WebSocket against Chrome --remote-debugging-port.
interface Cdp {
  send(method: string, params?: unknown): Promise<any>;
  evaluate(expression: string): Promise<any>;
  consoleTail(): string[];
  close(): void;
}

async function connect(): Promise<Cdp> {
  let tab: { id: string; webSocketDebuggerUrl: string };
  try {
    tab = await (
      await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
    ).json();
  } catch {
    bail(`no Chrome on debug port ${CDP} — see ENVIRONMENT in this file's header`);
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise<void>((ok, err) => {
    ws.onopen = () => ok();
    ws.onerror = () => err(new Error('CDP websocket failed'));
  });

  let seq = 0;
  const pending = new Map<number, (m: any) => void>();
  const tail: string[] = [];
  ws.onmessage = (ev: MessageEvent) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      tail.push(m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      tail.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 300)}`);
    }
  };
  const send = (method: string, params: unknown = {}): Promise<any> =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string): Promise<any> => {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    }
    return r.result?.result?.value;
  };
  return { send, evaluate, consoleTail: () => tail.slice(-8), close: () => ws.close() };
}

// --- the frame -------------------------------------------------------------
interface Proxy { min: number[]; max: number[]; pos: number[]; scale: number[] }

interface Shot {
  png: Uint8Array;
  cam: { fov: number; aspect: number; pos: number[]; m: number[] };
  body: Body;
  proxy: Proxy;
}

async function shoot(name: string): Promise<Shot> {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // Fix the viewport BEFORE navigating — a render target sized to a stale
  // viewport produces a blank canvas that looks exactly like a broken build.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1380, height: 820, deviceScaleFactor: 1, mobile: false,
  });
  const url = `http://localhost:${VITE}/sdf-lab-webgpu.html?character=${encodeURIComponent(name)}`;
  console.log(`shooting ${url}`);
  await cdp.send('Page.navigate', { url });

  // WebGPU pipeline compilation is slow on first load — poll, don't guess.
  let booted = false;
  for (let i = 0; i < 160 && !booted; i++) {
    await sleep(500);
    booted = await cdp.evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.camera');
  }
  if (!booted) {
    console.error('console tail:', cdp.consoleTail());
    bail(`lab never booted (__sdfLab.camera absent) — is vite really on ${VITE}?`);
  }
  await sleep(1500);

  // Hide the debug panel so it cannot occlude the body, freeze the rig so the
  // frame and the field describe the same instant, and take the front-on shot.
  await cdp.evaluate(`(() => {
    for (const sel of ['#panel', '#panel-toggle', '#controls']) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
    window.__sdfLab.setMotionEnabled(false);
    window.__sdfLab.setWander(false);
    // Silhouette noise and shell displacement move the GPU surface off the
    // authored field by design (marchCfg.z / lodCfg) — millimetres of mottle
    // the CPU field knows nothing about. On the zombie, whose mottle is heavy,
    // that is enough to open a real gap between two thighs the CPU field still
    // has welded, and the check would report an intended feature as a bug.
    // Turn both off so the two fields describe the same surface.
    window.__sdfLab.setSilhouetteNoise(0);
    window.__sdfLab.setShellDisplace(false);
    window.__sdfLab.focusBody();
    return true;
  })()`);
  await sleep(4000);
  // setCam LAST and separately: the lab re-frames the camera itself while a
  // character finishes loading (focusHead runs off the load path), so a setCam
  // issued in the same breath as focusBody gets overwritten and the frame comes
  // out at some other yaw. Assert the angle after the settle, not before it.
  await cdp.evaluate(`window.__sdfLab.setCam(0, 0, ${DIST}), true`);
  await sleep(1000);

  const errors = await cdp.evaluate('JSON.stringify(window.__sdfLab.current.errors ?? [])');
  if (errors && errors !== '[]') bail(`the body has validation errors: ${errors}`);

  // The CPU march assumes prim coordinates ARE world coordinates. They are:
  // `view.object` is not a model, it is the PROXY BOX the marcher rasterises
  // (zombie-gpu.ts ~759 — a BoxGeometry moved and scaled to the body's bounds),
  // and the shader marches world space inside it. So the assertion that matters
  // is not "identity transform" but "the proxy really is around the prims" —
  // which is exactly the check that would catch the lab drawing a body this
  // script is not marching.
  const proxy = JSON.parse(await cdp.evaluate(
    '(() => { const o = window.__sdfLab.body; o.updateMatrixWorld(true); '
    + 'o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; '
    + 'return JSON.stringify({min: b.min.toArray(), max: b.max.toArray(), '
    + 'pos: o.position.toArray(), scale: o.scale.toArray()}); })()',
  )) as Proxy;

  // CAPTURE FIRST, then read the camera and the body out of the still page.
  // Reading them before the capture would describe a page that has had another
  // few frames to move (the verlet rig is still settling): the mask would be
  // compared against a frame it does not belong to, and every silhouette edge
  // would read as a hole.
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });

  const cam = JSON.parse(await cdp.evaluate(
    '(() => { const c = window.__sdfLab.camera; c.updateMatrixWorld(true); '
    + 'return JSON.stringify({fov: c.fov, aspect: c.aspect, pos: c.position.toArray(), '
    + 'm: c.matrixWorld.toArray()}); })()',
  ));

  // The POSED body — what is actually on screen. See the header.
  const posed = JSON.parse(await cdp.evaluate(
    '(() => { const b = window.__sdfLab.heroPosed(); '
    + 'return JSON.stringify({prims: b.prims, clusters: b.clusters}); })()',
  )) as Body;
  if (!posed?.prims?.length) bail('__sdfLab.heroPosed() returned no primitives');

  cdp.close();
  return { png: Buffer.from(shot.result.data, 'base64'), cam, body: posed, proxy };
}

// --- the CPU march ---------------------------------------------------------
interface March {
  gw: number; gh: number;
  inside: Uint8Array;
  owner: Int16Array;
}

/** Bounding sphere of the live additive prims, so a miss costs one dot product
 *  instead of 128 sphere-trace steps that each fold the whole body. */
function boundingSphere(body: Body): { c: Vec3; r: number } {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const p of body.prims.slice(c.start, c.start + c.count)) {
      if (p.dead || p.op === 'sub' || p.op === 'groove') continue;
      const rad = Math.max(p.radius, p.radiusB ?? p.radius)
        * Math.max(p.scale[0], p.scale[1], p.scale[2]) + (p.blendK ?? 0);
      for (const e of [p.a, p.b]) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, e[k]! - rad);
          hi[k] = Math.max(hi[k]!, e[k]! + rad);
        }
      }
    }
  }
  const c: Vec3 = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
  const r = 0.5 * Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) + 0.05;
  return { c, r };
}

function march(body: Body, cam: Shot['cam'], w: number, h: number): March {
  const gw = Math.ceil(w / STEP), gh = Math.ceil(h / STEP);
  const inside = new Uint8Array(gw * gh);
  const owner = new Int16Array(gw * gh).fill(-1);
  const m = cam.m;
  const tanH = Math.tan((cam.fov * Math.PI) / 360);
  const eye: Vec3 = [cam.pos[0]!, cam.pos[1]!, cam.pos[2]!];
  const { c: bc, r: br } = boundingSphere(body);

  for (let gy = 0; gy < gh; gy++) {
    const py = gy * STEP;
    const ndcY = 1 - ((py + 0.5) / h) * 2;
    for (let gx = 0; gx < gw; gx++) {
      const px = gx * STEP;
      const ndcX = ((px + 0.5) / w) * 2 - 1;
      const dc = [ndcX * tanH * cam.aspect, ndcY * tanH, -1];
      // three.js matrixWorld is column-major: [0..2] = x basis, [4..6] = y, [8..10] = z.
      let dx = m[0]! * dc[0]! + m[4]! * dc[1]! + m[8]! * dc[2]!;
      let dy = m[1]! * dc[0]! + m[5]! * dc[1]! + m[9]! * dc[2]!;
      let dz = m[2]! * dc[0]! + m[6]! * dc[1]! + m[10]! * dc[2]!;
      const inv = 1 / Math.hypot(dx, dy, dz);
      dx *= inv; dy *= inv; dz *= inv;

      // Skip the ray entirely unless it pierces the body's bounding sphere,
      // and start it at the entry point when it does.
      const ox = eye[0] - bc[0], oy = eye[1] - bc[1], oz = eye[2] - bc[2];
      const b2 = ox * dx + oy * dy + oz * dz;
      const cc = ox * ox + oy * oy + oz * oz - br * br;
      const disc = b2 * b2 - cc;
      if (disc < 0) continue;
      const tEnter = -b2 - Math.sqrt(disc);
      const tExit = -b2 + Math.sqrt(disc);
      if (tExit < 0) continue;

      let t = Math.max(tEnter, 0);
      for (let s = 0; s < 128 && t < 6; s++) {
        const p: Vec3 = [eye[0] + dx * t, eye[1] + dy * t, eye[2] + dz * t];
        const d = sdBody(p, body);
        if (d < 0.002) {
          const i = gy * gw + gx;
          inside[i] = 1;
          owner[i] = nearestPrim(p, body);
          break;
        }
        t += Math.max(d, 0.002);
        if (t > tExit) break;
      }
    }
  }
  return { gw, gh, inside, owner };
}

/** Shrink the mask by ERODE samples (4-neighbour, ERODE passes) so only pixels
 *  with real margin are compared — the silhouette edge is antialiased against
 *  the background and would otherwise read as a rim of holes. */
function erode(mask: Uint8Array, gw: number, gh: number): Uint8Array {
  let cur = mask;
  for (let pass = 0; pass < ERODE; pass++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (!cur[i]) continue;
        if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) continue;
        if (cur[i - 1] && cur[i + 1] && cur[i - gw] && cur[i + gw]) next[i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

// --- main ------------------------------------------------------------------
async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) bail('usage: npm run blob:render-check -- <character>');
  const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
  const blobLines = existsSync(blobPath) ? readFileSync(blobPath, 'utf8').split('\n') : [];

  const { png, cam, body, proxy } = await shoot(name);

  // Does the marched volume actually surround the primitives we are about to
  // march? If not, the page is drawing something this script is not.
  const bs = boundingSphere(body);
  const lo = proxy.min.map((v, i) => v * proxy.scale[i]! + proxy.pos[i]!);
  const hi = proxy.max.map((v, i) => v * proxy.scale[i]! + proxy.pos[i]!);
  console.log(`proxy volume: [${lo.map((v) => v.toFixed(2))}] .. [${hi.map((v) => v.toFixed(2))}], `
    + `field centre [${bs.c.map((v) => v.toFixed(2))}]`);
  if (bs.c.some((v, i) => v < lo[i]! - 1e-3 || v > hi[i]! + 1e-3)) {
    bail('the primitives this script marched are not inside the volume the lab '
      + 'rasterises — the page is drawing a different body. Teach this script about it.');
  }
  const img = decodePng(png);
  if (process.env.BLOB_RC_DUMP) {
    writeFileSync(process.env.BLOB_RC_DUMP, png);
    console.log(`frame written to ${process.env.BLOB_RC_DUMP}`);
  }
  const { width: W, height: H, rgba } = img;
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * W + x) * 4;
    return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
  };
  const patch = (x0: number, y0: number): [number, number, number] => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < Math.min(y0 + 10, H); y++) {
      for (let x = x0; x < Math.min(x0 + 10, W); x++) {
        const [pr, pg, pb] = at(x, y);
        r += pr; g += pg; b += pb; n++;
      }
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };

  const bg = patch(0, 0);
  console.log(`background sample: rgb(${bg}) (expected ${BG})`);
  if (bg.some((v, i) => Math.abs(v - BG[i]!) > TOL)) {
    bail(`the top-left of the frame is rgb(${bg}), not the scene background rgb(${BG}). `
      + 'Something is drawn over the frame (a panel? a different page?) and every '
      + 'conclusion from this comparison would be garbage.');
  }

  console.log(`camera: fov ${cam.fov} aspect ${cam.aspect.toFixed(3)} `
    + `pos [${cam.pos.map((v: number) => v.toFixed(2)).join(',')}]`);
  const t0 = Date.now();
  const { gw, gh, inside, owner } = march(body, cam, W, H);
  const eroded = erode(inside, gw, gh);
  const nIn = inside.reduce((a, v) => a + v, 0);
  const nEr = eroded.reduce((a, v) => a + v, 0);
  console.log(`marched ${gw}x${gh} samples (${gw * gh} rays) in `
    + `${((Date.now() - t0) / 1000).toFixed(1)}s — ${nIn} inside, ${nEr} after erosion`);
  if (nEr === 0) {
    bail('the CPU march found no body at all in this frame — the camera or the '
      + 'posed body is not what this script assumes.');
  }

  // Floor colour, sampled from THIS frame just below the feet: take the body
  // mask's own bottom edge at its centroid column and step 20 px further down.
  let sx = 0, sy = 0, lowest = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!inside[y * gw + x]) continue;
      sx += x; sy += y; lowest = Math.max(lowest, y);
    }
  }
  const cx = Math.round((sx / nIn) * STEP);
  const fy = Math.min(lowest * STEP + 20, H - 10);
  const floor = patch(Math.max(0, Math.min(cx - 5, W - 10)), fy);
  console.log(`floor sample:      rgb(${floor}) at px (${cx},${fy})`);

  const near = (c: [number, number, number], ref: readonly [number, number, number]) =>
    Math.abs(c[0] - ref[0]!) <= TOL && Math.abs(c[1] - ref[1]!) <= TOL
    && Math.abs(c[2] - ref[2]!) <= TOL;

  const hole = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx;
      if (!eroded[i]) continue;
      const c = at(Math.min(gx * STEP, W - 1), Math.min(gy * STEP, H - 1));
      if (near(c, BG) || near(c, floor)) hole[i] = 1;
    }
  }

  // Flood fill (4-neighbour) into clusters.
  const seen = new Uint8Array(gw * gh);
  interface Cl { n: number; x0: number; x1: number; y0: number; y1: number; owners: Map<number, number>;
    r: number; g: number; b: number }
  const clusters: Cl[] = [];
  for (let start = 0; start < hole.length; start++) {
    if (!hole[start] || seen[start]) continue;
    const cl: Cl = {
      n: 0, x0: gw, x1: 0, y0: gh, y1: 0, owners: new Map(), r: 0, g: 0, b: 0,
    };
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % gw, y = (i - x) / gw;
      cl.n++;
      cl.x0 = Math.min(cl.x0, x); cl.x1 = Math.max(cl.x1, x);
      cl.y0 = Math.min(cl.y0, y); cl.y1 = Math.max(cl.y1, y);
      const c = at(Math.min(x * STEP, W - 1), Math.min(y * STEP, H - 1));
      cl.r += c[0]; cl.g += c[1]; cl.b += c[2];
      const o = owner[i]!;
      if (o >= 0) cl.owners.set(o, (cl.owners.get(o) ?? 0) + 1);
      for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1,
        y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1]) {
        if (j >= 0 && hole[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    clusters.push(cl);
  }

  clusters.sort((a, b) => b.n - a.n);
  let worst = 0;
  for (const cl of clusters) {
    const wSamples = cl.x1 - cl.x0 + 1, hSamples = cl.y1 - cl.y0 + 1;
    const across = Math.max(wSamples, hSamples) * STEP;
    if (wSamples < 2 && hSamples < 2) continue; // a single stray sample is noise
    worst = Math.max(worst, across);
    const dom = [...cl.owners.entries()].sort((a, b) => b[1] - a[1])[0];
    const prim = dom ? body.prims[dom[0]] : undefined;
    const line = prim?.src;
    const text = line != null ? (blobLines[line - 1] ?? '').trim() : '';
    console.log(`HOLE: ${cl.n} samples (${cl.n * STEP * STEP} px^2), `
      + `${wSamples * STEP} x ${hSamples * STEP} px, centre px `
      + `(${Math.round(((cl.x0 + cl.x1) / 2) * STEP)},${Math.round(((cl.y0 + cl.y1) / 2) * STEP)})`
      + `, shows rgb(${Math.round(cl.r / cl.n)},${Math.round(cl.g / cl.n)},${Math.round(cl.b / cl.n)})`);
    console.log(`      owner: ${line != null ? `line ${line}` : 'line ?'} `
      + `${prim?.bone ?? '?'} (${prim?.limb ?? '?'})${text ? `  — ${text}` : ''}`);
    if (line == null) {
      console.log('      (a compiled face primitive — it has no .blob line of its own)');
    }
  }

  if (worst >= FAIL_PX) {
    console.log(`${clusters.length} cluster(s), worst ${worst} px across (threshold ${FAIL_PX})`);
    console.error('FAIL: the GPU shows a hole the field does not have. STOP editing the '
      + '.blob — the fix is in src/lab/sdf-zombie/webgpu/ (see the triage table in the '
      + 'authoring skill).');
    process.exit(1);
  }
  console.log(`${clusters.length} hole cluster(s), worst ${worst} px across `
    + `(threshold ${FAIL_PX})`);
  console.log('OK: renderer agrees with the field. If you still see a hole, it is in your .blob.');
  process.exit(0);
}

main().catch((err) => {
  bail(err instanceof Error ? err.message : String(err));
});
