# Elbow hyperextension after projectile hits

Date: 2026-09-04. Investigated revision: `133b9955def97095755ea353e7fba09fed985af8`.
Status: reproduced offline through the real actor path; no gameplay/solver fix implemented and no new dispatch task started.

## Finding

The elbow has no signed bend/hinge constraint. The rig only preserves pairwise bone lengths and pulls points toward animation rest targets. A backward elbow with correct upper/lower arm lengths satisfies every length constraint. Returning toward the authored pose later does not prevent an invalid pose now.

The projectile path also renders immediately after an unconstrained positional shove. `impulseAt` changes the nearest unpinned point's `pos` without changing `prev`. This creates immediate deformation and implicit Verlet velocity on the next step. `applyProjectileHit` runs sever checks, applies the rig and uploads the pose before `stepRig` runs again. Subsequent length-only solving cannot enforce an elbow bend direction.

Severing is separate: `cutLimbs` and `cutChains` test wound coverage across attachment/joint sections. They do not inspect joint angle or constraint strain. Therefore an arm can remain attached while it visibly folds backward.

## Reproduction and evidence

Run from repository root:

```sh
node --import tsx docs/dev-notes/2026-09-04-elbow-hyperextension/probe.ts
```

The probe loads the real zombie blob, uses real `createZombieActor`, `hit`/`hitSlug`, motion, rig and severing functions, and stubs only the renderer view. It traces a 1 mm-spaced ray through the real CPU body field to obtain a surface hit. It tests both arms, initial and 30-frame-warmed poses, pellet/slug, three forearm positions and six cardinal shot directions. It retains cases where the intended arm was hit without severing. This is a deterministic diagnostic grid, not a gameplay incidence estimate.

Each case has an identical unhit control actor. Angle is `atan2(dot(cross(upper, forearm), preHitBendNormal), dot(upper, forearm))`, in degrees, relative to the pre-hit bend plane. Negative means crossing to the opposite bend side. This is a signed diagnostic with a fixed per-case reference, not a clinically calibrated elbow-flexion measurement or an exact anatomical hinge axis. Immediate sign reversal is independent of subsequent gait changes. Paired controls distinguish the post-hit excursion from ordinary motion.

| Example | Before hit | Immediate upload | Worst within 12 frames | Unhit control at worst frame | Severs |
|---|---:|---:|---:|---:|---:|
| Single pellet, left forearm, initial pose | +14.94° | -9.67° | -38.35° at frame 2 | +15.43° | 0 |
| Single slug, right forearm, warmed pose | +18.99° | -21.75° | -92.39° at frame 3 | +19.01° | 0 |

Of 59 retained pellet cases, 11 reversed immediately; of 23 retained slug cases, 9 did. A separate three-point construction with exact 0.30 m segment lengths and a backward wrist is unchanged by four solver iterations with gravity/rest pull off. This isolates the missing angular constraint from game choreography.

`results.json` contains the full retained cases and control timelines. The script writes a fresh copy to `/tmp/blud-elbow-investigation/results.json`. This investigation did not capture a live GPU motion reel; the evidence is the real CPU pose sent to the view, with a stubbed renderer. Visual acceptance remains outstanding.

## Recommended correction

1. Give intact elbows a one-sided extension stop, a maximum-flexion limit and a stable bend-plane reference carried by the shoulder/upper-arm frame. Avoid a world-axis clamp: turning and reaching must rotate the joint's allowed motion. Handle mirrored sides, nearly straight arms and degenerate vectors explicitly. Exact tuning is an art decision, not a medical specification.
2. Resolve angular and length constraints together before every visible pose upload, including the immediate hit path, ordinary substeps and relevant post-constraint/collapse passes. Preserve the new metadata through every `RigState` reconstruction/rebind; the game and shared actor currently rebuild these objects explicitly.
3. Remove only forbidden normal velocity at the stop (consistent `pos`/`prev` handling), preserving tangential recoil. Otherwise a corrected position can be pushed through the stop again on the next Verlet step. Shoulder/body movement should absorb the visible reaction; increasing damping alone cannot enforce the rule.
4. Keep existing damage-driven elbow severing. If an overpowered hit should snap a weakened joint, make that an explicit additional damage rule feeding the existing distal sever path. Do not infer physical breaking force from the current unconstrained angle: the rig shove is positional and has no calibrated torque/strength model. Do not make every pellet that challenges a solver limit detach the arm.

The first fix should be the intact-joint constraint and immediate-upload ordering. Optional stress-triggered breakage can then be tuned as a separate gameplay decision. User allows either preventing the bend or detaching the arm; no specific breaking threshold was selected.

## Required future verification

Reproduce the two stored cases as regressions, plus both sides, turning 90/180°, reach/idle/walk, repeated pellets, reversed shot directions and varied frame steps. Assert on the immediate view update and every following posed frame, not just final recovery. Check signed extension, flexion, segment lengths, finite state, pinning, no stop jitter and preserved flinch. Verify healthy arms stay attached, existing qualifying wound cuts still sever and detached pieces are not constrained to the living arm. Capture a visible before/after motion reel before calling the appearance fixed.

## Code landmarks

- `src/lab/sdf-zombie/rig.ts:6`: length-only constraint type; `:45`: integration/rest pull/length relaxation.
- `src/lab/sdf-zombie/rig-bind.ts:101`: joint/bone constraint construction; `:428`: direct positional impulse.
- `src/lab/sdf-zombie/webgpu/game-actor.ts:325`: wound-driven sever checks; `:507`: impulse; `:515`: immediate pose upload.
- `src/lab/sdf-zombie/connectivity.ts:202`: `cutChains` joint-section coverage.
- `src/lab/sdf-zombie/rig.test.ts`: length/recovery tests, no angular invariant.
- `src/lab/sdf-zombie/gait.test.ts:115`: existing knee bend-side test covers authored gait targets, not post-impact elbow constraints.

## Tooling limitation

The networked DualMem consult was rejected by automatic approval review because project bug details could be sent to an external embedding service. The investigation continued entirely from local code and local probes. No external consult was retried or used, and these findings were saved as human-readable investigation artifacts instead.


## Update 2026-09-04 — intact elbow stop implemented

Local main now includes commit `1ba0472` (`fix: prevent intact zombie elbows bending backward on impact`). The user chose the intact-arm solution first. This is a one-sided bend-direction stop, not a full anatomical hinge or a new force-triggered severing rule.

The stop runs immediately after projectile impulse, during length-constraint relaxation, and after motion/floor correction. It preserves forearm length and permitted recoil, removes velocity driving through the stop, and only binds live upper-arm/forearm chains. Existing wound-driven severing is unchanged.

Two additional causes mattered during implementation:

- Flinch rest targets themselves can cross behind the elbow. The allowed side therefore comes from the authored arm pole, carried through body yaw and upper-arm swing, rather than the transient animation target.
- Small arm primitive endpoint offsets were fixed in world space. They now rotate with the bone so flesh and bone follow the constrained rig at full extension.

Bend metadata and heading survive actor reconstruction/rebinds; disabling lab motion resets the heading. A floor-contact fallback prevents the stop from pushing the wrist below ground.

Verification: 28 new regressions cover mirrored arms, immediate uploads and subsequent frames, pellet/slug impacts, 30/60/144 Hz steps, body turns, reversed flinch targets, near-straight/degenerate motion, permitted recoil, pinned wrists, floor contact and detached forearms. The full suite produced 3,129 passes plus 11 CLI cases blocked by sandbox IPC; those 11 all passed when rerun with local-pipe access. Total: 3,140 tests passed across the suite and targeted rerun. TypeScript passed. Code review found no remaining actionable issues.

A patched WebGPU smoke run accepted a forearm slug hit with both elbow stops still present and no browser exceptions. The captures were not adequate for visual acceptance; a later attempt to drive the public actor debug facade directly could not step it. The automated pose checks establish the bend-direction invariant, while the user should still playtest the feel/appearance of recoil. No performance improvement is claimed.

The original `results.json` remains the pre-fix evidence. Its fixed pre-hit-plane diagnostic is useful for reproducing the original bug but is not an exact anatomical frame once the arm swings. The new regression tests check the moving authored arm frame.

Tooling update: the user explicitly authorized DualMem consult/search, including relevant project context sent to configured external providers. The consult retry succeeded, resolving the earlier authorization limitation. The stable-pole and render-binding findings were saved to DualMem.


## Update 2026-09-04 — slug follow-up after failed playtest

The user still saw backward elbows on main after the first fix. Commit `e4714be` corrects the reference and adds a 150° forward-flexion cap. It is integrated into local main and pushed to origin/main.

The first fix used the rest forearm's perpendicular component as its bend pole. In this zombie, that component is dominated by sideways carrying angle, with a much smaller forward component. An inward/backward forearm could therefore satisfy the stored pole constraint while looking backward from the side. The original tests used the same pole as their oracle and missed this defect. Their passing results were insufficient evidence that the visual bug was resolved.

The follow-up derives body-forward from the mirrored shoulder axis and projects it perpendicular to the authored upper arm. It still carries that reference through body heading and upper-arm swing, independently of transient flinch targets. A second boundary limits forward flexion to 150° (a gameplay tuning value), preventing a strong upward impulse from folding the forearm completely onto the upper arm. Recoil velocity is clipped only against a limit actually in contact; review caught and regression-tested an inactive-limit clipping error.

The revised test oracle independently uses the zombie's known +Z forward direction. It checks both signed extension and the upper/forearm angle on every immediate and subsequent upload. Coverage includes new upward slug fixtures on both arms, both projectile types, 30/60/144 Hz steps, body turns, reversed flinch targets, length preservation, recoil, detached arms and floor contact.

The broader impact probe retained 87 nonsevered arm cases. Before this follow-up the worst forward-frame extension was -109.60°. Afterward every sampled pose stayed between 0° and 150° within floating-point tolerance (minimum approximately -1.6e-12°). These are deterministic diagnostic cases, not a gameplay incidence estimate. `forward-results.json` preserves the pre-follow-up results; `forward-fixed-results.json` preserves the corrected results. `forward-probe.ts` reruns the diagnostic against the current checkout and writes into /tmp.

Verification: 229 tests passed across 16 relevant motion/rig/gait/collapse/severing/actor files, including 36 focused elbow cases; TypeScript passed. This follow-up did not rerun the entire 3,140-test suite. A controlled left-forearm slug hit on the actual game actor ran in WebGPU with two elbow limits retained and no browser exceptions. Normal and flat-lighting screenshots were inspected, but the dark/overlapping silhouette remains insufficient for broad visual acceptance. Earlier weapon-path capture attempts missed their targets and are not counted as verification. Temporary actor debug hooks were removed before the commit. User playtesting remains the final check of appearance and feel.


## Update 2026-09-04 — wound clutch removed after torso-slug reproduction

The user clarified that the failing case was a torso slug in `sdf-game.html`, accompanied by impulse/stagger and sometimes the opposite orb hand emerging through the body. Earlier elbow probes shot forearms and did not exercise the torso-only wound-clutch reach.

A controlled real-actor probe retained 26 torso-slug cases across initial/30-frame/120-frame warmed motion, three lateral offsets and three heights. With the clutch present, 17 cases put a hand sphere into the torso; worst signed hand clearance was -0.0987 m. Diagnostic clutch suppression removed the hand penetration while preserving the impulse and lurch. The reach solved the arm toward a stored world-space wound position without arm/torso collision handling, and interacted with the later wrist angle corrections.

The user chose to remove the feature: “yeah maybe we dont need the wound clutch.” Commit `d133581` removes the clutch target override, state/helpers/tuning, and lab status/debug fields. It leaves wound damage, direct impulses, knockback, stagger and localized recoil in place. It is pushed to origin/main and integrated into local main.

Verification: 270 tests across 18 relevant files and TypeScript passed. The new nine-case torso-slug regression had six failures before the removal and all nine pass afterward. It checks both hand spheres against the posed torso field for 60 frames and also verifies the wound, lurch, root motion and no unintended sever. The full 26-case post-removal probe has zero hand penetrations and a minimum hand clearance of 0.0501 m. `torso-clutch-before.json` and `torso-clutch-after.json` preserve the sampled evidence; `torso-slug-probe.ts` reruns the current behavior.

Scope limit: sampled forearm overlap during strong stagger remains, worst approximately 0.02284 m after removal. This change removes the unsafe clutch reach; it does not implement whole-arm self-collision or establish that every perceived backward fold is eliminated.

Server discovery: port 5173 was serving `/Users/donny/Projects/blud/.claude/worktrees/fpv-shell-reload-animation-afd2fc`, not the main checkout. Its served rig already contained the elbow-angle fixes, but its motion module retained the clutch. The existing server was left running for that task. A main-checkout Vite server was started at `http://localhost:5174/sdf-game.html`; an HTTP read verified that its motion module has no `stepClutch` and still includes stagger/recoil. A sandboxed localhost connection failure had initially obscured this; the server was reachable with the authorized network access.


## User playtest confirmation — 2026-09-04

The user confirmed that removing wound clutch fixed the reported issue: “okay nice yeah that fixed the issue.” They had read the attempted clutch as an impossible elbow bend because the intended wound-grabbing action was not recognizable. The original torso-slug report is now resolved by `d133581`; the earlier elbow-limit adjustments were not what resolved this playtest complaint. The clutch readability problem is retired with the feature. Residual synthetic forearm-overlap observations do not override this acceptance or justify reopening the original report without a new user-visible reproduction.
