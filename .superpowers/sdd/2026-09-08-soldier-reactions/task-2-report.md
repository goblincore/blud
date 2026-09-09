# Task 2 report

Status: completed.

Implemented injury-aware Soldier combat while keeping `kind: 'soldier'` immutable. Support-arm loss retains the shotgun, uses a 1.5x aim time, and applies deterministic yaw error to the actual projectile direction. Gun-arm loss makes the same Soldier melee-capable: it pursues through the encounter/ring path, throws a left-arm hook when that arm remains, and uses a body-driven shove with both arms gone. A range- and line-of-sight-gated contact pulse fires once as each swing crosses its contact phase. The actor exposes the accumulated contact count through `__sdfGame.brains`; no player-health system was added.

Encounter snapshots now distinguish stable Soldier identity from current ranged capability. Disarmed Soldiers cannot own or reposition for firing lanes and can immediately enter melee arbitration from current body state. Motion no longer collapses for arm loss, and the shotgun carry requires only the gun arm.

Concentrated batches of four or more pellet hits promote the pending Soldier reaction to the existing lurch class and synchronously cancel aim. Single pellets retain their brief flinch. During a strong reaction the gun remains bound to the right hand, that carry swings rearward/outward, support-hand IK releases, and the carry blends back into its requested pose while grounded footwork remains active. Zombie stagger and motion branches remain unchanged. Postmortem Soldier head geometry is again eligible for ordinary sever checks while living lesser head wounds retain Task 1 protection.

TDD evidence:
- New Soldier brain and encounter tests first failed for one-hand timing, disarmed attacks/contact, stable identity/dynamic melee capability, and firing-lane exclusion, then passed after implementation.
- The strong-batch actor regression caught the diagnostic timing distinction between synchronous mind state and the last completed actor frame; it now asserts the completed strong-reaction frame and recovery without stun lock.
- Motion tests verify arm loss stays standing, the remaining hand travels through a real strike arc, the strong reaction releases the support grip, and the gun grip remains attached to the right hand.

Validation:
- Focused brain, motion, attack, mind, encounter, actor, Soldier actor, and weapon suites: 221 tests across 8 files passed.
- `npx tsc --noEmit` passed.
- `git diff --check` passed.
- No GPU or browser work was run; parent owns visual QA.

Files intentionally outside this task remain untracked and were not included: `docs/superpowers/plans/2026-09-08-soldier-reactions.md` and `docs/superpowers/specs/2026-09-08-soldier-reactions-design.md`.

## Review follow-up

Resolved both P2 findings from the independent review. Actor contact dispatch now requires the completed motion frame to remain standing and nonfatal, preventing a swing crossing its contact phase on the same substep as lethal collapse from producing a callback or diagnostic count. The regression advances a disarmed Soldier to late windup, applies lethal torso damage, and verifies collapse without contact.

Strong-reaction support-hand recovery now begins after the initial release and progressively moves the constrained IK target from the released hand position to the gun fore-end, reaching the grip before the lurch expires. This removes the one-frame snap at the old `strongSoldierReaction` boundary while preserving arm lengths and keeping the gun attached to the right hand. The motion regression measures frame-to-frame hand continuity through lurch expiry and final fore-end proximity.

Follow-up validation: 223 tests across the same 8 focused files passed; `npx tsc --noEmit` and `git diff --check` passed. No GPU or browser work was run.

The fatal-contact regression was subsequently tightened to use matched live and killed actors poised immediately below the 0.5 contact boundary. The surviving control emits exactly once on the next step; the actor receiving explicit lethal explosion provenance collapses on that same step and emits zero contacts. Mutation verification temporarily removed the final-frame gate: the test failed because the killed actor emitted once, then passed after restoring the gate.

## Staged gun recovery follow-up

The parent capture at `/tmp/soldier-reactions-qa/flinch-regrip.png` shows the shotgun nearly vertical over the torso at about 0.67 seconds. The muzzle remains below the head in that projection, so this is a silhouette/path issue rather than confirmed 3D head intersection. The cause is `motion.ts` recovering right-arm pitch, yaw, fold, and `gunPitch` together from the reaction pose `(-0.55, -0.35, 0.55, -0.15)` toward the requested carry. With aim carry, the destination is `(0.15, 0.38, 2.51, -1.2275)`. The direct four-axis interpolation passes through an extended forearm with a near-vertical barrel.

Implemented a minimal change that derives two smooth recovery weights from `stagger.state.age` rather than applying the same `strongReactionWeight` to every axis:

```ts
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const forwardRecovery = smooth01((age - 0.18) / 0.42); // complete at 0.60 s
const inwardRecovery = smooth01((age - 0.62) / 0.28); // complete at 0.90 s

carry.right.pitch = lerp(-0.55, wanted.right.pitch, forwardRecovery);
carry.right.fold = lerp(0.55, wanted.right.fold, forwardRecovery);
carry.gunPitch = lerp(-0.15, wanted.gunPitch, forwardRecovery);
carry.right.yaw = lerp(-0.35, wanted.right.yaw, inwardRecovery);
```

This restores the forearm/barrel orientation first while holding the gun outboard, then brings the arm inward after the barrel is forward. Continue storing the resulting `carry` in `carryPose`, keep deriving `gun` from the right elbow/hand every frame, and retain the existing support-hand target blend from 0.25 to 0.90 seconds. At lurch expiry all four axes and support grip already equal the requested carry, so the non-lurch frame has no mode-edge snap.

The schedule does not delay a valid shot. Strong pellet/slug reaction puts the Soldier brain in `stagger` for 0.55 seconds and cancels its prior burst. A new burst must then complete the normal 0.50-second aim, so its earliest shot is about 1.05 seconds after impact; full orientation and support grip finish by 0.90 seconds. One-handed aim takes longer (0.75 seconds). No extra fire gate or projectile-direction adjustment is needed.

Focused CPU coverage:

- Sample a strong-reaction aim carry for at least 1.1 seconds at 60 Hz. On every frame assert `distance(gunPoint(frame.gun, GUN_GRIP.gripHand), frame.restPose[handR]) < 1e-6`.
- Retain the current support-hand continuity assertions: maximum late-frame hand displacement below 0.04 m, final fore-end error below 0.06 m, and arm segment lengths within the existing solver tolerance.
- The new regression samples the full strong-reaction aim carry, asserts the gun grip stays on the right hand every frame, pins forward pitch/fold/gun pitch completion with yaw still outboard at 0.60 seconds, and pins final aim yaw at 0.90 seconds.

The targeted motion suite passes 76 tests. `npx tsc --noEmit` and `git diff --check` also pass. No GPU or browser work was run for this follow-up; parent owns visual confirmation of the revised path.
