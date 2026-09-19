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
// --stages fresh,charred,full selects the pinned char stages (full = char 1);
// --luma shoots a fire-off twin of each stage and prints the body-silhouette
// mean/median luminance and the 2x-median "bone" fraction per pose. Use --luma
// with --frozen: the silhouette mask is a char diff between two frames, so it
// needs the camera and pose pinned. This is the skeleton pass's before/after
// gate; normal runs are unchanged.
// Exits 0 on success, 2 if it could not run (boot failure, page exception,
// no WebGPU backend, a flat capture).
import { mkdirSync, writeFileSync, openSync, rmSync, readFileSync, statSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync, deflateSync } from 'node:zlib';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(2); };

// The fixed pose set, and the stage names a stage's char value pins. Declared
// before arg parsing so --poses can validate against it.
const POSES = ['close', 'stand', 'walk', 'run', 'collapsed', 'distant', 'death'];
// The named char stages. `full` (char 1) is opt-in through --stages so the
// canonical fresh/charred capture set is unchanged; it exists for the skeleton
// pass, whose bone reveal only fully engages once flesh has burnt through
// (step 3's char > 0.55 gate).
const STAGE_BY_NAME = Object.freeze({
  fresh: { name: 'fresh', char: 0 },
  charred: { name: 'charred', char: 0.6 },
  full: { name: 'full', char: 1 },
});
const STAGES = [STAGE_BY_NAME.fresh, STAGE_BY_NAME.charred];

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
// --- stage selection + body-luminance report (skeleton pass) ----------------
// `--stages fresh,charred,full` replaces the default stage list; `full` pins
// char 1. `--luma` additionally shoots a fire-off twin of every stage
// (`<name>-off.png`, burn 0 at the same pinned char, so no flame and no fire
// light — the clean surface) and reports, per pose, the mean luminance, median
// and "brighter than 2x the charred-flesh median" fraction of the BODY
// SILHOUETTE. The silhouette is the pixel diff between the char-0 off frame and
// the stage's off frame at the frozen camera/pose, so the dark lab background
// and the mesh kit (which does not char) drop out. Use with --frozen: the mask
// is only meaningful when two runs frame and pose identically.
const STAGE_NAMES = Object.keys(STAGE_BY_NAME);
let stageList = null;{
  const i = argv.indexOf('--stages');
  if (i !== -1) {
    const v = argv[i + 1];
    const names = v === undefined ? [] : v.split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0 || names.some((n) => !STAGE_NAMES.includes(n))) {
      fail(`--stages must be a comma-separated subset of ${STAGE_NAMES.join(',')}`);
    }
    stageList = names.map((n) => STAGE_BY_NAME[n]);
    argv.splice(i, 2);
  }
}
let luma = false;
{
  const i = argv.indexOf('--luma');
  if (i !== -1) { luma = true; argv.splice(i, 1); }
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
    if (v !== 'run' && v !== 'stand' && v !== 'dash' && v !== 'dash-stop') fail('--fixture needs run|stand|dash|dash-stop');
    // 'dash' is the page's 'run' fixture (the scripted straight dash); the page
    // echoes the name it applied, so keep the wire name 'run'.
    fixture = (v === 'dash' || v === 'dash-stop') ? 'run' : v;
    argv.splice(i, 2);
    if (poseList === null) poseList = [v === 'stand' ? 'stand' : 'run'];
  }
}

// --- sheet mode (round 2b task 4b step 7) -----------------------------------
// `--sheet <out.png> <in1.png> <in2.png> ...` composes a row of already-written
// captures at one height, so the round-2 volume, the new volume, the cards and
// the Blood wildfire tiles can be judged in one image. It starts no page.
// `--sheet-tiles a.png,b.png` appends scaled reference tiles (the Blood
// wildfire sprite tiles) to the sheet's right-hand side. Parsed BEFORE --sheet,
// which takes the remaining positionals.
let sheetTiles = null;
{
  const i = argv.indexOf('--sheet-tiles');
  if (i !== -1) { sheetTiles = String(argv[i + 1] ?? '').split(',').filter(Boolean); argv.splice(i, 2); }
}
let sheetArgs = null;
{
  const i = argv.indexOf('--sheet');
  if (i !== -1) { sheetArgs = argv.slice(i + 1); argv.splice(i, 1); }
}

// --- look A/B mode (round 2b task 4b step 5) --------------------------------
// `--look` captures the four LOOK metrics for stand and close: the
// round-2-emulated tuning vs the new round-2b tuning, both on the SAME page
// load, camera and pose (frozen), plus a sootGain-0 twin for the smoke metric
// and a 20-frame standing burst for the motion metric. Writes look.json and
// takes no pose sweep. The emulated baseline is the round-2b shader with
// erode 0 / smoke 0 / the round-2 falloff — it is labelled as such, because
// the exact round-2 shader is not in the tree any more (the committed round-2
// PNGs are measured separately for the structure/gaps check).
let lookMode = false;
{
  const i = argv.indexOf('--look');
  if (i !== -1) { lookMode = true; argv.splice(i, 1); }
  if (lookMode) {
    if (technique === null) technique = 'volume';
    if (poseList === null) poseList = ['stand', 'close'];
    // frozen is set after its declaration below (--look implies it).
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
// --look implies a frozen camera/pose (the A/B must share framing), so set it
// here where `frozen` exists; the clock pin below then picks up 0.
if (lookMode) frozen = true;
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

// SHEET MODE is handled after the contact-sheet consts, below (it needs
// CONTACT_BODY_PX).

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

// --- body-silhouette luminance report (skeleton pass) -----------------------
// The per-shot pngStats above is the WHOLE frame: the dark room dominates it, so
// a change confined to a body moves it by hundredths. These helpers measure the
// body itself. Everything is 0..255 luma; the mask comes from the char change
// (unburnt vs charred), not from the flames, so it is the body silhouette.

/** Luma (0..255) per pixel of a decoded RGB(A) PNG. */
function lumaOf(rgba) {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return out;
}

/** Silhouette mask: pixels whose luma moved between the unburnt reference and
 *  the stage frame by more than `threshold`. Char darkens the whole body, so
 *  this marks flesh; the static room and the unburnt mesh kit do not move. */
function charMask(refLuma, stageLuma, threshold = 8) {
  const mask = new Uint8Array(refLuma.length);
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (Math.abs(refLuma[i] - stageLuma[i]) > threshold) { mask[i] = 1; n++; }
  }
  return { mask, n };
}

/** Stats over the masked (body) pixels of one image. `boneFrac` is the fraction
 *  brighter than 2x the masked median — the pass's skeleton-read gate. */
function maskStats(luma, mask) {
  let n = 0, sum = 0;
  const vals = [];
  for (let i = 0; i < luma.length; i++) {
    if (!mask[i]) continue;
    n++; sum += luma[i]; vals.push(luma[i]);
  }
  if (n === 0) return { px: 0, mean: 0, median: 0, boneFrac: 0, max: 0 };
  vals.sort((a, b) => a - b);
  const m = vals.length >> 1;
  const med = vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
  const thr = 2 * med;
  let bone = 0;
  for (const v of vals) if (v > thr) bone++;
  return {
    px: n, mean: +(sum / n).toFixed(2), median: +med.toFixed(2),
    boneFrac: +(bone / n).toFixed(4), max: +vals[vals.length - 1].toFixed(1),
  };
}

// --- flame look metrics (round 2b task 4b step 5) ---------------------------
// The judge for "does the volume read as flame": a smooth glow shell and an
// eroded tongue field can have the same mean brightness, so these measure the
// SHAPE. All operate inside the flame's screen bounds (the projected fire AABB,
// volumeProbe().bounds), in 0..255 luma.

/** A hot flame pixel: red-dominant and not the room. The lab's background is a
 *  near-black brown and the floor is desaturated, so this is robust; the
 *  reference-tile strip is OUTSIDE the projected fire bounds by construction. */
function isFirePixel(r, g, b) {
  return r > 50 && r > b + 22 && r > g * 0.75;
}

/** Structure (mean |Laplacian| of luma), gaps (dark fraction) and flame
 *  coverage inside a screen rect. `structure` rises when the flame tears into
 *  tongues and falls for a smooth shell; `gaps` is the fraction of the rect
 *  darker than 30% of the flame's own median luma — a shell has none. */
function flameMetrics(png, box) {
  const d = decodePng(png);
  if (d.unsupported) return { unsupported: true };
  const { w, h, rgba } = d;
  if (!box) return { boxPx: 0 };
  const x0 = Math.max(0, Math.min(w - 1, box[0] | 0));
  const y0 = Math.max(0, Math.min(h - 1, box[1] | 0));
  const x1 = Math.max(0, Math.min(w - 1, box[2] | 0));
  const y1 = Math.max(0, Math.min(h - 1, box[3] | 0));
  if (x1 <= x0 + 2 || y1 <= y0 + 2) return { boxPx: 0 };
  const luma = lumaOf(rgba);
  const vals = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      if (isFirePixel(rgba[i], rgba[i + 1], rgba[i + 2])) vals.push(luma[y * w + x]);
    }
  }
  let boxPx = 0, dark = 0;
  let median = 0;
  if (vals.length > 8) {
    vals.sort((a, b) => a - b);
    median = vals.length % 2 ? vals[vals.length >> 1] : (vals[(vals.length >> 1) - 1] + vals[vals.length >> 1]) / 2;
    const darkThr = median * 0.3;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        boxPx++;
        if (luma[y * w + x] < darkThr) dark++;
      }
    }
  }
  let lapSum = 0, lapN = 0;
  for (let y = y0 + 1; y <= y1 - 1; y++) {
    for (let x = x0 + 1; x <= x1 - 1; x++) {
      const i = y * w + x;
      const lap = luma[i - 1] + luma[i + 1] + luma[i - w] + luma[i + w] - 4 * luma[i];
      lapSum += Math.abs(lap);
      lapN++;
    }
  }
  return {
    boxPx,
    flamePx: vals.length,
    flameFrac: boxPx > 0 ? +(vals.length / boxPx).toFixed(4) : 0,
    median: +median.toFixed(2),
    structure: lapN > 0 ? +(lapSum / lapN).toFixed(3) : 0,
    gaps: boxPx > 0 ? +(dark / boxPx).toFixed(4) : 0,
  };
}

/** Mean luma (0..255) over a screen rect — the smoke crop's reading. */
function cropMeanLuma(png, box) {
  const d = decodePng(png);
  if (d.unsupported) return null;
  const { w, h, rgba } = d;
  const x0 = Math.max(0, Math.min(w - 1, Math.round(box[0])));
  const y0 = Math.max(0, Math.min(h - 1, Math.round(box[1])));
  const x1 = Math.max(0, Math.min(w - 1, Math.round(box[2])));
  const y1 = Math.max(0, Math.min(h - 1, Math.round(box[3])));
  if (x1 <= x0 || y1 <= y0) return { mean: 0, px: 0 };
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      n++;
    }
  }
  return { mean: +(sum / n).toFixed(2), px: n };
}

/** Mean absolute per-pixel luma change between two decoded frames, inside a
 *  rect — the "fire moves by itself" measurement while the body stands still. */
function frameDiffInBox(aPng, bPng, box) {
  const a = decodePng(aPng); const b = decodePng(bPng);
  if (a.unsupported || b.unsupported || !box) return 0;
  const { w, h } = a;
  const la = lumaOf(a.rgba); const lb = lumaOf(b.rgba);
  const x0 = Math.max(0, Math.min(w - 1, box[0] | 0));
  const y0 = Math.max(0, Math.min(h - 1, box[1] | 0));
  const x1 = Math.max(0, Math.min(w - 1, box[2] | 0));
  const y1 = Math.max(0, Math.min(h - 1, box[3] | 0));
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      sum += Math.abs(la[y * w + x] - lb[y * w + x]);
      n++;
    }
  }
  return n > 0 ? +(sum / n).toFixed(3) : 0;
}

/** The smoke crop: 0.5..1.5 m above the head, half a metre either side. */
function smokeCrop(probe) {
  const s = probe.pxPerM;
  const hx = probe.head[0], hy = probe.head[1];
  return [hx - 0.5 * s, hy - 1.5 * s, hx + 0.5 * s, hy - 0.5 * s];
}

/** The flame's horizontal centroid minus the body's projected x, in METRES
 *  along world +x (positive = flame is ahead of the body). The trail test: a
 *  dashed body leaves it negative (opposite the +x motion); a stopped body
 *  centres it near zero. `probe.right` gives the screen direction of world +x.
 *
 *  The sample band is ABOVE THE TORSO and the reference strip is excluded: the
 *  fire's light pool on the floor and the strip's orange art both pass the hot
 *  test and dragged the whole-frame centroid forward in the first dash run
 *  (a +1.06 m "trail" in the wrong direction). */
function flameCentroidOffsetM(png, probe) {
  if (!probe || !probe.bounds) return null;
  const d = decodePng(png);
  if (d.unsupported) return null;
  const { w, h, rgba } = d;
  const [bx0, by0, bx1, by1] = probe.bounds;
  const s = probe.pxPerM > 0 ? probe.pxPerM : 1;
  // Above the torso: from 2.0 m above down to 0.2 m above (screen y grows down).
  const y0 = Math.max(by0, Math.round(probe.torso[1] - 2.0 * s));
  const y1 = Math.min(by1, Math.round(probe.torso[1] - 0.2 * s));
  let sx = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (REFERENCE_STRIP(x, y, w, h)) continue;
      const i = (y * w + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (!isFirePixel(r, g, b)) continue;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (l < 55) continue;
      sx += x; n++;
    }
  }
  if (n < 16 || !probe.pxPerM) return { flamePx: n };
  const sign = probe.right[0] - probe.torso[0] >= 0 ? 1 : -1;
  const cx = sx / n;
  return {
    flamePx: n,
    centroidPx: +cx.toFixed(1),
    bodyPx: +probe.torso[0].toFixed(1),
    offsetM: +(((cx - probe.torso[0]) / probe.pxPerM) * sign).toFixed(4),
    band: [y0, y1],
    velX: probe.vel ? +probe.vel[0].toFixed(3) : null,
  };
}

/** The Blood reference-tile strip's screen region (bottom-right): orange flame
 *  art that a hot-pixel mask would otherwise read as fire. */
const REFERENCE_STRIP = (x, y, w, h) => x > 0.70 * w && y > 0.78 * h;

/** Bounding box of hot flame pixels, with an optional exclusion predicate —
 *  used on a saved PNG (a committed round-2 capture) where no page probe is
 *  available to project the fire AABB. The reference-tile strip is excluded by
 *  the caller (it is orange fire art and would swallow the box). */
function imageFireBox(png, exclude) {
  const d = decodePng(png);
  if (d.unsupported) return null;
  const { w, h, rgba } = d;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (exclude && exclude(x, y, w, h)) continue;
      const i = (y * w + x) * 4;
      if (!isFirePixel(rgba[i], rgba[i + 1], rgba[i + 2])) continue;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return n > 32 ? [x0, y0, x1, y1] : null;
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

// SHEET MODE: compose a row of already-written PNGs and exit. Runs here because
// composeContact needs CONTACT_BODY_PX; the servers are up by now and the exit
// handler reaps them. The trailing positional is OUT (a directory).
if (sheetArgs) {
  if (sheetArgs.length < 2) fail('--sheet needs <name.png> <in1.png> [in2.png ...] (OUT dir is the positional)');
  const [name, ...rest] = sheetArgs;
  const inputs = rest.filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  const frames = inputs.map((f) => ({ name: f.split('/').pop(), buf: readFileSync(f) }));
  const tiles = (sheetTiles ?? []).map((f) => ({ file: f.split('/').pop(), buf: readFileSync(f) }));
  const outPath = `${OUT}/${name}`;
  const composed = composeContact(frames, tiles, outPath);
  console.log(`sheet ${outPath} (${composed.w}x${composed.h}: ${composed.entries.join(' | ')})`);
  process.exit(0);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// FRESH PAGE PER POSE: the page has no "stop wandering" key (',' and '.' only
// set wanderOn), and char is MONOTONIC within a page — a new load resets both,
// so every pose starts from the same clean idle state.
async function freshPage(frozenOverride) {
  const useFrozen = frozenOverride === undefined ? frozen : frozenOverride;
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
  if (useFrozen) {
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
  if (clockPinValue !== null && useFrozen) {
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
  // The look probe rides the same frame as the screenshot (the camera/limbs it
  // reads are the ones just rendered), so the metrics' screen bounds match.
  const probe = technique === 'volume'
    ? await evaluate('window.__flameLab.volumeProbe()')
    : null;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  writeFileSync(`${OUT}/${name}`, buf);
  const stats = pngStats(buf);
  if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
  if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
  const metrics = probe ? flameMetrics(buf, probe.bounds) : null;
  // The tight box is derived from THIS frame's hot pixels (minus the
  // reference-tile strip, which is orange flame art in the bottom-right). It is
  // the sensitive structure/gaps judge: a diffuse shell bounds itself tightly
  // and fills its box, a tongue field leaves gaps between the licks.
  const metricsTight = technique === 'volume'
    ? flameMetrics(buf, imageFireBox(buf, REFERENCE_STRIP))
    : null;
  shots.push({ ...meta, file: name, std: stats.std, probe, metrics, metricsTight, buf });
  console.log(`${name}  (luma std=${stats.std}${metrics ? `, structure=${metrics.structure}, gaps=${metrics.gaps}, flamePx=${metrics.flamePx}` : ''}${metricsTight ? `, tight structure=${metricsTight.structure}, gaps=${metricsTight.gaps}` : ''})`);
}

/** Median of a numeric list (0 for an empty one). */
function median(list) {
  if (!list || list.length === 0) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * The fire pass's GPU ms from the lab's pass timings, medians over the window.
 * Labels are the post-aa setPassLabel names.
 *
 * THE EXCLUSIVE CHARGE IS THE NUMBER. three's raw `ms` is end-minus-start, and
 * on a tile GPU every pass's pair starts at the command buffer's schedule time,
 * so a full-res copy reads the same residency as the 32-step march it queued
 * behind (round 2's "a copy costs 2.6 ms" table). `passTimings().exclusive` is
 * gpu-pass-timing's completion-order attribution, which partitions the frame's
 * GPU span exactly; it is what `march`/`resolve`/`composite`/`copy` report
 * here. The raw residency medians ride along as `raw*` for the cross-check.
 * `counts` is the per-label pass census — a label whose count is not one per
 * frame is re-rendering, and no per-pass ms can be trusted then.
 */
async function sampleFireMs(settle) {
  await frames(settle);
  const t = await evaluate('window.__flameLab.passTimings()');
  const wall = await evaluate('window.__flameLab.frameMs()');
  if (!t || t.installed !== true) return { installed: false, wall };
  const key = (label) => label.slice('post:fire-'.length);
  const byLabel = new Map();
  const perFrameTotals = [];
  for (const fr of (t.exclusive ?? [])) {
    let sum = 0;
    for (const { label, ms } of fr.labels) {
      if (!label.startsWith('post:fire')) continue;
      const arr = byLabel.get(key(label)) ?? [];
      arr.push(ms);
      byLabel.set(key(label), arr);
      sum += ms;
    }
    perFrameTotals.push(sum);
  }
  // Raw residency, for the cross-check that the exclusive numbers did something.
  const rawByLabel = new Map();
  for (const s of (t.samples ?? [])) {
    const label = String(s.label);
    if (!label.startsWith('post:fire')) continue;
    const arr = rawByLabel.get(key(label)) ?? [];
    arr.push(s.ms);
    rawByLabel.set(key(label), arr);
  }
  const out = {
    installed: true, raw: t.raw === true, march: 0, resolve: 0, composite: 0, copy: 0,
    total: 0, frames: 0, samples: (t.samples ?? []).length, wall, counts: t.counts ?? [],
  };
  for (const [k, arr] of byLabel) out[k] = +median(arr).toFixed(3);
  for (const [k, arr] of rawByLabel) out[`raw${k[0].toUpperCase()}${k.slice(1)}`] = +median(arr).toFixed(3);
  out.total = +median(perFrameTotals).toFixed(3);
  out.frames = perFrameTotals.length;
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
  const fmt = (r) => (r && r.installed
    ? `march=${r.march} resolve=${r.resolve} composite=${r.composite} copy=${r.copy}`
      + ` total=${r.total} (raw march=${r.rawMarch ?? 'n/a'} copy=${r.rawCopy ?? 'n/a'})`
      + ` frames=${r.frames} raw=${r.raw}`
    : 'n/a');
  for (const scale of [0.5, 0.25]) {
    for (const load of [1, 4, 8]) {
      await evaluate(`window.__flameLab.setVolume({ resolutionScale: ${scale}, steps: 32 })`);
      await evaluate(`window.__flameLab.setFireLoad(${load})`);
      const on = await sampleFireMs(60);
      // steps 0 is the pipeline-free off switch: the draws still run, the march
      // early-outs, so on.march - off.march is the march itself. The copy (a
      // single full-res texture copy) must hold its cost: a "march" that does
      // not collapse to ~0 here is a mislabelled timestamp pair, not a fast one.
      await evaluate('window.__flameLab.setVolume({ steps: 0 })');
      const off = await sampleFireMs(30);
      await evaluate('window.__flameLab.setVolume({ steps: 32 })');
      const row = { scale, bodies: load, on, off };
      results.push(row);
      console.log(`cost scale=${scale} bodies=${load} on:  ${fmt(on)}`);
      console.log(`cost scale=${scale} bodies=${load} steps0: ${fmt(off)}`);
      const marchLabel = (on.counts ?? []).find((c) => c.label === 'post:fire-march');
      console.log(`cost scale=${scale} bodies=${load} sanity:`
        + ` march_steps32=${on.march} >> march_steps0=${off.march}`
        + ` | copy_steps32=${on.copy} copy_steps0=${off.copy}`
        + ` | march passes=${marchLabel?.passes ?? 'n/a'} over ${on.frames} frames`);
    }
  }
  // The two sanity checks Step 1 requires before ANY number is reported:
  // (1) steps 0 drops the march to near zero while the copy stays; (2) the copy
  // is far below the march. Both are printed above and stored here.
  const base = results.filter((r) => r.scale === 0.5);
  const sanity = {
    marchCollapsesAtSteps0: base.every((r) => r.on.march > 0.05 && r.off.march < r.on.march * 0.25),
    copyCheaperThanMarch: base.every((r) => !r.on.installed || r.on.copy < r.on.march * 0.5),
    rawBoundariesPresent: results.every((r) => r.on.raw === true),
    marchPassesPerFrame: base.map((r) => ({
      bodies: r.bodies,
      passes: (r.on.counts ?? []).find((c) => c.label === 'post:fire-march')?.passes ?? null,
      frames: r.on.frames,
    })),
  };
  console.log(`cost sanity: ${JSON.stringify(sanity)}`);
  writeFileSync(`${OUT}/cost.json`, JSON.stringify({
    backend,
    note: 'EXCLUSIVE GPU ms (gpu-pass-timing completion-order attribution); '
      + 'rawMarch/rawCopy are the end-minus-start residency medians round 2 reported. '
      + 'Bodies replicate the burning capsules (the lab has two).',
    sanity,
    results,
  }, null, 2));
  console.log(`cost.json written to ${OUT}`);
  await stopStarted();
  process.exit(0);
}

// --- look A/B mode (round 2b task 4b step 5) --------------------------------
// Four metrics for stand and close, round-2-emulated vs new. The structure and
// gaps numbers come from the projected fire bounds (volumeProbe), so both
// tunings are measured through the SAME rect on the SAME page/camera. The
// committed round-2 PNG is measured too, with an image-derived box (the page
// probe cannot reach a file), as the independent baseline.
if (lookMode) {
  // The new arm is THE PAGE'S OWN DEFAULT RECORD (read after boot), so this
  // script cannot drift from fire-volume-tuning.ts. Cards off: the metrics
  // judge the VOLUME, and the cards would supply the tongues regardless.
  let NEW_VOLUME = null;
  let ROUND2_VOLUME = null;
  const VOLUME_NOTE = 'round-2-emulated = round-2b shader with erode 0, edgeSharp 1, coreR 0.06, curlStrength 0.35, tempGain 0.7, no smoke (not the round-2 shader itself)';
  const applyVolume = async (rec) => evaluate(`window.__flameLab.setVolume(${JSON.stringify(rec)})`);
  const LOOK_POSES = poseList ?? ['stand', 'close'];
  /** Mean frame-to-frame luma change inside the fire bounds over `n` frames. */
  async function motionMeasure(n, gapFrames) {
    const probe = await evaluate('window.__flameLab.volumeProbe()');
    let prev = null, sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0 && gapFrames) await frames(gapFrames);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.result.data, 'base64');
      if (prev) { sum += frameDiffInBox(prev, buf, probe.bounds); count++; }
      prev = buf;
    }
    return { motion: count > 0 ? +(sum / count).toFixed(3) : 0, frames: n, box: probe.bounds, pxPerM: probe.pxPerM };
  }
  /** The close framing, matching the pose sweep's drag + wheel. */
  async function framePose(pose) {
    if (pose === 'close') {
      await dragBy(Math.floor(W / 2) - 60, Math.floor(H / 2), 88, 0);
      for (let i = 0; i < CLOSE_TICKS; i++) await wheelAt(Math.floor(W / 2), Math.floor(H / 2), -120);
    }
  }

  const look = [];
  for (const pose of LOOK_POSES) {
    await freshPage();
    if (backend !== 'webgpu') { console.error(`flame-capture: backend is "${backend}" — look mode needs WebGPU`); await stopStarted(); process.exit(2); }
    await evaluate('window.__flameLab.capture(1, 0, 0)');
    await evaluate('window.__flameLab.setTuning({ charRate: 0 })');
    // ISOLATE THE VOLUME: the SDF body's own surface fire (burn fireGain /
    // coverage) and the bloom are NOT what this A/B judges, and they dominate
    // the frame's high-frequency energy. Zero them so the four metrics read the
    // volumetric pass alone.
    await evaluate('window.__flameLab.setTuning({ fireGain: 0, fireCoverage: 0, glowGain: 0 })');
    if (NEW_VOLUME === null) {
      NEW_VOLUME = { ...(await evaluate('window.__flameLab.volume()')), cardsPerBody: 0 };
      ROUND2_VOLUME = {
        ...NEW_VOLUME, erode: 0, edgeSharp: 1, coreR: 0.06,
        curlStrength: 0.35, tempGain: 0.7, smokeAlbedo: 0,
      };
    }
    // FLAME-ONLY arms (sootGain 0 AND smokeAlbedo 0) isolate the ERODED SHAPE
    // from the smoke: comparing gaps/structure with smoke on would measure the
    // plume, not the tongues. The smoke metric compares the smoke arm against
    // the flame-only arm at the same crop.
    const NEW_FLAME_VOLUME = { ...NEW_VOLUME, smokeAlbedo: 0, sootGain: 0 };
    const ROUND2_FLAME_VOLUME = { ...ROUND2_VOLUME, smokeAlbedo: 0, sootGain: 0 };
    await framePose(pose);
    await frames(SETTLE_POSE[pose] ?? 30);
    await applyVolume(ROUND2_FLAME_VOLUME); await frames(20);
    await shoot(`${shotPrefix}look-${pose}-r2.png`, { pose, stage: 'fresh', technique, mode: 'round2-emulated-flameonly' });
    const r2 = shots[shots.length - 1];
    await applyVolume(NEW_FLAME_VOLUME); await frames(20);
    await shoot(`${shotPrefix}look-${pose}-new-flame.png`, { pose, stage: 'fresh', technique, mode: 'new-flameonly' });
    const nf = shots[shots.length - 1];
    await applyVolume(NEW_VOLUME); await frames(20);
    await shoot(`${shotPrefix}look-${pose}-new.png`, { pose, stage: 'fresh', technique, mode: 'new' });
    const nw = shots[shots.length - 1];
    await applyVolume(NEW_VOLUME);
    const smoke = {
      withSmoke: nw ? (cropMeanLuma(nw.buf, smokeCrop(nw.probe))?.mean ?? null) : null,
      withoutSmoke: nf ? (cropMeanLuma(nf.buf, smokeCrop(nf.probe))?.mean ?? null) : null,
      crop: nw ? smokeCrop(nw.probe) : null,
      cropPx: nw ? (cropMeanLuma(nw.buf, smokeCrop(nw.probe))?.px ?? 0) : 0,
    };
    smoke.delta = smoke.withSmoke !== null && smoke.withoutSmoke !== null ? +(smoke.withSmoke - smoke.withoutSmoke).toFixed(2) : null;
    // The committed round-2 PNG, measured with an image-derived box. The
    // reference-tile strip (bottom-right, orange flame art) is excluded, and so
    // is the soldier (both bodies burn in the round-2 captures; the look arm
    // burns body 0 only, which is the LEFT body). Framing differs from the look
    // page, so this is a cross-check, not the primary number.
    let committed = null;
    try {
      const cbuf = readFileSync(`docs/dev-notes/2026-09-18-burning-feedback/captures/volume-${pose}-fresh.png`);
      const cbox = imageFireBox(cbuf, (x, y, w, h) => x > 0.55 * w || REFERENCE_STRIP(x, y, w, h));
      committed = { box: cbox, metrics: flameMetrics(cbuf, cbox) };
    } catch (err) { committed = { error: String(err).slice(0, 80) }; }
    look.push({
      pose,
      box: nf?.probe?.bounds ?? null,
      tightBox: nf ? imageFireBox(nf.buf, REFERENCE_STRIP) : null,
      r2: r2?.metrics ?? null, newFlame: nf?.metrics ?? null, new: nw?.metrics ?? null,
      r2Tight: r2?.metricsTight ?? null, newFlameTight: nf?.metricsTight ?? null,
      smoke, committedRound2: committed,
    });
  }

  // MOTION: the fire must animate, so this runs on an UNFROZEN page (the
  // frozen clock pins the curl phase). The body stands idle, so every change
  // inside the bounds is the fire moving by itself.
  for (const pose of LOOK_POSES) {
    await freshPage(false);
    if (backend !== 'webgpu') { console.error(`flame-capture: backend is "${backend}" — look mode needs WebGPU`); await stopStarted(); process.exit(2); }
    await evaluate('window.__flameLab.capture(1, 0, 0)');
    await evaluate('window.__flameLab.setTuning({ charRate: 0 })');
    await evaluate('window.__flameLab.setTuning({ fireGain: 0, fireCoverage: 0, glowGain: 0 })');
    await framePose(pose);
    await frames(60);
    await applyVolume(ROUND2_VOLUME); await frames(30);
    const mR2 = await motionMeasure(20, 1);
    await applyVolume(NEW_VOLUME); await frames(30);
    const mNew = await motionMeasure(20, 1);
    const rec = look.find((r) => r.pose === pose);
    if (rec) rec.motion = { round2: mR2, new: mNew };
    console.log(`look motion ${pose}: round2=${mR2.motion} new=${mNew.motion} box=${JSON.stringify(mNew.box)}`);
  }

  const summary = look.map((r) => ({
    pose: r.pose,
    structure: { r2: r.r2?.structure, newFlame: r.newFlame?.structure, ratio: r.r2?.structure ? +(r.newFlame.structure / r.r2.structure).toFixed(3) : null },
    gaps: { r2: r.r2?.gaps, newFlame: r.newFlame?.gaps },
    tightStructure: { r2: r.r2Tight?.structure, newFlame: r.newFlameTight?.structure },
    tightGaps: { r2: r.r2Tight?.gaps, newFlame: r.newFlameTight?.gaps },
    projectedBox: r.box, tightBox: r.tightBox,
    committedRound2: r.committedRound2?.metrics ?? null,
    smoke: r.smoke,
    motion: r.motion ? { r2: r.motion.round2.motion, new: r.motion.new.motion } : null,
  }));
  writeFileSync(`${OUT}/look.json`, JSON.stringify({ technique, viewport: { width: W, height: H }, volumeNote: VOLUME_NOTE, look, summary }, null, 2));
  console.log('\nLOOK METRICS (round-2-emulated vs new):');
  for (const s of summary) console.log('  ' + JSON.stringify(s));
  console.log(`look.json written to ${OUT}`);
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

  // DASH FIXTURE (round 2b task 4b step 6): a SCRIPTED straight dash — the body
  // translates at a constant 3 m/s along +x for 1.5 s, then holds, with a fixed
  // side camera. freshPage's fixture('run') parked the body at x0 and armed the
  // dash; here we start it, shoot mid-dash, wait for the auto-stop, wait 0.5 s,
  // and shoot the straightened flame. The trailing offset is the flame's
  // horizontal centroid minus the body's projected x, in metres.
  if (fixture === 'run') {
    for (const stage of STAGES) {
      await evaluate(`(() => {
        window.__flameLab.capture(1, ${stage.char}, 0);
        window.__flameLab.setTuning({ charRate: 0 });
        return window.__flameLab.burns();
      })()`);
      await frames(60);   // let the flame establish at the parked start
      const started = await evaluate('window.__flameLab.dashStart()');
      if (!started || started.active !== true) fail('dashStart() did not start the dash');
      // Wait on the PAGE's clock, not a frame count: headless frame rate varies.
      await evaluate("new Promise((r) => { const t = () => { const d = window.__flameLab.dash(); if (d.t >= 0.8) return r(d); requestAnimationFrame(t); }; t(); })");
      const midState = await evaluate('window.__flameLab.dash()');
      await shoot(`${shotPrefix}dash-mid-${stage.name}.png`, {
        pose: 'run', stage: stage.name, char: stage.char, technique, fixture: 'dash-mid', dash: midState,
      });
      shots[shots.length - 1].centroid = flameCentroidOffsetM(shots[shots.length - 1].buf, shots[shots.length - 1].probe);
      const mid = shots[shots.length - 1];
      console.log(`dash-mid  t=${midState.t.toFixed(2)}s x=${midState.x.toFixed(2)} centroid=${JSON.stringify(mid.centroid)}`);
      // Auto-stop, then 0.5 s of settling (the gait blend ramps down too).
      await evaluate("new Promise((r) => { const t = () => { const d = window.__flameLab.dash(); if (!d.active) return r(d); requestAnimationFrame(t); }; t(); })");
      await frames(30);
      const stopState = await evaluate('window.__flameLab.dash()');
      await shoot(`${shotPrefix}dash-stop-${stage.name}.png`, {
        pose: 'run', stage: stage.name, char: stage.char, technique, fixture: 'dash-stop', dash: stopState,
      });
      shots[shots.length - 1].centroid = flameCentroidOffsetM(shots[shots.length - 1].buf, shots[shots.length - 1].probe);
      const st = shots[shots.length - 1];
      console.log(`dash-stop t=${stopState.t.toFixed(2)}s x=${stopState.x.toFixed(2)} centroid=${JSON.stringify(st.centroid)}`);
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

  for (const stage of (stageList ?? STAGES)) {
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
            const bProbe = technique === 'volume'
              ? await evaluate('window.__flameLab.volumeProbe()')
              : null;
            const shot = await send('Page.captureScreenshot', { format: 'png' });
            const buf = Buffer.from(shot.result.data, 'base64');
            const name = `${shotPrefix}${pose}-${stage.name}${tag}${bfi === 0 ? '' : `-b${bfi}`}.png`;
            writeFileSync(`${OUT}/${name}`, buf);
            const stats = pngStats(buf);
            if (stats.unsupported) fail(`${name}: not a decodable 8-bit RGB(A) PNG`);
            if ((stats.std ?? 0) < MIN_LUMA_STD) fail(`${name}: flat frame (luma std ${stats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
            const bMetrics = bProbe ? flameMetrics(buf, bProbe.bounds) : null;
            const bTight = technique === 'volume' ? flameMetrics(buf, imageFireBox(buf, REFERENCE_STRIP)) : null;
            shots.push({ pose, stage: stage.name, char: stage.char, file: name, std: stats.std, flow: fv, kit: kv, skeletonShow, skeletonDepth: dv, burstFrame: bfi, probe: bProbe, metrics: bMetrics, metricsTight: bTight, buf });
            console.log(`${name}  (char=${stage.char}, flow=${fv ?? 'default'}, kit=${kv ?? 'default'}, skeleton=${skeletonShow ?? 'default'}, depth=${dv ?? 'default'}, luma std=${stats.std}${bMetrics ? `, structure=${bMetrics.structure}, gaps=${bMetrics.gaps}` : ''})`);
          }
        }
      }
    }
    // FIRE-OFF TWIN (--luma): burn 0 at the same pinned char, so the frame has
    // no flame emission and no fire light — the pure charred/bone surface the
    // report measures. char is monotonic, so this never rewinds a later stage.
    if (luma) {
      await evaluate(`window.__flameLab.capture(0, ${stage.char})`);
      await frames(SETTLE_STAGE);
      const offShot = await send('Page.captureScreenshot', { format: 'png' });
      const offBuf = Buffer.from(offShot.result.data, 'base64');
      const offName = `${shotPrefix}${pose}-${stage.name}-off.png`;
      writeFileSync(`${OUT}/${offName}`, offBuf);
      const offStats = pngStats(offBuf);
      if (offStats.unsupported) fail(`${offName}: not a decodable 8-bit RGB(A) PNG`);
      if ((offStats.std ?? 0) < MIN_LUMA_STD) fail(`${offName}: flat frame (luma std ${offStats.std} < ${MIN_LUMA_STD}) — nothing rendered`);
      shots.push({ pose, stage: stage.name, char: stage.char, file: offName, std: offStats.std, off: true, buf: offBuf });
      console.log(`${offName}  (char=${stage.char}, fire OFF, luma std=${offStats.std})`);
    }
  }
}

// --- body-luminance report (--luma) -----------------------------------------
// Pairs each stage's fire-off frame with the char-0 fire-off reference at the
// same pose. The mask is the char diff, so it is the body silhouette; mean,
// median and the 2x-median "bone" fraction are then read off the same stage's
// on and off frames. `off` is the pure surface (no flame emission), which is
// what the bone-shading pass has to move without tripping the +15% gate.
let lumaReport = null;
if (luma) {
  const lumaCache = new Map();
  const lumaFor = (file) => {
    if (!lumaCache.has(file)) {
      const s = shots.find((x) => x.file === file);
      if (!s) return null;
      const d = decodePng(s.buf);
      if (d.unsupported) fail(`${file}: not decodable for the luma report`);
      lumaCache.set(file, lumaOf(d.rgba));
    }
    return lumaCache.get(file);
  };
  lumaReport = [];
  for (const pose of (poseList ?? POSES)) {
    const ref = lumaFor(`${shotPrefix}${pose}-fresh-off.png`);
    if (!ref) continue;                       // --stages omitted fresh
    for (const stage of (stageList ?? STAGES)) {
      if (stage.name === 'fresh') continue;
      const offL = lumaFor(`${shotPrefix}${pose}-${stage.name}-off.png`);
      if (!offL) continue;
      const onL = lumaFor(`${shotPrefix}${pose}-${stage.name}.png`);
      const { mask, n } = charMask(ref, offL);
      if (n === 0) { lumaReport.push({ pose, stage: stage.name, char: stage.char, bodyPx: 0 }); continue; }
      lumaReport.push({
        pose, stage: stage.name, char: stage.char, bodyPx: n,
        off: maskStats(offL, mask),
        on: onL ? maskStats(onL, mask) : null,
      });
    }
  }
  console.log('\nBODY-SILHOUETTE LUMINANCE (mask = char diff vs fresh-off; boneFrac = px > 2x median):');
  console.log('  pose  stage     char  bodyPx  off.mean  off.med  off.boneFrac  off.max  on.mean  on.boneFrac');
  for (const r of lumaReport) {
    if (!r.off) { console.log(`  ${r.pose}  ${r.stage}  ${r.char}  (no body pixels)`); continue; }
    console.log(`  ${r.pose.padEnd(5)} ${r.stage.padEnd(9)} ${String(r.char).padEnd(5)} ${String(r.bodyPx).padEnd(7)} ${String(r.off.mean).padEnd(9)} ${String(r.off.median).padEnd(8)} ${String(r.off.boneFrac).padEnd(13)} ${String(r.off.max).padEnd(8)} ${String(r.on?.mean ?? '-').padEnd(8)} ${r.on?.boneFrac ?? '-'}`);
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
  flow, flowSweep, kitStandoff, kitSweep, clock: clockPinValue, frozen, burst, poses: poseList ?? POSES, stages: stageList ?? STAGES, luma, lumaReport, contact,
  shots: shots.map(({ buf, ...rest }) => rest),
}, null, 2));

await stopStarted();
console.log(`\n${shots.length} captures${contact ? ` + ${shotPrefix}contact.png` : ''} + captures.json in ${OUT}`);
process.exit(0);
