// FLAME CAPTURE (2026-09-17): the flame lab's fixed pose set, shot at two
// burn stages, so surface-fire techniques can be judged side by side and this
// plan's surface look becomes the baseline the three tongue plans compare
// against (docs/superpowers/plans/2026-09-17-flame-lab-foundation.md, task 14).
//
//   6 poses x 2 stages = 12 PNGs + contact.png -> docs/dev-notes/2026-09-17-flame-lab/
//   close-fresh.png   burn=1 char=0   (single body fills most of the frame)
//   stand-fresh.png   burn=1 char=0   (engulfed, unburnt skin)
//   stand-charred.png burn=1 char=0.6 (engulfed, mostly charred)
//   contact.png       close-fresh + stand-fresh + stand-charred in a row,
//                     then the three Blood reference tiles (3321/3323/3325)
//                     scaled to the stand frames' body height, so the judge
//                     is one image rather than a folder.
//
// POSES are driven through the PAGE'S OWN INPUT, not a console backdoor:
// CDP key events for ',' (walk) / '.' (run) / 'k' (collapse), real mouse
// press to stop the orbit spin, real wheel events for the distant framing.
// The page's keydown handlers are the contract a player uses; if they move,
// this script should break with them.
//
// HOLDING A STAGE: __flameLab.capture(burn, char) forceBurns both bodies, but
// the render loop's stepBurn keeps integrating afterwards — while alight,
// char grows at charRate (0.22/s), so a screenshot taken 2 s after the pin
// shows char 0.44, not 0. The same trap melt-capture documented for
// meltDirect (stepMelt kept advancing under it). So each pin is followed by
// __flameLab.setTuning({ charRate: 0 }) — charRate is TS-side only (the
// shader never sees it), so the VISUAL mapping of the pinned char value is
// untouched and only the creep stops. burn stays pinned at 1 on its own
// (clamp), and burnSec growing is fine — that is the noise phase, and live
// fire is supposed to move.
//
// SERVERS: same lifecycle as scripts/lab-servers.sh (which goo/melt source
// from their shell wrappers) — re-implemented here because the npm script is
// plain `node scripts/flame-capture.mjs`, with no wrapper to source it from.
// Same ports (LAB_VITE_PORT / LAB_CDP_PORT), same reuse rule (a listening
// server is left alone; a reused Chrome must prove it has WebGPU), same
// Chrome flags including the TMPDIR + crash-dumps redirect that sandboxes
// need (see lab-servers.sh's two-paths note). Only what WE started is
// stopped, and only our own Chrome profile is removed.
//
// Usage:
//   node scripts/flame-capture.mjs [outDir]
//   node scripts/flame-capture.mjs --technique screen [outDir]
//   node scripts/flame-capture.mjs --technique cards --flow 0.35 --burst 3 \
//     --poses close [outDir]      # flame-polish task 2 flow sweep
//   node scripts/flame-capture.mjs --technique cards --frozen --poses stand,close \
//     [outDir]                    # flame-polish task 3: pixel-comparable A/B
//   LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 node scripts/flame-capture.mjs
// --technique (flame-tongues task 2) pins the lab's tongue technique for the
// whole run: it rides the ?tongue= boot param AND __flameLab.setTechnique, so
// the run exercises both routes and captures.json records which one ran. The
// default is 'none' — the molten SURFACE baseline — so a bare run still
// reproduces the foundation captures (the page's own boot default is
// 'screen', so without the pin a bare run would silently capture tongues and
// overwrite the baseline the tongue plans compare against). Filenames do NOT
// carry the technique — shoot each technique into its own outDir.
// --flow <0..1> pins BurnTuning.flameFlow at boot (?flow=) and via setTuning,
// and --burst N shoots N frames BURST_GAP apart per stage (b1..bN) so the
// animated flow can be judged from stills. --flow-sweep a,b,c changes the flow
// LIVE within one page load and captures each value at the SAME camera and pose
// (the only judgeable A/B here, since the orbit yaw drifts between loads) —
// filenames get an -f<value> tag. --clock <sec> freezes the visual clock so a
// sweep's values share one animation instant. --poses limits the pose set; a
// subset that omits the contact-sheet frames skips the sheet instead of
// failing. Shoot a single --flow value into its own outDir.
// --skeleton-depth <0..0.15> / --skeleton-sweep a,b,c pin and sweep
// BurnTuning.skeletonDepth through setTuning; sweep values get a -d<value> tag
// and are shot at one camera, which is how the bone-reveal A/B is judged
// (flame-polish task 4). --skeleton-show <0..1> pins the strength for the run
// (-s<value> tag) so the reveal ceiling can be judged beyond its 0.7 default.
// Exits 0 on success, 2 if it could not run (boot failure, page exception,
// no WebGPU backend, a flat capture).
import { mkdirSync, writeFileSync, openSync, rmSync, readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync, deflateSync } from 'node:zlib';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(2); };

// The fixed pose set, and the stage names a stage's char value pins. Declared
// before arg parsing so --poses can validate against it.
const POSES = ['close', 'stand', 'walk', 'run', 'collapsed', 'distant', 'death'];
const STAGES = [
  { name: 'fresh', char: 0 },
  { name: 'charred', char: 0.6 },
];

// --- technique switch (flame-tongues plan task 3) ---------------------------
// `--technique <none|screen|cards|volume>` boots the page with &tongue=<name>
// and prefixes every written PNG (and the contact sheet) with the technique,
// so a per-technique run never overwrites the molten baseline. No flag = the
// baseline run, byte-identical behaviour and names.
const TONGUE_TECHNIQUES = ['none', 'screen', 'cards', 'volume'];
const argv = [...process.argv];
let technique = null;
{
  const i = argv.indexOf('--technique');
  if (i !== -1) {
    const v = argv[i + 1];
    if (v === undefined || !TONGUE_TECHNIQUES.includes(v)) {
      fail(`--technique needs one of ${TONGUE_TECHNIQUES.join('|')}`);
    }
    technique = v;
    argv.splice(i, 2);
  }
}

// --- flame-flow sweep switch (flame-polish plan task 2) ---------------------
// `--flow <0..1>` pins BurnTuning.flameFlow for the whole run through BOTH
// routes the page offers: the ?flow= boot param and __flameLab.setTuning. The
// curl field is wall-clock animated, so two runs are only comparable in SHAPE,
// not pixel-for-pixel; --burst captures a short time series at each stage so
// the flow's motion is judgeable from stills (the whole point of the change).
const BURST_GAP = 8;   // frames between burst frames (~0.13 s at 60 fps)
let flow = null;
{
  const i = argv.indexOf('--flow');
  if (i !== -1) {
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || v < 0 || v > 1) fail('--flow needs a number in [0, 1]');
    flow = v;
    argv.splice(i, 2);
  }
}
let burst = 1;
{
  const i = argv.indexOf('--burst');
  if (i !== -1) {
    const v = Number(argv[i + 1]);
    if (!Number.isInteger(v) || v < 1 || v > 12) fail('--burst needs an integer in [1, 12]');
    burst = v;
    argv.splice(i, 2);
  }
}
// `--flow-sweep 0,0.35,0.7,1` changes flameFlow LIVE inside one page load and
// captures each value at the SAME camera and pose. That is the only judgeable
// A/B here: the orbit camera's yaw accumulates wall-clock auto-spin before the
// stop-click, so two page loads do not frame identically (the drift Task 3
// fixes). Each value settles SETTLE_STAGE frames so the post chain's temporal
// smear is showing the new flow, not a blend of the old one.
let flowSweep = null;
{
  const i = argv.indexOf('--flow-sweep');
  if (i !== -1) {
    const v = argv[i + 1];
    const vals = v === undefined ? [] : v.split(',').map((s) => Number(s.trim()));
    if (vals.length < 2 || vals.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) {
      fail('--flow-sweep needs >= 2 comma-separated numbers in [0, 1]');
    }
    flowSweep = vals;
    argv.splice(i, 2);
  }
}
// --- kit-standoff sweep (flame-polish task 3) -------------------------------
// `--kit-sweep a,b,c` changes the soldier's leg-kit standoff LIVE inside one
// page load, so the shin/boot coverage A/B is shot at the SAME camera and pose
// — the failure mode the plan names (cross-run drift) is designed out. Values
// are metres of covering radius; `--kit-standoff x` pins a single one.
let kitSweep = null;
{
  const i = argv.indexOf('--kit-sweep');
  if (i !== -1) {
    const v = argv[i + 1];
    const vals = v === undefined ? [] : v.split(',').map((s) => Number(s.trim()));
    if (vals.length < 2 || vals.some((x) => !Number.isFinite(x) || x < 0)) {
      fail('--kit-sweep needs >= 2 comma-separated non-negative numbers');
    }
    kitSweep = vals;
    argv.splice(i, 2);
  }
}
let kitStandoff = null;
{
  const i = argv.indexOf('--kit-standoff');
  if (i !== -1) {
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || v < 0) fail('--kit-standoff needs a non-negative number');
    kitStandoff = v;
    argv.splice(i, 2);
  }
}

// --- skeleton-depth sweep (flame-polish task 4) -----------------------------
// `--skeleton-sweep a,b,c` changes BurnTuning.skeletonDepth LIVE inside one
// page load so the bone reveal depth A/B is shot at the SAME camera and pose.
// Values are metres of flesh the probe reads through; `--skeleton-depth x`
// pins a single one.
let skeletonSweep = null;
{
  const i = argv.indexOf('--skeleton-sweep');
  if (i !== -1) {
    const v = argv[i + 1];
    const vals = v === undefined ? [] : v.split(',').map((s) => Number(s.trim()));
    if (vals.length < 2 || vals.some((x) => !Number.isFinite(x) || x < 0)) {
      fail('--skeleton-sweep needs >= 2 comma-separated non-negative numbers');
    }
    skeletonSweep = vals;
    argv.splice(i, 2);
  }
}
let skeletonDepth = null;
{
  const i = argv.indexOf('--skeleton-depth');
  if (i !== -1) {
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || v < 0) fail('--skeleton-depth needs a non-negative number');
    skeletonDepth = v;
    argv.splice(i, 2);
  }
}
// `--skeleton-show <0..1>` pins BurnTuning.skeletonShow for the whole run so
// the ceiling of the bone reveal can be judged (the panel's slider lives at
// 0.7 by default); the filename gets an -s<value> tag.
let skeletonShow = null;
{
  const i = argv.indexOf('--skeleton-show');
  if (i !== -1) {
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || v < 0 || v > 1) fail('--skeleton-show needs a number in [0, 1]');
    skeletonShow = v;
    argv.splice(i, 2);
  }
}

let poseList = null;{
  const i = argv.indexOf('--poses');
  if (i !== -1) {
    const v = argv[i + 1];
    const names = v === undefined ? [] : v.split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0 || names.some((n) => !POSES.includes(n))) {
      fail(`--poses must be a comma-separated subset of ${POSES.join(',')}`);
    }
    poseList = names;
    argv.splice(i, 2);
  }
}
// --- run fixture (burning-feedback round 2, task 4d) ------------------------
// `--fixture run` calls __flameLab.fixture('run') after boot: one burning body
// runs a loop across the floor with the camera parked side-on, so the volume
// flame's trail (and its straightening when the body stops) can be judged. The
// run branch below shoots `-live` and `-stop` frames; the pose sweep is
// skipped. It is the LIVE sim (not --frozen), because a frozen pose has zero
// velocity and therefore no trail.
let fixture = null;
{
  const i = argv.indexOf('--fixture');
  if (i !== -1) {
    const v = argv[i + 1];
    if (v !== 'run' && v !== 'stand') fail('--fixture needs run|stand');
    fixture = v;
    argv.splice(i, 2);
    if (poseList === null) poseList = [v === 'run' ? 'run' : 'stand'];
  }
}

// --- GPU cost mode (burning-feedback round 2, task 4d step 12) --------------
// `--cost` measures the fire pass's GPU time from the lab's timestamp queries
// at 0.5/0.25 scale for 1/4/8 bodies (the lab has two, so the probe replicates
// the burning capsules through __flameLab.setFireLoad), then writes cost.json.
// It takes no PNGs and exits.
let costMode = false;
{
  const i = argv.indexOf('--cost');
  if (i !== -1) { costMode = true; argv.splice(i, 1); }
  if (costMode) {
    if (technique === null) technique = 'volume';
    if (fixture === null) fixture = 'run';
    if (poseList === null) poseList = ['run'];
  }
}

// --clock <seconds> freezes the lab's VISUAL clock (flipbook + curl phase) for
// the whole run, so a --flow-sweep's values share one animation instant and
// differ only by flow. Burn integration still advances. Omit for live motion.
let clock = null;
{
  const i = argv.indexOf('--clock');
  if (i !== -1) {
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || v < 0) fail('--clock needs non-negative seconds');
    clock = v;
    argv.splice(i, 2);
  }
}

// --- frozen A/B mode (flame-polish task 3, step 1) --------------------------
// `--frozen` calls __flameLab.freeze(true) right after boot: the motion clock
// (dt 0, pristine binding), the burn clock and the visual clock pin, and the
// orbit camera resets to its boot pose with auto-spin off. Two runs then frame
// and pose identically, which is the only way a per-slot standoff A/B is
// judgeable — the previous pass abandoned exactly that because the orbit yaw
// and the idle pose drifted between page loads. Implies --clock 0 unless
// --clock was given, so the flipbook/curl phase matches too.
let frozen = false;
{
  const i = argv.indexOf('--frozen');
  if (i !== -1) { frozen = true; argv.splice(i, 1); }
}
// The clock a run pins: an explicit --clock wins, else frozen pins 0.
const clockPinValue = clock ?? (frozen ? 0 : null);

// The boot flow: the sweep starts at its first value, a single run at --flow.
const bootFlow = flowSweep ? flowSweep[0] : flow;
const bootParams = ['seed=1'];
if (technique) bootParams.push(`tongue=${technique}`);
if (bootFlow !== null) bootParams.push(`flow=${bootFlow}`);
const PAGE_PATH = `/sdf-flame-lab.html?${bootParams.join('&')}`;
const shotPrefix = technique ? `${technique}-` : '';

const OUT = argv[2] ?? 'docs/dev-notes/2026-09-17-flame-lab';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5233);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9223);
const LAB_TMP = process.env.LAB_TMP ?? '/tmp';
const LAB_CHROME = process.env.LAB_CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1380, H = 820;                       // melt-capture's viewport
// Fixed frame counts, not wall-clock sleeps — the rAF clock is what the
// render loop and the post chain's temporal smear live on.
const SETTLE_BOOT = 90;     // first-use pipeline compiles after boot
// Per-pose hold AFTER the key, in frames. Walk/run shoot MID-STRIDE: the
// wander boxes are ±0.35 m, so at 60+ frames (1 s) a walker has already
// arrived at its target and the gait reads idle. Collapse needs the full
// fall (the 60-frame first pass caught it complete; 90 is margin).
const SETTLE_POSE = { close: 30, stand: 30, walk: 30, run: 30, collapsed: 90, distant: 15, death: 90 };
const SETTLE_STAGE = 10;    // post-aa smear history flushed to <2e-6
const ZOOM_TICKS = 25;      // wheel ticks out: 3.2 + 25*0.2 -> clamped at 8
const CLOSE_TICKS = 9;      // wheel ticks in: 3.2 - 9*0.2 -> 1.4, one body cups the frame
const MIN_LUMA_STD = 5;     // a flatter frame is a broken frame (melt's gate)
setTimeout(() => { console.error('FAIL: watchdog (10 min)'); process.exit(2); }, 10 * 60_000).unref();
mkdirSync(OUT, { recursive: true });
mkdirSync(LAB_TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Server lifecycle (lab-servers.sh, node port) ---------------------------

/** Anything ANSWERING counts as listening (curl-exit-7 rule), not just 200s. */
async function listening(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

const started = []; // { pid, kind, profileDir? } — only OUR processes.
let cleanupRan = false;

function killStarted() {
  for (const s of started) {
    try { process.kill(-s.pid, 'SIGTERM'); } catch { /* already gone */ }
    try { process.kill(s.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

// 'exit' handlers must be synchronous: kill the groups, leave the profile
// (removing it before the port is confirmed closed is the one thing
// lab-servers.sh's cleanup explicitly refuses to do).
process.on('exit', killStarted);

async function stopStarted() {
  if (cleanupRan) return;
  cleanupRan = true;
  killStarted();
  for (const s of started) {
    const url = s.kind === 'vite'
      ? `http://localhost:${VITE}/`
      : `http://localhost:${CDP}/json/version`;
    // Being reaped is not the same as the port being free (lab-servers.sh's
    // note); poll until it answers no more, THEN remove our own profile.
    for (let i = 0; i < 25; i++) {
      if (!(await listening(url))) break;
      await sleep(200);
    }
    if (s.profileDir) {
      try { rmSync(s.profileDir, { recursive: true, force: true }); } catch { /* next run's problem */ }
    }
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { killStarted(); process.exit(2); });
}

async function serversUp() {
  if (!(await listening(`http://localhost:${VITE}/`))) {
    console.log(`flame-capture: starting vite on ${VITE}`);
    const log = openSync(`${LAB_TMP}/lab-vite-${VITE}.log`, 'a');
    const child = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], {
      detached: true, stdio: ['ignore', log, log],
    });
    child.unref();
    started.push({ pid: child.pid, kind: 'vite' });
    for (let i = 0; i < 40; i++) {
      if (await listening(`http://localhost:${VITE}/`)) break;
      await sleep(500);
    }
    if (!(await listening(`http://localhost:${VITE}${PAGE_PATH}`))) {
      fail(`vite never came up on ${VITE} (log: ${LAB_TMP}/lab-vite-${VITE}.log)`);
    }
  } else {
    // Port busy: prove it is OUR dev server before reusing it (the 404 trap
    // lab-servers.sh documents — any vite answers `/`).
    if (!(await listening(`http://localhost:${VITE}${PAGE_PATH}`))) {
      fail(`port ${VITE} is busy but does not serve ${PAGE_PATH} — stop it or set LAB_VITE_PORT`);
    }
    console.log(`flame-capture: reusing vite on ${VITE}`);
  }

  if (!(await listening(`http://localhost:${CDP}/json/version`))) {
    console.log(`flame-capture: starting chrome (headless) on debug port ${CDP}`);
    // TMPDIR + crash-dumps redirect: Chrome writes its ProcessSingleton socket
    // under TMPDIR and Crashpad under the GLOBAL profile regardless of
    // --user-data-dir; both defeat a workspace-write sandbox (lab-servers.sh).
    const tmpDir = `${LAB_TMP}/tmp-${CDP}`;
    mkdirSync(tmpDir, { recursive: true });
    const profileDir = `${LAB_TMP}/chrome-flame-${CDP}`;
    const log = openSync(`${LAB_TMP}/lab-chrome-${CDP}.log`, 'a');
    const child = spawn(LAB_CHROME, [
      '--headless=new',
      `--remote-debugging-port=${CDP}`,
      '--enable-unsafe-webgpu',
      `--user-data-dir=${profileDir}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-crash-reporter',
      `--crash-dumps-dir=${LAB_TMP}/crashpad-${CDP}`,
      `--window-size=${W},${H}`,
      'about:blank',
    ], {
      detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, TMPDIR: tmpDir },
    });
    child.unref();
    started.push({ pid: child.pid, kind: 'chrome', profileDir });
    for (let i = 0; i < 40; i++) {
      if (await listening(`http://localhost:${CDP}/json/version`)) break;
      await sleep(500);
    }
    if (!(await listening(`http://localhost:${CDP}/json/version`))) {
      fail(`chrome never came up on ${CDP} (log: ${LAB_TMP}/lab-chrome-${CDP}.log)`);
    }
  } else {
    console.log(`flame-capture: reusing chrome on debug port ${CDP}`);
    // A reused Chrome must prove it has WebGPU (the black-canvas trap —
    // lab-servers.sh probes for the same reason).
    const probe = await fetch(`http://localhost:${CDP}/json/new?${encodeURIComponent(`http://localhost:${VITE}/`)}`, { method: 'PUT' })
      .then((r) => r.json()).catch(() => null);
    if (!probe) fail(`could not open a probe tab on reused chrome ${CDP}`);
    const verdict = await new Promise((resolve) => {
      const ws = new WebSocket(probe.webSocketDebuggerUrl);
      const done = (v) => { try { ws.close(); } catch { /* */ } resolve(v); };
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
          expression: `(async () => { if (!navigator.gpu) return 'no navigator.gpu'; return (await navigator.gpu.requestAdapter()) ? 'ok' : 'no adapter'; })()`,
          awaitPromise: true, returnByValue: true,
        } }));
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === 1) done(m.result?.result?.value ?? 'probe returned nothing');
      };
      ws.onerror = () => done('probe websocket error');
      setTimeout(() => done('probe timed out'), 15000);
    });
    await fetch(`http://localhost:${CDP}/json/close/${probe.id}`).catch(() => {});
    if (verdict !== 'ok') fail(`reused chrome on ${CDP} has no working WebGPU: ${verdict}`);
  }
}

// Servers BEFORE the CDP prologue: melt-capture's prologue could assume its
// shell wrapper had already started them; this script owns the lifecycle.
await serversUp();

// --- CDP client (melt-capture's prologue) -----------------------------------

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch { /* gone */ }
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
const consoleErrors = [];   // console.error texts (the shutter's onError lands here)
const pageExceptions = [];  // uncaught page exceptions
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageExceptions.push((m.params.exceptionDetails?.exception?.description
      ?? m.params.exceptionDetails?.text ?? 'page exception').slice(0, 300));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// Page's own input, through real browser events (not synthetic DOM events —
// those have no active pointerId and the page's setPointerCapture would throw).
const keyTap = async (key, code, vk, text) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const mouseClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
};
// A real drag along the canvas: the orbit camera reads pointermove while a
// button is held (camYaw -= dx * 0.008). Every event carries pointerType
// 'mouse' — without it a press that follows another click at the same point
// lands in Chrome's double-click window and the drag never reaches the page
// (probed 2026-09-17 — the probe diff across a fixed drag was 16.6 luma with
// pointerType, and the framing did not move without it). Origin is OFFSET
// from the spin-stop click for the same reason.
const dragBy = async (x, y, dx, dy) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x + (dx * i) / steps), y: Math.round(y + (dy * i) / steps), buttons: 1, pointerType: 'mouse' });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
};
const wheelAt = async (x, y, deltaY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
};
const frames = async (n) => {
  await evaluate(`new Promise((r) => { let n = 0; const t = () => (++n >= ${n} ? r(n) : requestAnimationFrame(t)); requestAnimationFrame(t); })`);
};

// A flat capture (stale viewport, GPU device lost) LOOKS like a normal file
// on disk — decode and refuse (melt's pngStats, luma over a sparse grid).
// The decoder covers what this script reads: 8-bit RGB(A) screenshots and the
// 8-bit palette Blood reference tiles (PLTE + tRNS), non-interlaced.
function decodePng(png) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'PLTE') plte = Buffer.from(data);
    if (type === 'tRNS') trns = Buffer.from(data);
    if (type === 'IEND') break;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || ![2, 3, 6].includes(colorType)) return { unsupported: true };
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 3 ? 1 : colorType === 6 ? 4 : 3;
  const unfilter = (stride) => {
    const out = Buffer.alloc(h * stride);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const cur = out.subarray(y * stride, (y + 1) * stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (f === 1) v = (v + a) & 0xff;
        else if (f === 2) v = (v + b) & 0xff;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        cur[i] = v;
      }
      prev = cur;
    }
    return out;
  };
  if (colorType === 3) {
    const idx = unfilter(w);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const p = idx[i];
      rgba[i * 4] = plte[p * 3]; rgba[i * 4 + 1] = plte[p * 3 + 1]; rgba[i * 4 + 2] = plte[p * 3 + 2];
      rgba[i * 4 + 3] = trns && p < trns.length ? trns[p] : 255;
    }
    return { w, h, rgba };
  }
  const chans = colorType === 6 ? 4 : 3;
  const out = unfilter(w * chans);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = out[i * chans]; rgba[i * 4 + 1] = out[i * chans + 1]; rgba[i * 4 + 2] = out[i * chans + 2];
    rgba[i * 4 + 3] = chans === 4 ? out[i * chans + 3] : 255;
  }
  return { w, h, rgba };
}

function pngStats(png) {
  const d = decodePng(png);
  if (d.unsupported) return d;
  const { w, h, rgba } = d;
  let n = 0, s = 0, s2 = 0;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const i = (y * w + x) * 4;
      const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      n++; s += l; s2 += l * l;
    }
  }
  const mean = s / n;
  return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
}

// --- contact sheet ----------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Nearest-neighbour scale — the tiles are UPscaled ~2.7x, where NN's crunch
 *  is the honest look (the page's own #reference strip draws them pixelated
 *  too, image-rendering: pixelated). */
function scaleNearest(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, (y * sh / dh) | 0);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, (x * sw / dw) | 0);
      const s = (sy * sw + sx) * 4, d = (y * dw + x) * 4;
      dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3];
    }
  }
  return dst;
}

// The tiles go in at the STAND frames' body height: the soldier spans head to
// heel roughly 265..660 px in the 1380x820 stand frames (measured on the fix
// pass captures), so ~400 px is "same body height" for the row's two stand
// bodies. The close frame's body is much larger; one sheet cannot match both.
const CONTACT_BODY_PX = 400;
const CONTACT_GAP = 12;
const CONTACT_BG = [16, 12, 14, 255];

function composeContact(frames, tiles, outPath) {
  const fdec = frames.map((f) => {
    const d = decodePng(f.buf);
    if (d.unsupported) fail(`${f.name}: not a decodable 8-bit RGB(A) PNG for the contact sheet`);
    return d;
  });
  const H = fdec[0].h;
  const tileDec = tiles.map((t) => {
    const d = decodePng(t.buf);
    if (d.unsupported) fail(`${t.file}: not a decodable 8-bit palette PNG`);
    const dw = Math.max(1, Math.round(d.w * CONTACT_BODY_PX / d.h));
    return { name: t.file, w: dw, h: CONTACT_BODY_PX, rgba: scaleNearest(d.rgba, d.w, d.h, dw, CONTACT_BODY_PX) };
  });
  const W = fdec.reduce((a, f) => a + f.w, 0) + tileDec.reduce((a, t) => a + t.w, 0) + CONTACT_GAP * (fdec.length + tileDec.length - 1);
  const canvas = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { canvas[i * 4] = CONTACT_BG[0]; canvas[i * 4 + 1] = CONTACT_BG[1]; canvas[i * 4 + 2] = CONTACT_BG[2]; canvas[i * 4 + 3] = 255; }
  const blit = (src, sw, sh, dx, dypix) => {
    for (let y = 0; y < sh; y++) {
      if (dypix + y < 0 || dypix + y >= H) continue;
      for (let x = 0; x < sw; x++) {
        const s = (y * sw + x) * 4, d = ((dypix + y) * W + dx + x) * 4;
        const a = src[s + 3] / 255;
        canvas[d] = src[s] * a + canvas[d] * (1 - a);
        canvas[d + 1] = src[s + 1] * a + canvas[d + 1] * (1 - a);
        canvas[d + 2] = src[s + 2] * a + canvas[d + 2] * (1 - a);
      }
    }
  };
  let x = 0;
  for (const f of fdec) { blit(f.rgba, f.w, f.h, x, 0); x += f.w + CONTACT_GAP; }
  for (const t of tileDec) { blit(t.rgba, t.w, t.h, x, (H - t.h) >> 1); x += t.w + CONTACT_GAP; }
  writeFileSync(outPath, encodePng(canvas, W, H));
  return { w: W, h: H, entries: [...fdec.map((f) => `${f.w}x${f.h}`), ...tileDec.map((t) => `${t.w}x${t.h}`)] };
}

// --- The sweep ---------------------------------------------------------------

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// FRESH PAGE PER POSE: the page has no "stop wandering" key (',' and '.' only
// set wanderOn), and char is MONOTONIC within a page — a new load resets both,
// so every pose starts from the same clean idle state.
async function freshPage() {
  await send('Page.navigate', { url: `http://localhost:${VITE}${PAGE_PATH}` });
  let booted = false;
  for (let i = 0; i < 160; i++) {
    await sleep(500);
    try {
      booted = await evaluate('typeof window.__flameLab === "object" && window.__flameLab !== null');
    } catch { /* page still booting */ }
    if (booted) break;
  }
  if (!booted) {
    // Boot is the one failure where the page's own diagnostics matter most:
    // dump what the page reported before giving up (the #errors box, the last
    // console errors, the last exceptions) — a silent "never appeared" hides
    // the actual import/shader error for an hour.
    let errBox = '';
    try { errBox = String(await evaluate("document.getElementById('errors')?.textContent || ''")); }
    catch { /* blank page */ }
    fail('__flameLab never appeared — the flame lab never booted.'
      + ` #errors: ${errBox.slice(0, 600)}`
      + ` | console: ${consoleErrors.slice(-5).join(' ;; ').slice(0, 700)}`
      + ` | exceptions: ${pageExceptions.slice(-3).join(' ;; ').slice(0, 700)}`);
  }
  // Freeze FIRST, before the settle frames: the pristine motion record and the
  // reset orbit camera must be the state every later frame builds on.
  if (frozen) {
    const applied = await evaluate('window.__flameLab.freeze(true)');
    if (applied !== true) fail(`freeze(true) applied ${JSON.stringify(applied)}`);
  }
  // Pin the technique through the console contract too (the boot param
  // already set it) — the run proves BOTH routes land the same switch, and
  // setTechnique echoes what is actually applied. The flag is `technique`
  // (null when no flag): a `TECHNIQUE` name here was a rename leftover that
  // crashed every --technique run before its first capture.
  if (technique !== null) {
    const applied = await evaluate(`window.__flameLab.setTechnique(${JSON.stringify(technique)})`);
    if (applied !== technique) fail(`setTechnique(${technique}) applied ${JSON.stringify(applied)}`);
  }
  // Pin the curl flow through the console contract too (the ?flow= boot param
  // already set it), so a sweep run proves both routes.
  if (bootFlow !== null) {
    const applied = await evaluate(`window.__flameLab.setTuning({ flameFlow: ${bootFlow} }).flameFlow`);
    if (applied !== bootFlow) fail(`setTuning({ flameFlow: ${bootFlow} }) applied ${JSON.stringify(applied)}`);
  }
  // Pin the skeleton show-through strength for the whole run so the bone
  // reveal ceiling can be judged (--skeleton-show; the depth sweep stays live).
  if (skeletonShow !== null) {
    const applied = await evaluate(`window.__flameLab.setTuning({ skeletonShow: ${skeletonShow} }).skeletonShow`);
    if (applied !== skeletonShow) fail(`setTuning({ skeletonShow: ${skeletonShow} }) applied ${JSON.stringify(applied)}`);
  }
  // Freeze the visual clock for a same-phase --flow-sweep A/B (and for every
  // --frozen run — the flipbook and curl must share one instant).
  if (clockPinValue !== null) {
    const applied = await evaluate(`window.__flameLab.setClock(${clockPinValue})`);
    if (applied !== clockPinValue) fail(`setClock(${clockPinValue}) applied ${JSON.stringify(applied)}`);
  }
  // The run fixture (task 4d): the page's own locomotion, one burning body.
  if (fixture !== null) {
    const applied = await evaluate(`window.__flameLab.fixture(${JSON.stringify(fixture)})`);
    if (applied !== fixture) fail(`fixture(${fixture}) applied ${JSON.stringify(applied)}`);
  }
  await frames(SETTLE_BOOT);
  // The backend line lives in the status box ("backend: webgpu", green) — the
  // single most important fact about these captures (lab-main's own note).
  backend = await evaluate(`(() => {
    // Anchor on the known backends: textContent runs the status box's divs
    // together ("backend: webgpubodies: 2"), so a bare \\w+ over-matches.
    const m = document.body.textContent.match(/backend: (webgpu|webgl\\d*)/);
    return m ? m[1] : 'unknown';
  })()`);
  // Stop the orbit spin so every pose frames from the same yaw (0.35), then
  // hide the panels: 'h' is the page's own hide-everything key (debug panel,
  // flame panel, toggle). #controls is help text; the Blood reference strip
  // (#reference) STAYS — side-by-side with those tiles is the point.
  await mouseClick(Math.floor(W / 2), Math.floor(H / 2));
  await keyTap('h', 'KeyH', 72, 'h');
  await evaluate(`(() => {
    // #controls is help text and #panel-toggle is the reveal button — neither
    // belongs in a look capture (melt hides the same pair). The Blood
    // reference strip (#reference) STAYS: side-by-side with those tiles is
    // the point of a fixed pose set.
    for (const sel of ['#controls', '#panel-toggle']) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
    return true;
  })()`);
  await frames(5);
}

let backend = 'unknown';
const shots = [];

/** Screenshot, write, gate on luma, and record — the one shutter so the death
 *  sequence (flame-polish task 5) and the pose sweep cannot drift apart. */
async function shoot(name, meta) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  writeFileSync(`${OUT}/${name}`, buf);
  const stats = pngStats(buf);
  if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
  if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
  shots.push({ ...meta, file: name, std: stats.std, buf });
  console.log(`${name}  (luma std=${stats.std})`);
}

/** Median of a numeric list (0 for an empty one). */
function median(list) {
  if (!list || list.length === 0) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * The fire pass's GPU ms from the lab's pass timings, medians over the window.
 * Labels are the post-aa setPassLabel names; `total` sums the four fire draws.
 */
async function sampleFireMs(settle) {
  await frames(settle);
  const t = await evaluate('window.__flameLab.passTimings()');
  const wall = await evaluate('window.__flameLab.frameMs()');
  if (!t || t.installed !== true) return { installed: false, wall };
  const byLabel = new Map();
  for (const s of t.samples) {
    const label = String(s.label);
    if (!label.startsWith('post:fire')) continue;
    const arr = byLabel.get(label) ?? [];
    arr.push(s.ms);
    byLabel.set(label, arr);
  }
  const out = { installed: true, march: 0, resolve: 0, composite: 0, copy: 0, total: 0, frames: 0, samples: t.samples.length, wall };
  for (const [label, arr] of byLabel) {
    const key = label.slice('post:fire-'.length);
    const m = median(arr);
    out[key] = +m.toFixed(3);
    out.total += m;
    out.frames = Math.max(out.frames, arr.length);
  }
  out.total = +out.total.toFixed(3);
  return out;
}

if (costMode) {
  await freshPage();
  if (backend !== 'webgpu') {
    console.error(`flame-capture: backend is "${backend}" — cost mode needs WebGPU`);
    await stopStarted();
    process.exit(2);
  }
  const results = [];
  for (const scale of [0.5, 0.25]) {
    for (const load of [1, 4, 8]) {
      await evaluate(`window.__flameLab.setVolume({ resolutionScale: ${scale}, steps: 32 })`);
      await evaluate(`window.__flameLab.setFireLoad(${load})`);
      const on = await sampleFireMs(60);
      // steps 0 is the pipeline-free off switch: the four draws still run, the
      // march early-outs, so on.total - off.total is the march itself.
      await evaluate('window.__flameLab.setVolume({ steps: 0 })');
      const off = await sampleFireMs(30);
      await evaluate('window.__flameLab.setVolume({ steps: 32 })');
      const row = { scale, bodies: load, on, off };
      results.push(row);
      console.log(`cost scale=${scale} bodies=${load}`
        + ` march=${on && on.installed ? on.march : 'n/a'}`
        + ` total=${on && on.installed ? on.total : 'n/a'}`
        + ` wall_on=${on && on.wall ? on.wall.median.toFixed(2) : 'n/a'}`
        + ` wall_off=${off && off.wall ? off.wall.median.toFixed(2) : 'n/a'}`);
    }
  }
  writeFileSync(`${OUT}/cost.json`, JSON.stringify({
    backend, note: 'GPU pass ms from timestamp queries; bodies replicate the burning capsules (the lab has two).',
    results,
  }, null, 2));
  console.log(`cost.json written to ${OUT}`);
  await stopStarted();
  process.exit(0);
}

for (const pose of (poseList ?? POSES)) {  await freshPage();
  if (backend !== 'webgpu') {
    console.error(`flame-capture: backend is "${backend}" — not the WebGPU path; refusing to call these flame-lab captures`);
    await stopStarted();
    process.exit(2);
  }

  // BURNING DEATH (flame-polish task 5): light the bodies, let the fire
  // establish, kill them through the page's own 'k' key (collapse + burn-down),
  // then pin two deterministic points in the burn-down and shoot each. The
  // timer comes from the live tuning, so this follows corpseBurnSec rather
  // than a script constant. The stage loop below is skipped for this pose:
  // its forceBurn pin would cancel the burn-down.
  if (pose === 'death') {
    await evaluate('window.__flameLab.ignite(true)');
    await frames(60);                       // burn ramps to 1, char accumulates
    await shoot(`${shotPrefix}death-lit.png`, { pose, stage: 'lit', technique });
    await keyTap('k', 'KeyK', 75, 'k');     // kill: collapse + burn-down
    await frames(SETTLE_POSE.death);        // the body falls
    const corpseSec = await evaluate('window.__flameLab.tuning().corpseBurnSec');
    if (!Number.isFinite(corpseSec) || corpseSec <= 0) {
      fail(`tuning().corpseBurnSec is ${JSON.stringify(corpseSec)} — cannot shoot a burn-down`);
    }
    for (const point of [
      { name: 'midburn', sec: corpseSec / 2 },
      { name: 'out', sec: corpseSec },
    ]) {
      const states = await evaluate(`window.__flameLab.death(${point.sec})`);
      await frames(SETTLE_STAGE);           // temporal smear shows the pinned flame
      await shoot(`${shotPrefix}death-${point.name}.png`, {
        pose, stage: point.name, technique, corpseSec: point.sec, burns: states,
      });
    }
    continue;
  }

  // RUN FIXTURE (burning-feedback round 2, task 4d): a LIVE run, so the volume
  // flame actually trails. freshPage's __flameLab.fixture('run') already lit
  // body 0 and parked the camera; let the body reach speed and turn, shoot the
  // live trail, then stop and shoot the straightened flame.
  if (fixture === 'run') {
    await frames(90);
    // The trail is the point of this fixture, so give the lag enough strength
    // to read at run speed (the default 0.3 s / 0.6 m is tuned for a walk).
    await evaluate('window.__flameLab.setVolume({ lag: 0.9, lagMaxM: 1.1 })');
    await frames(SETTLE_STAGE);
    for (const stage of STAGES) {
      await evaluate(`(() => {
        window.__flameLab.capture(1, ${stage.char}, 0);
        window.__flameLab.setTuning({ charRate: 0 });
        return window.__flameLab.burns();
      })()`);
      await frames(SETTLE_STAGE);
      await shoot(`${shotPrefix}run-live-${stage.name}.png`, {
        pose: 'run', stage: stage.name, char: stage.char, technique, fixture: 'run',
      });
    }
    await evaluate("window.__flameLab.fixture('stop')");
    await frames(75);   // decelerate: the velocity lag straightens
    for (const stage of STAGES) {
      await evaluate(`(() => {
        window.__flameLab.capture(1, ${stage.char}, 0);
        window.__flameLab.setTuning({ charRate: 0 });
        return window.__flameLab.burns();
      })()`);
      await frames(SETTLE_STAGE);
      await shoot(`${shotPrefix}run-stop-${stage.name}.png`, {
        pose: 'run', stage: stage.name, char: stage.char, technique, fixture: 'stop',
      });
    }
    continue;
  }

  // Drive the pose through the page's own keys. The drag origin is 60 px
  // left of centre — the spin-stop click already fired there, and a press at
  // the same point inside Chrome's double-click window swallows the drag.
  // Drag right ~88 px runs yaw 0.35 down to ~-0.35, putting the ZOMBIE (the
  // burning SDF body) nearest the camera; then wheel in 9 ticks:
  // 3.2 - 9*0.2 -> 1.4, so one body cups most of the frame.
  if (pose === 'close') {
    await dragBy(Math.floor(W / 2) - 60, Math.floor(H / 2), 88, 0);
    for (let i = 0; i < CLOSE_TICKS; i++) await wheelAt(Math.floor(W / 2), Math.floor(H / 2), -120);
  }
  if (pose === 'walk') await keyTap(',', 'Comma', 188, ',');
  if (pose === 'run') await keyTap('.', 'Period', 190, '.');
  if (pose === 'collapsed') await keyTap('k', 'KeyK', 75, 'k');
  if (pose === 'distant') {
    for (let i = 0; i < ZOOM_TICKS; i++) await wheelAt(Math.floor(W / 2), Math.floor(H / 2), 120);
  }
  // Frozen runs cannot use the keys: the pose is a deterministic fixed-step
  // simulation (__flameLab.pose), so walk/run/collapsed still develop but the
  // exact same way on every load. See --frozen above.
  if (frozen) {
    const applied = await evaluate(`window.__flameLab.pose(${JSON.stringify(pose)})`);
    if (applied !== pose) fail(`pose(${pose}) applied ${JSON.stringify(applied)}`);
  }
  await frames(SETTLE_POSE[pose]);

  for (const stage of STAGES) {
    // Pin the stage, then stop the char creep (see HOLDING A STAGE above).
    await evaluate(`(() => {
      window.__flameLab.capture(1, ${stage.char});
      window.__flameLab.setTuning({ charRate: 0 });
      return window.__flameLab.burns();
    })()`);
    await frames(SETTLE_STAGE);
    // The values to shoot at this stage: a --flow-sweep list A/Bs them at one
    // camera; otherwise a single value (null = the page default, no tag so the
    // canonical filenames and contact sheet are untouched).
    const flows = flowSweep ?? [flow];
    const kits = kitSweep ?? [kitStandoff];
    for (const fv of flows) {
      if (fv !== null) {
        const applied = await evaluate(`window.__flameLab.setTuning({ flameFlow: ${fv} }).flameFlow`);
        if (applied !== fv) fail(`setTuning({ flameFlow: ${fv} }) applied ${JSON.stringify(applied)}`);
        await frames(SETTLE_STAGE);   // let the temporal smear show the new flow
      }
      for (const kv of kits) {
        if (kv !== null) {
          const applied = await evaluate(`window.__flameLab.setKitStandoff(${kv})`);
          if (applied !== kv) fail(`setKitStandoff(${kv}) applied ${JSON.stringify(applied)}`);
          await frames(SETTLE_STAGE);
        }
        const ftag = fv === null ? '' : `-f${String(fv).replace('.', 'p')}`;
        const ktag = kv === null ? '' : `-k${String(kv).replace('.', 'p')}`;
        const stag = skeletonShow === null ? '' : `-s${String(skeletonShow).replace('.', 'p')}`;
        // Skeleton reveal depth (flame-polish task 4): a --skeleton-sweep list
        // A/Bs values at one camera; null keeps the page default and the
        // canonical filename.
        const depths = skeletonSweep ?? [skeletonDepth];
        for (const dv of depths) {
          if (dv !== null) {
            const applied = await evaluate(`window.__flameLab.setTuning({ skeletonDepth: ${dv} }).skeletonDepth`);
            if (applied !== dv) fail(`setTuning({ skeletonDepth: ${dv} }) applied ${JSON.stringify(applied)}`);
            await frames(SETTLE_STAGE);
          }
          const dtag = dv === null ? '' : `-d${String(dv).replace('.', 'p')}`;
          const tag = `${ftag}${ktag}${stag}${dtag}`;
          // --burst > 1 takes a short time series at this stage: the flow is
          // animated on the wall clock, so a single still cannot show that the
          // flame MOVES as one body. b0 keeps the canonical name the contact sheet
          // and prior plans read.
          for (let bfi = 0; bfi < burst; bfi++) {
            if (bfi > 0) await frames(BURST_GAP);
            const shot = await send('Page.captureScreenshot', { format: 'png' });
            const buf = Buffer.from(shot.result.data, 'base64');
            const name = `${shotPrefix}${pose}-${stage.name}${tag}${bfi === 0 ? '' : `-b${bfi}`}.png`;
            writeFileSync(`${OUT}/${name}`, buf);
            const stats = pngStats(buf);
            if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
            if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
            shots.push({ pose, stage: stage.name, char: stage.char, file: name, std: stats.std, flow: fv, kit: kv, skeletonShow, skeletonDepth: dv, burstFrame: bfi, buf });
            console.log(`${name}  (char=${stage.char}, flow=${fv ?? 'default'}, kit=${kv ?? 'default'}, skeleton=${skeletonShow ?? 'default'}, depth=${dv ?? 'default'}, luma std=${stats.std})`);
          }
        }
      }
    }
  }
}

// --- Contact sheet (fix pass task 4): the judge is one image -----------------
// close-fresh, stand-fresh and stand-charred in a row, then the three Blood
// reference tiles at body height. Shot buffers come straight from THIS run,
// so the sheet can never describe a stale folder. A --poses subset that omits
// one of those frames (a flow sweep shoots close only) skips the sheet rather
// than failing a valid partial run.
const captured = new Set(shots.map((s) => s.file));
const CONTACT_NAMES = ['close-fresh.png', 'stand-fresh.png', 'stand-charred.png'];
const haveContact = CONTACT_NAMES.every((n) => captured.has(`${shotPrefix}${n}`));
let contact = null;
if (haveContact) {
  const CONTACT_FRAMES = CONTACT_NAMES.map((n) => ({ name: `${shotPrefix}${n}`, buf: shots.find((s) => s.file === `${shotPrefix}${n}`).buf }));
  const CONTACT_TILES = ['3321.png', '3323.png', '3325.png'].map((f) => {
    const p = `public/assets/blood-tiles/${f}`;
    return { file: f, buf: readFileSync(p) }; // tracked reference tiles — dev-safe to read
  });
  const composed = composeContact(CONTACT_FRAMES, CONTACT_TILES, `${OUT}/${shotPrefix}contact.png`);
  console.log(`contact.png  (${composed.w}x${composed.h}: ${composed.entries.join(' | ')})`);
  contact = {
    file: `${shotPrefix}contact.png`, frames: CONTACT_FRAMES.map((f) => f.name),
    tiles: CONTACT_TILES.map((t) => t.file), bodyPx: CONTACT_BODY_PX,
  };
} else {
  console.log('contact.png skipped — --poses omitted a contact frame');
}

// The shutter's own error callback must have stayed silent (task 13's check,
// enforced for every capture run — a blurred capture is not what shipped).
const shutterErrors = consoleErrors.filter((t) => t.includes('[shutter-game]'));
if (shutterErrors.length > 0) fail(`shutter errored mid-run: ${shutterErrors[0]}`);
// A render pipeline that FAILS to compile draws nothing and logs through
// console.error — the flame-tongues task-2 pass shipped with an undefined
// WGSL identifier and rendered black while this script stayed silent because
// nothing here inspected the console. Refuse a run whose renderer reported a
// pipeline/shader error: a compile failure is never an acceptable capture.
const rendererErrors = consoleErrors.filter((t) => /THREE\.WebGPURenderer.*(pipeline|ShaderModule|fragment error|unresolved value)/i.test(t));
if (rendererErrors.length > 0) fail(`renderer pipeline error: ${rendererErrors[0].slice(0, 300)}`);
// Exceptions in page listeners surface here, not through evaluate. The orbit
// stop-click can report a benign setPointerCapture NotFoundError under CDP's
// synthetic pointer — ignore exactly that, fail on anything else.
const realExceptions = pageExceptions.filter((t) => !/NotFoundError|setPointerCapture/.test(t));
if (realExceptions.length > 0) fail(`page threw: ${realExceptions[0]}`);

writeFileSync(`${OUT}/captures.json`, JSON.stringify({
  url: PAGE_PATH, backend, viewport: { width: W, height: H }, technique,
  flow, flowSweep, kitStandoff, kitSweep, clock: clockPinValue, frozen, burst, poses: poseList ?? POSES, stages: STAGES, contact,
  shots: shots.map(({ buf, ...rest }) => rest),
}, null, 2));

await stopStarted();
console.log(`\n${shots.length} captures${contact ? ` + ${shotPrefix}contact.png` : ''} + captures.json in ${OUT}`);
process.exit(0);
