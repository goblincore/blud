# Motion polish task 5 — face tracks travel in every quadrant; knees hinge forward (2026-08-17)

Owner playtest after 4b: the body walked one direction with the head/arms
turned ~180° from travel (quadrant-dependent — "often wrong", not "always
wrong"), and the knees bent BACKWARD ("a cow standing up").

## Root causes (both fixed at the source, verified empirically before/after)

### 1. The 180° face was NOT a sign flip — it was a missing azimuth

The heading chain convention is consistent end to end (pinned in
`facing-chain.test.ts`'s header): yaw 0 = facing **+z**, positive = clockwise
seen from above; `wander.headingDir(yaw) = [sin, 0, cos]`; `gait.rotateYaw`
agrees; the body is authored facing +z. (`fpv.ts`'s yaw=0 = −z is the PLAYER
camera's convention and never enters the zombie chain.) A probe walking the
real pipeline toward +x/−x/+z/−z showed the head **rig point** leading
identically in all quadrants (0.143 m) — the sim was never wrong.

The loss was in `rig-bind.ts`'s rigid head pass: it derived the face
rotation as a bare `qFromTo(restDir, clamped)` shortest arc, but the
neck→head axis is near-VERTICAL in every walking direction, so a shortest
arc between the rest and solved directions carries pitch and **zero
azimuth** — a 180° body turn about the head's long axis is invisible to it.
Result: nose prim lead 0.172 m walking +z, 0.022 m walking −z (±x: ~0.10,
sideways) — exactly the quadrant-dependent wrongness.

Fix: compose the yaw explicitly — `q = qMul(qFromTo(turnedRest, clamped),
qYaw)` in `headTransform` (posed prims + `prim.orient`) AND `headQuatOf`
(the painted-face projection; it also gained the missing `bodyYaw` param —
`lab-main` passes `lastBodyYaw`). The residual only ever expresses the
in-cone look-at tilt it can actually see.

### 2. The cow knee was two sources

- **Stance**: FABRIK preserves its start fold side, and `solvePlantedLeg`
  had no bend-side constraint — from a near-straight start, numerical drift
  folded the right knee 0.215 m BEHIND the hip→ankle axis and kept it
  there. Fix: `ik.ts poleReflect` — after the solve, a materially wrong-side
  mid joint is reflected across the root→end axis (segment lengths and the
  locked foot preserved exactly). `motion.ts` passes `headingDir(bodyYaw)`
  (knees bow FORWARD); the clutch arm solve poles elbows DOWN (`[0,-1,0]`,
  the opposite rule). `IK_TUNING.poleDeadband` (0.02 m) keeps near-axis
  poses untouched — the AUTHORED rest knee sits ~1 cm behind the hip→ankle
  line (the feet drift +z), so without the deadband the bias fights the
  authored pose and breaks bit-exact idle frames.
- **Swing**: gait.ts's swing knee offset sat BEHIND the hip
  (`-kneeBend`) while the foot reached +0.32 m forward — a backward hinge
  by construction at full reach. Fix: the knee now tracks half the foot's
  reach (`kneeTrack` 0.5) plus a forward bow (`kneeBend`), so it stays on
  the +z side of the hip→foot line through the whole swing.

FABRIK caveat found while testing: a knee hint EXACTLY on the hip→plant
line is the degenerate collinear start — the solve converges only linearly
from there (the pole bias governs the fold SIDE, not the iteration count).

## Verification

- `npx tsc --noEmit` clean; `npm test`: 97 files / **1301 tests** green,
  including the new regressions:
  - `ik.test.ts` — poleReflect side/length-preservation/deadband/degenerate
    cases, elbows-down rule, solvePlantedLeg yields a forward knee from
    forward/backward/near-axis/far-side start poses.
  - `rig-bind.test.ts` — the posed nose leads along the applied yaw and
    `headQuatOf` agrees, for yaw ∈ {0, ±π/2, π, 2.4}.
  - `gait.test.ts` — the swing knee offset is always ahead of half the
    foot's forward offset (the on-line position).
  - `facing-chain.test.ts` — the REAL pipeline (buildBody → bindRig →
    stepMotion → stepRig → applyRig) walked toward +x/−x/+z/−z: posed nose
    prim leads the chest (avg > 0.12, min > 0.05; measured 0.172 every
    direction), reach hands travel-side (> 0.3; measured ~0.57), neither
    knee ever > 0.04 m behind the hip→ankle axis (pre-fix: 0.215).
- Browser (vite :5317, CDP :9223, WebGPU): `scripts/verify-motion-polish-5.mjs`
  watched two full wander legs (3 arrivals, all four quadrants, screenshots
  `t5-walk-*.png` here); `scripts/verify-motion-polish-5b.mjs` measured the
  RENDERED pose in-page via `__sdfLab.heroPosed()` (the exact `applyRig`
  output the shader draws — new one-line peek) over 6 arrivals:
  nose lead min 0.193–0.204 m in EVERY quadrant, arm lead min ≥ 0.269 —
  PASS. No synthetic pointer events (phantom-click trap); all control via
  `__sdfLab` APIs.
