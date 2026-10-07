// scripts/head-split-gate.mjs — the head split, part B (plan docs/superpowers/plans/2026-10-04-head-split-part-b.md
// Task B8; spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §4-§5). Bare ring page (/sdf-game.html,
// no ?level), frozen zombies (?frozen=1), headless WebGPU, seams in place of pointer lock.
// The measures are made on the FLOAT MARCH TARGET (__sdfGameDebug.readMarchTarget: the SDF bodies before the lens and
// the post FX), not on screenshots: two screenshots of one closed head differ in over 150 000 pixels. Each capture
// is two reads (readF), and what the two differ by is checked: 0 on a settled frame. The boot pins what made the lit
// target differ from one boot to the next (boot(): the dynamic-light clock, the probes' afterglow, the field
// interlace), so every number below is the same in every run.
// The expectations are derived from the live tuning constants (HEAD_SPLIT, AXE_HEAD, the follow table, the spring's
// own angles on the measured frames): a retuned angle or spring moves them with it. Every threshold is a named
// constant below, with the value measured and its margin.
//   S. A CENTRED HEAD CHOP (__sdfGame.axeChop(id, "H", "head")) opens a `middle` split, both sides. THE GAP between
//      the halves (gapRead: the stretch of a line across the old plane that the camera sees through) is read every
//      frame of the spring: it grows, overshoots and settles as the CPU's spring does on those frames, and it is the
//      gap head-split.ts predicts for the spring's angle on every frame. The zombie lives. Frozen actors: the split
//      leaf re-poses them itself, so the spring runs without a thaw (a thaw would let the body sway under the camera).
//   W. CHOP 2 WIDENS: the gap at rest is wider, and the prediction's.
//   K. CHOP 3 KICKS the split it finds at its full angle (followed on the frozen body: the halves are past it 3
//      frames on, and at the bottom of the swing back, the flesh UNDER its rest angle, the bone is still drawn at its
//      stage's share) and KILLS (thawed 3 frames, as axe-gate's K). 45 frames on, and the fall's wobble at rest, the
//      corpse's head is still open: the state, the pose's split, the GPU record, and the gap on the fallen head.
//   O. AN OFF-CENTRE CHOP (the eye stands round to the head's right, so the chop's line meets the skin off centre)
//      opens ONE side; the other half's march texels are those of the same head closed again.
//   L. LATER HITS on a moved half's outer skin, a rod cut and a pellet: each is stamped where unwarpPoint puts its
//      hit, and its mask is drawn on its crater on the half (tissue painted green, seen square on).
//   F. __sdfGame.forceSplit(id, "face", ...) folds the face half forward: a point of its cut face is where warpPoint
//      puts it.
//   M. THE SKULL: at the three real chops the bone's copies are drawn turned by the follow table's angle (their
//      matrices), and after chop 1 each seated eye is on screen where skullWarpPoint puts it (the flesh and the bone
//      out of the frame: the whole of each eye is seen, not the part its socket shows); the same landmark on a forced
//      head at the bone angles of the table's three stages (a small, a middle and a wide one), whose copies are drawn
//      on the split material of the skull the boot draws, and whose BONE PIXELS (a shown / hidden pair of the bone
//      alone) are where the split puts them and clipped: background along the fracture's line, bone where each half's
//      brow is turned to and none where the closed head has it; and the closed skull on a closed head. The boots draw the
//      DEFAULT skull: the sculpted one, `full` (no skull parameter; C checks what each boot draws). There M also checks
//      that the copies are the sculpted head's own mesh under the second paint.
//      M runs twice more, each on a boot of its own where the three chops are made for the skull alone, with nothing
//      of S, W or K measured: on the sculpted skull's FIRST LOOK (?sculpt=classic: the first sculpt under the first
//      paint, whose split material no other boot draws), and on the ANATOMICAL skull (?skull=anatomical).
//   P. THE PLATES OF A SPLIT ANATOMICAL SKULL (the anatomical boot, last). A slug knocks a plate off a closed head; split, the
//      head is drawn as its surviving plates' clipped copies, on the plates' split material, and the GPU reports no
//      error. Three pellets at the + half's bone WHERE IT IS DRAWN (on a line that misses that plate's box on the
//      closed head) release the plate drawn there, its fragment starts at the pivot as the + half's copy draws it, and
//      ON SCREEN the frame changes where that plate was drawn and not where the closed head has it. Last, the same
//      head at the axe's first chop, where the bone stands far inside the flesh: the gun's own slug, put in flight
//      on a line through the frontal bone that meets no flesh of the actor (__sdfGame.slugFrom; the projectile loop
//      steps and traces it), releases that plate from its turned pivot and leaves the actor no wound.
//   C. cost: draw time, untouched, open and closed again, at 0.6 m and 2 m (with its spread, not gated); the
//      instrument's floor over the run; THE DEPTH GUARD over every capture of the run (each body texel, placed in the
//      world by its depth, lies in front of the camera and inside some actor's proxy box or gib chunk's sphere, and
//      no run of texels shares the world origin's depth to the bit: scripts/lib/march-depth-guard.mjs, with its own
//      arms shown to fail on made-up texels); zero console errors and a clean gpuDiagnostics at the end of every boot.
//   R. RANGE (its own boot): beyond the draw distance a split is drawn closed, flesh and skull; it opens again only
//      inside the reopen distance, and holds its state at each stance.
//   A. A BODY CHOP NEAR THE NECK (the axe gate's torso chop: on the upper chest, inside the flail's head region)
//      leaves the head closed and stamps its own cut where it landed: only a chop on head flesh is a head chop
//      (axe-head.ts chopOnHead).
//   H. HEAD DAMAGE AND THE SPLIT DO NOT MIX: a slug and a flail hit on a split head take the plain un-warped paths (no
//      head damage state; the flail's crater credits the head's share of the meter); a head that head damage holds
//      refuses to split and still dies on chop 3.
//   J. THE HALVES WOBBLE WITH THE BODY AND COME TO REST (head-split.ts HEAD_SPLIT.wobble; T's boot, after it). The
//      drive is SCRIPTED, so the scenario is the same in every run: a frozen zombie with its head split, and a list
//      of accelerations of the split's mass point fed through __sdfGame.headSplitDrive, one a tick (a walk's bob and
//      sway, a hard throw each way across the split and up and down out of the hinge, a swing to end on). Frozen and
//      undriven, the halves stand at exactly the spring's angle; driven, the leaf steps them exactly as the pure step
//      does the same list, each swings off the spring's angle by its own offset, inside the wobble's limits on every
//      frame and into both stops, the pose carrying exactly the state's two angles; held on a swing, the GPU record
//      carries those angles and the skull's copies are drawn at the stage's share of each; and they are back at the
//      spring's angle, to the bit, within the settle time the constants give. Last, the cast is thawed and how far a
//      really wandering zombie's halves swing is printed (not checked: a wander is not the gate's to control). The
//      player stands at the spawn, rooms away, for it: in the ring's sight the soldiers' fire takes a zombie apart.
//   B. BOUNDS (two boots): each preset at full angle, from the front at 0.6 m and from above and behind: the shipped
//      path's hit mask and depth against the per-body path with every march bound off (?crowd=0, the proxy box grown).
//   T. S ON A TURNED ZOMBIE (its own boot, with J): the ring walks until one stands about 90 degrees round.
// The thaws let the body move, and a moving body swings the halves: after each, the cast frozen again, the gate
// steps until the wobble is exactly at rest (restWobble) before it measures a rest angle.
// A scenario that throws is a failed check of its own; the others still run, and the run ends in its summary.
// ONLY=S,K (env) runs just those scenarios (W and K need S; on the first boot M's really chopped measures need
// S, W and K). Unset runs them all: the gate. The contact sheets go to .lab-tmp/head-split-gate; SHEETS=1 writes the
// tracked ones in
// docs/dev-notes/2026-10-04-head-split/gate (OUT=<dir> anywhere else).
// Usage (bash, not zsh):
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   node scripts/head-split-gate.mjs 5241 9241
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { DEPTH_GUARD_PROBE, depthGuardAdd, depthGuardControl, depthGuardControlLine, depthGuardControlOk, depthGuardLine, depthGuardOk, depthGuardTexels, depthGuardTotals } from "./lib/march-depth-guard.mjs";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
/** Where the contact sheets go. A routine run writes them to scratch (.lab-tmp is ignored by git); SHEETS=1 writes the
 *  tracked ones the notes show. */
const OUT = process.env.OUT ?? (process.env.SHEETS === "1" ? "docs/dev-notes/2026-10-04-head-split/gate" : ".lab-tmp/head-split-gate");
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62;
/** The head's distance for the photos and the chops (m, eye to the head centre). */
const HEAD_D = 0.6;
/** A contact sheet's tile: this many screen px square about its centre, drawn SHEET_TILE px square. */
const SHEET_CROP = 560;
const SHEET_TILE = 280;
/** Frames stepped after the pins, before any scenario. */
const BOOT_SETTLE = 90;
/** Frames stepped after a camera move before a reference read: the shadow maps and the temporal passes trail it
 *  (10 frames on, 30 000 texels still differ from the settled frame by up to 0.014; 24 frames on, none). */
const SETTLE = 24;
/** Frames a chop's spring is followed for (1 s; the shipped spring is at rest by frame 20). */
const SPRING_FRAMES = 60;
// ---- THE INSTRUMENT'S FLOOR: the two reads of one capture (readF). Checked for every capture of the run.
/** The largest colour step between them. Measured 0 on every capture; a step a check counts is 1e-2 (O_COLOUR). */
const FLOOR_COLOUR_MAX = 1e-4;
/** The largest clip-depth step between them. Measured 0; a millimetre at 0.6 m is 2.8e-4. */
const FLOOR_DEPTH_MAX = 1e-6;
// ---- THE GAP (gapLine / gapRead / wedgeEye).
/** The line's height above the head centre (m): the face cuts carve their halves from the scalp down to 1.7 cm above
 *  it, so the line runs under them, across clean cut faces. */
const GAP_LEVER = 0;
/** The line's sampling step (m) and half length (samples). */
const GAP_STEP = 0.001;
const GAP_HALF_N = 150;
/** A sample counts as seen unless a surface lies more than this in front of it (m). */
const GAP_FRONT = 0.005;
/** The eye: this far out from the line along the plane (m; nearer, the player is pushed out of the body), and at
 *  least this far up the plane. */
const GAP_EYE_D = 0.6;
const GAP_RISE = 0.15;
/** WHILE THE SPRING MOVES, measured gap minus predicted (m). Measured -6.3 to -0.4 mm over chop 1's 60 frames: each
 *  face is drawn fat by the march's accept footprint (3.3 mm at 0.6 m) and the run is whole texels (2.2 mm), so the
 *  measure reads short by up to 2 x 3.3 + 2 x 2.2 = 11 mm and never long by more than a texel. */
const GAP_UNDER = 0.011;
const GAP_OVER = 0.003;
/** AT REST, the same (m). Measured -1.5 (S), +0.5 (T), -0.6 and +2.4 (W, on two zombies of the ring), -0.6 and +1.4 mm
 *  (K).
 *  Long by up to GAP_OVER, as while it moves: a sample inside a half still counts as seen until its surface is
 *  GAP_FRONT in front of it along the sight line, and from the wedge eye that line grazes the cut face. At the full
 *  angle, where chop 2 and the kill rest, that is 1.0 mm a side (0.5 mm at 0.3 rad), on top of the 1 mm sampling
 *  step. */
const GAP_REST_UNDER = 0.004;
const GAP_REST_OVER = GAP_OVER;
/** "At rest" for the settle frame (m): one step of the measure, three texels at the wedge eye. */
const GAP_SETTLED = 0.0065;
// ---- S. The expectations come from the angles the CPU's spring took on the same frames (s.frames), so a retuned
// spring moves them with it; the spring's own shape is head-split.test.ts's.
/** The measured peak frame against the predicted one (frames). Measured: the same frame (4). Held only while the
 *  predicted peak is at least S_OVERSHOOT_MIN over its rest value: a spring tuned not to overshoot has no peak frame. */
const S_PEAK_FRAMES = 1;
const S_OVERSHOOT_MIN = 0.05;
/** The measured overshoot ratio (peak / rest) against the predicted one. Measured 1.216 against 1.334: the peak frame
 *  reads 4.9 mm short (GAP_UNDER), which is 0.13 of the 37 mm rest gap; one step of the measure more is 0.18. */
const S_OVERSHOOT_TOL = 0.18;
/** The measured settle frame against the predicted one, later by at most this (frames). Measured: the same (5). */
const S_SETTLE_FRAMES = 3;
/** A landmark's depth tolerance along the sight line (m): S's nose and F's cut-face point. A fold or a gap moves
 *  them by 5 cm and more. */
const DEPTH_TOL = 0.012;
/** S's instrument check: no surface this far in front of the closed nose (m). */
const NOSE_CLEAR = 0.05;
// ---- W.
/** Chop 2's widening as a share of the predicted one. Measured 18.0 of 19.1 mm (0.94). */
const W_WIDER_SHARE = 0.75;
// ---- K.
/** Frames the corpse is left to fall before the split is read again. */
const K_LATER = 45;
/** The kill's kick, 3 frames on: the halves stand past the full angle by at least this share of AXE_HEAD.killKick x
 *  the full angle. Measured 0.64: the spring's peak is on frame 2, and it is on its way back. */
const K_KICK_SHARE = 0.5;
/** The kick is followed this many frames on the frozen body, before the thaw that kills. The frame the flesh stands
 *  lowest on the swing back (measured frame 6) must be under the full angle by at least K_DIP_SHARE of the kick.
 *  Measured 0.29 (28.7 degrees against 31.5). */
const K_SWING = 12;
const K_DIP_SHARE = 0.15;
// ---- O.
/** The chop's bearing round to the head's right (rad): the hit lands 33.7 mm off centre (one side from 13.5 mm). */
const O_BEARING = 0.5;
/** Each half starts this far beyond the plane on its own side (m), and both are counted within O_DISC of the centre. */
const O_CLEAR = 0.01;
const O_DISC = 0.12;
/** A texel's surface moved: its depth along the view differs by more than this (m). Measured largest on the still
 *  half: 0.0 mm; on the struck half 186 mm. */
const O_DEPTH = 0.001;
/** A texel's light changed: a colour channel differs by more than this. The instrument's floor is 0
 *  (FLOOR_COLOUR_MAX), so this is no noise bound: it is 1% of full scale, a step one can see. */
const O_COLOUR = 0.01;
/** The still half must be at least this many texels (measured 4520). */
const O_MIN_TEXELS = 1000;
/** Still-half texels that may differ in hit or depth from the same head closed. Measured 0. */
const O_STILL_MOVED = 0;
/** The share of still-half texels whose light may change. Measured 0.042: the open gap's shadow and occlusion. */
const O_STILL_LIGHT = 0.1;
/** The share of the struck half's texels that must differ in hit or depth. Measured 0.98. */
const O_MOVED_MIN = 0.5;
// ---- L. The wound mask against its crater, as docs/dev-notes/2026-10-04-head-split/NOTES.md B6 (b) measured it.
/** Where the two wounds go: the closed head's skin along these head-local directions from the skull centre (x right,
 *  y up, z out of the face). The rod cut on the + half's brow. The pellet high on the - half's side: its 5.5 cm crater
 *  holds no eye seat (8 cm off), stays clear of the face cut's band along the plane (where the mask is already full
 *  and cannot rise), and that skin still looks upward once the half has turned, so an eye can stand square on to it. */
const L_CUT_DIR = [0.38, 0.42, 0.82];
const L_PELLET_DIR = [-0.8, 0.6, 0.1];
/** The head's opening for both wounds, as a share of its full angle: the split's second stage (the wide crack). The
 *  directions above and the measured values below are this opening's. */
const L_OPEN = 0.8;
/** The eye for each wound: this far out from its place on the open head, square on (m). */
const L_EYE_D = 0.75;
/** The rod cut's half-length along the head's up (m). */
const L_CUT_HALF = 0.03;
/** The mask: texels whose green share rose by more than this (the tissue colours are painted green). B6's 0.06. */
const L_GREEN = 0.06;
/** A texel of the painted eye glow (HDR red, lit skin tops out near 1): not mask. */
const L_EYE_RED = 2;
/** The window about the wound's place on the open head, in wound radii: a crater's, a cut's (B6's 1.6 / 1.2), and at
 *  least L_WINDOW_MIN texels. */
const L_WINDOW_CRATER = 1.6;
const L_WINDOW_CUT = 1.2;
const L_WINDOW_MIN = 6;
/** The crater: texels whose surface went in by more than this (m). */
const L_DENT = 0.003;
/** The wound's stamped place against unwarpPoint of its hit (m). Measured 0.0 mm for both. */
const L_POS_TOL = 0.001;
/** Mask and crater must each have this many texels. */
const L_MIN_TEXELS = 15;
/** The mask's centroid against the crater's centroid (texels). Measured 1.14 and 1.20 (the rod cut), 1.03 and 0.51
 *  (the pellet) on two zombies of the ring; with the masks read at the world point 3.08 and 9.70. */
const L_CENTROID_TX = 1.5;
/** The share of the crater's texels the mask covers. Measured 0.62 to 0.67 (the rod cut: its lips are mask, not
 *  crater), 0.96 to 0.98 (the pellet). */
const L_CRATER_MASKED = 0.5;
// ---- F.
/** The nose must move at least this far with the face half (m). Measured 110.6 mm. */
const F_MOVED_MIN = 0.05;
/** The cut-face landmark: this far above the head centre on the old plane (m), seen from F_EYE_D away. */
const F_UP = 0.1;
const F_EYE_D = 0.9;
// ---- M.
/** The flesh's opening for the forced landmark, as a share of its full angle: no flesh half covers a seated eye. */
const M_THROWN = 1.8;
/** An eye's shift on screen against skullWarpPoint's (px), the eye seen whole (eyesAgainstRule: the bone and the
 *  flesh out of the frame). Measured on the anatomical skull: worst 0.41 px on the forced head, at the kill's bone
 *  angle, and 0.15 px after chop 1; on the sculpted skull 0.27 and 0.43 px. The bound is 1.3 mm at the head (an eye
 *  drawn a twentieth short of its turn reads 3 px at the kill's bone angle).
 *  With the bone drawn the same measure reads the part of each eye its socket leaves in sight, 0.36 to 0.53 of it,
 *  and comes out 6.84 px on the anatomical skull and 3.33 px on the sculpted one: the gate reports that, and does not
 *  hold it. */
const M_SHIFT_PX = 2;
/** The largest shift on the forced head must be at least this (px). Measured 58.2. */
const M_FAR_PX = 40;
/** The really chopped head's eyes must move at least this far at chop 1 (px). Measured 17.9: the copies' turn halved
 *  would leave each about 9 px short. */
const M_CHOP_PX = 10;
/** The drawn copies' turn (from their matrices) against the follow table's bone angle (rad). Measured 0 to 1e-9. */
const M_ANGLE_TOL = 1e-6;
/** The eye seats in the head frame (mesh-eyes.ts, the rest pose), by the sculpt the boot's bone cache carves the head
 *  with (skeletonDiagnostics().sculpt.shape): the first sculpt's, which the anatomical skull's eyes share, and the
 *  second's, whose orbits seat the eyes on the same line 1.0 mm further forward. */
const M_SEATS_BY_SHAPE = { 1: [[-0.0363, 0.0159, 0.0343], [0.0363, 0.0159, 0.0343]], 2: [[-0.0363, 0.0159, 0.0353], [0.0363, 0.0159, 0.0353]] };
const seatsHere = () => M_SEATS_BY_SHAPE[S.shape] ?? die(`no eye seats for sculpt shape ${S.shape}`);
/** THE BONE'S OWN PIXELS (boneOnScreen). Two marks on the brow, in the head frame as the seats are: 16 mm either side
 *  of the mid-plane, 77 mm above the head centre and 51 mm in front of it. On the anatomical skull as fitted to the
 *  zombie each is in the frontal bone, 1 cm under its outer surface, 2.5 times the fracture's largest offset from the
 *  plane (so each is its own half's whatever the head's pattern), and at the kill's bone angle its half carries it
 *  64 mm; the sculpted skull is the larger one and holds them too. */
const M_MARKS = [[-0.016, 0.0767, 0.0514], [0.016, 0.0767, 0.0514]];
/** A mark's disc on screen (px radius): all of it bone, or none of it. */
const M_MARK_R = 3;
/** A mark's turned place must be at least this far from its closed one on screen for "no bone left behind" to mean
 *  anything (px). Measured 101.6 px for both marks, on both skulls. */
const M_MARK_APART = 70;
/** The fracture's line on screen: points of the old plane from M_GAP_FROM to M_GAP_TO above the hinge (m), every
 *  M_GAP_STEP. On the anatomical skull a level ray meets bone at each of them closed (the maxilla, the nasal bone, the
 *  frontal up to 16 cm) and none of them open at the kill's bone angle. */
const M_GAP_FROM = 0.03, M_GAP_TO = 0.16, M_GAP_STEP = 0.005;
/** At least this share of the line's points are bone on the closed skull, and at most M_GAP_LEFT of those are still
 *  bone on the open one. Measured 25 of 27 on the anatomical skull (the other two look through its nose) and 27 of 27
 *  on the sculpted one; open, 0 on both. A copy drawn unclipped leaves every one of them bone. */
const M_GAP_BONE = 0.8;
const M_GAP_LEFT = 0.05;
// ---- P.
/** The plate the slug takes off the closed head, and the plate the pellets take off the open one: the two
 *  cheekbones. Each is wholly its own half's (their boxes start 33 mm and 24 mm from the plane), and small: turned
 *  with its half, the + one stands clear of the box it has on the closed head. */
const P_FIRST = "zygomatic-right";
const P_PLATE = "zygomatic-left";
/** Each ray starts this far in front of its plate's pivot (m) and runs into the face. On the skull as fitted to the
 *  zombie the bone is met 29.1 mm (the slug) and 31.9 mm (the pellets) along it; a round reaches 140 mm. */
const P_BACK = 0.04;
/** The pellets' line, taken as it stands into the closed head's frame, must run at least this clear of P_PLATE's box
 *  there (m), so that a test in the closed head's frame cannot release that plate. Measured 10.2 mm with the bone
 *  riding its flesh (follow 1, the scenario's). Worked out on the fitted skull, away from the game: 6.0 mm at the
 *  shipped table's angle, and 0 at half the flesh's. */
const P_CLEAR = 0.005;
/** The fragment's start against the pivot as the + half's copy draws it (m: a hundredth of a millimetre; the two are
 *  the same product of matrices, measured 0.0000 mm), and at least P_FAR from the closed head's pivot (measured
 *  36.9 mm). */
const P_AT = 1e-5;
const P_FAR = 0.02;
/** THE RELEASED PLATE ON SCREEN: the bone photographed before the pellets and after them (the fragment given P_FLY
 *  frames to leave the picture), compared in a disc of P_DISC px about the pivot's screen point as the + half's copy
 *  draws it, and about the closed head's. Where the plate was drawn at least P_GONE of the disc's pixels change;
 *  where the closed head has it at most P_SAME. Measured 0.97 and 0.00, the two points 59.0 px apart. */
const P_DISC = 8;
const P_FLY = 30;
const P_GONE = 0.8;
const P_SAME = 0.05;
/** THE SLUG THROUGH THE GAP. The plate it is laid at and the point of it, from the plate's pivot in the head
 *  segment's frame (m): the frontal bone, 16 mm to the + side and 20 mm up, on the + half's copy. On the skull as
 *  fitted to the zombie, with the flesh at the axe's first chop (25.2 degrees a half) and the bone at 7.6, a level
 *  line from the front through it meets the frontal on the + half and no flesh at all, as its neighbours 4 mm
 *  either side and 20 mm up and down do. */
const P_GAP_PLATE = "frontal";
const P_GAP_OFF = [0.016, 0.02, 0];
/** The slug starts this far in front of that point (m) and its line must be clear of the actor's flesh for P_GAP_RUN
 *  (m: two frames of a slug's flight), by the projectile loop's own trace. */
const P_GAP_BACK = 0.3;
const P_GAP_RUN = 1;
/** Frames the slug is given to cross the head. It meets the bone on its first. */
const P_GAP_FRAMES = 4;
/** The fragment's start (its place one frame back along its velocity) against the pivot as the + half's copy draws it
 *  (m: a hundredth of a millimetre, as P_AT). Measured 0.0000 mm. */
const P_GAP_AT = 1e-5;
// ---- R.
/** The draw distance from the live uniforms must be at least this (m; measured 12.67): nearer, a split would close
 *  at a range where the head is still tens of pixels across. */
const R_FAR_MIN = 4;
/** The stances stand this far inside and beyond the draw distance and the reopen distance (m). */
const R_STEP = 0.3;
/** The sheet's crop at range (screen px square; the head is about 20 px across there). */
const R_SHEET_CROP = 70;
/** Frames the drawn state must hold at each stance. */
const R_HOLD = 20;
/** The region's disc must hold at least this many hit texels at range (measured 94 to 120). */
const R_MIN_HITS = 20;
/** OPEN: the share of the disc's hit texels that differ from the closed head. Measured 0.165 and 0.175. */
const R_OPEN_SHARE = 0.1;
/** CLOSED: the same share, at most. Measured 0 and 0.027. */
const R_CLOSED_SHARE = 0.05;
// ---- A.
/** The axe gate's torso chop distance (m, eye to the torso centre). */
const A_CHOP_D = 0.9;
/** The hit is at least this far from the skull centre (m; measured 0.376), its cut within A_LAND_MAX of it (0.0). */
const A_OFF_HEAD = 0.3;
const A_LAND_MAX = 0.05;
/** An overhead's cut runs vertically: |dir.y| over this (measured 0.99). */
const A_VERTICAL = 0.8;
// ---- H.
/** The slug's head: open by this share of its full angle (the slug must meet a half near the closed head's prims,
 *  as the burst's own test needs), shot from H_SLUG_D, H_SLUG_OFF to the head's right; H_FRAMES for it to land. */
const H_SLUG_OPEN = 0.25;
const H_SLUG_D = 2;
const H_SLUG_OFF = 0.03;
const H_FRAMES = 20;
/** The flail's distance (m, eye to the head centre), and its head's opening as a share of the full angle (the split's
 *  first stage, the thin crack). */
const H_FLAIL_D = 1.0;
const H_FLAIL_OPEN = 0.55;
// ---- B.
/** The cameras: from the front at B_FRONT_D, and from above and behind (topCam). */
const B_FRONT_D = 0.6;
/** The field alone must hit at least this many texels in the region's disc (measured 13 444 to 32 201). */
const B_MIN_HITS = 500;
/** Clipped texels over the closed head's own count. Measured 0 / -1 / 13 / 0 / 3 / 17; the hull without its turned
 *  copies: 215 and 216. */
const B_MARGIN = 30;
/** Two depths are apart beyond this share, and such texels over the closed head's count. Measured at most +82 (the
 *  face from the front); the hull without its turned copies: +5395. */
const B_DEPTH = 2e-3;
const B_DEPTH_MARGIN = 150;
// ---- J.
/** Frames the frozen head is watched before the thaw and after it is at rest again. */
const J_STILL = 20;
/** THE SCRIPT: the mass point's acceleration on each tick, as [across the split (along n), up out of the hinge (along
 *  u)] in m/s^2, in the split's own frame (the gate turns it into world vectors on the pose's split).
 *    a walk, 60 ticks: the walking zombie's own measured motion, a bob of +-2 at 2.1 Hz and 1.9 across;
 *    four hard throws, 20 ticks each, at the clamp (accelClamp, taken from the live constants): across the split one
 *      way and the other (each half into one stop and then the other), then up and down (both halves together);
 *    a swing to end on, 24 ticks: 12 sin across and 5 up, which leaves the two halves at different angles. */
const J_THROW = 20;
const jScript = (clamp) => {
  const seq = [];
  for (let i = 0; i < 60; i++) seq.push([-1.9, 2 * Math.sin(2 * Math.PI * 2.1 * i / 60)]);
  for (const [s, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 0; i < J_THROW; i++) seq.push([s * clamp, b * clamp]);
  for (let i = 0; i < 24; i++) seq.push([12 * Math.sin(i * 0.35), 5]);
  return seq;
};
/** Frames the thawed cast is watched at the end, for the printed observation. */
const J_WANDER = 150;
/** Each half must swing at least this far off the spring's angle in the script's walk (rad: 2 degrees; measured 5.2
 *  and 6.0), and the two halves must stand at least J_APART apart at some frame of it (measured 3.4 degrees). */
const J_MOVED = 2 * Math.PI / 180;
const J_APART = 1 * Math.PI / 180;
/** The settle bound: the time the wobble's envelope takes from its limit (max x the angle) down to restA, x this. */
const J_REST_MARGIN = 1.25;
/** Slack on the limits (rad): the offsets are clamped in double precision. */
const J_EPS = 1e-12;
/** The eye for the drawn checks: this far in front of the hinge (m), inside the split's draw distance. */
const J_EYE_D = 2;
// ---- T.
/** The ring walks until a zombie stands this far round (|sin yaw|), within T_MAX_FRAMES. */
const T_SIN_MIN = 0.97;
const T_MAX_FRAMES = 900;
// ---- C.
/** Timing rounds per distance. */
const C_ROUNDS = 3;
/** A changed screen pixel (M's shown / hidden pair): any channel differs by more than this (of 255). */
const TH = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const results = [];
const fail = (msg) => { console.error(`FAIL: ${msg}`); results.push(`FAIL: ${msg}`); failures++; };
const pass = (msg) => { console.log(`PASS: ${msg}`); results.push(`PASS: ${msg}`); };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const note = (msg) => console.log(`  measure: ${msg}`);
/** A scenario or a boot cannot go on: thrown, and caught by its own block (threw), so the run reaches its summary. */
const die = (msg) => { throw new Error(msg); };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
mkdirSync(OUT, { recursive: true });
/** ONLY=K,T runs just those scenarios (iteration aid); unset runs them all, which is the gate. */
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (k) => !ONLY || ONLY.has(k);

// ---- A CDP session (a tab), one at a time ---------------------------------------------
let S = null;
const consoleEvents = [];
async function openSession(label) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), label, rect: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      consoleEvents.push({ label, type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
    }
    if (m.method === "Runtime.exceptionThrown") consoleEvents.push({ label, type: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  };
  s.send = (method, params = {}) => new Promise((resolve) => { const id = ++s.seq; s.pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  S = s;
  return s;
}
function closeSession(s) {
  try { s.ws.close(); } catch {}
  try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${s.tab.id}`], { stdio: "ignore" }); } catch {}
}
process.on("exit", () => { if (S) closeSession(S); });
const send = (m, p) => S.send(m, p);
const evaluate = async (expression, ms = 90000) => {
  const r = await withTimeout(S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// ---- PNG decode / encode ----------------------------------------------------------------
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
const px = (img, x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function encodePng(w, h, rgb) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** A w x h RGB crop of `img` centred on (cx, cy) (out-of-frame pixels black). */
function cropRgb(img, cx, cy, w, h) {
  const out = Buffer.alloc(w * h * 3); const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
    const c = px(img, sx, sy); const o = (y * w + x) * 3; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  }
  return out;
}

const ndcPx = (n) => [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h];
/** A screenshot of the frame as it stands: the sim locked (renderLock: a capture never advances a frame), drawn again,
 *  the GPU's work for it landed (resolveGpu) and the page's next two animation frames passed, so what is shot is
 *  this frame presented, however loaded the machine. */
async function capture() {
  await evaluate("__sdfGame.setRenderLock(true)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.resolveGpu()");
  await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  const s = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const buf = Buffer.from(s.result.data, "base64");
  return Object.assign(decodePng(buf), { buf });
}
// ---- Boot the bare ring page, frozen zombies -----------------------------------------------------------
let centre = [0, 0, 0], pool = [], usedZ = new Set(), spawn = null;
async function boot(label, extra = "") {
  const s = await openSession(label);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  s.t0 = Date.now();
  await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&vhs=off&loader=0${extra}` });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") die(`[${label}] backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") die(`[${label}] warm gate never reached ready`);
  await evaluate("__sdfGame.setLoopRunning(false)");
  // The dev panels (head-damage-gate's list) and the HUD's status line would sit over the photos.
  await evaluate(`(() => { for (const e of document.body.children) { if (!e.querySelector("canvas") && e.tagName !== "CANVAS" && /TUNING|DYNAMITE \\/ GIB|BLOOD \\+ GIB BLUR|Record \\[F8\\]|shells \\d+\\/\\d+/.test(e.innerText || "")) e.style.display = "none"; } return 1; })()`);
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  // No blood over the wounds (the photos judge the split and its shading), and free aim OFF so the DOM reticle is not
  // drawn over the head.
  await evaluate("__sdfGame.setBleed(false)");
  await evaluate("__sdfGame.setFreeAim(false)");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie");
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM);
  const room = (await evaluate("__sdfGame.rooms")).find((r) => r.id === ROOM);
  centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
  // The background gib / crowd compiles would confound the draw timings, and the shipped path draws the cast through
  // the crowd material (a ?crowd=0 boot has none): wait for them. The wait is as long as the wall clock makes it, so
  // the frames it draws are steps of NO sim time (step(1, 0)).
  let wb = null;
  const want = /crowd=0/.test(extra) ? ["gib"] : ["gib", "crowd"];
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (want.every((k) => wb[k] === "ready") || want.some((k) => wb[k] === "failed")) break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  if (!want.every((k) => wb?.[k] === "ready")) die(`[${label}] the background warm is ${JSON.stringify(wb)}`);
  // THE PINS, after everything whose length the wall clock sets (scripts/march-hash.mjs has the measurements behind
  // each): without them the lit march target of one scene differs from boot to boot.
  //   the dynamic-light clock: every sim step advances it, so it stands wherever boot and the waits left it, and the
  //     lamps, the room fill and the body key read it. Frozen, and set to 0.
  //   the room probes' afterglow: a temporal filter whose state is the number of frames drawn. Blend and fall 1.
  //   the field interlace: its parity is a private frame counter's. Off.
  //   the render-side subsampling clocks (the gather's frame seed): held.
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.setFieldStyle("off"); return 1; })()`);
  for (let i = 0; i < BOOT_SETTLE; i++) await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.installDebugProbe()");
  usedZ = new Set();
  // Where the page stands the player: rooms away from the ring, out of its sight (J's walk is from here).
  spawn = await evaluate("__sdfGame.pose()");
  // The skull this boot draws: the sculpted one in a variant (the default: `full`; also what a page that asked for
  // the plates falls back to when their asset does not load), or the anatomical plates (?skull=anatomical). And the
  // sculpt its bone cache carves a head with, which seats the eyes.
  const sd = await evaluate("__sdfGame.skeletonDiagnostics()");
  s.skull = sd.skull; s.variant = sd.sculptVariant; s.shape = sd.sculpt.shape; s.paint = sd.sculpt.paint;
  out.skulls[label] = s.skull === "anatomical" ? "anatomical" : `sculpt ${s.variant}`;
  console.log(`[${label}] ready; room ${ROOM} (${pool.length} zombies); skull ${out.skulls[label]} (recipe ${JSON.stringify(sd.sculpt)}); warm ${JSON.stringify(wb)}`);
  console.log(`[${label}] pool yaws (deg): ${pool.map((z) => `${z.id}:${(z.yaw * 180 / Math.PI).toFixed(1)}`).join(" ")}`);
}
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
function fresh() { const z = pool.find((q) => !usedZ.has(q.id)); if (!z) die("ran out of fresh zombies"); usedZ.add(z.id); return z; }
const J = (v) => JSON.stringify(v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
/** The body's FRONT (horizontal unit): its head frame's forward (head-damage-gate's fwdOf). Frozen zombies stand square. */
const frontOf = async (id) => { const fr = await evaluate(`__sdfGame.head.frame(${id})`); const f = qRot(fr.quat, [0, 0, 1]); return unit([f[0], 0, f[2]]); };
const headOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "head")`);
const woundsOf = (id) => evaluate(`__sdfGame.actorWounds(${id})`);
const eye = async () => { const p = await evaluate("__sdfGame.pose()"); return [p.pos[0], p.pos[1] + EYE_H, p.pos[2]]; };
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? ndcPx(n) : null; };
/** The body's surface along a ray (sphere-traced on the CPU body field, the one shots and cuts trace). */
const surfHit = (id, o, d, maxT = 4) => evaluate(`(() => { const o = ${J(o)}, d = ${J(d)}; let t = 0;
  for (let i = 0; i < 600 && t < ${maxT}; i++) { const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const s = __sdfGame.head.surfaceAt(${id}, p[0], p[1], p[2]); if (s < 2e-4) return p; t += Math.max(s * 0.8, 3e-4); } return null; })()`);
/** Nudge the view until world point `t` sits at the screen centre (head-damage-gate's centreOn). */
async function centreOn(t, iters = 10) {
  let n = null;
  for (let i = 0; i < iters; i++) {
    n = await evaluate(`__sdfGame.flail.toScreen(${t[0]}, ${t[1]}, ${t[2]})`);
    if (!n || (Math.abs(n[0]) < 0.01 && Math.abs(n[1]) < 0.01)) break;
    const pp = await evaluate("__sdfGame.pose()");
    await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw + 0.45 * n[0]}, ${pp.pitch + 0.45 * n[1]}, ${pp.pos[1]})`);
    await stepOne();
  }
  return n;
}
/** The view stance: horizontally along `from` (default: toward the room centre) from `target`, the eye `dist` m from it
 *  (3D), looking at it (the eye stays at standing height, so a torso is seen from above).
 *  Returns the view basis: `right` (horizontal) and `up` (world). */
async function look(target, dist, from = null) {
  const ax = from ? from[0] : centre[0] - target[0], az = from ? from[2] : centre[2] - target[2], l = Math.hypot(ax, az) || 1;
  const fx = ax / l, fz = az / l;
  const dy = EYE_H - target[1];
  const hz = Math.sqrt(Math.max(dist * dist - dy * dy, 0.09));
  await evaluate(`__sdfGame.placePlayer({ x: ${target[0] + fx * hz}, z: ${target[2] + fz * hz}, yaw: ${yawOf(-fx, -fz)}, pitch: ${Math.atan2(-dy, hz)} })`);
  await stepOne();
  await centreOn(target);
  const pp = await evaluate("__sdfGame.pose()");
  return { right: [Math.cos(pp.yaw), 0, Math.sin(pp.yaw)], up: [0, 1, 0], back: [fx, 0, fz], pose: pp };
}
/** A CONTACT SHEET for the notes: one tile per `tiles` entry ({ img, c: [x, y] px }), each a `crop` px square about c
 *  drawn SHEET_TILE px square (a 2 x 2 box when halved, the nearest pixel otherwise), side by side in OUT/<name>.png. */
function sheet(name, tiles, crop = SHEET_CROP) {
  const T = SHEET_TILE, w = T * tiles.length, rgb = Buffer.alloc(w * T * 3), k = crop / T, box = k === 2 ? [0, 1] : [0];
  tiles.forEach((t, n) => {
    const src = cropRgb(t.img, t.c[0], t.c[1], crop, crop);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) for (let ch = 0; ch < 3; ch++) {
      let v = 0;
      for (const dy of box) for (const dx of box) v += src[(Math.min(crop - 1, Math.floor(y * k) + dy) * crop + Math.min(crop - 1, Math.floor(x * k) + dx)) * 3 + ch];
      rgb[(y * w + n * T + x) * 3 + ch] = v / (box.length * box.length);
    }
  });
  writeFileSync(`${OUT}/${name}.png`, encodePng(w, T, rgb)); console.log(`  sheet ${OUT}/${name}.png (${tiles.length} tiles)`);
}
const diffPx = (a, b, x, y) => { const p = px(a, x, y), q = px(b, x, y); return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])); };
/** Pixels of screenshot `a` that differ from `b` by more than TH, inside the disc (c, R): a mask over the frame. */
function diffMask(a, b, c, R) {
  const m = new Uint8Array(a.w * a.h);
  for (let y = Math.max(0, Math.floor(c[1] - R)); y <= Math.min(a.h - 1, Math.ceil(c[1] + R)); y++) for (let x = Math.max(0, Math.floor(c[0] - R)); x <= Math.min(a.w - 1, Math.ceil(c[0] + R)); x++)
    if ((x - c[0]) ** 2 + (y - c[1]) ** 2 <= R * R && diffPx(a, b, x, y) > TH) m[y * a.w + x] = 1;
  return { m, w: a.w, h: a.h };
}
/** The mask's connected blobs (4-neighbour) of at least `minN` pixels: [{ n, cx, cy }], largest first. */
function blobs(mask, minN = 12) {
  const m = Uint8Array.from(mask.m), res = [];
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== 1) continue;
    let n = 0, sx = 0, sy = 0; const st = [i]; m[i] = 2;
    while (st.length) { const k = st.pop(), x = k % mask.w, y = (k / mask.w) | 0; n++; sx += x + 0.5; sy += y + 0.5;
      for (const j of [k - 1, k + 1, k - mask.w, k + mask.w]) { if (j < 0 || j >= m.length || m[j] !== 1 || Math.abs((j % mask.w) - x) > 1) continue; m[j] = 2; st.push(j); } }
    if (n >= minN) res.push({ n, cx: sx / n, cy: sy / n });
  }
  return res.sort((a, b) => b.n - a.n);
}
const timeDraws = () => evaluate("__sdfGame.timeDraws(120)", 300000);

const out = { skulls: {}, wall: {} };
/** An exception inside a scenario (or a boot) is that scenario's failed check: the others still run. */
async function threw(what, e) {
  fail(`${what}: stopped by an exception, its remaining checks did not run (${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 300)})`);
  try { await evaluate("__sdfGame.setRenderLock(false)", 5000); } catch { /* the page may be gone */ }
}
const actorPhase = async (id) => (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id)?.phase;
const meterOf = async (id) => (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id)?.meter;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mm = (v) => (1000 * v).toFixed(1);
const HS = `await import("/src/lab/sdf-zombie/head-split.ts")`, VA = `await import("/src/lab/sdf-zombie/validate.ts")`;
const setCam = (pp) => evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw}, ${pp.pitch}, ${pp.pos[1]})`);
/** Re-render `n` times without stepping the sim (the shadow maps and the temporal passes trail a camera move). */
const settle = async (n = SETTLE) => { await evaluate("__sdfGame.setRenderLock(true)"); for (let i = 0; i < n; i++) await stepOne(); await evaluate("__sdfGame.setRenderLock(false)"); };
/** The player's eye at world point `e`, looking at `t`. The camera takes the pose at the next step (syncCam, or a
 *  frame of the sim). An eye above standing height falls with the sim, so it is set again before every frame; one
 *  below it is not possible (the player is held on the floor). */
async function camAt(e, t) {
  if (e[1] < EYE_H - 2e-3) die(`camAt: an eye at height ${e[1].toFixed(3)} m is under the standing eye (${EYE_H} m)`);
  const d = sub(t, e);
  await evaluate(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${yawOf(d[0], d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, ${Math.max(0, e[1] - EYE_H)})`);
}
/** The camera onto the player's pose without advancing anything: a step of no time. */
const syncCam = () => evaluate("__sdfGame.step(1, 0)");
/** THE FLOAT MARCH TARGET (400 x 300 here; the SDF bodies only, before the lens and the post FX): rgb = the lit
 *  colour, a = clip depth. `miss` is the clear value's depth (the top-left corner is never a body in these views).
 *  A capture is TWO reads: readMarchTarget draws a frame of its own before it reads, and back-to-back reads cycle
 *  with period 2 (scripts/march-hash.mjs), so a pair keeps every capture on the same phase. The second is the
 *  capture; what the two differ by is the instrument's floor, kept per capture (`floor`) and, for captures of a
 *  SETTLED frame, over the run (FLOOR). A frame read while the spring moves is not settled (`settled` false): the
 *  shadow maps trail it, and its two reads differ by up to 0.015. */
const FLOOR = { captures: 0, colour: 0, depth: 0 };
/** THE DEPTH GUARD, on every capture (readF): each body texel, placed in the world by its depth, lies in front of the
 *  camera and inside some actor's proxy box or gib chunk's sphere, and no run of texels shares the world origin's
 *  depth to the bit (scripts/lib/march-depth-guard.mjs has the rule, its positive control, and the fault it was built
 *  on). The run's totals; `worst` is the first failing capture's first bad texel. */
const DEPTH = depthGuardTotals();
async function depthGuard(t) { const g = await evaluate(DEPTH_GUARD_PROBE); return depthGuardAdd(DEPTH, depthGuardTexels(t, g), g); }
const readOnce = async () => { const r = await evaluate("__sdfGameDebug.readMarchTarget()", 120000); return { w: r.w, h: r.h, f: new Float32Array(Uint8Array.from(Buffer.from(r.rgba32f, "base64")).buffer) }; };
async function readF(settled = true) {
  const a = await readOnce(), t = await readOnce();
  let colour = 0, depth = 0;
  for (let i = 0; i < t.f.length; i += 4) {
    colour = Math.max(colour, Math.abs(t.f[i] - a.f[i]), Math.abs(t.f[i + 1] - a.f[i + 1]), Math.abs(t.f[i + 2] - a.f[i + 2]));
    depth = Math.max(depth, Math.abs(t.f[i + 3] - a.f[i + 3]));
  }
  if (settled) { FLOOR.captures++; FLOOR.colour = Math.max(FLOOR.colour, colour); FLOOR.depth = Math.max(FLOOR.depth, depth); }
  Object.assign(t, { miss: t.f[3], floor: { colour, depth } });
  t.depthBad = await depthGuard(t);
  return t;
}
const hitAt = (t, i) => t.f[i * 4 + 3] !== t.miss;
/** A world point on the march target: [texel x, texel y, clip depth] (screenPosOf is the camera's own projection;
 *  flail.toScreen is lens-mapped, right for screenshots only), null behind the camera. */
const txOf = async (p, t) => { const n = await evaluate(`__sdfGame.screenPosOf(${p[0]}, ${p[1]}, ${p[2]})`); return n && n.z <= 1 ? [(n.x + 1) / 2 * t.w, (1 - n.y) / 2 * t.h, n.z] : null; };
const stateOf = (id) => evaluate(`__sdfGame.headSplit(${id})`);
/** The split on the pose (world; every strike and trace reads it), and the split the view DRAWS (null when closed for range). */
const splitOf = (id) => evaluate(`(() => { const s = __sdfGame.zombie(${id}).posed().split; return s ? JSON.parse(JSON.stringify(s)) : null; })()`);
const drawnOf = (id) => evaluate(`(() => { const s = __sdfGame.zombie(${id}).view.splitDrawn; return s ? { thetaP: s.thetaP, thetaM: s.thetaM } : null; })()`);
/** Any slot of the actor's GPU record with an open split (a unit plane normal in lane 17 of 21 vec4s). */
const recordOpen = (id) => evaluate(`(() => { const r = __sdfGame.zombie(${id}).view.records.floats; for (let q = 0; q * 84 < r.length; q++) { if (Math.hypot(r[q * 84 + 68], r[q * 84 + 69], r[q * 84 + 70]) > 0.5) return true; } return false; })()`);
/** The skull: the bone angles head-split.ts gives the drawn split, the actor's split copies among the bone draws, and
 *  the materials its draws are on (`on`: the names, of its bone copies, its eye copies, and its bone and eyes drawn
 *  whole). */
const skullOf = (id) => evaluate(`(async () => { const H = ${HS}; const s = H.skullSplitOf(__sdfGame.zombie(${id}).view.splitDrawn, __sdfGame.skullSplit()?.follow ?? null);
  const d = __sdfGame.skullDrawn(${id}), names = (rows, eye) => [...new Set(rows.filter((c) => c.eye === eye).map((c) => c.material))].sort();
  return { angleP: s ? s.angleP : 0, angleM: s ? s.angleM : 0, bones: d ? d.copies.filter((c) => !c.eye).length : null, eyes: d ? d.copies.filter((c) => c.eye).length : null, draws: d ? d.draws : null,
    on: d ? { bones: names(d.copies, false), eyes: names(d.copies, true), wholeBones: names(d.whole, false), wholeEyes: names(d.whole, true) } : null }; })()`);
/** Actor `id`'s split bone copies: how many, how many of them are its head segment's own mesh, and the paints their
 *  materials draw (skullDrawn's `head` and `paint`). */
const copyPaints = (id) => evaluate(`(() => { const d = __sdfGame.skullDrawn(${id}), c = d ? d.copies.filter((q) => !q.eye) : []; return { copies: c.length, heads: c.filter((q) => q.head).length, paints: [...new Set(c.map((q) => q.paint))] }; })()`);
const frameOf = (id) => evaluate(`__sdfGame.head.frame(${id})`);
const warpOf = (id, q) => evaluate(`(async () => { const H = ${HS}; const r = H.warpPoint(__sdfGame.zombie(${id}).posed().split, ${J(q)}); return { p: r.p, piece: r.piece }; })()`);
const unwarpOf = (id, p) => evaluate(`(async () => { const H = ${HS}, V = ${VA}; const posed = __sdfGame.zombie(${id}).posed(); const r = H.unwarpPoint(posed.split, ${J(p)}, (q) => V.sdBodyClosed(q, posed)); return { q: r.q, piece: r.piece }; })()`);
const force = async (id, preset, sides, offset, frac) => { const ok = await evaluate(`__sdfGame.forceSplit(${id}, "${preset}", ${sides}, ${offset}, ${frac})`); await stepN(3); return ok; };
const chop = (id, side) => evaluate(`__sdfGame.axeChop(${id}, "${side}", "head")`);
/** A frozen actor never steps, and the kill (forceCollapse) is consumed in its step: thaw `n` frames, then freeze. */
const thaw = async (n) => { await evaluate("__sdfGame.freeze(false)"); await stepN(n); await evaluate("__sdfGame.freeze(true)"); };
/** The end of a boot: its GPU diagnostics, and the wall clock it took (reported, not gated). */
const diag = async (label) => { out.diag[label] = await evaluate("__sdfGame.gpuDiagnostics()"); out.wall[label] = +((Date.now() - S.t0) / 1000).toFixed(1); };

/** THE GAP LINE of a head with a centred `middle` split: a segment across the old plane, through the head centre's
 *  height plus GAP_LEVER: G0 on the plane, n across it, u up from the hinge, fwd out of the face. `lever` is G0's
 *  height above the hinge plane, so on a head opened by thetaP / thetaM the cut faces cross the segment at
 *  +lever x tan(thetaP) and -lever x tan(|thetaM|): the gap the CPU's split predicts there.
 *  From the pose's split when the head is open (the plane and hinge every strike reads, whatever the body is doing),
 *  from the head's own frame while it is closed; S checks that the two agree. */
async function gapLine(id) {
  const hinge = HEAD_SPLIT.presets.middle.hingeBoth, w = await splitOf(id);
  let n, u, G0;
  if (w) { n = w.n; u = cross(w.n, w.a); G0 = add(w.h, add(mul(u, GAP_LEVER - hinge[1]), mul(cross(n, u), -hinge[2]))); }
  else { const fr = await frameOf(id); n = qRot(fr.quat, [1, 0, 0]); u = qRot(fr.quat, [0, 1, 0]); G0 = add(fr.centre, mul(u, GAP_LEVER)); }
  return { G0, n, u, fwd: cross(n, u), lever: GAP_LEVER - hinge[1], open: !!w };
}
/** An eye IN THE WEDGE of the line's split, however the head lies: on the old plane, GAP_EYE_D out from the gap line
 *  level along the plane (to the face's side: the player cannot stand inside the body) and up the plane's steepest
 *  line by GAP_RISE, or by what it takes to reach the player's standing eye height. It must be above the hinge plane. */
function wedgeEye(line) {
  const k = line.n[1], e1 = unit([-k * line.n[0], 1 - k * line.n[1], -k * line.n[2]]);
  let e2 = unit(cross(line.n, e1));
  if (dot(e2, line.fwd) < 0) e2 = mul(e2, -1);
  const rise = Math.max(GAP_RISE, (EYE_H + 0.01 - line.G0[1]) / Math.max(e1[1], 1e-6));
  const eyeAt = add(line.G0, add(mul(e2, GAP_EYE_D), mul(e1, rise)));
  if (e1[1] < 0.2 || rise > 3 || dot(line.u, sub(eyeAt, line.G0)) + line.lever <= 0) die(`wedgeEye: no eye in the wedge above the floor (the plane's rise ${e1[1].toFixed(2)}, ${rise.toFixed(2)} m up it)`);
  return eyeAt;
}
const gapPredicted = (line, thetaP, thetaM) => line.lever * (Math.tan(thetaP) + Math.tan(Math.abs(thetaM)));
/** THE GAP on the march target `t` (metres): the run of points of the gap line, about its middle, that the camera
 *  SEES: the texel under the point is a miss, or its surface is not more than GAP_FRONT in front of the point. A
 *  point inside a half has the half's skin in front of it. The eye must stand in the wedge (wedgeEye), where every
 *  sight line to the segment stays between the two cut faces. 0 on a closed head. */
async function gapRead(line, t) {
  const pts = await evaluate(`(() => { const G = ${J(line.G0)}, n = ${J(line.n)}, c = __sdfGame.cameraWorld(), out = [];
    for (let k = -${GAP_HALF_N}; k <= ${GAP_HALF_N}; k++) { const s = k * ${GAP_STEP}, p = [G[0] + n[0] * s, G[1] + n[1] * s, G[2] + n[2] * s];
      const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(v[0], v[1], v[2]) / ${GAP_FRONT};
      const a = __sdfGame.screenPosOf(p[0], p[1], p[2]), b = __sdfGame.screenPosOf(p[0] - v[0] / l, p[1] - v[1] / l, p[2] - v[2] / l); out.push([a.x, a.y, a.z, b.z]); }
    return out; })()`);
  const seen = pts.map(([x, y, za, zb]) => {
    const tx = Math.floor((x + 1) / 2 * t.w), ty = Math.floor((1 - y) / 2 * t.h);
    if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return false;
    const a = t.f[(ty * t.w + tx) * 4 + 3];
    // zb is the depth GAP_FRONT nearer the eye than the point: seen unless the surface is nearer still.
    return a === t.miss || (a - zb) * Math.sign(za - zb) >= 0;
  });
  // The run about the middle: from the seen sample nearest the plane (within 1 cm of it), out both ways.
  let mid = -1;
  for (let k = 0; k <= 10 && mid < 0; k++) { if (seen[GAP_HALF_N + k]) mid = GAP_HALF_N + k; else if (seen[GAP_HALF_N - k]) mid = GAP_HALF_N - k; }
  if (mid < 0) return 0;
  let lo = mid, hi = mid;
  while (lo > 0 && seen[lo - 1]) lo--;
  while (hi < seen.length - 1 && seen[hi + 1]) hi++;
  return (hi - lo + 1) * GAP_STEP;
}
/** The march target's clip depth as a distance along the view axis (m), for the camera as it stands: the projection
 *  is depth = A - B / distance, read off two points down the axis. */
async function depthToDistance() {
  const [z1, z2] = await evaluate(`(() => { const a = __sdfGame.screenRayToWorld(0, 0, 0.5), b = __sdfGame.screenRayToWorld(0, 0, 2); return [__sdfGame.screenPosOf(a[0], a[1], a[2]).z, __sdfGame.screenPosOf(b[0], b[1], b[2]).z]; })()`);
  const B = (z2 - z1) / (1 / 0.5 - 1 / 2), A = z1 + B / 0.5;
  return (z) => B / (A - z);
}
/** THE MARCH'S SURFACE AT A WORLD POINT: the texel under `p` holds a surface within `tol` m of p along the sight line
 *  (its clip depth between those of p - tol and p + tol). */
async function surfaceAtPoint(p, t, tol) {
  const r = await evaluate(`(() => { const p = ${J(p)}, c = __sdfGame.cameraWorld(); const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(v[0], v[1], v[2]) / ${tol};
    const P = (k) => __sdfGame.screenPosOf(p[0] + k * v[0] / l, p[1] + k * v[1] / l, p[2] + k * v[2] / l); const a = P(0); return [a.x, a.y, P(-1).z, P(1).z]; })()`);
  const tx = Math.floor((r[0] + 1) / 2 * t.w), ty = Math.floor((1 - r[1]) / 2 * t.h);
  if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return false;
  const a = t.f[(ty * t.w + tx) * 4 + 3];
  return a !== t.miss && (a - r[2]) * (a - r[3]) <= 0;
}
/** One head chop through the axeChop seam with its spring followed to rest: SPRING_FRAMES frames (1 s: play's
 *  strikes are at least 0.6 s apart, axe-swing.ts), the gap read each frame from `eyeW` (in the wedge; set again before
 *  every frame: above standing height the player falls with the sim). Frames in `photoAt` are photographed from
 *  the standing pose `photoCam`. `gap` false: the same chop and the same frames with no gap read (the skull's own
 *  boot, chopsForSkull: a read draws a frame and steps nothing, so the head is where a reading boot leaves it). */
async function chopAndFollow(id, side, line, eyeW, photoCam = null, photoAt = [], gap = true) {
  const n = await chop(id, side);
  const frames = [], photos = [];
  for (let i = 1; i <= SPRING_FRAMES; i++) {
    await camAt(eyeW, line.G0); await stepOne();
    const st = await stateOf(id);
    frames.push({ i, angle: st ? st.angle : 0, gap: gap ? await gapRead(line, await readF(false)) : null });
    if (photoCam && photoAt.includes(i)) { await setCam(photoCam); await syncCam(); photos.push(await capture()); }
  }
  return { n, frames, photos, state: await stateOf(id) };
}
/** Stand the eye at `eye` looking at `at`, let the frame settle without stepping the sim, and read the march target. */
async function readFrom(eye, at) { await camAt(eye, at); await syncCam(); await settle(); return readF(); }
/** A photo from the player pose `cam` (or from the eye `cam[0]` looking at `cam[1]`), nothing stepped. */
async function photo(cam) { if (Array.isArray(cam)) await camAt(cam[0], cam[1]); else await setCam(cam); await syncCam(); await settle(); return capture(); }
const headPx = async (id) => toPx(add((await frameOf(id)).centre, [0, 0.03, 0]));
const showSkeleton = (set) => evaluate(`__sdfGame.meshSkeletonShow(${J(set)})`);
/** THE SKULL'S SEATED EYES ON SCREEN, against head-split.ts. An eye's pixels are those that differ between the frame
 *  with the eyes drawn and the same frame without them, inside the screen disc (c, R); the two largest blobs, left to
 *  right. They are taken twice:
 *    `eyes`: with THE BONE AND THE FLESH OUT OF THE FRAME (meshSkeletonShow, hideFlesh): nothing stands in front of
 *      an eye, so the blob is the whole eye and its centroid the eye's centre on screen. The landmark. `whole`: its
 *      pixels; `bareBlobs`: how many blobs that pair differs in (2: nothing in the disc changes but the two eyes).
 *    `socket`: with the bone drawn, as the game draws it. An eye is a 38 mm ball seated in its socket, and the blob
 *      is the part the bone leaves in sight: a third to a half of it. That part's centroid is not the eye's centre,
 *      and the part is not the same one at every turn (0.53 of an eye on the closed anatomical skull, 0.45 at the
 *      kill's bone angle), so its centroid does not travel with the eye. It shows that the eye is seen in its socket,
 *      and how much of it (`seen`: its pixels).
 *  `pred`: where skullWarpPoint puts the seats `seats` (closed-head world points) for the skull split of the DRAWN
 *  split under `follow` (a share, or null: the follow table). `img`: the frame as the game draws it. `fleshOut`: the
 *  caller has taken the flesh out of the frame already, and puts it back. */
async function eyesAgainstRule(id, seats, follow, c, R, fleshOut = false) {
  await evaluate(`__sdfGame.skullSplit({ follow: ${J(follow)} })`); await stepN(2); await syncCam(); await settle();
  const pair = async () => {
    const shown = await capture(); await showSkeleton({ eyes: false }); const hidden = await capture(); await showSkeleton({ eyes: true });
    const all = blobs(diffMask(shown, hidden, c, R));
    return { shown, count: all.length, found: all.slice(0, 2).sort((p, q) => p.cx - q.cx) };
  };
  const drawn = await pair();
  // The bone out (and the flesh), then the frame left to settle: the post chain mixes each frame with the ones before
  // it (post-aa.ts, the smear), so what has just been hidden fades over the next few frames, and a pair taken at once
  // differs all over the fading skull (40 147 px of it, measured, against an eye's 3000).
  await showSkeleton({ bones: false });
  let bare;
  try { if (!fleshOut) await hideFlesh(id); await settle(); bare = await pair(); }
  finally { await showSkeleton({ bones: true }); if (!fleshOut) { await showFlesh(id); await stepN(2); await syncCam(); await settle(); } }
  const pred = [];
  for (const q of seats) pred.push(await toPx(await evaluate(`(async () => { const H = ${HS}; const s = H.skullSplitOf(__sdfGame.zombie(${id}).view.splitDrawn, ${J(follow)}); return s ? H.skullWarpPoint(s, ${J(q)}).p : ${J(q)}; })()`)));
  pred.sort((p, q) => p[0] - q[0]);
  return { img: drawn.shown, eyes: bare.found.map((e) => [e.cx, e.cy]), whole: bare.found.map((e) => e.n), bareBlobs: bare.count, socket: drawn.found.map((e) => [e.cx, e.cy]), seen: drawn.found.map((e) => e.n), pred, skull: await skullOf(id) };
}
/** How far each eye moved on screen from `base` to `now` against how far its seat's prediction moved: the worst
 *  difference (px), and the largest move (px). Infinity when an eye was not found. `at` picks the blobs: the whole
 *  eyes (the landmark), or `socket`, the parts seen with the bone drawn. */
function eyeShift(base, now, at = "eyes") {
  const a = base[at], b = now[at];
  if (a.length !== 2 || b.length !== 2) return { worst: Infinity, far: 0, rows: [] };
  const rows = [0, 1].map((k) => ({ movedPx: +d2(b[k], a[k]).toFixed(1), predictedPx: +d2(now.pred[k], base.pred[k]).toFixed(1),
    shiftErrPx: +Math.hypot((b[k][0] - a[k][0]) - (now.pred[k][0] - base.pred[k][0]), (b[k][1] - a[k][1]) - (now.pred[k][1] - base.pred[k][1])).toFixed(2) }));
  return { worst: Math.max(...rows.map((r) => r.shiftErrPx)), far: Math.max(...rows.map((r) => r.movedPx)), rows };
}
/** What the sockets do to the eyes of `now` (reported, not gated): the share of each whole eye's pixels left in sight
 *  with the bone drawn, and how far off the predicted shift from `base` the seen parts' centroids are (px). */
function inSockets(base, now) {
  const share = now.seen.length === 2 && now.whole.length === 2 ? [0, 1].map((k) => +(now.seen[k] / now.whole[k]).toFixed(2)) : null;
  return { seenShare: share, seenPx: now.seen, wholePx: now.whole, seenShiftErrPx: eyeShift(base, now, "socket").rows.map((r) => r.shiftErrPx) };
}
/** The turn (rad) between two drawn world matrices (column-major 4 x 4, as skullDrawn gives them): the rotation
 *  angle of a x b^-1's upper 3 x 3. */
function turnBetween(a, b) {
  const m = (q) => [[q[0], q[4], q[8]], [q[1], q[5], q[9]], [q[2], q[6], q[10]]], A = m(a), B = m(b);
  const det = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
  const inv = [0, 1, 2].map((i) => [0, 1, 2].map((j) => { const r = [0, 1, 2].filter((k) => k !== j), c = [0, 1, 2].filter((k) => k !== i);
    return ((i + j) % 2 ? -1 : 1) * (B[r[0]][c[0]] * B[r[1]][c[1]] - B[r[0]][c[1]] * B[r[1]][c[0]]) / det; }));
  let tr = 0; for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[i][k] * inv[k][i];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}
/** A point through a column-major 4 x 4 (as skullDrawn gives a draw's world matrix). */
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
/** The inverse of an affine column-major 4 x 4, as a map of points. */
function inverseOf(m) {
  const a = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]], t = [m[12], m[13], m[14]];
  const det = a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const inv = [0, 1, 2].map((i) => [0, 1, 2].map((j) => { const r = [0, 1, 2].filter((k) => k !== j), c = [0, 1, 2].filter((k) => k !== i);
    return ((i + j) % 2 ? -1 : 1) * (a[r[0]][c[0]] * a[r[1]][c[1]] - a[r[0]][c[1]] * a[r[1]][c[0]]) / det; }));
  return (p) => { const v = sub(p, t); return inv.map((row) => dot(row, v)); };
}
/** How clear of the box `min`..`max` the whole line o + t d runs (m; 0 = it enters the box): the least distance from
 *  the box over the line's points within 0.3 m of o, a quarter of a millimetre apart. */
function lineBoxGap(min, max, o, d) {
  let gap = Infinity;
  for (let i = -1200; i <= 1200; i++) { const q = add(o, mul(d, i * 0.00025)); gap = Math.min(gap, Math.hypot(...[0, 1, 2].map((k) => Math.max(min[k] - q[k], 0, q[k] - max[k])))); }
  return gap;
}
/** The bone's turn AS DRAWN: from the matrices of actor `id`'s split skull copies, each half's against the rest's;
 *  and the follow table's bone angle for the split's state: the table's share at the state's stage / full, of the
 *  spring's angle (`rule`) and of each half's own angle on the pose (`ruleP`, `ruleM`: the spring's and its wobble). */
async function boneDrawn(id) {
  const r = await evaluate(`(async () => { const H = ${HS}; const st = __sdfGame.headSplit(${id}), d = __sdfGame.skullDrawn(${id}), w = __sdfGame.zombie(${id}).posed().split;
    const k = st ? H.skullFollow(st.stage / H.splitMaxAngle(st)) : 0;
    return { copies: d ? d.copies.filter((c) => !c.eye) : [], rule: st ? st.angle * k : 0, ruleP: w ? w.thetaP * k : 0, ruleM: w ? -w.thetaM * k : 0 }; })()`);
  const rest = r.copies.find((c) => c.piece === 0), turn = (piece) => { const c = r.copies.find((q) => q.piece === piece); return rest && c ? turnBetween(c.matrix, rest.matrix) : null; };
  return { plus: turn(1), minus: turn(2), rule: r.rule, ruleP: r.ruleP, ruleM: r.ruleM, copies: r.copies.length };
}
/** The frames a wobble at its limit takes to be exactly at rest with nothing driving it, for a half whose spring
 *  stands at `angle`: its envelope's decay from max x angle to restA, with J_REST_MARGIN (head-split.ts
 *  HEAD_SPLIT.wobble). */
const wobbleRestFrames = (angle) => { const W = HEAD_SPLIT.wobble; return Math.ceil(J_REST_MARGIN * Math.log(W.max * angle / HEAD_SPLIT.restA) / (W.zeta * 2 * Math.PI * W.hz) * 60); };
const wobbleAtRest = (st) => !st || (st.wobP === 0 && st.wobVP === 0 && st.wobM === 0 && st.wobVM === 0);
/** Step the FROZEN cast until actor `id`'s halves are exactly at rest on its spring's angle: the frames it took (0
 *  when they already were: a body that has not moved, or the wobble off), -1 if not within wobbleRestFrames. */
async function restWobble(id) {
  let st = await stateOf(id);
  if (wobbleAtRest(st)) return 0;
  const bound = wobbleRestFrames(Math.max(st.angle, st.target));
  for (let i = 1; i <= bound; i++) { await stepOne(); st = await stateOf(id); if (wobbleAtRest(st)) return i; }
  return -1;
}
/** Take actor `id`'s FLESH out of the frame (its proxy box shrunk to nothing: no ray of the march enters it) and put
 *  it back. The skull meshes stay, and so does the split they are drawn from. Holds while the actor is not re-posed. */
const hideFlesh = (id) => evaluate(`(() => { const v = __sdfGame.zombie(${id}).view; window.__gateFlesh = { half: v.uniforms.bodyHalf.value.clone(), scale: v.object.scale.clone() };
  v.uniforms.bodyHalf.value.multiplyScalar(1e-4); v.object.scale.multiplyScalar(1e-4); v.syncRecord(); return 1; })()`);
const showFlesh = (id) => evaluate(`(() => { const v = __sdfGame.zombie(${id}).view, k = window.__gateFlesh; v.uniforms.bodyHalf.value.copy(k.half); v.object.scale.copy(k.scale); v.syncRecord(); return 1; })()`);
/** THE DRAWN BONE OF A REALLY CHOPPED HEAD AT REST: with the flesh out of the frame, each seated eye's shift from the
 *  whole skull (follow 0) to the follow table's split, against skullWarpPoint's (eyesAgainstRule: the eyes with the
 *  bone out of the frame too, and, reported, what the sockets leave of them). `cam` as photo() takes it. */
async function boneLandmark(id, cam) {
  const fr = await frameOf(id), seats = seatsHere().map((l) => add(fr.centre, qRot(fr.quat, l))), w = await splitOf(id);
  if (Array.isArray(cam)) await camAt(cam[0], cam[1]); else await setCam(cam);
  await syncCam(); await hideFlesh(id);
  try {
    const c = await toPx(w.h), R = d2(c, await toPx(add(w.h, [0, w.r, 0])));
    const base = await eyesAgainstRule(id, seats, 0, c, R, true), now = await eyesAgainstRule(id, seats, null, c, R, true);
    return { ...eyeShift(base, now), img: now.img, c, sockets: inSockets(base, now), seenBoth: base.socket.length === 2 && now.socket.length === 2, alone: base.bareBlobs === 2 && now.bareBlobs === 2 };
  } finally { await evaluate("__sdfGame.skullSplit({ follow: null })"); await showFlesh(id); await stepN(2); }
}
/** The share of a mask's pixels that are set within `r` px of the screen point `p`. */
function maskShare(mask, p, r) {
  let n = 0, on = 0;
  for (let y = Math.max(0, Math.floor(p[1] - r)); y <= Math.min(mask.h - 1, Math.ceil(p[1] + r)); y++) for (let x = Math.max(0, Math.floor(p[0] - r)); x <= Math.min(mask.w - 1, Math.ceil(p[0] + r)); x++)
    if ((x + 0.5 - p[0]) ** 2 + (y + 0.5 - p[1]) ** 2 <= r * r) { n++; on += mask.m[y * mask.w + x]; }
  return n ? on / n : 0;
}
/** THE BONE'S PIXELS in the screen disc (c, R), as the frame stands: those that differ between it and the same frame
 *  with the bone meshes hidden. The caller has the flesh and the eyes out of the frame. The frame is left to settle
 *  after each change (the post chain's smear, as eyesAgainstRule). `img`: the frame with the bone drawn. */
async function boneMask(c, R) {
  await syncCam(); await settle();
  const img = await capture();
  await showSkeleton({ bones: false });
  let hidden;
  try { await settle(); hidden = await capture(); } finally { await showSkeleton({ bones: true }); }
  return { img, mask: diffMask(img, hidden, c, R) };
}
/** THE SPLIT SKULL'S BONE ON SCREEN: DRAWN WHERE THE SPLIT PUTS IT, AND CLIPPED. Read off the bone's own pixels
 *  (boneMask), with the flesh and the eyes out of the frame, on the whole skull (follow 0) and with the bone turned by
 *  `follow` x the flesh's angle:
 *    the gap: the points of the old plane above the hinge (M_GAP_*). The closed skull's brow and nose run down that
 *      line. Open, each of them must be background: both halves have swung clear of the plane, and each copy is
 *      clipped to its own side of the fracture. A copy drawn unclipped leaves the whole skull standing there.
 *    the marks: M_MARKS, a point of each half's brow. Closed, bone at its screen point. Open, bone at the screen point
 *      of where skullWarpPoint puts it, and none at its closed one: the copy is drawn turned, and nothing of that half
 *      is left where the closed head has it.
 *  `w` the pose's split, `fr` the head frame, (c, R) the screen disc. Leaves the follow as the caller's to put back. */
async function boneOnScreen(id, fr, w, follow, c, R) {
  const marks = M_MARKS.map((l) => add(fr.centre, qRot(fr.quat, l))), u = cross(w.n, w.a), line = [];
  for (let t = M_GAP_FROM; t <= M_GAP_TO + 1e-9; t += M_GAP_STEP) line.push(add(w.h, mul(u, t)));
  await showSkeleton({ eyes: false }); await hideFlesh(id);
  try {
    const at = async (k) => { await evaluate(`__sdfGame.skullSplit({ follow: ${J(k)} })`); await stepN(2); return boneMask(c, R); };
    const closed = await at(0), open = await at(follow);
    // Where the rule puts each mark on the skull as it is drawn now: the fracture is this head's own (its id seeds it).
    const turned = await evaluate(`(async () => { const H = ${HS}, M = await import("/src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-split.ts");
      const s = H.skullSplitOf(__sdfGame.zombie(${id}).view.splitDrawn, ${J(follow)}, ${id});
      return ${J(marks)}.map((q) => { const r = H.skullWarpPoint(s, q, M.skullJagAt(s, q)); return { p: r.p, piece: r.piece }; }); })()`);
    const linePx = []; for (const q of line) linePx.push(await toPx(q));
    const wasBone = linePx.filter((p) => maskShare(closed.mask, p, 0.75) === 1), stillBone = wasBone.filter((p) => maskShare(open.mask, p, 0.75) > 0);
    const rows = [];
    for (let k = 0; k < marks.length; k++) {
      const a = await toPx(marks[k]), b = await toPx(turned[k].p);
      rows.push({ piece: turned[k].piece, movedPx: +d2(a, b).toFixed(1), closedAtClosed: +maskShare(closed.mask, a, M_MARK_R).toFixed(2),
        openAtTurned: +maskShare(open.mask, b, M_MARK_R).toFixed(2), openAtClosed: +maskShare(open.mask, a, M_MARK_R).toFixed(2) });
    }
    return { img: open.img, closedImg: closed.img, line: linePx.length, wasBone: wasBone.length, stillBone: stillBone.length, marks: rows };
  } finally { await showFlesh(id); await showSkeleton({ eyes: true }); await stepN(2); }
}
out.diag = {};
let HEAD_SPLIT = null, AXE_HEAD = null, MATS = null;
/** The live constants (the look pass retunes them: every prediction below is made from these, not from copies), and
 *  the bone materials' names (mesh-renderer.ts SEGMENT_MATERIALS). */
const loadRules = async () => {
  HEAD_SPLIT = await evaluate(`(async () => JSON.parse(JSON.stringify((${HS}).HEAD_SPLIT)))()`);
  AXE_HEAD = await evaluate(`(async () => JSON.parse(JSON.stringify((await import("/src/lab/sdf-zombie/webgpu/axe-head.ts")).AXE_HEAD)))()`);
  MATS = await evaluate(`(async () => ({ ...(await import("/src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.ts")).SEGMENT_MATERIALS }))()`);
};
const SCEN = { "mid-both": ["middle", 0, 0], "mid-one": ["middle", 1, 0.04], "face": ["face", 1, 0] };
/** From above and behind the head (b5's camera): 0.75 m behind, raised 0.45 m, pitched down. Shot under settle(). */
async function topCam(hc, f) {
  const v = await look(add(hc, [0, 0.05, 0]), 0.75, mul(f, -1));
  await evaluate(`__sdfGame.setPose(${v.pose.pos[0]}, ${v.pose.pos[2]}, ${v.pose.yaw}, ${v.pose.pitch - 0.55}, ${v.pose.pos[1] + 0.45})`);
  await stepOne(); await centreOn(add(hc, [0, 0.05, 0]));
  return evaluate("__sdfGame.pose()");
}
/** The region's disc on the march target: the hinge's texel and the region radius there. */
async function regionDisc(w, t) { const H = await txOf(w.h, t), R = await txOf(add(w.h, [0, w.r, 0]), t); return { c: H, R: d2(H, R) }; }
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
/** The materials the boot's skull is drawn on (mesh-renderer.ts SEGMENT_MATERIALS): its split copies', and whole. */
const skullMaterials = () => (S.skull === "anatomical" ? { split: MATS.plateSplit, whole: MATS.plate, whose: "the anatomical plates'" } : { split: MATS.boneSplit, whole: MATS.bone, whose: "the sculpted skull's" });
/** M (landmark, forced). The split skull on screen is head-split.ts's at ANY bone angle: each seated eye against
 *  skullWarpPoint, the bone's share set by hand to a small, a middle and a wide angle. The flesh is thrown open past
 *  its full angle so no flesh half covers a socket (a whole eye still reaches behind its flesh half: the landmark's
 *  frames have the flesh out, eyesAgainstRule). And the materials the copies are drawn on. (M's measures on really
 *  chopped heads are skullStageChecks.) `tag` labels the checks, `suffix` the sheet and the summary. */
async function skullLandmarkForced(tag, suffix = "") {
  const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
  const cam = (await look(hc, HEAD_D, f)).pose;
  const seats = seatsHere().map((l) => add(fr.centre, qRot(fr.quat, l)));
  const ok = await force(z.id, "middle", 0, 0, M_THROWN), w = await splitOf(z.id);
  // The bone angles the shipped table gives at its three stages (the thin crack, the wide crack, split wide), as
  // shares of this flesh angle.
  const MIDm = HEAD_SPLIT.presets.middle, fracs = HEAD_SPLIT.skull.follow.map((k) => k[0]);
  const angles = await evaluate(`(async () => { const H = ${HS}; return ${J(fracs)}.map((x) => x * ${MIDm.maxBoth} * H.skullFollow(x)); })()`);
  await setCam(cam); await stepN(SETTLE);
  const c = await toPx(w.h), R = d2(c, await toPx(add(w.h, [0, w.r, 0])));
  const base = await eyesAgainstRule(z.id, seats, 0, c, R), rows = [], tiles = [{ img: base.img, c }];
  for (const bone of angles) {
    const now = await eyesAgainstRule(z.id, seats, bone / w.thetaP, c, R);
    rows.push({ bone, ...eyeShift(base, now), copies: now.skull.bones, on: now.skull.on, paints: await copyPaints(z.id), sockets: inSockets(base, now), seenBoth: now.socket.length === 2, bareBlobs: now.bareBlobs }); tiles.push({ img: now.img, c });
  }
  // The bone's own pixels, on the whole skull and at the widest of the three angles (the kill's).
  let bone = null;
  try { bone = await boneOnScreen(z.id, fr, w, angles.at(-1) / w.thetaP, c, R); }
  finally { await evaluate("__sdfGame.skullSplit({ follow: null })"); await stepN(2); await syncCam(); await settle(); }
  out[`mBone${suffix}`] = { boneRad: +angles.at(-1).toFixed(4), linePoints: bone.line, boneClosed: bone.wasBone, stillBoneOpen: bone.stillBone, marks: bone.marks };
  out[`mLandmark${suffix}`] = rows.map((r) => ({ boneRad: +r.bone.toFixed(4), eyes: r.rows, sockets: r.sockets }));
  note(`${tag}: ${J(out[`mLandmark${suffix}`])}`);
  const worst = Math.max(...rows.map((r) => r.worst)), far = Math.max(...rows.map((r) => r.far));
  check(ok && base.bareBlobs === 2 && rows.every((r) => r.bareBlobs === 2) && base.socket.length === 2 && rows.every((r) => r.seenBoth) && base.skull.bones === 0 && rows.every((r) => r.copies === 3),
    `${tag}: both seated eyes found: alone with the bone and the flesh out of the frame (${[base.bareBlobs, ...rows.map((r) => r.bareBlobs)].join(", ")} blobs differ, 2 each time), and in their sockets with the bone drawn (${[base.seen, ...rows.map((r) => r.sockets.seenPx)].map((n) => n.join(" + ")).join(", ")} px seen of ${base.whole.join(" + ")}); the whole skull at follow 0 (${base.skull.bones} split copies), three copies when the bone turns (${rows.map((r) => r.copies).join(", ")})`);
  check(worst <= M_SHIFT_PX && far >= M_FAR_PX, `${tag}: each eye moves on screen as skullWarpPoint says (the bone and the flesh out of the frame): worst ${worst.toFixed(2)} px off its predicted shift (<= ${M_SHIFT_PX} px), the largest shift ${far.toFixed(1)} px (>= ${M_FAR_PX} px)`);
  note(`${tag}: (ungated) with the bone drawn, the part of each eye its socket leaves in sight is ${rows.map((r) => (r.sockets.seenShare ?? []).join(" / ")).join(", ")} of the eye at the three angles, and that part's centroid is ${rows.map((r) => r.sockets.seenShiftErrPx.join(" / ")).join(", ")} px off the same predicted shifts`);
  // The materials: the bone's copies on the split material of the skull this boot draws, the eyes' on the eyes'; and
  // whole (follow 0), on the closed ones. Only a head is ever drawn in copies; the actor's other bones, bare under
  // the face cuts' exposure, are drawn whole on the bone material beside it.
  const want = skullMaterials(), on = rows.map((r) => r.on), whole = base.skull.on;
  check(on.every((o) => o && same(o.bones, [want.split]) && same(o.eyes, [MATS.eyeSplit]) && (S.skull !== "anatomical" || !o.wholeBones.includes(MATS.plate)))
    && whole.bones.length === 0 && whole.wholeBones.includes(want.whole) && same(whole.wholeEyes, [MATS.eye]),
    `${tag}: the split head's bone copies are drawn on ${want.whose} split material and its eyes' on the eyes' at all three angles (${on.map((o) => o && `${o.bones.join("+")}, ${o.eyes.join("+")}`).join("; ")}); whole, at follow 0, on the closed ones (${whole.wholeBones.join("+")}, ${whole.wholeEyes.join("+")})`);
  // A sculpted skull's copies are the head's own mesh, under the paint the boot's recipe gives the zombie (the default:
  // the second; the first look: the first). An anatomical skull's are under neither.
  const wantPaint = S.skull === "anatomical" ? null : S.paint, paints = rows.map((r) => r.paints);
  check(paints.every((q) => q && q.heads === q.copies && q.copies === 3 && same(q.paints, [wantPaint])),
    `${tag}: every bone copy is the head's own mesh, drawn ${wantPaint === null ? "under neither of the sculpted skull's paints (the plates')" : `under the sculpted skull's paint ${wantPaint}`} at all three angles (${paints.map((q) => q && `${q.heads} of ${q.copies} the head, paint ${J(q.paints)}`).join("; ")})`);
  // The bone on screen: the gap is open along the fracture's line, and each half's brow is where the rule turns it.
  const apart = Math.min(...bone.marks.map((r) => r.movedPx));
  check(bone.wasBone >= M_GAP_BONE * bone.line && bone.stillBone <= M_GAP_LEFT * bone.wasBone
    && bone.marks.length === 2 && same(bone.marks.map((r) => r.piece).sort(), [1, 2]) && apart >= M_MARK_APART
    && bone.marks.every((r) => r.closedAtClosed === 1 && r.openAtTurned === 1 && r.openAtClosed === 0),
    `${tag}: the split skull's bone is on screen where the split puts it, and clipped (the flesh and the eyes out of the frame; bone pixels by a shown / hidden pair), at the kill's bone angle (${(angles.at(-1) * 180 / Math.PI).toFixed(1)} degrees a half): along the fracture's line above the hinge ${bone.wasBone} of ${bone.line} points are bone on the closed skull (>= ${M_GAP_BONE} of them) and ${bone.stillBone} of those are still bone on the open one (<= ${M_GAP_LEFT} of them); a mark on each half's brow is bone where skullWarpPoint turns it (${bone.marks.map((r) => r.openAtTurned).join(", ")} of its ${M_MARK_R} px disc; 1), ${bone.marks.map((r) => r.movedPx).join(" and ")} px from its closed place (>= ${M_MARK_APART} px), where the closed skull has bone (${bone.marks.map((r) => r.closedAtClosed).join(", ")}) and the open one none (${bone.marks.map((r) => r.openAtClosed).join(", ")}; 0)`);
  sheet(`M-skull${suffix}`, tiles);
  sheet(`M-bone${suffix}`, [{ img: bone.closedImg, c }, { img: bone.img, c }]);
}
/** M (really chopped). The skull at the three chops: a closed head draws the closed skull; at each stage the copies
 *  are DRAWN turned by the follow table's bone angle for the split's state (their matrices); and after chop 1 each
 *  seated eye is on screen where skullWarpPoint puts it (the flesh and the bone out of the frame). Chop 2 splits the
 *  bone wide on a head the first flinch has bowed, so that stage's landmark is the forced head's, upright, at the
 *  same bone angle. `m`: the closed skull, the skull and its drawn turn at the three stages (skullOf, boneDrawn), and
 *  chop 1's landmark (boneLandmark). */
function skullStageChecks(tag, suffix, m) {
  const { closedSkull, got, drawn, lm1 } = m, deg = (r) => (r * 180 / Math.PI).toFixed(2);
  out[`mStages${suffix}`] = { closed: closedSkull, stages: got, drawn, landmark: { worst: lm1.worst, far: lm1.far, rows: lm1.rows, sockets: lm1.sockets } };
  check(closedSkull.bones === 0 && closedSkull.eyes === 0 && closedSkull.draws > 0 && closedSkull.angleP === 0,
    `${tag}: a closed head draws the closed skull (${closedSkull.draws} bone draws for the actor, ${closedSkull.bones} split copies)`);
  const turnOff = Math.max(...drawn.flatMap((d) => [[d.plus, d.ruleP], [d.minus, d.ruleM]].map(([t, rule]) => (t === null ? Infinity : Math.abs(t - rule)))));
  check(turnOff <= M_ANGLE_TOL && drawn[0].rule > 0 && drawn[1].rule > drawn[0].rule && drawn[2].rule >= drawn[1].rule,
    `${tag}: the bone is drawn turned by the follow table's angle at each chop, wider at chop 2 and no narrower after the kill: its copies' matrices give ${drawn.map((d) => `${deg(d.plus)} / ${deg(d.minus)}`).join(", ")} degrees (+ / - half) against ${drawn.map((d) => deg(d.rule)).join(", ")} (worst ${turnOff.toExponential(1)} rad off <= ${M_ANGLE_TOL})`);
  check(got.every((g) => g.bones === 3 && g.eyes === 2), `${tag}: each stage draws the skull as three clipped copies and an eye a half (${got.map((g) => `${g.bones}+${g.eyes}`).join(", ")})`);
  note(`${tag}: really chopped, the eyes after chop 1: ${J(lm1.rows)}; (ungated) with the bone drawn their sockets leave ${(lm1.sockets.seenShare ?? []).join(" / ")} of each in sight, that part's centroid ${lm1.sockets.seenShiftErrPx.join(" / ")} px off the same shifts`);
  check(lm1.alone && lm1.seenBoth && lm1.worst <= M_SHIFT_PX && lm1.far >= M_CHOP_PX, `${tag}: on the really chopped head each seated eye is on screen where skullWarpPoint puts it (the bone and the flesh out of the frame, nothing but the two eyes differing: ${lm1.alone}; both seen in their sockets with the bone drawn: ${lm1.seenBoth}): worst ${lm1.worst.toFixed(2)} px off its shift after chop 1 (<= ${M_SHIFT_PX} px), which moves it ${lm1.far.toFixed(1)} px (>= ${M_CHOP_PX} px)`);
  sheet(`M-skull-chopped${suffix}`, [{ img: lm1.img, c: lm1.c }]);
}
/** P. THE PLATES OF A SPLIT ANATOMICAL SKULL, on a boot that draws it. LAST in its boot: its fragments stay in the
 *  room. */
async function platesScenario() {
  // The first rounds go through __sdfGame.skullShot: the renderer's own fractureSkull, which a pellet's or a
  // slug's impact calls first, with a ray the gate lays, and nothing else of a hit (no wound, no shove: the head
  // stays where the matrices were read). The last is a real projectile (__sdfGame.slugFrom).
  if (run("P")) try {
    const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
    const cam = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
    const px0 = await headPx(z.id);
    const plates = await evaluate(`__sdfGame.skullPlates(${z.id})`);
    if (!plates) die(`no anatomical plates on this head (the boot draws the ${S.skull} skull)`);
    const drawnNow = () => evaluate(`__sdfGame.skullDrawn(${z.id})`), stateNow = () => evaluate(`__sdfGame.skullState(${z.id})`);
    const shotAt = (o, d, kind) => evaluate(`__sdfGame.skullShot(${z.id}, ${J(o)}, ${J(d)}, "${kind}")`);
    const fragmentsOf = async (plate) => (await evaluate("__sdfGame.skullFragments()")).filter((q) => q.plate === plate);
    const plateOf = (name) => plates.find((q) => q.id === name) ?? die(`the skull has no plate ${name}`);
    /** The plates among an actor's bone draws, copies and whole. */
    const platesOf = (d) => [...new Set([...d.copies, ...d.whole].filter((q) => q.plate).map((q) => q.plate))].sort();
    const into = mul(qRot(fr.quat, [0, 0, 1]), -1), all = plates.map((q) => q.id);
    // The photos: the bone alone (the flesh out of the frame), from the front.
    const tiles = [];
    const bonePhoto = async () => { await setCam(cam); await syncCam(); await hideFlesh(z.id); try { await settle(); tiles.push({ img: await capture(), c: px0 }); } finally { await showFlesh(z.id); await stepN(2); } };
    // (1) A slug into the face at the CLOSED head's cheekbone, through its pivot: the closed head's own test.
    const d0 = await drawnNow(), skull0 = d0.whole.find((q) => !q.eye && q.material === MATS.plate);
    if (!skull0) die("the closed head's skull is not among the actor's draws");
    const first = plateOf(P_FIRST), at0 = xf(skull0.matrix, first.pivot);
    const released0 = await shotAt(sub(at0, mul(into, P_BACK)), into, "slug");
    await stepN(2);
    const st1 = await stateNow(), d1 = await drawnNow(), left1 = all.filter((n) => !st1.pieces.includes(n)).sort(), whole1 = d1.whole.filter((q) => q.plate);
    check(released0 === 1 && same(st1.pieces, [P_FIRST]) && d1.copies.length === 0 && same(platesOf(d1), left1) && whole1.length === left1.length && whole1.every((q) => q.material === MATS.plate),
      `P: a slug into the face at the closed head's ${P_FIRST} takes that plate off (released ${released0}, missing ${J(st1.pieces)}); the closed head is drawn as its ${left1.length} other plates, each whole on the plates' material (${whole1.length} draws, ${d1.copies.length} copies)`);
    await bonePhoto();
    // (2) The same head split: its surviving plates as clipped copies, nothing of the missing one, and no GPU error.
    const ok = await force(z.id, "middle", 0, 0, 1);
    await setCam(cam); await stepN(2);
    const open1 = await drawnNow(), copies = open1.copies.filter((q) => !q.eye), eyeCopies = open1.copies.filter((q) => q.eye), whole2 = open1.whole.filter((q) => q.plate);
    const perPiece = [0, 1, 2].map((k) => copies.filter((q) => q.piece === k).length);
    await bonePhoto();
    const gpu = await evaluate("__sdfGame.gpuDiagnostics()"), errsNow = consoleEvents.filter((e) => e.label === S.label && (e.type === "error" || e.type === "exception")).length;
    out.p = { missing: st1.pieces, drawnPlates: platesOf(open1), copies: copies.length, perPiece, wholePlates: whole2.length, gpu, consoleErrors: errsNow };
    check(ok && same(platesOf(open1), left1) && copies.every((q) => q.plate && q.material === MATS.plateSplit) && perPiece.every((n) => n > 0) && whole2.every((q) => q.material === MATS.plate)
      && eyeCopies.length === 2 && eyeCopies.every((q) => q.material === MATS.eyeSplit),
      `P: split with the plate missing, the head is drawn as its ${left1.length} surviving plates and nothing of ${P_FIRST}: ${platesOf(open1).length} plates in ${copies.length} clipped copies on the plates' split material (${perPiece.join(" / ")} of the rest, the + half, the - half) and ${whole2.length} whole; an eye a half on the eyes' split material (${eyeCopies.length})`);
    check(!!gpu && !gpu.lost && gpu.uncapturedCount === 0 && errsNow === 0, `P: the GPU reports no error drawing it (no device loss, uncapturedCount ${gpu?.uncapturedCount}; ${errsNow} console errors or exceptions in this boot so far)`);
    // (3) Three pellets at the + half's cheekbone WHERE IT IS DRAWN. The bone rides its flesh (follow 1, set by
    // hand): the widest a bone is drawn, whatever the follow table says, so the turn carries the plate clear of the
    // box it has on the closed head, and a test made in the closed head's frame could not release it.
    await evaluate("__sdfGame.skullSplit({ follow: 1 })");
    try {
      await stepN(2);
      await bonePhoto();
      const d3 = await drawnNow(), M = {};
      for (const q of d3.copies) if (!q.eye && !(q.piece in M)) M[q.piece] = q.matrix;
      if (!M[0] || !M[1]) die(`no copy of the rest or of the + half among the bone draws (pieces ${Object.keys(M).join(", ")})`);
      // The pivot as the + half's copy draws it, and as the closed head has it (the rest's copy is drawn with the
      // closed head's matrix); the pellets' line through the first, into the face.
      const pl = plateOf(P_PLATE), T = xf(M[1], pl.pivot), C = xf(M[0], pl.pivot), from = sub(T, mul(into, P_BACK));
      const toHead = inverseOf(M[0]), o = toHead(from), clear = lineBoxGap(pl.min, pl.max, o, unit(sub(toHead(add(from, into)), o)));
      const n0 = (await fragmentsOf(P_PLATE)).length, released = [];
      for (let k = 0; k < 3; k++) released.push(await shotAt(from, into, "pellet"));
      // No tick has passed: the fragment is where it was released.
      const frags = await fragmentsOf(P_PLATE), st3 = await stateNow(), frag = frags[n0] ?? null;
      const off = frag ? len(sub(frag.pos, T)) : Infinity, far = frag ? len(sub(frag.pos, C)) : 0;
      Object.assign(out.p, { clearMm: +mm(clear), released, missingAfter: st3.pieces, fragment: frag, fromDrawnPivotMm: +(1000 * off).toFixed(4), fromClosedPivotMm: +mm(far), drawnPivotFromClosedMm: +mm(len(sub(T, C))) });
      check(clear >= P_CLEAR && same(released, [0, 0, 1]) && same([...st3.pieces].sort(), [P_FIRST, P_PLATE].sort()),
        `P: three pellets into the face at the + half's ${P_PLATE} where it is drawn, ${mm(len(sub(T, C)))} mm from its place on the closed head, release that plate on the third (released ${released.join(", ")}; missing ${J(st3.pieces)}); taken as it stands into the closed head's frame their line runs ${mm(clear)} mm clear of that plate's box (>= ${mm(P_CLEAR)} mm: a test there could not release it)`);
      check(frags.length === n0 + 1 && off <= P_AT && far >= P_FAR,
        `P: its fragment starts at the pivot as the + half's copy draws it: ${(1000 * off).toFixed(4)} mm off (<= ${(1000 * P_AT).toFixed(2)} mm), ${mm(far)} mm from the closed head's pivot (>= ${mm(P_FAR)} mm); ${frags.length - n0} fragment of that plate`);
      await stepN(2);
      const d4 = await drawnNow(), left3 = all.filter((n) => !st3.pieces.includes(n)).sort(), copies4 = d4.copies.filter((q) => !q.eye);
      check(same(platesOf(d4), left3) && copies4.length > 0 && copies4.every((q) => q.material === MATS.plateSplit),
        `P: the open head is drawn on without it: its ${left3.length} surviving plates in ${copies4.length} clipped copies, nothing of ${P_PLATE}`);
      // (4) On screen: the frame changes where the plate was drawn, and not where the closed head has it. The
      // fragment is given P_FLY frames to leave the picture first.
      await stepN(P_FLY);
      await bonePhoto();
      const [before, after] = tiles.slice(-2).map((t) => t.img), pT = await toPx(T), pC = await toPx(C);
      const changed = (c) => maskShare(diffMask(before, after, c, P_DISC + 1), c, P_DISC);
      const gone = changed(pT), same0 = changed(pC), apartPx = d2(pT, pC);
      Object.assign(out.p, { changedAtDrawnPivot: +gone.toFixed(3), changedAtClosedPivot: +same0.toFixed(3), pivotsApartPx: +apartPx.toFixed(1) });
      check(gone >= P_GONE && same0 <= P_SAME && apartPx >= 2 * P_DISC,
        `P: on screen (the bone alone, before the pellets and ${P_FLY} frames after them) the frame changes where the plate was drawn and not where the closed head has it: ${gone.toFixed(2)} of the ${P_DISC} px disc about the pivot as the + half's copy draws it (>= ${P_GONE}), ${same0.toFixed(2)} of the disc about the closed head's (<= ${P_SAME}), the two ${apartPx.toFixed(1)} px apart (>= ${2 * P_DISC} px)`);
    } finally { await evaluate("__sdfGame.skullSplit({ follow: null })"); await stepN(2); }
    // (5) A SLUG THROUGH THE OPEN V, AT BONE WITH NO FLESH ON ITS LINE. The same head at the axe's first chop: the
    // bone opens far less than its flesh there and stands in the gap. The slug is the gun's own, put in flight on a
    // line the gate lays (slugFrom), and the projectile loop does the rest: its flesh trace finds nothing of this
    // actor, and the skull is cast along the slug's step.
    {
      const open5 = AXE_HEAD.openAngles[0], ok5 = await force(z.id, "middle", 0, 0, open5);
      await setCam(cam); await stepN(2);
      const d5 = await drawnNow(), M5 = {};
      for (const q of d5.copies) if (!q.eye && !(q.piece in M5)) M5[q.piece] = q.matrix;
      if (!M5[1]) die(`no copy of the + half among the bone draws (pieces ${Object.keys(M5).join(", ")})`);
      const gp = plateOf(P_GAP_PLATE), aim = xf(M5[1], add(gp.pivot, P_GAP_OFF)), from5 = sub(aim, mul(into, P_GAP_BACK)), T5 = xf(M5[1], gp.pivot);
      // What the line meets: bone (the renderer's own test, nothing damaged) and flesh (the loop's own trace).
      const bone5 = await evaluate(`__sdfGame.skullRay(${z.id}, ${J(from5)}, ${J(into)}, ${P_GAP_RUN})`);
      const flesh5 = await evaluate(`(async () => { const G = await import("/src/lab/sdf-zombie/webgpu/game-weapon.ts"), V = ${VA}; const posed = __sdfGame.zombie(${z.id}).posed(), o = ${J(from5)}, d = ${J(into)};
        return G.traceProjectile(o, [o[0] + d[0] * ${P_GAP_RUN}, o[1] + d[1] * ${P_GAP_RUN}, o[2] + d[2] * ${P_GAP_RUN}], (q) => V.sdBody(q, posed)); })()`);
      const sk5 = await skullOf(z.id), w5 = await splitOf(z.id), deg = (r) => (r * 180 / Math.PI).toFixed(1);
      const wounds0 = (await woundsOf(z.id)).length, meter0 = await meterOf(z.id), n5 = (await fragmentsOf(P_GAP_PLATE)).length, st5 = await stateNow();
      const fired = await evaluate(`__sdfGame.slugFrom(${J(from5)}, ${J(into)})`);
      let frag5 = null, frame5 = 0;
      for (let i = 1; i <= P_GAP_FRAMES; i++) { await stepOne(); const fs = await fragmentsOf(P_GAP_PLATE); if (!frag5 && fs.length > n5) { frag5 = fs[n5]; frame5 = i; } }
      const st6 = await stateNow(), wounds1 = (await woundsOf(z.id)).length, meter1 = await meterOf(z.id);
      const newly = st6.pieces.filter((n) => !st5.pieces.includes(n));
      // A fragment is stepped in the frame it is released in: one frame back along its velocity is where it started.
      const start5 = frag5 ? sub(frag5.pos, mul(frag5.vel, 1 / 60)) : null, off5 = start5 ? len(sub(start5, T5)) : Infinity;
      Object.assign(out.p, { gap: { fleshDeg: w5 && +deg(w5.thetaP), boneDeg: +deg(sk5.angleP), from: from5, boneOnLine: bone5, fleshOnLine: flesh5, released: newly, frame: frame5, fragment: frag5, fromDrawnPivotMm: +(1000 * off5).toFixed(4), wounds: [wounds0, wounds1], meter: [meter0, meter1] } });
      check(ok5 && fired === true && !!bone5 && bone5.plate === P_GAP_PLATE && bone5.piece === 1 && flesh5 === null && same(newly, [P_GAP_PLATE]) && frame5 === 1,
        `P: a slug through the open V at bone with no flesh on its line releases that plate: the head at the axe's first chop (flesh ${w5 ? deg(w5.thetaP) : null} degrees a half, bone ${deg(sk5.angleP)}), the gun's slug put in flight ${mm(P_GAP_BACK)} mm in front of the + half's ${P_GAP_PLATE}; its line meets ${bone5 ? `${bone5.plate} on piece ${bone5.piece}, ${mm(bone5.distance)} mm out` : "no bone"} and ${flesh5 === null ? "no flesh" : "FLESH"} of the actor in ${P_GAP_RUN} m (the loop's own trace); released ${J(newly)} on frame ${frame5} of its flight`);
      check(off5 <= P_GAP_AT && wounds1 === wounds0 && meter1 === meter0,
        `P: that plate's fragment starts at the pivot as the + half's copy draws it (${(1000 * off5).toFixed(4)} mm off, <= ${(1000 * P_GAP_AT).toFixed(2)} mm), and the slug does nothing else to the actor: ${wounds0} wounds before and ${wounds1} after, its damage meter ${meter0} and ${meter1}`);
      await stepN(P_FLY);
      await bonePhoto();
    }
    sheet("P-plates", tiles);
  } catch (e) { await threw("P", e); }
}
/** THE THREE REAL CHOPS, FOR THE SKULL ALONE: what skullStageChecks takes, on a boot that runs nothing of S, W or K.
 *  The chops are theirs (from the eye in the wedge, each spring followed by the same chopAndFollow, the body thawed 3
 *  frames after each and K_LATER after the kill, the halves at rest before a read), with no gap read on the way.
 *  What runs between the chops is not shared: the first boot measures and checks at every stage (and stops where
 *  ONLY says), and here a stage that goes wrong ends the scenario. */
async function chopsForSkull(z) {
  const hc = await headOf(z.id), f = await frontOf(z.id);
  const front = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
  const got = [], drawn = [];
  let line = await gapLine(z.id), eyeW = wedgeEye(line);
  await camAt(eyeW, line.G0); await syncCam(); await settle();
  const closedSkull = await skullOf(z.id);
  const aim = async () => { line = await gapLine(z.id); eyeW = wedgeEye(line); await camAt(eyeW, line.G0); await syncCam(); };
  const landed = (n, side) => { if (n !== 1) die(`the ${side} chop did not land on the head`); };
  const read = async () => { got.push(await skullOf(z.id)); drawn.push(await boneDrawn(z.id)); };
  await aim(); landed((await chopAndFollow(z.id, "H", line, eyeW, null, [], false)).n, "H");
  await read();
  const lm1 = await boneLandmark(z.id, front);
  await thaw(3);
  if (await actorPhase(z.id) !== "standing" || await restWobble(z.id) < 0) die("the zombie did not stand at rest after chop 1");
  await aim(); landed((await chopAndFollow(z.id, "R", line, eyeW, null, [], false)).n, "R");
  await read();
  await thaw(3);
  if (await actorPhase(z.id) !== "standing" || await restWobble(z.id) < 0) die("the zombie did not stand at rest after chop 2");
  await aim(); landed(await chop(z.id, "L"), "L");
  await stepN(K_SWING); await thaw(3);
  if (await actorPhase(z.id) === "standing") die("chop 3 did not kill");
  await thaw(K_LATER);
  if (await restWobble(z.id) < 0) die("the corpse's halves did not come to rest");
  const lineK = await gapLine(z.id), eyeK = wedgeEye(lineK);
  await camAt(eyeK, lineK.G0); await syncCam(); await settle();
  await read();
  return { closedSkull, got, drawn, lm1 };
}
{
  // ======== BOOT 1 (the shipped path): the three chops (S, W, K, the skull's stages of M), one side (O), later hits
  // (L), the face preset (F), the skull landmark (M), cost (C).
  if (run("S") || run("W") || run("K") || run("O") || run("L") || run("F") || run("M") || run("C")) try {
    await boot("chops"); await loadRules();
    // -------- O. an off-centre chop opens ONE side; the other half does not change.
    if (run("O")) try {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
      const right = qRot(fr.quat, [1, 0, 0]);
      const camF = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE); await settle();
      // The untouched head, then the chop from O_BEARING round to the head's right: the eye-to-centre line meets the
      // skin off centre on that side.
      const tA = await readF(), shot0 = await capture(), px0 = await headPx(z.id);
      await look(hc, HEAD_D, unit(add(mul(f, Math.cos(O_BEARING)), mul(right, Math.sin(O_BEARING)))));
      const n = await chop(z.id, "H");
      const hit = (await evaluate("__sdfGame.axe()")).last.points[0];
      const hitX = dot(sub(hit, fr.centre), right);
      await stepN(SPRING_FRAMES);
      const st = await stateOf(z.id), w = await splitOf(z.id);
      const maxOff = HEAD_SPLIT.maxOffsetFrac * fr.axes[0], side = Math.sign(hitX);
      out.o = { state: st, hitLocalX: +hitX.toFixed(4) };
      check(n === 1 && st?.preset === "middle" && st.sides === side && side !== 0 && Math.abs(st.offset - side * Math.min(maxOff, Math.abs(hitX))) < 1e-9 && st.angle === AXE_HEAD.openAngles[0] * HEAD_SPLIT.presets.middle.maxOne,
        `O: a chop ${mm(Math.abs(hitX))} mm off centre opens ONE side, the struck one (sides ${st?.sides}, plane offset ${st ? mm(st.offset) : null} mm of at most ${mm(maxOff)}; settled at ${st?.angle.toFixed(4)} rad)`);
      check(!!w && (side > 0 ? w.thetaP > 0 && w.thetaM === 0 : w.thetaM < 0 && w.thetaP === 0), `O: the pose's split turns that half only (${w ? `${w.thetaP.toFixed(4)} / ${w.thetaM.toFixed(4)}` : null})`);
      await setCam(camF); await stepN(SETTLE); await settle();
      const tO = await readF(), shot1 = await capture();
      // The reference is the SAME head closed again (the seam drops the split; its cut face stays in the wound ring):
      // the face cut is a wound of the closed head and carves and lips BOTH sides of the plane, split or not.
      await force(z.id, "middle", st.sides, st.offset, 0);
      await setCam(camF); await stepN(SETTLE); await settle();
      const tR = await readF();
      // The STILL half on the target: texels beyond the old plane by O_CLEAR on the still side, within O_DISC of the
      // head centre. The MOVED half: beyond the plane by 1 cm the other way.
      const C = await txOf(fr.centre, tO), Rd = d2(C, await txOf(add(fr.centre, [0, O_DISC, 0]), tO));
      const lineAt = async (s) => [await txOf(add(add(fr.centre, mul(right, s)), [0, 0.2, 0]), tO), await txOf(add(add(fr.centre, mul(right, s)), [0, -0.2, 0]), tO)];
      const sideOf = ([a, b], x, y) => Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
      const stillLine = await lineAt(st.offset - side * O_CLEAR), movedLine = await lineAt(st.offset + side * O_CLEAR);
      const stillRef = await txOf(add(fr.centre, mul(right, -side * 0.3)), tO), movedRef = await txOf(add(fr.centre, mul(right, side * 0.3)), tO);
      // Per half: texels either frame hits; those whose hit differs (`mask`), whose surface moved along the view by
      // more than O_DEPTH (`depth`: an open slot's walk lands its samples a hair off the closed one's, under a tenth
      // of that), and whose colour differs by more than O_COLOUR with the surface in place (`colour`: its light).
      const dist = await depthToDistance();
      const count = (a, b, line, ref) => { let n = 0, mask = 0, depth = 0, colour = 0, max = 0, maxDepth = 0; const want = sideOf(line, ref[0], ref[1]);
        for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { if (d2([x + 0.5, y + 0.5], C) > Rd || sideOf(line, x + 0.5, y + 0.5) !== want) continue;
          const i = y * a.w + x, ha = hitAt(a, i), hb = hitAt(b, i); if (!ha && !hb) continue; n++;
          if (ha !== hb) { mask++; continue; }
          const dd = Math.abs(dist(a.f[i * 4 + 3]) - dist(b.f[i * 4 + 3])); if (dd > maxDepth) maxDepth = dd; if (dd > O_DEPTH) { depth++; continue; }
          let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.f[i * 4 + c] - b.f[i * 4 + c])); if (d > max) max = d; if (d > O_COLOUR) colour++; }
        return { n, mask, depth, colour, max: +max.toExponential(2), maxDepthMm: +mm(maxDepth) }; };
      const still = count(tR, tO, stillLine, stillRef), moved = count(tR, tO, movedLine, movedRef);
      const cutAlone = count(tA, tR, stillLine, stillRef);
      const floor = { colour: Math.max(tR.floor.colour, tO.floor.colour), depth: Math.max(tR.floor.depth, tO.floor.depth) };
      out.o.still = still; out.o.floor = floor; out.o.moved = moved; out.o.faceCutAlone = cutAlone;
      note(`O: still half ${J(still)}; the two reads of each capture ${J(floor)}; moved half ${J(moved)}`);
      note(`O: (ungated) the face cut alone, closed head with it against the untouched head, same still-half texels: ${J(cutAlone)}`);
      check(floor.colour <= FLOOR_COLOUR_MAX && floor.depth <= FLOOR_DEPTH_MAX, `O: the instrument's floor: the two reads of each of its captures differ by at most ${floor.colour.toExponential(1)} in colour and ${floor.depth.toExponential(1)} in clip depth (<= ${FLOOR_COLOUR_MAX}, ${FLOOR_DEPTH_MAX})`);
      check(still.n >= O_MIN_TEXELS && still.mask + still.depth <= O_STILL_MOVED,
        `O: the other half does not move: against the same head closed, ${still.mask} hit texels of ${still.n} differ and ${still.depth} moved more than ${mm(O_DEPTH)} mm in depth (${mm(O_CLEAR)} mm and more beyond the plane; <= ${O_STILL_MOVED})`);
      check(still.colour / still.n <= O_STILL_LIGHT, `O: its light changes on few texels: ${still.colour} of ${still.n} by more than ${O_COLOUR} (${(still.colour / still.n).toFixed(3)} <= ${O_STILL_LIGHT}: the open gap's shadow and occlusion; largest step ${still.max})`);
      check((moved.mask + moved.depth) / moved.n >= O_MOVED_MIN, `O: the struck half did move: ${moved.mask + moved.depth} of ${moved.n} texels differ in hit or depth (${((moved.mask + moved.depth) / moved.n).toFixed(2)} >= ${O_MOVED_MIN})`);
      sheet("O-one-side", [{ img: shot0, c: px0 }, { img: shot1, c: px0 }]);
    } catch (e) { await threw("O", e); }
    // -------- L. later hits on a moved half's OUTER skin: stamped where unwarpPoint says, shown on the half.
    if (run("L")) try {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
      const right = qRot(fr.quat, [1, 0, 0]), up = qRot(fr.quat, [0, 1, 0]);
      const cam = (await look(hc, HEAD_D, f)).pose;
      // A point of the CLOSED head's skin for each wound, then the split (L_OPEN), then where the CPU puts them.
      const skin = [];
      for (const d of [L_CUT_DIR, L_PELLET_DIR]) { const out0 = unit(qRot(fr.quat, d)); skin.push(await surfHit(z.id, add(fr.centre, mul(out0, 0.5)), mul(out0, -1))); }
      const ok = await force(z.id, "middle", 0, 0, L_OPEN);
      // Each wound is aimed from, and then read from, an eye square on to its place on the OPEN head: L_EYE_D out along
      // the skin's outward direction there (from the skull centre through the point, turned with its half), so the
      // torch lights its floor and neither its mask nor its crater is cut short by the half's outline.
      const open = [], eyes = [];
      for (const q of skin) {
        const wq = await warpOf(z.id, q);
        const out1 = await evaluate(`(async () => (${HS}).warpDir(__sdfGame.zombie(${z.id}).posed().split, ${wq.piece}, ${J(unit(sub(q, fr.centre)))}))()`);
        open.push(wq.p); eyes.push(add(wq.p, mul(out1, L_EYE_D)));
      }
      const allViews = `__sdfGame.actorList().map((a) => __sdfGame.zombie(a.id)).filter((q) => q && q.view)`;
      const saved = await evaluate(`(() => { const u = ${allViews}[0].view.uniforms; return { deep: u.deepColor.value.toArray(), fat: u.fatColor.value.toArray() }; })()`);
      const tissue = (deep, fat) => evaluate(`(() => { for (const q of ${allViews}) { const u = q.view.uniforms; u.deepColor.value.setRGB(${deep[0]}, ${deep[1]}, ${deep[2]}); u.fatColor.value.setRGB(${fat[0]}, ${fat[1]}, ${fat[2]}); } return 1; })()`);
      await setCam(cam); await stepN(SETTLE); await settle();
      const shot0 = await capture(), px0 = await headPx(z.id);
      // A rod cut down the + half's brow, then a pellet high on the - half's forehead: both aimed from the front at
      // the OPEN head. Each is read against the frame before it, so its mask is its own.
      const green = (t, i) => t.f[i * 4 + 1] / (t.f[i * 4] + t.f[i * 4 + 1] + t.f[i * 4 + 2] + 1e-6);
      const glow = (t, i) => t.f[i * 4] > L_EYE_RED;
      out.l = [];
      const LW = 150, lRgb = Buffer.alloc(2 * LW * 2 * LW * 2 * 3); let lCol = 0;
      // The wound mask is the tissue colours' reach (albedo = mix(base, tissue, mask)): paint them green and it is the
      // rise in green against the same open head before the hit. The paint is on every view of the page, so it comes
      // off again whatever happens in between (the scenarios after this one read the same boot).
      await tissue([0, 1, 0], [0, 1, 0]);
      try {
        await settle();
        for (const [k, name] of [[0, "rod cut"], [1, "pellet"]]) {
          const at = open[k], eyeAt = eyes[k], view = unit(sub(at, eyeAt));
          const prev = await readFrom(eyeAt, at);
          const w0 = (await woundsOf(z.id)).length;
          const aim = name === "rod cut"
            ? ((await evaluate(`__sdfGame.cut(${z.id}, ${J(add(at, mul(up, -L_CUT_HALF)))}, ${J(add(at, mul(up, L_CUT_HALF)))}, ${J(view)})`)) >= 1 ? at : null)
            : await evaluate(`__sdfGame.stampWoundAt(${eyeAt[0]}, ${eyeAt[1]}, ${eyeAt[2]}, ${view[0]}, ${view[1]}, ${view[2]}, "pellet", ${z.id})`);
          await stepN(3);
          const wd = (await woundsOf(z.id)).slice(w0)[0];
          check(ok && !!aim && !!wd, `L: the ${name} lands on the open head (split forced ${ok}, hit ${!!aim}, a new wound ${!!wd})`);
          if (!aim || !wd) continue;
          const t1 = await readFrom(eyeAt, at);
          const pred = await unwarpOf(z.id, aim), shown = await warpOf(z.id, wd.pos);
          const tx = await txOf(shown.p, t1), closedTx = await txOf(wd.pos, t1);
          // The window: about the wound's place on the open head, a multiple of its radius there (B6's).
          const win = Math.max(L_WINDOW_MIN, (wd.shape === "cut" ? L_WINDOW_CUT : L_WINDOW_CRATER) * d2(await txOf(add(shown.p, mul(up, wd.radius)), t1), tx));
          // The mask: texels both frames hit, neither an eye's glow, whose green share rose by more than L_GREEN. The
          // crater: texels whose surface went in by more than L_DENT. The check holds the mask's plain centroid to the
          // crater's. B6 weighted the mask's by the rise; that one is reported: it moves with the wet highlight on the
          // crater (0.27 texels on one zombie of the ring, 2.69 on its neighbour, with 0.98 and 0.96 of the crater masked).
          const dist = await depthToDistance();
          let n = 0, wsum = 0, sx = 0, sy = 0, ux = 0, uy = 0, cn = 0, cx = 0, cy = 0, both = 0;
          for (let y = 0; y < t1.h; y++) for (let x = 0; x < t1.w; x++) { const i = y * t1.w + x; if (!hitAt(prev, i) || !hitAt(t1, i) || d2([x + 0.5, y + 0.5], tx) > win) continue;
            const rise = green(t1, i) - green(prev, i), m = rise > L_GREEN && !glow(t1, i) && !glow(prev, i), c = dist(t1.f[i * 4 + 3]) - dist(prev.f[i * 4 + 3]) > L_DENT;
            if (m) { n++; wsum += rise; sx += (x + 0.5) * rise; sy += (y + 0.5) * rise; ux += x + 0.5; uy += y + 0.5; } if (c) { cn++; cx += x + 0.5; cy += y + 0.5; } if (m && c) both++; }
          const posErr = len(sub(wd.pos, pred.q)), mask = n ? [ux / n, uy / n] : null, crater = cn ? [cx / cn, cy / cn] : null;
          const err = mask && crater ? d2(mask, crater) : Infinity, toOpen = mask ? d2(mask, tx) : Infinity, toClosed = mask ? d2(mask, closedTx) : 0, covered = cn ? both / cn : 0;
          const weighted = n && crater ? d2([sx / wsum, sy / wsum], crater) : Infinity;
          out.l.push({ wound: name, shape: wd.shape, piece: pred.piece, posErrMm: +(1000 * posErr).toFixed(3), windowTx: +win.toFixed(1), maskTexels: n, craterTexels: cn, craterMasked: +covered.toFixed(2), maskToCraterTx: +err.toFixed(2), riseWeightedTx: +weighted.toFixed(2), maskToOpenPlaceTx: +toOpen.toFixed(1), maskToClosedPlaceTx: +toClosed.toFixed(1) });
          check(pred.piece !== 0 && shown.piece === pred.piece && posErr <= L_POS_TOL, `L: the ${name} is stamped where unwarpPoint puts its hit, on the closed head (piece ${pred.piece}; ${(1000 * posErr).toFixed(3)} mm off <= ${mm(L_POS_TOL)} mm)`);
          check(n >= L_MIN_TEXELS && cn >= L_MIN_TEXELS && err <= L_CENTROID_TX && covered >= L_CRATER_MASKED && toClosed > toOpen,
            `L: its mask is drawn on its crater, on the moved half: centroids ${err.toFixed(2)} texels apart (<= ${L_CENTROID_TX}), ${covered.toFixed(2)} of the crater's ${cn} texels masked (>= ${L_CRATER_MASKED}; ${n} mask texels in a ${win.toFixed(1)}-texel window); the mask is ${toOpen.toFixed(1)} texels from the wound's place on the open head, ${toClosed.toFixed(1)} from its closed one`);
          // The picture: grey hit, green mask only, red crater only, yellow both; white the wound's place on the open
          // head, blue its closed one. 2 x 2 px a texel, about the head.
          const hcTx = tx;
          for (let y = 0; y < LW * 2; y++) for (let x = 0; x < LW * 2; x++) {
            const tx0 = Math.round(hcTx[0] - LW / 2) + (x >> 1), ty0 = Math.round(hcTx[1] - LW / 2) + (y >> 1), o = (y * 2 * LW * 2 + lCol * LW * 2 + x) * 3;
            if (tx0 < 0 || ty0 < 0 || tx0 >= t1.w || ty0 >= t1.h) continue;
            const i = ty0 * t1.w + tx0, hit = hitAt(prev, i) && hitAt(t1, i), inWin = d2([tx0 + 0.5, ty0 + 0.5], tx) <= win;
            const m = hit && inWin && green(t1, i) - green(prev, i) > L_GREEN && !glow(t1, i) && !glow(prev, i), c = hit && inWin && dist(t1.f[i * 4 + 3]) - dist(prev.f[i * 4 + 3]) > L_DENT;
            const near = (q) => d2([tx0 + 0.5, ty0 + 0.5], q) < 1;
            const col = near(tx) ? [255, 255, 255] : near(closedTx) ? [0, 120, 255] : m && c ? [230, 230, 0] : m ? [0, 200, 0] : c ? [200, 0, 0] : hit ? [60, 60, 60] : [0, 0, 0];
            lRgb[o] = col[0]; lRgb[o + 1] = col[1]; lRgb[o + 2] = col[2];
          }
          lCol++;
        }
      } finally { await tissue(saved.deep, saved.fat); }
      writeFileSync(`${OUT}/L-mask-vs-crater.png`, encodePng(2 * LW * 2, LW * 2, lRgb)); console.log(`  sheet ${OUT}/L-mask-vs-crater.png (the rod cut, the pellet)`);
      note(`L: ${J(out.l)}`);
      await setCam(cam); await stepN(SETTLE); await settle();
      const shot1 = await capture();
      sheet("L-later-hits", [{ img: shot0, c: px0 }, { img: shot1, c: px0 }]);
    } catch (e) { await threw("L", e); }
    // -------- F. the face preset folds the face half forward.
    if (run("F")) try {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
      const cam = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
      const shot0 = await capture(), px0 = await headPx(z.id);
      const nose = await surfHit(z.id, add(fr.centre, mul(f, 0.5)), mul(f, -1));
      const ok = await force(z.id, "face", 1, 0, 1), st = await stateOf(z.id), w = await splitOf(z.id);
      const P = HEAD_SPLIT.presets.face;
      check(ok && st?.preset === "face" && st.sides === 1 && st.angle === P.maxOne && !!w && w.thetaP === P.maxOne && w.thetaM === 0 && !!(await drawnOf(z.id)),
        `F: forceSplit(face) holds the face half open at its full angle (${st?.angle} rad; the pose's split ${w ? `${w.thetaP} / ${w.thetaM}` : null})`);
      // Two points of the closed head and where the CPU's forward warp puts them: the nose, and a point of the old
      // plane F_UP above the head centre, which is on the face half's cut face once it folds.
      const up = cross(w.n, w.a), inner = add(add(fr.centre, mul(w.n, w.d0 - dot(w.n, fr.centre))), mul(up, F_UP));
      const folded = await warpOf(z.id, nose), cutAt = await warpOf(z.id, inner);
      const faceOut = await evaluate(`(async () => (${HS}).warpDir(__sdfGame.zombie(${z.id}).posed().split, 1, ${J(mul(w.n, -1))}))()`);
      const moved = len(sub(folded.p, nose));
      await setCam(cam); await stepN(SETTLE); await settle();
      const tF = await readF(), shot1 = await capture();
      const gone = !(await surfaceAtPoint(nose, tF, DEPTH_TOL));
      // The folded cut face looks up and back: seen from above, behind and to one side (clear of the body, and of the
      // half that stands), the march has a surface at that point.
      const eyeF = add(cutAt.p, mul(unit(add(faceOut, qRot(fr.quat, [1, 0, 0]))), F_EYE_D));
      const tN = await readFrom(eyeF, cutAt.p), there = await surfaceAtPoint(cutAt.p, tN, DEPTH_TOL), shot2 = await capture(), px2 = await toPx(cutAt.p);
      await force(z.id, "face", 1, 0, 0);
      const tZ = await readFrom(eyeF, cutAt.p), closedThere = await surfaceAtPoint(cutAt.p, tZ, DEPTH_TOL);
      await force(z.id, "face", 1, 0, 1);
      out.f = { noseMovedMm: +mm(moved), dropMm: +mm(nose[1] - folded.p[1]), forwardMm: +mm(dot(sub(folded.p, nose), f)), cutFaceMovedMm: +mm(len(sub(cutAt.p, inner))), pieces: [folded.piece, cutAt.piece] };
      check(folded.piece === 1 && cutAt.piece === 1 && moved >= F_MOVED_MIN && dot(sub(folded.p, nose), f) > 0 && folded.p[1] < nose[1] && faceOut[1] > 0,
        `F: the CPU folds the face half forward and down (the nose ${mm(moved)} mm: ${out.f.forwardMm} mm forward, ${out.f.dropMm} mm down; >= ${mm(F_MOVED_MIN)} mm), its cut face turned to look up`);
      check(there && !closedThere && gone, `F: the march draws it there: a surface within ${mm(DEPTH_TOL)} mm of the cut face's point on the open head (${there}; on the closed head ${closedThere}), none left at the closed nose (${gone})`);
      sheet("F-face", [{ img: shot0, c: px0 }, { img: shot1, c: px0 }, { img: shot2, c: px2 ?? px0 }]);
    } catch (e) { await threw("F", e); }
    // -------- M (landmark, forced): the split skull's seated eyes on screen at three bone angles, and the materials
    // its copies are drawn on. (M's measures on really chopped heads are with S.)
    if (run("M")) try { await skullLandmarkForced("M"); } catch (e) { await threw("M", e); }
    // -------- C. cost: an untouched head, then open against closed again, interleaved, 0.6 m and 2 m (reported with
    // its spread, not gated). "Closed again" is a closed head that carries the split's cut faces (the seam re-stamps
    // them at every force), so open minus closed is the split's own cost and closed minus untouched the face cuts'.
    if (run("C")) try {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
      out.c = {};
      const cams = {}; for (const d of [0.6, 2]) cams[d] = (await look(hc, d, f)).pose;
      const untouched = {}; for (const d of [0.6, 2]) { await setCam(cams[d]); await stepN(2); untouched[d] = +(await timeDraws()).toFixed(2); }
      for (const d of [0.6, 2]) {
        await setCam(cams[d]); await stepN(2);
        const openMs = [], closedMs = [];
        for (let k = 0; k < C_ROUNDS; k++) {
          await force(z.id, "middle", 0, 0, 1); openMs.push(+(await timeDraws()).toFixed(2));
          await force(z.id, "middle", 0, 0, 0); closedMs.push(+(await timeDraws()).toFixed(2));
        }
        const spread = (a) => (Math.max(...a) - Math.min(...a)).toFixed(2);
        out.c[d] = { untouchedMs: untouched[d], openMs, closedWithFaceCutsMs: closedMs, delta: +(median(openMs) - median(closedMs)).toFixed(2) };
        note(`C @${d} m: draw ms (UNGATED) untouched ${untouched[d]}; open ${J(openMs)} (spread ${spread(openMs)}), closed again with its face cuts ${J(closedMs)} (spread ${spread(closedMs)}); open - closed ${out.c[d].delta} ms, the face cuts ${(median(closedMs) - untouched[d]).toFixed(2)} ms`);
      }
    } catch (e) { await threw("C", e); }
    // -------- S, W, K: one zombie, three chops, the spring at rest before each. LAST in this boot: the thaws below
    // let the whole ring step, and every scenario above wants its zombie in the frozen rest pose.
    if (run("S") || run("W") || run("K")) try {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
      const front = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
      const shot0 = await capture(), px0 = await headPx(z.id);
      // The instrument: the march's depth is the projection's (the gap and landmark measures compare the two).
      let line = await gapLine(z.id), eyeW = wedgeEye(line);
      const nose = await surfHit(z.id, add(line.G0, mul(line.fwd, 0.5)), mul(line.fwd, -1)), tN = await readF();
      check(!!nose && await surfaceAtPoint(nose, tN, DEPTH_TOL) && !(await surfaceAtPoint(add(nose, mul(line.fwd, NOSE_CLEAR)), tN, DEPTH_TOL)),
        `S: the instrument: the march target has the closed head's surface at the CPU's nose point (within ${mm(DEPTH_TOL)} mm along the sight line) and none ${mm(NOSE_CLEAR)} mm in front of it`);
      const closedGap = await gapRead(line, await readFrom(eyeW, line.G0)), closedSkull = await skullOf(z.id);
      check(closedGap === 0, `S: a closed head has no gap (${mm(closedGap)} mm seen across the plane at the head centre's height)`);
      const phase0 = await actorPhase(z.id);
      // ---- S. chop 1 opens a centred `middle` split; the gap grows, overshoots and settles.
      const MID = HEAD_SPLIT.presets.middle, full = MID.maxBoth, t1 = AXE_HEAD.openAngles[0] * full, t2 = AXE_HEAD.openAngles[1] * full;
      // The chop comes from the eye in the wedge: on the head's own mid-plane, so it lands centred.
      await camAt(eyeW, line.G0); await syncCam();
      const s = await chopAndFollow(z.id, "H", line, eyeW, front, [4, 8, 30]);
      const st1 = s.state, lineW = await gapLine(z.id);
      out.s = { state: st1, closedGapMm: +mm(closedGap), frames: s.frames.map((q) => [q.i, +q.angle.toFixed(4), +mm(q.gap)]) };
      check(s.n === 1 && phase0 === "standing" && st1?.preset === "middle" && st1.sides === 0 && st1.offset === 0 && Math.abs(st1.target - t1) < 1e-12,
        `S: a centred head chop opens a middle split, both sides (${s.n} hit; ${J(st1 && { preset: st1.preset, sides: st1.sides, offset: st1.offset, target: +st1.target.toFixed(4) })}; expected target ${t1.toFixed(4)} rad)`);
      check(lineW.open && len(sub(lineW.G0, line.G0)) < 1e-9 && dot(lineW.n, line.n) > 1 - 1e-12, `S: the pose's split lies on the head's own frame (the gap line from the split and from the frame: ${len(sub(lineW.G0, line.G0)).toExponential(1)} m apart)`);
      // What the CPU's spring did on these frames, as gaps: the peak's frame, the overshoot and the settle frame the
      // measured gap is held against.
      const gaps = s.frames.map((q) => q.gap), cpu = s.frames.map((q) => gapPredicted(line, q.angle, -q.angle));
      const peakOf = (a) => a.indexOf(Math.max(...a)), settleOf = (a) => a.findLastIndex((v) => Math.abs(v - a.at(-1)) > GAP_SETTLED) + 2;
      const peakI = peakOf(gaps), cpuPeakI = peakOf(cpu), rest = gaps.at(-1), cpuRest = cpu.at(-1);
      let rising = true; for (let i = 1; i <= peakI; i++) if (gaps[i] < gaps[i - 1]) rising = false;
      note(`S: gap per frame (mm), measured:predicted: ${s.frames.map((q, i) => `${q.i}:${mm(q.gap)}:${mm(cpu[i])}`).join(" ")}`);
      // A spring tuned not to overshoot has no peak frame to compare (it creeps up to its rest value).
      const overshoots = cpu[cpuPeakI] / cpuRest >= 1 + S_OVERSHOOT_MIN;
      check(rising && gaps[0] > 0 && (!overshoots || Math.abs(peakI - cpuPeakI) <= S_PEAK_FRAMES), `S: the gap grows frame by frame to its peak (${mm(gaps[0])} mm on frame 1, peak ${mm(gaps[peakI])} mm on frame ${peakI + 1}; ${overshoots ? `the CPU's spring peaks on frame ${cpuPeakI + 1}, +-${S_PEAK_FRAMES}` : "the CPU's spring does not overshoot: no peak frame to hold"})`);
      check(Math.abs(gaps[peakI] / rest - cpu[cpuPeakI] / cpuRest) <= S_OVERSHOOT_TOL, `S: it overshoots its rest value as the CPU's spring does (peak ${mm(gaps[peakI])} mm = ${(gaps[peakI] / rest).toFixed(3)} x rest ${mm(rest)} mm; predicted ${(cpu[cpuPeakI] / cpuRest).toFixed(3)} x, +-${S_OVERSHOOT_TOL})`);
      check(settleOf(gaps) <= settleOf(cpu) + S_SETTLE_FRAMES && st1.angle === st1.target && st1.vel === 0, `S: it settles: within ${mm(GAP_SETTLED)} mm of rest from frame ${settleOf(gaps)} on (predicted ${settleOf(cpu)}, +${S_SETTLE_FRAMES}), the spring exactly on its target at frame ${SPRING_FRAMES} (angle ${st1.angle.toFixed(4)}, rate ${st1.vel})`);
      const off = s.frames.map((q, i) => q.gap - cpu[i]);
      check(Math.min(...off) >= -GAP_UNDER && Math.max(...off) <= GAP_OVER, `S: the gap is the CPU split's on every frame of the spring: ${mm(Math.min(...off))} to ${mm(Math.max(...off))} mm off over the ${SPRING_FRAMES} frames (allowed -${mm(GAP_UNDER)} to +${mm(GAP_OVER)})`);
      check(rest - cpuRest >= -GAP_REST_UNDER && rest - cpuRest <= GAP_REST_OVER, `S: at rest it is ${mm(rest)} mm against ${mm(cpuRest)} mm predicted (${mm(rest - cpuRest)} mm off; allowed -${mm(GAP_REST_UNDER)} to +${mm(GAP_REST_OVER)})`);
      // The skull at this stage, three ways: the rule's angles and the copies, the copies' turn as drawn, and the eyes on screen.
      const sk1 = await skullOf(z.id), bd1 = await boneDrawn(z.id), lm1 = run("M") ? await boneLandmark(z.id, front) : null;
      const shot1 = await photo(front);
      await thaw(3);
      const ph1 = await actorPhase(z.id), rest1 = await restWobble(z.id);
      check(ph1 === "standing" && rest1 >= 0, `S: the zombie lives (thawed 3 frames: phase ${ph1}; its halves at rest again ${rest1} frozen frames on)`);
      sheet("S-open", [{ img: shot0, c: px0 }, ...s.photos.map((img) => ({ img, c: px0 })), { img: shot1, c: px0 }]);
      // ---- W. chop 2 widens. The thaw let the body move (it flinches): the line and the eye are taken again.
      let sk2 = null, bd2 = null; const wk = [];
      if (run("W") || run("K")) {
        line = await gapLine(z.id); eyeW = wedgeEye(line);
        const before = await gapRead(line, await readFrom(eyeW, line.G0)), predBefore = gapPredicted(line, t1, -t1);
        const w = await chopAndFollow(z.id, "R", line, eyeW);
        const rest2 = w.frames.at(-1).gap, pred2 = gapPredicted(line, t2, -t2), heads = (await evaluate("__sdfGame.axe()")).heads[z.id];
        out.w = { state: w.state, beforeMm: +mm(before), restMm: +mm(rest2), predictedMm: +mm(pred2) };
        check(w.n === 1 && heads === 2 && w.state?.preset === "middle" && w.state.sides === 0 && Math.abs(w.state.target - t2) < 1e-12 && w.state.angle === w.state.target && wobbleAtRest(w.state),
          `W: chop 2 is counted and springs the same split on to its second angle (count ${heads}, target ${w.state?.target.toFixed(4)} rad, expected ${t2.toFixed(4)}; settled ${w.state?.angle === w.state?.target}, the halves on it with no offset ${wobbleAtRest(w.state)})`);
        check(rest2 - before >= W_WIDER_SHARE * (pred2 - predBefore), `W: the gap is wider than after chop 1: ${mm(before)} -> ${mm(rest2)} mm (+${mm(rest2 - before)}; predicted +${mm(pred2 - predBefore)}, at least ${W_WIDER_SHARE} of it)`);
        check(rest2 - pred2 >= -GAP_REST_UNDER && rest2 - pred2 <= GAP_REST_OVER, `W: at rest it is ${mm(rest2)} mm against ${mm(pred2)} mm predicted (${mm(rest2 - pred2)} mm off; allowed -${mm(GAP_REST_UNDER)} to +${mm(GAP_REST_OVER)})`);
        sk2 = await skullOf(z.id); bd2 = await boneDrawn(z.id);
        wk.push({ img: await photo([eyeW, line.G0]), c: await toPx(line.G0) });
        await thaw(3);
        const ph2 = await actorPhase(z.id), rest2w = await restWobble(z.id);
        check(ph2 === "standing" && rest2w >= 0, `W: alive after chop 2 (thawed 3 frames: phase ${ph2}; its halves at rest again ${rest2w} frozen frames on)`);
      }
      // ---- K. chop 3 kills; the split is open on the corpse 45 frames on.
      let sk3 = null, bd3 = null;
      if (run("K")) {
        line = await gapLine(z.id); eyeW = wedgeEye(line); await camAt(eyeW, line.G0); await syncCam();
        const n3 = await chop(z.id, "L"), heads = (await evaluate("__sdfGame.axe()")).heads[z.id], st0 = await stateOf(z.id);
        // THE KICK, on the still-frozen body (the kill itself is consumed at the thaw below): the spring alone moves
        // the halves, with no wobble on top, so the flesh's angle is the spring's on every frame.
        const kicked = [];
        for (let i = 1; i <= K_SWING; i++) { await stepOne(); kicked.push({ frame: i, st: await stateOf(z.id), w: await splitOf(z.id), bd: await boneDrawn(z.id) }); }
        await thaw(3);
        const ph3 = await actorPhase(z.id), st3 = await stateOf(z.id);
        check(n3 === 1 && heads === 3 && ph3 !== "standing", `K: chop 3 kills (count ${heads}; thawed 3 frames: phase ${ph3})`);
        check(st3?.preset === "middle" && Math.abs(st3.target - full) < 1e-12, `K: the kill throws the split to its full angle (target ${st3?.target.toFixed(4)} rad, the preset's ${full})`);
        // The kill lands on a split already at its target (when the table's last angle is the full one): it kicks the
        // spring. 3 frames on the halves are past the full angle; then they swing back UNDER it. On the way out the
        // stage's share and the table's at the flesh's own angle are the same thing; on the swing back they are not
        // (read at the flesh, the table dropped the bone toward the wide crack's share). Both frames: the bone is
        // drawn at the stage's share of each half, and the stage has not moved.
        const kick = AXE_HEAD.killKick * full, deg = (r) => (r * 180 / Math.PI).toFixed(2);
        const at3 = kicked[2], low = kicked.reduce((a, b) => (b.st.angle < a.st.angle ? b : a)), past = at3.st.angle - full, dip = full - low.st.angle;
        const boneOk = (q) => q.st.stage === full && q.w.thetaP === q.st.angle && q.w.thetaM === -q.st.angle && q.bd.plus !== null && Math.abs(q.bd.plus - q.bd.ruleP) <= M_ANGLE_TOL && Math.abs(q.bd.minus - q.bd.ruleM) <= M_ANGLE_TOL;
        out.kKick = { before: st0, frames: kicked.map((q) => [q.frame, +deg(q.st.angle), q.bd.plus === null ? null : +deg(q.bd.plus)]) };
        note(`K: the kick, frame: flesh / bone drawn (degrees a half): ${kicked.map((q) => `${q.frame}: ${deg(q.st.angle)} / ${q.bd.plus === null ? null : deg(q.bd.plus)}`).join("  ")}`);
        if (kick > 0 && Math.abs(t2 - full) < 1e-12) {
          check(st0?.angle === full && st0.vel > 0 && past >= K_KICK_SHARE * kick,
            `K: the kill kicks the split it finds at its full angle: rate ${st0?.vel.toFixed(2)} rad/s at the chop, ${deg(past)} degrees a half past it 3 frames on (${(past / kick).toFixed(2)} of killKick x the full angle, >= ${K_KICK_SHARE})`);
          check(boneOk(at3), `K: the bone rides the kick at its stage's share, the stage unmoved (${at3.st.stage} rad): drawn ${at3.bd.plus === null ? null : deg(at3.bd.plus)} / ${at3.bd.minus === null ? null : deg(at3.bd.minus)} degrees against ${deg(at3.bd.ruleP)} / ${deg(at3.bd.ruleM)} (the flesh ${deg(at3.st.angle)})`);
          check(dip >= K_DIP_SHARE * kick && boneOk(low),
            `K: and on the swing back, the flesh under its rest angle (frame ${low.frame}: ${deg(low.st.angle)} degrees, ${deg(dip)} under, >= ${K_DIP_SHARE} of the kick): drawn ${low.bd.plus === null ? null : deg(low.bd.plus)} / ${low.bd.minus === null ? null : deg(low.bd.minus)} degrees against ${deg(low.bd.ruleP)} / ${deg(low.bd.ruleM)}`);
        } else note(`K: no kick to hold (killKick ${AXE_HEAD.killKick}; chop 2's target ${t2.toFixed(4)} of ${full})`);
        await thaw(K_LATER);
        // The fall throws the halves about: frozen where it lies, the corpse's wobble comes to rest first.
        const restK = await restWobble(z.id);
        const stL = await stateOf(z.id), wL = await splitOf(z.id), dL = await drawnOf(z.id), phL = await actorPhase(z.id);
        check(restK >= 0 && stL?.preset === "middle" && stL.angle === full && !!wL && wL.thetaP === full && wL.thetaM === -full && !!dL && await recordOpen(z.id),
          `K: ${K_LATER} frames on (phase ${phL}), its halves at rest ${restK} frozen frames later, the corpse's head is still split open: state angle ${stL?.angle.toFixed(4)} rad, the pose's split ${wL ? `${wL.thetaP.toFixed(4)} / ${wL.thetaM.toFixed(4)}` : null}, drawn ${J(dL && [+dL.thetaP.toFixed(4), +dL.thetaM.toFixed(4)])}, the GPU record open`);
        // The gap on the corpse, wherever it lies.
        const lineK = await gapLine(z.id), eyeK = wedgeEye(lineK);
        const gapK = await gapRead(lineK, await readFrom(eyeK, lineK.G0)), predK = gapPredicted(lineK, full, -full);
        const shotK = await photo([eyeK, lineK.G0]), pxK = await toPx(lineK.G0);
        sk3 = await skullOf(z.id); bd3 = await boneDrawn(z.id);
        out.k = { phase: ph3, later: phL, gapMm: +mm(gapK), predictedMm: +mm(predK), eye: eyeK.map((v) => +v.toFixed(3)), G0: lineK.G0.map((v) => +v.toFixed(3)) };
        check(gapK - predK >= -GAP_REST_UNDER && gapK - predK <= GAP_REST_OVER, `K: the gap measured on the corpse is the full split's: ${mm(gapK)} mm against ${mm(predK)} mm predicted (${mm(gapK - predK)} mm off; allowed -${mm(GAP_REST_UNDER)} to +${mm(GAP_REST_OVER)}; the eye at height ${eyeK[1].toFixed(2)} m)`);
        const faces = (await woundsOf(z.id)).filter((w) => w.headRegion === "split+" || w.headRegion === "split-");
        check(faces.length === 2 && faces.every((w) => w.shape === "cut"), `K: the corpse keeps the two cut faces (${J(faces.map((w) => w.headRegion))})`);
        wk.push({ img: shotK, c: pxK ?? px0 });
      }
      if (wk.length) sheet("WK-widen-kill", wk);
      // ---- M (really chopped): the skull at the three chops.
      if (run("M") && sk2 && sk3) skullStageChecks("M", "", { closedSkull, got: [sk1, sk2, sk3], drawn: [bd1, bd2, bd3], lm1 });
    } catch (e) { await threw("S / W / K", e); }
    await diag("chops");
  } catch (e) { await threw("boot 1", e); } finally { if (S) { closeSession(S); S = null; } }
  // ======== BOOT 2 (the shipped path): range (R), a body chop near the neck (A), head damage against the split (H).
  if (run("R") || run("H") || run("A")) try {
    await boot("range"); await loadRules();
    // -------- R. past the cut-off a split is drawn closed, flesh and skull; it opens again only inside the reopen
    // distance, and does not flip between the two.
    if (run("R")) try {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
      const accept = await evaluate(`(() => { const u = __sdfGame.zombie(${z.id}).view.uniforms; return { coneK: u.aaCfg.value.x, strength: u.aaCfg.value.y, secant: u.perfCfg.value.w }; })()`);
      // The eye-to-hinge distances: just inside the cut-off, past it, back in the hysteresis band, inside the reopen
      // distance. The hinge is not the head centre, so the stance is solved for each.
      const cams = {}, closed = {};
      const standAt = async (D, hinge) => { let d = D; for (let i = 0; i < 4; i++) { await look(hc, d, f); const e = await evaluate("__sdfGame.cameraWorld()"); d += D - len(sub(hinge, e)); } return evaluate("__sdfGame.pose()"); };
      const okF = await force(z.id, "middle", 0, 0, 1), w = await splitOf(z.id);
      const far = await evaluate(`(async () => (${HS}).splitDrawDistance(__sdfGame.zombie(${z.id}).posed().split, ${J(accept)}))()`), near = far * (await evaluate(`(async () => (${HS}).SPLIT_REOPEN_FRAC)()`));
      const DS = { inside: far - R_STEP, beyond: far + R_STEP, band: (far + near) / 2, reopened: near - R_STEP };
      for (const [k, D] of Object.entries(DS)) cams[k] = await standAt(D, w.h);
      await force(z.id, "middle", 0, 0, 0);
      for (const k of Object.keys(DS)) { await setCam(cams[k]); await stepN(SETTLE); await settle(); closed[k] = await readF(); }
      await setCam(cams.inside); await stepN(2);
      await force(z.id, "middle", 0, 0, 1);
      out.r = { drawDistance: +far.toFixed(3), reopen: +near.toFixed(3), visits: [] };
      const tiles = [];
      const visit = async (k, wantOpen) => {
        await setCam(cams[k]); await stepN(2);
        // No toggle: the drawn state over R_HOLD frames at one stance.
        const seen = new Set(); for (let i = 0; i < R_HOLD; i++) { await stepOne(); seen.add(!!(await drawnOf(z.id))); }
        await stepN(SETTLE); await settle();
        const t = await readF(), sk = await skullOf(z.id), rec = await recordOpen(z.id), disc = await regionDisc(w, t);
        let differ = 0, hits = 0;
        for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) { if (d2([x + 0.5, y + 0.5], disc.c) > disc.R + 2) continue; const i = y * t.w + x; if (hitAt(t, i)) hits++; if (hitAt(t, i) !== hitAt(closed[k], i)) differ++; }
        const share = hits ? differ / hits : 0;
        const row = { stance: k, hingeM: +DS[k].toFixed(2), drawn: [...seen], record: rec, skullCopies: sk.bones + sk.eyes, skullDraws: sk.draws, discHits: hits, differFromClosed: differ, share: +share.toFixed(3) };
        tiles.push({ img: await capture(), c: await toPx(w.h) });
        out.r.visits.push(row); note(`R: ${J(row)}`);
        const steady = seen.size === 1 && seen.has(wantOpen);
        if (wantOpen) check(steady && rec && sk.bones === 3 && sk.eyes === 2 && hits >= R_MIN_HITS && share >= R_OPEN_SHARE,
          `R: ${k} (${DS[k].toFixed(2)} m): drawn OPEN for ${R_HOLD} frames, flesh and skull (record ${rec}, ${sk.bones}+${sk.eyes} skull copies; ${differ} of ${hits} region texels differ from the closed head: ${share.toFixed(3)} >= ${R_OPEN_SHARE})`);
        else check(steady && !rec && sk.bones === 0 && sk.eyes === 0 && sk.draws > 0 && hits >= R_MIN_HITS && share <= R_CLOSED_SHARE,
          `R: ${k} (${DS[k].toFixed(2)} m): drawn CLOSED for ${R_HOLD} frames, flesh and skull (record ${rec}, ${sk.bones + sk.eyes} skull copies of ${sk.draws} bone draws; ${differ} of ${hits} region texels differ from the closed head: ${share.toFixed(3)} <= ${R_CLOSED_SHARE})`);
      };
      check(okF && Number.isFinite(far) && far > R_FAR_MIN && near < far, `R: the draw distance from the live uniforms: ${far.toFixed(2)} m, reopening inside ${near.toFixed(2)} m (accept ${J(accept)})`);
      await visit("inside", true); await visit("beyond", false); await visit("band", false); await visit("reopened", true);
      const pose = await splitOf(z.id);
      check(!!pose && pose.thetaP === w.thetaP, `R: the pose keeps the split at every range (${pose ? pose.thetaP : null} rad): only the drawing closes`);
      sheet("R-range", tiles, R_SHEET_CROP);
    } catch (e) { await threw("R", e); }
    // -------- A. a body chop near the neck (scripts/axe-gate.mjs's own torso chop: from A_CHOP_D at standing height it
    // lands on the upper chest, inside the flail's head region) is a BODY chop: the head stays closed, the chop is not
    // counted toward the kill, and its cut is where it landed.
    if (run("A")) try {
      const z = fresh(); const t = await evaluate(`__sdfGame.actorLimbCenter(${z.id}, "torso")`), f = await frontOf(z.id), fr = await frameOf(z.id);
      await look(t, A_CHOP_D, f);
      const n = await evaluate(`__sdfGame.axeChop(${z.id}, "H", "torso")`);
      const dbg = await evaluate("__sdfGame.axe()"), point = dbg.last.points[0];
      const rule = await evaluate(`(async () => { const K = await import("/src/lab/sdf-zombie/webgpu/flail-strike.ts"), X = await import("/src/lab/sdf-zombie/webgpu/axe-strike.ts");
        return { neck: K.headNeck(__sdfGame.zombie(${z.id}).posed().prims).root, neckDist: K.FLAIL_HEAD.neckDist, credit: X.AXE_HIT.H.meterCredit }; })()`);
      const toNeck = len(sub(point, rule.neck)), toSkull = len(sub(point, fr.centre));
      const st = await stateOf(z.id), pose = await splitOf(z.id), ws = (await woundsOf(z.id)).filter((w) => w.shape === "cut"), m0 = await meterOf(z.id);
      // The meter the seam reports is the actor's last step's: one thawed frame (the ring moves a frame with it).
      await thaw(1);
      const m1 = await meterOf(z.id), ph = await actorPhase(z.id);
      out.a = { toNeckRootMm: +mm(toNeck), toSkullMm: +mm(toSkull), heads: dbg.last.heads, count: dbg.heads[z.id] ?? 0, split: st, cuts: ws.map((w) => ({ limb: w.limb, region: w.headRegion, offHitMm: +mm(len(sub(w.pos, point))), dirY: +Math.abs(w.dirWorld?.[1] ?? 0).toFixed(2) })), meter: [m0, m1] };
      check(n === 1 && toNeck < rule.neckDist && toSkull > A_OFF_HEAD, `A: the chop lands on the upper chest, inside the flail's head region and off the head (${mm(toNeck)} mm from the neck root < ${mm(rule.neckDist)}; ${mm(toSkull)} mm from the skull centre > ${mm(A_OFF_HEAD)})`);
      check(st === null && pose === null && dbg.last.heads.length === 0 && (dbg.heads[z.id] ?? 0) === 0 && ph === "standing",
        `A: it is a body chop: the head stays closed and no head chop is counted (split ${J(st && st.preset)}, the pose's split ${pose ? "open" : null}, head chops ${dbg.heads[z.id] ?? 0})`);
      check(ws.length === 1 && ws[0].limb === "torso" && ws[0].headRegion === null && len(sub(ws[0].pos, point)) <= A_LAND_MAX && Math.abs(ws[0].dirWorld?.[1] ?? 0) > A_VERTICAL,
        `A: it stamps its own cut where it landed (${ws.length} cut(s): ${J(out.a.cuts)}; within ${mm(A_LAND_MAX)} mm of the hit, vertical)`);
      check(Math.abs((m1 - m0) - rule.credit) < 1e-9, `A: it credits the body's collapse meter (${(m1 - m0).toFixed(3)}; a body overhead is ${rule.credit}, a head chop 0)`);
    } catch (e) { await threw("A", e); }
    // -------- H. head damage and the split do not mix.
    if (run("H")) try {
      const hstate = (id) => evaluate(`__sdfGame.head.state(${id})`);
      const hTiles = [], hShot = async (id, f) => { await look(await headOf(id), HEAD_D, f); await stepN(2); hTiles.push({ img: await capture(), c: await headPx(id) }); };
      // (1) a slug at a split head takes the ordinary un-warped crater: no burst state. The head is only a little open
      // (H_SLUG_OPEN), so the slug meets a half near where the closed head's prims are, as the burst's own test needs.
      {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
        const ok = await force(z.id, "middle", 0, 0, H_SLUG_OPEN);
        await look(hc, H_SLUG_D, f); await evaluate("__sdfGame.setAimPoint(0, 0)");
        const fr = await frameOf(z.id), right = qRot(fr.quat, [1, 0, 0]);
        await centreOn(add(fr.centre, mul(right, H_SLUG_OFF)));
        const pr = await evaluate("__sdfGame.predictSlugHit()");
        const w0 = (await woundsOf(z.id)).length;
        let fired = false; for (let i = 0; i < 4 && !fired; i++) { fired = await evaluate("__sdfGame.fireSlug()"); if (!fired) await stepN(90); }
        await stepN(H_FRAMES);
        const hs = await hstate(z.id), ws = (await woundsOf(z.id)).slice(w0), st = await stateOf(z.id);
        out.hSlug = { predicted: pr?.actorId, fired, newWounds: ws.map((q) => ({ shape: q.shape, limb: q.limb, r: +q.radius.toFixed(3) })), headState: hs, split: st && st.preset };
        await hShot(z.id, f);
        check(ok && fired && pr?.actorId === z.id && ws.some((q) => q.limb === "head") && hs === null,
          `H: a slug into a split head leaves an ordinary wound and no burst state (aimed at actor ${pr?.actorId}; ${ws.length} new wound(s) ${J(ws.map((q) => q.limb))}; head damage state ${J(hs)})`);
      }
      // (2) a flail hit on a split head: the plain face crater, as a head hit (the head's share of the meter).
      {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
        const ok = await force(z.id, "middle", 0, 0, H_FLAIL_OPEN);
        const sel = await evaluate(`__sdfGame.selectSlot("flail")`); await stepN(40);
        await evaluate("__sdfGame.flail.setHitStop(false); __sdfGame.flail.setImpactFx(false); 1");
        await look(hc, H_FLAIL_D, f); await stepN(2);
        // The meter the seam reports is the actor's last step's: a one-frame thaw either side of the hit.
        await thaw(1);
        const m0 = await meterOf(z.id), w0 = (await woundsOf(z.id)).length, pre = await evaluate("__sdfGame.flail.state()");
        await evaluate("__sdfGame.flail.click()");
        let post = pre; for (let i = 0; i < 90 && post.strikes === pre.strikes; i++) { await stepOne(); post = await evaluate("__sdfGame.flail.state()"); }
        await thaw(1);
        const m1 = await meterOf(z.id), ws = (await woundsOf(z.id)).slice(w0), hs = await hstate(z.id), ls = post.lastStrike;
        const feel = await evaluate(`(async () => { const F = await import("/src/lab/sdf-zombie/webgpu/game-flail.ts"), K = await import("/src/lab/sdf-zombie/webgpu/flail-strike.ts"); return { credit: F.FLAIL_FEEL.swing[${J(ls?.side ?? "R")}].meterCredit, scale: K.FLAIL_HEAD.meterScale, r: K.FLAIL_HEAD.faceCraterR }; })()`);
        out.hFlail = { side: ls?.side, hits: ls?.hits, headHits: ls?.headHits, meter: [m0, m1], newWounds: ws.map((q) => ({ limb: q.limb, r: +q.radius.toFixed(3) })), headState: hs };
        await hShot(z.id, f);
        check(ok && sel?.ok && post.strikes === pre.strikes + 1 && ls?.hits?.includes(z.id) && (ls.headHits?.[z.id] ?? 0) >= 1 && hs === null && ws.length === 1 && Math.abs(ws[0].radius - feel.r) < 1e-9,
          `H: a flail head hit on a split head stamps the plain face crater and no head damage state (strike ${ls?.side}, head hit ${ls?.headHits?.[z.id]}; ${J(out.hFlail.newWounds)}; state ${J(hs)})`);
        check(Math.abs((m1 - m0) - feel.credit * feel.scale) < 1e-9, `H: it credits the head's share of the collapse meter: ${(m1 - m0).toFixed(5)} (${feel.credit} x ${feel.scale} = ${(feel.credit * feel.scale).toFixed(5)}; the full swing would be ${feel.credit})`);
      }
      // (3) a head the head damage leaf already holds refuses to split, and still dies on chop 3.
      {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
        const p = await surfHit(z.id, add(fr.centre, mul(f, 0.5)), mul(f, -1));
        const hit = await evaluate(`__sdfGame.head.hit(${z.id}, ${p[0]}, ${p[1]}, ${p[2]}, ${-f[0]}, ${-f[1]}, ${-f[2]}, "R")`);
        await stepN(3);
        const hs0 = await hstate(z.id);
        const splits = [], phases = [];
        for (const side of ["H", "R", "L"]) {
          await look(await headOf(z.id), HEAD_D, f);
          await chop(z.id, side); await stepN(SPRING_FRAMES >> 1); splits.push(await stateOf(z.id));
          await thaw(3); phases.push(await actorPhase(z.id));
        }
        out.hHeld = { hit, hits: hs0?.hits, splits, phases, chops: (await evaluate("__sdfGame.axe()")).heads[z.id] };
        await hShot(z.id, f);
        check(hit === true && !!hs0 && splits.every((s) => s === null), `H: a head that head damage holds (${hs0?.hits} hit) refuses to split on all three chops (${J(splits)})`);
        check(phases[0] === "standing" && phases[1] === "standing" && phases[2] !== "standing" && out.hHeld.chops === 3, `H: it still dies on chop 3 (phases ${J(phases)}, ${out.hHeld.chops} chops counted)`);
        sheet("H-head-damage", hTiles);
      }
    } catch (e) { await threw("H", e); }
    await diag("range");
  } catch (e) { await threw("boot 2", e); } finally { if (S) { closeSession(S); S = null; } }
  // ======== BOOTS 3 and 4. B: bounds. Each preset at full angle, from the front at 0.6 m and from above and behind:
  // the shipped path's hit mask against the per-body path with every march bound off and the proxy box grown (the
  // field alone), the same zombies and cameras. The closed head's own count is the instrument's floor.
  if (run("B")) try {
    const shots = {}, tiles = [];
    for (const mode of ["ship", "free"]) {
      await boot(`bounds-${mode}`, mode === "free" ? "&crowd=0" : ""); await loadRules();
      if (mode === "free") await evaluate("__sdfGame.setShell(false); __sdfGame.setOccluder(false); __sdfGame.setCone(false); __sdfGame.setTemporalStart(false); __sdfGame.setDepthPrepass(false); 1");
      /** The proxy box grown 1.8 x about its centre (mesh, bodyHalf and record), so the box clips nothing. */
      const freeBox = (id) => evaluate(`(() => { const v = __sdfGame.zombie(${id}).view; v.object.scale.multiplyScalar(1.8); v.uniforms.bodyHalf.value.multiplyScalar(1.8); v.syncRecord(); return 1; })()`);
      for (const [name, [preset, sides, offset]] of Object.entries(SCEN)) {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
        const rec = (shots[name] ??= { cams: {}, ship: {}, free: {}, headAt: {} });
        rec.headAt[mode] = hc;
        if (mode === "ship") { rec.cams.front = (await look(hc, B_FRONT_D, f)).pose; rec.cams.top = await topCam(hc, f); }
        for (const state of ["closed", "open"]) {
          if (state === "open") { const ok = await force(z.id, preset, sides, offset, 1); if (!ok) fail(`B: forceSplit ${name} (${mode})`); rec.w = await splitOf(z.id); }
          if (mode === "free" && state === "open") { await freeBox(z.id); await stepOne(); }
          for (const cn of ["front", "top"]) {
            await setCam(rec.cams[cn]); await syncCam(); await settle(SETTLE);
            const t = await readF();
            rec[mode][`${state}-${cn}`] = t;
            if (state === "open") rec[`disc-${cn}-${mode}`] = await regionDisc(rec.w, t);
            if (mode === "ship" && state === "open") { const img = await capture(); tiles.push({ img, c: await toPx(add(rec.w.h, [0, 0.12, 0])) }); }
          }
        }
      }
      await diag(`bounds-${mode}`); closeSession(S); S = null;
    }
    out.b = [];
    // The sheet: per view, the two hit masks about the region (grey both, red the field alone only: clipped on the
    // shipped path; blue the shipped path only; yellow both, at depths over B_DEPTH apart), 2 x 2 px a texel.
    const BW = 150, sheetRgb = Buffer.alloc(6 * BW * 2 * BW * 2 * 3); let col = 0;
    for (const [name, rec] of Object.entries(shots)) for (const cn of ["front", "top"]) {
      const disc = rec[`disc-${cn}-ship`], row = { preset: name, cam: cn };
      for (const state of ["closed", "open"]) {
        const a = rec.ship[`${state}-${cn}`], b = rec.free[`${state}-${cn}`];
        let clipped = 0, shipOnly = 0, hits = 0, depthOff = 0;
        for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { if (d2([x + 0.5, y + 0.5], disc.c) > disc.R + 4) continue; const i = y * a.w + x, ha = hitAt(a, i), hb = hitAt(b, i);
          if (hb) hits++; if (hb && !ha) clipped++; if (ha && !hb) shipOnly++;
          if (ha && hb && Math.abs(a.f[i * 4 + 3] - b.f[i * 4 + 3]) > B_DEPTH * Math.max(Math.abs(b.f[i * 4 + 3]), 1e-6)) depthOff++; }
        row[state] = { clipped, shipOnly, depthOff, hits };
        if (state === "open") for (let y = 0; y < BW * 2; y++) for (let x = 0; x < BW * 2; x++) {
          const sx = Math.round(disc.c[0] - BW / 2) + (x >> 1), sy = Math.round(disc.c[1] - BW / 2) + (y >> 1), o = ((y * 6 * BW * 2) + col * BW * 2 + x) * 3;
          if (sx < 0 || sy < 0 || sx >= a.w || sy >= a.h) continue;
          const i = sy * a.w + sx, ha = hitAt(a, i), hb = hitAt(b, i);
          const off = ha && hb && Math.abs(a.f[i * 4 + 3] - b.f[i * 4 + 3]) > B_DEPTH * Math.max(Math.abs(b.f[i * 4 + 3]), 1e-6);
          const c = off ? [230, 200, 0] : ha && hb ? [90, 90, 90] : hb ? [255, 0, 0] : ha ? [0, 110, 255] : [0, 0, 0];
          sheetRgb[o] = c[0]; sheetRgb[o + 1] = c[1]; sheetRgb[o + 2] = c[2];
        }
      }
      col++;
      row.drift = +len(sub(rec.headAt.ship, rec.headAt.free)).toExponential(1);
      out.b.push(row); note(`B: ${J(row)}`);
      const o = row.open, c = row.closed;
      // A bound that is too tight CLIPS (the field alone hits, the shipped path does not) or lands the hit on a surface
      // behind (both hit, depths apart); the extra texels are the two paths' different ray starts on a rim, reported.
      check(row.drift < 1e-6 && o.hits >= B_MIN_HITS && o.clipped <= c.clipped + B_MARGIN && o.depthOff <= c.depthOff + B_DEPTH_MARGIN,
        `B: ${name}, ${cn}: the shipped path clips nothing off the open head: ${o.clipped} of the field's ${o.hits} hit texels missing (the closed head's floor ${c.clipped}, + ${B_MARGIN} allowed), ${o.depthOff} at another depth (floor ${c.depthOff}, + ${B_DEPTH_MARGIN}); ${o.shipOnly} extra (closed ${c.shipOnly})`);
    }
    writeFileSync(`${OUT}/B-bounds-masks.png`, encodePng(6 * BW * 2, BW * 2, sheetRgb)); console.log(`  sheet ${OUT}/B-bounds-masks.png (6 views)`);
    sheet("B-bounds", tiles);
  } catch (e) { await threw("B", e); } finally { if (S) { closeSession(S); S = null; } }
  // ======== BOOT 5. T: S on a turned zombie (the ring walks until one stands about 90 degrees round, then freezes);
  // then J: the wobble, on another zombie of the ring.
  if (run("T") || run("J")) try {
    await boot("turned"); await loadRules();
    if (run("T")) try {
      await evaluate("__sdfGame.freeze(false)");
      let pick = null, frames = 0;
      for (; frames < T_MAX_FRAMES && !pick; frames += 10) {
        await stepN(10);
        const zs = (await evaluate("__sdfGame.actorList()")).filter((q) => q.kind === "zombie" && pool.some((p) => p.id === q.id));
        pick = zs.filter((q) => Math.abs(Math.sin(q.yaw)) >= T_SIN_MIN && q.phase === "standing").sort((a, b) => Math.abs(Math.sin(b.yaw)) - Math.abs(Math.sin(a.yaw)))[0] ?? null;
      }
      await evaluate("__sdfGame.freeze(true)");
      if (pick) usedZ.add(pick.id);
      if (!pick) die(`T: no ring zombie turned to |sin yaw| >= ${T_SIN_MIN} in ${T_MAX_FRAMES} frames`);
      await stepN(30);
      const yawNow = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === pick.id).yaw;
      const hc = await headOf(pick.id), f = await frontOf(pick.id);
      const front = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
      const shot0 = await capture(), px0 = await headPx(pick.id);
      const line = await gapLine(pick.id), eyeW = wedgeEye(line);
      const closedGap = await gapRead(line, await readFrom(eyeW, line.G0));
      await camAt(eyeW, line.G0); await syncCam();
      const s = await chopAndFollow(pick.id, "H", line, eyeW, front, [SPRING_FRAMES]);
      const t1 = AXE_HEAD.openAngles[0] * HEAD_SPLIT.presets.middle.maxBoth, rest = s.frames.at(-1).gap, pred = gapPredicted(line, t1, -t1);
      const w = await splitOf(pick.id), lineW = await gapLine(pick.id);
      out.t = { yawDeg: +(yawNow * 180 / Math.PI).toFixed(1), frames, state: s.state, restMm: +mm(rest), predictedMm: +mm(pred), planeDotFrame: w ? +dot(w.n, line.n).toFixed(9) : null };
      check(Math.abs(Math.sin(yawNow)) >= T_SIN_MIN, `T: the body is turned (yaw ${out.t.yawDeg} deg, |sin| ${Math.abs(Math.sin(yawNow)).toFixed(2)} >= ${T_SIN_MIN}; ${frames} walking frames)`);
      check(s.n === 1 && s.state?.preset === "middle" && s.state.sides === 0 && s.state.angle === t1 && wobbleAtRest(s.state) && !!w && w.thetaP === t1 && w.thetaM === -t1 && dot(w.n, line.n) > 1 - 1e-9 && len(sub(lineW.G0, line.G0)) < 1e-9,
        `T: a chop from its front opens a centred middle split on the turned head's own plane, at rest on its angle with no offset (${J(s.state && { preset: s.state.preset, sides: s.state.sides, wobP: s.state.wobP, wobM: s.state.wobM })}; plane normal . head right ${out.t.planeDotFrame}; the gap lines ${len(sub(lineW.G0, line.G0)).toExponential(1)} m apart)`);
      check(closedGap === 0 && rest - pred >= -GAP_REST_UNDER && rest - pred <= GAP_REST_OVER, `T: the gap on the turned head is the CPU split's: ${mm(rest)} mm against ${mm(pred)} mm predicted (${mm(rest - pred)} mm off; allowed -${mm(GAP_REST_UNDER)} to +${mm(GAP_REST_OVER)}; closed ${mm(closedGap)} mm)`);
      sheet("T-turned", [{ img: shot0, c: px0 }, { img: s.photos[0], c: px0 }]);
    } catch (e) { await threw("T", e); }
    // -------- J. the halves wobble with the body and come to rest. After T: it ends by thawing the ring for good.
    if (run("J")) try {
      const z = fresh(); const W = HEAD_SPLIT.wobble, full = HEAD_SPLIT.presets.middle.maxBoth, deg = (r) => (r * 180 / Math.PI).toFixed(2);
      await setCam(spawn); await stepOne();
      const ok = await force(z.id, "middle", 0, 0, 1);
      // A frame's angles: the state (the spring's angle and each half's offset), the pose's split, the phase.
      const row = () => evaluate(`(() => { const w = __sdfGame.zombie(${z.id}).posed().split, st = __sdfGame.headSplit(${z.id});
        return { st, tp: w ? w.thetaP : null, tm: w ? w.thetaM : null, phase: __sdfGame.actorList().find((q) => q.id === ${z.id}).phase }; })()`);
      const atSpring = (q) => wobbleAtRest(q.st) && q.tp === q.st.angle && q.tm === -q.st.angle;
      const still = []; for (let i = 0; i < J_STILL; i++) { await stepOne(); still.push(await row()); }
      check(ok && still.every((q) => atSpring(q) && q.st.angle === full), `J: frozen and undriven, the halves stand at exactly the spring's angle for ${J_STILL} frames (${still[0]?.tp} / ${still[0]?.tm} rad; offsets ${still[0]?.st.wobP}, ${still[0]?.st.wobM})`);
      // THE SCRIPT, fed to the leaf, and what the pure step makes of the same list from the same state (in the page:
      // the same module, the same numbers).
      const seq = jScript(W.accelClamp);
      const fed = await evaluate(`(async () => { const H = ${HS}; const w = __sdfGame.zombie(${z.id}).posed().split, n = w.n, a = w.a, u = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
        const accs = ${J(seq)}.map(([s, b]) => [n[0] * s + u[0] * b, n[1] * s + u[1] * b, n[2] * s + u[2] * b]);
        let st = __sdfGame.headSplit(${z.id}); const ref = [];
        for (const acc of accs) { st = H.stepSplit(st, 1 / 60, H.wobbleDrive(w, acc)); ref.push([st.wobP, st.wobM, st.angle]); }
        return { ok: __sdfGame.headSplitDrive(${z.id}, accs), ref }; })()`);
      const run1 = []; for (let i = 0; i < seq.length; i++) { await stepOne(); run1.push(await row()); }
      const last = run1.at(-1);
      const offPure = run1.filter((q, i) => q.st.wobP !== fed.ref[i][0] || q.st.wobM !== fed.ref[i][1] || q.st.angle !== fed.ref[i][2]).length;
      check(fed.ok === true && offPure === 0, `J: the leaf steps the scripted drive exactly as the pure step does the same list: ${offPure} of ${run1.length} frames differ (the last ${last.st.wobP} / ${last.st.wobM} rad against ${fed.ref.at(-1)[0]} / ${fed.ref.at(-1)[1]})`);
      // The walk's part: each half off the spring's angle, and the two apart.
      const walk = run1.slice(0, 60);
      const peakP = Math.max(...walk.map((q) => Math.abs(q.st.wobP))), peakM = Math.max(...walk.map((q) => Math.abs(q.st.wobM))), apart = Math.max(...walk.map((q) => Math.abs(q.tp + q.tm)));
      out.j = { frames: run1.length, peakPDeg: +deg(peakP), peakMDeg: +deg(peakM), apartDeg: +deg(apart) };
      check(peakP >= J_MOVED && peakM >= J_MOVED && apart >= J_APART,
        `J: under a walk's bob and sway each half swings off the spring's angle: the + half by up to ${deg(peakP)} degrees, the - half ${deg(peakM)} (>= ${deg(J_MOVED)}), the two up to ${deg(apart)} apart (>= ${deg(J_APART)})`);
      // THE LIMITS, on every frame, from the constants: the offset within max x the spring's angle, the half never
      // nearer shut than minOpen, never past the full angle x (1 + over) but where the spring alone takes it. And
      // the hard throws take each half INTO both stops: it is the stops that hold it.
      const inside = (q, x) => Math.abs(x) <= W.max * q.st.angle + J_EPS && q.st.angle + x >= Math.min(q.st.angle, W.minOpen) - J_EPS && q.st.angle + x <= Math.max(q.st.angle, full * (1 + W.over)) + J_EPS;
      const outside = run1.filter((q) => !inside(q, q.st.wobP) || !inside(q, q.st.wobM)).length;
      const at = (x, q, sign) => Math.abs(x - sign * W.max * q.st.angle) <= J_EPS;
      const stops = { plusShut: run1.filter((q) => at(q.st.wobP, q, -1)).length, plusOpen: run1.filter((q) => at(q.st.wobP, q, 1)).length, minusShut: run1.filter((q) => at(q.st.wobM, q, -1)).length, minusOpen: run1.filter((q) => at(q.st.wobM, q, 1)).length };
      const totals = run1.flatMap((q) => [q.tp, -q.tm]), worst = Math.max(...run1.flatMap((q) => [Math.abs(q.st.wobP), Math.abs(q.st.wobM)]));
      out.j.limits = { outside, stops, minDeg: +deg(Math.min(...totals)), maxDeg: +deg(Math.max(...totals)), worstOffsetDeg: +deg(worst) };
      check(outside === 0 && Math.min(...totals) >= W.minOpen && Object.values(stops).every((k) => k >= 1),
        `J: both halves stay inside the wobble's limits on every frame, and the hard throws drive each into both stops: openings ${deg(Math.min(...totals))} to ${deg(Math.max(...totals))} degrees (the spring's ${deg(full)}; the offset within ${W.max} of it, never under ${deg(W.minOpen)} or over ${deg(full * (1 + W.over))}); ${outside} frames outside, the largest offset ${deg(worst)} degrees; frames at a stop ${J(stops)}`);
      const poseOff = run1.filter((q) => q.tp !== q.st.angle + q.st.wobP || q.tm !== -(q.st.angle + q.st.wobM)).length, turned = run1.filter((q, i) => i > 0 && (q.tp !== run1[i - 1].tp || q.tm !== run1[i - 1].tm)).length;
      check(poseOff === 0 && turned >= run1.length / 2, `J: every frame the frozen actor's pose carries exactly the state's two angles, the spring's and each half's own offset (${poseOff} of ${run1.length} frames differ; the pose's angles moved on ${turned})`);
      // Held on the script's last swing, the eye brought into the split's draw distance by a tick of no time (the
      // halves do not move): the two angles are the only way the wobble travels. The GPU record's angle lanes (N.w
      // and A.w of the open slot, floats) are the pose's, and the skull's copies are drawn at the stage's share of
      // each half's own.
      const swung = (q) => Math.max(Math.abs(q.st.wobP), Math.abs(q.st.wobM)) >= J_MOVED && Math.abs(q.tp + q.tm) >= J_APART;
      const sp = await splitOf(z.id), f2 = await frontOf(z.id), e2 = add(sp.h, mul(f2, J_EYE_D));
      await camAt([e2[0], Math.max(EYE_H, e2[1]), e2[2]], sp.h); await syncCam(); await syncCam();
      const held = await row(), bd = await boneDrawn(z.id);
      const rec = await evaluate(`(() => { const r = __sdfGame.zombie(${z.id}).view.records.floats; for (let q = 0; q * 84 < r.length; q++) if (Math.hypot(r[q * 84 + 68], r[q * 84 + 69], r[q * 84 + 70]) > 0.5) return [r[q * 84 + 71], r[q * 84 + 79]]; return null; })()`);
      out.j.swing = { tp: last.tp, tm: last.tm, rec, bone: bd };
      check(swung(last) && held.tp === last.tp && held.tm === last.tm && !!rec && rec[0] === Math.fround(last.tp) && rec[1] === Math.fround(last.tm),
        `J: held on a swing (${deg(last.tp)} / ${deg(-last.tm)} degrees, the spring's ${deg(last.st.angle)}), the GPU record carries the pose's two angles (${J(rec)} against ${last.tp.toFixed(6)} / ${last.tm.toFixed(6)} rad, as floats), which a tick of no time left alone`);
      check(bd.plus !== null && Math.abs(bd.plus - bd.ruleP) <= M_ANGLE_TOL && Math.abs(bd.minus - bd.ruleM) <= M_ANGLE_TOL && Math.abs(bd.ruleP - bd.ruleM) > M_ANGLE_TOL,
        `J: the skull's copies are drawn at the stage's share of each half's own angle: ${bd.plus === null ? null : deg(bd.plus)} / ${bd.minus === null ? null : deg(bd.minus)} degrees against ${deg(bd.ruleP)} / ${deg(bd.ruleM)} (worst ${bd.plus === null ? null : Math.max(Math.abs(bd.plus - bd.ruleP), Math.abs(bd.minus - bd.ruleM)).toExponential(1)} rad off <= ${M_ANGLE_TOL})`);
      // The script is spent: at rest within the settle time, exactly on the spring's angle, and it stays.
      const bound = wobbleRestFrames(full), n = await restWobble(z.id);
      const after = []; for (let i = 0; i < J_STILL; i++) { await stepOne(); after.push(await row()); }
      out.j.rest = { frames: n, bound, phase: after.at(-1)?.phase };
      check(n > 0 && n <= bound && after.every((q) => atSpring(q) && q.st.angle === full),
        `J: the drive over, the halves are back at exactly the spring's angle ${n} frames on (the wobble's settle bound from its constants: ${bound}) and stay for ${J_STILL} more (${after.at(-1)?.tp} / ${after.at(-1)?.tm} rad; phase ${after.at(-1)?.phase})`);
      // OBSERVED, NOT CHECKED: the cast thawed, the player at the spawn, how far this zombie's own wander swings its
      // halves. A wander is the ring's to choose (it also stands still), so nothing here can fail the gate.
      await setCam(spawn);
      await evaluate("__sdfGame.freeze(false)");
      const wander = []; for (let i = 0; i < J_WANDER; i++) { await stepOne(); wander.push(await row()); }
      await evaluate("__sdfGame.freeze(true)");
      const wp = Math.max(...wander.map((q) => Math.abs(q.st.wobP))), wm = Math.max(...wander.map((q) => Math.abs(q.st.wobM)));
      out.j.wander = { frames: wander.length, peakPDeg: +deg(wp), peakMDeg: +deg(wm), phases: [...new Set(wander.map((q) => q.phase))] };
      note(`J: (observed, ungated) thawed for ${J_WANDER} frames this zombie's own wander swings its halves by up to ${deg(wp)} and ${deg(wm)} degrees off the spring's angle (phases ${J(out.j.wander.phases)})`);
    } catch (e) { await threw("J", e); }
    await diag("turned");
  } catch (e) { await threw("boot 5 (T, J)", e); } finally { if (S) { closeSession(S); S = null; } }
  // ======== BOOT 6 (?sculpt=classic). M ON THE SCULPTED SKULL'S FIRST LOOK, and nothing else: its split copies' turn,
  // count, materials and paint and the eyes' landmark, on the forced head and at the three real chops (chopsForSkull:
  // the chops alone). No other boot draws the first sculpt, or a head on the first paint's split material.
  if (run("M")) try {
    await boot("classic", "&sculpt=classic"); await loadRules();
    const tag = "M (the sculpted skull's first look)";
    try { await skullLandmarkForced(tag, "-classic"); } catch (e) { await threw(`${tag}, the forced head`, e); }
    try { skullStageChecks(tag, "-classic", await chopsForSkull(fresh())); } catch (e) { await threw(`${tag}, the chopped head`, e); }
    await diag("classic");
  } catch (e) { await threw("boot 6 (classic)", e); } finally { if (S) { closeSession(S); S = null; } }
  // ======== BOOT 7 (?skull=anatomical). THE ANATOMICAL SKULL: M on it, the same two ways, and its plates (P, last:
  // its fragments stay in the room).
  if (run("M") || run("P")) try {
    await boot("anatomical", "&skull=anatomical"); await loadRules();
    const tag = "M (anatomical skull)";
    if (run("M")) {
      try { await skullLandmarkForced(tag, "-anatomical"); } catch (e) { await threw(`${tag}, the forced head`, e); }
      try { skullStageChecks(tag, "-anatomical", await chopsForSkull(fresh())); } catch (e) { await threw(`${tag}, the chopped head`, e); }
    }
    await platesScenario();
    await diag("anatomical");
  } catch (e) { await threw("boot 7 (anatomical)", e); } finally { if (S) { closeSession(S); S = null; } }
}
check(FLOOR.colour <= FLOOR_COLOUR_MAX && FLOOR.depth <= FLOOR_DEPTH_MAX, `C: the instrument's floor over the run: the two reads of each of ${FLOOR.captures} settled captures differ by at most ${FLOOR.colour.toExponential(1)} in colour and ${FLOOR.depth.toExponential(1)} in clip depth (<= ${FLOOR_COLOUR_MAX}, ${FLOOR_DEPTH_MAX})`);
/** The skull each boot means to draw: the default (the sculpted skull, `full`) unless its label says otherwise. */
const SKULL_OF_BOOT = { classic: "sculpt classic", anatomical: "anatomical" }, SKULL_DEFAULT = "sculpt full";
const wrongSkull = Object.entries(out.skulls).filter(([label, skull]) => skull !== (SKULL_OF_BOOT[label] ?? SKULL_DEFAULT));
check(Object.keys(out.skulls).length > 0 && wrongSkull.length === 0, `C: every boot draws the skull it means to: the default (no skull parameter), which is the sculpted skull, full; the first look on the classic boot; the anatomical skull on the boot that asks for it (${Object.entries(out.skulls).map(([label, skull]) => `${label}: ${skull}`).join(", ")})`);
note(`wall clock by boot (s, from the page's load to the boot's last check; ungated): ${Object.entries(out.wall).map(([label, t]) => `${label} ${t}`).join(", ")}`);
const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
{ const k = depthGuardControl(); check(depthGuardControlOk(k), `C: ${depthGuardControlLine(k)}`); }
// A subset that read the march target nowhere (ONLY=M, ONLY=P) has nothing for the guard to look at: said, and not a
// failed check. The gate itself, every scenario run, must have captures.
if (ONLY && DEPTH.captures === 0) console.log(`\nC: THE DEPTH GUARD DID NOT RUN: this subset (ONLY=${[...ONLY].join(",")}) made no capture of the march target. Not counted.`);
else check(depthGuardOk(DEPTH), `C: ${depthGuardLine(DEPTH)}`);
check(errs.length === 0, `C: zero console errors or exceptions across the run (${errs.length}${errs.length ? ": " + J(errs.slice(0, 3)) : ""})`);
const dirty = Object.entries(out.diag).filter(([, d]) => !d || d.lost || d.uncapturedCount !== 0);
check(Object.keys(out.diag).length > 0 && dirty.length === 0, `C: gpuDiagnostics clean at the end of every boot (${Object.keys(out.diag).join(", ")}: no device loss, uncapturedCount 0${dirty.length ? "; DIRTY " + J(dirty) : ""})`);
console.log(`\nsummary: ${J(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
