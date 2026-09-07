# Soldier strafe grounding — 2026-09-07

The first-pass correction below was superseded after a second owner playtest.
See **Second playtest: fixed floor contacts** for the current implementation.

Owner report: `jellylegs.mov` showed aimed Soldiers moving laterally with
sideways-folding knees and springy, overextended legs.

## Causes and correction

- Yawing the forward clip into travel also yawed its knee bend sideways.
  `poleReflect` only selected a half-space; it allowed about 32 cm of sideways
  bow. Soldier aimed solves now align the knee with the body's forward hinge
  plane while preserving both segment lengths.
- Planted-leg IK solved an unreachable target, then restored the original
  ankle contact anyway. The resulting shin target could be about 39 cm too
  long, fighting the Verlet length constraints. Aimed Soldier contacts now
  stay inside the reachable floor disk, and the solve retains its endpoint.
  This applies to forward/backward travel too: limiting the floor correction
  to lateral movement introduced unsupported forward poses during review.
- The forward clip's roughly 30 cm boot lift was unsuitable for a sideways
  shuffle. Lateral movement blends toward shorter, lower steps, faster
  cadence, and 5.5 cm of stance flexion. Tuning lives in `SOLDIER_STRAFE`.
- Travel direction snapped back to body yaw on a stop, and releasing a plant
  jumped directly to the clip's current ankle position. Leg travel yaw is
  retained at a stop and damped on turns. Soldier swings blend from the actual
  released contact over 120 ms, maintaining separate foot lanes.

## Verification

- 151 focused tests pass across motion, gait, gait pins, IK, actor, and
  WebGPU Soldier actor tests. New checks cover both lateral directions,
  rotated body headings, 30/60/120 Hz, reversals, stops, exact-forward,
  near-forward, and backward floor support.
- TypeScript no-emit check passes. This was not a full project test/build or
  GPU performance benchmark.
- Deterministic WebGPU combat captures were inspected; no browser errors.
  The capture used room 5's mixed encounter and the default renderer.
- Independent pure-motion review measured worst stop-frame ankle displacement
  falling from about 51 cm in the initial correction to 4.6 cm after release
  smoothing; reversal worst displacement was about 7 cm/frame.

This corrects the existing clip/IK pipeline rather than introducing a new
footstep planner. A support can still slide when its original world lock
leaves the reachable floor disk. Forward clip landing discontinuities remain
a separate preexisting limitation. Final animation feel should be judged in
manual playtesting before committing or integrating the change.

## Second playtest: fixed floor contacts

Owner feedback: improved, but still gliding and too smoothly springy; knees
needed more visible flexion. The first pass's reachable-disk projection still
moved the support foot with the root. A steady strafe measured 1.52 cm of
average support-target sliding per frame. The real Verlet rig added spring
motion even when target geometry was valid.

Current implementation replaces that approach:

- `soldier-footwork.ts` plans alternating, distance-triggered combat steps.
  Each support remains fixed in world space. Root progress waits when a foot
  must reposition, instead of dragging the contact along the floor. Pending
  steps finish and settle on stops; turns/reversals retain the current contact.
  Crowd/collision translations rebase the controller explicitly.
- A 180 ms foot transfer with 7 cm lift (4 cm on a wounded leg) produces a
  definite lift and touchdown. Foot-span and lane limits prevent crossing or
  splits. Desired AI speed is separate from temporary waits for foot support.
- The combat stance lowers by 11.5 cm and reserves 4 cm of extension, making
  the knees visibly flexed. `solveHingeLeg` uses an exact two-bone solve in the
  forward hinge plane. No iterative ankle drift or sideways knee bow.
- `RigState.posePins` makes the calm combat pelvis/hips/legs follow that pose
  firmly. Both actor integration paths pass the pins. Hit reactions and recoil
  temporarily release them; collapse removes them. This avoids pinning joints
  with incompatible blast offsets. Original rig pin flags are restored.
- Removed the first pass's lateral clip scaling, yaw/release smoothing,
  `poleAlign`, and moving floor-disk correction. Other locomotion modes retain
  their existing generic gait/IK path.

Verification: **165 focused tests pass**, including actual-rig contact and
blast checks, stop/reversal and 30/60/120 Hz tests, longitudinal support,
wounded movement, falls, and corpse handling. **TypeScript passes.** Calm
support contacts show zero drift in the steady-strafe probe; supporting knees
remain visibly flexed. Final default-renderer WebGPU capture inspected with
zero browser errors. Temporary test browser cleaned up; the playtest server
remains on port 5188. No full project test/build or GPU benchmark claimed.

Independent review found no remaining actionable regression. Changes remain
local and uncommitted for the owner's next feel check.


## Third playtest: heavier proportions

Owner approved the bent-knee stance, then requested approximately 1.2x size
including kit/weapon, shorter upper legs, and wider flared boots. Their
close-range screenshot put the original crown below the default crosshair.

- Authored Soldier body dimensions enlarged 1.2x. Thigh length changes from
  0.42 to 0.38 before scaling (new thigh 0.456 m, shin 0.504 m). Root lowered
  by the removed thigh height to retain boot-floor alignment. Nominal height
  becomes 1.992 m, about 17% taller after the proportion correction.
- WAM kit enlarged with matching skeleton changes and regenerated using
  `bash scripts/build-wam-kit.sh soldier`. Knee shield shifted to the shorter
  thigh's joint. Boots gain another 25% width and about 12% length beyond the
  overall enlargement, plus a deeper ankle flare. Small outward offsets keep
  the broader soles separated at ease.
- Soldier prop profile now carries scale 1.2. GunPose carries it through
  arm/grip IK, muzzle calculation, rendered transform, recoil pivot and drop.
  The shared weapon asset and first-person viewmodel remain their authored size.
- Combat footwork/stance tuning retained. New anatomy's 4-second lateral
  contact probe: zero support target slip, minimum supporting-knee flexion
  42.8 degrees, 4.18 m root progress.

Verification: 133 focused tests across motion, rig, actor, footwork, Soldier
injury/corpse, carry, profile and compiled kit fit; plus the held-prop lifecycle
test extended to compare rendered grip/muzzle through scaled recoil/drop and
unscaled respawn (134 total). TypeScript passes. Kit skeleton fits within 1 mm
and soles pass the existing floor check. Existing stock/arm checks now use
proportional distances, and the collar sampling region tracks the new torso.
Independent review found no actionable issues. WebGPU gameplay and default-eye
close-up captures were inspected, with zero browser exceptions. Local changes
remain uncommitted; playtest server stays on port 5188.


## Fourth playtest: knee-high boots

Owner spotted shin flesh clipping through the short shafts and requested
full lower-leg coverage. The former shaft started at 55% of the shin; its
outward offset also reduced the clearance at the inner facets.

Extended the shaft to 4.5% below the knee, under the knee shield, while
preserving its lower endpoint inside the foot. Added a wider calf and taper
with clearance on the inner side. The shaft follows the shin; the unchanged
foot remains level on its own bone. Rebuilt the compiled kit from WAM.

Added a compiled-mesh fit check: rays intersect actual triangle faces at seven
shin heights below the knee shield and 32 azimuths per side (448 samples),
requiring continuous coverage and over 8 mm clearance from the body.
84 focused motion/kit/damage tests and TypeScript pass. Independent review
confirmed the lower endpoint is preserved within about 1 micrometre. Inspected
WebGPU strafing frames with full-length boots and no browser exceptions. The
first capture was interrupted by a test-page reload; the retry completed.
Temporary browser cleaned up; port 5188 retained for playtesting.


## Fifth playtest: grounded patrol walk and stooped posture

Owner reported the default walk still felt jelly-like/weightless and asked
for a forward-hunched, bent-knee stance. The planted controller had been gated
on faceHeading, so unalerted patrol still used the old clip and spring rig.

Real Soldier locomotion now shares fixed world support contacts in patrol,
idle and combat. Requested drive speed remains independent of foot-support
waits outside combat too. The forced-speed character-authoring treadmill
keeps its clip; explicit aimed previews retain their prior grounded path.
A non-combat posture blend reaches a 0.24 rad (~14 degree) torso hunch over
one third of a second, rotating above the hips without changing spine lengths.
Old clip oscillations fade by 75% in that walk. The existing bent-knee stance
and contact pins continue; posture eases back for aimed combat. Hit/fall gates
and the gun attachment solve are retained.

Verification: 121 focused tests pass across motion, actor/game wiring, rig,
footwork, carry and kit. The actual-rig support test now covers patrol as
well as strafing, including torso hunch, minimum knee flexion, no support
slip and continuing root travel. TypeScript passes. Independent 30/60/120 Hz
turn/reversal/stop/aim-transition probes found zero support-target slip,
continuous floor support, no deadlock and hand-target error below 1 mm.
Default-renderer WebGPU patrol frames inspected with no browser exceptions;
alerting was disabled only in the disposable capture browser to prevent the
nearby camera from triggering combat. Its final readback was idle/unalerted,
moving at 1.25 m/s. Temporary browser cleaned up; port 5188 left for playtest.


## Sixth combat playtest: pressure bursts

Owner wanted two or three consecutive shots and more pursuit pressure.
Current-source investigation found the director immediately released its
firing owner on every shot, cancelling the brain's follow-up. The brain also
repeated the full 0.7-second telegraph between shots and often chose singles.

Director now retains/refreshed firing ownership for 0.8 s after each shot,
long enough for a follow-up, then hands off after the burst. Eligibility still
requires sight, range, a clear allied firing lane and an able shooter.
Brain commits to two safe shots, with a 65% chance of a third; first telegraph
0.5 s, follow-up reacquisition 0.12 s, recovery 0.22 s. Burst cap remains three.
The post-burst settle is 0.22 s; new-burst cooldown 0.55 s, opportunity tick
0.65 s and acceptance 85%. Preferred range is 2.6 m with 0.6 m slack;
retreat starts at 1.6 m, movement endpoints can be 1.35 m away, and the
post-movement decision floor is 0.25 s. This closes on retreating players
sooner while retaining actual routes and friendly-lane coordination.

51 focused brain/director/game-actor tests and TypeScript pass. New tests cover
exact two/three-shot bursts and coordinated real brains producing 111222 shot
ownership without losing follow-ups. Independent 30/60/120 Hz probes confirmed
LOS, fire permission, range, facing and stagger still block follow-ups.
Actual WebGPU trace over 10 simulated seconds: Soldier 11 fired at
1.150/1.517/1.883, Soldier 12 at 3.767/4.133, Soldier 13 at 5.717/6.083, then
Soldier 11 at 8.033/8.400/8.767. Thus actual intra-burst gaps were 0.367 s.
No browser errors. Owned test browser cleaned up; playtest remains on 5188.

## Session integration

Owner approved integration into main and remote push. Default render FOV is
72 degrees; fisheye center FOV remains 60 degrees.

Production build and final TypeScript check pass. Full suite covered 237 files
and 3,717 tests: 234 files passed initially; two CLI suites needed unsandboxed
IPC access, and the zombie pursuit fixture needed its own engage-range input
instead of borrowing the newly reduced Soldier range. All three rerun suites
pass (18 tests), completing the suite with no unresolved failures.
The session-owned Vite server on port 5188 was stopped for wrap-up.
